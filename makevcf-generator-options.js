"use strict";

// 題目條件、候選偏好與結果摘要只透過正式 Registry 擴充核心。


// ---- makevcf-generator-reuse-bonus.js ----
// Apply the reuse preference to attack stones and existing defender stones.
// Candidate construction is extended through explicit decorators rather than replacing
// genBuildLayerCandidates or genLayerRecord.
(function initGeneratorReuseBonus() {
  if (window.__generatorReuseBonusLoaded) return;
  window.__generatorReuseBonusLoaded = true;
  const bothN = GEN_NO_BLACK | GEN_NO_WHITE;

  function protectCandidateFivePoints(candidate) {
    if (!candidate?.nMask) return;
    for (const idx of new Set([
      candidate.fivePoint,
      ...Array.from(candidate.lineFivePoints || []),
    ])) {
      if (idx >= 0 && idx < 225) candidate.nMask[idx] |= bothN;
    }
  }


  genRegisterCandidateDecorator("reuse-bonus", (candidates, context) => {
    const base = context.base;
    const reuseBonus = Math.max(0, Number(context.options?.reuseBonus) || 0);
    for (const candidate of candidates) {
      protectCandidateFivePoints(candidate);
      const reusedDefenders = new Set();
      for (const idx of candidate.xPoints || []) {
        if (idx >= 0 && idx < 225 && base.board[idx] === candidate.defender) {
          reusedDefenders.add(idx);
        }
      }
      if ((candidate.removedDefenders || []).includes(candidate.fivePoint)) {
        reusedDefenders.add(candidate.fivePoint);
      }
      candidate.reusedDefenders = Array.from(reusedDefenders);
      candidate.weight += reusedDefenders.size * reuseBonus;
    }
    return candidates;
  }, 10);

  genRegisterLayerRecordDecorator("reuse-bonus", (record, candidate) => ({
    ...record,
    reusedDefenders: Array.from(candidate.reusedDefenders || []),
  }), 10);
})();

// 題目產生器政策由 index.html 依固定順序載入。


// ---- makevcf-generator-concentration.js ----
// Replace the old center-direction preference with a board-stone concentration preference.
(function initGeneratorConcentrationBonus() {
  if (window.__generatorConcentrationBonusLoaded) return;
  window.__generatorConcentrationBonusLoaded = true;

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
      Math.hypot(14 - center.x, 14 - center.y),
    );
  }

  function concentrationPreference(board, point) {
    if (point < 0 || point >= 225) return 0;
    const center = stoneCentroid(board);
    const distance = Math.hypot(genX(point) - center.x, genY(point) - center.y);
    const maximum = farthestCornerDistance(center);
    return maximum > 0 ? Math.max(0, Math.min(1, 1 - distance / maximum)) : 1;
  }


  genRegisterCandidateDecorator("concentration", (candidates, context) => {
    const middleSlot = Math.floor(context.template.cells.length / 2);
    const middlePoint = genPointFrom(
      context.anchor,
      middleSlot - context.anchorSlot,
      context.direction,
      context.sign,
    );
    const preference = concentrationPreference(context.base.board, middlePoint);
    const bonus = Math.max(0, Number(context.options?.centerBonus) || 0);
    for (const candidate of candidates) {
      const oldPreference = Math.max(0, Number(candidate.centerPreference) || 0);
      candidate.weight += (preference - oldPreference) * bonus;
      candidate.weight = Math.max(0.0001, candidate.weight);
      candidate.concentrationPreference = preference;
      candidate.templateCenterPoint = middlePoint;
      delete candidate.centerPreference;
    }
    return candidates;
  }, 20);

  genRegisterLayerRecordDecorator("concentration", (record, candidate) => ({
    ...record,
    concentrationPreference: Number(candidate.concentrationPreference || 0),
    templateCenterPoint: candidate.templateCenterPoint,
  }), 20);
})();


// ---- makevcf-generator-order-mode.js ----
// Candidate order is selected once in GenerationContext. genWeightedOrder reads this
// snapshot directly, so this module only owns the control and option registration.
(function initGeneratorOrderMode() {
  if (window.__generatorOrderModeLoaded) return;
  window.__generatorOrderModeLoaded = true;


  genRegisterOptionProvider("order-mode", options => ({
    ...options,
    orderByBonus: Boolean(genEl("order-by-bonus")?.checked),
  }));

  genRegisterBusyHook("order-mode", {
    after(value) {
      const input = genEl("order-by-bonus");
      if (input) input.disabled = Boolean(value);
    },
  });
})();


// ---- makevcf-generator-balance.js ----
// 「補齊黑白子數」只負責最終盤面的輪次平衡。
// 較短 VCF 與其他 VCF 的補守由 defense-points 模組獨立處理。
(function initGeneratorBalanceControls() {
  function countStones(board) {
    let black = 0;
    let white = 0;
    for (let idx = 0; idx < 225; idx++) {
      if (board[idx] === GEN_BLACK) black++;
      else if (board[idx] === GEN_WHITE) white++;
    }
    return { black, white };
  }


  genRegisterOptionProvider("final-balance", options => {
    const balanceInput = genEl("balance-stones");
    const threeInput = genEl("three-multiplier");
    const rawThree = Number(threeInput?.value);
    const threeMultiplier = Number.isFinite(rawThree)
      ? Math.min(1000000, Math.max(0, rawThree))
      : 30;
    if (threeInput) threeInput.value = String(threeMultiplier);

    return {
      ...options,
      balanceStones: Boolean(balanceInput?.checked),
      threeMultiplier,
    };
  });

  genRegisterBusyHook("final-balance", {
    after(value) {
      ["balance-stones", "three-multiplier"].forEach(id => {
        const element = genEl(id);
        if (element) element.disabled = value;
      });
    },
  });

  genRegisterResultPresenter("final-balance", (result, context) => {
    const options = context.options;
    if (!options?.balanceStones || !result) return;
    const details = genEl("details");
    if (!details) return;
    const { black, white } = countStones(result.board);
    const expectedDifference = context.attacker === GEN_BLACK ? 0 : 1;
    const balanced = black - white === expectedDifference;
    const attackerFill = new Set(result.balanceFillAttackers || []).size;
    const defenderFill = new Set(result.balanceFillDefenders || []).size;
    details.textContent += balanced
      ? `；黑白子數已補齊（黑 ${black}、白 ${white}；最後補攻方 ${attackerFill}、守方 ${defenderFill}），三型加成 ${options.threeMultiplier} 倍。`
      : `；⚠ 黑白子數未完成補齊（黑 ${black}、白 ${white}）。`;
  }, 30);
})();


// ---- makevcf-generator-unique.js ----
// "只保留目標 VCF" is a search-policy option. Validation is implemented once in
// makevcf-generator-search-policy.js; this module only owns the control and snapshot.
(function initGeneratorUniqueControl() {
  if (window.__generatorUniqueControlLoaded) return;
  window.__generatorUniqueControlLoaded = true;


  genRegisterOptionProvider("unique-vcf", options => ({
    ...options,
    blockOtherVCF: Boolean(genEl("block-other-vcf")?.checked),
  }));

  genRegisterBusyHook("unique-vcf", {
    after(value) {
      const input = genEl("block-other-vcf");
      if (input) input.disabled = Boolean(value);
    },
  });
})();
