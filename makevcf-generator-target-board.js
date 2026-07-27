"use strict";

// Target-board uniqueness policy v2.
// This script is loaded early but installs after every synchronous generator extension and
// the older deferred policies have finished, so it becomes the final validation policy.
(function scheduleTargetBoardUniquePolicyV2() {
  setTimeout(() => setTimeout(() => setTimeout(() => {
    if (window.__generatorTargetBoardUniquePolicyV2Installed) return;
    window.__generatorTargetBoardUniquePolicyV2Installed = true;

    const SHAPE_MASK = 0x0f;
    const MAX_GROUPS = 64;
    const MAX_DEPTH = 200;
    const BRANCH_LIMIT = 8;
    const STATE_LIMIT = 96;
    const DEFAULT_TIME_SECONDS = 30;
    const DEFAULT_NODE_MILLIONS = 20;

    let activeSearchSettings = null;

    const previousOptions = genOptions;
    const previousSetBusy = genSetBusy;
    const previousFindVCF = genEngine.findVCF.bind(genEngine);
    const previousValidateCandidate = genValidateCandidate;
    const previousValidateExtensionCandidate = genValidateExtensionCandidate;
    const previousExtendToTarget = genExtendToTarget;

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

    function readManualSearchSettings() {
      const timeSeconds = readLimitInput(
        "vcf-multi-time-seconds",
        "vcf_multi_time_seconds",
        2097151,
        DEFAULT_TIME_SECONDS,
      );
      const nodeMillions = readLimitInput(
        "vcf-multi-node-millions",
        "vcf_multi_node_millions",
        1023,
        DEFAULT_NODE_MILLIONS,
      );
      const pruning = genSelectedPruning();
      const maxNode = (0x80000000 + timeSeconds * 1024 + nodeMillions) >>> 0;
      return { timeSeconds, nodeMillions, pruning, maxNode };
    }

    function currentSearchSettings() {
      return activeSearchSettings || readManualSearchSettings();
    }

    genOptions = function generatorOptionsWithUniqueSearchSettings() {
      const options = previousOptions();
      activeSearchSettings = readManualSearchSettings();
      return {
        ...options,
        uniqueSearchSettings: { ...activeSearchSettings },
      };
    };

    genSetBusy = function generatorSetBusyWithUniqueSearchSettings(value) {
      previousSetBusy(value);
      for (const id of ["vcf-multi-time-seconds", "vcf-multi-node-millions"]) {
        const input = document.getElementById(id);
        if (input) input.disabled = Boolean(value);
      }
    };

    // Older generator extensions also perform multi-route checks, especially after the final
    // black/white balance fill. Force every generator multi search to use the same manual
    // pruning, time and node settings and to inspect all route lengths up to the engine maximum.
    genEngine.findVCF = async function generatorFindVCFWithManualUniqueSettings(
      arr,
      color,
      maxVCF = MAX_GROUPS,
      options = {},
    ) {
      if (genBusy && genEl("block-other-vcf")?.checked && options?.mode === "multi") {
        const settings = currentSearchSettings();
        return previousFindVCF(arr, color, Math.min(MAX_GROUPS, maxVCF), {
          ...options,
          mode: "multi",
          simplify: true,
          pruning: settings.pruning,
          maxDepth: MAX_DEPTH,
          maxNode: settings.maxNode,
        });
      }
      return previousFindVCF(arr, color, maxVCF, options);
    };

    function cloneCandidate(candidate) {
      return {
        ...candidate,
        board: genCloneBoard(candidate.board),
        nMask: candidate.nMask?.slice() || new Uint8Array(225),
        addedAttackers: Array.from(candidate.addedAttackers || []),
        reusedAttackers: Array.from(candidate.reusedAttackers || []),
        removedDefenders: Array.from(candidate.removedDefenders || []),
        addedDefenders: Array.from(candidate.addedDefenders || []),
        autoBlockDefenders: Array.from(candidate.autoBlockDefenders || []),
        xPoints: Array.from(candidate.xPoints || []),
        lineFivePoints: Array.from(candidate.lineFivePoints || []),
      };
    }

    function expectedBoardFor(candidate, previousResult) {
      return previousResult
        ? genBuildExpectedExtendedBoard(previousResult, candidate)
        : genBuildExpectedBaseBoard(candidate);
    }

    function isSameTargetBoard(analysis, expectedBoard) {
      return Boolean(analysis?.valid) && genBoardsEqual(analysis.standardBoard, expectedBoard);
    }

    async function findAllGroups(candidate) {
      const settings = currentSearchSettings();
      const info = await genEngine.findVCF(candidate.board, candidate.attacker, MAX_GROUPS, {
        mode: "multi",
        simplify: true,
        pruning: settings.pruning,
        maxDepth: MAX_DEPTH,
        maxNode: settings.maxNode,
      });
      if (genCancelled || !info?.winMoves?.length) return null;

      const raw = info.winMoves.filter(moves => moves?.length);
      if (!raw.length) return null;
      const groups = await genEngine.trimGroups(candidate.board, raw, candidate.attacker);
      if (genCancelled || !groups.length) return null;

      return {
        info,
        groups,
        incomplete: Boolean(info.aborted) ||
          raw.length >= MAX_GROUPS ||
          Number(info.vcfCount || 0) >= MAX_GROUPS,
      };
    }

    function analyzeAllGroups(candidate, groups, expectedBoard, expectedSteps) {
      const analyzed = [];
      for (const moves of groups) {
        const analysis = genAnalyzeVCFGroup(candidate.board, moves, candidate.attacker);
        if (!analysis.valid) continue;
        analyzed.push({ moves: Array.from(moves), analysis });
      }

      const targets = analyzed.filter(item => isSameTargetBoard(item.analysis, expectedBoard));
      const exactTargets = targets.filter(item => item.analysis.steps === expectedSteps);
      const unwanted = analyzed.filter(item => !isSameTargetBoard(item.analysis, expectedBoard));
      return { analyzed, targets, exactTargets, unwanted };
    }

    function addDefender(candidate, idx) {
      const next = cloneCandidate(candidate);
      next.defender = next.defender || genOther(next.attacker);
      if (idx < 0 || idx >= 225 || next.board[idx] !== GEN_EMPTY) return null;
      next.board[idx] = next.defender;
      if (!next.addedDefenders.includes(idx)) next.addedDefenders.push(idx);
      if (!next.autoBlockDefenders.includes(idx)) next.autoBlockDefenders.push(idx);
      return next;
    }

    function isIllegalDefenderPoint(candidate, idx, targetDefensePoints) {
      const defender = candidate.defender || genOther(candidate.attacker);
      if (idx < 0 || idx >= 225 || candidate.board[idx] !== GEN_EMPTY) return true;
      if (targetDefensePoints.has(idx)) return true;
      if (genIsNFor(candidate.nMask, idx, defender)) return true;

      const level = getLevelPoint(idx, defender, candidate.board) & SHAPE_MASK;
      if (level === GEN_FOUR_NOFREE || level === GEN_FOUR_FREE || level >= GEN_FIVE) return true;
      return candidate.rules === 2 && defender === GEN_BLACK && isFoul(idx, candidate.board);
    }

    async function collectTargetDefensePoints(candidate, target) {
      const points = await genEngine.getBlockVCF(
        candidate.board,
        candidate.attacker,
        target.moves,
        true,
      );
      return new Set(points);
    }

    async function rankUnwantedDefensePoints(candidate, unwanted, target) {
      const targetDefensePoints = await collectTargetDefensePoints(candidate, target);
      const frequency = new Map();

      for (const item of unwanted) {
        if (genCancelled) return null;
        const rawPoints = await genEngine.getBlockVCF(
          candidate.board,
          candidate.attacker,
          item.moves,
          true,
        );
        const legalPoints = Array.from(new Set(rawPoints))
          .filter(idx => !isIllegalDefenderPoint(candidate, idx, targetDefensePoints));

        // If one discovered non-target VCF has no defense point left after subtracting the
        // target route's defense points, this dead-four candidate or fill branch cannot work.
        if (!legalPoints.length) return null;
        for (const idx of legalPoints) {
          frequency.set(idx, (frequency.get(idx) || 0) + 1);
        }
      }

      return Array.from(frequency, ([idx, count]) => ({ idx, count }))
        .sort((left, right) => right.count - left.count || Math.random() - 0.5);
    }

    async function validateTargetBoardUnique(candidate, expectedSteps, previousResult, budget) {
      if (genCancelled || budget.nodes++ >= STATE_LIMIT) return null;

      const expectedBoard = expectedBoardFor(candidate, previousResult);
      if (!expectedBoard) return null;
      const found = await findAllGroups(candidate);
      if (!found) return null;

      const { targets, exactTargets, unwanted } = analyzeAllGroups(
        candidate,
        found.groups,
        expectedBoard,
        expectedSteps,
      );

      // Route order and route length do not define uniqueness. Any route that reaches the same
      // standard completion board belongs to the target VCF. The requested exact-step route must
      // still exist so this newly generated dead-four layer is valid.
      if (!targets.length || !exactTargets.length) return null;

      // Even when the multi search stopped by the manual time/node limit or returned all 64
      // slots, accept the current position once the currently found results contain no other
      // completion board. This is intentionally a current-result acceptance, not a proof that
      // no undiscovered route exists.
      if (!unwanted.length) {
        const result = genFinalizeValidatedResult(
          candidate,
          exactTargets[0],
          found.info,
          found.groups,
          previousResult,
        );
        return {
          ...result,
          uniqueVCFVerified: true,
          uniqueVCFSearchIncomplete: found.incomplete,
        };
      }

      // Whether the search completed or stopped at a limit, use all currently discovered
      // non-target VCFs to choose one defender stone, then run the same multi search again.
      const ranked = await rankUnwantedDefensePoints(
        candidate,
        unwanted,
        exactTargets[0],
      );
      if (!ranked?.length) return null;

      for (const { idx } of ranked.slice(0, BRANCH_LIMIT)) {
        if (genCancelled) return null;
        const next = addDefender(candidate, idx);
        if (!next) continue;
        const result = await validateTargetBoardUnique(
          next,
          expectedSteps,
          previousResult,
          budget,
        );
        if (result) return result;
      }
      return null;
    }

    genValidateCandidate = async function validateCandidateByTargetBoardV2(candidate, expectedSteps) {
      if (!genEl("block-other-vcf")?.checked) {
        return previousValidateCandidate(candidate, expectedSteps);
      }
      return validateTargetBoardUnique(cloneCandidate(candidate), expectedSteps, null, { nodes: 0 });
    };

    genValidateExtensionCandidate = async function validateExtensionByTargetBoardV2(
      candidate,
      previousResult,
      targetSteps,
    ) {
      if (!genEl("block-other-vcf")?.checked) {
        return previousValidateExtensionCandidate(candidate, previousResult, targetSteps);
      }
      if (targetSteps !== previousResult.steps + 1) return null;
      return validateTargetBoardUnique(
        cloneCandidate(candidate),
        targetSteps,
        previousResult,
        { nodes: 0 },
      );
    };

    async function verifyFinalCurrentResults(result, targetSteps) {
      const found = await findAllGroups(result);
      if (!found) return null;
      const { targets, exactTargets, unwanted } = analyzeAllGroups(
        result,
        found.groups,
        result.standardBoard,
        targetSteps,
      );
      if (!targets.length || !exactTargets.length || unwanted.length) return null;
      return {
        ...result,
        moves: exactTargets[0].moves,
        completedBoard: exactTargets[0].analysis.completedBoard,
        standardBoard: exactTargets[0].analysis.standardBoard,
        nMask: genApplyRouteNPoints(result, exactTargets[0].moves),
        nodeCount: found.info.nodeCount || 0,
        groupCount: found.groups.length,
        uniqueVCFVerified: true,
        uniqueVCFSearchIncomplete: found.incomplete,
      };
    }

    genExtendToTarget = async function extendWithTargetBoardFinalCheckV2(
      current,
      targetSteps,
      attacker,
      rules,
      options,
      counters,
    ) {
      const result = await previousExtendToTarget(
        current,
        targetSteps,
        attacker,
        rules,
        options,
        counters,
      );
      if (!result || !options?.blockOtherVCF || result.steps !== targetSteps) return result;

      genSetStatus(`正在依人工多組設定確認只保留目標 VCF……已驗證 ${counters.attempts} 個候選`);
      return verifyFinalCurrentResults(result, targetSteps);
    };

    const uniqueInput = genEl("block-other-vcf");
    const uniqueLabel = uniqueInput?.closest("label");
    if (uniqueLabel) {
      uniqueLabel.title = "依人工設定的多組剪枝、時間與節點限制搜尋所有長短路線；完成盤面相同視為同一目標 VCF，其餘路線依防點統計逐顆補守。搜尋達限制時，以目前已找到的路線重新補守驗證；目前結果不再出現其他完成盤面即可接受";
    }
  }, 0), 0), 0);
})();
