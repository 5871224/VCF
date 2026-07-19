"use strict";

// ---------------- new closed-four layer ----------------
function genCreatesLegalFreeFour(board, idx, lineDirection, attacker, rules) {
  if (idx === GEN_OUT || board[idx] !== GEN_EMPTY) return false;
  if (rules === 2 && attacker === GEN_BLACK && isFoul(idx, board)) return false;
  const info = testLineFour(idx, lineDirection, attacker, board);
  return (info & GEN_LINE_MASK) === GEN_FOUR_FREE;
}

// 朝天元綜合分數 = 朝向分數 × 攻子平均位置接近天元分數，範圍 0～1。
function genCenterDirectionBonus(anchor, attackPoints) {
  if (!attackPoints.length) return 0;

  const ax = genX(anchor);
  const ay = genY(anchor);
  const meanX = attackPoints.reduce((sum, idx) => sum + genX(idx), 0) / attackPoints.length;
  const meanY = attackPoints.reduce((sum, idx) => sum + genY(idx), 0) / attackPoints.length;

  const attackDx = meanX - ax;
  const attackDy = meanY - ay;
  const centerDx = GEN_CENTER.x - ax;
  const centerDy = GEN_CENTER.y - ay;
  const attackLength = Math.hypot(attackDx, attackDy);
  const centerLength = Math.hypot(centerDx, centerDy);

  let directionScore = 0;
  if (!centerLength) {
    // A 已在天元時沒有可比較的朝向，將方向視為中性滿分，交由距離分數決定。
    directionScore = 1;
  } else if (attackLength) {
    directionScore = Math.max(
      0,
      (attackDx * centerDx + attackDy * centerDy) / (attackLength * centerLength)
    );
  }

  const maxCenterDistance = Math.hypot(GEN_CENTER.x, GEN_CENTER.y);
  const averageDistance = Math.hypot(meanX - GEN_CENTER.x, meanY - GEN_CENTER.y);
  const distanceScore = Math.max(0, 1 - Math.min(1, averageDistance / maxCenterDistance));

  return directionScore * distanceScore;
}

function genGetNewLiveThreeExtensions(board, scanPoints, lineDirection, attacker, rules) {
  const result = [];
  for (const idx of scanPoints) {
    if (genCreatesLegalFreeFour(board, idx, lineDirection, attacker, rules)) result.push(idx);
  }
  return result;
}

function genPointSetEquals(actual, expected) {
  const left = Array.from(new Set(actual)).sort((a, b) => a - b);
  const right = Array.from(new Set(expected)).sort((a, b) => a - b);
  return left.length === right.length && left.every((idx, i) => idx === right[i]);
}

function genGetLineFivePointsAfterAnchor(board, anchor, direction, attacker) {
  if (anchor < 0 || anchor >= 225 || board[anchor] !== GEN_EMPTY) return [];

  const withAnchor = genCloneBoard(board);
  withAnchor[anchor] = attacker;
  const result = [];
  const seen = new Set();

  for (let delta = -14; delta <= 14; delta++) {
    const idx = genPointFrom(anchor, delta, direction, 1);
    if (idx === GEN_OUT || seen.has(idx)) continue;
    seen.add(idx);
    if (withAnchor[idx] !== GEN_EMPTY) continue;

    const info = testLineFour(idx, direction.line, attacker, withAnchor);
    if ((info & GEN_LINE_MASK) === GEN_FIVE) result.push(idx);
  }

  return result;
}

function genBuildRepairVariants(board, scanPoints, xPoints, direction, attacker, defender, rules, nMask) {
  const beforeExtensions = genGetNewLiveThreeExtensions(
    board,
    scanPoints,
    direction.line,
    attacker,
    rules
  );
  if (!beforeExtensions.length) {
    return [{ board, addedDefenders: [], liveThreeExtensions: [] }];
  }

  const addable = xPoints.filter(idx =>
    idx !== GEN_OUT &&
    board[idx] === GEN_EMPTY &&
    !genIsNFor(nMask, idx, defender)
  );
  const valid = [];

  for (let mask = 1; mask < (1 << addable.length); mask++) {
    const repaired = genCloneBoard(board);
    const addedDefenders = [];
    for (let i = 0; i < addable.length; i++) {
      if (mask & (1 << i)) {
        repaired[addable[i]] = defender;
        addedDefenders.push(addable[i]);
      }
    }
    const afterExtensions = genGetNewLiveThreeExtensions(
      repaired,
      scanPoints,
      direction.line,
      attacker,
      rules
    );
    if (!afterExtensions.length) {
      valid.push({ board: repaired, addedDefenders, liveThreeExtensions: beforeExtensions });
    }
  }

  if (!valid.length) return [];
  const minAdded = Math.min(...valid.map(item => item.addedDefenders.length));
  return valid.filter(item => item.addedDefenders.length === minAdded);
}

function genBuildLayerCandidates(base, anchor, direction, sign, template, anchorSlot, attacker, rules, options) {
  const defender = genOther(attacker);
  const mapped = template.cells.map((_, slot) => genPointFrom(anchor, slot - anchorSlot, direction, sign));
  if (mapped[anchorSlot] !== anchor) return [];

  for (let slot = 0; slot < template.cells.length; slot++) {
    if (template.cells[slot] !== "X" && mapped[slot] === GEN_OUT) return [];
  }

  const board = genCloneBoard(base.board);
  const addedAttackers = [];
  const reusedAttackers = [];
  const removedDefenders = [];

  for (let slot = 0; slot < template.cells.length; slot++) {
    const type = template.cells[slot];
    const idx = mapped[slot];
    if (type === "X") {
      if (idx !== GEN_OUT && board[idx] === attacker) return [];
      continue;
    }
    if (type === "S") {
      if (idx === anchor && slot !== anchorSlot) return [];
      if (board[idx] === attacker) {
        reusedAttackers.push(idx);
      } else if (board[idx] === GEN_EMPTY && !genIsNFor(base.nMask, idx, attacker)) {
        board[idx] = attacker;
        addedAttackers.push(idx);
      } else {
        return [];
      }
      continue;
    }
    if (type === "F") {
      if (genIsNFor(base.nMask, idx, attacker)) return [];
      if (board[idx] === attacker) return [];
      if (board[idx] === defender) {
        board[idx] = GEN_EMPTY;
        removedDefenders.push(idx);
      }
    }
  }

  const fivePoint = mapped[template.fiveSlot];
  const xPoints = template.xSlots.map(slot => mapped[slot]);
  const attackPoints = mapped.filter((idx, slot) => template.cells[slot] === "S" && idx !== GEN_OUT);
  const liveThreeScanPoints = Array.from(new Set(mapped.filter(idx => idx !== GEN_OUT)));
  if (board[anchor] !== attacker) return [];
  board[anchor] = GEN_EMPTY;

  const repairVariants = genBuildRepairVariants(
    board,
    liveThreeScanPoints,
    xPoints,
    direction,
    attacker,
    defender,
    rules,
    base.nMask
  );
  if (!repairVariants.length) return [];

  const uniqueAdded = Array.from(new Set(addedAttackers));
  const uniqueReused = Array.from(new Set(reusedAttackers.filter(idx => idx !== anchor)));
  const centerPreference = genCenterDirectionBonus(anchor, attackPoints);

  // options.reuseBonus / centerBonus 已換算成 0～99 的權重增量。
  // 設定 100% 時，一顆沿用攻子或滿分朝天元候選的權重會由 1 變成 100。
  const baseWeight = 1
    + uniqueReused.length * options.reuseBonus
    + centerPreference * options.centerBonus;

  const candidates = [];
  for (const repair of repairVariants) {
    if (rules === 2 && attacker === GEN_BLACK && isFoul(anchor, repair.board)) continue;

    const lineInfo = testLineFour(anchor, direction.line, attacker, repair.board);
    const lineType = lineInfo & GEN_LINE_MASK;
    const sameLineDoubleFour =
      base.materialType === "deadFour" &&
      base.direction &&
      direction.line === base.direction.line;
    let lineFivePoints;

    if (sameLineDoubleFour) {
      if (lineType !== GEN_LINE_DOUBLE_FOUR) continue;
      if (base.finishPoint === fivePoint) continue;
      lineFivePoints = genGetLineFivePointsAfterAnchor(repair.board, anchor, direction, attacker);
      if (!genPointSetEquals(lineFivePoints, [base.finishPoint, fivePoint])) continue;
    } else {
      if (lineType !== GEN_FOUR_NOFREE) continue;
      const actualFive = getBlockFourPoint(anchor, repair.board, lineInfo);
      if (actualFive !== fivePoint) continue;
      lineFivePoints = [actualFive];
    }

    candidates.push({
      board: repair.board,
      nMask: base.nMask.slice(),
      attacker,
      defender,
      rules,
      base,
      rootBase: base.rootBase || base,
      anchor,
      fivePoint,
      direction,
      sign,
      templateId: template.id,
      anchorSlot,
      xPoints,
      attackPoints,
      sameLineDoubleFour,
      lineFivePoints,
      centerPreference,
      liveThreeExtensions: Array.from(repair.liveThreeExtensions || []),
      addedAttackers: uniqueAdded,
      reusedAttackers: uniqueReused,
      removedDefenders,
      addedDefenders: Array.from(new Set(repair.addedDefenders)),
      weight: baseWeight,
    });
  }
  return candidates;
}

function genEnumerateLayerCandidates(base, attacker, rules, options) {
  const results = [];
  for (const anchor of base.anchorCandidates) {
    for (const direction of GEN_DIRECTIONS) {
      for (const sign of [-1, 1]) {
        for (const template of GEN_NEW_FOUR_TEMPLATES) {
          for (const anchorSlot of template.stoneSlots) {
            results.push(...genBuildLayerCandidates(
              base,
              anchor,
              direction,
              sign,
              template,
              anchorSlot,
              attacker,
              rules,
              options
            ));
          }
        }
      }
    }
  }

  const dedup = new Map();
  for (const candidate of results) {
    const key = `${candidate.board.slice(0, 225).join("")}|${candidate.anchor}|${candidate.fivePoint}`;
    const old = dedup.get(key);
    if (!old || old.weight < candidate.weight) dedup.set(key, candidate);
  }
  return Array.from(dedup.values());
}
