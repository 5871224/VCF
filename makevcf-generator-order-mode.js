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