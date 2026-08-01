"use strict";

// 分離題目產生器的三種補子來源：
// 1. 較短 VCF：基礎與每次增加死四後都必須補守。
// 2. 同步數別組 VCF：只在「只保留目標 VCF」開啟時補守。
// 3. 補齊黑白子數：只在達到指定步數後執行，並依盤面缺少的顏色補黑或補白。
(function installGeneratorValidationStageSeparation(global) {
  const INSTALL_FLAG = "__generatorValidationStageSeparationInstalled";
  const FILL_BRANCH_LIMIT = 10;
  const FILL_NODE_LIMIT = 140;
  const BALANCE_UNIQUE_ROUND_LIMIT = 8;
  const SHAPE_MASK = 0x0f;
  const THREE_NOFREE = 6;
  const THREE_FREE = 7;

  function callWithValidationGate(callback, balanceInput) {
    const originalBalance = balanceInput?.checked;
    if (balanceInput) balanceInput.checked = true;
    try {
      // 現行 streaming 驗證會在第一個 await 前同步讀取選項。
      // 暫時開啟只用來啟動「較短 VCF 補守」；是否封鎖別組 VCF
      // 仍完全依照 block-other-vcf 的原始勾選狀態。
      return callback();
    } finally {
      if (balanceInput) balanceInput.checked = originalBalance;
    }
  }

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
    const missingDifference = targetDifference - (black - white);
    if (missingDifference > 0) {
      return { color: GEN_BLACK, count: missingDifference, black, white };
    }
    if (missingDifference < 0) {
      return { color: GEN_WHITE, count: -missingDifference, black, white };
    }
    return { color: GEN_EMPTY, count: 0, black, white };
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

  function fillPointWeight(board, idx, attacker, defender, threeMultiplier) {
    let weight = 1;
    weight = multiplyLineShapeWeight(
      weight,
      board,
      idx,
      attacker,
      true,
      threeMultiplier,
    );
    weight = multiplyLineShapeWeight(
      weight,
      board,
      idx,
      defender,
      false,
      threeMultiplier,
    );
    return weight * neighborhoodStoneCount(board, idx);
  }

  function weightedRandomOrder(items) {
    const positive = items.filter(item => item.weight > 0);
    if (!positive.length) {
      return items
        .map(item => ({ item, key: Math.random() }))
        .sort((a, b) => a.key - b.key)
        .map(entry => entry.item);
    }
    return positive
      .map(item => ({
        item,
        key:
          -Math.log(Math.max(Number.MIN_VALUE, Math.random())) /
          item.weight,
      }))
      .sort((a, b) => a.key - b.key)
      .map(entry => entry.item);
  }

  function pointCreatesForbiddenResult(
    board,
    idx,
    color,
    attacker,
    rules,
  ) {
    if (rules === 2 && color === GEN_BLACK && isFoul(idx, board)) return true;

    // 最後補到守方時仍沿用原限制：守方不能藉補子形成四或連五。
    if (color === genOther(attacker)) {
      for (let direction = 0; direction < 4; direction++) {
        const four = testLineFour(idx, direction, color, board) & SHAPE_MASK;
        if (four === GEN_FOUR_NOFREE || four === GEN_FOUR_FREE) return true;
      }
    }

    const next = genCloneBoard(board);
    next[idx] = color;
    return (getLevelPoint(idx, color, next) & SHAPE_MASK) >= GEN_FIVE;
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
    const defender = genOther(state.attacker);
    const eligible = [];

    for (let idx = 0; idx < 225; idx++) {
      if (!isInteriorPoint(idx) || state.board[idx] !== GEN_EMPTY) continue;
      if (genIsNFor(state.nMask, idx, color)) continue;
      if (protectedPoints.has(idx)) continue;
      if (
        pointCreatesForbiddenResult(
          state.board,
          idx,
          color,
          state.attacker,
          state.rules,
        )
      ) {
        continue;
      }
      eligible.push(idx);
    }

    const pool = [];
    setGameRules(1);
    try {
      for (const idx of eligible) {
        pool.push({
          idx,
          weight: fillPointWeight(
            state.board,
            idx,
            state.attacker,
            defender,
            options.threeMultiplier,
          ),
        });
      }
    } finally {
      setGameRules(state.rules);
    }
    return pool;
  }

  async function dynamicFillCandidates(state, pool, color) {
    const protectedPoints = new Set(
      await genEngine.getBlockVCF(
        state.board,
        state.attacker,
        state.moves,
        true,
      ),
    );
    return pool.filter(item => {
      const idx = item.idx;
      if (state.board[idx] !== GEN_EMPTY) return false;
      if (genIsNFor(state.nMask, idx, color)) return false;
      if (protectedPoints.has(idx)) return false;
      return !pointCreatesForbiddenResult(
        state.board,
        idx,
        color,
        state.attacker,
        state.rules,
      );
    });
  }

  async function validateFilledState(state, idx, color, targetSteps) {
    const board = genCloneBoard(state.board);
    board[idx] = color;
    const expectedBoard = genCloneBoard(state.standardBoard);
    expectedBoard[idx] = color;
    const candidate = { ...state, board };
    const found = await genFindAnalyzedGroups(candidate, targetSteps);
    if (!found) return null;

    const { info, groups } = found;
    const analyzed = groups
      .map(moves => ({
        moves: Array.from(moves),
        analysis: genAnalyzeVCFGroup(board, moves, state.attacker),
      }))
      .filter(item => item.analysis.valid);

    if (analyzed.some(item => item.analysis.steps < targetSteps)) return null;
    const target = analyzed.find(
      item =>
        item.analysis.steps === targetSteps &&
        genBoardsEqual(item.analysis.standardBoard, expectedBoard),
    );
    if (!target) return null;

    const fillStone = { idx, color };
    const next = {
      ...state,
      board,
      nMask: genApplyRouteNPoints({ ...state, board }, target.moves),
      moves: target.moves,
      completedBoard: target.analysis.completedBoard,
      standardBoard: target.analysis.standardBoard,
      nodeCount: info.nodeCount || 0,
      groupCount: groups.length,
      balanceFillStones: [
        ...Array.from(state.balanceFillStones || []),
        fillStone,
      ],
      balanceFillBlack: [
        ...Array.from(state.balanceFillBlack || []),
        ...(color === GEN_BLACK ? [idx] : []),
      ],
      balanceFillWhite: [
        ...Array.from(state.balanceFillWhite || []),
        ...(color === GEN_WHITE ? [idx] : []),
      ],
    };

    if (color === state.attacker) {
      next.totalAddedAttackers = Number(state.totalAddedAttackers || 0) + 1;
      next.balanceFillAttackers = [
        ...Array.from(state.balanceFillAttackers || []),
        idx,
      ];
    } else {
      next.totalAddedDefenders = Number(state.totalAddedDefenders || 0) + 1;
      next.balanceFillDefenders = [
        ...Array.from(state.balanceFillDefenders || []),
        idx,
      ];
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
    if (genCancelled || budget.nodes++ >= FILL_NODE_LIMIT) return null;

    const available = await dynamicFillCandidates(state, pool, color);
    if (!available.length) return null;
    const ordered = weightedRandomOrder(available).slice(0, FILL_BRANCH_LIMIT);

    for (const item of ordered) {
      if (genCancelled) return null;
      const next = await validateFilledState(
        state,
        item.idx,
        color,
        targetSteps,
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
      { nodes: 0 },
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

    const previousValidateCandidate = global.genValidateCandidate;
    const previousValidateExtensionCandidate =
      global.genValidateExtensionCandidate;
    const previousExtendToTarget = global.genExtendToTarget;
    global[INSTALL_FLAG] = true;

    global.genValidateCandidate = function validateBaseWithSeparatedRepair(
      ...args
    ) {
      return callWithValidationGate(
        () => previousValidateCandidate.apply(this, args),
        global.genEl("balance-stones"),
      );
    };

    global.genValidateExtensionCandidate =
      function validateExtensionWithSeparatedRepair(...args) {
        return callWithValidationGate(
          () => previousValidateExtensionCandidate.apply(this, args),
          global.genEl("balance-stones"),
        );
      };

    global.genExtendToTarget = async function extendThenBalanceByColor(
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
        {
          ...options,
          balanceStones: false,
        },
        counters,
      );
      if (
        !result ||
        !balanceRequested ||
        result.balanceComplete ||
        result.steps !== targetSteps
      ) {
        return result;
      }

      for (
        let round = 0;
        round < BALANCE_UNIQUE_ROUND_LIMIT;
        round++
      ) {
        const requirement = requiredFinalFill(result.board, result.attacker);
        if (!requirement.count) {
          return { ...result, balanceComplete: true };
        }

        const colorName = requirement.color === GEN_BLACK ? "黑" : "白";
        genSetStatus(
          `VCF 已完成，正在補齊${colorName}子 ${requirement.count} 顆……` +
            `已驗證 ${counters.attempts} 個候選`,
        );
        result = await fillRequiredColor(
          result,
          targetSteps,
          options,
          requirement,
        );
        if (!result) return null;

        if (options?.blockOtherVCF) {
          result = await previousExtendToTarget.call(
            this,
            result,
            targetSteps,
            attacker,
            rules,
            {
              ...options,
              balanceStones: false,
              blockOtherVCF: true,
            },
            counters,
          );
          if (!result) return null;
        }
      }
      return null;
    };
  }

  install();
})(window);
