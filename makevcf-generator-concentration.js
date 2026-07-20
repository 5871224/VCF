"use strict";

// Replace the old center-direction preference with a board-stone concentration preference.
(function initGeneratorConcentrationBonus() {
  if (window.__generatorConcentrationBonusLoaded) return;
  window.__generatorConcentrationBonusLoaded = true;

  function renameConcentrationControl() {
    const input = genEl("bonus-center");
    const label = input?.closest("label");
    if (!label) return;

    for (const node of label.childNodes) {
      if (node === input) break;
      if (node.nodeType === Node.TEXT_NODE) {
        node.nodeValue = "棋子集中加成 ";
        break;
      }
    }
    label.title = "以目前盤面全部黑白棋的座標平均值作為分布中心；死四模板正中間那一點越接近分布中心，加成越高";
  }

  function stoneCentroid(board) {
    let sumX = 0;
    let sumY = 0;
    let count = 0;

    for (let idx = 0; idx < 225; idx++) {
      if (board[idx] !== GEN_BLACK && board[idx] !== GEN_WHITE) continue;
      sumX += genX(idx);
      sumY += genY(idx);
      count++;
    }

    return count
      ? { x: sumX / count, y: sumY / count }
      : { x: GEN_CENTER.x, y: GEN_CENTER.y };
  }

  function farthestCornerDistance(center) {
    return Math.max(
      Math.hypot(center.x, center.y),
      Math.hypot(14 - center.x, center.y),
      Math.hypot(center.x, 14 - center.y),
      Math.hypot(14 - center.x, 14 - center.y)
    );
  }

  function concentrationPreference(board, templateCenterPoint) {
    if (templateCenterPoint < 0 || templateCenterPoint >= 225) return 0;

    const center = stoneCentroid(board);
    const distance = Math.hypot(
      genX(templateCenterPoint) - center.x,
      genY(templateCenterPoint) - center.y
    );
    const maximum = farthestCornerDistance(center);
    return maximum > 0
      ? Math.max(0, Math.min(1, 1 - distance / maximum))
      : 1;
  }

  renameConcentrationControl();

  const originalBuildLayerCandidates = genBuildLayerCandidates;
  genBuildLayerCandidates = function buildLayerCandidatesWithConcentration(
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

    const middleSlot = Math.floor(template.cells.length / 2);
    const middlePoint = genPointFrom(anchor, middleSlot - anchorSlot, direction, sign);
    const preference = concentrationPreference(base.board, middlePoint);
    const bonus = Math.max(0, Number(options?.centerBonus) || 0);

    for (const candidate of candidates) {
      const oldPreference = Math.max(0, Number(candidate.centerPreference) || 0);
      candidate.weight += (preference - oldPreference) * bonus;
      candidate.weight = Math.max(0.0001, candidate.weight);
      candidate.concentrationPreference = preference;
      candidate.templateCenterPoint = middlePoint;
      delete candidate.centerPreference;
    }

    return candidates;
  };

  const originalLayerRecord = genLayerRecord;
  genLayerRecord = function layerRecordWithConcentration(candidate, step) {
    const record = originalLayerRecord(candidate, step);
    record.concentrationPreference = Number(candidate.concentrationPreference || 0);
    record.templateCenterPoint = candidate.templateCenterPoint;
    return record;
  };
})();