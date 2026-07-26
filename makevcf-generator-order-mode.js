"use strict";

// Allow candidate validation to use either weighted-random order or strict bonus order.
(function initGeneratorOrderMode() {
  if (window.__generatorOrderModeLoaded) return;
  window.__generatorOrderModeLoaded = true;

  let orderByBonus = false;

  function addOrderControl() {
    const referenceInput = genEl("bonus-center") || genEl("bonus-reuse");
    const controls = referenceInput && (referenceInput.closest(".gen-controls") || referenceInput.closest(".controls"));
    if (!controls || genEl("order-by-bonus")) return;

    const integrated = referenceInput.id.startsWith("gen-");
    const label = document.createElement("label");
    label.title = "未勾選時依候選權重隨機排序；勾選後依總加成權重由高到低逐一驗證，同權重隨機排列";
    label.innerHTML = `<input id="${integrated ? "gen-order-by-bonus" : "order-by-bonus"}" type="checkbox"> 依加成高低排序`;
    referenceInput.closest("label")?.insertAdjacentElement("afterend", label);
  }

  addOrderControl();

  // 此檔在抓禁擴充前載入，先保存原本的一般題型產生流程。
  // 所有同步腳本載入完成後，抓禁擴充已覆寫 genFindTwoStep；此時再包成混合模式。
  const normalFindTwoStep = genFindTwoStep;
  setTimeout(() => {
    if (window.__generatorWhiteModeMixInstalled) return;
    const forbiddenFindTwoStep = genFindTwoStep;
    if (typeof forbiddenFindTwoStep !== "function" || forbiddenFindTwoStep === normalFindTwoStep) return;

    window.__generatorWhiteModeMixInstalled = true;
    genFindTwoStep = async function generatorFindWhiteSeedWithMixedModes(
      attacker,
      rules,
      options,
      counters,
      targetSteps,
    ) {
      if (rules === 2 && attacker === GEN_WHITE && genRand(2) === 0) {
        return normalFindTwoStep(attacker, rules, options, counters, targetSteps);
      }
      return forbiddenFindTwoStep(attacker, rules, options, counters, targetSteps);
    };
  }, 0);

  const originalOptions = genOptions;
  genOptions = function generatorOptionsWithOrderMode() {
    const options = originalOptions();
    orderByBonus = Boolean(genEl("order-by-bonus")?.checked);
    return {
      ...options,
      orderByBonus,
    };
  };

  const originalWeightedOrder = genWeightedOrder;
  genWeightedOrder = function generatorCandidateOrder(items) {
    if (!orderByBonus) return originalWeightedOrder(items);

    return Array.from(items || [])
      .map(item => ({
        item,
        weight: Math.max(0.0001, Number(item?.weight) || 1),
        tie: Math.random(),
      }))
      .sort((left, right) => right.weight - left.weight || left.tie - right.tie)
      .map(entry => entry.item);
  };

  const originalSetBusy = genSetBusy;
  genSetBusy = function generatorSetBusyWithOrderMode(value) {
    originalSetBusy(value);
    const input = genEl("order-by-bonus");
    if (input) input.disabled = value;
  };

  // balance / unique / summary 都在本檔之後同步載入；等它們完成後，統一套用最新補子政策。
  setTimeout(() => {
    if (window.__generatorFlexibleFillPolicyInstalled) return;
    window.__generatorFlexibleFillPolicyInstalled = true;

    const SHAPE_MASK = 0x0f;
    const AUTO_BLOCK_BRANCH_LIMIT = 8;
    const AUTO_BLOCK_NODE_LIMIT = 96;
    const UNIQUE_GROUP_LIMIT = 64;
    const UNIQUE_NODE_LIMIT = 5000000;
    const FILL_BRANCH_LIMIT = 10;

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

    function isTargetAnalysis(analysis, expectedSteps, expectedBoard) {
      return analysis.steps === expectedSteps && genBoardsEqual(analysis.standardBoard, expectedBoard);
    }

    function analyzeGroups(candidate, groups, expectedSteps, expectedBoard) {
      const analyzed = [];
      for (const moves of groups) {
        const analysis = genAnalyzeVCFGroup(candidate.board, moves, candidate.attacker);
        if (!analysis.valid) continue;
        analyzed.push({ moves: Array.from(moves), analysis });
      }
      return {
        analyzed,
        shorter: analyzed.filter(item => item.analysis.steps < expectedSteps),
        targets: analyzed.filter(item => isTargetAnalysis(item.analysis, expectedSteps, expectedBoard)),
      };
    }

    async function findMultiGroups(candidate, expectedSteps) {
      const targetSteps = genResolveValidationSteps(candidate, expectedSteps);
      if (!targetSteps) return null;
      const info = await genEngine.findVCF(candidate.board, candidate.attacker, UNIQUE_GROUP_LIMIT, {
        mode: "multi",
        simplify: true,
        pruning: "strict",
        maxDepth: genTargetSearchPly(targetSteps),
        maxNode: UNIQUE_NODE_LIMIT,
      });
      if (genCancelled || !info?.winMoves?.length) return null;
      const raw = info.winMoves.filter(moves => moves?.length);
      if (!raw.length) return null;
      const groups = await genEngine.trimGroups(candidate.board, raw, candidate.attacker);
      if (genCancelled || !groups.length) return null;
      return {
        info,
        groups,
        saturated: Boolean(info.aborted) ||
          raw.length >= UNIQUE_GROUP_LIMIT ||
          Number(info.nodeCount || 0) >= UNIQUE_NODE_LIMIT,
      };
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

    function isIllegalDefenderPoint(candidate, idx, protectedPoints) {
      const defender = candidate.defender || genOther(candidate.attacker);
      if (idx < 0 || idx >= 225 || candidate.board[idx] !== GEN_EMPTY) return true;
      if (protectedPoints.has(idx)) return true;
      if (genIsNFor(candidate.nMask, idx, defender)) return true;
      const level = getLevelPoint(idx, defender, candidate.board) & SHAPE_MASK;
      if (level === GEN_FOUR_NOFREE || level === GEN_FOUR_FREE || level >= GEN_FIVE) return true;
      return candidate.rules === 2 && defender === GEN_BLACK && isFoul(idx, candidate.board);
    }

    async function rankDefensePoints(candidate, unwanted, targetMoves) {
      const protectedPoints = new Set();
      if (targetMoves?.length) {
        for (const idx of await genEngine.getBlockVCF(
          candidate.board,
          candidate.attacker,
          targetMoves,
          true,
        )) {
          protectedPoints.add(idx);
        }
      }

      const frequency = new Map();
      for (const item of unwanted) {
        if (genCancelled) return [];
        const points = await genEngine.getBlockVCF(
          candidate.board,
          candidate.attacker,
          item.moves,
          true,
        );
        for (const idx of new Set(points)) {
          if (isIllegalDefenderPoint(candidate, idx, protectedPoints)) continue;
          frequency.set(idx, (frequency.get(idx) || 0) + 1);
        }
      }
      return Array.from(frequency, ([idx, count]) => ({ idx, count }))
        .sort((left, right) => right.count - left.count || Math.random() - 0.5);
    }

    async function validateDirect(candidate, expectedSteps, previousResult) {
      const expectedBoard = expectedBoardFor(candidate, previousResult);
      if (!expectedBoard) return null;
      const found = await genFindAnalyzedGroups(candidate, expectedSteps);
      if (!found) return null;
      const { shorter, targets } = analyzeGroups(candidate, found.groups, expectedSteps, expectedBoard);
      if (shorter.length || !targets.length) return null;
      return genFinalizeValidatedResult(candidate, targets[0], found.info, found.groups, previousResult);
    }

    async function validateWithUnlimitedBlocks(candidate, expectedSteps, previousResult, budget) {
      if (genCancelled || budget.nodes++ >= AUTO_BLOCK_NODE_LIMIT) return null;
      const expectedBoard = expectedBoardFor(candidate, previousResult);
      if (!expectedBoard) return null;
      const found = await genFindAnalyzedGroups(candidate, expectedSteps);
      if (!found) return null;
      const { shorter, targets } = analyzeGroups(candidate, found.groups, expectedSteps, expectedBoard);

      if (!shorter.length) {
        if (!targets.length) return null;
        return genFinalizeValidatedResult(candidate, targets[0], found.info, found.groups, previousResult);
      }

      // 不再用攻守子數差限制補守子；最後統一由補齊流程補攻方或守方棋。
      const ranked = await rankDefensePoints(candidate, shorter, targets[0]?.moves || null);
      for (const { idx } of ranked.slice(0, AUTO_BLOCK_BRANCH_LIMIT)) {
        if (genCancelled) return null;
        const next = addDefender(candidate, idx);
        if (!next) continue;
        const result = await validateWithUnlimitedBlocks(next, expectedSteps, previousResult, budget);
        if (result) return result;
      }
      return null;
    }

    async function validateUniqueWithUnlimitedBlocks(candidate, expectedSteps, previousResult, budget) {
      if (genCancelled || budget.nodes++ >= AUTO_BLOCK_NODE_LIMIT) return null;
      const expectedBoard = expectedBoardFor(candidate, previousResult);
      if (!expectedBoard) return null;
      const found = await findMultiGroups(candidate, expectedSteps);
      if (!found) return null;
      const { analyzed, targets } = analyzeGroups(candidate, found.groups, expectedSteps, expectedBoard);
      if (!targets.length) return null;
      const unwanted = analyzed.filter(item => !isTargetAnalysis(item.analysis, expectedSteps, expectedBoard));

      if (!unwanted.length) {
        if (found.saturated) return null;
        return genFinalizeValidatedResult(candidate, targets[0], found.info, found.groups, previousResult);
      }

      // 「只保留目標 VCF」同樣不再受目前子數差限制。
      const ranked = await rankDefensePoints(candidate, unwanted, targets[0].moves);
      for (const { idx } of ranked.slice(0, AUTO_BLOCK_BRANCH_LIMIT)) {
        if (genCancelled) return null;
        const next = addDefender(candidate, idx);
        if (!next) continue;
        const result = await validateUniqueWithUnlimitedBlocks(next, expectedSteps, previousResult, budget);
        if (result) return result;
      }
      return null;
    }

    genValidateCandidate = async function validateCandidateWithFlexibleBlocking(candidate, expectedSteps) {
      const source = cloneCandidate(candidate);
      if (genEl("block-other-vcf")?.checked) {
        return validateUniqueWithUnlimitedBlocks(source, expectedSteps, null, { nodes: 0 });
      }
      if (genEl("balance-stones")?.checked) {
        return validateWithUnlimitedBlocks(source, expectedSteps, null, { nodes: 0 });
      }
      return validateDirect(source, expectedSteps, null);
    };

    genValidateExtensionCandidate = async function validateExtensionWithFlexibleBlocking(
      candidate,
      previousResult,
      targetSteps,
    ) {
      if (targetSteps !== previousResult.steps + 1) return null;
      const source = cloneCandidate(candidate);
      if (genEl("block-other-vcf")?.checked) {
        return validateUniqueWithUnlimitedBlocks(source, targetSteps, previousResult, { nodes: 0 });
      }
      if (genEl("balance-stones")?.checked) {
        return validateWithUnlimitedBlocks(source, targetSteps, previousResult, { nodes: 0 });
      }
      return validateDirect(source, targetSteps, previousResult);
    };

    function countStones(board) {
      let black = 0;
      let white = 0;
      for (let idx = 0; idx < 225; idx++) {
        if (board[idx] === GEN_BLACK) black++;
        else if (board[idx] === GEN_WHITE) white++;
      }
      return { black, white };
    }

    function getBalancePlan(board, attacker) {
      const { black, white } = countStones(board);
      const currentDifference = black - white;
      const targetDifference = attacker === GEN_BLACK ? 0 : 1;
      const blackNeeded = targetDifference - currentDifference;
      if (blackNeeded > 0) return { color: GEN_BLACK, remaining: blackNeeded };
      if (blackNeeded < 0) return { color: GEN_WHITE, remaining: -blackNeeded };
      return { color: GEN_EMPTY, remaining: 0 };
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
        if (three === 6 || three === 7) result *= threeMultiplier;
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
      weight = multiplyLineShapeWeight(weight, board, idx, attacker, true, threeMultiplier);
      weight = multiplyLineShapeWeight(weight, board, idx, defender, false, threeMultiplier);
      return weight * neighborhoodStoneCount(board, idx);
    }

    function weightedRandomOrder(items) {
      const positive = items.filter(item => item.weight > 0);
      const source = positive.length ? positive : items;
      return source
        .map(item => ({
          item,
          key: positive.length
            ? -Math.log(Math.max(Number.MIN_VALUE, Math.random())) / item.weight
            : Math.random(),
        }))
        .sort((left, right) => left.key - right.key)
        .map(entry => entry.item);
    }

    async function buildFillCandidates(state, color, targetSteps, options) {
      const defender = genOther(state.attacker);
      const protectedPoints = new Set(
        await genEngine.getBlockVCF(state.board, state.attacker, state.moves, true),
      );
      const eligible = [];

      for (let idx = 0; idx < 225; idx++) {
        if (!isInteriorPoint(idx) || state.board[idx] !== GEN_EMPTY) continue;
        if (genIsNFor(state.nMask, idx, color)) continue;
        if (protectedPoints.has(idx)) continue;
        if (state.rules === 2 && color === GEN_BLACK && isFoul(idx, state.board)) continue;

        const level = getLevelPoint(idx, color, state.board) & SHAPE_MASK;
        if (level >= GEN_FIVE) continue;
        if (color === defender && (level === GEN_FOUR_NOFREE || level === GEN_FOUR_FREE)) continue;
        if (
          color === state.attacker &&
          targetSteps > 1 &&
          (level === GEN_FOUR_NOFREE || level === GEN_FOUR_FREE)
        ) continue;
        eligible.push(idx);
      }

      const candidates = [];
      setGameRules(1);
      try {
        for (const idx of eligible) {
          candidates.push({
            idx,
            weight: fillPointWeight(
              state.board,
              idx,
              state.attacker,
              defender,
              Number(options?.threeMultiplier) || 0,
            ),
          });
        }
      } finally {
        setGameRules(state.rules);
      }
      return candidates;
    }

    async function validateFillMove(state, idx, color, targetSteps, options) {
      const board = genCloneBoard(state.board);
      if (board[idx] !== GEN_EMPTY) return null;
      board[idx] = color;

      const expectedBoard = genCloneBoard(state.standardBoard);
      if (expectedBoard[idx] !== GEN_EMPTY) return null;
      expectedBoard[idx] = color;
      const candidate = { ...state, board };

      let found;
      let target;
      if (options?.blockOtherVCF) {
        found = await findMultiGroups(candidate, targetSteps);
        if (!found || found.saturated) return null;
        const { analyzed, targets } = analyzeGroups(candidate, found.groups, targetSteps, expectedBoard);
        if (!targets.length) return null;
        if (analyzed.some(item => !isTargetAnalysis(item.analysis, targetSteps, expectedBoard))) return null;
        target = targets[0];
      } else {
        found = await genFindAnalyzedGroups(candidate, targetSteps);
        if (!found) return null;
        const { shorter, targets } = analyzeGroups(candidate, found.groups, targetSteps, expectedBoard);
        if (shorter.length || !targets.length) return null;
        target = targets[0];
      }

      const isAttackerFill = color === state.attacker;
      const nMask = genApplyRouteNPoints({ ...state, board }, target.moves);
      return {
        ...state,
        board,
        nMask,
        moves: target.moves,
        completedBoard: target.analysis.completedBoard,
        standardBoard: target.analysis.standardBoard,
        nodeCount: found.info.nodeCount || 0,
        groupCount: found.groups.length,
        uniqueVCFVerified: options?.blockOtherVCF ? true : state.uniqueVCFVerified,
        totalAddedAttackers: (state.totalAddedAttackers || 0) + (isAttackerFill ? 1 : 0),
        totalAddedDefenders: (state.totalAddedDefenders || 0) + (isAttackerFill ? 0 : 1),
        balanceFillAttackers: [
          ...(state.balanceFillAttackers || []),
          ...(isAttackerFill ? [idx] : []),
        ],
        balanceFillDefenders: [
          ...(state.balanceFillDefenders || []),
          ...(isAttackerFill ? [] : [idx]),
        ],
      };
    }

    async function fillBalancedStonesRecursive(state, color, targetSteps, options, remaining, budget) {
      if (remaining <= 0) return { ...state, balanceComplete: true };
      if (genCancelled || budget.nodes++ >= budget.limit) return null;

      const available = await buildFillCandidates(state, color, targetSteps, options);
      if (!available.length) return null;
      const ordered = weightedRandomOrder(available).slice(0, FILL_BRANCH_LIMIT);
      for (const item of ordered) {
        if (genCancelled) return null;
        const next = await validateFillMove(state, item.idx, color, targetSteps, options);
        if (!next) continue;
        const completed = await fillBalancedStonesRecursive(
          next,
          color,
          targetSteps,
          options,
          remaining - 1,
          budget,
        );
        if (completed) return completed;
      }
      return null;
    }

    async function fillBalancedStones(result, targetSteps, options) {
      const plan = getBalancePlan(result.board, result.attacker);
      if (!plan.remaining) {
        return {
          ...result,
          balanceComplete: true,
          balanceFillAttackers: Array.from(result.balanceFillAttackers || []),
          balanceFillDefenders: Array.from(result.balanceFillDefenders || []),
        };
      }

      const fillSide = plan.color === result.attacker ? "攻方" : "守方";
      genSetStatus(`VCF 已完成，正在補齊${fillSide}棋子……`);
      const initial = {
        ...result,
        balanceFillAttackers: Array.from(result.balanceFillAttackers || []),
        balanceFillDefenders: Array.from(result.balanceFillDefenders || []),
      };
      return fillBalancedStonesRecursive(
        initial,
        plan.color,
        targetSteps,
        options,
        plan.remaining,
        { nodes: 0, limit: Math.max(240, plan.remaining * 160) },
      );
    }

    const previousExtendToTarget = genExtendToTarget;
    genExtendToTarget = async function extendAndBalanceEitherSide(
      current,
      targetSteps,
      attacker,
      rules,
      options,
      counters,
    ) {
      const shouldBalance = Boolean(options?.balanceStones);
      const searchOptions = shouldBalance ? { ...options, balanceStones: false } : options;
      const result = await previousExtendToTarget(
        current,
        targetSteps,
        attacker,
        rules,
        searchOptions,
        counters,
      );
      if (!result || !shouldBalance || result.steps !== targetSteps || result.balanceComplete) return result;
      return fillBalancedStones(result, targetSteps, options);
    };

    const balanceInput = genEl("balance-stones");
    const balanceLabel = balanceInput?.closest("label");
    if (balanceLabel) {
      balanceLabel.title = "產生過程可不限目前子數差補守子；完成後依正常輪次補攻方或守方棋，且每顆補子都重新確認不會產生更短 VCF";
    }

    const previousShowResult = genShowResult;
    genShowResult = function showFlexibleBalanceSummary(result, targetSteps, attacker, counters, options) {
      previousShowResult(result, targetSteps, attacker, counters, options);
      if (!options?.balanceStones || !result) return;
      const details = genEl("details");
      if (!details) return;
      const attackerFill = new Set(result.balanceFillAttackers || []).size;
      const defenderFill = new Set(result.balanceFillDefenders || []).size;
      details.textContent = details.textContent.replace(
        /最後補齊\s*\d+/,
        `最後補齊攻方 ${attackerFill}、守方 ${defenderFill}`,
      );
    };
  }, 0);
})();
