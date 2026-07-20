"use strict";

// Optional mode: keep only VCF routes that reach the selected target standard board.
(function initGeneratorUniqueVCF() {
  const GEN_UNIQUE_MAX_GROUPS = 256;
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

  async function findGroups(candidate) {
    const info = await genEngine.findVCF(candidate.board, candidate.attacker, GEN_UNIQUE_MAX_GROUPS);
    if (genCancelled || !info || !info.winMoves || !info.winMoves.length) return null;

    const raw = info.winMoves.filter(moves => moves && moves.length);
    if (!raw.length) return null;
    const groups = await genEngine.trimGroups(candidate.board, raw, candidate.attacker);
    if (genCancelled || !groups.length) return null;

    return {
      info,
      groups,
      saturated: raw.length >= GEN_UNIQUE_MAX_GROUPS || (info.nodeCount || 0) >= GEN_UNIQUE_MAX_NODE,
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

    const found = await findGroups(candidate);
    if (!found) return null;
    const { targets, unwanted } = analyzeGroups(candidate, found.groups, expectedSteps, expectedBoard);
    if (!targets.length) return null;

    if (!unwanted.length) {
      // When the engine hit a route or node cap, absence of another route is not a proof.
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
    const found = await findGroups(result);
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
