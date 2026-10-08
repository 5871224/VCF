"use strict";

// Image move-order controls and responsive styles are native HTML/CSS.
// This module owns pointer presentation and edit gestures.
// The real orderByIndex and all edit history stay in the move-order editor.
(function installImageMoveOrderPresentation() {
  const BOARD_SIZE = 15;
  const OUTER_MARGIN_CELLS = 0.68;

  function install() {
    const panel = document.getElementById("vcf-image-order-panel");
    const sourceCanvas = document.getElementById("source-canvas");
    const canvasWrap = document.querySelector(".vcf-image-order-canvas-wrap");
    const tableWrap = document.querySelector(".vcf-image-order-table-wrap");
    const table = document.getElementById("vcf-image-order-table");
    const currentInput = document.getElementById("vcf-image-order-current");
    const clearButton = document.getElementById("vcf-image-order-clear-selected");
    const toggleButton = document.getElementById("btn-import-move-order");
    if (
      !panel || !sourceCanvas || !canvasWrap || !tableWrap || !table || !currentInput || !clearButton
    ) return;

    const markerLayer = document.getElementById("vcf-image-order-dom-overlay");

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

    function actualBlackForRow(rowElement) {
      const originalNumber = normalizeNumber(rowElement.dataset.number || rowElement.cells[0]?.textContent);
      const originalExpectedBlack = originalNumber % 2 === 1;
      return rowElement.classList.contains("is-invalid") ? !originalExpectedBlack : originalExpectedBlack;
    }

    function displayNumberForRow(rowElement) {
      return normalizeNumber(rowElement.dataset.number || rowElement.cells[0]?.textContent);
    }

    function renderBoardNumbers() {
      markerLayer.replaceChildren();
      if (panel.hidden) return;
      const rows = Array.from(table.tBodies[0]?.rows || []);
      for (const rowElement of rows) {
        if (rowElement.hidden || rowElement.classList.contains("is-missing")) continue;
        const number = displayNumberForRow(rowElement);
        const point = coordinateToPercent(rowElement.cells[2]?.textContent);
        if (!point) continue;
        const marker = document.createElement("span");
        marker.className = "vcf-image-order-board-number";
        marker.textContent = String(number);
        marker.style.left = `${point.x}%`;
        marker.style.top = `${point.y}%`;
        const notationMode = panel.dataset.sourceMode === "notation";
        const actualBlack = notationMode ? number % 2 === 1 : actualBlackForRow(rowElement);
        marker.classList.add(actualBlack ? "is-black" : "is-white");
        if (!notationMode && actualBlack !== (number % 2 === 1)) marker.classList.add("is-invalid");
        markerLayer.appendChild(marker);
      }
    }

    function syncPresentation() {
      const active = !panel.hidden;
      tableWrap.hidden = !active;
      const canvasHeight = Math.round(sourceCanvas.getBoundingClientRect().height);
      tableWrap.style.height = active && canvasHeight > 0 ? `${canvasHeight}px` : "";
      sourceCanvas.style.cursor = active ? cursorFor(normalizeNumber(currentInput.value)) : "";
      renderBoardNumbers();
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

    function findOrderRowAtCanvasEvent(event) {
      const coordinate = eventToCoordinate(event);
      if (!coordinate) return null;
      return Array.from(table.tBodies[0]?.rows || []).find(candidate => (
        !candidate.classList.contains("is-missing") &&
        candidate.cells[2]?.textContent?.trim() === coordinate
      )) || null;
    }

    function clearOrderRow(row) {
      if (!row) return false;
      row.click();
      clearButton.click();
      queueMicrotask(syncPresentation);
      return true;
    }

    function clearOrderAtCanvasEvent(event) {
      return clearOrderRow(findOrderRowAtCanvasEvent(event));
    }

    const TOUCH_CLEAR_HOLD_MS = 550;
    const TOUCH_CLEAR_MOVE_PX = 12;
    let touchHold = null;

    function cancelTouchHold() {
      if (touchHold?.timer) window.clearTimeout(touchHold.timer);
      touchHold = null;
    }

    sourceCanvas.addEventListener("pointerdown", event => {
      if (panel.hidden || event.pointerType !== "touch" || !event.isPrimary) return;
      const row = findOrderRowAtCanvasEvent(event);
      if (!row) {
        cancelTouchHold();
        return;
      }
      cancelTouchHold();
      const pointerId = event.pointerId;
      const startX = event.clientX;
      const startY = event.clientY;
      touchHold = {
        pointerId,
        startX,
        startY,
        triggered: false,
        timer: window.setTimeout(() => {
          if (!touchHold || touchHold.pointerId !== pointerId) return;
          touchHold.triggered = clearOrderRow(row);
          if (touchHold.triggered && navigator.vibrate) navigator.vibrate(20);
        }, TOUCH_CLEAR_HOLD_MS),
      };
    }, true);

    document.addEventListener("pointermove", event => {
      if (!touchHold || event.pointerId !== touchHold.pointerId || touchHold.triggered) return;
      const dx = event.clientX - touchHold.startX;
      const dy = event.clientY - touchHold.startY;
      if (Math.hypot(dx, dy) > TOUCH_CLEAR_MOVE_PX) cancelTouchHold();
    }, true);

    document.addEventListener("pointercancel", event => {
      if (touchHold && event.pointerId === touchHold.pointerId) cancelTouchHold();
    }, true);

    // Desktop right click clears. A completed touch long-press consumes pointerup so
    // the move-order editor cannot immediately place a new number on the cleared point.
    document.addEventListener("pointerup", event => {
      if (touchHold && event.pointerId === touchHold.pointerId) {
        const triggered = touchHold.triggered;
        cancelTouchHold();
        if (triggered) {
          event.preventDefault();
          event.stopImmediatePropagation();
          return;
        }
      }
      if (panel.hidden || event.target !== sourceCanvas || event.button !== 2) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    }, true);

    sourceCanvas.addEventListener("contextmenu", event => {
      if (panel.hidden) return;
      event.preventDefault();
      if (event.pointerType === "touch") return;
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
    const tableObserver = new MutationObserver(() => queueMicrotask(syncPresentation));
    tableObserver.observe(table, { childList:true, subtree:true, attributes:true, attributeFilter:["class", "hidden"] });
    syncPresentation();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", install, { once:true });
  } else {
    install();
  }
})();
