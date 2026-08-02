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
    label.title = "0% 不加權；攻方棋，以及死四模板 X 點或五點原有的守方棋，每沿用一顆都套用相同加成；100% 時每顆沿用棋使候選權重增加 99";
  }

  function protectCandidateFivePoints(candidate) {
    if (!candidate?.nMask) return;
    for (const idx of new Set([
      candidate.fivePoint,
      ...Array.from(candidate.lineFivePoints || []),
    ])) {
      if (idx >= 0 && idx < 225) candidate.nMask[idx] |= bothN;
    }
  }

  renameReuseControl();

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

// 題目產生器政策由 makevcf.html 依固定順序載入。


// ---- makevcf-generator-concentration.js ----
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

  renameConcentrationControl();

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

  function addOrderControl() {
    const referenceInput = genEl("bonus-center") || genEl("bonus-reuse");
    const controls = referenceInput &&
      (referenceInput.closest(".gen-controls") || referenceInput.closest(".controls"));
    if (!controls || genEl("order-by-bonus")) return;

    const integrated = referenceInput.id.startsWith("gen-");
    const label = document.createElement("label");
    label.title = "未勾選時依候選權重隨機排序；勾選後依總加成權重由高到低逐一驗證，同權重隨機排列";
    label.innerHTML = `<input id="${integrated ? "gen-order-by-bonus" : "order-by-bonus"}" type="checkbox"> 依加成高低排序`;
    referenceInput.closest("label")?.insertAdjacentElement("afterend", label);
  }

  addOrderControl();

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
  function addBalanceControls() {
    const target = genEl("target-steps");
    const controls = target &&
      (target.closest(".gen-controls") || target.closest(".controls"));
    if (!controls || genEl("balance-stones")) return;

    const balanceLabel = document.createElement("label");
    balanceLabel.title =
      "死四延伸及 VCF 驗證完成後，依輪到攻方下棋所需的黑白子數補齊缺少的顏色";
    balanceLabel.innerHTML =
      '<input id="gen-balance-stones" type="checkbox" checked> 補齊黑白子數';

    const threeLabel = document.createElement("label");
    threeLabel.title = "最後補子時，形成活三或死三的權重倍數";
    threeLabel.innerHTML =
      '三型加成 <input id="gen-three-multiplier" type="number" min="0" max="1000000" step="1" value="30"> 倍';

    controls.append(balanceLabel, threeLabel);

    const style = document.createElement("style");
    style.textContent = `
      #gen-three-multiplier {
        width: 72px;
        padding: 5px 7px;
        border: 1px solid #aaa;
        border-radius: 4px;
        text-align: center;
        font-size: 14px;
      }
    `;
    document.head.appendChild(style);
  }

  function countStones(board) {
    let black = 0;
    let white = 0;
    for (let idx = 0; idx < 225; idx++) {
      if (board[idx] === GEN_BLACK) black++;
      else if (board[idx] === GEN_WHITE) white++;
    }
    return { black, white };
  }

  addBalanceControls();

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

  function addUniqueControl() {
    const target = genEl("target-steps");
    const controls = target &&
      (target.closest(".gen-controls") || target.closest(".controls"));
    if (!controls || genEl("block-other-vcf")) return;

    const label = document.createElement("label");
    label.title = "勾選後，除較短 VCF 外，也會封鎖同一步數但完成盤面不同的其他 VCF";
    label.innerHTML = '<input id="gen-block-other-vcf" type="checkbox"> 只保留目標 VCF';
    controls.appendChild(label);
  }

  addUniqueControl();

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
