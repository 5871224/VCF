"use strict";

// ---------------- initial active-three material ----------------
const GEN_BASE_THREE_PATTERNS = [
  {
    id: "straight",
    name: "連續活三",
    text: "留 留 攻 攻 攻 留",
    attackSlots: [2, 3, 4],
    nSlots: [0, 1, 5],
    activeFourSlot: 1,
    finalSlots: [0, 5],
  },
  {
    id: "jump",
    name: "跳活三",
    text: "留 攻 留 攻 攻 留",
    attackSlots: [1, 3, 4],
    nSlots: [0, 2, 5],
    activeFourSlot: 2,
    finalSlots: [0, 5],
  },
];

function genBuildBasePlacements(attacker) {
  const placements = [];
  for (const pattern of GEN_BASE_THREE_PATTERNS) {
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
          for (const slot of pattern.attackSlots) board[points[slot]] = attacker;
          for (const slot of pattern.nSlots) nMask[points[slot]] = GEN_NO_BLACK | GEN_NO_WHITE;

          const meanX = points.reduce((sum, idx) => sum + genX(idx), 0) / points.length;
          const meanY = points.reduce((sum, idx) => sum + genY(idx), 0) / points.length;
          const centerDistance = Math.hypot(meanX - GEN_CENTER.x, meanY - GEN_CENTER.y);
          const weight = 1 / (1 + centerDistance * 0.18);
          const attackPoints = pattern.attackSlots.map(slot => points[slot]);

          placements.push({
            board,
            nMask,
            attacker,
            direction,
            sign,
            points,
            patternId: pattern.id,
            patternName: pattern.name,
            patternText: pattern.text,
            attackPoints,
            anchorCandidates: attackPoints.slice(),
            activeFourPoint: points[pattern.activeFourSlot],
            finalPoints: pattern.finalSlots.map(slot => points[slot]),
            weight,
          });
        }
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
