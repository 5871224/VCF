"use strict";

// 題目驗證使用獨立 Bitboard Worker 的 shortest + strict 搜尋。
// 每次只處理目前最短的一批 VCF；若短於目標，補守子後再搜尋下一層。
(function installBitboardGeneratorValidation() {
  const AUTO_BLOCK_BRANCH_LIMIT = 6;
  const AUTO_BLOCK_NODE_LIMIT = 42;
  const SHAPE_MASK = 0x0f;

  GeneratorVCFEngine.prototype.getBlockVCF = async function getGeneratorBlockVCF(
    arr,
    color,
    moves,
    includeFour = true,
  ) {
    const result = await this.post("getBlockVCF", {
      arr: arr.slice(),
      color,
      vcfMoves: Array.from(moves || []),
      includeFour,
    });
    if (Array.isArray(result)) return result;
    return Array.from(result?.points || []);
  };

  genFindAnalyzedGroups = async function findShortestAnalyzedGroups(candidate, expectedSteps) {
    const targetSteps = genResolveValidationSteps(candidate, expectedSteps);
    if (!targetSteps) return null;

    const info = await genEngine.findVCF(candidate.board, candidate.attacker, 64, {
      mode: "shortest",
      simplify: true,
      pruning: "strict",
      maxDepth: genTargetSearchPly(targetSteps),
      maxNode: 5000000,
    });
    if (genCancelled || !info || !info.winMoves || !info.winMoves.length) return null;

    const raw = info.winMoves.filter(moves => moves && moves.length);
    if (!raw.length) return null;
    const groups = await genEngine.trimGroups(candidate.board, raw, candidate.attacker);
    if (genCancelled || !groups.length) return null;
    return { info, groups, targetSteps };
  };

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

  function expectedBoardFor(candidate, previousResult) {
    return previousResult
      ? genBuildExpectedExtendedBoard(previousResult, candidate)
      : genBuildExpectedBaseBoard(candidate);
  }

  function analyzeShortestGroups(candidate, groups, expectedSteps, expectedBoard) {
    const analyzed = [];
    for (const moves of groups) {
      const analysis = genAnalyzeVCFGroup(candidate.board, moves, candidate.attacker);
      if (!analysis.valid) continue;
      analyzed.push({ moves: Array.from(moves), analysis });
    }

    return {
      analyzed,
      shorter: analyzed.filter(item => item.analysis.steps < expectedSteps),
      targets: analyzed.filter(item =>
        item.analysis.steps === expectedSteps &&
        genBoardsEqual(item.analysis.standardBoard, expectedBoard)
      ),
    };
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

  function addDefender(candidate, idx) {
    const next = cloneCandidate(candidate);
    if (idx < 0 || idx >= 225 || next.board[idx] !== GEN_EMPTY) return null;
    next.board[idx] = next.defender;
    if (!next.addedDefenders.includes(idx)) next.addedDefenders.push(idx);
    if (!next.autoBlockDefenders.includes(idx)) next.autoBlockDefenders.push(idx);
    return next;
  }

  function isDefenderFourPoint(candidate, idx) {
    if (candidate.board[idx] !== GEN_EMPTY) return false;
    const level = getLevelPoint(idx, candidate.defender, candidate.board) & SHAPE_MASK;
    return level === GEN_FOUR_NOFREE || level === GEN_FOUR_FREE;
  }

  function isIllegalDefenderPoint(candidate, idx, protectedPoints) {
    if (idx < 0 || idx >= 225 || candidate.board[idx] !== GEN_EMPTY) return true;
    if (protectedPoints.has(idx)) return true;
    if (genIsNFor(candidate.nMask, idx, candidate.defender)) return true;
    if (isDefenderFourPoint(candidate, idx)) return true;
    return candidate.rules === 2 && candidate.defender === GEN_BLACK && isFoul(idx, candidate.board);
  }

  async function rankDefensePoints(candidate, shorter, targetMoves) {
    const protectedPoints = new Set();
    if (targetMoves && targetMoves.length) {
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
    for (const item of shorter) {
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
      .sort((a, b) => b.count - a.count || Math.random() - 0.5);
  }

  async function validateDirect(candidate, expectedSteps, previousResult) {
    const expectedBoard = expectedBoardFor(candidate, previousResult);
    if (!expectedBoard) return null;

    const found = await genFindAnalyzedGroups(candidate, expectedSteps);
    if (!found) return null;
    const { info, groups } = found;
    const { shorter, targets } = analyzeShortestGroups(
      candidate,
      groups,
      expectedSteps,
      expectedBoard,
    );

    if (shorter.length || !targets.length) return null;
    return genFinalizeValidatedResult(candidate, targets[0], info, groups, previousResult);
  }

  async function validateWithAutoBlock(candidate, expectedSteps, previousResult, budget) {
    if (genCancelled || budget.nodes++ >= AUTO_BLOCK_NODE_LIMIT) return null;

    const expectedBoard = expectedBoardFor(candidate, previousResult);
    if (!expectedBoard) return null;

    const found = await genFindAnalyzedGroups(candidate, expectedSteps);
    if (!found) return null;
    const { info, groups } = found;
    const { shorter, targets } = analyzeShortestGroups(
      candidate,
      groups,
      expectedSteps,
      expectedBoard,
    );

    if (!shorter.length) {
      if (!targets.length) return null;
      return genFinalizeValidatedResult(candidate, targets[0], info, groups, previousResult);
    }

    if (defenderAllowance(candidate.board, candidate.attacker) <= 0) return null;

    // 目標路線尚未出現在目前最短層時，不預設任何保護點；每個補守分支都會
    // 重新搜尋，只有最後仍能出現目標完成盤面的分支才會被接受。
    const ranked = await rankDefensePoints(candidate, shorter, targets[0]?.moves || null);
    for (const { idx } of ranked.slice(0, AUTO_BLOCK_BRANCH_LIMIT)) {
      if (genCancelled) return null;
      const next = addDefender(candidate, idx);
      if (!next) continue;
      const result = await validateWithAutoBlock(
        next,
        expectedSteps,
        previousResult,
        budget,
      );
      if (result) return result;
    }
    return null;
  }

  genValidateCandidate = async function validateCandidateWithBitboard(candidate, expectedSteps) {
    const balance = Boolean(genEl("balance-stones")?.checked);
    const source = cloneCandidate(candidate);
    return balance
      ? validateWithAutoBlock(source, expectedSteps, null, { nodes: 0 })
      : validateDirect(source, expectedSteps, null);
  };

  genValidateExtensionCandidate = async function validateExtensionWithBitboard(
    candidate,
    previousResult,
    targetSteps,
  ) {
    if (targetSteps !== previousResult.steps + 1) return null;
    const balance = Boolean(genEl("balance-stones")?.checked);
    const source = cloneCandidate(candidate);
    return balance
      ? validateWithAutoBlock(source, targetSteps, previousResult, { nodes: 0 })
      : validateDirect(source, targetSteps, previousResult);
  };
})();

// Optional mode: keep only VCF routes that reach the selected target standard board.
(function initGeneratorUniqueVCF() {
  const GEN_UNIQUE_MAX_GROUPS = 64;
  const GEN_UNIQUE_MAX_NODE = 5000000;
  const GEN_UNIQUE_BRANCH_LIMIT = 8;
  const GEN_UNIQUE_SEARCH_LIMIT = 72;
  const GEN_UNIQUE_SHAPE_MASK = 0x0f;

  let activeOptions = null;

  function addUniqueControl() {
    const target = genEl("target-steps");
    const controls = target && (target.closest(".gen-controls") || target.closest(".controls"));
    if (controls && !genEl("block-other-vcf")) {
      const label = document.createElement("label");
      label.title = "開啟後，會用守方棋封鎖搜尋到的非目標 VCF；目標定義為相同步數且標準完成盤面相同";
      label.innerHTML = '<input id="gen-block-other-vcf" type="checkbox"> 只保留目標 VCF';
      controls.appendChild(label);
    }

    document.querySelectorAll(".gen-note, .panel.note").forEach(element => element.remove());
    const details = genEl("details");
    if (details) {
      details.textContent = "";
      details.style.display = "none";
    }

    const style = document.createElement("style");
    style.dataset.generatorCompactText = "true";
    style.textContent = "#gen-details, #details { display: none !important; }";
    document.head.appendChild(style);
  }

  addUniqueControl();

  const previousOptions = genOptions;
  genOptions = function generatorOptionsWithUniqueVCF() {
    const options = previousOptions();
    activeOptions = {
      ...options,
      blockOtherVCF: Boolean(genEl("block-other-vcf")?.checked),
    };
    return activeOptions;
  };

  const previousSetBusy = genSetBusy;
  genSetBusy = function generatorSetBusyWithUniqueVCF(value) {
    previousSetBusy(value);
    const input = genEl("block-other-vcf");
    if (input) input.disabled = value;
  };

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

  function addDefender(candidate, idx) {
    const next = cloneCandidate(candidate);
    if (idx < 0 || idx >= 225 || next.board[idx] !== GEN_EMPTY) return null;
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

  function defenderAllowance(board, attacker) {
    let black = 0;
    let white = 0;
    for (let idx = 0; idx < 225; idx++) {
      if (board[idx] === GEN_BLACK) black++;
      else if (board[idx] === GEN_WHITE) white++;
    }
    return attacker === GEN_BLACK ? black - white : white + 1 - black;
  }

  function isTargetAnalysis(analysis, expectedSteps, expectedBoard) {
    return analysis.steps === expectedSteps &&
      genBoardsEqual(analysis.standardBoard, expectedBoard);
  }

  function analyzeGroups(candidate, groups, expectedSteps, expectedBoard) {
    const targets = [];
    const unwanted = [];

    for (const moves of groups) {
      const analysis = genAnalyzeVCFGroup(candidate.board, moves, candidate.attacker);
      if (!analysis.valid) continue;
      const item = { moves: Array.from(moves), analysis };
      if (isTargetAnalysis(analysis, expectedSteps, expectedBoard)) targets.push(item);
      else unwanted.push(item);
    }
    return { targets, unwanted };
  }

  async function findGroups(candidate, expectedSteps) {
    const targetSteps = genResolveValidationSteps(candidate, expectedSteps);
    if (!targetSteps) return null;
    const info = await genEngine.findVCF(candidate.board, candidate.attacker, GEN_UNIQUE_MAX_GROUPS, {
      mode: "multi",
      simplify: true,
      pruning: "strict",
      maxDepth: genTargetSearchPly(targetSteps),
      maxNode: GEN_UNIQUE_MAX_NODE,
    });
    if (genCancelled || !info || !info.winMoves || !info.winMoves.length) return null;

    const raw = info.winMoves.filter(moves => moves && moves.length);
    if (!raw.length) return null;
    const groups = await genEngine.trimGroups(candidate.board, raw, candidate.attacker);
    if (genCancelled || !groups.length) return null;

    return {
      info,
      groups,
      saturated: Boolean(info.aborted) ||
        raw.length >= GEN_UNIQUE_MAX_GROUPS ||
        (info.nodeCount || 0) >= GEN_UNIQUE_MAX_NODE,
    };
  }

  function isDefenderFourPoint(candidate, idx) {
    if (candidate.board[idx] !== GEN_EMPTY) return false;
    const level = getLevelPoint(idx, candidate.defender, candidate.board) & GEN_UNIQUE_SHAPE_MASK;
    return level === GEN_FOUR_NOFREE || level === GEN_FOUR_FREE;
  }

  function isIllegalDefenderPoint(candidate, idx, targetDefense) {
    if (idx < 0 || idx >= 225 || candidate.board[idx] !== GEN_EMPTY) return true;
    if (targetDefense.has(idx)) return true;
    if (genIsNFor(candidate.nMask, idx, candidate.defender)) return true;
    if (isDefenderFourPoint(candidate, idx)) return true;
    return candidate.rules === 2 && candidate.defender === GEN_BLACK && isFoul(idx, candidate.board);
  }

  async function rankDefensePoints(candidate, unwanted, targetMoves) {
    const targetDefense = new Set(
      await genEngine.getBlockVCF(candidate.board, candidate.attacker, targetMoves, true)
    );
    const frequency = new Map();

    for (const item of unwanted) {
      if (genCancelled) return [];
      const points = await genEngine.getBlockVCF(candidate.board, candidate.attacker, item.moves, true);
      for (const idx of new Set(points)) {
        if (isIllegalDefenderPoint(candidate, idx, targetDefense)) continue;
        frequency.set(idx, (frequency.get(idx) || 0) + 1);
      }
    }

    return Array.from(frequency, ([idx, count]) => ({ idx, count }))
      .sort((a, b) => b.count - a.count || Math.random() - 0.5);
  }

  async function validateUniqueCandidate(candidate, expectedSteps, previousResult, budget) {
    if (genCancelled || budget.nodes++ >= GEN_UNIQUE_SEARCH_LIMIT) return null;

    const expectedBoard = expectedBoardFor(candidate, previousResult);
    if (!expectedBoard) return null;

    const found = await findGroups(candidate, expectedSteps);
    if (!found) return null;
    const { targets, unwanted } = analyzeGroups(candidate, found.groups, expectedSteps, expectedBoard);
    if (!targets.length) return null;

    if (!unwanted.length) {
      // 達到路線或節點上限時，沒有看到其他路線不能視為已證明唯一。
      if (found.saturated) return null;
      return genFinalizeValidatedResult(candidate, targets[0], found.info, found.groups, previousResult);
    }

    if (defenderAllowance(candidate.board, candidate.attacker) <= 0) return null;

    const ranked = await rankDefensePoints(candidate, unwanted, targets[0].moves);
    for (const { idx } of ranked.slice(0, GEN_UNIQUE_BRANCH_LIMIT)) {
      if (genCancelled) return null;
      const next = addDefender(candidate, idx);
      if (!next) continue;
      const result = await validateUniqueCandidate(next, expectedSteps, previousResult, budget);
      if (result) return result;
    }
    return null;
  }

  const previousValidateCandidate = genValidateCandidate;
  genValidateCandidate = async function validateCandidateWithUniqueVCF(candidate, expectedSteps) {
    if (!activeOptions?.blockOtherVCF) {
      return previousValidateCandidate(candidate, expectedSteps);
    }
    return validateUniqueCandidate(cloneCandidate(candidate), expectedSteps, null, { nodes: 0 });
  };

  const previousValidateExtension = genValidateExtensionCandidate;
  genValidateExtensionCandidate = async function validateExtensionWithUniqueVCF(candidate, previousResult, targetSteps) {
    if (!activeOptions?.blockOtherVCF) {
      return previousValidateExtension(candidate, previousResult, targetSteps);
    }
    if (targetSteps !== previousResult.steps + 1) return null;
    return validateUniqueCandidate(cloneCandidate(candidate), targetSteps, previousResult, { nodes: 0 });
  };

  async function verifyFinalUniqueResult(result, targetSteps) {
    const found = await findGroups(result, targetSteps);
    if (!found || found.saturated) return false;

    let hasTarget = false;
    for (const moves of found.groups) {
      const analysis = genAnalyzeVCFGroup(result.board, moves, result.attacker);
      if (!analysis.valid) continue;
      if (isTargetAnalysis(analysis, targetSteps, result.standardBoard)) hasTarget = true;
      else return false;
    }
    return hasTarget;
  }

  const previousExtendToTarget = genExtendToTarget;
  genExtendToTarget = async function extendWithFinalUniqueCheck(current, targetSteps, attacker, rules, options, counters) {
    const result = await previousExtendToTarget(current, targetSteps, attacker, rules, options, counters);
    if (!result || !options?.blockOtherVCF || result.steps !== targetSteps || result.uniqueVCFVerified) return result;

    genSetStatus(`正在確認只保留目標 VCF……已驗證 ${counters.attempts} 個候選`);
    const valid = await verifyFinalUniqueResult(result, targetSteps);
    return valid ? { ...result, uniqueVCFVerified: true } : null;
  };

  const previousShowResult = genShowResult;
  genShowResult = function showCompactGeneratorResult(result, targetSteps, attacker, counters, options) {
    previousShowResult(result, targetSteps, attacker, counters, options);
    genSetDetails("");
  };
})();
