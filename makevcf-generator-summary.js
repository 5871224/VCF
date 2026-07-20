"use strict";

// Show only the compact generator summary requested by the user.
(function initGeneratorCompactSummary() {
  let details = genEl("details");
  if (!details) {
    const status = genEl("status");
    if (status) {
      details = document.createElement("div");
      details.id = status.id.startsWith("gen-") ? "gen-details" : "details";
      status.insertAdjacentElement("afterend", details);
    }
  }

  const style = document.createElement("style");
  style.dataset.generatorCompactSummary = "true";
  style.textContent = `
    #gen-details, #details {
      display: block !important;
      margin-top: 8px;
      color: #685936;
      font-size: 12px;
      line-height: 1.55;
    }
    #gen-details:empty, #details:empty {
      display: none !important;
    }
  `;
  document.head.appendChild(style);

  const previousShowResult = genShowResult;
  genShowResult = function showCompactSummary(result, targetSteps, attacker, counters, options) {
    previousShowResult(result, targetSteps, attacker, counters, options);

    const output = genEl("details");
    if (!output || !result) return;

    const root = result.rootBase || result.base || {};
    const layers = Array.from(result.layers || []);
    const parts = [];

    const patternName = root.patternName || "未知";
    const patternText = root.patternText ? `（${root.patternText}）` : "";
    parts.push(`初始棋型：${patternName}${patternText}`);

    if (options?.balanceStones) {
      const layerBlocked = layers.reduce(
        (sum, layer) => sum + new Set(layer.autoBlockDefenders || []).size,
        0
      );
      const autoBlocked = layerBlocked || new Set(result.autoBlockDefenders || []).size;
      const filled = new Set(result.balanceFillDefenders || []).size;
      parts.push(`子數補齊：已開啟（封鎖補守子 ${autoBlocked} 顆，最後補齊 ${filled} 顆）`);
    } else {
      parts.push("子數補齊：未開啟");
    }

    if (layers.length) {
      const reuseSummary = layers.map((layer, index) => {
        const addedCount = new Set(layer.addedAttackers || []).size;
        const reusedCount = Math.max(0, 3 - addedCount);
        return `第 ${index + 1} 層 ${reusedCount} 顆`;
      }).join("、");
      parts.push(`各層沿用攻子：${reuseSummary}`);
    } else {
      parts.push("各層沿用攻子：無新增死四層");
    }

    parts.push(`多組 VCF：共 ${Number(result.groupCount || 0)} 組`);
    output.textContent = `${parts.join("；")}。`;
  };
})();
