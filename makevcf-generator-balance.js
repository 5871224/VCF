"use strict";

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

  const originalShowResult = genShowResult;
  genShowResult = function showFinalBalanceSummary(
    result,
    targetSteps,
    attacker,
    counters,
    options,
  ) {
    originalShowResult(result, targetSteps, attacker, counters, options);
    if (!options?.balanceStones) return;

    const details = genEl("details");
    if (!details) return;
    const { black, white } = countStones(result.board);
    const expectedDifference = attacker === GEN_BLACK ? 0 : 1;
    const balanced = black - white === expectedDifference;
    details.textContent += balanced
      ? `；黑白子數已補齊（黑 ${black}、白 ${white}），三型加成 ${options.threeMultiplier} 倍。`
      : `；⚠ 黑白子數未完成補齊（黑 ${black}、白 ${white}）。`;
  };
})();
