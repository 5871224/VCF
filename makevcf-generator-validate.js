"use strict";

// ---------------- VCF validation ----------------
function genAnalyzeVCFGroup(initialBoard, moves, attacker) {
  const board = genCloneBoard(initialBoard);
  let steps = 0;
  const levels = [];
  const rawLevels = [];
  for (let i = 0; i < moves.length; i++) {
    const idx = moves[i];
    const color = i % 2 === 0 ? attacker : genOther(attacker);
    if (idx < 0 || idx >= 225 || board[idx] !== GEN_EMPTY) {
      return { valid: false, steps: Infinity, levels, rawLevels };
    }
    board[idx] = color;
    if (color === attacker) {
      const rawLevel = getLevelPoint(idx, attacker, board);
      const level = rawLevel & 0x0f;
      levels.push(level);
      rawLevels.push(rawLevel);
      if (level === GEN_FOUR_NOFREE || level === GEN_FOUR_FREE) {
        // 四四代表同一手同時形成兩個四，VCF 步數要加 2。
        steps += (rawLevel & 0x60) ? 2 : 1;
      }
      if (level >= GEN_FIVE) break;
    }
  }
  return { valid: true, steps, levels, rawLevels, completedBoard: board };
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

  // A 下回後，原始死四與新生成死四都必須成立。
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

async function genValidateCandidate(candidate) {
  const info = await genEngine.findVCF(candidate.board, candidate.attacker);
  if (genCancelled || !info || !info.winMoves || !info.winMoves.length) return null;
  const raw = info.winMoves.filter(moves => moves && moves.length);
  if (!raw.length) return null;
  const groups = await genEngine.trimGroups(candidate.board, raw, candidate.attacker);
  if (genCancelled || !groups.length) return null;

  let target = null;
  for (const moves of groups) {
    const analysis = genAnalyzeVCFGroup(candidate.board, moves, candidate.attacker);
    if (!analysis.valid) continue;
    if (analysis.steps < 2) return null; // 任何更短組都直接淘汰。
    if (!target && analysis.steps === 2 && genMatchesBaseContinuation(candidate, moves, analysis)) {
      target = { moves: Array.from(moves), analysis };
    }
  }
  if (!target) return null;

  const nMask = candidate.nMask.slice();
  for (const idx of target.moves) nMask[idx] |= GEN_NO_BLACK | GEN_NO_WHITE;
  if (candidate.attacker === GEN_BLACK && candidate.rules === 2) {
    for (const idx of candidate.xPoints) {
      if (idx >= 0 && idx < 225) nMask[idx] |= GEN_NO_BLACK;
    }
  }

  return {
    ...candidate,
    nMask,
    moves: target.moves,
    steps: 2,
    nodeCount: info.nodeCount || 0,
    groupCount: groups.length,
  };
}
