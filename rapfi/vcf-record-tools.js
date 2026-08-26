"use strict";

(function initVCFRecordTools(global) {
  const BOARD_SIZE = 15;
  const BOARD_CELLS = BOARD_SIZE * BOARD_SIZE;
  const PAD = 22;
  const CELL = 34;
  const GRID_END = PAD + CELL * (BOARD_SIZE - 1);
  const NS = "http://www.w3.org/2000/svg";
  const SETTINGS_KEY = "vcf_record_tools_v1";
  const TITLE_KEY = "vcf_record_title_v1";
  const ICON_ROOT = "rapfi/record-svg/";

  const board = document.getElementById("board-svg");
  const recordNavigation = document.getElementById("vcf-record-navigation");
  const actions = document.getElementById("vcf-record-navigation-actions");
  const boardCard = document.querySelector(".vcf-board-card");
  const annotationCard = document.querySelector(".vcf-annotation-card");
  if (!board || !recordNavigation || !actions || !boardCard) return;

  const state = {
    editMode: false,
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
      for (const key of Object.keys(state)) {
        if (key in saved) state[key] = saved[key];
      }
      state.reduceNumbers = Math.max(0, Math.floor(Number(state.reduceNumbers) || 0));
      state.hideFirstNumbers = Math.max(0, Math.floor(Number(state.hideFirstNumbers) || 0));
      state.editMode = Boolean(state.editMode);
      state.markerMode = Boolean(state.markerMode && state.editMode);
      state.showNumbers = Boolean(state.showNumbers);
      state.showTitle = state.showTitle !== false;
      state.showComment = state.showComment !== false;
    }
  } catch (_) {}

  function persistSettings() {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(state)); } catch (_) {}
  }

  function status(message) {
    if (typeof global.setStatus === "function") global.setStatus(message);
    else {
      const node = document.getElementById("status");
      if (node) node.textContent = message;
    }
  }

  function makeIconButton(id, icon, label) {
    const button = document.createElement("button");
    button.id = id;
    button.type = "button";
    button.className = "vcf-record-icon-button";
    button.title = label;
    button.setAttribute("aria-label", label);
    const image = document.createElement("img");
    image.src = ICON_ROOT + icon;
    image.alt = "";
    image.draggable = false;
    button.appendChild(image);
    return button;
  }

  function setIcon(button, icon, label) {
    if (!button) return;
    button.classList.add("vcf-record-icon-button");
    button.textContent = "";
    const image = document.createElement("img");
    image.src = ICON_ROOT + icon;
    image.alt = "";
    image.draggable = false;
    button.appendChild(image);
    button.title = label;
    button.setAttribute("aria-label", label);
  }

  const prevBranchButton = document.getElementById("btn-vcf-branch-prev");
  const prevStepButton = document.getElementById("btn-vcf-step-prev");
  const nextStepButton = document.getElementById("btn-vcf-step-next");
  const nextBranchButton = document.getElementById("btn-vcf-branch-next");
  setIcon(prevBranchButton, "double_arrow_left.svg", "前一個分支或起始點");
  setIcon(prevStepButton, "arrow_left.svg", "前一手");
  setIcon(nextStepButton, "arrow_right.svg", "次一手");
  setIcon(nextBranchButton, "double_arrow_right.svg", "次一個分支或末端");

  const photoButton = makeIconButton("btn-record-photo", "photo.svg", "截圖");
  const editButton = makeIconButton("btn-record-edit", "edit.svg", "編輯模式");
  const markerButton = makeIconButton("btn-record-marker", "font.svg", "標記模式");
  const markAButton = makeIconButton("btn-record-mark-a", "Aa.svg", "標記文字 A");
  const markStarButton = makeIconButton("btn-record-mark-star", "star.svg", "標記文字 ★");
  const markArrowButton = makeIconButton("btn-record-mark-arrow", "arrow.svg", "標記文字 →");
  const clearMarkTextButton = makeIconButton("btn-record-mark-clear", "delete.svg", "清空標記欄");
  const deleteBranchButton = makeIconButton("btn-record-delete-branch", "cancel.svg", "刪除目前棋子及之後分支");
  const numbersButton = makeIconButton("btn-record-numbers", "number.svg", "手順開關");
  const settingsButton = makeIconButton("btn-record-settings", "settings.svg", "設定選項");
  const titleToggleButton = makeIconButton("btn-record-title-toggle", "dock_top.svg", "標題欄開關");
  const commentToggleButton = makeIconButton("btn-record-comment-toggle", "dock_left.svg", "解說欄開關");
  const flipButton = makeIconButton("btn-record-flip", "flip.svg", "鏡像盤面");
  const rotateButton = makeIconButton("btn-record-rotate", "rotate_90.svg", "旋轉 90 度盤面");
  const forbiddenButton = makeIconButton("btn-record-forbidden", "forbidden.svg", "顯示禁手");
  const reduceButton = makeIconButton("btn-record-number-reduce", "circle.svg", "設定手順減少值");
  const hideFirstButton = makeIconButton("btn-record-number-hide-first", "circle_n.svg", "設定隱藏前幾手手順");

  const markerInput = document.createElement("input");
  markerInput.id = "vcf-record-marker-text";
  markerInput.type = "text";
  markerInput.maxLength = 12;
  markerInput.value = "A";
  markerInput.placeholder = "標記";
  markerInput.setAttribute("aria-label", "盤面標記文字");
  markerInput.classList.add("vcf-record-marker-control");
  for (const button of [markAButton, markStarButton, markArrowButton, clearMarkTextButton]) {
    button.classList.add("vcf-record-marker-control");
  }

  actions.append(
    photoButton,
    editButton,
    markerButton,
    markerInput,
    markAButton,
    markStarButton,
    markArrowButton,
    clearMarkTextButton,
    deleteBranchButton,
    numbersButton,
    settingsButton,
    titleToggleButton,
    commentToggleButton,
    flipButton,
    rotateButton,
    forbiddenButton,
    reduceButton,
    hideFirstButton,
  );

  const titleWrap = document.createElement("div");
  titleWrap.id = "vcf-record-title-wrap";
  titleWrap.className = "vcf-record-title-wrap";
  const titleInput = document.createElement("input");
  titleInput.id = "vcf-record-title";
  titleInput.type = "text";
  titleInput.placeholder = "棋譜標題";
  titleInput.setAttribute("aria-label", "棋譜標題");
  try { titleInput.value = localStorage.getItem(TITLE_KEY) || ""; } catch (_) {}
  titleWrap.appendChild(titleInput);
  const boardWrap = boardCard.querySelector(".vcf-board-wrap");
  if (boardWrap) boardCard.insertBefore(titleWrap, boardWrap);
  else boardCard.prepend(titleWrap);

  const settingsPanel = document.createElement("div");
  settingsPanel.id = "vcf-record-settings-panel";
  settingsPanel.className = "vcf-record-settings-panel";
  settingsPanel.hidden = true;
  settingsPanel.innerHTML = `
    <label>手順減少值 <input id="vcf-record-number-reduce-value" type="number" min="0" max="999" step="1"></label>
    <label>隱藏前幾手 <input id="vcf-record-number-hide-value" type="number" min="0" max="999" step="1"></label>
  `;
  recordNavigation.appendChild(settingsPanel);
  const reduceInput = settingsPanel.querySelector("#vcf-record-number-reduce-value");
  const hideInput = settingsPanel.querySelector("#vcf-record-number-hide-value");
  reduceInput.value = String(state.reduceNumbers);
  hideInput.value = String(state.hideFirstNumbers);

  const style = document.createElement("style");
  style.id = "vcf-record-tools-style";
  style.textContent = `
    #vcf-record-navigation-actions{grid-template-columns:repeat(auto-fit,minmax(42px,42px));justify-content:center;align-items:center}
    #vcf-record-navigation-actions .vcf-record-icon-button{width:42px;height:42px;min-height:42px;padding:7px;display:inline-flex;align-items:center;justify-content:center}
    .vcf-record-icon-button img{width:100%;height:100%;object-fit:contain;pointer-events:none}
    .vcf-record-icon-button.is-active{background:#cfe1f4!important;border-color:#477aa8!important;box-shadow:inset 0 0 0 1px #477aa8}
    #vcf-record-marker-text{width:76px;height:42px;padding:6px 8px;border:1px solid #c9bea0;border-radius:8px;background:#fff;font:inherit;text-align:center}
    #vcf-record-marker-text:disabled{opacity:.5}
    .vcf-record-title-wrap{margin:0 0 10px}
    .vcf-record-title-wrap input{width:100%;padding:8px 10px;border:1px solid #cfc3a4;border-radius:8px;background:#fffefa;font:inherit;font-size:16px;font-weight:700;text-align:center}
    .vcf-record-settings-panel{display:flex;gap:8px;flex-wrap:wrap;margin-top:9px;padding-top:9px;border-top:1px solid #e1d8c1}
    .vcf-record-settings-panel[hidden]{display:none}
    .vcf-record-settings-panel label{display:inline-flex;align-items:center;gap:6px;font-size:13px;color:#625a48}
    .vcf-record-settings-panel input{width:76px;padding:5px 6px;border:1px solid #cfc3a4;border-radius:6px;background:#fff}
    #vcf-record-text-layer{display:none!important}
    #vcf-record-hand-layer,#vcf-record-marker-layer{pointer-events:none}
    @media(max-width:600px){#vcf-record-navigation-actions{grid-template-columns:repeat(8,38px);gap:5px}#vcf-record-navigation-actions .vcf-record-icon-button{width:38px;height:38px;min-height:38px;padding:6px}#vcf-record-marker-text{width:70px;height:38px}}
  `;
  document.head.appendChild(style);

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
    if (global.VCFImportedRecordAPI?.isActive?.()) {
      global.VCFImportedRecordAPI.setCurrentRecordText?.(text);
    }
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
  }

  function renderHandNumbers() {
    handLayer.replaceChildren();
    if (!state.showNumbers) return;
    const snapshot = global.VCFWorkbenchRecord?.snapshot?.();
    const history = snapshot?.history || [];
    const boardArray = snapshot?.board || global._getArr?.() || [];
    for (let i = 0; i < history.length; i++) {
      const move = Number(history[i]?.index ?? history[i]?.move);
      const ply = i + 1;
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
    editButton.classList.toggle("is-active", state.editMode);
    markerButton.classList.toggle("is-active", state.markerMode);
    numbersButton.classList.toggle("is-active", state.showNumbers);
    titleToggleButton.classList.toggle("is-active", state.showTitle);
    commentToggleButton.classList.toggle("is-active", state.showComment);
    const markerControlsVisible = state.editMode && state.markerMode;
    markerInput.hidden = !markerControlsVisible;
    markerInput.disabled = !markerControlsVisible;
    for (const button of [markAButton, markStarButton, markArrowButton, clearMarkTextButton]) {
      button.hidden = !markerControlsVisible;
      button.disabled = !markerControlsVisible;
    }
    titleWrap.hidden = !state.showTitle;
    if (annotationCard) annotationCard.hidden = !state.showComment;
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

  function addOrReplaceMarker(index) {
    if (index < 0 || index >= BOARD_CELLS) return;
    const markerText = markerInput.value.trim();
    if (!markerText) {
      status("請先輸入標記文字");
      return;
    }
    const current = parseRecordText(currentRecordText());
    const x = index % BOARD_SIZE;
    const y = Math.floor(index / BOARD_SIZE);
    const existing = current.markers.find(item => item.x === x && item.y === y);
    if (existing) existing.text = markerText;
    else current.markers.push({ x, y, text: markerText });
    replaceCurrentRecordText(buildRecordText(current.markers, current.comment));
    renderMarkers();
  }

  function removeMarker(index) {
    if (index < 0 || index >= BOARD_CELLS) return;
    const current = parseRecordText(currentRecordText());
    const x = index % BOARD_SIZE;
    const y = Math.floor(index / BOARD_SIZE);
    const next = current.markers.filter(item => item.x !== x || item.y !== y);
    if (next.length === current.markers.length) return;
    replaceCurrentRecordText(buildRecordText(next, current.comment));
    renderMarkers();
  }

  function appendPass() {
    if (global.VCFImportedRecordAPI?.isActive?.()) {
      if (global.VCFImportedRecordAPI.appendPass?.()) return true;
    }
    return Boolean(global.VCFWorkbenchRecord?.appendPass?.());
  }

  function deleteCurrentAndFollowing() {
    if (global.VCFImportedRecordAPI?.isActive?.()) {
      if (global.VCFImportedRecordAPI.deleteCurrentAndFollowing?.()) return true;
    }
    return Boolean(global.VCFWorkbenchRecord?.deleteCurrentAndFollowing?.());
  }

  function transformRecord(transform) {
    if (global.VCFImportedRecordAPI?.isActive?.()) {
      if (global.VCFImportedRecordAPI.transform?.(transform)) return true;
    }
    return Boolean(global.VCFWorkbenchRecord?.transform?.(transform));
  }

  board.addEventListener("click", event => {
    const point = pointFromEvent(event);
    if (!state.editMode) {
      event.preventDefault();
      event.stopImmediatePropagation();
      nextStepButton?.click();
      return;
    }
    if (state.markerMode) {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (point.index >= 0) addOrReplaceMarker(point.index);
      return;
    }
    if (point.passCorner) {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (appendPass()) status("已加入 PASS 一手");
      return;
    }
    if (point.index >= 0) {
      const currentBoard = global._getArr?.() || [];
      if (Number(currentBoard[point.index])) {
        event.preventDefault();
        event.stopImmediatePropagation();
        status("要刪除棋子請使用刪除目前棋子及後續分支按鈕");
      }
    }
  }, true);

  board.addEventListener("contextmenu", event => {
    event.preventDefault();
    event.stopImmediatePropagation();
    const point = pointFromEvent(event);
    if (state.editMode && state.markerMode && point.index >= 0) {
      removeMarker(point.index);
      return;
    }
    prevStepButton?.click();
  }, true);

  editButton.addEventListener("click", () => {
    state.editMode = !state.editMode;
    if (!state.editMode) state.markerMode = false;
    persistSettings();
    syncUI();
    status(state.editMode ? "編輯模式：可落新子；左下角可 PASS" : "瀏覽模式：左鍵次一手，右鍵前一手");
  });

  markerButton.addEventListener("click", () => {
    if (!state.editMode) state.editMode = true;
    state.markerMode = !state.markerMode;
    persistSettings();
    syncUI();
    status(state.markerMode ? "標記模式：左鍵新增／修改，右鍵刪除標記" : "已離開標記模式");
  });

  markAButton.addEventListener("click", () => { markerInput.value = "A"; markerInput.focus(); });
  markStarButton.addEventListener("click", () => { markerInput.value = "★"; markerInput.focus(); });
  markArrowButton.addEventListener("click", () => { markerInput.value = "→"; markerInput.focus(); });
  clearMarkTextButton.addEventListener("click", () => { markerInput.value = ""; markerInput.focus(); });

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
    renderMarkers(event.detail?.recordText || "");
    renderHandNumbers();
  });
  global.addEventListener("vcf-board-changed", () => queueMicrotask(renderHandNumbers));
  document.getElementById("show-forbidden")?.addEventListener("change", syncUI);

  const observerTarget = document.getElementById("show-forbidden-label");
  if (observerTarget) observerTarget.hidden = true;

  persistSettings();
  syncUI();
})(window);
