"use strict";

// Canonical generator validation policy.
// Every candidate must preserve the selected target board, all shorter VCF routes are
// repaired by ranked defense points, and same-depth alternate boards are repaired only
// when "只保留目標 VCF" is enabled.
(function installGeneratorSearchPolicy() {
  const MAX_GROUPS = 64;
  const MAX_DEPTH = 200;
  const DEFAULT_TIME_SECONDS = 30;
  const DEFAULT_NODE_MILLIONS = 20;
  const PACKED_LIMIT_FLAG = 0x80000000;
  const STATE_LIMIT = 96;
  const LINE_OVERLINE = 28;
  const BOTH_N = GEN_NO_BLACK | GEN_NO_WHITE;

  function clampInteger(value, min, max, fallback) {
    if (value == null || String(value).trim() === "") return fallback;
    const parsed = Math.trunc(Number(value));
    return Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback;
  }

  function readStoredInteger(key, max, fallback) {
    try {
      return clampInteger(localStorage.getItem(key), 0, max, fallback);
    } catch (_) {
      return fallback;
    }
  }

  function readLimitInput(id, storageKey, max, fallback) {
    const input = document.getElementById(id);
    const stored = readStoredInteger(storageKey, max, fallback);
    const value = clampInteger(input?.value, 0, max, stored);
    if (input) input.value = String(value);
    return value;
  }

  function readSearchSettings() {
    const timeSeconds = readLimitInput(
      "vcf-multi-time-seconds",
      "vcf_multi_time_seconds",
      0x000fffff,
      DEFAULT_TIME_SECONDS,
    );
    const nodeMillions = readLimitInput(
      "vcf-multi-node-millions",
      "vcf_multi_node_millions",
      1023,
      DEFAULT_NODE_MILLIONS,
    );
    return {
      timeSeconds,
      nodeMillions,
      pruning: genSelectedPruning(),
      maxNode: (PACKED_LIMIT_FLAG + timeSeconds * 1024 + nodeMillions) >>> 0,
    };
  }

  genRegisterOptionProvider("search-policy", options => ({
    ...options,
    uniqueSearchSettings: readSearchSettings(),
  }));

  genRegisterBusyHook("search-policy", {
    after(value) {
      for (const id of ["vcf-multi-time-seconds", "vcf-multi-node-millions"]) {
        const input = document.getElementById(id);
        if (input) input.disabled = Boolean(value);
      }
    },
  });

  genRegisterFindRequestProvider("search-policy", request => {
    const active = genGetActiveOptions();
    if (!active?.blockOtherVCF || request.options?.mode !== "multi") return request;
    const settings = active.uniqueSearchSettings || readSearchSettings();
    return {
      ...request,
      maxVCF: Math.min(MAX_GROUPS, Math.max(1, Number(request.maxVCF) || MAX_GROUPS)),
      options: {
        ...request.options,
        simplify: true,
        pruning: settings.pruning,
        maxDepth: MAX_DEPTH,
        maxNode: settings.maxNode,
      },
    };
  }, 20);

  function cloneState(state) {
    return genApplyBlockerNPoints({
      ...state,
      board: genCloneBoard(state.board),
      nMask: state.nMask?.slice() || new Uint8Array(225),
      addedAttackers: Array.from(state.addedAttackers || []),
      reusedAttackers: Array.from(state.reusedAttackers || []),
      reusedDefenders: Array.from(state.reusedDefenders || []),
      removedDefenders: Array.from(state.removedDefenders || []),
      addedDefenders: Array.from(state.addedDefenders || []),
      autoBlockDefenders: Array.from(state.autoBlockDefenders || []),
      uniqueBlockDefenders: Array.from(state.uniqueBlockDefenders || []),
      xPoints: Array.from(state.xPoints || []),
      lineFivePoints: Array.from(state.lineFivePoints || []),
      vcfSearchLimitReasons: Array.from(state.vcfSearchLimitReasons || []),
    });
  }

  function expectedBoardFor(candidate, previousResult) {
    return previousResult
      ? genBuildExpectedExtendedBoard(previousResult, candidate)
      : genBuildExpectedBaseBoard(candidate);
  }

  function currentSearchSettings() {
    return genGetActiveOptions()?.uniqueSearchSettings || readSearchSettings();
  }

  function sameBoard(left, right) {
    return Boolean(left && right) && genBoardsEqual(left, right);
  }

  function defenderCreatesFourFiveOrBlackOverline(state, idx, defender) {
    for (let direction = 0; direction < 4; direction++) {
      const lineType = testLineFour(idx, direction, defender, state.board) & GEN_LINE_MASK;
      if (
        lineType === GEN_FOUR_NOFREE ||
        lineType === GEN_FOUR_FREE ||
        lineType === GEN_FIVE ||
        lineType === GEN_LINE_DOUBLE_FOUR ||
        (defender === GEN_BLACK && lineType === LINE_OVERLINE)
      ) return true;
    }
    return false;
  }

  function isIllegalDefenderPoint(state, idx) {
    const defender = state.defender || genOther(state.attacker);
    if (idx < 0 || idx >= 225 || state.board[idx] !== GEN_EMPTY) return true;
    if (genIsNFor(state.nMask, idx, defender)) return true;
    return defenderCreatesFourFiveOrBlackOverline(state, idx, defender);
  }

  function rememberSearchLimit(state, info) {
    const reasons = [];
    const stopReason = Number(info?.stopReason || 0);
    if (stopReason === 2) reasons.push("時間上限");
    else if (stopReason === 3) reasons.push("節點上限");
    else if (info?.aborted) reasons.push("搜尋上限");
    if (Number(info?.vcfCount || info?.winMoves?.length || 0) >= MAX_GROUPS) {
      reasons.push("組數上限");
    }
    if (!reasons.length) return false;
    state.vcfSearchLimitWarnings = Number(state.vcfSearchLimitWarnings || 0) + 1;
    for (const reason of reasons) {
      if (!state.vcfSearchLimitReasons.includes(reason)) state.vcfSearchLimitReasons.push(reason);
    }
    state.vcfSearchLimitAssumedClean = true;
    return true;
  }

  async function findGroups(state, expectedSteps, blockOtherVCF) {
    const settings = currentSearchSettings();
    const info = await genEngine.findVCF(state.board, state.attacker, MAX_GROUPS, {
      mode: "multi",
      simplify: true,
      pruning: settings.pruning,
      maxDepth: blockOtherVCF ? MAX_DEPTH : genTargetSearchPly(expectedSteps),
      maxNode: settings.maxNode,
    });
    if (genCancelled || !info) return null;
    const groups = Array.from(info.winMoves || [])
      .filter(moves => moves?.length)
      .map(moves => Array.from(moves));
    return { info, groups };
  }

  function analyzeGroups(state, groups, expectedBoard, expectedSteps, blockOtherVCF) {
    const analyzed = [];
    for (const moves of groups) {
      const analysis = genAnalyzeVCFGroup(state.board, moves, state.attacker);
      if (analysis?.valid) analyzed.push({ moves, analysis });
    }
    const exactTargets = analyzed.filter(item =>
      item.analysis.steps === expectedSteps && sameBoard(item.analysis.standardBoard, expectedBoard)
    );
    const unwanted = analyzed.filter(item =>
      item.analysis.steps < expectedSteps ||
      (blockOtherVCF && !sameBoard(item.analysis.standardBoard, expectedBoard))
    );
    return { analyzed, exactTargets, unwanted };
  }

  async function rankDefensePoints(state, unwanted) {
    const defenseSets = await Promise.all(unwanted.map(async item => {
      const points = await genEngine.getBlockVCF(
        state.board,
        state.attacker,
        item.moves,
        true,
      );
      return Array.from(new Set(points || [])).filter(idx => !isIllegalDefenderPoint(state, idx));
    }));
    if (genCancelled) return null;

    const frequency = new Map();
    for (let routeIndex = 0; routeIndex < defenseSets.length; routeIndex++) {
      const legal = defenseSets[routeIndex];
      if (!legal.length) return null;
      for (const idx of legal) {
        let entry = frequency.get(idx);
        if (!entry) {
          entry = { idx, count: 0, routes: [] };
          frequency.set(idx, entry);
        }
        entry.count++;
        entry.routes.push(routeIndex);
      }
    }
    return Array.from(frequency.values())
      .sort((left, right) => right.count - left.count || left.idx - right.idx);
  }

  function addLayerDefender(candidate, idx) {
    const next = cloneState(candidate);
    next.defender ||= genOther(next.attacker);
    if (idx < 0 || idx >= 225 || next.board[idx] !== GEN_EMPTY) return null;
    next.board[idx] = next.defender;
    if (!next.addedDefenders.includes(idx)) next.addedDefenders.push(idx);
    if (!next.autoBlockDefenders.includes(idx)) next.autoBlockDefenders.push(idx);
    next.nMask[idx] |= BOTH_N;
    return next;
  }

  function addFinalDefender(result, expectedBoard, idx) {
    const next = cloneState(result);
    next.defender ||= genOther(next.attacker);
    if (
      idx < 0 || idx >= 225 ||
      next.board[idx] !== GEN_EMPTY || expectedBoard[idx] !== GEN_EMPTY
    ) return null;
    next.board[idx] = next.defender;
    if (!next.addedDefenders.includes(idx)) next.addedDefenders.push(idx);
    if (!next.autoBlockDefenders.includes(idx)) next.autoBlockDefenders.push(idx);
    if (!next.uniqueBlockDefenders.includes(idx)) next.uniqueBlockDefenders.push(idx);
    next.nMask[idx] |= BOTH_N;
    next.totalAddedDefenders = Number(next.totalAddedDefenders || 0) + 1;
    next.balanceComplete = false;
    const nextExpectedBoard = genCloneBoard(expectedBoard);
    nextExpectedBoard[idx] = next.defender;
    return { state: next, expectedBoard: nextExpectedBoard };
  }

  async function validateWithRankedDefense(candidate, expectedSteps, previousResult, policy, budget) {
    if (genCancelled || budget.nodes++ >= STATE_LIMIT) return null;
    const expectedBoard = expectedBoardFor(candidate, previousResult);
    if (!expectedBoard) return null;
    const found = await findGroups(candidate, expectedSteps, policy.blockOtherVCF);
    if (!found) return null;
    const { exactTargets, unwanted } = analyzeGroups(
      candidate,
      found.groups,
      expectedBoard,
      expectedSteps,
      policy.blockOtherVCF,
    );
    if (!exactTargets.length) return null;

    const searchLimited = rememberSearchLimit(candidate, found.info);
    if (!unwanted.length) {
      const result = genFinalizeValidatedResult(
        candidate,
        exactTargets[0],
        found.info,
        found.groups,
        previousResult,
      );
      result.vcfSearchLimited = searchLimited;
      if (policy.blockOtherVCF) {
        result.uniqueVCFVerified = true;
        result.uniqueVCFSearchLimited = searchLimited;
      }
      return genApplyBlockerNPoints(result);
    }

    const ranked = await rankDefensePoints(candidate, unwanted);
    if (!ranked?.length) return null;
    for (const { idx } of ranked) {
      if (genCancelled) return null;
      const next = addLayerDefender(candidate, idx);
      if (!next) continue;
      const attempt = genBeginStoneAttempt({
        phase: "mid",
        board: next.board,
        nMask: next.nMask,
        attacker: next.attacker,
        defender: next.defender,
        idx,
      });
      const result = await validateWithRankedDefense(
        next,
        expectedSteps,
        previousResult,
        policy,
        budget,
      );
      genEndStoneAttempt(
        attempt,
        Boolean(result),
        result ? "此守點保留目標 VCF 並封鎖目前不希望的路線" : "此守點分支未能保留目標 VCF",
      );
      if (result) return result;
    }
    return null;
  }

  window.genValidateBySearchPolicy = async function genValidateBySearchPolicy(
    candidate,
    expectedSteps,
    previousResult,
  ) {
    const options = genGetActiveOptions() || {};
    return validateWithRankedDefense(
      cloneState(candidate),
      expectedSteps,
      previousResult ? cloneState(previousResult) : null,
      { blockOtherVCF: Boolean(options.blockOtherVCF) },
      { nodes: 0 },
    );
  };

  async function cleanFinalTargetBoard(state, expectedBoard, targetSteps, budget) {
    if (genCancelled || budget.nodes++ >= STATE_LIMIT) return null;
    const found = await findGroups(state, targetSteps, true);
    if (!found) return null;
    const { exactTargets, unwanted } = analyzeGroups(
      state,
      found.groups,
      expectedBoard,
      targetSteps,
      true,
    );
    if (!exactTargets.length) return null;

    const searchLimited = rememberSearchLimit(state, found.info);
    if (!unwanted.length) {
      const target = exactTargets[0];
      return genApplyBlockerNPoints({
        ...state,
        moves: target.moves,
        completedBoard: target.analysis.completedBoard,
        standardBoard: target.analysis.standardBoard,
        nMask: genApplyRouteNPoints(state, target.moves),
        nodeCount: found.info.nodeCount || 0,
        groupCount: found.groups.length,
        uniqueVCFVerified: true,
        uniqueVCFSearchLimited: searchLimited,
      });
    }

    const ranked = await rankDefensePoints(state, unwanted);
    if (!ranked?.length) return null;
    for (const { idx } of ranked) {
      if (genCancelled) return null;
      const added = addFinalDefender(state, expectedBoard, idx);
      if (!added) continue;
      const attempt = genBeginStoneAttempt({
        phase: "final",
        board: added.state.board,
        nMask: added.state.nMask,
        attacker: added.state.attacker,
        defender: added.state.defender,
        idx,
      });
      const result = await cleanFinalTargetBoard(
        added.state,
        added.expectedBoard,
        targetSteps,
        budget,
      );
      genEndStoneAttempt(
        attempt,
        Boolean(result),
        result ? "已封鎖其他完成盤面且保留目標 VCF" : "此守點無法完成唯一目標盤面",
      );
      if (result) return result;
    }
    return null;
  }

  window.genCleanFinalTargetBoard = function genCleanFinalTargetBoard(result, targetSteps) {
    return cleanFinalTargetBoard(
      cloneState(result),
      genCloneBoard(result.standardBoard),
      targetSteps,
      { nodes: 0 },
    );
  };
})();
