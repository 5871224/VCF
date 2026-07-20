"use strict";

// Show only the compact generator summary requested by the user.
(function initGeneratorCompactSummary() {
  document.querySelector("#generator-panel .gen-badge")?.remove();

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
      line-height: 1.65;
      white-space: pre-line;
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
    const initialShape = root.materialType === "deadFour" ? "死四" : "活三";

    let balanceLine;
    if (options?.balanceStones) {
      const layerBlocked = layers.reduce(
        (sum, layer) => sum + new Set(layer.autoBlockDefenders || []).size,
        0
      );
      const autoBlocked = layerBlocked || new Set(result.autoBlockDefenders || []).size;
      const filled = new Set(result.balanceFillDefenders || []).size;
      balanceLine = `子數補齊：封鎖補守子 ${autoBlocked} 顆，最後補齊 ${filled} 顆`;
    } else {
      balanceLine = "子數補齊：未開啟";
    }

    const reuseCounts = layers.map(layer => {
      const addedCount = new Set(layer.addedAttackers || []).size;
      return Math.max(0, 3 - addedCount);
    });
    const reuseTotal = reuseCounts.reduce((sum, count) => sum + count, 0);
    const reuseExpression = reuseCounts.length ? reuseCounts.join("+") : "0";

    const candidateGroupCounts = Array.from(result.candidateGroupCounts || [])
      .map(value => Math.max(0, Math.round(Number(value) || 0)));
    const candidateGroupExpression = candidateGroupCounts.length
      ? candidateGroupCounts.join("+")
      : "0";

    let blackCount = 0;
    let whiteCount = 0;
    const board = Array.from(result.board || []).slice(0, 225);
    for (const stone of board) {
      if (stone === GEN_BLACK) blackCount++;
      else if (stone === GEN_WHITE) whiteCount++;
    }

    output.textContent = [
      `初始棋型：${initialShape}`,
      balanceLine,
      `沿用攻子：${reuseExpression}＝${reuseTotal}`,
      `候選組數：${candidateGroupExpression}`,
      `雙方子數：黑${blackCount}、白${whiteCount}`,
      `多組 VCF：共 ${Number(result.groupCount || 0)} 組`,
    ].join("\n");
  };
})();
