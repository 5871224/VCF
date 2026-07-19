"use strict";

// ---------------- VCF validation ----------------
function genAnalyzeVCFGroup(initialBoard, moves, attacker) {
  const board = genCloneBoard(initialBoard);
  let steps = 0;
  const levels = [];
  const rawLevels = [];
  let standardBoard = null;

  for (let i = 0; i < moves.length; i++) {
    const idx = moves[i];
    const color = i % 2 === 0 ? attacker : genOther(attacker);
    if (idx < 0 || idx >= 225 || board[idx] !== GEN_EMPTY) {
      return { valid: false, steps: Infinity, levels, rawLevels };
    }

    const beforeMove = color === attacker ? genCloneBoard(board) : null;
    board[idx] = color;

    if (color === attacker) {
      const rawLevel = getLevelPoint(idx, attacker, board);
      const level = rawLevel & 0x0f;
      const isDoubleFour = Boolean(rawLevel & 0x60);
      levels.push(level);
      rawLevels.push(rawLevel);

      // 步數定義：連五前攻方實際落子的手數。
      // 最後連五那手不計；同一手形成四四仍只算 1 步。
      if (level >= GEN_FIVE) {
        standardBoard = genCloneBoard(board);
        break;
      }
      steps++;

      // 標準完成盤面：四四記到四四；活四記到攻方下活四之前。
      if (isDoubleFour) {
        standardBoard = genCloneBoard(board);
        break;
      }
      if (level === GEN_FOUR_FREE) {
        standardBoard = beforeMove;
        break;
      }
    }
  }

  if (!standardBoard) standardBoard = genCloneBoard(board);
  return {
    valid: true,
    steps,
    levels,
    rawLevels,
    completedBoard: board,
    standardBoard,
  };
}

function genMatchesLiveThreeContinuation(candidate, moves) {
  if (moves[0] !== candidate.anchor || moves[1] !== candidate.fivePoint) return false;
  if (moves.length < 3 || moves[2] !== candidate.base.activeFourPoint) return false;
  if (moves.length >= 4 && !candidate.base.finalPoints.includes(moves[3])) return false;
  if (moves.length >= 5) {
    const expected = candidate.base.finalPoints.find(idx => idx !== moves[3]);
    if (moves[4] !== expected) return false;
  }
  return true;
}

function genMatchesDeadFourContinuation(candidate, moves, analysis) {
  if (!moves.length || moves[0] !== candidate.anchor) return false;
  if (!analysis.rawLevels.length || !(analysis.rawLevels[0] & 0x60)) return false;

  const sameLine = candidate.base.direction.line === candidate.direction.line;
  if (sameLine) {
    const lineInfo = testLineFour(
      candidate.anchor,
      candidate.direction.line,
      candidate.attacker,
      candidate.board
    );
    if ((lineInfo & GEN_LINE_MASK) !== GEN_LINE_DOUBLE_FOUR) return false;
    if (candidate.base.finishPoint === candidate.fivePoint) return false;

    const fivePoints = genGetLineFivePointsAfterAnchor(
      candidate.board,
      candidate.anchor,
      candidate.direction,
      candidate.attacker
    );
    return genPointSetEquals(fivePoints, [candidate.base.finishPoint, candidate.fivePoint]);
  }

  const oldInfo = testLineFour(candidate.anchor, candidate.base.direction.line, candidate.attacker, candidate.board);
  if ((oldInfo & GEN_LINE_MASK) !== GEN_FOUR_NOFREE) return false;
  if (getBlockFourPoint(candidate.anchor, candidate.board, oldInfo) !== candidate.base.finishPoint) return false;

  const newInfo = testLineFour(candidate.anchor, candidate.direction.line, candidate.attacker, candidate.board);
  if ((newInfo & GEN_LINE_MASK) !== GEN_FOUR_NOFREE) return false;
  if (getBlockFourPoint(candidate.anchor, candidate.board, newInfo) !== candidate.fivePoint) return false;

  return true;
}

function genMatchesBaseContinuation(candidate, moves, analysis) {
  if (candidate.base.materialType === "deadFour") {
    return genMatchesDeadFourContinuation(candidate, moves, analysis);
  }
  return genMatchesLiveThreeContinuation(candidate, moves);
}

function genBoardsEqual(a, b) {
  if (!a || !b) return false;
  for (let idx = 0; idx < 225; idx++) {
    if (a[idx] !== b[idx]) return false;
  }
  return true;
}

function genBuildExpectedExtendedBoard(previousResult, candidate) {
  const expected = genCloneBoard(previousResult.standardBoard);

  for (const idx of candidate.addedAttackers) {
    if (expected[idx] !== GEN_EMPTY && expected[idx] !== candidate.attacker) return null;
    expected[idx] = candidate.attacker;
  }
  for (const idx of candidate.addedDefenders) {
    if (expected[idx] !== GEN_EMPTY && expected[idx] !== candidate.defender) return null;
    expected[idx] = candidate.defender;
  }

  // 五點原本是空點時，守方的被迫防守手是本層完成盤面的新增棋。
  // 五點原本已有守方棋時，生成時只是暫時移除，完成後仍屬沿用舊棋。
  const fiveWasDefender = candidate.removedDefenders.includes(candidate.fivePoint);
  if (!fiveWasDefender) {
    if (expected[candidate.fivePoint] !== GEN_EMPTY && expected[candidate.fivePoint] !== candidate.defender) return null;
    expected[candidate.fivePoint] = candidate.defender;
  }

  // A 原本就是攻方棋，VCF 過程中下回後仍屬沿用舊棋。
  return expected;
}

function genApplyRouteNPoints(candidate, moves) {
  const nMask = candidate.nMask.slice();
  for (const idx of moves) {
    if (idx >= 0 && idx < 225) nMask[idx] |= GEN_NO_BLACK | GEN_NO_WHITE;
  }
  if (candidate.attacker === GEN_BLACK && candidate.rules === 2) {
    for (const idx of candidate.xPoints) {
      if (idx >= 0 && idx < 225) nMask[idx] |= GEN_NO_BLACK;
    }
  }
  return nMask;
}

function genLayerRecord(candidate, step) {
  return {
    step,
    anchor: candidate.anchor,
    fivePoint: candidate.fivePoint,
    direction: candidate.direction,
    sign: candidate.sign,
    templateId: candidate.templateId,
    xPoints: Array.from(candidate.xPoints),
    sameLineDoubleFour: Boolean(candidate.sameLineDoubleFour),
    lineFivePoints: Array.from(candidate.lineFivePoints || []),
    addedAttackers: Array.from(candidate.addedAttackers),
    addedDefenders: Array.from(candidate.addedDefenders),
    removedDefenders: Array.from(candidate.removedDefenders),
  };
}

function genFinalizeValidatedResult(candidate, target, info, groups, previousResult = null) {
  const nMask = genApplyRouteNPoints(candidate, target.moves);
  const layer = genLayerRecord(candidate, target.analysis.steps);
  const previousLayers = previousResult ? previousResult.layers : [];
  const totalAddedAttackers = (previousResult ? previousResult.totalAddedAttackers : 0) + candidate.addedAttackers.length;
  const totalAddedDefenders = (previousResult ? previousResult.totalAddedDefenders : 0) + candidate.addedDefenders.length;

  return {
    ...candidate,
    rootBase: candidate.rootBase || candidate.base,
    nMask,
    moves: target.moves,
    steps: target.analysis.steps,
    completedBoard: target.analysis.completedBoard,
    standardBoard: target.analysis.standardBoard,
    layers: [...previousLayers, layer],
    totalAddedAttackers,
    totalAddedDefenders,
    nodeCount: info.nodeCount || 0,
    groupCount: groups.length,
  };
}

async function genFindAnalyzedGroups(candidate) {
  const info = await genEngine.findVCF(candidate.board, candidate.attacker, 64);
  if (genCancelled || !info || !info.winMoves || !info.winMoves.length) return null;
  const raw = info.winMoves.filter(moves => moves && moves.length);
  if (!raw.length) return null;
  const groups = await genEngine.trimGroups(candidate.board, raw, candidate.attacker);
  if (genCancelled || !groups.length) return null;
  return { info, groups };
}

async function genValidateCandidate(candidate) {
  const found = await genFindAnalyzedGroups(candidate);
  if (!found) return null;
  const { info, groups } = found;

  let target = null;
  for (const moves of groups) {
    const analysis = genAnalyzeVCFGroup(candidate.board, moves, candidate.attacker);
    if (!analysis.valid) continue;
    if (analysis.steps < 2) return null;
    if (!target && analysis.steps === 2 && genMatchesBaseContinuation(candidate, moves, analysis)) {
      target = { moves: Array.from(moves), analysis };
    }
  }
  if (!target) return null;
  return genFinalizeValidatedResult(candidate, target, info, groups);
}

async function genValidateExtensionCandidate(candidate, previousResult, targetSteps) {
  if (targetSteps !== previousResult.steps + 1) return null;
  const expectedBoard = genBuildExpectedExtendedBoard(previousResult, candidate);
  if (!expectedBoard) return null;

  const found = await genFindAnalyzedGroups(candidate);
  if (!found) return null;
  const { info, groups } = found;

  let target = null;
  for (const moves of groups) {
    const analysis = genAnalyzeVCFGroup(candidate.board, moves, candidate.attacker);
    if (!analysis.valid) continue;

    // 出現任何比指定目標更短的 VCF，整個候選直接淘汰。
    if (analysis.steps < targetSteps) return null;

    if (
      !target &&
      analysis.steps === targetSteps &&
      genBoardsEqual(analysis.standardBoard, expectedBoard)
    ) {
      target = { moves: Array.from(moves), analysis };
    }
  }

  if (!target) return null;
  return genFinalizeValidatedResult(candidate, target, info, groups, previousResult);
}

function genMakeExtensionBase(result) {
  const rootBase = result.rootBase || result.base;
  const forbidden = new Set(rootBase.forbiddenAnchorPoints || []);
  const anchorCandidates = [];

  for (let idx = 0; idx < 225; idx++) {
    if (
      result.board[idx] === result.attacker &&
      !genIsNFor(result.nMask, idx, result.attacker) &&
      !forbidden.has(idx)
    ) {
      anchorCandidates.push(idx);
    }
  }

  return {
    board: genCloneBoard(result.board),
    nMask: result.nMask.slice(),
    attacker: result.attacker,
    materialType: "generated",
    patternName: rootBase.patternName,
    patternText: rootBase.patternText,
    rootBase,
    anchorCandidates,
    forbiddenAnchorPoints: Array.from(forbidden),
    weight: 1,
  };
}
