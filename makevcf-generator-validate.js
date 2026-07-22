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

function genBoardsEqual(a, b) {
  if (!a || !b) return false;
  for (let idx = 0; idx < 225; idx++) {
    if (a[idx] !== b[idx]) return false;
  }
  return true;
}

function genHasPreservedBaseLiveThree(candidate, board) {
  const base = candidate.base;
  if (!base || base.materialType !== "liveThree") return true;

  const continuationPoints = Array.from(new Set(base.points || []));
  return continuationPoints.some(idx =>
    idx !== GEN_OUT &&
    board[idx] === GEN_EMPTY &&
    genCreatesLegalFreeFour(
      board,
      idx,
      base.direction.line,
      candidate.attacker,
      candidate.rules
    )
  );
}

function genBuildExpectedBaseBoard(candidate) {
  const expected = genCloneBoard(candidate.board);
  if (
    candidate.anchor < 0 ||
    candidate.anchor >= 225 ||
    expected[candidate.anchor] !== GEN_EMPTY
  ) {
    return null;
  }
  expected[candidate.anchor] = candidate.attacker;

  if (candidate.base.materialType === "liveThree") {
    if (candidate.fivePoint < 0 || candidate.fivePoint >= 225) return null;
    if (
      expected[candidate.fivePoint] !== GEN_EMPTY &&
      expected[candidate.fivePoint] !== candidate.defender
    ) {
      return null;
    }
    expected[candidate.fivePoint] = candidate.defender;

    // 不限定活三後續從哪一側下出活四，但原活三必須仍至少保留一個合法活四延伸點。
    if (!genHasPreservedBaseLiveThree(candidate, expected)) return null;
  }

  return expected;
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

function genResolveValidationSteps(candidate, expectedSteps) {
  const values = [
    expectedSteps,
    candidate && candidate.validationTargetSteps,
    candidate && candidate.steps,
    candidate && candidate.base && candidate.base.validationTargetSteps,
  ];
  for (const value of values) {
    const steps = Math.round(Number(value));
    if (Number.isFinite(steps) && steps >= GEN_MIN_STEPS && steps <= GEN_MAX_STEPS) return steps;
  }

  const materialType = candidate && candidate.base && candidate.base.materialType;
  if (materialType === "deadFour") return 1;
  if (materialType === "liveThree") return 2;
  return 0;
}

function genTargetSearchPly(targetSteps) {
  // 題目步數只計算最後連五前的攻方落子；C++ maxDepth 使用實際攻守 ply。
  // 最長終止型為：目標攻方步數及其守方應手，再加最後一手連五，所以是 2 × steps + 1。
  return Math.min(200, Math.max(1, targetSteps * 2 + 1));
}

async function genFindAnalyzedGroups(candidate, expectedSteps) {
  const targetSteps = genResolveValidationSteps(candidate, expectedSteps);
  if (!targetSteps) return null;

  // 舊版驗證需要在同一次多組搜尋中同時取得：
  // 1. 指定目標步數的預期路線。
  // 2. 所有已列舉到、比目標短的路線，用來統計防守點並補守子。
  // 因此不能使用只回傳第一個有解深度的 shortest 模式。
  const info = await genEngine.findVCF(candidate.board, candidate.attacker, 64, {
    mode: "multi",
    simplify: true,
    maxDepth: genTargetSearchPly(targetSteps),
    maxNode: 5000000,
  });
  if (genCancelled || !info || !info.winMoves || !info.winMoves.length) return null;
  const raw = info.winMoves.filter(moves => moves && moves.length);
  if (!raw.length) return null;
  const groups = await genEngine.trimGroups(candidate.board, raw, candidate.attacker);
  if (genCancelled || !groups.length) return null;
  return { info, groups, targetSteps };
}

async function genValidateCandidate(candidate, expectedSteps) {
  const expectedBoard = genBuildExpectedBaseBoard(candidate);
  if (!expectedBoard) return null;

  const found = await genFindAnalyzedGroups(candidate, expectedSteps);
  if (!found) return null;
  const { info, groups } = found;

  let target = null;
  for (const moves of groups) {
    const analysis = genAnalyzeVCFGroup(candidate.board, moves, candidate.attacker);
    if (!analysis.valid) continue;

    // 未開啟自動補守子時，存在較短 VCF 仍視為不合格。
    // 開啟「補齊黑白子數」時，makevcf-generator-balance.js 會攔截本函式，
    // 依舊版流程找防守點、補守子並重新驗證，而不會走到這裡直接淘汰。
    if (analysis.steps < expectedSteps) return null;

    // 不限定 VCF 落子順序；只要其中一組在指定步數到達預期黑白棋盤面即可。
    if (
      !target &&
      analysis.steps === expectedSteps &&
      genBoardsEqual(analysis.standardBoard, expectedBoard)
    ) {
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

  const found = await genFindAnalyzedGroups(candidate, targetSteps);
  if (!found) return null;
  const { info, groups } = found;

  let target = null;
  for (const moves of groups) {
    const analysis = genAnalyzeVCFGroup(candidate.board, moves, candidate.attacker);
    if (!analysis.valid) continue;

    // 未開啟自動補守子時，存在任何較短 VCF 就淘汰。
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
    validationTargetSteps: result.steps + 1,
    anchorCandidates,
    forbiddenAnchorPoints: Array.from(forbidden),
    weight: 1,
  };
}
