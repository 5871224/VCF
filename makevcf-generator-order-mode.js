"use strict";

// Allow candidate validation to use either weighted-random order or strict bonus order.
(function initGeneratorOrderMode() {
  if (window.__generatorOrderModeLoaded) return;
  window.__generatorOrderModeLoaded = true;

  let orderByBonus = false;

  function addOrderControl() {
    const referenceInput = genEl("bonus-center") || genEl("bonus-reuse");
    const controls = referenceInput && (referenceInput.closest(".gen-controls") || referenceInput.closest(".controls"));
    if (!controls || genEl("order-by-bonus")) return;

    const integrated = referenceInput.id.startsWith("gen-");
    const label = document.createElement("label");
    label.title = "未勾選時依候選權重隨機排序；勾選後依總加成權重由高到低逐一驗證，同權重隨機排列";
    label.innerHTML = `<input id="${integrated ? "gen-order-by-bonus" : "order-by-bonus"}" type="checkbox"> 依加成高低排序`;
    referenceInput.closest("label")?.insertAdjacentElement("afterend", label);
  }

  addOrderControl();

  // 此檔在抓禁擴充前載入，先保存原本的一般題型產生流程。
  // 所有同步腳本載入完成後，抓禁擴充已覆寫 genFindTwoStep；此時再包成混合模式。
  const normalFindTwoStep = genFindTwoStep;
  setTimeout(() => {
    if (window.__generatorWhiteModeMixInstalled) return;
    const forbiddenFindTwoStep = genFindTwoStep;
    if (typeof forbiddenFindTwoStep !== "function" || forbiddenFindTwoStep === normalFindTwoStep) return;

    window.__generatorWhiteModeMixInstalled = true;
    genFindTwoStep = async function generatorFindWhiteSeedWithMixedModes(
      attacker,
      rules,
      options,
      counters,
      targetSteps,
    ) {
      if (rules === 2 && attacker === GEN_WHITE && genRand(2) === 0) {
        return normalFindTwoStep(attacker, rules, options, counters, targetSteps);
      }
      return forbiddenFindTwoStep(attacker, rules, options, counters, targetSteps);
    };
  }, 0);

  const originalOptions = genOptions;
  genOptions = function generatorOptionsWithOrderMode() {
    const options = originalOptions();
    orderByBonus = Boolean(genEl("order-by-bonus")?.checked);
    return {
      ...options,
      orderByBonus,
    };
  };

  const originalWeightedOrder = genWeightedOrder;
  genWeightedOrder = function generatorCandidateOrder(items) {
    if (!orderByBonus) return originalWeightedOrder(items);

    return Array.from(items || [])
      .map(item => ({
        item,
        weight: Math.max(0.0001, Number(item?.weight) || 1),
        tie: Math.random(),
      }))
      .sort((left, right) => right.weight - left.weight || left.tie - right.tie)
      .map(entry => entry.item);
  };

  const originalSetBusy = genSetBusy;
  genSetBusy = function generatorSetBusyWithOrderMode(value) {
    originalSetBusy(value);
    const input = genEl("order-by-bonus");
    if (input) input.disabled = value;
  };
})();
