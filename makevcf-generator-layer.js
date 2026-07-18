"use strict";

// ---------------- new closed-four layer ----------------
function genCreatesLegalFreeFour(board, idx, lineDirection, attacker, rules) {
  if (idx === GEN_OUT || board[idx] !== GEN_EMPTY) return false;
  if (rules === 2 && attacker === GEN_BLACK && isFoul(idx, board)) return false;
  const info = testLineFour(idx, lineDirection, attacker, board);
  return (info & GEN_LINE_MASK) === GEN_FOUR_FREE;
}

function genCenterDirectionBonus(anchor, relevantPoints) {
  if (!relevantPoints.length) return 0;
  const ax = genX(anchor);
  const ay = genY(anchor);
  const gx = relevantPoints.reduce((sum, idx) => sum + genX(idx), 0) / relevantPoints.length - ax;
  const gy = relevantPoints.reduce((sum, idx) => sum + genY(idx), 0) / relevantPoints.length - ay;
  const cx = GEN_CENTER.x - ax;
  const cy = GEN_CENTER.y - ay;
  const gl = Math.hypot(gx, gy);
  const cl = Math.hypot(cx, cy);
  if (!gl || !cl) return 0;
  return Math.max(0, (gx * cx + gy * cy) / (gl * cl));
}

function genGetNewLiveThreeExtensions(board, scanPoints, lineDirection, attacker, rules) {
  const result = [];
  for (const idx of scanPoints) {
    if (genCreatesLegalFreeFour(board, idx, lineDirection, attacker, rules)) result.push(idx);
  }
  return result;
}

function genBuildRepairVariants(board, scanPoints, xPoints, direction, attacker, defender, rules, nMask) {
  // 套入死四並拿掉 A 後，掃描整個新死四範圍，而不是只試兩個 X。
  // 只要其中任一空點能讓攻方形成合法活四，就表示新材料仍是一個活三。
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

  // 活三只能在 X 補守方棋；左、右及兩邊都補都實際試算。
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
  const relevant = uniqueAdded.length
    ? uniqueAdded
    : mapped.filter((idx, slot) => template.cells[slot] === "S" && idx !== anchor);
  let baseWeight = 1;
  if (options.reuseBonus) baseWeight += uniqueReused.length * 0.10;
  if (options.centerBonus) baseWeight += genCenterDirectionBonus(anchor, relevant) * 0.15;

  const candidates = [];
  for (const repair of repairVariants) {
    // A 必須是合法攻擊手，且在指定方向形成死四，唯一防點必須就是「五」。
    if (rules === 2 && attacker === GEN_BLACK && isFoul(anchor, repair.board)) continue;
    const lineInfo = testLineFour(anchor, direction.line, attacker, repair.board);
    if ((lineInfo & GEN_LINE_MASK) !== GEN_FOUR_NOFREE) continue;
    const actualFive = getBlockFourPoint(anchor, repair.board, lineInfo);
    if (actualFive !== fivePoint) continue;

    candidates.push({
      board: repair.board,
      nMask: base.nMask.slice(),
      attacker,
      defender,
      rules,
      base,
      anchor,
      fivePoint,
      direction,
      sign,
      templateId: template.id,
      anchorSlot,
      xPoints,
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
      // 第一版要求新死四與初始活三使用不同方向。
      if (direction.line === base.direction.line) continue;
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

  // 同一最終盤面只保留權重最高的生成方式，避免重複做昂貴的 VCF 搜尋。
  const dedup = new Map();
  for (const candidate of results) {
    const key = `${candidate.board.slice(0, 225).join("")}|${candidate.anchor}|${candidate.fivePoint}`;
    const old = dedup.get(key);
    if (!old || old.weight < candidate.weight) dedup.set(key, candidate);
  }
  return Array.from(dedup.values());
}
