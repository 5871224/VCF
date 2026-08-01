"use strict";

// 分離題目產生器的三個階段：
// 1. 每層驗證固定處理較短 VCF。
// 2. 同步數其他 VCF 只依「只保留目標 VCF」設定處理。
// 3. 黑白子數只在指定步數完成後補齊，且只由盤面差額決定補黑或補白。
(function installGeneratorValidationAndBalanceFix(global) {
  const INSTALL_FLAG = "__generatorValidationAndBalanceFixInstalled";
  const SHAPE_MASK = 0x0f;
  const THREE_NOFREE = 6;
  const THREE_FREE = 7;
  const FILL_BRANCH_LIMIT = 8;
  const FILL_STATE_LIMIT = 48;
  const FILL_TIME_LIMIT_MS = 12000;
  const FILL_ROUND_LIMIT = 6;
  const SHORTEST_MAX_NODE = 800000;
  const TARGET_MAX_NODE = 1600000;
  const TARGET_MAX_GROUPS = 16;

  function countStones(board) {
    let black = 0;
    let white = 0;
    for (let idx = 0; idx < 225; idx++) {
      if (board[idx] === GEN_BLACK) black++;
      else if (board[idx] === GEN_WHITE) white++;
    }
    return { black, white };
  }

  function requiredFinalFill(board, attacker) {
    const { black, white } = countStones(board);
    const targetDifference = attacker === GEN_BLACK ? 0 : 1;
    const delta = targetDifference - (black - white);
    if (delta > 0) return { color: GEN_BLACK, count: delta };
    if (delta < 0) return { color: GEN_WHITE, count: -delta };
    return { color: GEN_EMPTY, count: 0 };
  }

  function callWithShorterVCFRepair(callback) {
    const balanceInput = global.genEl("balance-stones");
    const originalBalance = balanceInput?.checked;
    if (balanceInput) balanceInput.checked = true;
    try {
      // defense-points 會同步讀取此值，只用來進入串流式較短 VCF 驗證。
      // block-other-vcf 不做任何改動，所以其他 VCF 仍由原選項獨立控制。
      return callback();
    } finally {
      if (balanceInput) balanceInput.checked = originalBalance;
    }
  }

  function patchImmediateCancel() {
    if (genEngine.__immediateCancelPatched) return;
    genEngine.__immediateCancelPatched = true;
    genEngine.cancel = function cancelGeneratorImmediately() {
      if (this.worker) this.worker.terminate();
      this.worker = null;
      this.rejectPending(new Error("題目產生器計算已中止"));
      this.ready = this.start();
      this.ready.catch(error => {
        console.warn("題目產生器 Worker 重新初始化失敗", error);
      });
      return Promise.resolve();
    };
  }

  function isInteriorPoint(idx) {
    const x = genX(idx);
    const y = genY(idx);
    return x > 0 && x < 14 && y > 0 && y < 14;
  }

  function neighborhoodStoneCount(board, idx) {
    const x = genX(idx);
    const y = genY(idx);
    let count = 0;
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const point = genIdx(x + dx, y + dy);
        if (point !== GEN_OUT && board[point] !== GEN_EMPTY) count++;
      }
    }
    return count;
  }

  function multiplyLineShapeWeight(
    weight,
    board,
    idx,
    color,
    includeFours,
    threeMultiplier,
  ) {
    let result = weight;
    for (let direction = 0; direction < 4; direction++) {
      const three = testLineThree(idx, direction, color, board) & SHAPE_MASK;
      if (three === THREE_FREE || three === THREE_NOFREE) {
        result *= threeMultiplier;
      }
      if (includeFours) {
        const four = testLineFour(idx, direction, color, board) & SHAPE_MASK;
        if (four === GEN_FOUR_FREE) result *= 1000000;
        else if (four === GEN_FOUR_NOFREE) result *= 10;
      }
    }
    return result;
  }

  function fillPointWeight(board, idx, attacker, options) {
    const defender = genOther(attacker);
    let weight = 1;
    weight = multiplyLineShapeWeight(
      weight,
      board,
      idx,
      attacker,
      true,
      options.threeMultiplier,
    );
    weight = multiplyLineShapeWeight(
      weight,
      board,
      idx,
      defender,
      false,
      options.threeMultiplier,
    );
    return weight * Math.max(1, neighborhoodStoneCount(board, idx));
  }

  function weightedRandomOrder(items) {
    return items
      .map(item => ({
        item,
        key:
          item.weight > 0
            ? -Math.log(Math.max(Number.MIN_VALUE, Math.random())) / item.weight
            : Math.random(),
      }))
      .sort((a, b) => a.key - b.key)
      .map(entry => entry.item);
  }

  function pointCreatesForbiddenResult(state, idx, color) {
    if (state.rules === 2 && color === GEN_BLACK && isFoul(idx, state.board)) {
      return true;
    }

    if (color === genOther(state.attacker)) {
      for (let direction = 0; direction < 4; direction++) {
        const four = testLineFour(idx, direction, color, state.board) & SHAPE_MASK;
        if (four === GEN_FOUR_NOFREE || four === GEN_FOUR_FREE) return true;
      }
    }

    const board = genCloneBoard(state.board);
    board[idx] = color;
    return (getLevelPoint(idx, color, board) & SHAPE_MASK) >= GEN_FIVE;
  }

  async function buildFillPool(state, color, options) {
    const protectedPoints = new Set(
      await genEngine.getBlockVCF(
        state.board,
        state.attacker,
        state.moves,
        true,
      ),
    );
    if (genCancelled) return [];

    const eligible = [];
    for (let idx = 0; idx < 225; idx++) {
      if (!isInteriorPoint(idx) || state.board[idx] !== GEN_EMPTY) continue;
      if (genIsNFor(state.nMask, idx, color)) continue;
      if (protectedPoints.has(idx)) continue;
      if (pointCreatesForbiddenResult(state, idx, color)) continue;
      eligible.push({
        idx,
        weight: fillPointWeight(state.board, idx, state.attacker, options),
      });
    }
    return weightedRandomOrder(eligible);
  }

  function boardKey(board, remaining) {
    return `${remaining}:${Array.from(board).slice(0, 225).join("")}`;
  }

  async function findTargetAfterFill(
    board,
    attacker,
    targetSteps,
    expectedBoard,
    budget,
  ) {
    const maxDepth = genTargetSearchPly(targetSteps);
    if (performance.now() >= budget.deadline) return null;
    const shortestInfo = await genEngine.findVCF(board, attacker, 1, {
      mode: "shortest",
      maxDepth,
      maxNode: SHORTEST_MAX_NODE,
    });
    if (genCancelled || !shortestInfo?.winMoves?.length) return null;

    const shortestMoves = Array.from(shortestInfo.winMoves[0] || []);
    const shortestAnalysis = genAnalyzeVCFGroup(board, shortestMoves, attacker);
    if (!shortestAnalysis.valid || shortestAnalysis.steps < targetSteps) return null;
    if (
      shortestAnalysis.steps === targetSteps &&
      genBoardsEqual(shortestAnalysis.standardBoard, expectedBoard)
    ) {
      return {
        info: shortestInfo,
        moves: shortestMoves,
        analysis: shortestAnalysis,
        groupCount: 1,
      };
    }

    if (performance.now() >= budget.deadline) return null;
    const info = await genEngine.findVCF(board, attacker, TARGET_MAX_GROUPS, {
      mode: "multi",
      maxDepth,
      maxNode: TARGET_MAX_NODE,
    });
    if (genCancelled || !info?.winMoves?.length) return null;
    const raw = info.winMoves.filter(moves => moves && moves.length);
    const groups = await genEngine.trimGroups(board, raw, attacker);
    if (genCancelled || !groups.length) return null;

    let target = null;
    for (const moves of groups) {
      const analysis = genAnalyzeVCFGroup(board, moves, attacker);
      if (!analysis.valid) continue;
      if (analysis.steps < targetSteps) return null;
      if (
        !target &&
        analysis.steps === targetSteps &&
        genBoardsEqual(analysis.standardBoard, expectedBoard)
      ) {
        target = { moves: Array.from(moves), analysis };
      }
    }
    if (!target) return null;
    return {
      info,
      moves: target.moves,
      analysis: target.analysis,
      groupCount: groups.length,
    };
  }

  async function validateFilledState(
    state,
    idx,
    color,
    targetSteps,
    budget,
  ) {
    const board = genCloneBoard(state.board);
    board[idx] = color;
    const expectedBoard = genCloneBoard(state.standardBoard);
    expectedBoard[idx] = color;

    const target = await findTargetAfterFill(
      board,
      state.attacker,
      targetSteps,
      expectedBoard,
      budget,
    );
    if (!target) return null;

    const next = {
      ...state,
      board,
      nMask: genApplyRouteNPoints({ ...state, board }, target.moves),
      moves: target.moves,
      completedBoard: target.analysis.completedBoard,
      standardBoard: target.analysis.standardBoard,
      nodeCount: target.info.nodeCount || 0,
      groupCount: target.groupCount,
      finalBalanceAdded: Number(state.finalBalanceAdded || 0) + 1,
      balanceComplete: false,
    };
    if (color === state.attacker) {
      next.totalAddedAttackers = Number(state.totalAddedAttackers || 0) + 1;
    } else {
      next.totalAddedDefenders = Number(state.totalAddedDefenders || 0) + 1;
    }
    return next;
  }

  async function fillColorRecursive(
    state,
    pool,
    color,
    targetSteps,
    remaining,
    budget,
  ) {
    if (remaining <= 0) return state;
    if (
      genCancelled ||
      budget.states >= FILL_STATE_LIMIT ||
      performance.now() >= budget.deadline
    ) {
      return null;
    }

    const key = boardKey(state.board, remaining);
    if (budget.visited.has(key)) return null;
    budget.visited.add(key);
    budget.states++;

    let tried = 0;
    for (const item of pool) {
      if (genCancelled || tried >= FILL_BRANCH_LIMIT) return null;
      const idx = item.idx;
      if (state.board[idx] !== GEN_EMPTY) continue;
      if (genIsNFor(state.nMask, idx, color)) continue;
      if (pointCreatesForbiddenResult(state, idx, color)) continue;
      tried++;

      const next = await validateFilledState(
        state,
        idx,
        color,
        targetSteps,
        budget,
      );
      if (!next) continue;
      const completed = await fillColorRecursive(
        next,
        pool,
        color,
        targetSteps,
        remaining - 1,
        budget,
      );
      if (completed) return completed;
    }
    return null;
  }

  async function fillRequiredColor(state, targetSteps, options, requirement) {
    if (!requirement.count) return state;
    const pool = await buildFillPool(state, requirement.color, options);
    if (!pool.length) return null;
    return fillColorRecursive(
      state,
      pool,
      requirement.color,
      targetSteps,
      requirement.count,
      {
        states: 0,
        visited: new Set(),
        deadline: performance.now() + FILL_TIME_LIMIT_MS,
      },
    );
  }

  function install() {
    if (global[INSTALL_FLAG]) return;
    if (
      !global.__generatorDefensePointPolicyInstalled ||
      typeof global.genValidateCandidate !== "function" ||
      typeof global.genValidateExtensionCandidate !== "function" ||
      typeof global.genExtendToTarget !== "function" ||
      typeof global.genEl !== "function"
    ) {
      global.setTimeout(install, 0);
      return;
    }

    patchImmediateCancel();

    const previousSetStatus = genSetStatus;
    genSetStatus = function normalizeCancelledGeneratorStatus(text) {
      const message = String(text ?? "");
      if (
        genCancelled &&
        message.startsWith("產生失敗：") &&
        message.includes("中止")
      ) {
        return previousSetStatus("已停止產生");
      }
      return previousSetStatus(text);
    };

    const previousValidateCandidate = global.genValidateCandidate;
    const previousValidateExtensionCandidate =
      global.genValidateExtensionCandidate;
    const previousExtendToTarget = global.genExtendToTarget;
    global[INSTALL_FLAG] = true;

    global.genValidateCandidate = function validateBaseWithShorterRepair(...args) {
      return callWithShorterVCFRepair(
        () => previousValidateCandidate.apply(this, args),
      );
    };

    global.genValidateExtensionCandidate =
      function validateExtensionWithShorterRepair(...args) {
        return callWithShorterVCFRepair(
          () => previousValidateExtensionCandidate.apply(this, args),
        );
      };

    global.genExtendToTarget = async function extendThenBalanceByBoardCount(
      current,
      targetSteps,
      attacker,
      rules,
      options,
      counters,
    ) {
      const balanceRequested = Boolean(options?.balanceStones);
      let result = await previousExtendToTarget.call(
        this,
        current,
        targetSteps,
        attacker,
        rules,
        { ...options, balanceStones: false },
        counters,
      );
      if (
        !result ||
        !balanceRequested ||
        result.steps !== targetSteps ||
        genCancelled
      ) {
        return result;
      }

      for (let round = 0; round < FILL_ROUND_LIMIT; round++) {
        const requirement = requiredFinalFill(result.board, result.attacker);
        if (!requirement.count) {
          return { ...result, balanceComplete: true };
        }

        const colorName = requirement.color === GEN_BLACK ? "黑" : "白";
        genSetStatus(
          `VCF 已完成，最後補齊${colorName}子 ${requirement.count} 顆……` +
            `已驗證 ${counters.attempts} 個候選`,
        );
        result = await fillRequiredColor(
          result,
          targetSteps,
          options,
          requirement,
        );
        if (!result || genCancelled) return null;

        // 最後補子可能新產生同步數其他 VCF；只有勾選唯一題時才再清理。
        if (options?.blockOtherVCF) {
          result = await previousExtendToTarget.call(
            this,
            result,
            targetSteps,
            attacker,
            rules,
            { ...options, balanceStones: false, blockOtherVCF: true },
            counters,
          );
          if (!result || genCancelled) return null;
        }
      }
      return null;
    };
  }

  install();
})(window);
