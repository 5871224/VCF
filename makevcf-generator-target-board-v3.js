"use strict";

// Final target-board uniqueness policy.
// Install after all synchronous generator extensions and deferred legacy wrappers.
(function scheduleTargetBoardUniquePolicyV3() {
  setTimeout(() => setTimeout(() => setTimeout(() => setTimeout(() => {
    if (window.__generatorTargetBoardUniquePolicyV3Installed) return;
    window.__generatorTargetBoardUniquePolicyV3Installed = true;

    const SHAPE_MASK = 0x0f;
    const MAX_GROUPS = 64;
    const MAX_DEPTH = 200;
    const BRANCH_LIMIT = 8;
    const STATE_LIMIT = 96;
    const BALANCE_UNIQUE_ROUND_LIMIT = 8;
    const DEFAULT_TIME_SECONDS = 30;
    const DEFAULT_NODE_MILLIONS = 20;

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
      return genGetActiveOptions()?.uniqueSearchSettings || readManualSearchSettings();
    }

    genRegisterOptionProvider("target-board-search", options => ({
      ...options,
      uniqueSearchSettings: readManualSearchSettings(),
    }));

    genRegisterBusyHook("target-board-search", {
      after(value) {
        for (const id of ["vcf-multi-time-seconds", "vcf-multi-node-millions"]) {
          const input = document.getElementById(id);
          if (input) input.disabled = Boolean(value);
        }
      },
    });

    // Force every generator multi-route call, including old final-fill checks, to use the
    // generation-start snapshot of the manual pruning, time and node settings.
    genEngine.findVCF = async function generatorFindVCFWithManualMultiSettings(
      arr,
      color,
      maxVCF = MAX_GROUPS,
      options = {},
    ) {
      if (genBusy && genEl("block-other-vcf")?.checked && options?.mode === "multi") {
        const settings = currentSearchSettings();
        return previousFindVCF(arr, color, Math.min(MAX_GROUPS, Math.max(1, maxVCF)), {
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

    function isSameTargetBoard(analysis, expectedBoard) {
      return Boolean(analysis?.valid) && genBoardsEqual(analysis.standardBoard, expectedBoard);
    }

    async function findAllGroups(state) {
      const settings = currentSearchSettings();
      const info = await genEngine.findVCF(state.board, state.attacker, MAX_GROUPS, {
        mode: "multi",
        simplify: true,
        pruning: settings.pruning,
        maxDepth: MAX_DEPTH,
        maxNode: settings.maxNode,
      });
      if (genCancelled || !info?.winMoves?.length) return null;

      const raw = info.winMoves.filter(moves => moves?.length);
      if (!raw.length) return null;
      const groups = await genEngine.trimGroups(state.board, raw, state.attacker);
      if (genCancelled || !groups.length) return null;

      return {
        info,
        groups,
        incomplete: Boolean(info.aborted) ||
          raw.length >= MAX_GROUPS ||
          Number(info.vcfCount || 0) >= MAX_GROUPS,
      };
    }

    function analyzeAllGroups(state, groups, expectedBoard, expectedSteps) {
      const analyzed = [];
      for (const moves of groups) {
        const analysis = genAnalyzeVCFGroup(state.board, moves, state.attacker);
        if (!analysis.valid) continue;
        analyzed.push({ moves: Array.from(moves), analysis });
      }

      const targets = analyzed.filter(item => isSameTargetBoard(item.analysis, expectedBoard));
      const exactTargets = targets.filter(item => item.analysis.steps === expectedSteps);
      const unwanted = analyzed.filter(item => !isSameTargetBoard(item.analysis, expectedBoard));
      return { analyzed, targets, exactTargets, unwanted };
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

    function isIllegalDefenderPoint(state, idx, targetDefensePoints) {
      const defender = state.defender || genOther(state.attacker);
      if (idx < 0 || idx >= 225 || state.board[idx] !== GEN_EMPTY) return true;
      if (targetDefensePoints.has(idx)) return true;
      if (genIsNFor(state.nMask, idx, defender)) return true;

      const level = getLevelPoint(idx, defender, state.board) & SHAPE_MASK;
      if (level === GEN_FOUR_NOFREE || level === GEN_FOUR_FREE || level >= GEN_FIVE) return true;
      return state.rules === 2 && defender === GEN_BLACK && isFoul(idx, state.board);
    }

    async function collectTargetDefensePoints(state, target) {
      const points = await genEngine.getBlockVCF(
        state.board,
        state.attacker,
        target.moves,
        true,
      );
      return new Set(points);
    }

    async function rankUnwantedDefensePoints(state, unwanted, target) {
      const targetDefensePoints = await collectTargetDefensePoints(state, target);
      const frequency = new Map();

      for (const item of unwanted) {
        if (genCancelled) return null;
        const rawPoints = await genEngine.getBlockVCF(
          state.board,
          state.attacker,
          item.moves,
          true,
        );
        const legalPoints = Array.from(new Set(rawPoints))
          .filter(idx => !isIllegalDefenderPoint(state, idx, targetDefensePoints));

        // Any currently found non-target VCF without a remaining legal defense point makes this
        // dead-four candidate or this recursive fill branch impossible.
        if (!legalPoints.length) return null;
        for (const idx of legalPoints) {
          frequency.set(idx, (frequency.get(idx) || 0) + 1);
        }
      }

      return Array.from(frequency, ([idx, count]) => ({ idx, count }))
        .sort((left, right) => right.count - left.count || Math.random() - 0.5);
    }

    async function validateLayerTargetBoard(candidate, expectedSteps, previousResult, budget) {
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
      if (!targets.length || !exactTargets.length) return null;

      // A different move order or route length is still the same target VCF when the standard
      // completion board is identical. If the currently returned results have no other board,
      // accept even when the search stopped at the manual limit or filled all 64 result slots.
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

      // Use every non-target VCF found so far, place one highest-frequency defender, and run the
      // same manually configured multi search again. Repeat until current results contain only
      // the target completion board.
      const ranked = await rankUnwantedDefensePoints(candidate, unwanted, exactTargets[0]);
      if (!ranked?.length) return null;

      for (const { idx } of ranked.slice(0, BRANCH_LIMIT)) {
        if (genCancelled) return null;
        const next = addLayerDefender(candidate, idx);
        if (!next) continue;
        const result = await validateLayerTargetBoard(
          next,
          expectedSteps,
          previousResult,
          budget,
        );
        if (result) return result;
      }
      return null;
    }

    async function cleanFinalTargetBoard(state, expectedBoard, targetSteps, budget) {
      if (genCancelled || budget.nodes++ >= STATE_LIMIT) return null;
      const found = await findAllGroups(state);
      if (!found) return null;

      const { targets, exactTargets, unwanted } = analyzeAllGroups(
        state,
        found.groups,
        expectedBoard,
        targetSteps,
      );
      if (!targets.length || !exactTargets.length) return null;

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
          uniqueVCFSearchIncomplete: found.incomplete,
        };
      }

      const ranked = await rankUnwantedDefensePoints(state, unwanted, exactTargets[0]);
      if (!ranked?.length) return null;

      for (const { idx } of ranked.slice(0, BRANCH_LIMIT)) {
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

    genValidateCandidate = async function validateCandidateByTargetBoardV3(candidate, expectedSteps) {
      if (!genEl("block-other-vcf")?.checked) {
        return previousValidateCandidate(candidate, expectedSteps);
      }
      return validateLayerTargetBoard(cloneState(candidate), expectedSteps, null, { nodes: 0 });
    };

    genValidateExtensionCandidate = async function validateExtensionByTargetBoardV3(
      candidate,
      previousResult,
      targetSteps,
    ) {
      if (!genEl("block-other-vcf")?.checked) {
        return previousValidateExtensionCandidate(candidate, previousResult, targetSteps);
      }
      if (targetSteps !== previousResult.steps + 1) return null;
      return validateLayerTargetBoard(
        cloneState(candidate),
        targetSteps,
        previousResult,
        { nodes: 0 },
      );
    };

    function sameBoard(a, b) {
      return genBoardsEqual(a, b);
    }

    genExtendToTarget = async function extendBalanceAndCleanTargetBoardV3(
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

      // The v3 layer validators already enforce target-board uniqueness. Disable legacy unique
      // and balance final checks while constructing the target so old incomplete-search rules do
      // not reject it before the v3 current-result policy can run.
      let result = await previousExtendToTarget(
        current,
        targetSteps,
        attacker,
        rules,
        { ...options, blockOtherVCF: false, balanceStones: false },
        counters,
      );
      if (!result || result.steps !== targetSteps) return result;

      genSetStatus(`正在依人工多組設定封鎖其他完成盤面……已驗證 ${counters.attempts} 個候選`);
      result = await cleanFinalTargetBoard(
        result,
        result.standardBoard,
        targetSteps,
        { nodes: 0 },
      );
      if (!result || !options.balanceStones) return result;

      // Unique blocking can add defender stones; balancing can in turn add stones that alter the
      // available VCFs. Alternate the two operations until balancing adds no new non-target board.
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

        const addedUniqueDefense = (cleaned.uniqueBlockDefenders || []).length > uniqueBlockCount;
        result = cleaned;
        if (!addedUniqueDefense && sameBoard(beforeBalanceBoard, afterBalanceBoard)) {
          return { ...result, balanceComplete: true };
        }
        if (!addedUniqueDefense) return { ...result, balanceComplete: true };
      }
      return null;
    };

    const uniqueInput = genEl("block-other-vcf");
    const uniqueLabel = uniqueInput?.closest("label");
    if (uniqueLabel) {
      uniqueLabel.title = "依人工設定的多組剪枝、時間與節點限制搜尋所有長短路線；完成盤面相同視為同一目標 VCF，其餘路線依防點統計逐顆補守。搜尋中止或滿 64 組時，仍以目前已找到的其他 VCF 補守並重搜；目前結果沒有其他完成盤面即可接受";
    }
  }, 0), 0), 0), 0);
})();
