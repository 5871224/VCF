"use strict";

// Append a per-layer summary of reused attack stones to the generator result hint.
(function initGeneratorReuseHint() {
  if (typeof genShowResult !== "function") return;

  const originalShowResult = genShowResult;
  genShowResult = function showResultWithReuseCounts(result, targetSteps, attacker, counters, options) {
    originalShowResult(result, targetSteps, attacker, counters, options);

    const details = genEl("details");
    const layers = Array.from(result?.layers || []);
    if (!details || !layers.length) return;

    const summary = layers.map((layer, index) => {
      const addedCount = new Set(layer.addedAttackers || []).size;
      // Each new dead four has three attack stones other than A.
      const reusedCount = Math.max(0, 3 - addedCount);
      return `第 ${index + 1} 層 ${reusedCount} 顆`;
    }).join("、");

    details.textContent += `；各層死四沿用攻子（不含 A）：${summary}。`;
  };
})();
