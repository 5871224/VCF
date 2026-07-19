"use strict";

// ---------------- initial material ----------------
const GEN_BASE_THREE_PATTERNS = [
  {
    id: "straight",
    materialType: "liveThree",
    name: "連續活三",
    text: "留 留 攻 攻 攻 留",
    attackSlots: [2, 3, 4],
    nSlots: [0, 1, 5],
    activeFourSlot: 1,
    finalSlots: [0, 5],
  },
  {
    id: "jump",
    materialType: "liveThree",
    name: "跳活三",
    text: "留 攻 留 攻 攻 留",
    attackSlots: [1, 3, 4],
    nSlots: [0, 2, 5],
    activeFourSlot: 2,
    finalSlots: [0, 5],
  },
];

const GEN_BASE_DEAD_FOUR_PATTERNS = [
  {
    id: "dead1",
    materialType: "deadFour",
    name: "死四一",
    text: "X 攻 攻 攻 攻 留",
    cells: ["X", "S", "S", "S", "S", "R"],
    referenceSlot: 1,
    attackSlots: [1, 2, 3, 4],
    reserveSlot: 5,
    xSlot: 0,
    forbiddenAnchorSlots: [1],
  },
  {
    id: "dead2",
    materialType: "deadFour",
    name: "死四二",
    text: "攻 攻 攻 留 攻",
    cells: ["S", "S", "S", "R", "S"],
    referenceSlot: 0,
    attackSlots: [0, 1, 2, 4],
    reserveSlot: 3,
    xSlot: -1,
    forbiddenAnchorSlots: [0, 4],
  },
  {
    id: "dead3",
    materialType: "deadFour",
    name: "死四三",
    text: "攻 攻 留 攻 攻",
    cells: ["S", "S", "R", "S", "S"],
    referenceSlot: 0,
    attackSlots: [0, 1, 3, 4],
    reserveSlot: 2,
    xSlot: -1,
    forbiddenAnchorSlots: [0, 4],
  },
];

function genBaseWeight(points) {
  const inside = points.filter(idx => idx !== GEN_OUT);
  const meanX = inside.reduce((sum, idx) => sum + genX(idx), 0) / inside.length;
  const meanY = inside.reduce((sum, idx) => sum + genY(idx), 0) / inside.length;
  const centerDistance = Math.hypot(meanX - GEN_CENTER.x, meanY - GEN_CENTER.y);
  return 1 / (1 + centerDistance * 0.18);
}

function genBuildLiveThreePlacements(attacker) {
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
          const attackPoints = pattern.attackSlots.map(slot => points[slot]);

          placements.push({
            board,
            nMask,
            attacker,
            materialType: pattern.materialType,
            direction,
            sign,
            points,
            patternId: pattern.id,
            patternName: pattern.name,
            patternText: pattern.text,
            attackPoints,
            anchorCandidates: attackPoints.slice(),
            forbiddenAnchorPoints: [],
            activeFourPoint: points[pattern.activeFourSlot],
            finalPoints: pattern.finalSlots.map(slot => points[slot]),
            finishPoint: null,
            weight: genBaseWeight(points),
          });
        }
      }
    }
  }
  return placements;
}

function genBuildDeadFourPlacements(attacker, rules) {
  // 有禁手且黑方進攻時，A 下回會同時形成新舊兩個四，屬四四禁手。
  if (rules === 2 && attacker === GEN_BLACK) return [];

  const defender = genOther(attacker);
  const placements = [];
  for (const pattern of GEN_BASE_DEAD_FOUR_PATTERNS) {
    for (const direction of GEN_DIRECTIONS) {
      for (const sign of [-1, 1]) {
        for (let reference = 0; reference < 225; reference++) {
          const points = pattern.cells.map((_, slot) =>
            genPointFrom(reference, slot - pattern.referenceSlot, direction, sign)
          );

          let valid = true;
          for (let slot = 0; slot < pattern.cells.length; slot++) {
            if (pattern.cells[slot] !== "X" && points[slot] === GEN_OUT) {
              valid = false;
              break;
            }
          }
          if (!valid) continue;

          const board = genBoard();
          const nMask = new Uint8Array(225);
          for (const slot of pattern.attackSlots) board[points[slot]] = attacker;

          const finishPoint = points[pattern.reserveSlot];
          nMask[finishPoint] = GEN_NO_BLACK | GEN_NO_WHITE;

          const xPoints = [];
          if (pattern.xSlot >= 0) {
            const xPoint = points[pattern.xSlot];
            xPoints.push(xPoint);
            if (xPoint !== GEN_OUT) {
              board[xPoint] = defender;
              nMask[xPoint] |= genNoMask(attacker);
            }
          }

          const attackPoints = pattern.attackSlots.map(slot => points[slot]);
          const forbiddenAnchorPoints = pattern.forbiddenAnchorSlots.map(slot => points[slot]);
          const forbiddenSet = new Set(forbiddenAnchorPoints);
          const anchorCandidates = attackPoints.filter(idx => !forbiddenSet.has(idx));
          if (!anchorCandidates.length) continue;

          placements.push({
            board,
            nMask,
            attacker,
            materialType: pattern.materialType,
            direction,
            sign,
            points,
            patternId: pattern.id,
            patternName: pattern.name,
            patternText: pattern.text,
            attackPoints,
            anchorCandidates,
            forbiddenAnchorPoints,
            activeFourPoint: null,
            finalPoints: [],
            finishPoint,
            xPoints,
            weight: genBaseWeight(points),
          });
        }
      }
    }
  }
  return placements;
}

function genBuildBasePlacements(attacker, rules) {
  return [
    ...genBuildLiveThreePlacements(attacker),
    ...genBuildDeadFourPlacements(attacker, rules),
  ];
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
