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

function genBuildLayerCandidate(base, anchor, direction, sign, template, anchorSlot, attacker, rules, options) {
  const defender = genOther(attacker);
  const mapped = template.cells.map((_, slot) => genPointFrom(anchor, slot - anchorSlot, direction, sign));
  if (mapped[anchorSlot] !== anchor) return null;

  for (let slot = 0; slot < template.cells.length; slot++) {
    if (template.cells[slot] !== "X" && mapped[slot] === GEN_OUT) return null;
  }

  const board = genCloneBoard(base.board);
  const addedAttackers = [];
  const reusedAttackers = [];
  const removedDefenders = [];
  const addedDefenders = [];

  for (let slot = 0; slot < template.cells.length; slot++) {
    const type = template.cells[slot];
    const idx = mapped[slot];
    if (type === "X") {
      if (idx !== GEN_OUT && board[idx] === attacker) return null;
      continue;
    }
    if (type === "S") {
      if (idx === anchor && slot !== anchorSlot) return null;
      if (board[idx] === attacker) {
        reusedAttackers.push(idx);
      } else if (board[idx] === GEN_EMPTY && !genIsNFor(base.nMask, idx, attacker)) {
        board[idx] = attacker;
        addedAttackers.push(idx);
      } else {
        return null;
      }
      continue;
    }
    if (type === "F") {
      if (genIsNFor(base.nMask, idx, attacker)) return null;
      if (board[idx] === attacker) return null;
      if (board[idx] === defender) {
        board[idx] = GEN_EMPTY;
        removedDefenders.push(idx);
      }
    }
  }

  const fivePoint = mapped[template.fiveSlot];
  if (board[anchor] !== attacker) return null;
  board[anchor] = GEN_EMPTY;

  // 移除 A 後，只在兩個 X 檢查新方向是否留下合法活三；必要時補守方棋。
  for (const xSlot of template.xSlots) {
    const xPoint = mapped[xSlot];
    if (xPoint === GEN_OUT || board[xPoint] === defender) continue;
    if (board[xPoint] === attacker) return null;
    if (genCreatesLegalFreeFour(board, xPoint, direction.line, attacker, rules)) {
      if (genIsNFor(base.nMask, xPoint, defender)) return null;
      board[xPoint] = defender;
      addedDefenders.push(xPoint);
    }
  }

  // A 必須是合法攻擊手，且在指定方向形成死四，唯一防點必須就是「五」。
  if (rules === 2 && attacker === GEN_BLACK && isFoul(anchor, board)) return null;
  const lineInfo = testLineFour(anchor, direction.line, attacker, board);
  if ((lineInfo & GEN_LINE_MASK) !== GEN_FOUR_NOFREE) return null;
  const actualFive = getBlockFourPoint(anchor, board, lineInfo);
  if (actualFive !== fivePoint) return null;

  const uniqueAdded = Array.from(new Set(addedAttackers));
  const uniqueReused = Array.from(new Set(reusedAttackers.filter(idx => idx !== anchor)));
  const relevant = uniqueAdded.length ? uniqueAdded : mapped.filter((idx, slot) => template.cells[slot] === "S" && idx !== anchor);
  let weight = 1;
  if (options.reuseBonus) weight += uniqueReused.length * 0.10;
  if (options.centerBonus) weight += genCenterDirectionBonus(anchor, relevant) * 0.15;

  return {
    board,
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
    xPoints: template.xSlots.map(slot => mapped[slot]),
    addedAttackers: uniqueAdded,
    reusedAttackers: uniqueReused,
    removedDefenders,
    addedDefenders: Array.from(new Set(addedDefenders)),
    weight,
  };
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
            const candidate = genBuildLayerCandidate(base, anchor, direction, sign, template, anchorSlot, attacker, rules, options);
            if (candidate) results.push(candidate);
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
