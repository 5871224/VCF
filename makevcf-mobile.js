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
// the fixed script order. This module owns its responsive/pointer presentation and the
// transient confirmation transaction around "整理缺號". It never creates a second
// orderByIndex; restore is performed through the move-order editor's existing insert API/UI.
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
    const insert1Button = document.getElementById("vcf-image-order-insert-1");
    const insert2Button = document.getElementById("vcf-image-order-insert-2");
    const compactButton = document.getElementById("vcf-image-order-compact");
    const clearButton = document.getElementById("vcf-image-order-clear-selected");
    const orderStatus = document.getElementById("vcf-image-order-status");
    const toggleButton = document.getElementById("btn-import-move-order");
    const applyBoardButton = document.getElementById("btn-import-apply");
    const resetButton = document.getElementById("btn-import-reset");
    const redetectButton = document.getElementById("btn-import-redetect");
    const imageInput = document.getElementById("image-file-input");
    const cameraInput = document.getElementById("camera-file-input");
    const legacyOverlay = document.getElementById("vcf-image-order-overlay");
    if (
      !panel || !sourceCanvas || !canvasWrap || !tableWrap || !table || !currentInput ||
      !insert1Button || !insert2Button || !compactButton || !clearButton || !orderStatus
    ) return;
    if (document.getElementById("vcf-image-order-stage")) return;

    const style = document.createElement("style");
    style.id = "vcf-image-move-order-presentation-style";
    style.textContent = `
      #vcf-image-order-stage{
        display:flex;
        align-items:stretch;
        justify-content:center;
        gap:4px;
        width:min(100%,820px);
        margin:0 auto;
      }
      #vcf-image-order-stage>.vcf-image-order-canvas-wrap{
        flex:1 1 auto;
        width:auto;
        min-width:0;
      }
      #vcf-image-order-stage>.vcf-image-order-canvas-wrap>.import-canvas{
        width:100%;
        height:auto;
      }
      #vcf-image-order-stage>.vcf-image-order-table-wrap{
        flex:0 0 40px;
        width:40px;
        max-height:none;
        overflow-y:auto;
        overflow-x:hidden;
        border:1px solid #cfc4a3;
        border-radius:5px;
        background:#fffdf5;
      }
      #vcf-image-order-stage>.vcf-image-order-table-wrap[hidden]{display:none}
      #vcf-image-order-table{width:100%;font-size:9px;border-collapse:collapse}
      #vcf-image-order-table th:nth-child(2),
      #vcf-image-order-table th:nth-child(3),
      #vcf-image-order-table td:nth-child(2),
      #vcf-image-order-table td:nth-child(3){display:none}
      #vcf-image-order-table thead th{
        padding:3px 1px;
        background:#f7efd8;
        font-size:9px;
        line-height:1.1;
      }
      #vcf-image-order-table tbody tr{
        cursor:pointer;
        background:transparent;
      }
      #vcf-image-order-table tbody tr:not(.is-missing){
        background:#ffe36b;
        box-shadow:inset 2px 0 #e29b00;
      }
      #vcf-image-order-table tbody tr.is-selected{
        background:#79c7ff;
        outline:1px solid #1976c9;
        outline-offset:-1px;
      }
      #vcf-image-order-table tbody tr.is-invalid{
        background:#ffaaa3;
        box-shadow:inset 2px 0 #c4372c;
      }
      #vcf-image-order-table tbody td:first-child{
        display:flex;
        align-items:center;
        justify-content:center;
        width:16px;
        height:16px;
        margin:2px auto;
        padding:0;
        border-radius:50%;
        box-sizing:border-box;
        font-size:8px;
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
        opacity:.52;
      }
      #vcf-image-order-overlay{display:none !important}
      #vcf-image-order-dom-overlay{
        position:absolute;
        inset:0;
        z-index:3;
        pointer-events:none;
        overflow:hidden;
      }
      .vcf-image-order-board-number{
        position:absolute;
        transform:translate(-50%,-50%);
        min-width:1em;
        padding:0;
        font-family:Arial,system-ui,sans-serif;
        font-size:clamp(9px,1.55vw,14px);
        font-weight:800;
        line-height:1;
        text-align:center;
        text-shadow:0 1px 2px rgba(0,0,0,.35);
      }
      .vcf-image-order-board-number.is-black{color:#fff}
      .vcf-image-order-board-number.is-white{color:#111;text-shadow:0 0 2px #fff,0 0 2px #fff}
      .vcf-image-order-board-number.is-invalid{color:#e02b22;text-shadow:0 0 2px #fff,0 0 3px #fff}
      #vcf-image-order-compact-confirm{
        display:flex;
        align-items:center;
        justify-content:center;
        gap:6px;
        margin:6px auto 8px;
        padding:6px 8px;
        width:min(100%,520px);
        border:1px solid #d6a53c;
        border-radius:5px;
        background:#fff4c7;
        font-size:12px;
        font-weight:600;
      }
      #vcf-image-order-compact-confirm[hidden]{display:none !important}
      #vcf-image-order-compact-confirm button{padding:5px 10px;font-size:12px}
      #vcf-image-order-panel.is-compact-confirming #vcf-image-order-table tbody tr{cursor:default}
      @media(max-width:600px){
        #vcf-image-order-stage{gap:3px}
        #vcf-image-order-stage>.vcf-image-order-table-wrap{
          flex-basis:36px;
          width:36px;
        }
        #vcf-image-order-table tbody td:first-child{
          width:15px;
          height:15px;
          margin:1px auto;
          font-size:7px;
        }
        #vcf-image-order-compact-confirm{gap:4px;padding:5px 6px;font-size:11px}
        #vcf-image-order-compact-confirm button{padding:5px 8px;font-size:11px}
      }
    `;
    document.head.appendChild(style);

    const stage = document.createElement("div");
    stage.id = "vcf-image-order-stage";
    canvasWrap.parentNode.insertBefore(stage, canvasWrap);
    stage.append(canvasWrap, tableWrap);

    const markerLayer = document.createElement("div");
    markerLayer.id = "vcf-image-order-dom-overlay";
    canvasWrap.appendChild(markerLayer);
    if (legacyOverlay) legacyOverlay.hidden = true;

    const compactConfirm = document.createElement("div");
    compactConfirm.id = "vcf-image-order-compact-confirm";
    compactConfirm.hidden = true;
    compactConfirm.innerHTML = `
      <span>確認整理缺號：</span>
      <button id="vcf-image-order-compact-apply" type="button">套用</button>
      <button id="vcf-image-order-compact-restore" type="button">復原</button>
    `;
    orderStatus.insertAdjacentElement("afterend", compactConfirm);
    const compactApplyButton = compactConfirm.querySelector("#vcf-image-order-compact-apply");
    const compactRestoreButton = compactConfirm.querySelector("#vcf-image-order-compact-restore");

    let compactSnapshot = null;
    let compactPending = false;
    let disabledSnapshot = null;

    function normalizeNumber(value) {
      return Math.max(1, Math.min(999, Math.floor(Number(value) || 1)));
    }

    function cursorFor(number) {
      const black = number % 2 === 1;
      const text = String(number);
      const fontSize = text.length >= 3 ? 9 : text.length === 2 ? 11 : 13;
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><circle cx="16" cy="16" r="13" fill="${black ? "#111" : "#fff"}" stroke="${black ? "#fff" : "#333"}" stroke-width="2"/><text x="16" y="17" text-anchor="middle" dominant-baseline="middle" font-family="Arial,sans-serif" font-size="${fontSize}" font-weight="700" fill="${black ? "#fff" : "#111"}">${text}</text></svg>`;
      return `url("data:image/svg+xml,${encodeURIComponent(svg)}") 16 16, crosshair`;
    }

    function coordinateToPercent(coordinate) {
      const match = /^([A-O])(\d{1,2})$/.exec(String(coordinate || "").trim());
      if (!match) return null;
      const column = match[1].charCodeAt(0) - 65;
      const row = Number(match[2]) - 1;
      if (column < 0 || column >= BOARD_SIZE || row < 0 || row >= BOARD_SIZE) return null;
      const denominator = (BOARD_SIZE - 1) + OUTER_MARGIN_CELLS * 2;
      return {
        x: (OUTER_MARGIN_CELLS + column) / denominator * 100,
        y: (OUTER_MARGIN_CELLS + row) / denominator * 100,
        column,
        row,
      };
    }

    function renderBoardNumbers() {
      markerLayer.replaceChildren();
      if (panel.hidden) return;
      const rows = Array.from(table.tBodies[0]?.rows || []);
      for (const rowElement of rows) {
        if (rowElement.classList.contains("is-missing")) continue;
        const number = normalizeNumber(rowElement.dataset.number || rowElement.cells[0]?.textContent);
        const point = coordinateToPercent(rowElement.cells[2]?.textContent);
        if (!point) continue;
        const marker = document.createElement("span");
        marker.className = "vcf-image-order-board-number";
        marker.textContent = String(number);
        marker.style.left = `${point.x}%`;
        marker.style.top = `${point.y}%`;
        const expectedBlack = number % 2 === 1;
        const actualBlack = rowElement.classList.contains("is-invalid") ? !expectedBlack : expectedBlack;
        marker.classList.add(actualBlack ? "is-black" : "is-white");
        if (rowElement.classList.contains("is-invalid")) marker.classList.add("is-invalid");
        markerLayer.appendChild(marker);
      }
    }

    function syncPresentation() {
      const active = !panel.hidden;
      tableWrap.hidden = !active;
      const canvasHeight = Math.round(sourceCanvas.getBoundingClientRect().height);
      tableWrap.style.height = active && canvasHeight > 0 ? `${canvasHeight}px` : "";
      sourceCanvas.style.cursor = active && !compactPending ? cursorFor(normalizeNumber(currentInput.value)) : "";
      renderBoardNumbers();
    }

    function assignedNumbersFromTable() {
      return Array.from(table.tBodies[0]?.rows || [])
        .filter(row => !row.classList.contains("is-missing"))
        .map(row => Number(row.dataset.number))
        .filter(number => Number.isInteger(number) && number > 0)
        .sort((a, b) => a - b);
    }

    function captureCompactSnapshot() {
      const assignedNumbers = assignedNumbersFromTable();
      if (!assignedNumbers.length) return null;
      const changesNumbers = assignedNumbers.some((number, index) => number !== index + 1);
      if (!changesNumbers) return null;
      const selectedRow = Array.from(table.tBodies[0]?.rows || []).find(row => row.classList.contains("is-selected"));
      return {
        assignedNumbers,
        currentNumber: normalizeNumber(currentInput.value),
        selectedNumber: Number(selectedRow?.dataset.number) || 0,
      };
    }

    function setCompactInteractionLock(locked) {
      const targets = [currentInput, insert1Button, insert2Button, compactButton, clearButton, toggleButton, applyBoardButton].filter(Boolean);
      if (locked) {
        if (!disabledSnapshot) disabledSnapshot = new Map(targets.map(element => [element, element.disabled]));
        for (const element of targets) element.disabled = true;
        document.activeElement?.blur?.();
        panel.classList.add("is-compact-confirming");
        return;
      }
      if (disabledSnapshot) {
        for (const [element, disabled] of disabledSnapshot) element.disabled = disabled;
      }
      disabledSnapshot = null;
      panel.classList.remove("is-compact-confirming");
    }

    function beginCompactConfirmation(snapshot) {
      if (!snapshot) return;
      compactSnapshot = snapshot;
      compactPending = true;
      compactConfirm.hidden = false;
      setCompactInteractionLock(true);
      syncPresentation();
    }

    function finishCompactConfirmation() {
      compactPending = false;
      compactSnapshot = null;
      compactConfirm.hidden = true;
      setCompactInteractionLock(false);
      syncPresentation();
    }

    function selectOrderNumber(number) {
      const row = table.querySelector(`tbody tr[data-number="${number}"]`);
      if (!row) return false;
      row.click();
      return true;
    }

    function restoreCompactSnapshot() {
      const snapshot = compactSnapshot;
      if (!snapshot) return;
      setCompactInteractionLock(false);

      let previousOriginal = 0;
      for (const originalNumber of snapshot.assignedNumbers) {
        let gap = originalNumber - previousOriginal - 1;
        if (gap > 0) {
          const target = previousOriginal + 1;
          if (!selectOrderNumber(target)) break;
          while (gap >= 2) {
            insert2Button.click();
            gap -= 2;
          }
          if (gap === 1) insert1Button.click();
        }
        previousOriginal = originalNumber;
      }

      if (snapshot.selectedNumber > 0) selectOrderNumber(snapshot.selectedNumber);
      currentInput.value = String(snapshot.currentNumber);
      currentInput.dispatchEvent(new Event("change", { bubbles: true }));

      compactPending = false;
      compactSnapshot = null;
      compactConfirm.hidden = true;
      syncPresentation();
    }

    function discardCompactConfirmation() {
      if (!compactPending && !compactSnapshot) return;
      compactPending = false;
      compactSnapshot = null;
      compactConfirm.hidden = true;
      setCompactInteractionLock(false);
      syncPresentation();
    }

    function eventToCoordinate(event) {
      const rect = sourceCanvas.getBoundingClientRect();
      if (!rect.width || !rect.height) return "";
      const x = (event.clientX - rect.left) / rect.width;
      const y = (event.clientY - rect.top) / rect.height;
      const denominator = (BOARD_SIZE - 1) + OUTER_MARGIN_CELLS * 2;
      const column = Math.round(x * denominator - OUTER_MARGIN_CELLS);
      const row = Math.round(y * denominator - OUTER_MARGIN_CELLS);
      if (column < 0 || column >= BOARD_SIZE || row < 0 || row >= BOARD_SIZE) return "";
      const centerX = (OUTER_MARGIN_CELLS + column) / denominator;
      const centerY = (OUTER_MARGIN_CELLS + row) / denominator;
      if (Math.abs(x - centerX) > .48 / denominator || Math.abs(y - centerY) > .48 / denominator) return "";
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

    compactButton.addEventListener("click", event => {
      if (compactPending) {
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
      const snapshot = captureCompactSnapshot();
      if (snapshot) queueMicrotask(() => beginCompactConfirmation(snapshot));
    }, true);

    compactApplyButton.addEventListener("click", finishCompactConfirmation);
    compactRestoreButton.addEventListener("click", restoreCompactSnapshot);

    // Intercept source-canvas pointer events before the existing move-order editor when
    // a compact confirmation is pending. Right click remains reserved for clearing.
    document.addEventListener("pointerup", event => {
      if (panel.hidden || event.target !== sourceCanvas) return;
      if (compactPending && event.isTrusted) {
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
      if (event.button !== 2) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    }, true);

    table.addEventListener("click", event => {
      if (!compactPending || !event.isTrusted) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    }, true);

    sourceCanvas.addEventListener("contextmenu", event => {
      if (panel.hidden || compactPending) return;
      event.preventDefault();
      clearOrderAtCanvasEvent(event);
    });

    table.addEventListener("contextmenu", event => {
      if (panel.hidden || compactPending) return;
      const row = event.target.closest("tr[data-number]");
      if (!row || row.classList.contains("is-missing")) return;
      event.preventDefault();
      row.click();
      clearButton.click();
      queueMicrotask(syncPresentation);
    });

    resetButton?.addEventListener("click", discardCompactConfirmation, true);
    redetectButton?.addEventListener("click", discardCompactConfirmation, true);
    imageInput?.addEventListener("change", discardCompactConfirmation, true);
    cameraInput?.addEventListener("change", discardCompactConfirmation, true);

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

    const panelObserver = new MutationObserver(() => {
      if (panel.hidden && compactPending) discardCompactConfirmation();
      syncPresentation();
    });
    panelObserver.observe(panel, { attributes:true, attributeFilter:["hidden"] });
    const tableObserver = new MutationObserver(() => queueMicrotask(syncPresentation));
    tableObserver.observe(table, { childList:true, subtree:true, attributes:true, attributeFilter:["class"] });
    syncPresentation();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", install, { once:true });
  } else {
    install();
  }
})();
