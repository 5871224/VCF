"use strict";

(function initVCFRecordTools(global) {
  const BOARD_SIZE = 15;
  const BOARD_CELLS = BOARD_SIZE * BOARD_SIZE;
  const PAD = 22;
  const CELL = 34;
  const GRID_END = PAD + CELL * (BOARD_SIZE - 1);
  const NS = "http://www.w3.org/2000/svg";
  const SETTINGS_KEY = "vcf_record_tools_v1";
  const SETTINGS_VERSION = 3;
  const TITLE_KEY = "vcf_record_title_v1";

  const board = document.getElementById("board-svg");
  const recordNavigation = document.getElementById("vcf-record-navigation");
  const actions = document.getElementById("vcf-record-navigation-actions");
  const boardCard = document.querySelector(".vcf-board-card");
  if (!board || !recordNavigation || !actions || !boardCard) return;

  const state = {
    editMode: true,
    markerMode: false,
    showNumbers: false,
    showTitle: true,
    showComment: true,
    reduceNumbers: 0,
    hideFirstNumbers: 0,
  };

  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "null");
    if (saved && typeof saved === "object") {
      const savedVersion = Math.max(1, Math.floor(Number(saved.version) || 1));
      for (const key of Object.keys(state)) {
        if (key in saved) state[key] = saved[key];
      }
      state.reduceNumbers = Math.max(0, Math.floor(Number(state.reduceNumbers) || 0));
      state.hideFirstNumbers = Math.max(0, Math.floor(Number(state.hideFirstNumbers) || 0));
      state.editMode = Boolean(state.editMode);
      if (savedVersion < SETTINGS_VERSION) state.editMode = true;
      state.markerMode = Boolean(state.markerMode && state.editMode);
      state.showNumbers = Boolean(state.showNumbers);
      state.showTitle = state.showTitle !== false;
      state.showComment = state.showComment !== false;
    }
  } catch (_) {}

  function persistSettings() {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ...state, version: SETTINGS_VERSION })); } catch (_) {}
  }

  function status(message) {
    if (typeof global.setStatus === "function") global.setStatus(message);
    else {
      const node = document.getElementById("status");
      if (node) node.textContent = message;
    }
  }

  const prevStepButton = document.getElementById("btn-vcf-step-prev");
  const nextStepButton = document.getElementById("btn-vcf-step-next");
  const copyRecordButton = document.getElementById("btn-record-copy");
  const photoButton = document.getElementById("btn-record-photo");
  const editButton = document.getElementById("btn-record-edit");
  const markerButton = document.getElementById("btn-record-marker");
  const annotation = global.VCFStaticAnnotations;
  const markerTools = document.getElementById("vcf-static-marker-tools");
  const markerPalette = document.getElementById("vcf-static-marker-palette");
  const fillCheckbox = document.getElementById("vcf-mark-fill");
  const markerHelp = document.getElementById("vcf-static-marker-help");
  let selectedTool = "circle";
  let selectedColor = 0;
  let pendingStart = null;
  const deleteBranchButton = document.getElementById("btn-record-delete-branch");
  const numbersButton = document.getElementById("btn-record-numbers");
  const settingsButton = document.getElementById("btn-record-settings");
  const titleToggleButton = document.getElementById("btn-record-title-toggle");
  const commentToggleButton = document.getElementById("btn-record-comment-toggle");
  const flipButton = document.getElementById("btn-record-flip");
  const rotateButton = document.getElementById("btn-record-rotate");
  const forbiddenButton = document.getElementById("btn-record-forbidden");
  const reduceButton = document.getElementById("btn-record-number-reduce");
  const hideFirstButton = document.getElementById("btn-record-number-hide-first");
  const markerInput = document.getElementById("vcf-record-marker-text");
  const titleInput = document.getElementById("vcf-record-title");
  const settingsPanel = document.getElementById("vcf-record-settings-panel");
  const reduceInput = document.getElementById("vcf-record-number-reduce-value");
  const hideInput = document.getElementById("vcf-record-number-hide-value");
  try { titleInput.value = localStorage.getItem(TITLE_KEY) || ""; } catch (_) {}
  reduceInput.value = String(state.reduceNumbers);
  hideInput.value = String(state.hideFirstNumbers);

  function ensureLayer(id) {
    let layer = board.querySelector(`#${id}`);
    if (!layer) {
      layer = document.createElementNS(NS, "g");
      layer.id = id;
      layer.setAttribute("pointer-events", "none");
      board.appendChild(layer);
    }
    return layer;
  }

  const markerLayer = ensureLayer("vcf-record-marker-layer");
  const handLayer = ensureLayer("vcf-record-hand-layer");
  const staticLayer = ensureLayer("vcf-static-annotation-layer");
  board.insertBefore(staticLayer, handLayer);

  function rapfiHexCoord(char) {
    if (/^[0-9]$/.test(char)) return char.charCodeAt(0) - 48;
    if (/^[A-F]$/i.test(char)) return char.toUpperCase().charCodeAt(0) - 55;
    return -1;
  }

  function hexCoord(value) {
    return Number(value).toString(16).toUpperCase();
  }

  function parseRecordText(text) {
    const raw = String(text || "").replace(/\0+$/g, "");
    const markers = [];
    let comment = raw;
    if (raw.startsWith("@BTXT@")) {
      const separator = raw.indexOf("\b");
      const segment = raw.slice(6, separator >= 0 ? separator : raw.length);
      comment = separator >= 0 ? raw.slice(separator + 1) : "";
      for (const line of segment.split("\n")) {
        if (line.length <= 2) continue;
        const x = rapfiHexCoord(line[0]);
        const y = rapfiHexCoord(line[1]);
        if (x >= 0 && x < BOARD_SIZE && y >= 0 && y < BOARD_SIZE) {
          markers.push({ x, y, text: line.slice(2) });
        }
      }
    }
    return { markers, comment };
  }

  function buildRecordText(markers, comment) {
    const cleanMarkers = Array.from(markers || []).filter(item => {
      return Number.isInteger(item.x) && Number.isInteger(item.y)
        && item.x >= 0 && item.x < BOARD_SIZE && item.y >= 0 && item.y < BOARD_SIZE
        && String(item.text || "").length;
    });
    const encodedComment = String(comment || "");
    if (!cleanMarkers.length) return encodedComment;
    const markerText = cleanMarkers.map(item => `${hexCoord(item.x)}${hexCoord(item.y)}${String(item.text)}`).join("\n");
    return `@BTXT@${markerText}\b${encodedComment}`;
  }

  function currentRecordText() {
    return String(global.VCFWorkbenchRecord?.currentRecordText?.() || "");
  }

  function replaceCurrentRecordText(text) {
    global.VCFWorkbenchRecord?.setCurrentRecordText?.(text);
  }

  function renderMarkers(recordText = currentRecordText()) {
    markerLayer.replaceChildren();
    const { markers } = parseRecordText(recordText);
    for (const item of markers) {
      const cx = PAD + item.x * CELL;
      const cy = PAD + item.y * CELL;
      const circle = document.createElementNS(NS, "circle");
      circle.setAttribute("cx", cx);
      circle.setAttribute("cy", cy);
      circle.setAttribute("r", 10.5);
      circle.setAttribute("fill", "#fff7c2");
      circle.setAttribute("stroke", "#b56b00");
      circle.setAttribute("stroke-width", "1.6");
      markerLayer.appendChild(circle);
      const text = document.createElementNS(NS, "text");
      text.setAttribute("x", cx);
      text.setAttribute("y", cy);
      text.setAttribute("text-anchor", "middle");
      text.setAttribute("dominant-baseline", "central");
      text.setAttribute("font-size", String(item.text).length > 2 ? "8" : "10");
      text.setAttribute("font-weight", "700");
      text.setAttribute("fill", "#6b3b00");
      text.textContent = String(item.text);
      markerLayer.appendChild(text);
    }
    renderStaticMarkers();
  }

  function svgElement(tag, attrs) {
    const node = document.createElementNS(NS, tag);
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
    return node;
  }

  function renderStaticMarkers() {
    staticLayer.replaceChildren();
    if (!annotation) return;
    const marks = annotation.list();
    const defs = svgElement("defs", {});
    annotation.COLORS.forEach((color, i) => {
      const marker = svgElement("marker", { id: "vcf-static-arrow-" + i, markerWidth: 7, markerHeight: 7, refX: 6, refY: 3.5, orient: "auto", markerUnits: "strokeWidth" });
      marker.appendChild(svgElement("path", { d: "M0 0L7 3.5L0 7Z", fill: color }));
      defs.appendChild(marker);
    });
    staticLayer.appendChild(defs);
    const pos = mark => ({ x: PAD + mark.x * CELL, y: PAD + mark.y * CELL });
    for (const mark of marks.filter(mark => mark.type === "line" || mark.type === "arrow")) {
      const from = pos(mark);
      const to = { x: PAD + mark.tx * CELL, y: PAD + mark.ty * CELL };
      const line = svgElement("line", {
        x1: from.x, y1: from.y, x2: to.x, y2: to.y,
        stroke: annotation.COLORS[mark.color], "stroke-width": 3, "stroke-linecap": "round",
        ...(mark.type === "arrow" ? { "marker-end": "url(#vcf-static-arrow-" + mark.color + ")" } : {}),
      });
      staticLayer.appendChild(line);
    }
    for (const mark of marks.filter(mark => mark.type === "circle")) {
      const { x, y } = pos(mark);
      staticLayer.appendChild(svgElement("circle", {
        cx: x, cy: y, r: 16, stroke: annotation.COLORS[mark.color],
        "stroke-width": 2.5, fill: mark.filled ? annotation.COLORS[mark.color] : "none",
        "fill-opacity": mark.filled ? 0.3 : 0,
      }));
    }
    for (const mark of marks.filter(mark => mark.type === "text")) {
      const { x, y } = pos(mark);
      const label = svgElement("text", {
        x, y, "text-anchor": "middle", "dominant-baseline": "central",
        "font-size": 14, "font-weight": 800, fill: annotation.COLORS[mark.color],
        stroke: mark.color === 9 ? "#171717" : "#fff7ed",
        "stroke-opacity": .9, "stroke-width": .7, "paint-order": "stroke",
      });
      label.textContent = mark.text;
      staticLayer.appendChild(label);
    }
    if (pendingStart) {
      staticLayer.appendChild(svgElement("circle", {
        cx: PAD + pendingStart.x * CELL, cy: PAD + pendingStart.y * CELL,
        r: 18, fill: "none", stroke: annotation.COLORS[selectedColor],
        "stroke-width": 2, "stroke-dasharray": "3 3",
      }));
    }
  }

  function formatRecordMoveCoordinate(move) {
    const index = Number(move?.index ?? move?.move ?? move);
    if (!Number.isInteger(index) || index < 0 || index >= BOARD_CELLS) return "";
    const col = index % BOARD_SIZE;
    const row = Math.floor(index / BOARD_SIZE);
    return `${String.fromCharCode(97 + col)}${BOARD_SIZE - row}`;
  }

  function currentRecordCoordinateText() {
    const snapshot = global.VCFWorkbenchRecord?.snapshot?.();
    const history = Array.isArray(snapshot?.history) ? snapshot.history : [];
    const basePly = Math.max(0, Math.min(history.length, Number(snapshot?.basePly || 0)));
    const coordinates = history.slice(basePly).map(formatRecordMoveCoordinate).filter(Boolean);
    return { text: coordinates.join(""), pointCount: coordinates.length };
  }

  async function copyTextToClipboard(text) {
    if (global.navigator?.clipboard?.writeText) {
      await global.navigator.clipboard.writeText(text);
      return;
    }
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.left = "-9999px";
    textarea.style.top = "0";
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    let copied = false;
    try {
      copied = typeof document.execCommand === "function" && document.execCommand("copy");
    } finally {
      textarea.remove();
    }
    if (!copied) throw new Error("瀏覽器不允許寫入剪貼簿");
  }

  function renderHandNumbers() {
    handLayer.replaceChildren();
    if (!state.showNumbers) return;
    const snapshot = global.VCFWorkbenchRecord?.snapshot?.();
    const history = snapshot?.history || [];
    const basePly = Math.max(0, Math.min(history.length, Number(snapshot?.basePly || 0)));
    const boardArray = snapshot?.board || global._getArr?.() || [];
    for (let i = basePly; i < history.length; i++) {
      const move = Number(history[i]?.index ?? history[i]?.move);
      const ply = i + 1 - basePly;
      if (move < 0 || move >= BOARD_CELLS) continue;
      if (ply <= state.hideFirstNumbers) continue;
      const label = ply - state.reduceNumbers;
      if (label <= 0) continue;
      const x = move % BOARD_SIZE;
      const y = Math.floor(move / BOARD_SIZE);
      const cx = PAD + x * CELL;
      const cy = PAD + y * CELL;
      const text = document.createElementNS(NS, "text");
      text.setAttribute("x", cx);
      text.setAttribute("y", cy);
      text.setAttribute("text-anchor", "middle");
      text.setAttribute("dominant-baseline", "central");
      text.setAttribute("font-size", label >= 100 ? "8" : label >= 10 ? "10" : "11");
      text.setAttribute("font-weight", "800");
      text.setAttribute("fill", Number(boardArray[move]) === 1 ? "#fff" : "#111");
      text.setAttribute("stroke", Number(boardArray[move]) === 1 ? "#111" : "#fff");
      text.setAttribute("stroke-width", "0.45");
      text.setAttribute("paint-order", "stroke");
      text.textContent = String(label);
      handLayer.appendChild(text);
    }
  }

  function syncUI() {
    const workspace = global.VCFWorkbenchRecord?.workspace?.() || {};
    const puzzleSetup = workspace.mode === "puzzle" && workspace.puzzlePhase === "setup";
    if (puzzleSetup) {
      state.editMode = true;
      state.markerMode = false;
    }
    copyRecordButton.disabled = !workspace.mode || puzzleSetup;
    editButton.classList.toggle("is-active", state.editMode);
    editButton.disabled = !workspace.mode || puzzleSetup;
    markerButton.classList.toggle("is-active", state.markerMode);
    markerButton.disabled = !workspace.mode || puzzleSetup;
    deleteBranchButton.disabled = !workspace.mode || puzzleSetup;
    numbersButton.classList.toggle("is-active", state.showNumbers);
    titleToggleButton.classList.toggle("is-active", state.showTitle);
    commentToggleButton.classList.toggle("is-active", state.showComment);
    const markerControlsVisible = state.editMode && state.markerMode;
    markerTools.hidden = !markerControlsVisible;
    markerInput.disabled = !markerControlsVisible;
    document.documentElement.dataset.vcfRecordTitle = state.showTitle ? "1" : "0";
    document.documentElement.dataset.vcfRecordComment = state.showComment ? "1" : "0";
    const forbidden = document.getElementById("show-forbidden");
    forbiddenButton.classList.toggle("is-active", Boolean(forbidden?.checked));
    renderHandNumbers();
    renderMarkers();
  }

  function pointFromEvent(event) {
    const rect = board.getBoundingClientRect();
    const viewBox = board.viewBox?.baseVal;
    const width = viewBox?.width || 520;
    const height = viewBox?.height || 520;
    const x = (event.clientX - rect.left) * width / rect.width;
    const y = (event.clientY - rect.top) * height / rect.height;
    const col = Math.round((x - PAD) / CELL);
    const row = Math.round((y - PAD) / CELL);
    const nearGrid = col >= 0 && col < BOARD_SIZE && row >= 0 && row < BOARD_SIZE
      && Math.abs(x - (PAD + col * CELL)) <= CELL * 0.48
      && Math.abs(y - (PAD + row * CELL)) <= CELL * 0.48;
    return {
      x,
      y,
      index: nearGrid ? row * BOARD_SIZE + col : -1,
      passCorner: x < PAD && y > GRID_END,
    };
  }

  function refreshMarkerTools() {
    markerTools.querySelectorAll("[data-mark-tool]").forEach(button => {
      button.classList.toggle("is-active", button.dataset.markTool === selectedTool);
    });
    markerTools.querySelector("[data-mark-circle]").hidden = selectedTool !== "circle";
    markerTools.querySelector("[data-mark-text]").hidden = selectedTool !== "text";
    const tips = {
      circle: "點擊交點新增圓圈；右鍵刪除該交點標記",
      text: "輸入單一文字後點擊交點；右鍵刪除",
      line: pendingStart ? "請點擊線條終點；右鍵取消起點" : "先點起點，再點終點",
      arrow: pendingStart ? "請點擊箭頭終點；右鍵取消起點" : "先點起點，再點終點",
      erase: "點擊任一交點移除該交點相關標記",
    };
    markerHelp.textContent = tips[selectedTool];
    markerPalette.querySelectorAll("[data-mark-color]").forEach(button => {
      button.classList.toggle("is-active", Number(button.dataset.markColor) === selectedColor);
      button.setAttribute("aria-pressed", Number(button.dataset.markColor) === selectedColor ? "true" : "false");
    });
    renderStaticMarkers();
  }
  annotation?.COLORS.forEach((color, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.markColor = String(index);
    button.title = ["紅", "橙", "黃", "綠", "青", "藍", "紫", "粉紅", "黑", "白"][index];
    button.setAttribute("aria-label", button.title);
    button.style.backgroundColor = color;
    button.addEventListener("click", () => { selectedColor = index; refreshMarkerTools(); });
    markerPalette.appendChild(button);
  });
  markerTools.addEventListener("click", event => {
    const button = event.target.closest("[data-mark-tool]");
    if (!button) return;
    selectedTool = button.dataset.markTool;
    pendingStart = null;
    refreshMarkerTools();
  });
  markerInput.addEventListener("input", () => {
    markerInput.value = Array.from(markerInput.value).slice(0, 1).join("");
  });
  function applyMarker(index) {
    if (index < 0 || !annotation) return;
    const x = index % BOARD_SIZE;
    const y = Math.floor(index / BOARD_SIZE);
    if (selectedTool === "erase") {
      if (!annotation.eraseAt(x, y)) status("此交點沒有可刪除的標記");
      return;
    }
    if (selectedTool === "line" || selectedTool === "arrow") {
      if (!pendingStart) {
        pendingStart = { x, y };
        refreshMarkerTools();
        return;
      }
      if (pendingStart.x === x && pendingStart.y === y) {
        status("起點和終點不能相同");
        return;
      }
      annotation.setMark({ type: selectedTool, x: pendingStart.x, y: pendingStart.y, tx: x, ty: y, color: selectedColor });
      pendingStart = null;
      refreshMarkerTools();
      return;
    }
    const mark = { type: selectedTool, x, y, color: selectedColor };
    if (selectedTool === "circle") mark.filled = fillCheckbox.checked;
    else {
      mark.text = Array.from(markerInput.value).slice(0, 1).join("");
      if (!mark.text) { status("請先輸入單一文字"); return; }
    }
    annotation.setMark(mark);
  }
  function removeMarker(index) {
    if (pendingStart) {
      pendingStart = null;
      refreshMarkerTools();
    } else if (index >= 0 && annotation) annotation.eraseAt(index % BOARD_SIZE, Math.floor(index / BOARD_SIZE));
  }

  function appendPass() {
    return Boolean(global.VCFWorkbenchRecord?.appendPass?.());
  }

  function deleteCurrentAndFollowing() {
    return Boolean(global.VCFWorkbenchRecord?.deleteCurrentAndFollowing?.());
  }

  function transformRecord(transform) {
    return Boolean(global.VCFWorkbenchRecord?.transform?.(transform));
  }

  board.addEventListener("click", event => {
    const point = pointFromEvent(event);
    const workspace = global.VCFWorkbenchRecord?.workspace?.() || {};
    if (!workspace.mode) {
      event.preventDefault();
      event.stopImmediatePropagation();
      status("請先選擇新增打譜或新增題目");
      return;
    }
    if (workspace.mode === "puzzle" && workspace.puzzlePhase === "setup") {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (point.index >= 0 && !global.VCFWorkbenchRecord?.placePuzzleSetupStone?.(point.index, workspace.setupTool)) {
        status("題目初始盤面無法修改");
      }
      return;
    }
    if (!state.editMode) {
      event.preventDefault();
      event.stopImmediatePropagation();
      nextStepButton?.click();
      return;
    }
    if (state.markerMode) {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (point.index >= 0) applyMarker(point.index);
      return;
    }
    if (point.passCorner) {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (appendPass()) status("已加入 PASS 一手");
      else status("打譜模式固定使用可匯出 YXDB 的交替落子，不加入 PASS");
      return;
    }
    if (point.index >= 0) {
      const currentBoard = global.VCFWorkbenchRecord?.currentBoard?.() || [];
      if (Number(currentBoard[point.index])) {
        event.preventDefault();
        event.stopImmediatePropagation();
        status("要刪除棋子請使用刪除目前棋子及後續分支按鈕");
        return;
      }
      if (!global.VCFWorkbenchRecord?.isActive?.()) {
        event.preventDefault();
        event.stopImmediatePropagation();
        status(global.__vcfRapfiDbFailed
          ? "Rapfi 棋盤引擎載入失敗，請重新整理"
          : "Rapfi 棋盤引擎初始化中，請稍候");
        return;
      }
      event.preventDefault();
      event.stopImmediatePropagation();
      if (!global.VCFWorkbenchRecord?.playAt?.(point.index, "manual")) {
        status("目前棋盤狀態無法落子，請確認棋譜狀態");
      }
    }
  }, true);

  board.addEventListener("contextmenu", event => {
    event.preventDefault();
    event.stopImmediatePropagation();
    const point = pointFromEvent(event);
    const workspace = global.VCFWorkbenchRecord?.workspace?.() || {};
    if (workspace.mode === "puzzle" && workspace.puzzlePhase === "setup") {
      if (point.index >= 0) global.VCFWorkbenchRecord?.placePuzzleSetupStone?.(point.index, 0);
      return;
    }
    if (state.editMode && state.markerMode && point.index >= 0) {
      removeMarker(point.index);
      return;
    }
    prevStepButton?.click();
  }, true);

  editButton.addEventListener("click", () => {
    state.editMode = !state.editMode;
    if (!state.editMode) { state.markerMode = false; pendingStart = null; }
    persistSettings();
    syncUI();
    status(state.editMode ? "編輯模式：可落新子；左下角可 PASS" : "瀏覽模式：左鍵次一手，右鍵前一手");
  });

  markerButton.addEventListener("click", () => {
    if (!state.editMode) state.editMode = true;
    state.markerMode = !state.markerMode;
    pendingStart = null;
    persistSettings();
    syncUI();
    refreshMarkerTools();
    status(state.markerMode ? "標記模式：選類型與顏色後點棋盤，右鍵可刪除" : "已離開標記模式");
  });

  copyRecordButton.addEventListener("click", async () => {
    const { text, pointCount } = currentRecordCoordinateText();
    if (!text) {
      status("目前盤面沒有可複製的棋譜手順");
      return;
    }
    try {
      await copyTextToClipboard(text);
      status(`已複製目前棋譜（${pointCount} 手）`);
    } catch (error) {
      console.error("複製棋譜失敗", error);
      status(`複製棋譜失敗：${error?.message || error}`);
    }
  });

  deleteBranchButton.addEventListener("click", () => {
    if (!state.editMode) {
      status("請先開啟編輯模式");
      return;
    }
    if (!deleteCurrentAndFollowing()) {
      status("目前已在棋譜起始點，沒有可刪除的棋子");
      return;
    }
    status("已刪除目前棋子及其後續分支");
  });

  numbersButton.addEventListener("click", () => {
    state.showNumbers = !state.showNumbers;
    persistSettings();
    syncUI();
  });

  settingsButton.addEventListener("click", () => {
    settingsPanel.hidden = !settingsPanel.hidden;
    settingsButton.classList.toggle("is-active", !settingsPanel.hidden);
  });

  titleToggleButton.addEventListener("click", () => {
    state.showTitle = !state.showTitle;
    persistSettings();
    syncUI();
  });

  commentToggleButton.addEventListener("click", () => {
    state.showComment = !state.showComment;
    persistSettings();
    syncUI();
  });

  flipButton.addEventListener("click", () => {
    if (transformRecord(4)) status("棋譜已左右鏡像");
  });

  rotateButton.addEventListener("click", () => {
    if (transformRecord(1)) status("棋譜已順時針旋轉 90 度");
  });

  forbiddenButton.addEventListener("click", () => {
    const checkbox = document.getElementById("show-forbidden");
    if (!checkbox) return;
    checkbox.checked = !checkbox.checked;
    checkbox.dispatchEvent(new Event("change", { bubbles: true }));
    syncUI();
  });

  reduceButton.addEventListener("click", () => {
    settingsPanel.hidden = false;
    settingsButton.classList.add("is-active");
    reduceInput.focus();
    reduceInput.select();
  });

  hideFirstButton.addEventListener("click", () => {
    settingsPanel.hidden = false;
    settingsButton.classList.add("is-active");
    hideInput.focus();
    hideInput.select();
  });

  function updateNumberSettings() {
    state.reduceNumbers = Math.max(0, Math.floor(Number(reduceInput.value) || 0));
    state.hideFirstNumbers = Math.max(0, Math.floor(Number(hideInput.value) || 0));
    reduceInput.value = String(state.reduceNumbers);
    hideInput.value = String(state.hideFirstNumbers);
    persistSettings();
    renderHandNumbers();
  }
  reduceInput.addEventListener("change", updateNumberSettings);
  hideInput.addEventListener("change", updateNumberSettings);

  titleInput.addEventListener("input", () => {
    try { localStorage.setItem(TITLE_KEY, titleInput.value); } catch (_) {}
  });

  function wrapText(ctx, text, maxWidth) {
    const result = [];
    for (const rawLine of String(text || "").split(/\r?\n/)) {
      if (!rawLine) { result.push(""); continue; }
      let line = "";
      for (const char of rawLine) {
        const candidate = line + char;
        if (line && ctx.measureText(candidate).width > maxWidth) {
          result.push(line);
          line = char;
        } else line = candidate;
      }
      if (line) result.push(line);
    }
    return result;
  }

  async function screenshot() {
    const svgClone = board.cloneNode(true);
    svgClone.setAttribute("width", "1040");
    svgClone.setAttribute("height", "1040");
    svgClone.querySelector("#vcf-record-next-move-layer")?.remove();
    const svgText = new XMLSerializer().serializeToString(svgClone);
    const blob = new Blob([svgText], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const image = new Image();
    try {
      await new Promise((resolve, reject) => {
        image.onload = resolve;
        image.onerror = () => reject(new Error("棋盤 SVG 轉換失敗"));
        image.src = url;
      });
      const title = state.showTitle ? titleInput.value.trim() : "";
      const comment = state.showComment ? String(document.getElementById("vcf-record-comment-input")?.value || "").trim() : "";
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");
      const width = 1080;
      const titleHeight = title ? 72 : 20;
      ctx.font = "28px system-ui, sans-serif";
      const commentLines = comment ? wrapText(ctx, comment, width - 80) : [];
      const commentHeight = commentLines.length ? 34 + commentLines.length * 36 : 20;
      canvas.width = width;
      canvas.height = titleHeight + 1040 + commentHeight;
      ctx.fillStyle = "#f0e8d0";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      if (title) {
        ctx.fillStyle = "#302919";
        ctx.font = "bold 32px system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(title, width / 2, 36);
      }
      ctx.drawImage(image, 20, titleHeight, 1040, 1040);
      if (commentLines.length) {
        ctx.fillStyle = "#302919";
        ctx.font = "28px system-ui, sans-serif";
        ctx.textAlign = "left";
        ctx.textBaseline = "top";
        let y = titleHeight + 1040 + 18;
        for (const line of commentLines) {
          ctx.fillText(line, 40, y);
          y += 36;
        }
      }
      const png = await new Promise((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error("PNG 建立失敗")), "image/png"));
      const pngUrl = URL.createObjectURL(png);
      const a = document.createElement("a");
      const now = new Date();
      const stamp = [now.getFullYear(), String(now.getMonth() + 1).padStart(2, "0"), String(now.getDate()).padStart(2, "0"), "-", String(now.getHours()).padStart(2, "0"), String(now.getMinutes()).padStart(2, "0"), String(now.getSeconds()).padStart(2, "0")].join("");
      a.href = pngUrl;
      a.download = `renju-record-${stamp}.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(pngUrl), 0);
      status("棋盤截圖已建立");
    } catch (error) {
      console.error("棋盤截圖失敗", error);
      status(`截圖失敗：${error?.message || error}`);
    } finally {
      URL.revokeObjectURL(url);
    }
  }
  photoButton.addEventListener("click", screenshot);

  global.addEventListener("vcf-record-state-changed", event => {
    pendingStart = null;
    renderMarkers(event.detail?.recordText || "");
    renderHandNumbers();
  });
  global.addEventListener("vcf-static-annotations-changed", () => renderStaticMarkers());
  global.addEventListener("vcf-board-changed", () => queueMicrotask(renderHandNumbers));
  global.addEventListener("vcf-workspace-mode-changed", syncUI);
  document.getElementById("show-forbidden")?.addEventListener("change", syncUI);

  persistSettings();
  syncUI();
  refreshMarkerTools();
})(window);
