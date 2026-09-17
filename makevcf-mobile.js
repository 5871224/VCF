"use strict";

// Keep the 15x15 board completely visible on narrow mobile screens.
(function applyMobileBoardLayout() {
  const style = document.createElement("style");
  style.dataset.vcfMobileLayout = "true";
  style.textContent = `
    #board-svg {
      width: min(520px, calc(100vw - 24px));
      height: auto;
      aspect-ratio: 1 / 1;
      max-width: 100%;
      flex: 0 0 auto;
    }

    @media (max-width: 600px) {
      body {
        padding: max(6px, env(safe-area-inset-top)) max(6px, env(safe-area-inset-right))
          max(6px, env(safe-area-inset-bottom)) max(6px, env(safe-area-inset-left));
        gap: 7px;
        overflow-x: hidden;
      }

      #board-svg {
        width: min(520px, calc(100vw - 12px - env(safe-area-inset-left) - env(safe-area-inset-right)));
      }

      #status,
      #generator-panel,
      #import-panel {
        width: 100%;
        max-width: 100%;
        min-width: 0;
      }

      #rule-box,
      #analysis-box,
      #btns,
      #btns2 {
        max-width: 100%;
      }
    }
  `;
  document.head.appendChild(style);
})();

// Image move-order mode is created by makevcf-generator-image-import-fix.js later in
// the fixed script order. This module owns only its responsive/pointer presentation:
// it does not modify orderByIndex or create a second move-order state.
(function installImageMoveOrderPresentation() {
  const BOARD_SIZE = 15;
  const OUTER_MARGIN_CELLS = 0.68;

  function install() {
    const panel = document.getElementById("vcf-image-order-panel");
    const sourceCanvas = document.getElementById("source-canvas");
    const canvasWrap = document.querySelector(".vcf-image-order-canvas-wrap");
    const tableWrap = panel?.querySelector(".vcf-image-order-table-wrap");
    const table = document.getElementById("vcf-image-order-table");
    const currentInput = document.getElementById("vcf-image-order-current");
    const clearButton = document.getElementById("vcf-image-order-clear-selected");
    const toggleButton = document.getElementById("btn-import-move-order");
    if (!panel || !sourceCanvas || !canvasWrap || !tableWrap || !table || !currentInput || !clearButton) return;
    if (document.getElementById("vcf-image-order-stage")) return;

    const style = document.createElement("style");
    style.id = "vcf-image-move-order-presentation-style";
    style.textContent = `
      #vcf-image-order-stage{
        display:flex;
        align-items:stretch;
        justify-content:center;
        gap:8px;
        width:min(100%,860px);
        margin:0 auto;
      }
      #vcf-image-order-stage>.vcf-image-order-canvas-wrap{
        flex:1 1 auto;
        width:auto;
        min-width:0;
      }
      #vcf-image-order-stage>.vcf-image-order-table-wrap{
        flex:0 0 62px;
        width:62px;
        max-height:none;
        overflow-y:auto;
        overflow-x:hidden;
        border:1px solid #cfc4a3;
        border-radius:6px;
        background:#fffdf5;
      }
      #vcf-image-order-stage>.vcf-image-order-table-wrap[hidden]{display:none}
      #vcf-image-order-table{width:100%;font-size:12px;border-collapse:collapse}
      #vcf-image-order-table th:nth-child(2),
      #vcf-image-order-table th:nth-child(3),
      #vcf-image-order-table td:nth-child(2),
      #vcf-image-order-table td:nth-child(3){display:none}
      #vcf-image-order-table thead th{
        padding:5px 2px;
        background:#f7efd8;
        font-size:11px;
      }
      #vcf-image-order-table tbody tr{
        cursor:pointer;
        background:transparent;
      }
      #vcf-image-order-table tbody tr:not(.is-missing){
        background:#ffe78a;
        box-shadow:inset 3px 0 #e8a600;
      }
      #vcf-image-order-table tbody tr.is-selected{
        background:#8fd0ff;
        outline:2px solid #1976c9;
        outline-offset:-2px;
      }
      #vcf-image-order-table tbody tr.is-invalid{
        background:#ffb3ad;
        box-shadow:inset 3px 0 #c4372c;
      }
      #vcf-image-order-table tbody td:first-child{
        display:flex;
        align-items:center;
        justify-content:center;
        width:32px;
        height:32px;
        margin:3px auto;
        padding:0;
        border-radius:50%;
        box-sizing:border-box;
        font-weight:800;
        line-height:1;
      }
      #vcf-image-order-table tbody tr:nth-child(odd) td:first-child{
        background:#111;
        color:#fff;
        border:1px solid #000;
      }
      #vcf-image-order-table tbody tr:nth-child(even) td:first-child{
        background:#fff;
        color:#111;
        border:1px solid #555;
      }
      #vcf-image-order-table tbody tr.is-missing td:first-child{
        opacity:.56;
      }
      @media(max-width:600px){
        #vcf-image-order-stage{gap:5px}
        #vcf-image-order-stage>.vcf-image-order-table-wrap{
          flex-basis:52px;
          width:52px;
        }
        #vcf-image-order-table tbody td:first-child{
          width:28px;
          height:28px;
          margin:2px auto;
          font-size:11px;
        }
      }
    `;
    document.head.appendChild(style);

    const stage = document.createElement("div");
    stage.id = "vcf-image-order-stage";
    canvasWrap.parentNode.insertBefore(stage, canvasWrap);
    stage.append(canvasWrap, tableWrap);

    function normalizeNumber(value) {
      return Math.max(1, Math.min(999, Math.floor(Number(value) || 1)));
    }

    function cursorFor(number) {
      const black = number % 2 === 1;
      const text = String(number);
      const fontSize = text.length >= 3 ? 10 : text.length === 2 ? 12 : 14;
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="38" height="38" viewBox="0 0 38 38"><circle cx="19" cy="19" r="16" fill="${black ? "#111" : "#fff"}" stroke="${black ? "#fff" : "#333"}" stroke-width="2"/><text x="19" y="20" text-anchor="middle" dominant-baseline="middle" font-family="Arial,sans-serif" font-size="${fontSize}" font-weight="700" fill="${black ? "#fff" : "#111"}">${text}</text></svg>`;
      return `url("data:image/svg+xml,${encodeURIComponent(svg)}") 19 19, crosshair`;
    }

    function syncPresentation() {
      const active = !panel.hidden;
      tableWrap.hidden = !active;
      const canvasHeight = Math.round(canvasWrap.getBoundingClientRect().height);
      tableWrap.style.height = active && canvasHeight > 0 ? `${canvasHeight}px` : "";
      sourceCanvas.style.cursor = active ? cursorFor(normalizeNumber(currentInput.value)) : "";
    }

    function eventToCoordinate(event) {
      const rect = sourceCanvas.getBoundingClientRect();
      if (!rect.width || !rect.height) return "";
      const x = (event.clientX - rect.left) * sourceCanvas.width / rect.width;
      const y = (event.clientY - rect.top) * sourceCanvas.height / rect.height;
      const denominator = (BOARD_SIZE - 1) + OUTER_MARGIN_CELLS * 2;
      const stepX = sourceCanvas.width / denominator;
      const stepY = sourceCanvas.height / denominator;
      const marginX = stepX * OUTER_MARGIN_CELLS;
      const marginY = stepY * OUTER_MARGIN_CELLS;
      const column = Math.round((x - marginX) / stepX);
      const row = Math.round((y - marginY) / stepY);
      if (column < 0 || column >= BOARD_SIZE || row < 0 || row >= BOARD_SIZE) return "";
      const centerX = marginX + column * stepX;
      const centerY = marginY + row * stepY;
      if (Math.abs(x - centerX) > stepX * .48 || Math.abs(y - centerY) > stepY * .48) return "";
      return `${String.fromCharCode(65 + column)}${row + 1}`;
    }

    function clearOrderAtCanvasEvent(event) {
      const coordinate = eventToCoordinate(event);
      if (!coordinate) return false;
      const row = Array.from(table.tBodies[0]?.rows || []).find(candidate => (
        !candidate.classList.contains("is-missing") &&
        candidate.cells[2]?.textContent?.trim() === coordinate
      ));
      if (!row) return false;
      row.click();
      clearButton.click();
      queueMicrotask(syncPresentation);
      return true;
    }

    // Intercept right-button pointerup at document capture phase before the existing
    // source-canvas pointerup handler can treat it as a new move-order assignment.
    document.addEventListener("pointerup", event => {
      if (panel.hidden || event.target !== sourceCanvas || event.button !== 2) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    }, true);

    sourceCanvas.addEventListener("contextmenu", event => {
      if (panel.hidden) return;
      event.preventDefault();
      clearOrderAtCanvasEvent(event);
    });

    table.addEventListener("contextmenu", event => {
      if (panel.hidden) return;
      const row = event.target.closest("tr[data-number]");
      if (!row || row.classList.contains("is-missing")) return;
      event.preventDefault();
      row.click();
      clearButton.click();
      queueMicrotask(syncPresentation);
    });

    currentInput.addEventListener("input", syncPresentation);
    currentInput.addEventListener("change", () => queueMicrotask(syncPresentation));
    panel.addEventListener("click", () => queueMicrotask(syncPresentation));
    table.addEventListener("click", () => queueMicrotask(syncPresentation));
    toggleButton?.addEventListener("click", () => queueMicrotask(syncPresentation));
    sourceCanvas.addEventListener("pointerup", event => {
      if (event.button === 0) queueMicrotask(syncPresentation);
    });
    sourceCanvas.addEventListener("mouseenter", syncPresentation);
    window.addEventListener("resize", syncPresentation);

    const panelObserver = new MutationObserver(syncPresentation);
    panelObserver.observe(panel, { attributes:true, attributeFilter:["hidden"] });
    syncPresentation();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", install, { once:true });
  } else {
    install();
  }
})();
