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
      <span>逐手瀏覽目前 VCF 或已讀取的 Rapfi DB／RenLib 分支棋譜。</span>
    </div>
    <div id="vcf-record-navigation-actions" class="vcf-record-navigation-actions"></div>
  `;
  boardCard.appendChild(recordNavigation);

  const controlStack = document.createElement("div");
  controlStack.className = "vcf-control-stack";

  const searchCard = makeCard("基本搜尋", "選擇規則後，直接尋找黑方或白方 VCF。", "vcf-search-card");
  ruleBox.classList.add("vcf-option-row");
  mainActions.classList.add("vcf-action-grid");
  searchCard.append(ruleBox, mainActions);

  const analysisCard = makeCard("進階分析", "針對目前盤面查看防點、多組路線、分支回放與延伸選點。", "vcf-analysis-card");
  analysisBox.classList.add("vcf-option-row");
  analysisActions.classList.add("vcf-action-grid");
  analysisCard.append(analysisBox, analysisActions);

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
  const previousBranchButton = document.getElementById("btn-vcf-prev");
  const nextBranchButton = document.getElementById("btn-vcf-next");
  const recordNavigationActions = document.getElementById("vcf-record-navigation-actions");
  if (recordNavigationActions) {
    recordNavigationActions.append(prevStepButton, nextStepButton);
    if (previousBranchButton) recordNavigationActions.appendChild(previousBranchButton);
    if (nextBranchButton) recordNavigationActions.appendChild(nextBranchButton);
  } else if (previousBranchButton) {
    analysisActions.insertBefore(prevStepButton, previousBranchButton);
    analysisActions.insertBefore(nextStepButton, previousBranchButton);
  } else {
    analysisActions.append(prevStepButton, nextStepButton);
  }

  let replaySignature = "";
  let replayPly = 0;
  let importedTree = null;

  function currentReplayRoute() {
    if (typeof lastVCFMoves === "undefined" || !lastVCFMoves || typeof lastVCFMoves.length !== "number") {
      return [];
    }
    return Array.from(lastVCFMoves, move => Number(move));
  }

  function currentReplaySignature(route) {
    const color = typeof lastVCFColor !== "undefined" ? Number(lastVCFColor) : 1;
    const group = typeof vcfGroupIdx !== "undefined" ? Number(vcfGroupIdx) : -1;
    return `${color}|${group}|${route.join(",")}`;
  }

  function ensureReplayState() {
    const route = currentReplayRoute();
    if (!route.length) {
      replaySignature = "";
      replayPly = 0;
      return route;
    }
    const signature = currentReplaySignature(route);
    if (signature !== replaySignature) {
      replaySignature = signature;
      replayPly = route.length;
    }
    return route;
  }

  function replayStatus(route) {
    const color = typeof lastVCFColor !== "undefined" && Number(lastVCFColor) === 2 ? "白" : "黑";
    const groups = typeof vcfGroups !== "undefined" && Array.isArray(vcfGroups) ? vcfGroups : null;
    const branchText = groups && groups.length
      ? `分支 ${Math.min(groups.length, Number(vcfGroupIdx || 0) + 1)}/${groups.length}`
      : "單一分支";
    const stepText = replayPly === 0 ? "起始盤面" : `第 ${replayPly}/${route.length} 手`;
    if (typeof setStatus === "function") setStatus(`${color}方 ${branchText}，${stepText}`);
  }

  function moveVcfReplay(delta) {
    const route = ensureReplayState();
    if (!route.length) {
      if (typeof setStatus === "function") setStatus("目前沒有可回放的 VCF 分支");
      return;
    }
    replayPly = Math.max(0, Math.min(route.length, replayPly + delta));
    const color = typeof lastVCFColor !== "undefined" ? Number(lastVCFColor) : 1;
    window._showVCF?.(route.slice(0, replayPly), color);
    replayStatus(route);
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

  function makeRecordNode({ move = null, board: nodeBoard = null, sideToMove = BLACK, ply = 0, rule = null, synthetic = false, navigable = true } = {}) {
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
        return { board: candidate, move: additions === 1 ? added : PASS_MOVE };
      }
    }
    return null;
  }

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
      reader.skip(valueLength);
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
        });
        node.parent = parent;
        parent.children.push(node);
        break;
      }
      if (!node) {
        node = makeRecordNode({ board: record.board, sideToMove: record.sideToMove, ply: record.ply, rule: record.rule });
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

  function coordLabel(move) {
    if (move === PASS_MOVE) return "PASS";
    if (!Number.isInteger(move) || move < 0 || move >= BOARD_CELLS) return "";
    const x = move % BOARD_SIZE;
    const y = Math.floor(move / BOARD_SIZE);
    return `${String.fromCharCode(65 + x)}${y + 1}`;
  }

  function importedSiblingInfo(node) {
    const siblings = node?.parent?.children || [];
    const index = siblings.indexOf(node);
    return { siblings, index };
  }

  function importedHasBranchChoice(node) {
    const { siblings } = importedSiblingInfo(node);
    return siblings.length > 1 || (node?.children?.length || 0) > 1;
  }

  function updateImportedBranchButtons() {
    if (!importedTree) return;
    const enabled = importedHasBranchChoice(importedTree.current);
    if (previousBranchButton) previousBranchButton.disabled = !enabled;
    if (nextBranchButton) nextBranchButton.disabled = !enabled;
  }

  function importedStatus() {
    if (!importedTree) return;
    const node = importedTree.current;
    const { siblings, index } = importedSiblingInfo(node);
    const siblingText = siblings.length > 1 ? `，同層分支 ${index + 1}/${siblings.length}` : "";
    const moveText = node.synthetic ? "起始盤面" : node.move == null ? `局面 ${node.ply}` : `第 ${node.ply} 手 ${coordLabel(node.move)}`;
    const nextText = node.children.length ? `，後續 ${node.children.length} 分支` : "，末端";
    const canonicalText = importedTree.format === "YXDB" ? "（canonical 方向）" : "";
    const compressionText = importedTree.compressed ? "、LZ4" : "";
    const text = `${importedTree.format}${compressionText} ${importedTree.fileName || "棋譜"}${canonicalText}：${moveText}${siblingText}${nextText}`;
    if (typeof setStatus === "function") setStatus(text);
    const quickStatus = document.getElementById("bb-export-status");
    if (quickStatus) quickStatus.textContent = text;
  }

  function renderImportedNode(node) {
    if (!importedTree || !node) return;
    importedTree.current = node;
    window.vcfInvalidateAnalysis?.("分支棋譜回放");
    const applyBoard = () => window._setBoardArr?.(Array.from(node.board), node.sideToMove);
    if (typeof window.vcfWithBoardChangeSource === "function") {
      window.vcfWithBoardChangeSource("record-playback", applyBoard);
    } else {
      applyBoard();
    }
    updateImportedBranchButtons();
    importedStatus();
  }

  function moveImportedStep(direction) {
    if (!importedTree) return false;
    const current = importedTree.current;
    if (direction < 0) {
      const parent = current.parent;
      if (!parent || parent.navigable === false) {
        importedStatus();
        return true;
      }
      renderImportedNode(parent);
      return true;
    }
    if (!current.children.length) {
      importedStatus();
      return true;
    }
    current.selectedChild = Math.max(0, Math.min(current.children.length - 1, current.selectedChild || 0));
    renderImportedNode(current.children[current.selectedChild]);
    return true;
  }

  function moveImportedBranch(direction) {
    if (!importedTree) return false;
    const current = importedTree.current;
    const { siblings, index } = importedSiblingInfo(current);
    if (siblings.length > 1 && index >= 0) {
      const nextIndex = (index + direction + siblings.length) % siblings.length;
      current.parent.selectedChild = nextIndex;
      renderImportedNode(siblings[nextIndex]);
      return true;
    }
    if (current.children.length > 1) {
      const count = current.children.length;
      const nextIndex = ((current.selectedChild || 0) + direction + count) % count;
      current.selectedChild = nextIndex;
      renderImportedNode(current.children[nextIndex]);
      return true;
    }
    importedStatus();
    return true;
  }

  async function loadRecordFile(file) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const lowerName = String(file.name || "").toLowerCase();
    const looksRenLib = lowerName.endsWith(".lib")
      || (bytes.length >= 8 && bytes[0] === 0xff && bytes[1] === 0x52 && bytes[2] === 0x65 && bytes[3] === 0x6e);
    const tree = looksRenLib ? parseRenLib(bytes) : parseYXDB(bytes);
    document.getElementById("btn-clear-vcf")?.click();
    importedTree = tree;
    importedTree.fileName = file.name || (looksRenLib ? "棋譜.lib" : "棋譜.db");
    replaySignature = "";
    replayPly = 0;
    if (tree.rule != null && typeof window.vcfSetRules === "function") await window.vcfSetRules(tree.rule);
    renderImportedNode(tree.current);
  }

  function installRecordImportControls() {
    const panel = document.getElementById("bitboard-architecture-panel");
    if (!panel || document.getElementById("bb-import-record")) return;
    const input = document.createElement("input");
    input.id = "bb-import-record-input";
    input.type = "file";
    input.accept = ".db,.lib,application/octet-stream";
    input.hidden = true;
    const button = document.createElement("button");
    button.id = "bb-import-record";
    button.className = "bb-lab-link";
    button.type = "button";
    button.textContent = "讀取 DB／LIB";
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
    if (!moveImportedStep(-1)) moveVcfReplay(-1);
  });
  nextStepButton.addEventListener("click", () => {
    if (!moveImportedStep(1)) moveVcfReplay(1);
  });

  previousBranchButton?.addEventListener("click", () => {
    if (moveImportedBranch(-1)) return;
    replaySignature = "";
    replayPly = 0;
  });
  nextBranchButton?.addEventListener("click", () => {
    if (moveImportedBranch(1)) return;
    replaySignature = "";
    replayPly = 0;
  });

  // 原始盤面被手動或其他功能改動時，退出已載入棋譜的瀏覽狀態；本模組自己的
  // record-playback _setBoardArr 事件則保留 importedTree。
  window.addEventListener("vcf-board-changed", event => {
    if (!importedTree || event.detail?.source === "record-playback") return;
    importedTree = null;
  });

  for (const container of [mainActions, analysisActions]) {
    container.addEventListener("click", event => {
      const id = event.target?.id || "";
      if (!importedTree || ["btn-vcf-step-prev", "btn-vcf-step-next", "btn-vcf-prev", "btn-vcf-next"].includes(id)) return;
      importedTree = null;
    });
  }

  for (const id of ["btn-clear-vcf", "btn-clear"]) {
    document.getElementById(id)?.addEventListener("click", () => {
      replaySignature = "";
      replayPly = 0;
      importedTree = null;
    });
  }

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
    "btn-vcf-prev": "前一分支",
    "btn-vcf-next": "後一分支",
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

    .vcf-record-navigation {
      width: 100%;
      margin-top: 12px;
      padding: 10px;
      border: 1px solid #d8caa8;
      border-radius: 9px;
      background: #faf6e9;
    }

    .vcf-record-navigation-heading {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 8px;
      margin-bottom: 8px;
      color: #46391f;
      font-size: 13px;
    }

    .vcf-record-navigation-heading span {
      color: var(--vcf-muted);
      font-size: 12px;
      text-align: right;
    }

    .vcf-record-navigation-actions {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 6px;
      width: 100%;
    }

    #vcf-record-navigation-actions button {
      min-height: 38px;
      padding: 7px 5px;
      font-size: 13px;
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
      .vcf-record-navigation-heading { align-items: flex-start; flex-direction: column; }
      .vcf-record-navigation-heading span { text-align: left; }
      .vcf-record-navigation-actions { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    }

    @media (max-width: 380px) {
      .vcf-action-grid,
      #generator-panel .gen-actions,
      #import-toolbar,
      #import-actions { grid-template-columns: 1fr; }
    }
  `;
  document.head.appendChild(style);

  document.addEventListener("DOMContentLoaded", () => {
    document.title = "五子棋工作台";
    installRecordImportControls();
  }, { once: true });
})();
