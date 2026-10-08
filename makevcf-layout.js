"use strict";

// The final workbench is native HTML; this module owns record import and calculation playback.
(function initVCFWorkbenchControls() {
  const BOARD_SIZE = 15;
  const BOARD_CELLS = BOARD_SIZE * BOARD_SIZE;
  const BLACK = 1;
  const WHITE = 2;
  const EMPTY = 0;
  const PASS_MOVE = -1;
  const LZ4_FRAME_MAGIC = 0x184d2204;
  const board = document.getElementById("board-svg");
  const recordCommentInput = document.getElementById("vcf-record-comment-input");
  const recordCommentMeta = document.getElementById("vcf-record-comment-meta");
  const calculationNavigation = document.getElementById("vcf-calculation-navigation");
  const prevStepButton = document.getElementById("btn-vcf-step-prev");
  const nextStepButton = document.getElementById("btn-vcf-step-next");
  const previousBranchButton = document.getElementById("btn-vcf-branch-prev");
  const nextBranchButton = document.getElementById("btn-vcf-branch-next");
  const calcPrevGroupButton = document.getElementById("btn-vcf-calc-group-prev");
  const calcNextGroupButton = document.getElementById("btn-vcf-calc-group-next");
  const calcPrevStepButton = document.getElementById("btn-vcf-calc-step-prev");
  const calcNextStepButton = document.getElementById("btn-vcf-calc-step-next");
  const calcGroupSelect = document.getElementById("vcf-calculation-group-select");

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
    const input = document.getElementById("bb-import-record-input");
    const button = document.getElementById("bb-import-record");
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

  installRecordImportControls();
})();

(function bindWorkbenchPresentation() {
  const view = document.documentElement.dataset;
  const tabs = Array.from(document.querySelectorAll(".vcf-tab"));
  function activate(key) {
    view.vcfTab = key;
    for (const tab of tabs) {
      const selected = tab.dataset.tab === key;
      tab.setAttribute("aria-selected", String(selected));
      tab.tabIndex = selected ? 0 : -1;
    }
    try { localStorage.setItem("vcf_workspace_tab", key); } catch (_) {}
  }
  for (const tab of tabs) {
    tab.addEventListener("click", () => activate(tab.dataset.tab));
    tab.addEventListener("keydown", event => {
      const index = tabs.indexOf(tab);
      let next;
      if (event.key === "ArrowRight") next = (index + 1) % tabs.length;
      if (event.key === "ArrowLeft") next = (index + tabs.length - 1) % tabs.length;
      if (event.key === "Home") next = 0;
      if (event.key === "End") next = tabs.length - 1;
      if (next === undefined) return;
      event.preventDefault();
      activate(tabs[next].dataset.tab);
      tabs[next].focus();
    });
  }
  activate(view.vcfTab || "calculation");

  for (const kind of ["calculation", "multi"]) {
    const input = document.getElementById(`vcf-show-${kind}-settings`);
    const attribute = kind === "calculation" ? "vcfCalculationSettings" : "vcfMultiSettings";
    input.checked = view[attribute] === "1";
    input.addEventListener("change", () => {
      view[attribute] = input.checked ? "1" : "0";
      try { localStorage.setItem(`vcf_show_${kind}_settings`, view[attribute]); } catch (_) {}
    });
  }

  const ruleBox = document.getElementById("rule-box");
  const ruleSelect = document.getElementById("vcf-rule-select");
  const radios = Array.from(ruleBox.querySelectorAll('input[name="rules"]'));
  ruleSelect.value = radios.find(radio => radio.checked)?.value || "2";
  ruleSelect.addEventListener("change", () => {
    const previous = radios.find(radio => radio.checked)?.value || "2";
    const selected = radios.find(radio => radio.value === ruleSelect.value);
    if (!selected || (typeof searching !== "undefined" && searching)) {
      ruleSelect.value = previous;
      return;
    }
    selected.checked = true;
    selected.dispatchEvent(new Event("change", { bubbles: true }));
  });
  ruleBox.addEventListener("change", () => {
    ruleSelect.value = radios.find(radio => radio.checked)?.value || "2";
  });
  window.addEventListener("vcf-rules-changed", () => {
    ruleSelect.value = radios.find(radio => radio.checked)?.value || "2";
  });

  const fast = document.getElementById("btn-fast-vcf");
  const selectedButton = () => document.getElementById(
    Number(document.querySelector('input[name="acolor"]:checked')?.value) === 2 ? "btn-white" : "btn-black"
  );
  fast.addEventListener("click", () => { if (!selectedButton().disabled) selectedButton().click(); });
  document.querySelectorAll('input[name="acolor"]').forEach(radio => {
    radio.addEventListener("change", () => { fast.disabled = selectedButton().disabled; });
  });
  fast.disabled = selectedButton().disabled;
  window.vcfRegisterBusyHook?.("workbench-presentation", value => {
    for (const id of ["vcf-show-calculation-settings", "vcf-show-multi-settings", "vcf-rule-select", "btn-fast-vcf"]) {
      document.getElementById(id).disabled = Boolean(value);
    }
  });
})();
