"use strict";

(function installCompactWorkbenchHeader(global) {
  const ruleNames = { 0: "自由", 1: "無禁", 2: "有禁" };
  const BOARD_SIZE = 15;
  const BOARD_CELLS = BOARD_SIZE * BOARD_SIZE;
  const BLACK = 1;
  const WHITE = 2;
  const EMPTY = 0;
  const PASS = -1;

  class ByteWriter {
    constructor() { this.bytes = []; }
    u8(value) { this.bytes.push(Number(value) & 0xff); }
    u16(value) {
      const v = Number(value) & 0xffff;
      this.bytes.push(v & 0xff, (v >>> 8) & 0xff);
    }
    u32(value) {
      const v = Number(value) >>> 0;
      this.bytes.push(v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff);
    }
    raw(values) {
      for (const value of values) this.u8(value);
    }
    finish() { return new Uint8Array(this.bytes); }
  }

  // Rapfi 預設以標準 LZ4 frame 保存 Yixin DB。使用合法的 uncompressed
  // LZ4 blocks 可避免額外壓縮相依，同時讓外部 Rapfi/Yixin reader 看到
  // 與一般交換檔相同的 LZ4 frame magic / descriptor。
  const LZ4_FRAME_MAGIC_BYTES = [0x04, 0x22, 0x4d, 0x18];
  const LZ4_FLG = 0x44; // version=01, dependent blocks, content checksum
  const LZ4_BD = 0x40;  // 64 KiB maximum block size
  const LZ4_BLOCK_MAX = 64 * 1024;
  const XXH32_P1 = 0x9e3779b1;
  const XXH32_P2 = 0x85ebca77;
  const XXH32_P3 = 0xc2b2ae3d;
  const XXH32_P4 = 0x27d4eb2f;
  const XXH32_P5 = 0x165667b1;

  function rotl32(value, shift) {
    return ((value << shift) | (value >>> (32 - shift))) >>> 0;
  }

  function readU32LE(bytes, offset) {
    return (bytes[offset]
      | (bytes[offset + 1] << 8)
      | (bytes[offset + 2] << 16)
      | (bytes[offset + 3] << 24)) >>> 0;
  }

  function xxhash32(value, seed = 0) {
    const bytes = value instanceof Uint8Array ? value : new Uint8Array(value || 0);
    const length = bytes.length;
    let offset = 0;
    let hash;
    const round = (acc, input) => {
      acc = (acc + Math.imul(input, XXH32_P2)) >>> 0;
      acc = rotl32(acc, 13);
      return Math.imul(acc, XXH32_P1) >>> 0;
    };

    if (length >= 16) {
      let v1 = (Number(seed) + XXH32_P1 + XXH32_P2) >>> 0;
      let v2 = (Number(seed) + XXH32_P2) >>> 0;
      let v3 = Number(seed) >>> 0;
      let v4 = (Number(seed) - XXH32_P1) >>> 0;
      const limit = length - 16;
      while (offset <= limit) {
        v1 = round(v1, readU32LE(bytes, offset)); offset += 4;
        v2 = round(v2, readU32LE(bytes, offset)); offset += 4;
        v3 = round(v3, readU32LE(bytes, offset)); offset += 4;
        v4 = round(v4, readU32LE(bytes, offset)); offset += 4;
      }
      hash = (rotl32(v1, 1) + rotl32(v2, 7) + rotl32(v3, 12) + rotl32(v4, 18)) >>> 0;
    } else {
      hash = (Number(seed) + XXH32_P5) >>> 0;
    }

    hash = (hash + length) >>> 0;
    while (offset + 4 <= length) {
      hash = (hash + Math.imul(readU32LE(bytes, offset), XXH32_P3)) >>> 0;
      hash = Math.imul(rotl32(hash, 17), XXH32_P4) >>> 0;
      offset += 4;
    }
    while (offset < length) {
      hash = (hash + Math.imul(bytes[offset++], XXH32_P5)) >>> 0;
      hash = Math.imul(rotl32(hash, 11), XXH32_P1) >>> 0;
    }
    hash ^= hash >>> 15;
    hash = Math.imul(hash, XXH32_P2) >>> 0;
    hash ^= hash >>> 13;
    hash = Math.imul(hash, XXH32_P3) >>> 0;
    hash ^= hash >>> 16;
    return hash >>> 0;
  }

  function wrapLZ4Frame(value) {
    const payload = value instanceof Uint8Array ? value : new Uint8Array(value || 0);
    const writer = new ByteWriter();
    writer.raw(LZ4_FRAME_MAGIC_BYTES);
    writer.u8(LZ4_FLG);
    writer.u8(LZ4_BD);
    writer.u8((xxhash32(new Uint8Array([LZ4_FLG, LZ4_BD])) >>> 8) & 0xff);
    for (let offset = 0; offset < payload.length; offset += LZ4_BLOCK_MAX) {
      const block = payload.subarray(offset, Math.min(payload.length, offset + LZ4_BLOCK_MAX));
      writer.u32((0x80000000 | block.length) >>> 0); // standard uncompressed block
      writer.raw(block);
    }
    writer.u32(0); // EndMark
    writer.u32(xxhash32(payload)); // content checksum (FLG bit 2)
    return writer.finish();
  }

  function normalizeBoard(value) {
    if (!value || typeof value.length !== "number") throw new TypeError("找不到目前盤面資料");
    const board = new Uint8Array(BOARD_CELLS);
    for (let i = 0; i < BOARD_CELLS; i++) {
      const stone = Number(value[i]);
      board[i] = stone === BLACK || stone === WHITE ? stone : EMPTY;
    }
    return board;
  }

  function countStones(board) {
    let black = 0;
    let white = 0;
    for (let i = 0; i < BOARD_CELLS; i++) {
      if (board[i] === BLACK) black++;
      else if (board[i] === WHITE) white++;
    }
    return { black, white };
  }

  function normalSideToMove(board) {
    const { black, white } = countStones(board);
    if (black === white) return BLACK;
    if (black === white + 1) return WHITE;
    return 0;
  }

  function assertRapfiPosition(board, expectedSide = 0) {
    const { black, white } = countStones(board);
    const side = normalSideToMove(board);
    if (!side) {
      throw new Error(`標準 YXDB 無法無損表示此盤面：黑 ${black} 子、白 ${white} 子；必須為黑白同數或黑多 1 子。`);
    }
    if (expectedSide && side !== expectedSide) {
      throw new Error(`標準 YXDB 的下一手應為${side === BLACK ? "黑" : "白"}，但目前 VCF 路線由${expectedSide === BLACK ? "黑" : "白"}先行。`);
    }
    return side;
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

  function positionListForTransform(board, stone, transform) {
    const positions = [];
    for (let idx = 0; idx < BOARD_CELLS; idx++) {
      if (board[idx] !== stone) continue;
      const x = idx % BOARD_SIZE;
      const y = Math.floor(idx / BOARD_SIZE);
      positions.push(transformXY(x, y, transform));
    }
    positions.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    return positions;
  }

  function comparePositionLists(left, right) {
    const length = Math.min(left.length, right.length);
    for (let i = 0; i < length; i++) {
      const dx = left[i][0] - right[i][0];
      if (dx) return dx;
      const dy = left[i][1] - right[i][1];
      if (dy) return dy;
    }
    return left.length - right.length;
  }

  function canonicalPosition(board) {
    let best = null;
    for (let transform = 0; transform < 8; transform++) {
      const black = positionListForTransform(board, BLACK, transform);
      const white = positionListForTransform(board, WHITE, transform);
      const candidate = { black, white };
      if (!best) {
        best = candidate;
        continue;
      }
      const blackCmp = comparePositionLists(candidate.black, best.black);
      if (blackCmp < 0 || (blackCmp === 0 && comparePositionLists(candidate.white, best.white) < 0)) {
        best = candidate;
      }
    }
    return best;
  }

  function yxdbKeyBytes(board, rule) {
    const canonical = canonicalPosition(board);
    const bytes = [rule, BOARD_SIZE, BOARD_SIZE];
    for (const [x, y] of canonical.black) bytes.push(x, y);
    for (const [x, y] of canonical.white) bytes.push(x, y);
    return bytes;
  }

  function keyString(bytes) {
    return bytes.map(value => value.toString(16).padStart(2, "0")).join("");
  }

  function normalizedRoutes(routes) {
    if (!Array.isArray(routes)) return [];
    return routes.map(route => {
      if (!Array.isArray(route) && !(route && typeof route.length === "number")) return [];
      return Array.from(route, move => Number(move));
    }).filter(route => route.length > 0);
  }
  function boardsEqual(left, right) {
    for (let i = 0; i < BOARD_CELLS; i++) {
      if (Number(left[i] || 0) !== Number(right[i] || 0)) return false;
    }
    return true;
  }

  function normalizeSetupHistory(history, rootBoard) {
    if (!Array.isArray(history)) return null;
    const replay = new Uint8Array(BOARD_CELLS);
    const normalized = [];
    let expectedStone = BLACK;
    for (const raw of history) {
      const index = Number(raw?.index ?? raw?.move);
      const stone = Number(raw?.stone ?? raw?.color);
      if (!Number.isInteger(index) || index < 0 || index >= BOARD_CELLS) return null;
      if (stone !== expectedStone || replay[index] !== EMPTY) return null;
      replay[index] = stone;
      normalized.push({
        index,
        stone,
        recordText: typeof raw?.recordText === "string" ? raw.recordText : "",
      });
      expectedStone = expectedStone === BLACK ? WHITE : BLACK;
    }
    return boardsEqual(replay, rootBoard) ? normalized : null;
  }

  // Rapfi YXDB is a position DAG. The exported branch must contain the path
  // from the empty board to the selected root. Unlike the old implementation,
  // this path is now the user's actual move history instead of a coordinate-sort
  // reconstruction, so the intended game order is preserved as far as YXDB's
  // symmetry/transposition model allows.
  function addYXDBSetupPath(rootBoard, add, history, historyExact, rootRecordText = "") {
    const setupBoard = new Uint8Array(BOARD_CELLS);
    add(setupBoard, rootRecordText);
    const stoneCount = countStones(rootBoard);
    if (stoneCount.black + stoneCount.white === 0) return;
    if (historyExact === false) {
      throw new Error("目前盤面沒有可驗證的原始落子 history；請清空棋盤後依原手順重新落子，再匯出 DB。");
    }
    const setupHistory = normalizeSetupHistory(history, rootBoard);
    if (!setupHistory && historyExact == null) {
      const canonical = canonicalPosition(rootBoard);
      const count = Math.max(canonical.black.length, canonical.white.length);
      for (let i = 0; i < count; i++) {
        if (i < canonical.black.length) {
          const [x, y] = canonical.black[i];
          setupBoard[y * BOARD_SIZE + x] = BLACK;
          add(setupBoard);
        }
        if (i < canonical.white.length) {
          const [x, y] = canonical.white[i];
          setupBoard[y * BOARD_SIZE + x] = WHITE;
          add(setupBoard);
        }
      }
      return;
    }
    if (!setupHistory) {
      throw new Error("目前盤面的落子 history 與棋盤不一致；為避免匯出錯誤手順，請清空後依原手順重新落子。");
    }
    for (const move of setupHistory) {
      setupBoard[move.index] = move.stone;
      add(setupBoard, move.recordText);
    }
  }

  function collectYXDBPositions(rootBoard, routes, attacker, rule, history = [], historyExact = null, rootRecordText = "") {
    const records = new Map();
    const add = (board, text = "") => {
      assertRapfiPosition(board);
      const key = yxdbKeyBytes(board, rule);
      const id = keyString(key);
      const existing = records.get(id);
      if (existing) {
        if (!existing.text && text) existing.text = String(text);
      } else {
        records.set(id, { key, text: String(text || "") });
      }
    };

    addYXDBSetupPath(rootBoard, add, history, historyExact, rootRecordText);
    for (const route of normalizedRoutes(routes)) {
      const board = new Uint8Array(rootBoard);
      let side = attacker;
      assertRapfiPosition(board, side);
      for (const move of route) {
        if (!Number.isInteger(move) || move < 0 || move >= BOARD_CELLS) {
          throw new Error(`VCF 路線含無效落點：${move}`);
        }
        if (board[move] !== EMPTY) {
          throw new Error(`VCF 路線落在已有棋子的交點：${move}`);
        }
        board[move] = side;
        side = side === BLACK ? WHITE : BLACK;
        assertRapfiPosition(board, side);
        add(board);
      }
    }

    return Array.from(records.values()).sort((a, b) => {
      const left = a.key;
      const right = b.key;
      for (let i = 0; i < 3; i++) {
        if (left[i] !== right[i]) return left[i] - right[i];
      }
      const leftStoneBytes = left.length - 3;
      const rightStoneBytes = right.length - 3;
      if (leftStoneBytes !== rightStoneBytes) return leftStoneBytes - rightStoneBytes;
      for (let i = 3; i < left.length; i++) {
        if (left[i] !== right[i]) return left[i] - right[i];
      }
      return 0;
    });
  }

  function createYXDB({ board, routes = [], attacker = 0, rule = 2, history = [], historyExact = null, rootRecordText = "" }) {
    const normalizedBoard = normalizeBoard(board);
    const normalizedRule = [0, 1, 2].includes(Number(rule)) ? Number(rule) : 2;
    const routeList = normalizedRoutes(routes);
    const side = routeList.length ? Number(attacker) : 0;
    if (routeList.length && side !== BLACK && side !== WHITE) {
      throw new Error("YXDB 匯出需要知道 VCF 攻方");
    }
    const records = collectYXDBPositions(normalizedBoard, routeList, side, normalizedRule, history, historyExact, rootRecordText);
    const writer = new ByteWriter();
    const encoder = new TextEncoder();
    const metadata = encoder.encode('charset="UTF-8"');

    writer.u32(records.length + 1);
    writer.u16(3);
    writer.raw([0, 0, 0]);
    writer.u16(5 + metadata.length);
    writer.raw([0, 0, 0, 0, 0]);
    writer.raw(metadata);

    for (const record of records) {
      const textBytes = encoder.encode(record.text || "");
      writer.u16(record.key.length);
      writer.raw(record.key);
      writer.u16(5 + textBytes.length);
      writer.u8(0xff); // Database::LABEL_NONE (-1)
      writer.u16(0);   // value
      writer.u16(0);   // depth/bound
      writer.raw(textBytes);
    }

    const rawBytes = writer.finish();
    return { bytes: wrapLZ4Frame(rawBytes), recordCount: records.length, compressed: true };
  }

  function deterministicSetupMoves(board, desiredSide = 0) {
    const black = [];
    const white = [];
    for (let idx = 0; idx < BOARD_CELLS; idx++) {
      if (board[idx] === BLACK) black.push(idx);
      else if (board[idx] === WHITE) white.push(idx);
    }
    const queues = { [BLACK]: black, [WHITE]: white };
    const offsets = { [BLACK]: 0, [WHITE]: 0 };
    const moves = [];
    let side = BLACK;
    while (offsets[BLACK] < black.length || offsets[WHITE] < white.length) {
      const queue = queues[side];
      const offset = offsets[side];
      if (offset < queue.length) {
        moves.push(queue[offset]);
        offsets[side]++;
      } else {
        moves.push(PASS);
      }
      side = side === BLACK ? WHITE : BLACK;
    }
    if (desiredSide && side !== desiredSide) {
      moves.push(PASS);
      side = side === BLACK ? WHITE : BLACK;
    }
    return { moves, side };
  }

  function makeTreeNode(move = null) {
    return { move, children: [], childMap: new Map() };
  }

  function appendChild(parent, move) {
    const key = String(move);
    let child = parent.childMap.get(key);
    if (!child) {
      child = makeTreeNode(move);
      parent.childMap.set(key, child);
      parent.children.push(child);
    }
    return child;
  }

  function buildRenLibTree(rootBoard, routes, attacker, history = [], historyExact = null) {
    const routeList = normalizedRoutes(routes);
    const root = makeTreeNode();
    const stoneCount = countStones(rootBoard);
    const setupHistory = normalizeSetupHistory(history, rootBoard);
    let setupMoves;
    if (stoneCount.black + stoneCount.white === 0) {
      setupMoves = [];
    } else if (historyExact !== false && setupHistory) {
      setupMoves = setupHistory.map(move => move.index);
    } else if (historyExact == null) {
      setupMoves = deterministicSetupMoves(rootBoard, routeList.length ? attacker : 0).moves;
    } else {
      throw new Error("目前盤面沒有可驗證的原始落子 history；為避免 LIB 手順改變，請清空後依原手順重新落子。");
    }
    let setupTail = root;
    for (const move of setupMoves) setupTail = appendChild(setupTail, move);

    if (routeList.length) {
      if (attacker !== BLACK && attacker !== WHITE) throw new Error("RenLib 匯出需要知道 VCF 攻方");
      for (const route of routeList) {
        const occupied = new Uint8Array(rootBoard);
        let side = attacker;
        let parent = setupTail;
        for (const move of route) {
          if (!Number.isInteger(move) || move < 0 || move >= BOARD_CELLS) {
            throw new Error(`VCF 路線含無效落點：${move}`);
          }
          if (occupied[move] !== EMPTY) {
            throw new Error(`VCF 路線落在已有棋子的交點：${move}`);
          }
          occupied[move] = side;
          side = side === BLACK ? WHITE : BLACK;
          parent = appendChild(parent, move);
        }
      }
    }

    return root;
  }

  function renLibMoveByte(move) {
    if (move === PASS) return 0;
    const x = move % BOARD_SIZE;
    const y = Math.floor(move / BOARD_SIZE);
    return ((y & 0x0f) << 4) | ((x + 1) & 0x0f);
  }

  function writeRenLibChildren(writer, children) {
    for (let i = 0; i < children.length; i++) {
      const node = children[i];
      let flags = 0;
      if (!node.children.length) flags |= 0x40; // MASK_NOCHILD
      if (i < children.length - 1) flags |= 0x80; // MASK_SIBLING
      writer.u8(renLibMoveByte(node.move));
      writer.u8(flags);
      if (node.children.length) writeRenLibChildren(writer, node.children);
    }
  }

  function createRenLib({ board, routes = [], attacker = 0, history = [], historyExact = null }) {
    const normalizedBoard = normalizeBoard(board);
    const tree = buildRenLibTree(normalizedBoard, routes, Number(attacker), history, historyExact);
    if (!tree.children.length) throw new Error("空白盤面且沒有 VCF 路線，無法建立有效 RenLib 檔案");
    const writer = new ByteWriter();
    writer.raw([
      0xff, 0x52, 0x65, 0x6e, 0x4c, 0x69, 0x62, 0xff,
      3, 0,
      0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
    ]);
    // Rapfi 會把檔案第一個 PASS 視為舊 RenLib 的 ROOT 節點並略過。
    // 若靜態盤面本身需要以 PASS 起手（例如白子多於黑子），先補一個相容 ROOT，
    // 讓下一個 PASS 仍作為真正的輪次資料被讀取。
    if (tree.children[0]?.move === PASS) {
      writer.u8(0);
      writer.u8(0);
    }
    writeRenLibChildren(writer, tree.children);
    return { bytes: writer.finish() };
  }

  const RapfiFormats = {
    createYXDB,
    createRenLib,
    wrapLZ4Frame,
    xxhash32,
    normalizeBoard,
    countStones,
    normalSideToMove,
    canonicalPosition,
  };
  global.VCFRapfiFormats = RapfiFormats;
  if (typeof module !== "undefined" && module.exports) module.exports = RapfiFormats;

  if (typeof document === "undefined") return;

  function installStyle() {
    let style = document.getElementById("bb-compact-header-style");
    if (!style) {
      style = document.createElement("style");
      style.id = "bb-compact-header-style";
      document.head.appendChild(style);
    }
    style.textContent = `
      #bitboard-architecture-panel:not(.bb-quick-actions){display:none!important}
      #bitboard-architecture-panel.bb-quick-actions{width:min(100%,1120px);display:flex;align-items:center;justify-content:flex-start;gap:8px;flex-wrap:wrap;padding:0;border:0;background:transparent;box-shadow:none}
      #bitboard-architecture-panel.bb-quick-actions .bb-lab-link,
      #bitboard-architecture-panel.bb-quick-actions #bb-hard-refresh,
      #bitboard-architecture-panel.bb-quick-actions #bb-export-file,
      #bitboard-architecture-panel.bb-quick-actions #bb-export-format{min-height:38px;display:inline-flex;align-items:center;justify-content:center;padding:8px 12px;border:1px solid #39744c;border-radius:6px;background:#fff;color:#19512d;font:inherit;font-size:13px;line-height:1.3;text-decoration:none;cursor:pointer}
      #bitboard-architecture-panel.bb-quick-actions #bb-export-format{padding-right:28px}
      #bitboard-architecture-panel.bb-quick-actions #bb-hard-refresh:disabled,
      #bitboard-architecture-panel.bb-quick-actions #bb-export-file:disabled{opacity:.65;cursor:wait}
      #bitboard-architecture-panel.bb-quick-actions #bb-export-status{font-size:12px;color:#58645b}
    `;
  }

  function setRuleLabel(label, text) {
    for (const node of Array.from(label.childNodes)) {
      if (node.nodeType === Node.TEXT_NODE) node.remove();
    }
    label.appendChild(document.createTextNode(` ${text}`));
  }

  function installRuleOptions() {
    const ruleBox = document.getElementById("rule-box");
    if (!ruleBox || ruleBox.dataset.threeRulesReady === "1") return Boolean(ruleBox);

    for (const radio of ruleBox.querySelectorAll('input[name="rules"]')) {
      const label = radio.closest("label");
      const name = ruleNames[Number(radio.value)];
      if (label && name) setRuleLabel(label, name);
    }

    if (!ruleBox.querySelector('input[name="rules"][value="0"]')) {
      const label = document.createElement("label");
      const radio = document.createElement("input");
      radio.type = "radio";
      radio.name = "rules";
      radio.value = "0";
      label.append(radio, document.createTextNode(" 自由"));
      ruleBox.appendChild(label);
    }

    ruleBox.addEventListener("change", async event => {
      const radio = event.target;
      if (!(radio instanceof HTMLInputElement) || radio.name !== "rules" || !radio.checked) return;
      event.stopPropagation();
      const rules = Number(radio.value);
      if (!(rules in ruleNames)) return;
      const previous = Number(ruleBox.dataset.activeRules ?? 2);
      const success = await global.vcfSetRules?.(rules);
      if (success === false) {
        const fallback = ruleBox.querySelector(`input[name="rules"][value="${previous}"]`);
        if (fallback) fallback.checked = true;
      } else {
        ruleBox.dataset.activeRules = String(rules);
      }
    }, true);

    const selected = ruleBox.querySelector('input[name="rules"]:checked');
    ruleBox.dataset.activeRules = selected?.value || "2";
    ruleBox.dataset.threeRulesReady = "1";
    return true;
  }

  function installWorkbenchRecordState() {
    const STORAGE_KEY = "vcf_board_record_tree_v3";
    const LEGACY_STORAGE_KEY = "vcf_board_history_v2";
    const readBoard = () => normalizeBoard(global._getArr?.());
    const oppositeStone = stone => stone === BLACK ? WHITE : BLACK;

    const makeNode = (move = null, stone = 0, recordText = "", parent = null) => ({
      move,
      stone,
      recordText: String(recordText || ""),
      children: [],
      selectedChild: 0,
      parent,
    });
    const hydrateNode = (raw, parent = null) => {
      const node = makeNode(
        Number.isInteger(Number(raw?.move)) ? Number(raw.move) : null,
        Number(raw?.stone) === BLACK || Number(raw?.stone) === WHITE ? Number(raw.stone) : 0,
        typeof raw?.recordText === "string" ? raw.recordText : "",
        parent,
      );
      node.children = Array.isArray(raw?.children) ? raw.children.map(child => hydrateNode(child, node)) : [];
      node.selectedChild = node.children.length
        ? Math.max(0, Math.min(node.children.length - 1, Number(raw?.selectedChild || 0)))
        : 0;
      return node;
    };
    const serializeNode = node => ({
      move: node.move,
      stone: node.stone,
      recordText: node.recordText || "",
      selectedChild: Number(node.selectedChild || 0),
      children: node.children.map(serializeNode),
    });
    const historyForNode = node => {
      const result = [];
      let cursor = node;
      while (cursor?.parent) {
        result.push({ index: cursor.move, stone: cursor.stone, recordText: cursor.recordText || "" });
        cursor = cursor.parent;
      }
      return result.reverse();
    };
    const replay = history => {
      const board = new Uint8Array(BOARD_CELLS);
      let expected = BLACK;
      if (!Array.isArray(history)) return null;
      for (const raw of history) {
        const index = Number(raw?.index ?? raw?.move);
        const stone = Number(raw?.stone ?? raw?.color);
        if (!Number.isInteger(index) || index < 0 || index >= BOARD_CELLS || stone !== expected || board[index]) return null;
        board[index] = stone;
        expected = oppositeStone(expected);
      }
      return board;
    };
    const pathIndices = node => {
      const result = [];
      let cursor = node;
      while (cursor?.parent) {
        const index = cursor.parent.children.indexOf(cursor);
        if (index < 0) return [];
        result.push(index);
        cursor = cursor.parent;
      }
      return result.reverse();
    };
    const nodeAtPath = (root, path) => {
      let node = root;
      for (const rawIndex of Array.isArray(path) ? path : []) {
        const index = Number(rawIndex);
        if (!Number.isInteger(index) || !node.children[index]) return null;
        node = node.children[index];
      }
      return node;
    };
    const buildLinearTree = (history, rootRecordText = "") => {
      const root = makeNode(null, 0, rootRecordText, null);
      let node = root;
      for (const raw of history || []) {
        const child = makeNode(Number(raw.index), Number(raw.stone), raw.recordText || "", node);
        node.children.push(child);
        node.selectedChild = 0;
        node = child;
      }
      return { root, current: node };
    };

    let root = makeNode();
    let current = root;
    let exact = false;
    let lastBoard = readBoard();
    let restored = false;

    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
      if (saved?.tree) {
        const candidateRoot = hydrateNode(saved.tree);
        const candidateCurrent = nodeAtPath(candidateRoot, saved.currentPath) || candidateRoot;
        const candidateBoard = replay(historyForNode(candidateCurrent));
        if (candidateBoard && boardsEqual(candidateBoard, lastBoard)) {
          root = candidateRoot;
          current = candidateCurrent;
          exact = saved.exact !== false;
          restored = true;
        }
      }
    } catch (_) {}

    if (!restored) {
      try {
        const saved = JSON.parse(localStorage.getItem(LEGACY_STORAGE_KEY) || "null");
        const legacyHistory = Array.isArray(saved?.history) ? saved.history.map(item => ({
          index: Number(item.index),
          stone: Number(item.stone),
          recordText: typeof item.recordText === "string" ? item.recordText : "",
        })) : [];
        const legacyBoard = replay(legacyHistory);
        if (legacyBoard && boardsEqual(legacyBoard, lastBoard)) {
          const linear = buildLinearTree(legacyHistory, typeof saved?.rootRecordText === "string" ? saved.rootRecordText : "");
          root = linear.root;
          current = linear.current;
          exact = saved?.exact !== false;
          restored = true;
        }
      } catch (_) {}
    }

    if (!lastBoard.some(Boolean) && !restored) {
      root = makeNode();
      current = root;
      exact = true;
    }

    const currentHistory = () => historyForNode(current);
    const currentRecordText = () => String(current?.recordText || "");
    const selectedNextNode = () => {
      if (!exact || !current?.children?.length) return null;
      current.selectedChild = Math.max(0, Math.min(current.children.length - 1, Number(current.selectedChild || 0)));
      return current.children[current.selectedChild] || null;
    };
    const persist = () => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({
          tree: serializeNode(root),
          currentPath: pathIndices(current),
          exact,
        }));
      } catch (_) {}
    };
    const notify = () => {
      const next = selectedNextNode();
      const siblings = current?.parent?.children || [];
      global.dispatchEvent(new CustomEvent("vcf-record-state-changed", {
        detail: {
          recordText: currentRecordText(),
          exact,
          ply: currentHistory().length,
          canPrev: Boolean(exact && current?.parent),
          canNext: Boolean(next),
          selectedNextMove: next?.move ?? null,
          nextBranchCount: current?.children?.length || 0,
          siblingCount: siblings.length,
          siblingIndex: siblings.indexOf(current),
        },
      }));
    };
    const applyCurrentBoard = () => {
      if (!exact) return false;
      const history = currentHistory();
      const board = replay(history);
      if (!board) return false;
      const sideToMove = history.length % 2 === 0 ? BLACK : WHITE;
      const apply = () => global._setBoardArr?.(Array.from(board), sideToMove);
      if (typeof global.vcfWithBoardChangeSource === "function") {
        global.vcfWithBoardChangeSource("record-navigation", apply);
      } else {
        apply();
      }
      lastBoard = new Uint8Array(board);
      persist();
      notify();
      return true;
    };
    const resetToHistory = (nextHistory, nextExact, nextRootRecordText = "") => {
      const normalized = Array.isArray(nextHistory) ? nextHistory.map(item => ({
        index: Number(item.index ?? item.move),
        stone: Number(item.stone ?? item.color),
        recordText: typeof item.recordText === "string" ? item.recordText : "",
      })) : [];
      const rebuilt = replay(normalized);
      const board = readBoard();
      const valid = Boolean(rebuilt && boardsEqual(rebuilt, board));
      const linear = buildLinearTree(valid ? normalized : [], nextRootRecordText);
      root = linear.root;
      current = linear.current;
      exact = Boolean(nextExact && valid);
      if (!board.some(Boolean)) exact = true;
      lastBoard = new Uint8Array(board);
      persist();
      notify();
    };

    const syncAfterManualEdit = () => {
      const board = readBoard();
      const changed = [];
      for (let i = 0; i < BOARD_CELLS; i++) if (board[i] !== lastBoard[i]) changed.push(i);
      if (changed.length === 1 && exact) {
        const index = changed[0];
        const before = lastBoard[index];
        const after = board[index];
        if (!before && (after === BLACK || after === WHITE)) {
          const expected = currentHistory().length % 2 === 0 ? BLACK : WHITE;
          if (after === expected) {
            let childIndex = current.children.findIndex(child => child.move === index && child.stone === after);
            if (childIndex < 0) {
              const child = makeNode(index, after, "", current);
              current.children.push(child);
              childIndex = current.children.length - 1;
            }
            current.selectedChild = childIndex;
            current = current.children[childIndex];
          } else {
            exact = false;
          }
        } else if (before && !after && current?.parent && current.move === index && current.stone === before) {
          const parentBoard = replay(historyForNode(current.parent));
          if (parentBoard && boardsEqual(parentBoard, board)) current = current.parent;
          else exact = false;
        } else {
          exact = false;
        }
      } else if (changed.length) {
        exact = false;
      }
      lastBoard = board;
      persist();
      notify();
    };

    const boardSvg = document.getElementById("board-svg");
    boardSvg?.addEventListener("click", () => queueMicrotask(syncAfterManualEdit));

    document.getElementById("btn-clear")?.addEventListener("click", () => {
      queueMicrotask(() => {
        root = makeNode();
        current = root;
        exact = true;
        lastBoard = readBoard();
        persist();
        notify();
      });
    });
    document.getElementById("btn-import-apply")?.addEventListener("click", () => {
      queueMicrotask(() => {
        root = makeNode();
        current = root;
        exact = false;
        lastBoard = readBoard();
        persist();
        notify();
      });
    });

    global.VCFWorkbenchRecord = {
      snapshot() {
        return {
          history: currentHistory().map(item => ({ ...item })),
          exact,
          board: Array.from(lastBoard),
          rootRecordText: String(root.recordText || ""),
        };
      },
      currentRecordText,
      setCurrentRecordText(text) {
        current.recordText = String(text || "");
        persist();
        notify();
      },
      setHistory(nextHistory, nextExact = true, nextRootRecordText = root.recordText || "") {
        resetToHistory(nextHistory, nextExact, nextRootRecordText);
      },
      navigateStep(direction) {
        if (!exact) return false;
        if (direction < 0) {
          if (!current.parent) return false;
          current = current.parent;
          return applyCurrentBoard();
        }
        const next = selectedNextNode();
        if (!next) return false;
        current = next;
        return applyCurrentBoard();
      },
      navigateBranch(direction) {
        if (!exact) return false;
        const siblings = current?.parent?.children || [];
        if (siblings.length > 1) {
          const index = siblings.indexOf(current);
          const nextIndex = (index + Number(direction || 1) + siblings.length) % siblings.length;
          current.parent.selectedChild = nextIndex;
          current = siblings[nextIndex];
          return applyCurrentBoard();
        }
        if (current.children.length > 1) {
          const count = current.children.length;
          current.selectedChild = (Number(current.selectedChild || 0) + Number(direction || 1) + count) % count;
          persist();
          notify();
          return true;
        }
        return false;
      },
      invalidate() {
        exact = false;
        lastBoard = readBoard();
        persist();
        notify();
      },
    };
    persist();
    notify();
  }

  installWorkbenchRecordState();

  function activeExportData() {
    const board = normalizeBoard(global._getArr?.());
    let routes = [];
    let attacker = 0;
    if (typeof vcfGroups !== "undefined" && Array.isArray(vcfGroups) && vcfGroups.length) {
      routes = vcfGroups.map(route => Array.from(route));
      attacker = Number(typeof vcfGroupColor !== "undefined" ? vcfGroupColor : 0);
    } else if (typeof lastVCFMoves !== "undefined" && lastVCFMoves && lastVCFMoves.length) {
      routes = [Array.from(lastVCFMoves)];
      attacker = Number(typeof lastVCFColor !== "undefined" ? lastVCFColor : 0);
    }
    const rule = Number(document.querySelector('input[name="rules"]:checked')?.value ?? 2);
    const recordState = global.VCFWorkbenchRecord?.snapshot?.() || { history: [], exact: !board.some(Boolean), rootRecordText: "" };
    return {
      board,
      routes,
      attacker,
      rule,
      history: recordState.history,
      historyExact: recordState.exact,
      rootRecordText: recordState.rootRecordText || "",
    };
  }

  function timestampName() {
    const d = new Date();
    const two = value => String(value).padStart(2, "0");
    return `${d.getFullYear()}${two(d.getMonth() + 1)}${two(d.getDate())}-${two(d.getHours())}${two(d.getMinutes())}${two(d.getSeconds())}`;
  }

  function downloadBytes(bytes, filename) {
    const blob = new Blob([bytes], { type: "application/octet-stream" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  function installHeader() {
    const panel = document.getElementById("bitboard-architecture-panel");
    if (!panel) return false;
    if (panel.dataset.compactHeaderReady === "1") return true;

    panel.className = "bb-quick-actions";
    panel.dataset.compactHeaderReady = "1";
    panel.innerHTML = `
      <a class="bb-lab-link" href="rapfi/lab.html">Rapfi 官方對照／棋型實驗室</a>
      <select id="bb-export-format" aria-label="棋譜匯出格式">
        <option value="yxdb">Rapfi YXDB (.db)</option>
        <option value="lib">RenLib (.lib)</option>
      </select>
      <button id="bb-export-file" type="button">匯出盤面／VCF</button>
      <button id="bb-hard-refresh" type="button">強制重新整理</button>
      <span id="bb-export-status" aria-live="polite"></span>
    `;

    const formatSelect = panel.querySelector("#bb-export-format");
    const exportButton = panel.querySelector("#bb-export-file");
    const exportStatus = panel.querySelector("#bb-export-status");
    exportButton.addEventListener("click", () => {
      exportButton.disabled = true;
      exportStatus.textContent = "正在建立檔案……";
      try {
        const data = activeExportData();
        const stamp = timestampName();
        if (formatSelect.value === "lib") {
          const result = createRenLib(data);
          downloadBytes(result.bytes, `vcf-${stamp}.lib`);
          exportStatus.textContent = `已匯出 RenLib（${result.bytes.length.toLocaleString()} bytes）`;
        } else {
          const result = createYXDB(data);
          downloadBytes(result.bytes, `vcf-${stamp}.db`);
          exportStatus.textContent = `已匯出 YXDB（${result.recordCount} 個盤面，標準 LZ4 frame）`;
        }
      } catch (error) {
        console.error("Rapfi 格式匯出失敗", error);
        exportStatus.textContent = error?.message || String(error);
      } finally {
        exportButton.disabled = false;
      }
    });

    const refreshButton = panel.querySelector("#bb-hard-refresh");
    refreshButton.addEventListener("click", async () => {
      refreshButton.disabled = true;
      refreshButton.textContent = "強制更新中……";
      try {
        if ("caches" in global) {
          const cacheNames = await caches.keys();
          await Promise.all(cacheNames.map(name => caches.delete(name)));
        }
        const urls = new Set();
        for (const entry of performance.getEntriesByType("resource")) {
          try {
            const url = new URL(entry.name, location.href);
            if (url.origin === location.origin) urls.add(url.href);
          } catch (_) {}
        }
        document.querySelectorAll("script[src], link[rel='stylesheet'][href]").forEach(element => {
          try {
            const url = new URL(element.src || element.href, location.href);
            if (url.origin === location.origin) urls.add(url.href);
          } catch (_) {}
        });
        await Promise.allSettled(Array.from(urls, url => fetch(url, {
          cache: "reload",
          credentials: "same-origin",
        })));
      } catch (error) {
        console.warn("強制重新整理前的快取更新失敗，仍繼續重新載入。", error);
      }
      const url = new URL(location.href);
      url.searchParams.set("_refresh", String(Date.now()));
      location.replace(url.href);
    });
    return true;
  }

  installStyle();
  installRuleOptions();
  installHeader();
})(typeof window !== "undefined" ? window : globalThis);