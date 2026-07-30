"use strict";

// Use the complete defense-point union for shorter and non-target VCF blocking.
// Points are ranked by how many unwanted VCF routes they block, after excluding
// every target-route defense point, defender N points, defender four/five points,
// and (for a black defender) overline points only.
(function scheduleGeneratorDefensePointPolicy() {
  function installMobileDoubleTapGuard() {
    const viewport = document.querySelector('meta[name="viewport"]');
    if (viewport) {
      viewport.setAttribute(
        "content",
        "width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no",
      );
    }

    if (!document.querySelector('style[data-mobile-double-tap-guard="true"]')) {
      const style = document.createElement("style");
      style.dataset.mobileDoubleTapGuard = "true";
      style.textContent = `
        html, body, button, input, select, textarea, label, a {
          touch-action: manipulation;
        }
      `;
      document.head.appendChild(style);
    }

    if (!window.__mobileDoubleTapGuardInstalled) {
      window.__mobileDoubleTapGuardInstalled = true;
      document.addEventListener("dblclick", event => event.preventDefault(), { passive: false });
    }
  }

  function installGeneratorDefensePointPolicy() {
    if (window.__generatorDefensePointPolicyInstalled) return;
    if (!window.__generatorTargetBoardUniquePolicyV3Installed) {
      window.setTimeout(installGeneratorDefensePointPolicy, 0);
      return;
    }
    window.__generatorDefensePointPolicyInstalled = true;
    installMobileDoubleTapGuard();

    const MAX_GROUPS = 64;
    const MAX_DEPTH = 200;
    const DEFAULT_MAX_NODE = 5000000;
    const STATE_LIMIT = 96;
    const BALANCE_UNIQUE_ROUND_LIMIT = 8;
    const LINE_OVERLINE = 28;

    const previousValidateCandidate = genValidateCandidate;
    const previousValidateExtensionCandidate = genValidateExtensionCandidate;
    const previousExtendToTarget = genExtendToTarget;

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
      };
    }

    function expectedBoardFor(candidate, previousResult) {
      return previousResult
        ? genBuildExpectedExtendedBoard(previousResult, candidate)
        : genBuildExpectedBaseBoard(candidate);
    }

    function defenderAllowance(board, attacker) {
      let black = 0;
      let white = 0;
      for (let idx = 0; idx < 225; idx++) {
        if (board[idx] === GEN_BLACK) black++;
        else if (board[idx] === GEN_WHITE) white++;
      }
      return attacker === GEN_BLACK ? black - white : white + 1 - black;
    }

    function isSameBoard(left, right) {
      return Boolean(left && right) && genBoardsEqual(left, right);
    }

    function defenderCreatesFourFiveOrBlackOverline(state, idx, defender) {
      for (let direction = 0; direction < 4; direction++) {
        const lineType = testLineFour(idx, direction, defender, state.board) & GEN_LINE_MASK;
        if (
          lineType === GEN_FOUR_NOFREE ||
          lineType === GEN_FOUR_FREE ||
          lineType === GEN_FIVE ||
          lineType === GEN_LINE_DOUBLE_FOUR
        ) {
          return true;
        }
        // Black foul filtering is intentionally limited to overline only.
        // Double-three and double-four are not rejected as fouls here.
        if (defender === GEN_BLACK && lineType === LINE_OVERLINE) return true;
      }
      return false;
    }

    function isIllegalDefenderPoint(state, idx, targetDefensePoints) {
      const defender = state.defender || genOther(state.attacker);
      if (idx < 0 || idx >= 225 || state.board[idx] !== GEN_EMPTY) return true;
      if (targetDefensePoints.has(idx)) return true;
      if (genIsNFor(state.nMask, idx, defender)) return true;
      return defenderCreatesFourFiveOrBlackOverline(state, idx, defender);
    }

    async function findGroups(state, expectedSteps, blockOtherVCF) {
      const options = blockOtherVCF
        ? {
            mode: "multi",
            simplify: true,
            pruning: genSelectedPruning(),
            maxDepth: MAX_DEPTH,
            maxNode: DEFAULT_MAX_NODE,
          }
        : {
            mode: "multi",
            simplify: true,
            pruning: "strict",
            maxDepth: genTargetSearchPly(expectedSteps),
            maxNode: DEFAULT_MAX_NODE,
          };

      const info = await genEngine.findVCF(state.board, state.attacker, MAX_GROUPS, options);
      if (genCancelled || !info?.winMoves?.length) return null;
      const raw = info.winMoves.filter(moves => moves?.length);
      if (!raw.length) return null;
      const groups = await genEngine.trimGroups(state.board, raw, state.attacker);
      if (genCancelled || !groups?.length) return null;
      return { info, groups };
    }

    function analyzeGroups(state, groups, expectedBoard, expectedSteps, blockOtherVCF) {
      const analyzed = [];
      for (const moves of groups) {
        const analysis = genAnalyzeVCFGroup(state.board, moves, state.attacker);
        if (!analysis?.valid) continue;
        analyzed.push({ moves: Array.from(moves), analysis });
      }

      const exactTargets = analyzed.filter(item =>
        item.analysis.steps === expectedSteps &&
        isSameBoard(item.analysis.standardBoard, expectedBoard)
      );
      const unwanted = analyzed.filter(item =>
        item.analysis.steps < expectedSteps ||
        (blockOtherVCF && !isSameBoard(item.analysis.standardBoard, expectedBoard))
      );
      return { analyzed, exactTargets, unwanted };
    }

    async function collectDefenseSets(state, routes) {
      return Promise.all(routes.map(async item => {
        const points = await genEngine.getBlockVCF(
          state.board,
          state.attacker,
          item.moves,
          true,
        );
        return Array.from(new Set(points));
      }));
    }

    async function rankDefensePoints(state, unwanted, exactTargets) {
      // First enumerate every target VCF defense point, not only one target route.
      const targetDefenseSets = await collectDefenseSets(state, exactTargets);
      if (genCancelled) return null;
      const targetDefensePoints = new Set(targetDefenseSets.flat());

      // Then enumerate the complete defense-point set for every unwanted VCF.
      const unwantedDefenseSets = await collectDefenseSets(state, unwanted);
      if (genCancelled) return null;

      const frequency = new Map();
      for (let routeIndex = 0; routeIndex < unwantedDefenseSets.length; routeIndex++) {
        const legalPoints = unwantedDefenseSets[routeIndex]
          .filter(idx => !isIllegalDefenderPoint(state, idx, targetDefensePoints));

        // If one unwanted VCF has no legal remaining defense point, this branch cannot work.
        if (!legalPoints.length) return null;
        for (const idx of legalPoints) {
          let entry = frequency.get(idx);
          if (!entry) {
            entry = { idx, count: 0, routes: [] };
            frequency.set(idx, entry);
          }
          entry.count++;
          entry.routes.push(routeIndex);
        }
      }

      // Always try the point covering the most unwanted VCFs first.
      // Use board index only as a deterministic tie-breaker; never randomize equal counts.
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
      if (idx < 0 || idx >= 225 || next.board[idx] !== GEN_EMPTY) return null;
      if (expectedBoard[idx] !== GEN_EMPTY) return null;
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

      if (!unwanted.length) {
        const result = genFinalizeValidatedResult(
          candidate,
          exactTargets[0],
          found.info,
          found.groups,
          previousResult,
        );
        return policy.blockOtherVCF
          ? { ...result, uniqueVCFVerified: true }
          : result;
      }

      if (!policy.blockOtherVCF && defenderAllowance(candidate.board, candidate.attacker) <= 0) {
        return null;
      }

      const ranked = await rankDefensePoints(candidate, unwanted, exactTargets);
      if (!ranked?.length) return null;

      // Ranked already contains the complete legal union. Try in coverage order until
      // a branch succeeds or the shared state budget is exhausted.
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
        };
      }

      const ranked = await rankDefensePoints(state, unwanted, exactTargets);
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

    genValidateCandidate = async function validateCandidateWithCompleteDefenseUnion(
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

    genValidateExtensionCandidate = async function validateExtensionWithCompleteDefenseUnion(
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

    genExtendToTarget = async function extendWithCompleteDefenseUnion(
      current,
      targetSteps,
      attacker,
      rules,
      options,
      counters,
    ) {
      if (!options?.blockOtherVCF) {
        return previousExtendToTarget(current, targetSteps, attacker, rules, options, counters);
      }

      // Build layers through the previous stack without invoking the older final
      // non-target blocker. The validators above still enforce the new policy.
      let result = await previousExtendToTarget(
        current,
        targetSteps,
        attacker,
        rules,
        { ...options, blockOtherVCF: false, balanceStones: false },
        counters,
      );
      if (!result || result.steps !== targetSteps) return result;

      genSetStatus(`正在統計完整防點聯集並封鎖其他 VCF……已驗證 ${counters.attempts} 個候選`);
      result = await cleanFinalTargetBoard(
        result,
        result.standardBoard,
        targetSteps,
        { nodes: 0 },
      );
      if (!result || !options.balanceStones) return result;

      for (let round = 0; round < BALANCE_UNIQUE_ROUND_LIMIT; round++) {
        const beforeBalanceBoard = genCloneBoard(result.board);
        result = await previousExtendToTarget(
          { ...result, balanceComplete: false },
          targetSteps,
          attacker,
          rules,
          { ...options, blockOtherVCF: false, balanceStones: true },
          counters,
        );
        if (!result) return null;

        const afterBalanceBoard = genCloneBoard(result.board);
        const uniqueBlockCount = (result.uniqueBlockDefenders || []).length;
        const cleaned = await cleanFinalTargetBoard(
          result,
          result.standardBoard,
          targetSteps,
          { nodes: 0 },
        );
        if (!cleaned) return null;

        const addedUniqueDefense =
          (cleaned.uniqueBlockDefenders || []).length > uniqueBlockCount;
        result = cleaned;
        if (!addedUniqueDefense && genBoardsEqual(beforeBalanceBoard, afterBalanceBoard)) {
          return { ...result, balanceComplete: true };
        }
        if (!addedUniqueDefense) return { ...result, balanceComplete: true };
      }
      return null;
    };
  }

  installGeneratorDefensePointPolicy();
})();
