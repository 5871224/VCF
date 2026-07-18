"use strict";

// ---------------- initial active-three material ----------------
function genBuildBasePlacements(attacker) {
  const placements = [];
  // 留 留 攻 攻 攻 留；第二個「留」是形成活四的一手，最外兩個「留」是之後的兩個五點。
  for (const direction of GEN_DIRECTIONS) {
    for (const sign of [-1, 1]) {
      for (let start = 0; start < 225; start++) {
        const points = [];
        let valid = true;
        for (let offset = 0; offset < 6; offset++) {
          const idx = genPointFrom(start, offset, direction, sign);
          if (idx === GEN_OUT) { valid = false; break; }
          points.push(idx);
        }
        if (!valid) continue;
        const board = genBoard();
        const nMask = new Uint8Array(225);
        for (const slot of [2, 3, 4]) board[points[slot]] = attacker;
        for (const slot of [0, 1, 5]) nMask[points[slot]] = GEN_NO_BLACK | GEN_NO_WHITE;

        const meanX = points.reduce((sum, idx) => sum + genX(idx), 0) / points.length;
        const meanY = points.reduce((sum, idx) => sum + genY(idx), 0) / points.length;
        const centerDistance = Math.hypot(meanX - GEN_CENTER.x, meanY - GEN_CENTER.y);
        const weight = 1 / (1 + centerDistance * 0.18);
        placements.push({
          board,
          nMask,
          attacker,
          direction,
          sign,
          points,
          attackPoints: [points[2], points[3], points[4]],
          anchorCandidates: [points[2], points[3], points[4]],
          activeFourPoint: points[1],
          finalPoints: [points[0], points[5]],
          weight,
        });
      }
    }
  }
  return placements;
}

function genWeightedPick(items) {
  let total = 0;
  for (const item of items) total += Math.max(0.0001, item.weight || 1);
  let value = Math.random() * total;
  for (const item of items) {
    value -= Math.max(0.0001, item.weight || 1);
    if (value <= 0) return item;
  }
  return items[items.length - 1];
}

function genWeightedOrder(items) {
  return items
    .map(item => ({ item, key: -Math.log(Math.max(Number.MIN_VALUE, Math.random())) / Math.max(0.0001, item.weight || 1) }))
    .sort((a, b) => a.key - b.key)
    .map(entry => entry.item);
}
