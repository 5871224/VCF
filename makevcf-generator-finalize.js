"use strict";

// Final result orchestration. Search/validation creates the requested dead-four layers;
// this module then optionally removes alternate target boards and balances the final
// black/white move count. It is called once from genGenerate(), never by function wrapping.
(function installGeneratorFinalizer() {
  const SHAPE_MASK = 0x0f;
  const THREE_NOFREE = 6;
  const THREE_FREE = 7;
  const FILL_BRANCH_LIMIT = 6;
  const FILL_STATE_LIMIT = 32;
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

  function multiplyLineShapeWeight(weight, board, idx, color, includeFours, threeMultiplier) {
    let result = weight;
    for (let direction = 0; direction < 4; direction++) {
      const three = testLineThree(idx, direction, color, board) & SHAPE_MASK;
      if (three === THREE_FREE || three === THREE_NOFREE) result *= threeMultiplier;
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
    weight = multiplyLineShapeWeight(weight, board, idx, attacker, true, options.threeMultiplier);
    weight = multiplyLineShapeWeight(weight, board, idx, defender, false, options.threeMultiplier);
    return weight * Math.max(1, neighborhoodStoneCount(board, idx));
  }

  function weightedRandomOrder(items) {
    return items
      .map(item => ({
        item,
        key: item.weight > 0
          ? -Math.log(Math.max(Number.MIN_VALUE, Math.random())) / item.weight
          : Math.random(),
      }))
      .sort((left, right) => left.key - right.key)
      .map(entry => entry.item);
  }

  function pointCreatesForbiddenResult(state, idx, color) {
    if (state.rules === 2 && color === GEN_BLACK && isFoul(idx, state.board)) return true;
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
      await genEngine.getBlockVCF(state.board, state.attacker, state.moves, true),
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

  function isExpectedTarget(analysis, targetSteps, expectedBoard) {
    return Boolean(
      analysis?.valid &&
      analysis.steps === targetSteps &&
      genBoardsEqual(analysis.standardBoard, expectedBoard)
    );
  }

  async function findTargetAfterFill(board, attacker, fillColor, targetSteps, expectedBoard, budget) {
    const maxDepth = genTargetSearchPly(targetSteps);
    const filledAttackerStone = fillColor === attacker;
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

    const shortestIsTarget = isExpectedTarget(shortestAnalysis, targetSteps, expectedBoard);
    if (!filledAttackerStone && shortestIsTarget) {
      return {
        info: shortestInfo,
        moves: shortestMoves,
        analysis: shortestAnalysis,
        groupCount: 1,
        searchLimited: Boolean(shortestInfo.aborted),
      };
    }

    if (performance.now() >= budget.deadline) return null;
    const info = await genEngine.findVCF(board, attacker, TARGET_MAX_GROUPS, {
      mode: "multi",
      maxDepth,
      maxNode: TARGET_MAX_NODE,
    });
    if (genCancelled || !info?.winMoves?.length) return null;
    const raw = info.winMoves.filter(moves => moves?.length);
    const groups = await genEngine.trimGroups(board, raw, attacker);
    if (genCancelled || !groups.length) return null;

    let target = shortestIsTarget
      ? { moves: shortestMoves, analysis: shortestAnalysis }
      : null;
    for (const moves of groups) {
      const analysis = genAnalyzeVCFGroup(board, moves, attacker);
      if (!analysis.valid) continue;
      if (analysis.steps < targetSteps) return null;
      if (isExpectedTarget(analysis, targetSteps, expectedBoard)) {
        target ||= { moves: Array.from(moves), analysis };
      } else if (filledAttackerStone && analysis.steps === targetSteps) {
        return null;
      }
    }
    if (!target) return null;
    return {
      info,
      moves: target.moves,
      analysis: target.analysis,
      groupCount: groups.length,
      searchLimited: Boolean(info.aborted) || raw.length >= TARGET_MAX_GROUPS,
    };
  }

  async function validateFilledState(state, idx, color, targetSteps, budget) {
    const board = genCloneBoard(state.board);
    board[idx] = color;
    const expectedBoard = genCloneBoard(state.standardBoard);
    expectedBoard[idx] = color;
    const target = await findTargetAfterFill(
      board,
      state.attacker,
      color,
      targetSteps,
      expectedBoard,
      budget,
    );
    if (!target) return null;

    const isAttacker = color === state.attacker;
    const next = genApplyBlockerNPoints({
      ...state,
      board,
      nMask: genApplyRouteNPoints({ ...state, board }, target.moves),
      moves: target.moves,
      completedBoard: target.analysis.completedBoard,
      standardBoard: target.analysis.standardBoard,
      nodeCount: target.info.nodeCount || 0,
      groupCount: target.groupCount,
      balanceComplete: false,
      totalAddedAttackers: Number(state.totalAddedAttackers || 0) + (isAttacker ? 1 : 0),
      totalAddedDefenders: Number(state.totalAddedDefenders || 0) + (isAttacker ? 0 : 1),
      balanceFillAttackers: [
        ...Array.from(state.balanceFillAttackers || []),
        ...(isAttacker ? [idx] : []),
      ],
      balanceFillDefenders: [
        ...Array.from(state.balanceFillDefenders || []),
        ...(isAttacker ? [] : [idx]),
      ],
    });
    if (target.searchLimited) {
      next.balanceVCFSearchLimited = true;
      next.balanceVCFSearchLimitWarnings = Number(state.balanceVCFSearchLimitWarnings || 0) + 1;
    }
    return next;
  }

  async function fillColorRecursive(state, pool, color, targetSteps, remaining, budget) {
    if (remaining <= 0) return state;
    if (
      genCancelled ||
      budget.states >= FILL_STATE_LIMIT ||
      performance.now() >= budget.deadline
    ) return null;

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

      const replayBoard = genCloneBoard(state.board);
      replayBoard[idx] = color;
      const attempt = genBeginStoneAttempt({
        phase: "balance",
        board: replayBoard,
        nMask: state.nMask,
        attacker: state.attacker,
        color,
        idx,
      });
      const next = await validateFilledState(state, idx, color, targetSteps, budget);
      if (!next) {
        genEndStoneAttempt(
          attempt,
          false,
          color === state.attacker
            ? "補入攻方棋後，目標 VCF 消失、出現較短 VCF，或新增其他攻方 VCF，已撤銷"
            : "補入守方棋後未能保留原攻方目標 VCF，已撤銷",
        );
        continue;
      }
      const completed = await fillColorRecursive(
        next,
        pool,
        color,
        targetSteps,
        remaining - 1,
        budget,
      );
      genEndStoneAttempt(
        attempt,
        Boolean(completed),
        completed
          ? color === state.attacker
            ? "攻方目標 VCF 仍存在，且未找到新增的其他攻方 VCF"
            : "原攻方目標 VCF 仍存在"
          : "後續補齊分支失敗，已撤銷並回溯",
      );
      if (completed) return completed;
    }
    return null;
  }

  async function fillRequiredColor(state, targetSteps, options, requirement, deadline) {
    if (!requirement.count) return state;
    const pool = await buildFillPool(state, requirement.color, options);
    if (!pool.length) return null;
    return fillColorRecursive(
      state,
      pool,
      requirement.color,
      targetSteps,
      requirement.count,
      { states: 0, visited: new Set(), deadline },
    );
  }

  window.genFinalizeGeneratedResult = async function genFinalizeGeneratedResult(
    initialResult,
    targetSteps,
    options,
    counters,
  ) {
    let result = genApplyBlockerNPoints(initialResult);
    if (!result) return null;

    if (options?.blockOtherVCF) {
      genSetStatus(`正在以多組 VCF 封鎖較短／其他路線……已驗證 ${counters.attempts} 個候選`);
      result = await genCleanFinalTargetBoard(result, targetSteps);
      if (!result || genCancelled) return null;
    }

    if (!options?.balanceStones) return genApplyBlockerNPoints(result);
    const deadline = performance.now() + FILL_TIME_LIMIT_MS;
    for (let round = 0; round < FILL_ROUND_LIMIT; round++) {
      if (performance.now() >= deadline) return null;
      const requirement = requiredFinalFill(result.board, result.attacker);
      if (!requirement.count) {
        return genApplyBlockerNPoints({ ...result, balanceComplete: true });
      }
      const colorName = requirement.color === GEN_BLACK ? "黑" : "白";
      const roleName = requirement.color === result.attacker ? "攻方" : "守方";
      genSetStatus(
        `VCF 已完成，最後補齊${roleName}${colorName}子 ${requirement.count} 顆……` +
        `已驗證 ${counters.attempts} 個候選`,
      );
      result = await fillRequiredColor(result, targetSteps, options, requirement, deadline);
      if (!result || genCancelled) return null;

      if (options.blockOtherVCF && requirement.color !== result.attacker) {
        result = await genCleanFinalTargetBoard(result, targetSteps);
        if (!result || genCancelled) return null;
      }
    }
    return null;
  };
})();
