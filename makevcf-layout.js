"use strict";

// Reorganize the analysis page into clear, responsive cards without changing feature IDs.
(function initVCFCardLayout() {
  if (document.getElementById("vcf-app-shell")) return;

  // rapfi-bitboard-dashboard.js 會在稍後載入時設定舊標題；DOMContentLoaded 再統一
  // 覆寫一次，確保瀏覽器頁籤最後固定顯示正式產品名稱。
  document.title = "五子棋工作台";

  const BOARD_SIZE = 15;
  const BOARD_CELLS = BOARD_SIZE * BOARD_SIZE;
  const BLACK = 1;
  const WHITE = 2;
  const EMPTY = 0;
  const PASS_MOVE = -1;
  const LZ4_FRAME_MAGIC = 0x184d2204;

  const board = document.getElementById("board-svg");
  const ruleBox = document.getElementById("rule-box");
  const mainActions = document.getElementById("btns");
  const analysisBox = document.getElementById("analysis-box");
  const analysisActions = document.getElementById("btns2");
  const status = document.getElementById("status");
  const generatorPanel = document.getElementById("generator-panel");
  const importPanel = document.getElementById("import-panel");
  if (!board || !ruleBox || !mainActions || !analysisBox || !analysisActions || !status) return;

  function makeHeading(title, description) {
    const heading = document.createElement("div");
    heading.className = "vcf-card-heading";
    const text = document.createElement("div");
    const h2 = document.createElement("h2");
    h2.textContent = title;
    const p = document.createElement("p");
    p.textContent = description;
    text.append(h2, p);
    heading.appendChild(text);
    return heading;
  }

  function makeCard(title, description, className) {
    const card = document.createElement("section");
    card.className = `vcf-card ${className || ""}`.trim();
    card.appendChild(makeHeading(title, description));
    return card;
  }

  const app = document.createElement("main");
  app.id = "vcf-app-shell";

  const pageHeader = document.createElement("header");
  pageHeader.className = "vcf-app-header";
  pageHeader.innerHTML = `
    <div>
      <h1>五子棋工作台</h1>
      <p>擺好棋型後，可搜尋、分析、產生題目，並讀取或逐手瀏覽 Rapfi／RenLib 分支棋譜。</p>
    </div>
  `;
  app.appendChild(pageHeader);

  // 工作模式是整個工作台共用控制，不屬於任何功能頁籤；固定掛在頁籤／棋盤版面之外。
  const workspaceModeSlot = document.createElement("div");
  workspaceModeSlot.id = "vcf-workspace-mode-slot";
  workspaceModeSlot.className = "vcf-workspace-mode-slot";
  app.appendChild(workspaceModeSlot);

  const topGrid = document.createElement("div");
  topGrid.className = "vcf-top-grid";

  const boardCard = makeCard("棋盤", "點擊交替放置黑白棋；再次點擊可移除棋子。", "vcf-board-card");
  const boardWrap = document.createElement("div");
  boardWrap.className = "vcf-board-wrap";
  boardWrap.appendChild(board);
  boardCard.append(boardWrap, status);

  const recordNavigation = document.createElement("section");
  recordNavigation.id = "vcf-record-navigation";
  recordNavigation.className = "vcf-record-navigation";
  recordNavigation.innerHTML = `
    <div class="vcf-record-navigation-heading">
      <strong>棋譜導覽</strong>
      <span>只控制棋譜本身；VCF 計算結果由下方「展示計算」另外控制。</span>
    </div>
    <div id="vcf-record-navigation-actions" class="vcf-record-navigation-actions"></div>
  `;
  boardCard.appendChild(recordNavigation);

  const calculationNavigation = document.createElement("section");
  calculationNavigation.id = "vcf-calculation-navigation";
  calculationNavigation.className = "vcf-calculation-navigation";
  calculationNavigation.innerHTML = `
    <div class="vcf-calculation-navigation-heading">
      <div class="vcf-calculation-title-row">
        <strong>展示計算</strong>
        <span id="vcf-calculation-badge" class="vcf-calculation-badge">尚無結果</span>
      </div>
      <span id="vcf-calculation-navigation-state">VCF 計算完成後，可在這裡獨立逐手展示計算結果。</span>
    </div>
    <div id="vcf-calculation-navigation-actions" class="vcf-calculation-navigation-actions"></div>
  `;
  boardCard.appendChild(calculationNavigation);

  const controlStack = document.createElement("div");
  controlStack.className = "vcf-control-stack";

  const annotationCard = makeCard("注釋", "每個盤面各自保存 Rapfi DBRecord 注釋；切換棋譜時同步顯示。", "vcf-annotation-card");
  const recordCommentInput = document.createElement("textarea");
  recordCommentInput.id = "vcf-record-comment-input";
  recordCommentInput.rows = 7;
  recordCommentInput.placeholder = "輸入目前盤面的注釋……";
  recordCommentInput.setAttribute("aria-label", "目前盤面注釋");
  const recordCommentMeta = document.createElement("div");
  recordCommentMeta.id = "vcf-record-comment-meta";
  recordCommentMeta.className = "vcf-record-comment-meta";
  recordCommentMeta.textContent = "注釋會保存到目前盤面的 DBRecord.text。";
  annotationCard.append(recordCommentInput, recordCommentMeta);

  const searchCard = makeCard("基本搜尋", "選擇規則後，直接尋找黑方或白方 VCF。", "vcf-search-card");
  ruleBox.classList.add("vcf-option-row");
  mainActions.classList.add("vcf-action-grid");
  searchCard.append(ruleBox, mainActions);

  const analysisCard = makeCard("進階分析", "針對目前盤面查看防點、多組路線、分支回放與延伸選點。", "vcf-analysis-card");
  analysisBox.classList.add("vcf-option-row");
  analysisActions.classList.add("vcf-action-grid");
  analysisCard.append(analysisBox, analysisActions);

  boardCard.appendChild(annotationCard);
  controlStack.append(searchCard, analysisCard);
  topGrid.append(boardCard, controlStack);
  app.appendChild(topGrid);

  if (generatorPanel) {
    generatorPanel.classList.add("vcf-card", "vcf-generator-card");
    app.appendChild(generatorPanel);
  }

  if (importPanel) {
    importPanel.classList.add("vcf-card", "vcf-import-card");
    if (!importPanel.querySelector(":scope > .vcf-card-heading")) {
      importPanel.prepend(makeHeading("圖片匯入", "從圖片、截圖或手機拍照辨識棋盤，再套用到上方棋盤。"));
    }
    app.appendChild(importPanel);
  }

  document.body.insertBefore(app, document.body.firstChild);

  // Rapfi YXDB／RenLib 都以分支棋譜概念瀏覽；工作台沿用目前單組／多組 VCF
  // 路線作為同一棵分支樹。逐手回放只改 VCF overlay，不修改原始題型盤面。
  const prevStepButton = document.createElement("button");
  prevStepButton.id = "btn-vcf-step-prev";
  prevStepButton.type = "button";
  prevStepButton.textContent = "上一步";
  const nextStepButton = document.createElement("button");
  nextStepButton.id = "btn-vcf-step-next";
  nextStepButton.type = "button";
  nextStepButton.textContent = "下一步";
  const previousBranchButton = document.createElement("button");
  previousBranchButton.id = "btn-vcf-branch-prev";
  previousBranchButton.type = "button";
  previousBranchButton.textContent = "前一分支";
  const nextBranchButton = document.createElement("button");
  nextBranchButton.id = "btn-vcf-branch-next";
  nextBranchButton.type = "button";
  nextBranchButton.textContent = "後一分支";
  const legacyPreviousBranchButton = document.getElementById("btn-vcf-prev");
  const legacyNextBranchButton = document.getElementById("btn-vcf-next");
  if (legacyPreviousBranchButton) legacyPreviousBranchButton.hidden = true;
  if (legacyNextBranchButton) legacyNextBranchButton.hidden = true;
  const recordNavigationActions = document.getElementById("vcf-record-navigation-actions");
  recordNavigationActions?.append(prevStepButton, nextStepButton, previousBranchButton, nextBranchButton);

  const calcPrevGroupButton = document.createElement("button");
  calcPrevGroupButton.id = "btn-vcf-calc-group-prev";
  calcPrevGroupButton.type = "button";
  calcPrevGroupButton.textContent = "上一組";
  const calcNextGroupButton = document.createElement("button");
  calcNextGroupButton.id = "btn-vcf-calc-group-next";
  calcNextGroupButton.type = "button";
  calcNextGroupButton.textContent = "下一組";
  const calcPrevStepButton = document.createElement("button");
  calcPrevStepButton.id = "btn-vcf-calc-step-prev";
  calcPrevStepButton.type = "button";
  calcPrevStepButton.textContent = "計算上一步";
  const calcNextStepButton = document.createElement("button");
  calcNextStepButton.id = "btn-vcf-calc-step-next";
  calcNextStepButton.type = "button";
  calcNextStepButton.textContent = "計算下一步";
  const calcGroupSelect = document.createElement("select");
  calcGroupSelect.id = "vcf-calculation-group-select";
  calcGroupSelect.setAttribute("aria-label", "VCF 計算組別");
  const calculationGroupRow = document.createElement("div");
  calculationGroupRow.className = "vcf-calculation-group-row";
  const calculationGroupLabel = document.createElement("span");
  calculationGroupLabel.textContent = "計算路線";
  calculationGroupRow.append(calculationGroupLabel, calcGroupSelect);
  const calculationNavigationActions = document.getElementById("vcf-calculation-navigation-actions");
  calculationNavigation.insertBefore(calculationGroupRow, calculationNavigationActions || null);
  calculationNavigationActions?.append(calcPrevGroupButton, calcNextGroupButton, calcPrevStepButton, calcNextStepButton);

  let calculationDisplay = {
    groups: [],
    groupIndex: 0,
    color: BLACK,
    ply: 0,
  };

  function renderMarkerLayer(layerId, moves, { stroke, dash = "" } = {}) {
    let layer = board.querySelector(`#${layerId}`);
    if (!layer) {
      layer = document.createElementNS("http://www.w3.org/2000/svg", "g");
      layer.id = layerId;
      layer.setAttribute("pointer-events", "none");
      board.appendChild(layer);
    }
    while (layer.firstChild) layer.firstChild.remove();
    const uniqueMoves = Array.from(new Set(Array.from(moves || [], move => Number(move))))
      .filter(index => Number.isInteger(index) && index >= 0 && index < BOARD_CELLS);
    for (const index of uniqueMoves) {
      const x = index % BOARD_SIZE;
      const y = Math.floor(index / BOARD_SIZE);
      const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      circle.setAttribute("cx", 22 + x * 34);
      circle.setAttribute("cy", 22 + y * 34);
      circle.setAttribute("r", 13);
      circle.setAttribute("fill", "none");
      circle.setAttribute("stroke", stroke);
      circle.setAttribute("stroke-width", "3");
      if (dash) circle.setAttribute("stroke-dasharray", dash);
      circle.setAttribute("vector-effect", "non-scaling-stroke");
      layer.appendChild(circle);
    }
  }

  function renderRecordNextMoveMarkers(moves) {
    renderMarkerLayer("vcf-record-next-move-layer", moves, { stroke: "#1976c9" });
  }

  function renderCalculationNextMoveMarkers(moves) {
    renderMarkerLayer("vcf-calculation-next-move-layer", moves, { stroke: "#d28b00", dash: "5 3" });
  }

  function clearCalculationNextMoveMarkers() {
    renderCalculationNextMoveMarkers([]);
  }

  function currentCalculationRoute() {
    return calculationDisplay.groups[calculationDisplay.groupIndex] || [];
  }

  function calculationGroupsFromEngine() {
    const multi = typeof vcfGroups !== "undefined" && Array.isArray(vcfGroups) && vcfGroups.length
      ? vcfGroups
      : null;
    if (multi) {
      return multi
        .filter(route => route && typeof route.length === "number" && route.length)
        .map(route => Array.from(route, move => Number(move)));
    }
    if (typeof lastVCFMoves !== "undefined" && lastVCFMoves && typeof lastVCFMoves.length === "number" && lastVCFMoves.length) {
      return [Array.from(lastVCFMoves, move => Number(move))];
    }
    return [];
  }

  function resetCalculationDisplay({ clearOverlay = true } = {}) {
    calculationDisplay = { groups: [], groupIndex: 0, color: BLACK, ply: 0 };
    if (clearOverlay) window._clearVCF?.();
    clearCalculationNextMoveMarkers();
    syncCalculationNavigation();
  }

  function captureCalculationResult() {
    const groups = calculationGroupsFromEngine();
    if (!groups.length) {
      resetCalculationDisplay({ clearOverlay: false });
      return false;
    }
    const color = typeof lastVCFColor !== "undefined" ? Number(lastVCFColor) || BLACK : BLACK;
    const engineGroup = typeof vcfGroupIdx !== "undefined" ? Number(vcfGroupIdx) : 0;
    const groupIndex = Math.max(0, Math.min(groups.length - 1, Number.isInteger(engineGroup) ? engineGroup : 0));
    calculationDisplay = {
      groups,
      groupIndex,
      color,
      ply: groups[groupIndex].length,
    };
    syncCalculationNavigation();
    return true;
  }

  function syncCalculationNavigation() {
    const groups = calculationDisplay.groups;
    const route = currentCalculationRoute();
    const hasResult = route.length > 0;
    const badge = document.getElementById("vcf-calculation-badge");
    const state = document.getElementById("vcf-calculation-navigation-state");
    const color = calculationDisplay.color === WHITE ? "白" : "黑";
    calculationNavigation.classList.toggle("is-active", hasResult);
    if (badge) badge.textContent = hasResult ? "展示計算中" : "尚無結果";

    const expectedOptions = groups.length;
    if (calcGroupSelect.options.length !== expectedOptions) {
      calcGroupSelect.replaceChildren();
      groups.forEach((candidate, index) => {
        const option = document.createElement("option");
        option.value = String(index);
        option.textContent = `第 ${index + 1} 組（${candidate.length} 手）`;
        calcGroupSelect.appendChild(option);
      });
    }
    if (hasResult) calcGroupSelect.value = String(calculationDisplay.groupIndex);
    calcGroupSelect.disabled = groups.length <= 1;
    calcPrevGroupButton.disabled = !hasResult || calculationDisplay.groupIndex <= 0;
    calcNextGroupButton.disabled = !hasResult || calculationDisplay.groupIndex >= groups.length - 1;
    calcPrevStepButton.disabled = !hasResult || calculationDisplay.ply <= 0;
    calcNextStepButton.disabled = !hasResult || calculationDisplay.ply >= route.length;

    if (state) {
      state.textContent = hasResult
        ? `${color}方 VCF｜第 ${calculationDisplay.groupIndex + 1}/${groups.length} 組｜第 ${calculationDisplay.ply}/${route.length} 手。橘框棋子只是計算覆蓋層，不會寫入原棋譜。`
        : "VCF 計算完成後，可在這裡獨立逐組、逐手展示；不會改動原棋譜。";
    }
  }

  function renderCalculationDisplay({ updateStatus = true } = {}) {
    const route = currentCalculationRoute();
    if (!route.length) {
      window._clearVCF?.();
      clearCalculationNextMoveMarkers();
      syncCalculationNavigation();
      return false;
    }
    const ply = Math.max(0, Math.min(route.length, calculationDisplay.ply));
    calculationDisplay.ply = ply;
    // VCF 計算展示只使用 SVG overlay，不呼叫 _setBoardArr，也不寫入 VCFWorkbenchRecord。
    window._showVCF?.(route.slice(0, ply), calculationDisplay.color);
    renderCalculationNextMoveMarkers(ply < route.length ? [route[ply]] : []);
    syncCalculationNavigation();
    if (updateStatus && typeof setStatus === "function") {
      const color = calculationDisplay.color === WHITE ? "白" : "黑";
      setStatus(`展示計算：${color}方第 ${calculationDisplay.groupIndex + 1}/${calculationDisplay.groups.length} 組，第 ${ply}/${route.length} 手`);
    }
    return true;
  }

  function moveCalculationStep(delta) {
    const route = currentCalculationRoute();
    if (!route.length) return false;
    calculationDisplay.ply = Math.max(0, Math.min(route.length, calculationDisplay.ply + delta));
    return renderCalculationDisplay();
  }

  function switchCalculationGroup(index) {
    const groups = calculationDisplay.groups;
    if (!groups.length) return false;
    const nextIndex = Math.max(0, Math.min(groups.length - 1, Number(index) || 0));
    calculationDisplay.groupIndex = nextIndex;
    calculationDisplay.ply = groups[nextIndex].length;
    // 同步引擎目前組別，讓「單一路線防守」等後續分析仍針對使用者正在看的那一組；
    // setVcfGroup 只改 VCF 計算狀態與 SVG overlay，不會寫入棋譜。
    if (typeof setVcfGroup === "function" && typeof vcfGroups !== "undefined" && Array.isArray(vcfGroups) && vcfGroups.length === groups.length) {
      setVcfGroup(nextIndex);
    }
    return renderCalculationDisplay();
  }

  class BinaryReader {
    constructor(bytes) {
      this.bytes = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || 0);
      this.offset = 0;
    }
    remaining() { return this.bytes.length - this.offset; }
    need(count) {
      if (this.offset + count > this.bytes.length) throw new Error("棋譜檔案已截斷或格式錯誤");
    }
    u8() { this.need(1); return this.bytes[this.offset++]; }
    u16() {
      this.need(2);
      const value = this.bytes[this.offset] | (this.bytes[this.offset + 1] << 8);
      this.offset += 2;
      return value >>> 0;
    }
    u32() {
      this.need(4);
      const b = this.bytes;
      const p = this.offset;
      const value = (b[p] | (b[p + 1] << 8) | (b[p + 2] << 16) | (b[p + 3] << 24)) >>> 0;
      this.offset += 4;
      return value;
    }
    take(count) { this.need(count); const result = this.bytes.slice(this.offset, this.offset + count); this.offset += count; return result; }
    skip(count) { this.need(count); this.offset += count; }
  }

  function readU32At(bytes, offset) {
    if (offset + 4 > bytes.length) throw new Error("LZ4 frame 已截斷");
    return (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0;
  }

  function decompressLZ4Frame(source) {
    const bytes = source instanceof Uint8Array ? source : new Uint8Array(source || 0);
    if (bytes.length < 7 || readU32At(bytes, 0) !== LZ4_FRAME_MAGIC) return bytes;

    let input = 4;
    const flg = bytes[input++];
    input++; // BD
    if ((flg >>> 6) !== 1) throw new Error("不支援的 LZ4 frame 版本");
    const hasBlockChecksum = Boolean(flg & 0x10);
    const hasContentSize = Boolean(flg & 0x08);
    const hasContentChecksum = Boolean(flg & 0x04);
    const hasDictId = Boolean(flg & 0x01);
    if (hasContentSize) input += 8;
    if (hasDictId) input += 4;
    input += 1; // header checksum
    if (input > bytes.length) throw new Error("LZ4 frame header 已截斷");

    let output = new Uint8Array(Math.max(65536, bytes.length * 2));
    let outputLength = 0;
    const ensureOutput = extra => {
      const required = outputLength + extra;
      if (required <= output.length) return;
      let nextLength = output.length;
      while (nextLength < required) nextLength *= 2;
      const next = new Uint8Array(nextLength);
      next.set(output.subarray(0, outputLength));
      output = next;
    };
    const appendByte = value => {
      ensureOutput(1);
      output[outputLength++] = value;
    };

    while (true) {
      if (input + 4 > bytes.length) throw new Error("LZ4 block header 已截斷");
      let blockSize = readU32At(bytes, input);
      input += 4;
      if (blockSize === 0) break;
      const uncompressed = Boolean(blockSize & 0x80000000);
      blockSize &= 0x7fffffff;
      if (input + blockSize > bytes.length) throw new Error("LZ4 block 已截斷");
      const blockEnd = input + blockSize;

      if (uncompressed) {
        ensureOutput(blockSize);
        output.set(bytes.subarray(input, blockEnd), outputLength);
        outputLength += blockSize;
        input = blockEnd;
      } else {
        while (input < blockEnd) {
          const token = bytes[input++];
          let literalLength = token >>> 4;
          if (literalLength === 15) {
            let extension;
            do {
              if (input >= blockEnd) throw new Error("LZ4 literal length 已截斷");
              extension = bytes[input++];
              literalLength += extension;
            } while (extension === 255);
          }
          if (input + literalLength > blockEnd) throw new Error("LZ4 literal 超出 block");
          ensureOutput(literalLength);
          output.set(bytes.subarray(input, input + literalLength), outputLength);
          outputLength += literalLength;
          input += literalLength;
          if (input >= blockEnd) break;

          if (input + 2 > blockEnd) throw new Error("LZ4 match offset 已截斷");
          const offset = bytes[input] | (bytes[input + 1] << 8);
          input += 2;
          if (!offset || offset > outputLength) throw new Error("LZ4 match offset 無效");
          let matchLength = (token & 0x0f) + 4;
          if ((token & 0x0f) === 15) {
            let extension;
            do {
              if (input >= blockEnd) throw new Error("LZ4 match length 已截斷");
              extension = bytes[input++];
              matchLength += extension;
            } while (extension === 255);
          }
          for (let i = 0; i < matchLength; i++) appendByte(output[outputLength - offset]);
        }
      }
      if (hasBlockChecksum) {
        if (input + 4 > bytes.length) throw new Error("LZ4 block checksum 已截斷");
        input += 4;
      }
    }

    if (hasContentChecksum) {
      if (input + 4 > bytes.length) throw new Error("LZ4 content checksum 已截斷");
      input += 4;
    }
    return output.slice(0, outputLength);
  }

  function transformXY(x, y, transform) {
    const m = BOARD_SIZE - 1;
    switch (transform) {
      case 0: return [x, y];
      case 1: return [m - y, x];
      case 2: return [m - x, m - y];
      case 3: return [y, m - x];
      case 4: return [m - x, y];
      case 5: return [m - y, m - x];
      case 6: return [x, m - y];
      case 7: return [y, x];
      default: return [x, y];
    }
  }

  function transformBoard(source, transform) {
    const target = new Uint8Array(BOARD_CELLS);
    for (let idx = 0; idx < BOARD_CELLS; idx++) {
      const stone = source[idx];
      if (!stone) continue;
      const x = idx % BOARD_SIZE;
      const y = Math.floor(idx / BOARD_SIZE);
      const [tx, ty] = transformXY(x, y, transform);
      target[ty * BOARD_SIZE + tx] = stone;
    }
    return target;
  }

  function opposite(color) { return color === BLACK ? WHITE : BLACK; }

  function makeRecordNode({ move = null, board: nodeBoard = null, sideToMove = BLACK, ply = 0, rule = null, synthetic = false, navigable = true, recordText = "", comment = "", boardTexts = [] } = {}) {
    return {
      move,
      board: nodeBoard ? new Uint8Array(nodeBoard) : new Uint8Array(BOARD_CELLS),
      sideToMove,
      ply,
      rule,
      synthetic,
      navigable,
      parent: null,
      children: [],
      selectedChild: 0,
      recordText,
      comment,
      boardTexts: Array.isArray(boardTexts) ? boardTexts.map(item => ({ ...item })) : [],
    };
  }

  function orientYXDBChild(parent, record) {
    if (record.ply !== parent.ply + 1 || record.rule !== parent.rule || record.sideToMove !== opposite(parent.sideToMove)) {
      return null;
    }
    for (let transform = 0; transform < 8; transform++) {
      const candidate = transformBoard(record.board, transform);
      let added = PASS_MOVE;
      let additions = 0;
      let valid = true;
      for (let idx = 0; idx < BOARD_CELLS; idx++) {
        const before = parent.board[idx];
        const after = candidate[idx];
        if (before) {
          if (after !== before) { valid = false; break; }
        } else if (after) {
          if (after !== parent.sideToMove || ++additions > 1) { valid = false; break; }
          added = idx;
        }
      }
      if (!valid) continue;
      if (additions === 1 || (additions === 0 && record.ply > 0)) {
        return { board: candidate, move: additions === 1 ? added : PASS_MOVE, transform };
      }
    }
    return null;
  }

  function rapfiHexCoord(char) {
    if (/^[0-9]$/.test(char)) return char.charCodeAt(0) - 48;
    if (/^[A-F]$/i.test(char)) return char.toUpperCase().charCodeAt(0) - 55;
    return -1;
  }

  function parseRapfiRecordText(text) {
    const raw = String(text || "").replace(/\0+$/g, "");
    const boardTexts = [];
    let comment = raw;
    if (raw.startsWith("@BTXT@")) {
      const separator = raw.indexOf("\b");
      const segment = raw.slice(6, separator >= 0 ? separator : raw.length);
      comment = separator >= 0 ? raw.slice(separator + 1) : "";
      for (const line of segment.split("\n")) {
        if (line.length <= 2) continue;
        const x = rapfiHexCoord(line[0]);
        const y = rapfiHexCoord(line[1]);
        if (x >= 0 && x < BOARD_SIZE && y >= 0 && y < BOARD_SIZE) boardTexts.push({ x, y, text: line.slice(2) });
      }
    }
    return { comment: comment.replace(/\b/g, "\n").trim(), boardTexts };
  }

  function orientBoardTexts(boardTexts, transform) {
    return (boardTexts || []).map(item => {
      const [x, y] = transformXY(item.x, item.y, transform);
      return { x, y, text: item.text };
    });
  }


  function transformRapfiRecordText(text, transform) {
    const raw = String(text || "").replace(/\0+$/g, "");
    if (!raw.startsWith("@BTXT@")) return raw;
    const separator = raw.indexOf("\b");
    const markerPart = raw.slice(6, separator >= 0 ? separator : raw.length);
    const suffix = separator >= 0 ? raw.slice(separator) : "";
    const encode = number => Number(number).toString(16).toUpperCase();
    const lines = markerPart.split("\n").map(line => {
      if (line.length <= 2) return line;
      const x = rapfiHexCoord(line[0]);
      const y = rapfiHexCoord(line[1]);
      if (x < 0 || x >= BOARD_SIZE || y < 0 || y >= BOARD_SIZE) return line;
      const [tx, ty] = transformXY(x, y, transform);
      return `${encode(tx)}${encode(ty)}${line.slice(2)}`;
    });
    return `@BTXT@${lines.join("\n")}${suffix}`;
  }

  // 修改注釋時只替換 DBRecord.text 的 comment 部分；若原 record 含 @BTXT@
  // 盤面文字，保留其原始座標與內容，避免只改注釋卻重寫盤面標記。
  function replaceRapfiComment(recordText, comment) {
    const raw = String(recordText || "").replace(/\0+$/g, "");
    const encoded = String(comment ?? "").replace(/\r\n?/g, "\n").replace(/\n/g, "\b");
    if (!raw.startsWith("@BTXT@")) return encoded;
    const separator = raw.indexOf("\b");
    const prefix = separator >= 0 ? raw.slice(0, separator + 1) : `${raw}\b`;
    return `${prefix}${encoded}`;
  }

  function setCommentEditorValue(value) {
    const next = String(value || "");
    if (recordCommentInput.value !== next) recordCommentInput.value = next;
  }

  function syncCommentEditorFromRecordText(recordText) {
    const meta = parseRapfiRecordText(recordText || "");
    setCommentEditorValue(meta.comment || "");
    const workspace = window.VCFWorkbenchRecord?.workspace?.() || {};
    const puzzleSetup = workspace.mode === "puzzle" && workspace.puzzlePhase === "setup";
    recordCommentInput.disabled = !workspace.mode || puzzleSetup;
    recordCommentMeta.textContent = !workspace.mode
      ? "請先選擇打譜模式或題目模式。"
      : puzzleSetup
        ? "完成題目初始盤面後即可加入注釋與盤面標記。"
        : workspace.mode === "puzzle"
          ? "目前盤面注釋；修改後保存於 VCF 題目容器。"
          : "目前盤面注釋；修改後保存於 Rapfi position DB。";
  }

  function saveCommentEditorValue() {
    if (recordCommentInput.disabled) return;
    const comment = recordCommentInput.value;
    const currentText = window.VCFWorkbenchRecord?.currentRecordText?.() || "";
    window.VCFWorkbenchRecord?.setCurrentRecordText?.(replaceRapfiComment(currentText, comment));
    recordCommentMeta.textContent = window.VCFWorkbenchRecord?.workspace?.()?.mode === "puzzle"
      ? "已保存於目前題目盤面。"
      : "已保存於目前 Rapfi position。";
  }

  recordCommentInput.addEventListener("input", saveCommentEditorValue);
  window.addEventListener("vcf-record-state-changed", event => {
    if (document.activeElement !== recordCommentInput) {
      syncCommentEditorFromRecordText(event.detail?.recordText || "");
    }
    renderRecordNextMoveMarkers(event.detail?.nextMoves || []);
  });
  window.addEventListener("vcf-workspace-mode-changed", () => syncCommentEditorFromRecordText(window.VCFWorkbenchRecord?.currentRecordText?.() || ""));

  function parseYXDB(rawBytes) {
    const compressed = rawBytes.length >= 4 && readU32At(rawBytes, 0) === LZ4_FRAME_MAGIC;
    const bytes = decompressLZ4Frame(rawBytes);
    const reader = new BinaryReader(bytes);
    const recordCount = reader.u32();
    if (!recordCount || recordCount > 10000000) throw new Error("YXDB record 數量不合理");
    const records = [];

    for (let recordIndex = 0; recordIndex < recordCount; recordIndex++) {
      const keyLength = reader.u16();
      const key = reader.take(keyLength);
      const valueLength = reader.u16();
      const valueBytes = reader.take(valueLength);
      const recordText = valueLength > 5 ? new TextDecoder("utf-8").decode(valueBytes.subarray(5)) : "";
      const recordMeta = parseRapfiRecordText(recordText);
      if (keyLength < 3) continue;
      const rule = key[0];
      const width = key[1];
      const height = key[2];
      if (width === 0 && height === 0) continue;
      if (width !== BOARD_SIZE || height !== BOARD_SIZE) {
        throw new Error(`目前工作台只支援 15×15，檔案內含 ${width}×${height} YXDB 局面`);
      }
      if (rule > 2 || (keyLength - 3) % 2 !== 0) throw new Error("YXDB key 格式錯誤");

      const slotCount = (keyLength - 3) / 2;
      const blackSlots = Math.ceil(slotCount / 2);
      const whiteSlots = Math.floor(slotCount / 2);
      const nodeBoard = new Uint8Array(BOARD_CELLS);
      const readStone = (slot, color) => {
        const x = key[3 + slot * 2];
        const y = key[4 + slot * 2];
        if (x === 0xff && y === 0xff) return;
        if (x >= BOARD_SIZE || y >= BOARD_SIZE) throw new Error("YXDB 棋子座標超出 15×15 棋盤");
        const idx = y * BOARD_SIZE + x;
        if (nodeBoard[idx] && nodeBoard[idx] !== color) throw new Error("YXDB 同一位置出現不同顏色棋子");
        nodeBoard[idx] = color;
      };
      for (let i = 0; i < blackSlots; i++) readStone(i, BLACK);
      for (let i = 0; i < whiteSlots; i++) readStone(blackSlots + i, WHITE);
      records.push({
        board: nodeBoard,
        sideToMove: blackSlots === whiteSlots ? BLACK : WHITE,
        ply: slotCount,
        rule,
        recordText,
        comment: recordMeta.comment,
        boardTexts: recordMeta.boardTexts,
      });
    }
    if (!records.length) throw new Error("YXDB 沒有可顯示的 15×15 局面");

    records.sort((a, b) => a.ply - b.ply || a.rule - b.rule);
    const nodes = [];
    const roots = [];
    for (const record of records) {
      let node = null;
      for (const parent of nodes) {
        if (parent.ply !== record.ply - 1 || parent.rule !== record.rule) continue;
        const oriented = orientYXDBChild(parent, record);
        if (!oriented) continue;
        node = makeRecordNode({
          move: oriented.move,
          board: oriented.board,
          sideToMove: record.sideToMove,
          ply: record.ply,
          rule: record.rule,
          recordText: record.recordText,
          comment: record.comment,
          boardTexts: orientBoardTexts(record.boardTexts, oriented.transform),
        });
        node.parent = parent;
        parent.children.push(node);
        break;
      }
      if (!node) {
        node = makeRecordNode({ board: record.board, sideToMove: record.sideToMove, ply: record.ply, rule: record.rule, recordText: record.recordText, comment: record.comment, boardTexts: record.boardTexts });
        roots.push(node);
      }
      nodes.push(node);
    }

    for (const node of nodes) node.children.sort((a, b) => a.move - b.move);
    const synthetic = makeRecordNode({ synthetic: true, navigable: false });
    synthetic.children = roots;
    for (const root of roots) root.parent = synthetic;
    return {
      format: "YXDB",
      compressed,
      storageBytes: bytes,
      root: synthetic,
      current: roots[0],
      rule: roots[0].rule,
      nodeCount: nodes.length,
      rootCount: roots.length,
    };
  }

  function skipRenLibPairString(reader) {
    while (reader.remaining() >= 2) {
      const first = reader.u8();
      const second = reader.u8();
      if (!first || !second) return;
    }
    throw new Error("RenLib 文字區塊未正常結束");
  }

  function parseRenLib(rawBytes) {
    const reader = new BinaryReader(rawBytes);
    if (reader.remaining() < 22) throw new Error("RenLib 檔案過短");
    reader.skip(20);

    const synthetic = makeRecordNode({ synthetic: true, navigable: true, sideToMove: BLACK, ply: 0 });
    let nodeCount = 0;
    const parseSiblings = parent => {
      while (reader.remaining() >= 2) {
        const moveByte = reader.u8();
        const flags = reader.u8();
        if (flags & 0x01) reader.skip(2); // text marker 0x00,0x01
        if (flags & 0x08) skipRenLibPairString(reader);
        if (flags & 0x01) skipRenLibPairString(reader);
        const x = (moveByte & 0x0f) - 1;
        const y = (moveByte >>> 4) & 0x0f;
        const move = moveByte === 0 ? PASS_MOVE : (x >= 0 && x < BOARD_SIZE && y < BOARD_SIZE ? y * BOARD_SIZE + x : NaN);
        if (!Number.isInteger(move)) throw new Error("RenLib 含無效落點");
        const node = makeRecordNode({ move });
        node.parent = parent;
        parent.children.push(node);
        nodeCount++;
        if (!(flags & 0x40)) parseSiblings(node);
        if (!(flags & 0x80)) break;
      }
    };
    parseSiblings(synthetic);
    if (!nodeCount) throw new Error("RenLib 沒有棋譜節點");

    // Rapfi reader 會把第一個 PASS 視為舊 RenLib ROOT 並略過；本工具比照處理。
    const compatRoot = synthetic.children[0];
    if (compatRoot?.move === PASS_MOVE) {
      const replacement = compatRoot.children.length ? compatRoot.children : synthetic.children.slice(1);
      if (replacement.length) {
        synthetic.children = replacement;
        for (const child of replacement) child.parent = synthetic;
      }
    }

    const hydrate = (parent, parentBoard, side, ply) => {
      for (const child of parent.children) {
        const nodeBoard = new Uint8Array(parentBoard);
        if (child.move !== PASS_MOVE) {
          if (nodeBoard[child.move] !== EMPTY) throw new Error("RenLib 分支落在已有棋子的交點");
          nodeBoard[child.move] = side;
        }
        child.board = nodeBoard;
        child.sideToMove = opposite(side);
        child.ply = ply + 1;
        hydrate(child, nodeBoard, child.sideToMove, child.ply);
      }
    };
    hydrate(synthetic, synthetic.board, BLACK, 0);
    return {
      format: "RenLib",
      compressed: false,
      root: synthetic,
      current: synthetic,
      rule: null,
      nodeCount,
      rootCount: synthetic.children.length,
    };
  }

  function setupHistoryForParsedBoard(nodeBoard, sideToMove) {
    const black = [];
    const white = [];
    for (let index = 0; index < BOARD_CELLS; index++) {
      if (nodeBoard[index] === BLACK) black.push(index);
      else if (nodeBoard[index] === WHITE) white.push(index);
    }
    if (!(black.length === white.length || black.length === white.length + 1)) {
      throw new Error("YXDB 起始局面的黑白子數無法建立 Rapfi Board history");
    }
    const history = [];
    const rounds = Math.max(black.length, white.length);
    for (let i = 0; i < rounds; i++) {
      if (i < black.length) history.push(black[i]);
      if (i < white.length) history.push(white[i]);
    }
    const naturalSide = history.length % 2 === 0 ? BLACK : WHITE;
    if (naturalSide !== sideToMove) history.push(PASS_MOVE);
    return history;
  }

  function parsedImportState(node) {
    if (!node || node.synthetic) return { history: [], basePly: 0 };
    const trailing = [];
    let root = node;
    while (root.parent && !root.parent.synthetic) {
      trailing.push(root.move);
      root = root.parent;
    }
    const setup = setupHistoryForParsedBoard(root.board, root.sideToMove);
    trailing.reverse();
    return {
      history: setup.concat(trailing),
      basePly: setup.length,
    };
  }

  function deepestParsedNode(tree) {
    let best = tree?.current || null;
    const visit = node => {
      if (!node) return;
      if (!node.synthetic && (!best || Number(node.ply || 0) > Number(best.ply || 0))) best = node;
      for (const child of node.children || []) visit(child);
    };
    visit(tree?.root);
    return best || tree?.current || null;
  }

  function collectRenLibRoutes(tree) {
    const routes = [];
    const visit = (node, path) => {
      const next = node?.synthetic ? path : path.concat(Number(node.move));
      const children = node?.children || [];
      if (!children.length) {
        if (next.length) routes.push(next);
        return;
      }
      for (const child of children) visit(child, next);
    };
    visit(tree?.root, []);
    return routes;
  }

  function reportRecordImport(format, fileName, nodeCount, currentPly) {
    const text = `${format} ${fileName || "棋譜"}：已載入 Rapfi position DB，目前第 ${currentPly} 手，共 ${nodeCount} 個節點`;
    if (typeof setStatus === "function") setStatus(text);
    const quickStatus = document.getElementById("bb-export-status");
    if (quickStatus) quickStatus.textContent = text;
  }

  async function loadRecordBytes(rawBytes, fileName = "棋譜.db", options = {}) {
    const bytes = rawBytes instanceof Uint8Array ? rawBytes : new Uint8Array(rawBytes || 0);
    const lowerName = String(fileName || "").toLowerCase();
    const looksPuzzle = lowerName.endsWith(".vcf.json") || lowerName.endsWith(".vcfp");
    const looksRenLib = lowerName.endsWith(".lib")
      || (bytes.length >= 8 && bytes[0] === 0xff && bytes[1] === 0x52 && bytes[2] === 0x65 && bytes[3] === 0x6e);
    document.getElementById("btn-clear-vcf")?.click();

    if (looksPuzzle) {
      if (bytes.length > 16 * 1024 * 1024) throw new Error("VCF 題目容器超過 16 MB 上限");
      let payload;
      try { payload = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
      catch (_) { throw new Error("VCF 題目容器不是有效的 UTF-8 JSON"); }
      const loaded = await window.VCFWorkbenchRecord?.importPuzzle?.(payload);
      if (!loaded) throw new Error("VCF 題目容器無法載入 Rapfi 工作台");
      const nodeCount = Object.keys(payload?.nodes || {}).length;
      const currentPly = Array.isArray(payload?.currentRoute) ? payload.currentRoute.length : 0;
      reportRecordImport("VCF 題目", fileName || "題目.vcf.json", nodeCount, currentPly);
      return { format: "VCF Puzzle", nodeCount, rootCount: 1, currentPly };
    }

    if (looksRenLib) {
      const parsed = parseRenLib(bytes);
      const routes = collectRenLibRoutes(parsed);
      const openHistory = options?.openAtEnd
        ? routes.reduce((best, route) => route.length > best.length ? route : best, [])
        : [];
      const rule = Number(document.querySelector('input[name="rules"]:checked')?.value ?? 2);
      const loaded = await window.VCFWorkbenchRecord?.importRoutes?.(routes, rule, openHistory);
      if (!loaded) throw new Error("RenLib 無法載入 Rapfi position DB");
      reportRecordImport("RenLib", fileName || "棋譜.lib", parsed.nodeCount, openHistory.length);
      return {
        format: "RenLib",
        nodeCount: parsed.nodeCount,
        rootCount: parsed.rootCount,
        currentPly: openHistory.length,
      };
    }

    const parsed = parseYXDB(bytes);
    const target = options?.openAtEnd ? deepestParsedNode(parsed) : parsed.current;
    const state = parsedImportState(target);
    const loaded = await window.VCFWorkbenchRecord?.importYXDB?.(parsed.storageBytes, parsed.rule, state.history, state.basePly);
    if (!loaded) throw new Error("YXDB 無法載入 Rapfi YXDBStorage");
    const currentPly = Math.max(0, state.history.length - state.basePly);
    reportRecordImport("YXDB", fileName || "棋譜.db", parsed.nodeCount, currentPly);
    return {
      format: "YXDB",
      nodeCount: parsed.nodeCount,
      rootCount: parsed.rootCount,
      currentPly,
    };
  }

  async function loadRecordFile(file) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    return loadRecordBytes(bytes, file.name || "棋譜.db", { openAtEnd: false });
  }

  window.VCFRecordImportAPI = {
    loadBytes(bytes, fileName = "雲端棋譜.db", options = {}) {
      return loadRecordBytes(bytes, fileName, options);
    },
  };

  function installRecordImportControls() {
    const panel = document.getElementById("bitboard-architecture-panel");
    if (!panel || document.getElementById("bb-import-record")) return;
    const input = document.createElement("input");
    input.id = "bb-import-record-input";
    input.type = "file";
    input.accept = ".db,.lib,.vcf.json,.vcfp,application/json,application/octet-stream";
    input.hidden = true;
    const button = document.createElement("button");
    button.id = "bb-import-record";
    button.className = "bb-lab-link";
    button.type = "button";
    button.textContent = "讀取棋譜／題目";
    const refresh = document.getElementById("bb-hard-refresh");
    panel.insertBefore(button, refresh || null);
    panel.appendChild(input);
    button.addEventListener("click", () => input.click());
    input.addEventListener("change", async () => {
      const file = input.files?.[0];
      input.value = "";
      if (!file) return;
      button.disabled = true;
      const quickStatus = document.getElementById("bb-export-status");
      if (quickStatus) quickStatus.textContent = "正在讀取分支棋譜……";
      try {
        await loadRecordFile(file);
      } catch (error) {
        console.error("讀取分支棋譜失敗", error);
        const message = `讀取棋譜失敗：${error?.message || error}`;
        if (typeof setStatus === "function") setStatus(message);
        if (quickStatus) quickStatus.textContent = message;
      } finally {
        button.disabled = false;
      }
    });
  }

  prevStepButton.addEventListener("click", () => {
    if (window.VCFWorkbenchRecord?.navigateStep?.(-1)) return;
    if (typeof setStatus === "function") setStatus("目前已是棋譜起點");
  });
  nextStepButton.addEventListener("click", () => {
    if (window.VCFWorkbenchRecord?.navigateStep?.(1)) return;
    if (typeof setStatus === "function") setStatus("目前沒有下一手");
  });

  previousBranchButton.addEventListener("click", () => {
    if (window.VCFWorkbenchRecord?.navigateBranch?.(-1)) return;
    if (typeof setStatus === "function") setStatus("已停在棋譜起點");
  });
  nextBranchButton.addEventListener("click", () => {
    if (window.VCFWorkbenchRecord?.navigateBranch?.(1)) return;
    if (typeof setStatus === "function") setStatus("已停在棋譜末端");
  });

  calcPrevGroupButton.addEventListener("click", () => switchCalculationGroup(calculationDisplay.groupIndex - 1));
  calcNextGroupButton.addEventListener("click", () => switchCalculationGroup(calculationDisplay.groupIndex + 1));
  calcGroupSelect.addEventListener("change", () => switchCalculationGroup(Number(calcGroupSelect.value)));
  calcPrevStepButton.addEventListener("click", () => moveCalculationStep(-1));
  calcNextStepButton.addEventListener("click", () => moveCalculationStep(1));
  window.addEventListener("vcf-result-changed", event => {
    if (event.detail?.hasResult && captureCalculationResult()) {
      // 搜尋完成後只同步展示面板；保留搜尋本身的耗時、節點與速度完成提示。
      renderCalculationDisplay({ updateStatus: false });
    } else {
      resetCalculationDisplay({ clearOverlay: false });
    }
  });
  syncCalculationNavigation();

  // 棋盤改動後，注釋編輯器只從唯一的 Rapfi workbench record state 重新同步。
  window.addEventListener("vcf-board-changed", () => {
    queueMicrotask(() => syncCommentEditorFromRecordText(window.VCFWorkbenchRecord?.currentRecordText?.() || ""));
  });

  document.getElementById("btn-clear-vcf")?.addEventListener("click", () => {
    resetCalculationDisplay({ clearOverlay: false });
  });
  document.getElementById("btn-clear")?.addEventListener("click", () => {
    resetCalculationDisplay({ clearOverlay: false });
  });

  const labels = {
    "btn-black": "找黑 VCF",
    "btn-white": "找白 VCF",
    "btn-stop": "停止",
    "btn-continue": "繼續搜尋",
    "btn-clear-vcf": "清除標記",
    "btn-clear": "清空棋盤",
    "btn-block-vcf": "單一路線防守",
    "btn-block-vcf-all": "全部路線防守",
    "btn-multi-vcf": "多組 VCF",
    "btn-vcf-prev": "上一組",
    "btn-vcf-next": "下一組",
    "btn-level3": "VCT 選點",
    "btn-add-black": "補黑找 VCF",
    "btn-add-white": "補白找 VCF"
  };
  for (const [id, text] of Object.entries(labels)) {
    const button = document.getElementById(id);
    if (button) button.textContent = text;
  }

  ["btn-black", "btn-white"].forEach(id => document.getElementById(id)?.classList.add("vcf-primary-action"));
  ["btn-clear", "btn-clear-vcf"].forEach(id => document.getElementById(id)?.classList.add("vcf-muted-action"));
  document.getElementById("btn-stop")?.classList.add("vcf-danger-action");

  const style = document.createElement("style");
  style.dataset.vcfCardLayout = "true";
  style.textContent = `
    :root {
      --vcf-bg: #eee6d3;
      --vcf-card: #fffdf7;
      --vcf-border: #d6c89f;
      --vcf-text: #302919;
      --vcf-muted: #74684c;
      --vcf-accent: #355f8d;
      --vcf-accent-soft: #e8f0f8;
      --vcf-danger: #a54a42;
    }

    body {
      display: block;
      min-height: 100vh;
      padding: 14px;
      background: var(--vcf-bg);
      color: var(--vcf-text);
    }

    #vcf-app-shell {
      width: min(100%, 1120px);
      margin: 0 auto;
      display: grid;
      gap: 14px;
    }

    .vcf-app-header {
      display: flex;
      align-items: end;
      justify-content: space-between;
      padding: 4px 2px 2px;
    }

    .vcf-app-header h1 {
      margin: 0;
      font-size: clamp(22px, 3vw, 30px);
      line-height: 1.2;
      color: #3d321d;
    }

    .vcf-app-header p,
    .vcf-card-heading p {
      margin: 4px 0 0;
      color: var(--vcf-muted);
      font-size: 13px;
      line-height: 1.45;
    }

    .vcf-top-grid {
      display: grid;
      grid-template-columns: minmax(0, 580px) minmax(320px, 1fr);
      gap: 14px;
      align-items: start;
    }

    .vcf-control-stack {
      display: grid;
      gap: 14px;
    }

    .vcf-board-card > .vcf-annotation-card {
      margin-top: 12px;
      padding: 11px;
      border-radius: 9px;
      background: #faf6e9;
      box-shadow: none;
    }

    .vcf-card,
    #vcf-app-shell #generator-panel,
    #vcf-app-shell #import-panel {
      width: 100%;
      min-width: 0;
      margin: 0;
      padding: 14px;
      border: 1px solid var(--vcf-border);
      border-radius: 12px;
      background: var(--vcf-card);
      box-shadow: 0 3px 12px #4f3e1d12;
    }

    .vcf-card-heading,
    #generator-panel .gen-title-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 12px;
      padding-bottom: 10px;
      border-bottom: 1px solid #e7dec6;
      text-align: left;
    }

    .vcf-card-heading h2,
    #generator-panel .gen-title-row h2 {
      margin: 0;
      font-size: 17px;
      color: #46391f;
    }

    .vcf-board-wrap {
      display: flex;
      justify-content: center;
      width: 100%;
    }

    .vcf-record-navigation,
    .vcf-calculation-navigation {
      width: 100%;
      margin-top: 12px;
      padding: 10px;
      border: 1px solid #d8caa8;
      border-radius: 9px;
      background: #faf6e9;
    }

    .vcf-calculation-navigation {
      border-color: #c8c0ad;
      background: #f5f3ed;
      opacity: .72;
      transition: background .18s ease, border-color .18s ease, box-shadow .18s ease, opacity .18s ease;
    }

    .vcf-calculation-navigation.is-active {
      border-color: #d29a2e;
      background: #fff7df;
      box-shadow: inset 4px 0 0 #d29a2e;
      opacity: 1;
    }

    .vcf-record-navigation-heading,
    .vcf-calculation-navigation-heading {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 8px;
      margin-bottom: 8px;
      color: #46391f;
      font-size: 13px;
    }

    .vcf-record-navigation-heading span,
    .vcf-calculation-navigation-heading > span {
      color: var(--vcf-muted);
      font-size: 12px;
      text-align: right;
    }

    .vcf-calculation-title-row {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .vcf-calculation-group-row {
      display: flex;
      align-items: center;
      gap: 8px;
      margin: 8px 0;
      color: #6f592c;
      font-size: 12px;
      font-weight: 700;
    }

    .vcf-calculation-group-row select {
      flex: 1;
      min-width: 0;
      min-height: 36px;
      padding: 6px 9px;
      border: 1px solid #c99028;
      border-radius: 7px;
      background: #fffdf6;
      color: #4f3b17;
      font: inherit;
      font-weight: 600;
    }

    .vcf-calculation-badge {
      display: inline-flex;
      align-items: center;
      min-height: 24px;
      padding: 2px 8px;
      border-radius: 999px;
      background: #dedad0;
      color: #6f685a;
      font-size: 11px;
      font-weight: 700;
    }

    .vcf-calculation-navigation.is-active .vcf-calculation-badge {
      background: #d29a2e;
      color: #fff;
    }

    .vcf-record-navigation-actions,
    .vcf-calculation-navigation-actions {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 6px;
      width: 100%;
    }

    .vcf-annotation-card textarea {
      width: 100%;
      min-height: 150px;
      padding: 10px 11px;
      border: 1px solid #cfc3a4;
      border-radius: 8px;
      background: #fffefa;
      color: var(--vcf-text);
      font: inherit;
      font-size: 14px;
      line-height: 1.55;
      resize: vertical;
    }

    .vcf-annotation-card textarea:focus {
      outline: 2px solid #8ba8c455;
      border-color: #789abb;
    }

    .vcf-record-comment-meta {
      margin-top: 7px;
      color: var(--vcf-muted);
      font-size: 12px;
      line-height: 1.4;
    }

    #vcf-record-navigation-actions button,
    #vcf-calculation-navigation-actions button {
      min-height: 38px;
      padding: 7px 5px;
      font-size: 13px;
    }

    #vcf-calculation-navigation.is-active #vcf-calculation-navigation-actions button:not(:disabled) {
      border-color: #c99028;
      background: #fffdf6;
    }

    #vcf-app-shell #board-svg {
      width: min(520px, 100%);
      height: auto;
      aspect-ratio: 1 / 1;
      max-width: 100%;
    }

    #vcf-app-shell #status,
    #vcf-app-shell #gen-status,
    #vcf-app-shell #import-status {
      width: 100%;
      min-width: 0;
      margin-top: 12px;
      padding: 9px 11px;
      border-radius: 8px;
      line-height: 1.4;
    }

    .vcf-option-row,
    #generator-panel .gen-controls {
      display: flex;
      align-items: center;
      justify-content: flex-start;
      flex-wrap: wrap;
      gap: 8px 12px;
      margin-bottom: 11px;
      font-size: 14px;
    }

    .vcf-option-row label,
    #generator-panel .gen-controls label,
    #generator-panel .gen-controls fieldset {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      min-height: 36px;
      padding: 6px 10px;
      border: 1px solid #ddd2b5;
      border-radius: 999px;
      background: #faf6e9;
      white-space: nowrap;
    }

    #analysis-box {
      justify-content: flex-start;
    }

    .vcf-action-grid,
    #generator-panel .gen-actions,
    #import-toolbar,
    #import-actions {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 8px;
      width: 100%;
      margin: 0;
    }

    #vcf-app-shell button {
      min-width: 0;
      min-height: 42px;
      padding: 8px 10px;
      border-color: #c9bea0;
      border-radius: 8px;
      background: #fff;
      font-weight: 600;
      line-height: 1.2;
    }

    #vcf-app-shell button:hover:not(:disabled) {
      background: var(--vcf-accent-soft);
      border-color: #8ba8c4;
    }

    #vcf-app-shell .vcf-primary-action,
    #generator-panel #gen-btn-generate {
      color: #fff;
      background: var(--vcf-accent);
      border-color: var(--vcf-accent);
    }

    #vcf-app-shell .vcf-primary-action:hover:not(:disabled),
    #generator-panel #gen-btn-generate:hover:not(:disabled) {
      background: #294f78;
    }

    #vcf-app-shell .vcf-muted-action {
      color: #625a48;
      background: #f2eee4;
    }

    #vcf-app-shell .vcf-danger-action {
      color: #fff;
      background: var(--vcf-danger);
      border-color: var(--vcf-danger);
    }

    #vcf-app-shell #generator-panel .gen-title-row {
      justify-content: flex-start;
    }

    #vcf-app-shell #generator-panel .gen-controls,
    #vcf-app-shell #generator-panel .gen-actions,
    #vcf-app-shell #generator-panel .gen-legend {
      justify-content: flex-start;
    }

    #vcf-app-shell #generator-panel .gen-actions {
      grid-template-columns: repeat(4, minmax(0, 1fr));
      margin-top: 11px;
    }

    #vcf-app-shell #generator-panel .gen-note {
      margin-top: 10px;
      text-align: left;
    }

    #vcf-app-shell #import-panel {
      max-width: none;
    }

    #vcf-app-shell #import-canvases {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    #vcf-app-shell .canvas-card {
      min-width: 0;
      border-radius: 9px;
      box-shadow: none;
    }

    @media (max-width: 820px) {
      body { padding: 8px; }
      #vcf-app-shell { gap: 10px; }
      .vcf-top-grid { grid-template-columns: 1fr; gap: 10px; }
      .vcf-control-stack { grid-template-columns: 1fr 1fr; gap: 10px; }
      .vcf-card,
      #vcf-app-shell #generator-panel,
      #vcf-app-shell #import-panel { padding: 11px; border-radius: 10px; }
      #vcf-app-shell #generator-panel .gen-actions { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    }

    @media (max-width: 600px) {
      .vcf-app-header { padding: 2px 2px 0; }
      .vcf-app-header p { font-size: 12px; }
      .vcf-control-stack { grid-template-columns: 1fr; }
      .vcf-card-heading { margin-bottom: 9px; padding-bottom: 8px; }
      .vcf-option-row,
      #generator-panel .gen-controls { gap: 6px; margin-bottom: 9px; }
      .vcf-option-row label,
      #generator-panel .gen-controls label,
      #generator-panel .gen-controls fieldset { min-height: 34px; padding: 5px 8px; font-size: 13px; }
      .vcf-action-grid,
      #generator-panel .gen-actions,
      #import-toolbar,
      #import-actions { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px; }
      #vcf-app-shell button { min-height: 40px; padding: 7px 6px; font-size: 13px; }
      #vcf-app-shell #import-canvases { grid-template-columns: 1fr; }
      #vcf-app-shell #status { margin-top: 9px; }
      .vcf-record-navigation-heading, .vcf-calculation-navigation-heading { align-items: flex-start; flex-direction: column; }
      .vcf-record-navigation-heading span, .vcf-calculation-navigation-heading > span { text-align: left; }
      .vcf-record-navigation-actions, .vcf-calculation-navigation-actions { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    }

    @media (max-width: 380px) {
      .vcf-action-grid,
      #generator-panel .gen-actions,
      #import-toolbar,
      #import-actions { grid-template-columns: 1fr; }
    }
  `;
  document.head.appendChild(style);

  syncCalculationNavigation();
  document.addEventListener("DOMContentLoaded", () => {
    document.title = "五子棋工作台";
    installRecordImportControls();
    syncCalculationNavigation();
  }, { once: true });
})();

// Own the final workspace arrangement here so UI ordering has one source of truth.
(function initUnifiedVCFInterface() {
  const RULE_SELECT_ID = "vcf-rule-select";
  const FAST_BUTTON_ID = "btn-fast-vcf";
  const STYLE_ID = "vcf-unified-interface-style";
  const PENDING_CLASS = "vcf-interface-pending";
  const READY_CLASS = "vcf-interface-ready";
  const RULE_NAMES = { 2: "有禁", 1: "無禁", 0: "自由" };

  document.documentElement.classList.add(PENDING_CLASS);

  function installStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      html.${PENDING_CLASS} body > *:not(#camera-overlay){visibility:hidden}
      html.${READY_CLASS} body > *{visibility:visible}
      #bitboard-architecture-panel:not(.bb-quick-actions){display:none!important}
      #vcf-app-shell{width:min(100%,1180px)}
      #vcf-app-shell>.vcf-app-header p,.vcf-card-heading p{display:none}
      .vcf-top-grid{grid-template-columns:minmax(0,570px) minmax(430px,1fr)}
      .vcf-control-stack{display:block!important;min-width:0}
      .vcf-workspace{min-width:0}
      .vcf-tabs{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px;margin-bottom:8px;padding:5px;border:1px solid var(--vcf-border,#d6c89f);border-radius:11px;background:#e8dfc9}
      #vcf-app-shell .vcf-tab{min-height:42px;padding:8px 6px;border:1px solid transparent;border-radius:8px;background:transparent;color:#65583d;font-weight:700}
      #vcf-app-shell .vcf-tab[aria-selected="true"]{border-color:#b9ad8e;background:#fffdf7;color:#304f72;box-shadow:0 2px 6px #59461514}
      .vcf-tab-panel[hidden]{display:none!important}
      .vcf-tab-panel{min-width:0;padding:13px;border:1px solid var(--vcf-border,#d6c89f);border-radius:12px;background:var(--vcf-card,#fffdf7);box-shadow:0 3px 12px #4f3e1d12}
      .vcf-calc-panel{display:grid;gap:10px}
      .vcf-section{display:grid;gap:8px;padding:10px;border:1px solid #e7dec6;border-radius:10px;background:#fffefb}
      .vcf-section-title{margin:0;color:#65583d;font-size:12px;font-weight:800;letter-spacing:.03em}
      .vcf-inline{display:flex;align-items:center;flex-wrap:wrap;gap:8px;min-width:0}
      #analysis-box{display:flex!important;align-items:center;flex-wrap:wrap;gap:8px!important;font-size:13px!important}
      #analysis-box label,.vcf-inline>label,.vcf-settings-grid>label,#rule-box .vcf-rule-select-label{display:inline-flex;align-items:center;gap:6px;min-height:36px;padding:6px 10px;border:1px solid #ddd2b5;border-radius:8px;background:#faf6e9;font-size:13px;font-weight:600;white-space:nowrap}
      #analysis-box label{border-radius:999px}
      .vcf-actions{display:grid;gap:8px;width:100%}
      .vcf-cols-2{grid-template-columns:repeat(2,minmax(0,1fr))}
      .vcf-cols-3{grid-template-columns:repeat(3,minmax(0,1fr))}
      .vcf-cols-4{grid-template-columns:repeat(4,minmax(0,1fr))}
      #btn-fast-vcf{order:1}
      #btn-shortest-vcf{order:2}
      .vcf-setting-toggle.vcf-calculation-toggle{order:3}
      #btn-multi-vcf{order:1}
      #btn-vcf-prev{order:2}
      #btn-vcf-next{order:3}
      .vcf-setting-toggle.vcf-multi-toggle{order:4}
      #vcf-app-shell button{min-width:0}
      #${FAST_BUTTON_ID},#btn-shortest-vcf{color:#000;-webkit-text-fill-color:#000;background:var(--vcf-accent,#355f8d);border-color:var(--vcf-accent,#355f8d);font-weight:700}
      #${FAST_BUTTON_ID}:hover:not(:disabled),#btn-shortest-vcf:hover:not(:disabled){color:#000;-webkit-text-fill-color:#000;background:#294f78}
      .vcf-setting-toggle{display:flex;align-items:center;justify-content:center;gap:7px;min-height:42px;padding:7px 9px;border:1px solid #c9bea0;border-radius:8px;background:#fff;color:#4f4634;font-size:13px;font-weight:700;cursor:pointer;user-select:none}
      .vcf-setting-toggle.vcf-setting-toggle-active{border-color:#7798b9;background:#e8f0f8;color:#294f78}
      .vcf-settings-card[hidden]{display:none!important}
      .vcf-settings-card{padding:10px;border:1px dashed #cdbf9d;border-radius:9px;background:#fbf7ec}
      .vcf-settings-card h3{margin:0 0 8px;color:#5d5138;font-size:14px}
      .vcf-settings-grid{display:flex;align-items:center;flex-wrap:wrap;gap:8px}
      #${RULE_SELECT_ID},#vcf-search-options select,#vcf-search-options input[type="number"]{min-width:0;padding:6px 8px;border:1px solid #bdb397;border-radius:6px;background:#fff;color:inherit;font:inherit}
      #vcf-search-options input[type="number"]{width:72px;text-align:right}
      #vcf-multi-pruning{min-width:108px}
      #vcf-add-search-mode{min-width:78px}
      .vcf-compat-host,.vcf-rule-radio-compat,#btns>[hidden]{position:absolute!important;width:1px!important;height:1px!important;overflow:hidden!important;clip-path:inset(50%)!important;white-space:nowrap!important}
      #vcf-app-shell #generator-panel,#vcf-app-shell #import-panel{width:100%;max-width:none;margin:0;padding:0;border:0;border-radius:0;background:transparent;box-shadow:none}
      #generator-panel .gen-title-row{justify-content:space-between;margin:0 0 10px;padding:0 0 10px}
      #generator-panel .gen-title-row:empty{display:none!important}
      #generator-panel .gen-controls{display:grid!important;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px!important;margin:0!important}
      #generator-panel .vcf-gen-group{display:flex;align-content:flex-start;flex-wrap:wrap;gap:8px;min-width:0;padding:10px;border:1px solid #e7dec6;border-radius:9px;background:#fffefb}
      #generator-panel .vcf-gen-group-title{flex-basis:100%;margin:0;color:#65583d;font-size:12px;font-weight:800}
      #generator-panel .gen-controls label,#generator-panel .gen-controls fieldset{display:inline-flex;align-items:center;gap:6px;min-height:36px;padding:6px 9px;border:1px solid #ddd2b5;border-radius:8px;background:#faf6e9;white-space:nowrap}
      #generator-panel .gen-actions{display:grid!important;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px!important;width:100%;margin:0 0 10px!important}
      #generator-panel .gen-legend{justify-content:flex-start!important;padding:8px 10px;border-radius:8px;background:#faf7ef}
      #generator-panel .gen-note{margin-top:0!important;padding:9px 10px;border-left:3px solid #c9b46f;border-radius:6px;background:#fbf7ea;text-align:left!important}
      #generator-panel #vcf-question-bank{width:100%;max-width:none;margin:12px 0 0}
      #import-panel>.vcf-card-heading{display:none}
      #import-panel #import-toolbar{display:grid!important;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px!important;width:100%;margin:0 0 9px!important}
      #import-panel #import-status{margin:0 0 10px!important}
      #import-panel .canvas-card{width:100%;max-width:none;min-width:0;margin:0;padding:10px;border-radius:9px;box-shadow:none}
      #import-panel #import-actions{display:block!important;margin:9px 0 0!important;padding:8px 10px;border-radius:8px;background:#faf7ef;text-align:left;line-height:1.5}
      @media(max-width:920px){.vcf-top-grid{grid-template-columns:1fr}.vcf-control-stack{width:100%}}
      @media(max-width:700px){.vcf-cols-4,#generator-panel .gen-actions,#import-panel #import-toolbar{grid-template-columns:repeat(2,minmax(0,1fr))}#generator-panel .gen-controls{grid-template-columns:1fr}}
      @media(max-width:520px){.vcf-tabs{gap:4px;padding:4px}#vcf-app-shell .vcf-tab{min-height:40px;padding:7px 4px;font-size:12px}.vcf-cols-3{grid-template-columns:1fr}.vcf-inline,.vcf-settings-grid{align-items:stretch}.vcf-inline>label,.vcf-settings-grid>label{flex:1 1 150px}}
      @media(max-width:360px){.vcf-tabs,.vcf-actions,.vcf-cols-2,.vcf-cols-4,#generator-panel .gen-actions,#import-panel #import-toolbar{grid-template-columns:1fr}}
    `;
    document.head.appendChild(style);
  }

  installStyle();

  const section = title => {
    const box = document.createElement("section");
    box.className = "vcf-section";
    const h = document.createElement("h3");
    h.className = "vcf-section-title";
    h.textContent = title;
    box.appendChild(h);
    return box;
  };

  const actions = columns => {
    const row = document.createElement("div");
    row.className = `vcf-actions vcf-cols-${columns}`;
    return row;
  };

  const move = (element, target) => {
    if (element && target && element.parentNode !== target) target.appendChild(element);
  };

  function selectedAnalysisColor() {
    return Number(document.querySelector('input[name="acolor"]:checked')?.value) === 2 ? 2 : 1;
  }

  async function applyRuleDirectly(rules) {
    if (typeof window.vcfSetRules !== "function") return false;
    return window.vcfSetRules(rules);
  }

  function installRuleSelect(ruleBox) {
    let select = document.getElementById(RULE_SELECT_ID);
    if (select) return select;

    for (const value of [2, 1, 0]) {
      if (ruleBox.querySelector(`input[name="rules"][value="${value}"]`)) continue;
      const label = document.createElement("label");
      const radio = document.createElement("input");
      radio.type = "radio";
      radio.name = "rules";
      radio.value = String(value);
      label.append(radio, ` ${RULE_NAMES[value]}`);
      ruleBox.appendChild(label);
    }

    const radios = Array.from(ruleBox.querySelectorAll('input[name="rules"]'));
    const current = radios.find(radio => radio.checked) || radios.find(radio => radio.value === "2");
    const compatibility = document.createElement("span");
    compatibility.className = "vcf-rule-radio-compat";
    radios.forEach(radio => {
      const label = radio.closest("label");
      if (label?.parentNode === ruleBox) compatibility.appendChild(label);
    });

    const label = document.createElement("label");
    label.className = "vcf-rule-select-label";
    label.append("規則");
    select = document.createElement("select");
    select.id = RULE_SELECT_ID;
    select.setAttribute("aria-label", "規則");
    [2, 1, 0].forEach(value => {
      const option = document.createElement("option");
      option.value = String(value);
      option.textContent = RULE_NAMES[value];
      select.appendChild(option);
    });
    select.value = current?.value || "2";
    label.appendChild(select);
    ruleBox.append(label, compatibility);

    select.addEventListener("change", async () => {
      const previous = radios.find(radio => radio.checked)?.value || "2";
      const selected = ruleBox.querySelector(`input[name="rules"][value="${select.value}"]`);
      if (!selected || (typeof searching !== "undefined" && searching)) {
        select.value = previous;
        return;
      }
      selected.checked = true;
      if (ruleBox.dataset.threeRulesReady === "1" || selected.value !== "0") {
        selected.dispatchEvent(new Event("change", { bubbles: true }));
      } else if (!await applyRuleDirectly(Number(selected.value))) {
        ruleBox.querySelector(`input[name="rules"][value="${previous}"]`).checked = true;
        select.value = previous;
      }
    });

    ruleBox.addEventListener("change", event => {
      const radio = event.target;
      if (radio instanceof HTMLInputElement && radio.name === "rules" && radio.checked) select.value = radio.value;
    });

    select.disabled = radios.some(radio => radio.disabled);
    return select;
  }

  function installFastButton(mainActions) {
    const black = document.getElementById("btn-black");
    const white = document.getElementById("btn-white");
    if (!black || !white) return null;
    let button = document.getElementById(FAST_BUTTON_ID);
    if (!button) {
      button = document.createElement("button");
      button.id = FAST_BUTTON_ID;
      button.type = "button";
      button.textContent = "速找 VCF";
      button.title = "依目前分析色搜尋第一組 VCF";
      button.addEventListener("click", () => {
        const target = selectedAnalysisColor() === 2 ? white : black;
        if (!target.disabled) target.click();
      });
      mainActions.insertBefore(button, black);
    }
    black.hidden = true;
    white.hidden = true;
    const sync = () => { button.disabled = (selectedAnalysisColor() === 2 ? white : black).disabled; };
    sync();
    document.querySelectorAll('input[name="acolor"]').forEach(radio => radio.addEventListener("change", sync));
    return button;
  }

  function settingToggle(id, text, target, key, kind) {
    const label = document.createElement("label");
    label.className = `vcf-setting-toggle vcf-${kind}-toggle`;
    const input = document.createElement("input");
    input.id = id;
    input.type = "checkbox";
    try { input.checked = localStorage.getItem(key) === "1"; } catch (_) {}
    const update = () => {
      target.hidden = !input.checked;
      label.classList.toggle("vcf-setting-toggle-active", input.checked);
      try { localStorage.setItem(key, input.checked ? "1" : "0"); } catch (_) {}
    };
    input.addEventListener("change", update);
    label.append(input, text);
    update();
    return label;
  }

  function simplifyPruningOptions() {
    const select = document.getElementById("vcf-multi-pruning");
    const fast = select?.querySelector('option[value="fast"]');
    const strict = select?.querySelector('option[value="strict"]');
    if (fast) fast.textContent = "集合子集";
    if (strict) strict.textContent = "完全同盤";
  }

  function groupGenerator(panel) {
    const controls = panel.querySelector(".gen-controls");
    if (!controls || controls.dataset.grouped === "1") return;
    controls.dataset.grouped = "1";
    const children = Array.from(controls.children);
    const makeGroup = title => {
      const group = document.createElement("div");
      group.className = "vcf-gen-group";
      const h = document.createElement("h3");
      h.className = "vcf-gen-group-title";
      h.textContent = title;
      group.appendChild(h);
      return group;
    };
    const conditions = makeGroup("題目條件");
    const preferences = makeGroup("候選偏好");
    children.forEach((child, index) => (index < 2 ? conditions : preferences).appendChild(child));
    controls.append(conditions, preferences);
  }

  function arrangeGeneratorPanel(panel) {
    const title = panel.querySelector(":scope > .gen-title-row");
    if (title) {
      title.querySelectorAll("h2").forEach(heading => heading.remove());
      title.querySelectorAll(".gen-actions").forEach(actions => panel.prepend(actions));
      if (!title.children.length) title.remove();
    }
    const actions = panel.querySelector(":scope > .gen-actions");
    if (actions && panel.firstElementChild !== actions) panel.prepend(actions);
    const bank = document.getElementById("vcf-question-bank");
    if (bank && (bank.parentElement !== panel || panel.lastElementChild !== bank)) panel.appendChild(bank);
  }

  function installTabs(host, panels) {
    const tabs = document.createElement("div");
    tabs.className = "vcf-tabs";
    tabs.setAttribute("role", "tablist");
    const defs = [
      ["calculation", "VCF計算", panels.calculation],
      ["generator", "VCF 題目產生器", panels.generator],
      ["import", "圖片匯入", panels.import],
    ];
    let active = "calculation";
    try {
      const stored = localStorage.getItem("vcf_workspace_tab");
      if (defs.some(([key]) => key === stored)) active = stored;
    } catch (_) {}
    const activate = key => {
      defs.forEach(([tabKey, , panel]) => {
        const button = tabs.querySelector(`[data-tab="${tabKey}"]`);
        const selected = tabKey === key;
        button?.setAttribute("aria-selected", selected ? "true" : "false");
        if (button) button.tabIndex = selected ? 0 : -1;
        panel.hidden = !selected;
      });
      try { localStorage.setItem("vcf_workspace_tab", key); } catch (_) {}
    };
    defs.forEach(([key, text, panel]) => {
      panel.classList.add("vcf-tab-panel");
      panel.id = `vcf-tab-panel-${key}`;
      panel.setAttribute("role", "tabpanel");
      const button = document.createElement("button");
      button.type = "button";
      button.className = "vcf-tab";
      button.dataset.tab = key;
      button.setAttribute("role", "tab");
      button.setAttribute("aria-controls", panel.id);
      button.textContent = text;
      button.addEventListener("click", () => activate(key));
      tabs.appendChild(button);
    });
    host.append(tabs, panels.calculation, panels.generator, panels.import);
    activate(active);
  }

  function install() {
    const app = document.getElementById("vcf-app-shell");
    const topGrid = app?.querySelector(".vcf-top-grid");
    const oldStack = app?.querySelector(".vcf-control-stack");
    const searchCard = app?.querySelector(".vcf-search-card");
    const ruleBox = document.getElementById("rule-box");
    const mainActions = document.getElementById("btns");
    const analysisBox = document.getElementById("analysis-box");
    const analysisActions = document.getElementById("btns2");
    const generatorPanel = document.getElementById("generator-panel");
    const importPanel = document.getElementById("import-panel");
    if (!app || !topGrid || !oldStack || !searchCard || !ruleBox || !mainActions || !analysisBox || !analysisActions || !generatorPanel || !importPanel) return false;
    if (app.dataset.unifiedInterfaceReady === "1") return true;

    simplifyPruningOptions();
    const ruleSelect = installRuleSelect(ruleBox);
    const fastButton = installFastButton(mainActions);
    if (!ruleSelect || !fastButton) return false;

    const existingSearchOptions = document.getElementById("vcf-search-options");
    const workspace = document.createElement("div");
    workspace.className = "vcf-workspace";

    const calcPanel = document.createElement("section");
    calcPanel.className = "vcf-calc-panel";

    const analysisSection = section("分析");
    const analysisRow = document.createElement("div");
    analysisRow.className = "vcf-inline";
    analysisRow.appendChild(analysisBox);
    analysisSection.appendChild(analysisRow);

    const calcSettings = document.createElement("div");
    calcSettings.className = "vcf-settings-card";
    calcSettings.id = "vcf-calculation-settings-card";
    calcSettings.innerHTML = '<h3>計算設定</h3><div class="vcf-settings-grid"></div>';
    const calcSettingsGrid = calcSettings.lastElementChild;

    const calcSection = section("VCF 搜尋");
    const calcRow = actions(3);
    const calcToggle = settingToggle("vcf-show-calculation-settings", "計算設定", calcSettings, "vcf_show_calculation_settings", "calculation");
    calcRow.append(fastButton, calcToggle);
    calcSection.append(calcRow, calcSettings);

    const multiSettings = document.createElement("div");
    multiSettings.className = "vcf-settings-card";
    multiSettings.id = "vcf-multi-settings-card";
    multiSettings.innerHTML = '<h3>多組設定</h3><div class="vcf-settings-grid"></div>';
    const multiSettingsGrid = multiSettings.lastElementChild;

    const multiSection = section("多組 VCF");
    const multiRow = actions(4);
    const multiToggle = settingToggle("vcf-show-multi-settings", "多組設定", multiSettings, "vcf_show_multi_settings", "multi");
    multiSection.append(multiRow, multiSettings);

    const defenseSection = section("防守");
    const defenseRow = actions(2);
    defenseSection.appendChild(defenseRow);

    const extensionSection = section("延伸搜尋");
    const extensionRow = actions(4);
    extensionSection.appendChild(extensionRow);

    const boardSection = section("棋盤操作");
    const boardRow = actions(4);
    boardSection.appendChild(boardRow);

    calcPanel.append(analysisSection, calcSection, multiSection, defenseSection, extensionSection, boardSection);

    const generatorTab = document.createElement("section");
    groupGenerator(generatorPanel);
    arrangeGeneratorPanel(generatorPanel);
    window.addEventListener("vcf-question-bank-ready", () => arrangeGeneratorPanel(generatorPanel), { once: true });
    generatorTab.appendChild(generatorPanel);

    const importTab = document.createElement("section");
    importTab.appendChild(importPanel);

    installTabs(workspace, { calculation: calcPanel, generator: generatorTab, import: importTab });

    const searchOptions = existingSearchOptions || document.createElement("div");
    searchOptions.classList.add("vcf-compat-host");
    mainActions.classList.add("vcf-compat-host");
    analysisActions.classList.add("vcf-compat-host");
    ruleBox.classList.add("vcf-compat-host");
    calcPanel.append(searchOptions, ruleBox, mainActions, analysisActions);
    oldStack.replaceWith(workspace);

    const labels = {
      "btn-stop": "停止",
      "btn-continue": "繼續搜尋",
      "btn-clear-vcf": "清除標記",
      "btn-clear": "清空棋盤",
      "btn-block-vcf": "單一路線防守",
      "btn-block-vcf-all": "全部路線防守",
      "btn-multi-vcf": "多組 VCF",
      "btn-vcf-prev": "上一組",
      "btn-vcf-next": "下一組",
      "btn-level3": "VCT 選點",
      "btn-add-black": "補黑找 VCF",
      "btn-add-white": "補白找 VCF",
      "btn-shortest-vcf": "最短 VCF",
    };
    Object.entries(labels).forEach(([id, text]) => {
      const button = document.getElementById(id);
      if (button) button.textContent = text;
    });

    const reconcile = () => {
      simplifyPruningOptions();
      const dynamicSearchOptions = document.getElementById("vcf-search-options");
      if (dynamicSearchOptions) {
        dynamicSearchOptions.classList.add("vcf-compat-host");
        move(dynamicSearchOptions, calcPanel);
      }
      move(document.getElementById("show-forbidden")?.closest("label"), analysisRow);
      move(document.getElementById("btn-shortest-vcf"), calcRow);
      move(calcToggle, calcRow);
      [
        document.getElementById("vcf-multi-time-seconds")?.closest("label"),
        document.getElementById("vcf-multi-node-millions")?.closest("label"),
        document.getElementById("vcf-simplify-route")?.closest("label"),
        document.getElementById(RULE_SELECT_ID)?.closest("label"),
      ].forEach(element => move(element, calcSettingsGrid));
      ["btn-multi-vcf", "btn-vcf-prev", "btn-vcf-next"].forEach(id => move(document.getElementById(id), multiRow));
      move(multiToggle, multiRow);
      [
        document.getElementById("vcf-multi-pruning")?.closest("label"),
        document.getElementById("vcf-stop-after-open-four")?.closest("label"),
        document.getElementById("vcf-same-type-trim-live-four")?.closest("label"),
      ].forEach(element => move(element, multiSettingsGrid));
      ["btn-block-vcf", "btn-block-vcf-all"].forEach(id => move(document.getElementById(id), defenseRow));
      ["btn-level3", "btn-add-black", "btn-add-white"].forEach(id => move(document.getElementById(id), extensionRow));
      move(document.getElementById("vcf-add-search-mode")?.closest("label"), extensionRow);
      ["btn-stop", "btn-continue", "btn-clear-vcf", "btn-clear"].forEach(id => move(document.getElementById(id), boardRow));
      document.getElementById("btn-black-optimized")?.setAttribute("hidden", "");
      document.getElementById("btn-white-optimized")?.setAttribute("hidden", "");
    };
    reconcile();

    if (typeof window.vcfRegisterBusyHook === "function") {
      window.vcfRegisterBusyHook("unified-interface", value => {
        const busy = Boolean(value);
        const calculation = document.getElementById("vcf-show-calculation-settings");
        const multi = document.getElementById("vcf-show-multi-settings");
        const ruleSelect = document.getElementById(RULE_SELECT_ID);
        const fast = document.getElementById(FAST_BUTTON_ID);
        if (calculation) calculation.disabled = busy;
        if (multi) multi.disabled = busy;
        if (ruleSelect) ruleSelect.disabled = busy;
        if (fast) fast.disabled = busy;
      });
    }

    app.dataset.unifiedInterfaceReady = "1";
    document.documentElement.classList.remove(PENDING_CLASS);
    document.documentElement.classList.add(READY_CLASS);
    return true;
  }

  if (!install()) {
    document.documentElement.classList.remove(PENDING_CLASS);
    document.documentElement.classList.add(READY_CLASS);
  }
})();
