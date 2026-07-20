"use strict";

// Apply the reuse preference to both attack stones and existing defender stones.
(function initGeneratorReuseBonus() {
  if (window.__generatorReuseBonusLoaded) return;
  window.__generatorReuseBonusLoaded = true;

  function renameReuseControl() {
    const input = genEl("bonus-reuse");
    const label = input?.closest("label");
    if (!label) return;

    for (const node of label.childNodes) {
      if (node === input) break;
      if (node.nodeType === Node.TEXT_NODE) {
        node.nodeValue = "沿用棋子加成 ";
        break;
      }
    }
    label.title = "0% 不加權；攻方棋或守方棋每沿用一顆都套用相同加成；100% 時每顆沿用棋使候選權重增加 99";
  }

  renameReuseControl();

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
      const reusedDefenders = Array.from(new Set(
        (candidate.xPoints || []).filter(idx =>
          idx >= 0 &&
          idx < 225 &&
          base.board[idx] === candidate.defender
        )
      ));

      candidate.reusedDefenders = reusedDefenders;
      candidate.weight += reusedDefenders.length * Math.max(0, Number(options?.reuseBonus) || 0);
    }

    return candidates;
  };

  const originalLayerRecord = genLayerRecord;
  genLayerRecord = function layerRecordWithDefenderReuse(candidate, step) {
    const record = originalLayerRecord(candidate, step);
    record.reusedDefenders = Array.from(candidate.reusedDefenders || []);
    return record;
  };
})();
