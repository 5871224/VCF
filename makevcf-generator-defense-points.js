"use strict";

// 題目產生器的較短／其他 VCF 採多組搜尋：
// 1. 較短 VCF 永遠封鎖；其他 VCF 只在「只留目標 VCF」開啟時封鎖。
// 2. C++ 依「集合子集／完全相同」完成活四正規化與去重後，再統計防守點覆蓋數。
// 3. 由覆蓋組數最多的點開始嘗試；每補一子重新搜尋，失敗即回溯。
// 4. 搜尋達上限時，已有非目標 VCF 就先處理；完全沒找到就視為成功。
(function scheduleGeneratorDefensePointPolicy(global) {
  function install() {
    if (global.__generatorDefensePointPolicyInstalled) return;
    if (
      !global.__generatorTargetBoardUniquePolicyV3Installed ||
      typeof global.genValidateCandidate !== "function" ||
      typeof global.genValidateExtensionCandidate !== "function" ||
      typeof global.genExtendToTarget !== "function"
    ) {
      global.setTimeout(install, 0);
      return;
    }

    global.__generatorDefensePointPolicyInstalled = true;

    const MAX_GROUPS = 64;
    const MAX_DEPTH = 200;
    const DEFAULT_TIME_SECONDS = 30;
    const DEFAULT_NODE_MILLIONS = 20;
    const PACKED_LIMIT_FLAG = 0x80000000;
    const STATE_LIMIT = 96;
    const BALANCE_UNIQUE_ROUND_LIMIT = 8;
    const LINE_OVERLINE = 28;

    const previousValidateCandidate = global.genValidateCandidate;
    const previousValidateExtensionCandidate = global.genValidateExtensionCandidate;
    const previousExtendToTarget = global.genExtendToTarget;

    function cloneState(state) {
      return {
        ...state,
        board: genCloneBoard(state.board),
        nMask: state.nMask?.slice() || new Uint8Array(225),
        addedAttackers: Array.from(state.addedAttackers || []),
        reusedAttackers: Array.from(state.reusedAttackers || []),
        removedDefenders: Array.from(state.removedDefenders || []),
        addedDefenders: Array.from(state.addedDefenders || []),
        autoBlockDefenders: Array.from(state.autoBlockDefenders || []),
        uniqueBlockDefenders: Array.from(state.uniqueBlockDefenders || []),
        xPoints: Array.from(state.xPoints || []),
        lineFivePoints: Array.from(state.lineFivePoints || []),
        vcfSearchLimitReasons: Array.from(state.vcfSearchLimitReasons || []),
      };
    }

    function expectedBoardFor(candidate, previousResult) {
      return previousResult
        ? genBuildExpectedExtendedBoard(previousResult, candidate)
        : genBuildExpectedBaseBoard(candidate);
    }

    function selectedInteger(id, fallback, max) {
      const parsed = Math.trunc(Number(genEl(id)?.value));
      return Number.isFinite(parsed)
        ? Math.max(0, Math.min(max, parsed))
        : fallback;
    }

    function selectedPackedLimits() {
      const seconds = selectedInteger(
        "vcf-multi-time-seconds",
        DEFAULT_TIME_SECONDS,
        0x000fffff,
      );
      const millions = selectedInteger(
        "vcf-multi-node-millions",
        DEFAULT_NODE_MILLIONS,
        1023,
      );
      return (PACKED_LIMIT_FLAG + seconds * 1024 + millions) >>> 0;
    }

    function sameBoard(left, right) {
      return Boolean(left && right) && genBoardsEqual(left, right);
    }

    function defenderCreatesFourFiveOrBlackOverline(state, idx, defender) {
      for (let direction = 0; direction < 4; direction++) {
        const lineType =
          testLineFour(idx, direction, defender, state.board) & GEN_LINE_MASK;
        if (
          lineType === GEN_FOUR_NOFREE ||
          lineType === GEN_FOUR_FREE ||
          lineType === GEN_FIVE ||
          lineType === GEN_LINE_DOUBLE_FOUR
        ) {
          return true;
        }
        if (defender === GEN_BLACK && lineType === LINE_OVERLINE) return true;
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
        if (!state.vcfSearchLimitReasons.includes(reason)) {
          state.vcfSearchLimitReasons.push(reason);
        }
      }
      state.vcfSearchLimitAssumedClean = true;
      return true;
    }

    async function findGroups(state, expectedSteps, blockOtherVCF) {
      const info = await genEngine.findVCF(
        state.board,
        state.attacker,
        MAX_GROUPS,
        {
          mode: "multi",
          simplify: true,
          pruning: genSelectedPruning(),
          maxDepth: blockOtherVCF ? MAX_DEPTH : genTargetSearchPly(expectedSteps),
          maxNode: selectedPackedLimits(),
        },
      );
      if (genCancelled || !info) return null;

      // 多組 C++ 已依選單完成活四正規化與去重；不再於 JS 回放、排序及建字串 key。
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
        item.analysis.steps === expectedSteps &&
        sameBoard(item.analysis.standardBoard, expectedBoard)
      );
      const unwanted = analyzed.filter(item =>
        item.analysis.steps < expectedSteps ||
        (blockOtherVCF && !sameBoard(item.analysis.standardBoard, expectedBoard))
      );
      return { exactTargets, unwanted };
    }

    async function rankDefensePoints(state, unwanted) {
      const defenseSets = await Promise.all(
        unwanted.map(async item => {
          const points = await genEngine.getBlockVCF(
            state.board,
            state.attacker,
            item.moves,
            true,
          );
          return Array.from(new Set(points || []))
            .filter(idx => !isIllegalDefenderPoint(state, idx));
        }),
      );
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
      next.defender = next.defender || genOther(next.attacker);
      if (idx < 0 || idx >= 225 || next.board[idx] !== GEN_EMPTY) return null;
      next.board[idx] = next.defender;
      if (!next.addedDefenders.includes(idx)) next.addedDefenders.push(idx);
      if (!next.autoBlockDefenders.includes(idx)) next.autoBlockDefenders.push(idx);
      return next;
    }

    function addFinalDefender(result, expectedBoard, idx) {
      const next = cloneState(result);
      next.defender = next.defender || genOther(next.attacker);
      if (
        idx < 0 || idx >= 225 ||
        next.board[idx] !== GEN_EMPTY || expectedBoard[idx] !== GEN_EMPTY
      ) {
        return null;
      }
      next.board[idx] = next.defender;
      if (!next.addedDefenders.includes(idx)) next.addedDefenders.push(idx);
      if (!next.autoBlockDefenders.includes(idx)) next.autoBlockDefenders.push(idx);
      if (!next.uniqueBlockDefenders.includes(idx)) next.uniqueBlockDefenders.push(idx);
      next.totalAddedDefenders = Number(next.totalAddedDefenders || 0) + 1;
      next.balanceComplete = false;
      const nextExpectedBoard = genCloneBoard(expectedBoard);
      nextExpectedBoard[idx] = next.defender;
      return { state: next, expectedBoard: nextExpectedBoard };
    }

    async function validateWithRankedDefense(
      candidate,
      expectedSteps,
      previousResult,
      policy,
      budget,
    ) {
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
        return result;
      }

      const ranked = await rankDefensePoints(candidate, unwanted);
      if (!ranked?.length) return null;
      for (const { idx } of ranked) {
        if (genCancelled) return null;
        const next = addLayerDefender(candidate, idx);
        if (!next) continue;
        const result = await validateWithRankedDefense(
          next,
          expectedSteps,
          previousResult,
          policy,
          budget,
        );
        if (result) return result;
      }
      return null;
    }

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
        return {
          ...state,
          moves: target.moves,
          completedBoard: target.analysis.completedBoard,
          standardBoard: target.analysis.standardBoard,
          nMask: genApplyRouteNPoints(state, target.moves),
          nodeCount: found.info.nodeCount || 0,
          groupCount: found.groups.length,
          uniqueVCFVerified: true,
          uniqueVCFSearchLimited: searchLimited,
        };
      }

      const ranked = await rankDefensePoints(state, unwanted);
      if (!ranked?.length) return null;
      for (const { idx } of ranked) {
        if (genCancelled) return null;
        const added = addFinalDefender(state, expectedBoard, idx);
        if (!added) continue;
        const result = await cleanFinalTargetBoard(
          added.state,
          added.expectedBoard,
          targetSteps,
          budget,
        );
        if (result) return result;
      }
      return null;
    }

    global.genValidateCandidate = async function validateCandidateWithMultiDefense(
      candidate,
      expectedSteps,
    ) {
      const blockOtherVCF = Boolean(genEl("block-other-vcf")?.checked);
      const balanceStones = Boolean(genEl("balance-stones")?.checked);
      if (!blockOtherVCF && !balanceStones) {
        return previousValidateCandidate(candidate, expectedSteps);
      }
      return validateWithRankedDefense(
        cloneState(candidate),
        expectedSteps,
        null,
        { blockOtherVCF, balanceStones },
        { nodes: 0 },
      );
    };

    global.genValidateExtensionCandidate = async function validateExtensionWithMultiDefense(
      candidate,
      previousResult,
      targetSteps,
    ) {
      const blockOtherVCF = Boolean(genEl("block-other-vcf")?.checked);
      const balanceStones = Boolean(genEl("balance-stones")?.checked);
      if (!blockOtherVCF && !balanceStones) {
        return previousValidateExtensionCandidate(candidate, previousResult, targetSteps);
      }
      if (targetSteps !== previousResult.steps + 1) return null;
      return validateWithRankedDefense(
        cloneState(candidate),
        targetSteps,
        previousResult,
        { blockOtherVCF, balanceStones },
        { nodes: 0 },
      );
    };

    global.genExtendToTarget = async function extendWithMultiDefense(
      current,
      targetSteps,
      attacker,
      rules,
      options,
      counters,
    ) {
      if (!options?.blockOtherVCF) {
        return previousExtendToTarget(
          current,
          targetSteps,
          attacker,
          rules,
          options,
          counters,
        );
      }

      let result = await previousExtendToTarget(
        current,
        targetSteps,
        attacker,
        rules,
        { ...options, blockOtherVCF: false, balanceStones: false },
        counters,
      );
      if (!result || result.steps !== targetSteps) return result;

      genSetStatus(
        `正在以多組 VCF 封鎖較短／其他路線……已驗證 ${counters.attempts} 個候選`,
      );
      result = await cleanFinalTargetBoard(
        result,
        result.standardBoard,
        targetSteps,
        { nodes: 0 },
      );
      if (!result || !options.balanceStones) return result;

      for (let round = 0; round < BALANCE_UNIQUE_ROUND_LIMIT; round++) {
        const balanced = await previousExtendToTarget(
          result,
          targetSteps,
          attacker,
          rules,
          { ...options, blockOtherVCF: false, balanceStones: true },
          counters,
        );
        if (!balanced) return null;
        result = await cleanFinalTargetBoard(
          balanced,
          balanced.standardBoard,
          targetSteps,
          { nodes: 0 },
        );
        if (!result) return null;
        if (result.balanceComplete) break;
      }
      return result;
    };
  }

  install();
})(window);
