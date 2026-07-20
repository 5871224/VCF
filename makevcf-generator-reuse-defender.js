"use strict";

// Extend the reuse preference so existing defender stones in template X/F cells
// receive the same bonus as reused attacker stones.
(function initGeneratorDefenderReuseBonus() {
  const originalBuildLayerCandidates = genBuildLayerCandidates;

  genBuildLayerCandidates = function buildLayerCandidatesWithDefenderReuse(
    base,
    anchor,
    direction,
    sign,
    template,
    anchorSlot,
    attacker,
    rules,
    options
  ) {
    const candidates = originalBuildLayerCandidates(
      base,
      anchor,
      direction,
      sign,
      template,
      anchorSlot,
      attacker,
      rules,
      options
    );

    for (const candidate of candidates) {
      const addedDefenders = new Set(candidate.addedDefenders || []);
      const reusedDefenders = new Set();

      // Template X endpoints may reuse defender stones already on the board.
      for (const idx of candidate.xPoints || []) {
        if (
          idx >= 0 &&
          idx < 225 &&
          candidate.board[idx] === candidate.defender &&
          !addedDefenders.has(idx)
        ) {
          reusedDefenders.add(idx);
        }
      }

      // A defender already occupying the template F (five) point is temporarily
      // removed for route validation, but remains an existing reused stone.
      if ((candidate.removedDefenders || []).includes(candidate.fivePoint)) {
        reusedDefenders.add(candidate.fivePoint);
      }

      candidate.reusedDefenders = Array.from(reusedDefenders);
      candidate.weight += reusedDefenders.size * (options?.reuseBonus || 0);
    }

    return candidates;
  };

  const originalLayerRecord = genLayerRecord;
  genLayerRecord = function layerRecordWithDefenderReuse(candidate, step) {
    const record = originalLayerRecord(candidate, step);
    record.reusedDefenders = Array.from(candidate.reusedDefenders || []);
    return record;
  };

  const input = genEl("bonus-reuse");
  const label = input?.closest("label");
  if (label) {
    const leadingText = Array.from(label.childNodes)
      .find(node => node.nodeType === Node.TEXT_NODE && node.textContent.trim());
    if (leadingText) leadingText.textContent = "沿用棋子加成 ";
    label.title = "攻方棋，以及死四模板 X 點或五點原有的守方棋，都依沿用顆數套用相同加成；0% 不加權，100% 時每顆完整加成為 100 倍權重";
  }
})();
