"use strict";

// Optional stone-count balancing and shorter-VCF repair.
(function initGeneratorBalance() {
  const GEN_THREE_NOFREE = 6;
  const GEN_THREE_FREE = 7;
  const GEN_SHAPE_MASK = 0x0f;
  const GEN_AUTO_BLOCK_BRANCH_LIMIT = 6;
  const GEN_AUTO_BLOCK_NODE_LIMIT = 42;
  const GEN_FILL_BRANCH_LIMIT = 10;
  const GEN_FILL_NODE_LIMIT = 140;

  let activeOptions = null;

  GeneratorVCFEngine.prototype.getBlockVCF = async function getGeneratorBlockVCF(arr, color, moves, includeFour = true) {
    await this.ready;
    return (await this.post("getBlockVCF", {
      arr: arr.slice(),
      color,
      vcfMoves: Array.from(moves || []),
      includeFour,
    })) || [];
  };

  function addBalanceControls() {
    const target = genEl("target-steps");
    const controls = target && (target.closest(".gen-controls") || target.closest(".controls"));
    if (!controls || genEl("balance-stones")) return;

    const balanceLabel = document.createElement("label");
    balanceLabel.title = "開啟後，產生過程會用守方棋封鎖較短 VCF，完成後再補齊正常輪到攻方下棋的黑白子數";
    balanceLabel.innerHTML = '<input id="gen-balance-stones" type="checkbox" checked> 補齊黑白子數';

    const threeLabel = document.createElement("label");
    threeLabel.title = "最後補守方棋時，攻守雙方形成活三或死三的權重倍數";
    threeLabel.innerHTML = '三型加成 <input id="gen-three-multiplier" type="number" min="0" max="1000000" step="1" value="30"> 倍';

    controls.append(balanceLabel, threeLabel);

    const style = document.createElement("style");
    style.textContent = `
      #gen-three-multiplier {
        width: 72px;
        padding: 5px 7px;
        border: 1px solid #aaa;
        border-radius: 4px;
        text-align: center;
        font-size: 14px;
      }
    `;
    document.head.appendChild(style);
  }

  addBalanceControls();

  const originalOptions = genOptions;
  genOptions = function generatorOptionsWithBalance() {
    const options = originalOptions();
    const balanceInput = genEl("balance-stones");
    const threeInput = genEl("three-multiplier");
    const rawThree = Number(threeInput?.value);
    const threeMultiplier = Number.isFinite(rawThree)
      ? Math.min(1000000, Math.max(0, rawThree))
      : 30;
    if (threeInput) threeInput.value = String(threeMultiplier);

    activeOptions = {
      ...options,
      balanceStones: Boolean(balanceInput?.checked),
      threeMultiplier,
    };
    return activeOptions;
  };

  const originalSetBusy = genSetBusy;
  genSetBusy = function generatorSetBusyWithBalance(value) {
    originalSetBusy(value);
    ["balance-stones", "three-multiplier"].forEach(id => {
      const element = genEl(id);
      if (element) element.disabled = value;
    });
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

  function defenderAllowance(board, attacker) {
    const { black, white } = countStones(board);
    return attacker === GEN_BLACK ? black - white : white + 1 - black;
  }

  function cloneCandidate(candidate) {
    return {
      ...candidate,
      board: genCloneBoard(candidate.board),
      nMask: candidate.nMask.slice(),
      addedAttackers: Array.from(candidate.addedAttackers || []),
      reusedAttackers: Array.from(candidate.reusedAttackers || []),
      removedDefenders: Array.from(candidate.removedDefenders || []),
      addedDefenders: Array.from(candidate.addedDefenders || []),
      autoBlockDefenders: Array.from(candidate.autoBlockDefenders || []),
      xPoints: Array.from(candidate.xPoints || []),
      lineFivePoints: Array.from(candidate.lineFivePoints || []),
    };
  }

  function addDefenderToCandidate(candidate, idx) {
    const next = cloneCandidate(candidate);
    if (next.board[idx] !== GEN_EMPTY) return null;
    next.board[idx] = next.defender;
    if (!next.addedDefenders.includes(idx)) next.addedDefenders.push(idx);
    if (!next.autoBlockDefenders.includes(idx)) next.autoBlockDefenders.push(idx);
    return next;
  }

  function expectedBoardFor(candidate, previousResult) {
    return previousResult
      ? genBuildExpectedExtendedBoard(previousResult, candidate)
      : genBuildExpectedBaseBoard(candidate);
  }

  function analyzeGroups(candidate, groups, expectedSteps, expectedBoard) {
    const analyzed = [];
    for (const moves of groups) {
      const analysis = genAnalyzeVCFGroup(candidate.board, moves, candidate.attacker);
      if (!analysis.valid) continue;
      analyzed.push({ moves: Array.from(moves), analysis });
    }
    const shorter = analyzed.filter(item => item.analysis.steps < expectedSteps);
    const targets = analyzed.filter(item =>
      item.analysis.steps === expectedSteps &&
      genBoardsEqual(item.analysis.standardBoard, expectedBoard)
    );
    return { analyzed, shorter, targets };
  }

  function isDefenderFourPoint(board, idx, defender) {
    if (board[idx] !== GEN_EMPTY) return false;
    const level = getLevelPoint(idx, defender, board) & GEN_SHAPE_MASK;
    return level === GEN_FOUR_NOFREE || level === GEN_FOUR_FREE;
  }

  function isIllegalDefenderPoint(candidate, idx, protectedPoints) {
    if (idx < 0 || idx >= 225 || candidate.board[idx] !== GEN_EMPTY) return true;
    if (protectedPoints.has(idx)) return true;
    if (genIsNFor(candidate.nMask, idx, candidate.defender)) return true;
    if (isDefenderFourPoint(candidate.board, idx, candidate.defender)) return true;
    return candidate.rules === 2 && candidate.defender === GEN_BLACK && isFoul(idx, candidate.board);
  }

  async function getDefenseFrequency(candidate, shorter, targetMoves) {
    const protectedPoints = new Set(
      await genEngine.getBlockVCF(candidate.board, candidate.attacker, targetMoves, true)
    );
    const frequency = new Map();

    for (const item of shorter) {
      if (genCancelled) return [];
      const points = await genEngine.getBlockVCF(candidate.board, candidate.attacker, item.moves, true);
      for (const idx of new Set(points)) {
        if (isIllegalDefenderPoint(candidate, idx, protectedPoints)) continue;
        frequency.set(idx, (frequency.get(idx) || 0) + 1);
      }
    }

    return Array.from(frequency, ([idx, count]) => ({ idx, count }))
      .sort((a, b) => b.count - a.count || Math.random() - 0.5);
  }

  async function validateWithAutoBlock(candidate, expectedSteps, previousResult, options, budget) {
    if (genCancelled || budget.nodes++ >= GEN_AUTO_BLOCK_NODE_LIMIT) return null;

    const expectedBoard = expectedBoardFor(candidate, previousResult);
    if (!expectedBoard) return null;

    const found = await genFindAnalyzedGroups(candidate);
    if (!found) return null;
    const { info, groups } = found;
    const { shorter, targets } = analyzeGroups(candidate, groups, expectedSteps, expectedBoard);
    if (!targets.length) return null;

    if (!shorter.length) {
      return genFinalizeValidatedResult(candidate, targets[0], info, groups, previousResult);
    }

    if (defenderAllowance(candidate.board, candidate.attacker) <= 0) return null;

    const ranked = await getDefenseFrequency(candidate, shorter, targets[0].moves);
    for (const { idx } of ranked.slice(0, GEN_AUTO_BLOCK_BRANCH_LIMIT)) {
      if (genCancelled) return null;
      const next = addDefenderToCandidate(candidate, idx);
      if (!next) continue;
      const result = await validateWithAutoBlock(next, expectedSteps, previousResult, options, budget);
      if (result) return result;
    }
    return null;
  }

  const originalLayerRecord = genLayerRecord;
  genLayerRecord = function layerRecordWithAutoBlock(candidate, step) {
    const record = originalLayerRecord(candidate, step);
    record.autoBlockDefenders = Array.from(candidate.autoBlockDefenders || []);
    return record;
  };

  const originalValidateCandidate = genValidateCandidate;
  genValidateCandidate = async function validateCandidateWithBalance(candidate, expectedSteps) {
    if (!activeOptions?.balanceStones) return originalValidateCandidate(candidate, expectedSteps);
    return validateWithAutoBlock(
      cloneCandidate(candidate),
      expectedSteps,
      null,
      activeOptions,
      { nodes: 0 }
    );
  };

  const originalValidateExtensionCandidate = genValidateExtensionCandidate;
  genValidateExtensionCandidate = async function validateExtensionWithBalance(candidate, previousResult, targetSteps) {
    if (!activeOptions?.balanceStones) {
      return originalValidateExtensionCandidate(candidate, previousResult, targetSteps);
    }
    if (targetSteps !== previousResult.steps + 1) return null;
    return validateWithAutoBlock(
      cloneCandidate(candidate),
      targetSteps,
      previousResult,
      activeOptions,
      { nodes: 0 }
    );
  };

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
      const three = testLineThree(idx, direction, color, board) & GEN_SHAPE_MASK;
      if (three === GEN_THREE_FREE || three === GEN_THREE_NOFREE) result *= threeMultiplier;
      if (includeFours) {
        const four = testLineFour(idx, direction, color, board) & GEN_SHAPE_MASK;
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

  async function buildInitialFillPool(result, options) {
    const defender = genOther(result.attacker);
    const protectedPoints = new Set(
      await genEngine.getBlockVCF(result.board, result.attacker, result.moves, true)
    );
    const eligible = [];

    // 合法性依目前規則判斷。
    for (let idx = 0; idx < 225; idx++) {
      if (!isInteriorPoint(idx) || result.board[idx] !== GEN_EMPTY) continue;
      if (genIsNFor(result.nMask, idx, defender)) continue;
      if (protectedPoints.has(idx)) continue;
      if (isDefenderFourPoint(result.board, idx, defender)) continue;
      if (result.rules === 2 && defender === GEN_BLACK && isFoul(idx, result.board)) continue;
      eligible.push(idx);
    }

    // 權重統計明確忽略禁手；只在同步的本機棋型掃描期間暫切無禁規則，
    // Worker 內的 VCF 搜尋規則不受影響。
    const pool = [];
    setGameRules(1);
    try {
      for (const idx of eligible) {
        pool.push({
          idx,
          weight: fillPointWeight(result.board, idx, result.attacker, defender, options.threeMultiplier),
        });
      }
    } finally {
      setGameRules(result.rules);
    }
    return pool;
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
        key: -Math.log(Math.max(Number.MIN_VALUE, Math.random())) / item.weight,
      }))
      .sort((a, b) => a.key - b.key)
      .map(entry => entry.item);
  }

  async function dynamicFillCandidates(state, pool) {
    const defender = genOther(state.attacker);
    const protectedPoints = new Set(
      await genEngine.getBlockVCF(state.board, state.attacker, state.moves, true)
    );

    return pool.filter(item => {
      const idx = item.idx;
      if (state.board[idx] !== GEN_EMPTY) return false;
      if (protectedPoints.has(idx)) return false;
      if (isDefenderFourPoint(state.board, idx, defender)) return false;
      if (state.rules === 2 && defender === GEN_BLACK && isFoul(idx, state.board)) return false;
      return true;
    });
  }

  async function validateFilledState(state, idx, targetSteps) {
    const defender = genOther(state.attacker);
    const board = genCloneBoard(state.board);
    board[idx] = defender;

    if ((getLevelPoint(idx, defender, board) & GEN_SHAPE_MASK) >= GEN_FIVE) return null;

    const expectedBoard = genCloneBoard(state.standardBoard);
    expectedBoard[idx] = defender;
    const candidate = { ...state, board };
    const found = await genFindAnalyzedGroups(candidate);
    if (!found) return null;

    const { info, groups } = found;
    const analyzed = groups.map(moves => ({
      moves: Array.from(moves),
      analysis: genAnalyzeVCFGroup(board, moves, state.attacker),
    })).filter(item => item.analysis.valid);

    if (analyzed.some(item => item.analysis.steps < targetSteps)) return null;
    const target = analyzed.find(item =>
      item.analysis.steps === targetSteps &&
      genBoardsEqual(item.analysis.standardBoard, expectedBoard)
    );
    if (!target) return null;

    const nMask = genApplyRouteNPoints({ ...state, board }, target.moves);
    return {
      ...state,
      board,
      nMask,
      moves: target.moves,
      completedBoard: target.analysis.completedBoard,
      standardBoard: target.analysis.standardBoard,
      nodeCount: info.nodeCount || 0,
      groupCount: groups.length,
      totalAddedDefenders: (state.totalAddedDefenders || 0) + 1,
      balanceFillDefenders: [...(state.balanceFillDefenders || []), idx],
    };
  }

  async function fillDefendersRecursive(state, pool, targetSteps, remaining, budget) {
    if (remaining <= 0) return { ...state, balanceComplete: true };
    if (genCancelled || budget.nodes++ >= GEN_FILL_NODE_LIMIT) return null;

    const available = await dynamicFillCandidates(state, pool);
    if (!available.length) return null;
    const ordered = weightedRandomOrder(available).slice(0, GEN_FILL_BRANCH_LIMIT);

    for (const item of ordered) {
      if (genCancelled) return null;
      const next = await validateFilledState(state, item.idx, targetSteps);
      if (!next) continue;
      const completed = await fillDefendersRecursive(next, pool, targetSteps, remaining - 1, budget);
      if (completed) return completed;
    }
    return null;
  }

  async function fillDefenderStones(result, targetSteps, options) {
    const remaining = defenderAllowance(result.board, result.attacker);
    if (remaining < 0) return null;
    if (remaining === 0) return { ...result, balanceComplete: true, balanceFillDefenders: [] };

    const pool = await buildInitialFillPool(result, options);
    if (!pool.length) return null;
    return fillDefendersRecursive(result, pool, targetSteps, remaining, { nodes: 0 });
  }

  const originalExtendToTarget = genExtendToTarget;
  genExtendToTarget = async function extendAndBalance(current, targetSteps, attacker, rules, options, counters) {
    const result = await originalExtendToTarget(current, targetSteps, attacker, rules, options, counters);
    if (!result || !options?.balanceStones || result.balanceComplete) return result;
    if (result.steps !== targetSteps) return result;

    genSetStatus(`VCF 已完成，正在補齊黑白子數……已驗證 ${counters.attempts} 個候選`);
    return fillDefenderStones(result, targetSteps, options);
  };

  const originalShowResult = genShowResult;
  genShowResult = function showBalancedResult(result, targetSteps, attacker, counters, options) {
    originalShowResult(result, targetSteps, attacker, counters, options);
    if (!options?.balanceStones) return;
    const details = genEl("details");
    if (!details) return;
    const layerBlocked = (result.layers || [])
      .reduce((sum, layer) => sum + (layer.autoBlockDefenders || []).length, 0);
    const autoBlocked = layerBlocked || (result.autoBlockDefenders || []).length;
    const filled = (result.balanceFillDefenders || []).length;
    details.textContent += `；子數補齊已開啟，封鎖較短 VCF 補守子 ${autoBlocked} 顆，最後補齊 ${filled} 顆，三型加成 ${options.threeMultiplier} 倍。`;
  };
})();
