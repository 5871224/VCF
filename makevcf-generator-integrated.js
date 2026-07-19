"use strict";

(function initIntegratedGenerator() {
  const importPanel = document.getElementById("import-panel");
  const panel = document.createElement("section");
  panel.id = "generator-panel";
  panel.innerHTML = `
    <div class="gen-title-row">
      <h2>VCF 題目產生器</h2>
      <span class="gen-badge">直接套用到上方棋盤</span>
    </div>
    <div class="gen-controls">
      <fieldset>
        <legend>攻方</legend>
        <label><input type="radio" name="gen-attacker" value="1" checked> 黑</label>
        <label><input type="radio" name="gen-attacker" value="2"> 白</label>
      </fieldset>
      <label>生成步數 <input id="gen-target-steps" type="number" min="2" max="10" step="1" value="2"> 步</label>
      <label title="0% 不加權；100% 時每沿用一顆攻子，該候選相對未加成候選提高到 100 倍權重">沿用攻子每顆加成 <input id="gen-bonus-reuse" type="number" min="0" max="100" step="1" value="10">%</label>
      <label title="綜合朝向天元與四顆攻子平均位置距離；100% 且綜合分數滿分時提高到 100 倍權重">朝天元綜合加成 <input id="gen-bonus-center" type="number" min="0" max="100" step="1" value="15">%</label>
    </div>
    <div class="gen-actions">
      <button id="gen-btn-generate">產生 2 步 VCF</button>
      <button id="gen-btn-stop" disabled>停止產生</button>
      <button id="gen-btn-answer" disabled>顯示答案</button>
      <button id="gen-btn-npoints" disabled>顯示 N 點</button>
    </div>
    <div id="gen-status">題目產生器初始化中……</div>
    <div id="gen-details"></div>
    <div class="gen-legend">
      <span><i class="gen-mark gen-both"></i>雙方 N 點</span>
      <span><i class="gen-mark gen-black"></i>黑方 N 點</span>
      <span><i class="gen-mark gen-white"></i>白方 N 點</span>
    </div>
    <p class="gen-note">兩項偏好強度範圍為 0～100%；0% 不加權，100% 完整加成為未加成候選的 100 倍權重。朝天元會同時計算方向與攻子平均位置距離。產生完成後，可直接使用原頁面的分析功能。</p>
  `;
  importPanel.parentNode.insertBefore(panel, importPanel);

  const style = document.createElement("style");
  style.textContent = `
    #generator-panel {
      width: min(100%, 760px);
      padding: 10px;
      border: 1px solid #c9b46f;
      border-radius: 7px;
      background: #fffdf5;
      box-shadow: 0 2px 8px #0001;
    }
    .gen-title-row, .gen-controls, .gen-actions, .gen-legend {
      display: flex;
      align-items: center;
      justify-content: center;
      flex-wrap: wrap;
      gap: 8px 14px;
    }
    .gen-title-row { margin-bottom: 8px; }
    .gen-title-row h2 { font-size: 17px; color: #463819; }
    .gen-badge {
      padding: 2px 8px;
      border-radius: 999px;
      background: #ede3c3;
      color: #69582c;
      font-size: 12px;
    }
    .gen-controls fieldset { border: 0; display: flex; align-items: center; gap: 9px; }
    .gen-controls legend { display: inline; margin-right: 2px; font-weight: 700; }
    .gen-controls label { white-space: nowrap; cursor: pointer; font-size: 14px; }
    #gen-target-steps, #gen-bonus-reuse, #gen-bonus-center {
      width: 65px;
      padding: 5px 7px;
      border: 1px solid #aaa;
      border-radius: 4px;
      text-align: center;
      font-size: 14px;
    }
    .gen-actions { margin-top: 9px; }
    #gen-status {
      margin-top: 9px;
      min-height: 31px;
      padding: 6px 9px;
      border: 1px solid #d5c373;
      border-radius: 4px;
      background: #fff9dc;
      color: #443a22;
      text-align: center;
      font-size: 13px;
      line-height: 1.4;
    }
    #gen-details {
      margin-top: 7px;
      color: #685936;
      font-size: 12px;
      line-height: 1.55;
    }
    #gen-details:empty { display: none; }
    .gen-legend { margin-top: 8px; font-size: 12px; color: #594c30; }
    .gen-legend span { display: inline-flex; align-items: center; gap: 5px; }
    .gen-mark { width: 14px; height: 14px; display: inline-block; border-radius: 2px; }
    .gen-both { background: #2e9f45; border: 2px solid #176729; }
    .gen-black { background: #222; border: 2px solid #d02020; }
    .gen-white { background: #f8f8f8; border: 2px solid #d02020; }
    .gen-note { margin-top: 7px; text-align: center; color: #786a47; font-size: 12px; line-height: 1.45; }
    #board-svg.gen-locked { pointer-events: none; opacity: .88; }
  `;
  document.head.appendChild(style);

  const svg = document.getElementById("board-svg");
  const ns = "http://www.w3.org/2000/svg";
  const nLayer = document.createElementNS(ns, "g");
  nLayer.setAttribute("id", "generator-n-layer");
  nLayer.setAttribute("pointer-events", "none");
  svg.appendChild(nLayer);

  function clearNPoints() {
    while (nLayer.firstChild) nLayer.firstChild.remove();
  }

  function showNPoints(nMask) {
    clearNPoints();
    const markSize = 13;
    for (let idx = 0; idx < 225; idx++) {
      const mask = nMask[idx];
      if (!mask) continue;
      const both = mask === (GEN_NO_BLACK | GEN_NO_WHITE);
      const cx = 22 + (idx % 15) * 34;
      const cy = 22 + Math.floor(idx / 15) * 34;
      const rect = document.createElementNS(ns, "rect");
      rect.setAttribute("x", cx - markSize / 2);
      rect.setAttribute("y", cy - markSize / 2);
      rect.setAttribute("width", markSize);
      rect.setAttribute("height", markSize);
      rect.setAttribute("rx", 2);
      rect.setAttribute("fill", both ? "#2e9f45" : (mask & GEN_NO_BLACK) ? "#222" : "#f8f8f8");
      rect.setAttribute("stroke", both ? "#176729" : "#d02020");
      rect.setAttribute("stroke-width", 2);
      rect.setAttribute("opacity", .92);
      const title = document.createElementNS(ns, "title");
      title.textContent = both ? "雙方 N 點" : (mask & GEN_NO_BLACK) ? "黑方 N 點" : "白方 N 點";
      rect.appendChild(title);
      nLayer.appendChild(rect);
    }
  }

  function updateGeneratorButtons() {
    const answerButton = genEl("btn-answer");
    const nButton = genEl("btn-npoints");
    if (answerButton) {
      answerButton.disabled = !genCurrent || genBusy;
      answerButton.textContent = genShowAnswer ? "隱藏答案" : "顯示答案";
    }
    if (nButton) {
      nButton.disabled = !genCurrent || genBusy;
      nButton.textContent = genShowNPoints ? "隱藏 N 點" : "顯示 N 點";
    }
  }

  function invalidateGeneratedResult(message) {
    genCurrent = null;
    genShowAnswer = false;
    genShowNPoints = false;
    clearNPoints();
    window._clearVCF();
    updateGeneratorButtons();
    if (message) genSetStatus(message);
  }

  function hideGeneratedOverlays() {
    genShowAnswer = false;
    genShowNPoints = false;
    clearNPoints();
    updateGeneratorButtons();
  }

  function resetMainAnalysisState(result) {
    if (typeof resetVcfGroups === "function") resetVcfGroups();
    lastParam = null;
    lastVCFMoves = result ? Array.from(result.moves || []) : null;
    if (result) {
      vcfGroupColor = result.attacker;
      const radio = document.querySelector(`input[name="acolor"][value="${result.attacker}"]`);
      if (radio) radio.checked = true;
    }
    const blockButton = document.getElementById("btn-block-vcf");
    if (blockButton) blockButton.disabled = !lastVCFMoves || !lastVCFMoves.length;
  }

  window.genDraw = function drawGeneratedResult(result) {
    clearNPoints();
    window._clearVCF();
    window._clearAnalysis();
    if (!result) return;

    window._setBoardArr(result.board, result.attacker);
    resetMainAnalysisState(result);
    if (genShowNPoints) showNPoints(result.nMask);
    if (genShowAnswer) window._showVCF(result.moves, result.attacker);
    setStatus(`已將 ${result.attacker === GEN_BLACK ? "黑" : "白"}方 ${result.steps} 步 VCF 題目套用到棋盤`);
  };

  const mainActionIds = [
    "btn-black", "btn-white", "btn-continue", "btn-clear-vcf", "btn-clear",
    "btn-block-vcf", "btn-block-vcf-all", "btn-multi-vcf", "btn-vcf-prev",
    "btn-vcf-next", "btn-level3", "btn-add-black", "btn-add-white"
  ];

  window.genIntegrationSetBusy = function setGeneratorBusy(value) {
    mainActionIds.forEach(id => {
      const element = document.getElementById(id);
      if (element) element.disabled = value;
    });
    document.querySelectorAll('input[name="rules"], input[name="acolor"]').forEach(input => {
      input.disabled = value;
    });
    document.getElementById("btn-stop").disabled = true;
    svg.classList.toggle("gen-locked", value);

    if (!value && typeof setBusy === "function") setBusy(false);
  };

  const originalMainSetBusy = window.setBusy;
  if (typeof originalMainSetBusy === "function") {
    const wrappedMainSetBusy = function wrappedMainSetBusy(value) {
      originalMainSetBusy(value);
      ["btn-generate", "btn-stop", "btn-answer", "btn-npoints", "target-steps", "bonus-reuse", "bonus-center"].forEach(id => {
        const element = genEl(id);
        if (!element) return;
        if (id === "btn-stop") element.disabled = true;
        else element.disabled = value || ((id === "btn-answer" || id === "btn-npoints") && !genCurrent);
      });
      genInputs("attacker").forEach(input => { input.disabled = value; });
    };
    window.setBusy = wrappedMainSetBusy;
    setBusy = wrappedMainSetBusy;
  }

  svg.addEventListener("click", () => {
    if (!genCurrent || genBusy) return;
    invalidateGeneratedResult("棋盤已手動修改；原產生題目的答案與 N 點已清除");
  });

  document.getElementById("btn-clear-vcf")?.addEventListener("click", hideGeneratedOverlays);
  document.getElementById("btn-clear")?.addEventListener("click", () => {
    invalidateGeneratedResult("棋盤已清空，可重新產生題目");
  });
  document.getElementById("btn-import-apply")?.addEventListener("click", () => {
    invalidateGeneratedResult("已套用匯入棋盤；原產生題目的答案與 N 點已清除");
  });
})();
