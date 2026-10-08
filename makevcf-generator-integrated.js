"use strict";

(function initIntegratedGenerator() {
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

    const applied = window.VCFWorkbenchRecord?.replacePosition?.(result.board, {
      sideToMove: result.attacker,
      source: "generator",
    });
    if (!applied) {
      genSetStatus("Rapfi 棋盤引擎尚未就緒，無法套用產生題目");
      return;
    }
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

  };

  if (typeof window.vcfRegisterBusyHook === "function") {
    window.vcfRegisterBusyHook("generator-controls", value => {
      const busy = Boolean(value);
      ["btn-generate", "btn-stop", "btn-answer", "btn-npoints", "target-steps", "bonus-reuse", "bonus-center"].forEach(id => {
        const element = genEl(id);
        if (!element) return;
        if (id === "btn-stop") element.disabled = true;
        else element.disabled = busy || ((id === "btn-answer" || id === "btn-npoints") && !genCurrent);
      });
      genInputs("attacker").forEach(input => { input.disabled = busy; });
    });
  }

  window.addEventListener("vcf-board-changed", event => {
    if (event.detail?.source !== "manual" || !genCurrent || genBusy) return;
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
