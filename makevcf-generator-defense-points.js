"use strict";

// Mid-layer shorter/non-target VCF blocking is progressive:
// find the first unwanted route, subtract the currently found target-route
// defense points, add one defender immediately, then re-search the new board.
// The final board still uses the complete 64-route defense union and coverage
// ranking so final uniqueness is not weakened by the faster mid-layer policy.
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

    const FINAL_MAX_GROUPS = 64;
    const MID_GROUP_LIMITS = [2, 4, 8, 16];
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

    async function findShortestAnalyzed(state, expectedSteps) {
      const info = await genEngine.findVCF(state.board, state.attacker, 1, {
        mode: "shortest",
        simplify: true,
        pruning: "strict",
        maxDepth: genTargetSearchPly(expectedSteps),
        maxNode: DEFAULT_MAX_NODE,
      });
      if (genCancelled) return null;
      const moves = Array.from(info?.winMoves?.[0] || []);
      if (!moves.length) return { info, item: null };
      const analysis = genAnalyzeVCFGroup(state.board, moves, state.attacker);
      return {
        info,
        item: analysis?.valid ? { moves, analysis } : null,
      };
    }

    async function findProgressiveCandidate(
      state,
      expectedBoard,
      expectedSteps,
      blockOtherVCF,
    ) {
      // First ask the dedicated shortest-one search. If it exposes a shorter
      // route, that route is handled as soon as one target route is available.
      const shortest = await findShortestAnalyzed(state, expectedSteps);
      if (genCancelled || !shortest) return null;

      let firstUnwanted = null;
      if (shortest.item) {
        if (shortest.item.analysis.steps < expectedSteps) {
          firstUnwanted = shortest.item;
        } else if (
          blockOtherVCF &&
          !isSameBoard(shortest.item.analysis.standardBoard, expectedBoard)
        ) {
          firstUnwanted = shortest.item;
        }
      }

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

      let lastFound = null;
      for (const limit of MID_GROUP_LIMITS) {
        const info = await genEngine.findVCF(state.board, state.attacker, limit, options);
        if (genCancelled || !info?.winMoves?.length) return null;
        const raw = info.winMoves.filter(moves => moves?.length);
        if (!raw.length) return null;
        const groups = await genEngine.trimGroups(state.board, raw, state.attacker);
        if (genCancelled || !groups?.length) return null;

        const analyzed = analyzeGroups(
          state,
          groups,
          expectedBoard,
          expectedSteps,
          blockOtherVCF,
        );
        if (!analyzed.exactTargets.length) continue;

        const unwanted = firstUnwanted
          ? [firstUnwanted]
          : analyzed.unwanted.slice(0, 1);
        const routeCount = Number(info.vcfCount ?? raw.length);
        const exhausted = !info.aborted && routeCount < limit;
        lastFound = {
          info,
          groups,
          exactTargets: analyzed.exactTargets,
          unwanted,
          complete: exhausted,
        };

        // Once one unwanted route is found, return immediately. Do not keep
        // enumerating routes just to build a complete coverage union.
        if (unwanted.length || exhausted) return lastFound;
      }

      // Mid-layer search is deliberately capped. A clean result at this point
      // is provisional; final 64-route cleanup still performs the full check.
      return lastFound;
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

    async function immediateDefensePoints(state, unwanted, exactTargets) {
      const targetDefenseSets = await collectDefenseSets(state, exactTargets);
      if (genCancelled) return null;
      const targetDefensePoints = new Set(targetDefenseSets.flat());

      const unwantedPoints = await genEngine.getBlockVCF(
        state.board,
        state.attacker,
        unwanted.moves,
        true,
      );
      if (genCancelled) return null;

      const seen = new Set();
      const legal = [];
      for (const idx of unwantedPoints) {
        if (seen.has(idx)) continue;
        seen.add(idx);
        if (isIllegalDefenderPoint(state, idx, targetDefensePoints)) continue;
        legal.push(idx);
      }
      return legal;
    }

    // Final-only complete union. At the final board, enumerate every currently
    // returned target/unwanted route and rank points by route coverage.
    async function rankDefensePoints(state, unwanted, exactTargets) {
      const targetDefenseSets = await collectDefenseSets(state, exactTargets);
      if (genCancelled) return null;
      const targetDefensePoints = new Set(targetDefenseSets.flat());

      const unwantedDefenseSets = await collectDefenseSets(state, unwanted);
      if (genCancelled) return null;

      const frequency = new Map();
      for (let routeIndex = 0; routeIndex < unwantedDefenseSets.length; routeIndex++) {
        const legalPoints = unwantedDefenseSets[routeIndex]
          .filter(idx => !isIllegalDefenderPoint(state, idx, targetDefensePoints));

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

      return Array.from(frequency.values())
        .sort((left, right) => right.count - left.count || left.idx - right.idx);
    }

    async function findCompleteGroups(state, expectedSteps, blockOtherVCF) {
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

      const info = await genEngine.findVCF(
        state.board,
        state.attacker,
        FINAL_MAX_GROUPS,
        options,
      );
      if (genCancelled || !info?.winMoves?.length) return null;
      const raw = info.winMoves.filter(moves => moves?.length);
      if (!raw.length) return null;
      const groups = await genEngine.trimGroups(state.board, raw, state.attacker);
      if (genCancelled || !groups?.length) return null;
      return {
        info,
        groups,
        incomplete: Boolean(info.aborted) ||
          raw.length >= FINAL_MAX_GROUPS ||
          Number(info.vcfCount || 0) >= FINAL_MAX_GROUPS,
      };
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

    async function validateWithImmediateDefense(
      candidate,
      expectedSteps,
      previousResult,
      policy,
      budget,
    ) {
      if (genCancelled || budget.nodes++ >= STATE_LIMIT) return null;
      const expectedBoard = expectedBoardFor(candidate, previousResult);
      if (!expectedBoard) return null;

      const found = await findProgressiveCandidate(
        candidate,
        expectedBoard,
        expectedSteps,
        policy.blockOtherVCF,
      );
      if (!found?.exactTargets?.length) return null;

      if (!found.unwanted.length) {
        const result = genFinalizeValidatedResult(
          candidate,
          found.exactTargets[0],
          found.info,
          found.groups,
          previousResult,
        );
        return policy.blockOtherVCF && found.complete
          ? { ...result, uniqueVCFVerified: true }
          : result;
      }

      const points = await immediateDefensePoints(
        candidate,
        found.unwanted[0],
        found.exactTargets,
      );
      if (!points?.length) return null;

      // Try one route's legal defense points immediately. Every successful add
      // re-enters this function and re-searches the entire changed position.
      for (const idx of points) {
        if (genCancelled) return null;
        const next = addLayerDefender(candidate, idx);
        if (!next) continue;
        const result = await validateWithImmediateDefense(
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
      const found = await findCompleteGroups(state, targetSteps, true);
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
        if (found.incomplete) return null;
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

    genValidateCandidate = async function validateCandidateWithImmediateDefense(
      candidate,
      expectedSteps,
    ) {
      const blockOtherVCF = Boolean(genEl("block-other-vcf")?.checked);
      const balanceStones = Boolean(genEl("balance-stones")?.checked);
      if (!blockOtherVCF && !balanceStones) {
        return previousValidateCandidate(candidate, expectedSteps);
      }
      return validateWithImmediateDefense(
        cloneState(candidate),
        expectedSteps,
        null,
        { blockOtherVCF, balanceStones },
        { nodes: 0 },
      );
    };

    genValidateExtensionCandidate = async function validateExtensionWithImmediateDefense(
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
      return validateWithImmediateDefense(
        cloneState(candidate),
        targetSteps,
        previousResult,
        { blockOtherVCF, balanceStones },
        { nodes: 0 },
      );
    };

    genExtendToTarget = async function extendWithProgressiveDefense(
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
      // non-target blocker. The validators above still enforce progressive blocking.
      let result = await previousExtendToTarget(
        current,
        targetSteps,
        attacker,
        rules,
        { ...options, blockOtherVCF: false, balanceStones: false },
        counters,
      );
      if (!result || result.steps !== targetSteps) return result;

      genSetStatus(`正在完整驗證並封鎖其他 VCF……已驗證 ${counters.attempts} 個候選`);
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
