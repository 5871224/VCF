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

  function inverseTransform(transform) {
    switch (Number(transform)) {
      case 1: return 3;
      case 3: return 1;
      case 0:
      case 2:
      case 4:
      case 5:
      case 6:
      case 7:
      default: return Number(transform) || 0;
    }
  }

  function transformRapfiRecordText(value, transform) {
    const raw = String(value || "").replace(/\0+$/g, "");
    if (!raw.startsWith("@BTXT@")) return raw;
    const separator = raw.indexOf("\b");
    const markerPart = raw.slice(6, separator >= 0 ? separator : raw.length);
    const suffix = separator >= 0 ? raw.slice(separator) : "";
    const decode = char => {
      if (/^[0-9]$/.test(char)) return char.charCodeAt(0) - 48;
      if (/^[A-F]$/i.test(char)) return char.toUpperCase().charCodeAt(0) - 55;
      return -1;
    };
    const encode = number => Number(number).toString(16).toUpperCase();
    const lines = markerPart.split("\n").map(line => {
      if (line.length <= 2) return line;
      const x = decode(line[0]);
      const y = decode(line[1]);
      if (x < 0 || x >= BOARD_SIZE || y < 0 || y >= BOARD_SIZE) return line;
      const [tx, ty] = transformXY(x, y, transform);
      return `${encode(tx)}${encode(ty)}${line.slice(2)}`;
    });
    return `@BTXT@${lines.join("\n")}${suffix}`;
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

  function canonicalPositionInfo(board) {
    let best = null;
    for (let transform = 0; transform < 8; transform++) {
      const black = positionListForTransform(board, BLACK, transform);
      const white = positionListForTransform(board, WHITE, transform);
      const candidate = { black, white, transform };
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

  function canonicalPosition(board) {
    const { black, white } = canonicalPositionInfo(board);
    return { black, white };
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
      if (!Number.isInteger(index) || (index !== PASS && (index < 0 || index >= BOARD_CELLS))) return null;
      if (stone !== expectedStone) return null;
      if (index !== PASS) {
        if (replay[index] !== EMPTY) return null;
        replay[index] = stone;
      }
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
      const canonical = canonicalPositionInfo(board);
      const key = [rule, BOARD_SIZE, BOARD_SIZE];
      for (const [x, y] of canonical.black) key.push(x, y);
      for (const [x, y] of canonical.white) key.push(x, y);
      const id = keyString(key);
      const canonicalText = transformRapfiRecordText(text, canonical.transform);
      const existing = records.get(id);
      if (existing) {
        if (!existing.text && canonicalText) existing.text = canonicalText;
      } else {
        records.set(id, { key, text: String(canonicalText || "") });
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
    if (Array.isArray(history) && history.some(raw => Number(raw?.index ?? raw?.move) === PASS)) {
      throw new Error("YXDB 無法表示 PASS 後改變輪次但盤面不變的手順；含 PASS 的棋譜請改用 RenLib (.lib)。");
    }
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
      #vcf-workspace-mode{display:grid;gap:8px;margin:0 0 10px;padding:10px;border:1px solid #d5c496;border-radius:10px;background:#fff9e8}
      #vcf-workspace-mode .vcf-workspace-mode-row{display:flex;align-items:center;gap:7px;flex-wrap:wrap}
      #vcf-workspace-mode .vcf-workspace-mode-title{font-weight:800;color:#4d432c}
      #vcf-workspace-mode .vcf-workspace-mode-badge{padding:4px 8px;border-radius:999px;background:#ede4ca;color:#5d5135;font-size:12px;font-weight:700}
      #vcf-workspace-mode button,#vcf-workspace-mode select{min-height:34px;padding:6px 10px;border:1px solid #bbaa7d;border-radius:7px;background:#fff;font:inherit;font-size:13px}
      #vcf-workspace-mode button.is-active{border-color:#477aa8;background:#d9e9f7;color:#214d72;font-weight:800}
      #vcf-workspace-mode .vcf-puzzle-controls[hidden]{display:none!important}
      #vcf-workspace-mode .vcf-workspace-format{margin-left:auto;color:#6c624c;font-size:12px}
      @media(max-width:600px){#vcf-workspace-mode .vcf-workspace-format{width:100%;margin-left:0}}
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
        global.dispatchEvent(new CustomEvent("vcf-rules-changed", { detail: { rules } }));
      }
    }, true);

    const selected = ruleBox.querySelector('input[name="rules"]:checked');
    ruleBox.dataset.activeRules = selected?.value || "2";
    ruleBox.dataset.threeRulesReady = "1";
    return true;
  }

  function installWorkbenchRecordState() {
    const STORAGE_KEY = "vcf_rapfi_workbench_v1";
    const PUZZLE_FORMAT = "vcf-puzzle-v1";
    const WORKSPACE_RECORD = "record";
    const WORKSPACE_PUZZLE = "puzzle";
    const PUZZLE_SETUP = "setup";
    const PUZZLE_TREE = "tree";
    const MAX_PUZZLE_NODES = 10000;
    const activeRule = () => Number(document.querySelector('input[name="rules"]:checked')?.value ?? 2);
    const normalizeRule = rule => [0, 1, 2].includes(Number(rule)) ? Number(rule) : 2;
    const ruleBox = document.getElementById("rule-box");

    let rapfiDbActive = false;
    let exact = false;
    let currentRule = normalizeRule(activeRule());
    let persistedDbBase64 = "";
    let restoringRule = false;
    let basePly = 0;
    let lastBoard = new Uint8Array(BOARD_CELLS);
    let workspaceMode = null;
    let puzzlePhase = PUZZLE_SETUP;
    let puzzleAttacker = BLACK;
    let puzzleSetupTool = BLACK;
    let puzzleRootBoard = new Uint8Array(BOARD_CELLS);
    let suspendPersistence = false;
    const selectedNextByRoute = new Map();

    const bytesToBase64 = bytes => {
      const value = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || 0);
      let binary = "";
      for (let offset = 0; offset < value.length; offset += 0x8000) {
        binary += String.fromCharCode(...value.subarray(offset, Math.min(value.length, offset + 0x8000)));
      }
      return btoa(binary);
    };
    const base64ToBytes = value => {
      const binary = atob(String(value || ""));
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i) & 0xff;
      return bytes;
    };
    const db = () => global.VCFRapfiDB;
    const boardText = value => Array.from(value || [], stone => Number(stone) === BLACK ? "1" : Number(stone) === WHITE ? "2" : "0").join("");
    const parseBoardText = value => {
      if (typeof value !== "string" || !/^[012]{225}$/.test(value)) return null;
      return Uint8Array.from(value, Number);
    };
    const emitWorkspaceChanged = () => {
      global.dispatchEvent(new CustomEvent("vcf-workspace-mode-changed", {
        detail: {
          mode: workspaceMode,
          puzzlePhase,
          attacker: puzzleAttacker,
          setupTool: puzzleSetupTool,
        },
      }));
    };
    const routeKey = () => {
      const service = db();
      return rapfiDbActive && service?.isReady
        ? String(currentRule) + ":" + service.history().join(",")
        : String(currentRule) + ":";
    };
    const oppositeStone = stone => stone === BLACK ? WHITE : BLACK;
    const replayBoard = history => {
      const board = new Uint8Array(BOARD_CELLS);
      let stone = BLACK;
      for (const raw of history || []) {
        const index = Number(raw?.index ?? raw?.move ?? raw);
        if (!Number.isInteger(index) || (index !== PASS && (index < 0 || index >= BOARD_CELLS))) return null;
        if (index !== PASS) {
          if (board[index] !== EMPTY) return null;
          board[index] = stone;
        }
        stone = oppositeStone(stone);
      }
      return board;
    };
    const setupMovesForBoard = (value, desiredSide = 0) => {
      const board = normalizeBoard(value);
      const black = [];
      const white = [];
      for (let index = 0; index < BOARD_CELLS; index++) {
        if (board[index] === BLACK) black.push(index);
        else if (board[index] === WHITE) white.push(index);
      }
      const moves = [];
      let blackIndex = 0;
      let whiteIndex = 0;
      let side = BLACK;
      while (blackIndex < black.length || whiteIndex < white.length) {
        if (side === BLACK && blackIndex < black.length) moves.push(black[blackIndex++]);
        else if (side === WHITE && whiteIndex < white.length) moves.push(white[whiteIndex++]);
        else moves.push(PASS);
        side = oppositeStone(side);
      }
      const targetSide = desiredSide === WHITE || desiredSide === BLACK
        ? desiredSide
        : (normalSideToMove(board) || side);
      if (side !== targetSide) moves.push(PASS);
      return moves;
    };
    const setMainBoard = (board, sideToMove) => {
      const render = global._renderBoardArr || global._setBoardArr;
      render?.(Array.from(board), sideToMove);
    };
    const emitBoardChanged = source => {
      global.vcfNotifyBoardChanged?.(source || "record", {
        attacker: rapfiDbActive && db()?.isReady ? db().sideToMove() : undefined,
      });
    };
    const positionKey = service => `${service.sideToMove()}:${boardText(service.board())}`;
    const serializePuzzle = () => {
      const service = db();
      if (workspaceMode !== WORKSPACE_PUZZLE || puzzlePhase !== PUZZLE_TREE || !rapfiDbActive || !service?.isReady) return null;
      const originalHistory = service.history();
      if (!restoreDbHistory(originalHistory.slice(0, basePly))) return null;
      const nodes = Object.create(null);
      let nodeCount = 0;
      const visit = () => {
        const key = positionKey(service);
        if (nodes[key]) return key;
        if (nodeCount >= MAX_PUZZLE_NODES) throw new Error(`題目分支超過 ${MAX_PUZZLE_NODES.toLocaleString()} 個盤面`);
        const node = { text: String(service.getDisplayText() || ""), children: [] };
        nodes[key] = node;
        nodeCount++;
        const children = service.children().map(Number).filter(Number.isInteger).sort((a, b) => a - b);
        for (const move of children) {
          if (!service.play(move, false)) continue;
          const childKey = visit();
          service.undo();
          node.children.push({ move, to: childKey });
        }
        return key;
      };
      try {
        const root = visit();
        return {
          format: PUZZLE_FORMAT,
          rule: currentRule,
          attacker: puzzleAttacker,
          board: boardText(puzzleRootBoard),
          root,
          currentRoute: originalHistory.slice(basePly),
          nodes,
        };
      } finally {
        restoreDbHistory(originalHistory);
      }
    };
    const saveState = (databaseChanged = false) => {
      const service = db();
      if (suspendPersistence || !workspaceMode || !rapfiDbActive || !service?.isReady) return false;
      try {
        if (workspaceMode === WORKSPACE_PUZZLE) {
          if (puzzlePhase === PUZZLE_SETUP) {
            localStorage.setItem(STORAGE_KEY, JSON.stringify({
              version: 2,
              mode: WORKSPACE_PUZZLE,
              phase: PUZZLE_SETUP,
              rule: currentRule,
              attacker: puzzleAttacker,
              board: boardText(puzzleRootBoard),
            }));
            try { localStorage.removeItem("vcf_board"); } catch (_) {}
            return true;
          }
          const puzzle = serializePuzzle();
          if (!puzzle) return false;
          localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 2, mode: WORKSPACE_PUZZLE, puzzle }));
          try { localStorage.removeItem("vcf_board"); } catch (_) {}
          return true;
        }
        if (databaseChanged || !persistedDbBase64) {
          const snapshot = service.snapshotYXDB();
          if (!snapshot.length) return false;
          persistedDbBase64 = bytesToBase64(snapshot);
        }
        localStorage.setItem(STORAGE_KEY, JSON.stringify({
          version: 2,
          mode: workspaceMode,
          rule: currentRule,
          db: persistedDbBase64,
          history: service.history(),
          basePly,
          exact: true,
        }));
        try { localStorage.removeItem("vcf_board"); } catch (_) {}
        return true;
      } catch (error) {
        console.warn("保存 Rapfi 工作台狀態失敗", error);
        return false;
      }
    };
    const queryChildren = () => {
      const service = db();
      if (!rapfiDbActive || !exact || !service?.isReady) return [];
      try { return service.children().map(Number).filter(Number.isInteger).sort((a, b) => a - b); }
      catch (error) { console.warn("Rapfi queryChildren 失敗", error); return []; }
    };
    const selectedNextMove = knownMoves => {
      const moves = Array.isArray(knownMoves) ? knownMoves : queryChildren();
      if (!moves.length) return null;
      const selected = selectedNextByRoute.get(routeKey());
      return moves.includes(selected) ? selected : moves[0];
    };
    const rememberSelectedNext = move => {
      if (Number.isInteger(Number(move))) selectedNextByRoute.set(routeKey(), Number(move));
    };
    const currentRecordText = () => {
      const service = db();
      if (!rapfiDbActive || !exact || !service?.isReady) return "";
      try { return String(service.getDisplayText() || ""); } catch (_) { return ""; }
    };
    const notify = () => {
      const service = db();
      const nextMoves = queryChildren();
      const nextMove = selectedNextMove(nextMoves);
      const absolutePly = rapfiDbActive && service?.isReady ? service.ply() : 0;
      const ply = Math.max(0, absolutePly - basePly);
      global.dispatchEvent(new CustomEvent("vcf-record-state-changed", {
        detail: {
          recordText: currentRecordText(),
          exact: Boolean(rapfiDbActive && exact),
          ply,
          canPrev: Boolean(rapfiDbActive && exact && absolutePly > basePly),
          canNext: Boolean(rapfiDbActive && exact && nextMove != null),
          selectedNextMove: nextMove,
          nextMoves,
          nextBranchCount: nextMoves.length,
          siblingCount: 0,
          siblingIndex: -1,
          workspaceMode,
          puzzlePhase,
          puzzleAttacker,
          positionBackend: rapfiDbActive ? "rapfi-db" : "initializing",
        },
      }));
    };
    const applyCurrentBoard = (databaseChanged = false, source = "record-navigation", persist = true) => {
      const service = db();
      if (!rapfiDbActive || !exact || !service?.isReady) return false;
      const board = new Uint8Array(service.board());
      lastBoard = board;
      setMainBoard(board, service.sideToMove());
      if (persist) saveState(databaseChanged);
      notify();
      emitBoardChanged(source);
      return true;
    };
    const restoreDbHistory = moves => {
      const service = db();
      if (!service?.isReady) return false;
      service.resetBoard(currentRule);
      for (const raw of moves || []) {
        if (!service.replayMove(Number(raw?.index ?? raw?.move ?? raw), false)) return false;
      }
      return true;
    };
    const normalizePuzzlePayload = value => {
      const payload = value && typeof value === "object" ? value : null;
      if (!payload || payload.format !== PUZZLE_FORMAT) throw new Error("不是 VCF 題目容器");
      const board = parseBoardText(payload.board);
      const attacker = Number(payload.attacker);
      const rule = Number(payload.rule);
      if (!board) throw new Error("題目初始盤面格式錯誤");
      if (!board.some(stone => stone !== EMPTY)) throw new Error("題目初始盤面不得為空");
      if (attacker !== BLACK && attacker !== WHITE) throw new Error("題目攻方格式錯誤");
      if (![0, 1, 2].includes(rule)) throw new Error("題目規則格式錯誤");
      if (!payload.nodes || typeof payload.nodes !== "object" || Array.isArray(payload.nodes)) throw new Error("題目分支格式錯誤");
      const entries = Object.entries(payload.nodes);
      if (!entries.length || entries.length > MAX_PUZZLE_NODES) throw new Error("題目分支數量不合法");
      const keyPattern = /^[12]:[012]{225}$/;
      const nodes = new Map();
      for (const [key, rawNode] of entries) {
        if (!keyPattern.test(key) || !rawNode || typeof rawNode !== "object") throw new Error("題目盤面節點格式錯誤");
        if (typeof rawNode.text !== "string" || !Array.isArray(rawNode.children)) throw new Error("題目盤面節點格式錯誤");
        const text = rawNode.text;
        if (text.length > 100000) throw new Error("題目注釋過長");
        if (rawNode.children.length > BOARD_CELLS + 1) throw new Error("單一題目盤面的分支數量不合法");
        const childMoves = new Set();
        const children = rawNode.children.map(child => {
          const move = Number(child?.move);
          const to = String(child?.to || "");
          if (!Number.isInteger(move) || (move !== PASS && (move < 0 || move >= BOARD_CELLS)) || !keyPattern.test(to)) {
            throw new Error("題目分支落點格式錯誤");
          }
          if (childMoves.has(move)) throw new Error("題目盤面含重複分支落點");
          childMoves.add(move);
          return { move, to };
        });
        nodes.set(key, { text, children });
      }
      const root = String(payload.root || "");
      if (root !== `${attacker}:${boardText(board)}` || !nodes.has(root)) throw new Error("題目根盤面與攻方不一致");
      for (const [key, node] of nodes) {
        const side = Number(key[0]);
        const sourceBoard = parseBoardText(key.slice(2));
        for (const child of node.children) {
          if (!nodes.has(child.to)) throw new Error("題目分支指向不存在的盤面");
          const nextBoard = new Uint8Array(sourceBoard);
          if (child.move !== PASS) {
            if (nextBoard[child.move] !== EMPTY) throw new Error("題目分支落在已佔用交點");
            nextBoard[child.move] = side;
          }
          if (child.to !== `${oppositeStone(side)}:${boardText(nextBoard)}`) throw new Error("題目分支盤面與落點不一致");
        }
      }
      const currentRoute = Array.isArray(payload.currentRoute) ? payload.currentRoute.map(Number) : [];
      if (currentRoute.length > MAX_PUZZLE_NODES) throw new Error("題目目前路線過長");
      if (currentRoute.some(move => !Number.isInteger(move) || (move !== PASS && (move < 0 || move >= BOARD_CELLS)))) {
        throw new Error("題目目前路線格式錯誤");
      }
      const reachable = new Set();
      const visit = key => {
        if (reachable.has(key)) return;
        reachable.add(key);
        for (const child of nodes.get(key).children) visit(child.to);
      };
      visit(root);
      if (reachable.size !== nodes.size) throw new Error("題目含有未連到根盤面的節點");
      let routeKey = root;
      for (const move of currentRoute) {
        const child = nodes.get(routeKey).children.find(item => item.move === move);
        if (!child) throw new Error("題目目前路線不屬於解答分支");
        routeKey = child.to;
      }
      return { board, attacker, rule, root, nodes, currentRoute };
    };
    const importPuzzleInternal = async value => {
      const service = db();
      if (!service?.isReady) return false;
      const puzzle = normalizePuzzlePayload(value);
      restoringRule = true;
      suspendPersistence = true;
      try {
        const radio = ruleBox?.querySelector('input[name="rules"][value="' + puzzle.rule + '"]');
        if (radio) radio.checked = true;
        if (ruleBox) ruleBox.dataset.activeRules = String(puzzle.rule);
        await global.vcfSetRules?.(puzzle.rule);
        currentRule = puzzle.rule;
        workspaceMode = WORKSPACE_PUZZLE;
        puzzlePhase = PUZZLE_TREE;
        puzzleAttacker = puzzle.attacker;
        puzzleRootBoard = new Uint8Array(puzzle.board);
        const setup = setupMovesForBoard(puzzle.board, puzzle.attacker);
        service.clear(currentRule);
        for (const move of setup) if (!service.replayMove(move, false)) throw new Error("題目初始盤面無法建立");
        basePly = service.ply();
        const hydrated = new Set();
        const hydrate = key => {
          if (positionKey(service) !== key) throw new Error("題目分支盤面與落點不一致");
          const node = puzzle.nodes.get(key);
          if (!node) throw new Error("題目分支缺少盤面節點");
          service.ensureCurrent();
          if (node.text && !service.setDisplayText(node.text)) throw new Error("題目注釋無法載入");
          if (hydrated.has(key)) return;
          hydrated.add(key);
          for (const child of node.children) {
            if (!service.play(child.move, true)) throw new Error("題目分支落點無法載入");
            hydrate(child.to);
            if (!service.undo()) throw new Error("題目分支無法返回父盤面");
          }
        };
        hydrate(puzzle.root);
        if (!restoreDbHistory(setup.concat(puzzle.currentRoute))) throw new Error("題目目前路線無法載入");
        rapfiDbActive = true;
        exact = true;
        selectedNextByRoute.clear();
        persistedDbBase64 = "";
        service.ensureCurrent();
      } finally {
        restoringRule = false;
        suspendPersistence = false;
      }
      emitWorkspaceChanged();
      return applyCurrentBoard(true, "puzzle-import");
    };
    const captureHistoryWithTexts = () => {
      const service = db();
      if (!rapfiDbActive || !service?.isReady) return { history: [], rootRecordText: "" };
      const moves = service.history();
      const result = [];
      let rootRecordText = "";
      try {
        service.resetBoard(currentRule);
        rootRecordText = String(service.getDisplayText() || "");
        for (let i = 0; i < moves.length; i++) {
          if (!service.replayMove(moves[i], false)) throw new Error("Rapfi history replay failed");
          result.push({ index: moves[i], stone: i % 2 === 0 ? BLACK : WHITE, recordText: String(service.getDisplayText() || "") });
        }
      } finally { restoreDbHistory(moves); }
      return { history: result, rootRecordText };
    };
    const replacePositionInternal = (boardValue, options = {}) => {
      const service = db();
      if (!rapfiDbActive || !service?.isReady) return false;
      const board = normalizeBoard(boardValue || []);
      const setup = setupMovesForBoard(board, Number(options.sideToMove));
      service.clear(currentRule);
      for (const move of setup) if (!service.replayMove(move, false)) return false;
      service.ensureCurrent();
      basePly = service.ply();
      workspaceMode = WORKSPACE_PUZZLE;
      puzzlePhase = options.phase === PUZZLE_SETUP ? PUZZLE_SETUP : PUZZLE_TREE;
      puzzleAttacker = service.sideToMove();
      puzzleRootBoard = new Uint8Array(board);
      exact = true;
      selectedNextByRoute.clear();
      persistedDbBase64 = "";
      emitWorkspaceChanged();
      return applyCurrentBoard(true, options.source || "replace-position");
    };
    const replaceHistoryInternal = (nextHistory, options = {}) => {
      const service = db();
      if (!rapfiDbActive || !service?.isReady) return false;
      const normalized = Array.isArray(nextHistory) ? nextHistory.map((item, index) => ({
        index: Number(item?.index ?? item?.move ?? item),
        stone: Number(item?.stone ?? item?.color ?? (index % 2 === 0 ? BLACK : WHITE)),
        recordText: typeof item?.recordText === "string" ? item.recordText : "",
      })) : [];
      if (!replayBoard(normalized)) return false;
      for (let i = 0; i < normalized.length; i++) if (normalized[i].stone !== (i % 2 === 0 ? BLACK : WHITE)) return false;
      service.clear(currentRule);
      service.ensureCurrent();
      if (options.rootRecordText) service.setDisplayText(String(options.rootRecordText));
      for (const item of normalized) {
        if (!service.replayMove(item.index, true)) return false;
        if (item.recordText) service.setDisplayText(item.recordText);
      }
      basePly = Math.max(0, Math.min(service.ply(), Number(options.basePly || 0)));
      workspaceMode = WORKSPACE_RECORD;
      puzzlePhase = PUZZLE_SETUP;
      puzzleRootBoard = new Uint8Array(BOARD_CELLS);
      exact = true;
      selectedNextByRoute.clear();
      persistedDbBase64 = "";
      service.ensureCurrent();
      emitWorkspaceChanged();
      return applyCurrentBoard(true, options.source || "replace-history");
    };
    const resetToEmptyBoard = () => {
      currentRule = normalizeRule(activeRule());
      const service = db();
      service.clear(currentRule);
      service.ensureCurrent();
      rapfiDbActive = true;
      exact = true;
      basePly = 0;
      workspaceMode = null;
      puzzlePhase = PUZZLE_SETUP;
      puzzleRootBoard = new Uint8Array(BOARD_CELLS);
      selectedNextByRoute.clear();
      persistedDbBase64 = "";
      return applyCurrentBoard(false, "init", false);
    };
    const restoreSavedState = async () => {
      const service = db();
      if (!service?.isReady) return false;
      let saved = null;
      try { saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null"); }
      catch (error) {
        console.warn("Rapfi 工作台狀態格式損壞，已改用空白棋盤", error);
        try { localStorage.removeItem(STORAGE_KEY); } catch (_) {}
      }
      if (saved?.version === 2 && saved.mode === WORKSPACE_PUZZLE && saved.phase === PUZZLE_SETUP) {
        try {
          const board = parseBoardText(saved.board);
          const attacker = Number(saved.attacker);
          const savedRule = Number(saved.rule);
          if (!board || (attacker !== BLACK && attacker !== WHITE) || ![0, 1, 2].includes(savedRule)) {
            throw new Error("題目擺盤草稿格式錯誤");
          }
          restoringRule = true;
          const radio = ruleBox?.querySelector('input[name="rules"][value="' + savedRule + '"]');
          if (radio) radio.checked = true;
          if (ruleBox) ruleBox.dataset.activeRules = String(savedRule);
          await global.vcfSetRules?.(savedRule);
          currentRule = savedRule;
          workspaceMode = WORKSPACE_PUZZLE;
          puzzlePhase = PUZZLE_SETUP;
          puzzleAttacker = attacker;
          puzzleRootBoard = new Uint8Array(board);
          const setup = setupMovesForBoard(board, attacker);
          service.clear(currentRule);
          for (const move of setup) if (!service.replayMove(move, false)) throw new Error("題目擺盤草稿無法建立");
          basePly = service.ply();
          rapfiDbActive = true;
          exact = true;
          selectedNextByRoute.clear();
          persistedDbBase64 = "";
          service.ensureCurrent();
          emitWorkspaceChanged();
          return applyCurrentBoard(false, "restore-puzzle-setup", false);
        } catch (error) {
          console.warn("VCF 題目擺盤草稿損壞，已改用空白工作區", error);
          try { localStorage.removeItem(STORAGE_KEY); } catch (_) {}
        } finally {
          restoringRule = false;
        }
      }
      if (saved?.version === 2 && saved.mode === WORKSPACE_PUZZLE && saved.puzzle) {
        try { return await importPuzzleInternal(saved.puzzle); }
        catch (error) {
          console.warn("VCF 題目工作區損壞，已改用空白工作區", error);
          try { localStorage.removeItem(STORAGE_KEY); } catch (_) {}
        }
      }
      if ((saved?.version === 1 || saved?.version === 2) && typeof saved.db === "string" && saved.db.length) {
        try {
          const savedRule = normalizeRule(saved.rule);
          if (savedRule !== activeRule()) {
            restoringRule = true;
            const radio = ruleBox?.querySelector('input[name="rules"][value="' + savedRule + '"]');
            if (radio) radio.checked = true;
            if (ruleBox) ruleBox.dataset.activeRules = String(savedRule);
            Promise.resolve(global.vcfSetRules?.(savedRule)).catch(error => console.warn("同步計算引擎規則失敗", error)).finally(() => { restoringRule = false; });
          }
          currentRule = savedRule;
          if (service.restoreYXDB(base64ToBytes(saved.db), currentRule)) {
            persistedDbBase64 = saved.db;
            service.resetBoard(currentRule);
            let historyOk = true;
            for (const move of Array.isArray(saved.history) ? saved.history : []) {
              if (!service.replayMove(Number(move), false)) { historyOk = false; break; }
            }
            if (historyOk) {
              basePly = Math.max(0, Math.min(service.ply(), Number(saved.basePly || 0)));
              workspaceMode = saved.mode === WORKSPACE_RECORD || saved.mode === WORKSPACE_PUZZLE
                ? saved.mode
                : (basePly > 0 ? WORKSPACE_PUZZLE : WORKSPACE_RECORD);
              puzzlePhase = workspaceMode === WORKSPACE_PUZZLE ? PUZZLE_TREE : PUZZLE_SETUP;
              if (workspaceMode === WORKSPACE_PUZZLE) {
                const fullHistory = service.history();
                if (!restoreDbHistory(fullHistory.slice(0, basePly))) throw new Error("舊題目根盤面無法還原");
                puzzleRootBoard = new Uint8Array(service.board());
                puzzleAttacker = service.sideToMove();
                if (!restoreDbHistory(fullHistory)) throw new Error("舊題目目前路線無法還原");
              }
              rapfiDbActive = true;
              exact = true;
              service.ensureCurrent();
              emitWorkspaceChanged();
              return applyCurrentBoard(false, "restore");
            }
            console.warn("Rapfi 工作台手順損壞，已保留棋譜資料並回到起始點");
            service.resetBoard(currentRule);
            service.ensureCurrent();
            basePly = 0;
            rapfiDbActive = true;
            exact = true;
            workspaceMode = WORKSPACE_RECORD;
            selectedNextByRoute.clear();
            emitWorkspaceChanged();
            return applyCurrentBoard(false, "restore-recovered");
          }
          throw new Error("Rapfi YXDB snapshot 無法讀取");
        } catch (error) {
          console.warn("Rapfi 工作台快照損壞，已改用空白棋盤", error);
          try { localStorage.removeItem(STORAGE_KEY); } catch (_) {}
        }
      }
      return resetToEmptyBoard();
    };
    let activationPromise = null;
    const activateRapfiDatabase = () => {
      if (rapfiDbActive) return Promise.resolve(true);
      if (!global.VCFRapfiDB?.isReady) return Promise.resolve(false);
      if (activationPromise) return activationPromise;
      activationPromise = restoreSavedState().then(ok => {
        if (!ok) throw new Error("Rapfi 棋盤狀態無法啟用");
        global.dispatchEvent(new CustomEvent("vcf-rapfi-db-active"));
        return true;
      }).finally(() => { activationPromise = null; });
      return activationPromise;
    };
    global.addEventListener("vcf-rapfi-db-ready", () => {
      queueMicrotask(() => activateRapfiDatabase().catch(error => console.error("Rapfi DB 啟用失敗", error)));
    });
    if (global.VCFRapfiDB?.isReady) {
      queueMicrotask(() => activateRapfiDatabase().catch(error => console.error("Rapfi DB 啟用失敗", error)));
    } else {
      global.VCFRapfiDB?.ready?.then(() => activateRapfiDatabase()).catch(error => console.error("Rapfi DB bridge 初始化失敗", error));
    }

    const transformMove = (move, transform) => {
      if (!Number.isInteger(Number(move)) || Number(move) === PASS) return Number(move);
      const index = Number(move);
      const xy = transformXY(index % BOARD_SIZE, Math.floor(index / BOARD_SIZE), transform);
      return xy[1] * BOARD_SIZE + xy[0];
    };

    global.VCFWorkbenchRecord = {
      snapshot() {
        const captured = rapfiDbActive && exact ? captureHistoryWithTexts() : { history: [], rootRecordText: "" };
        return {
          history: captured.history,
          exact: Boolean(rapfiDbActive && exact),
          board: this.currentBoard(),
          rootRecordText: captured.rootRecordText,
          basePly,
          workspaceMode,
          puzzlePhase,
          puzzleAttacker,
        };
      },
      workspace() {
        return { mode: workspaceMode, puzzlePhase, attacker: puzzleAttacker, setupTool: puzzleSetupTool };
      },
      startWorkspace(mode) {
        const service = db();
        if (!rapfiDbActive || !service?.isReady || (mode !== WORKSPACE_RECORD && mode !== WORKSPACE_PUZZLE)) return false;
        service.clear(currentRule);
        service.ensureCurrent();
        workspaceMode = mode;
        puzzlePhase = PUZZLE_SETUP;
        puzzleAttacker = BLACK;
        puzzleSetupTool = BLACK;
        puzzleRootBoard = new Uint8Array(BOARD_CELLS);
        basePly = 0;
        exact = true;
        selectedNextByRoute.clear();
        persistedDbBase64 = "";
        emitWorkspaceChanged();
        return applyCurrentBoard(true, mode === WORKSPACE_RECORD ? "new-record" : "new-puzzle");
      },
      setPuzzleSetupTool(stone) {
        const normalized = Number(stone);
        if (normalized !== EMPTY && normalized !== BLACK && normalized !== WHITE) return false;
        puzzleSetupTool = normalized;
        emitWorkspaceChanged();
        return true;
      },
      setPuzzleAttacker(attacker) {
        const normalized = Number(attacker);
        if (workspaceMode !== WORKSPACE_PUZZLE || puzzlePhase !== PUZZLE_SETUP || (normalized !== BLACK && normalized !== WHITE)) return false;
        return replacePositionInternal(this.currentBoard(), {
          sideToMove: normalized,
          source: "puzzle-attacker",
          phase: PUZZLE_SETUP,
        });
      },
      placePuzzleSetupStone(index, stone = puzzleSetupTool) {
        const move = Number(index);
        const normalized = Number(stone);
        if (workspaceMode !== WORKSPACE_PUZZLE || puzzlePhase !== PUZZLE_SETUP
          || !Number.isInteger(move) || move < 0 || move >= BOARD_CELLS
          || (normalized !== EMPTY && normalized !== BLACK && normalized !== WHITE)) return false;
        const board = this.currentBoard();
        board[move] = normalized;
        return replacePositionInternal(board, {
          sideToMove: puzzleAttacker,
          source: "puzzle-setup",
          phase: PUZZLE_SETUP,
        });
      },
      commitPuzzleSetup() {
        if (workspaceMode !== WORKSPACE_PUZZLE || puzzlePhase !== PUZZLE_SETUP
          || !this.currentBoard().some(stone => Number(stone) !== EMPTY)) return false;
        puzzleRootBoard = Uint8Array.from(this.currentBoard());
        puzzlePhase = PUZZLE_TREE;
        emitWorkspaceChanged();
        saveState(true);
        notify();
        return true;
      },
      editPuzzleSetup() {
        if (workspaceMode !== WORKSPACE_PUZZLE || puzzlePhase !== PUZZLE_TREE) return false;
        return replacePositionInternal(puzzleRootBoard, {
          sideToMove: puzzleAttacker,
          source: "puzzle-setup-edit",
          phase: PUZZLE_SETUP,
        });
      },
      currentBoard() {
        const service = db();
        return rapfiDbActive && service?.isReady ? Array.from(service.board()) : Array.from(lastBoard);
      },
      currentSideToMove() {
        const service = db();
        return rapfiDbActive && service?.isReady ? service.sideToMove() : BLACK;
      },
      currentRecordText,
      setCurrentRecordText(text) {
        const service = db();
        if (!workspaceMode || (workspaceMode === WORKSPACE_PUZZLE && puzzlePhase === PUZZLE_SETUP)
          || !rapfiDbActive || !exact || !service?.isReady) return false;
        if (!service.setDisplayText(String(text || ""))) return false;
        persistedDbBase64 = "";
        saveState(true);
        notify();
        return true;
      },
      replacePosition(board, options = {}) { return replacePositionInternal(board, options); },
      replaceHistory(history, options = {}) { return replaceHistoryInternal(history, options); },
      clearPosition(source = "clear") {
        const service = db();
        if (!rapfiDbActive || !service?.isReady) return false;
        service.clear(currentRule);
        service.ensureCurrent();
        basePly = 0;
        if (workspaceMode === WORKSPACE_PUZZLE) {
          puzzlePhase = PUZZLE_SETUP;
          puzzleRootBoard = new Uint8Array(BOARD_CELLS);
        }
        exact = true;
        selectedNextByRoute.clear();
        persistedDbBase64 = "";
        emitWorkspaceChanged();
        return applyCurrentBoard(true, source, Boolean(workspaceMode));
      },
      setHistory(nextHistory, nextExact = true, nextRootRecordText = "") {
        if (nextExact === false) return false;
        return replaceHistoryInternal(nextHistory, { source: "set-history", rootRecordText: nextRootRecordText, basePly: 0 });
      },
      async importYXDB(bytes, rule, history = [], importedBasePly = 0) {
        const service = db();
        if (!service?.isReady) return false;
        const nextRule = normalizeRule(rule);
        restoringRule = true;
        try {
          const radio = ruleBox?.querySelector('input[name="rules"][value="' + nextRule + '"]');
          if (radio) radio.checked = true;
          if (ruleBox) ruleBox.dataset.activeRules = String(nextRule);
          await global.vcfSetRules?.(nextRule);
        } finally { restoringRule = false; }
        currentRule = nextRule;
        if (!service.restoreYXDB(bytes, currentRule)) return false;
        rapfiDbActive = true;
        exact = true;
        if (!restoreDbHistory(history)) return false;
        basePly = Math.max(0, Math.min(service.ply(), Number(importedBasePly || 0)));
        workspaceMode = WORKSPACE_RECORD;
        puzzlePhase = PUZZLE_SETUP;
        puzzleRootBoard = new Uint8Array(BOARD_CELLS);
        selectedNextByRoute.clear();
        persistedDbBase64 = "";
        service.ensureCurrent();
        emitWorkspaceChanged();
        return applyCurrentBoard(true, "record-import");
      },
      async importRoutes(routes, rule, openHistory = []) {
        const service = db();
        if (!service?.isReady) return false;
        const nextRule = normalizeRule(rule);
        restoringRule = true;
        try {
          const radio = ruleBox?.querySelector('input[name="rules"][value="' + nextRule + '"]');
          if (radio) radio.checked = true;
          if (ruleBox) ruleBox.dataset.activeRules = String(nextRule);
          await global.vcfSetRules?.(nextRule);
        } finally { restoringRule = false; }
        currentRule = nextRule;
        service.clear(currentRule);
        service.ensureCurrent();
        for (const rawRoute of Array.isArray(routes) ? routes : []) {
          service.resetBoard(currentRule);
          service.ensureCurrent();
          for (const rawMove of rawRoute || []) if (!service.replayMove(Number(rawMove), true)) return false;
        }
        if (!restoreDbHistory(openHistory)) return false;
        basePly = 0;
        workspaceMode = WORKSPACE_RECORD;
        puzzlePhase = PUZZLE_SETUP;
        puzzleRootBoard = new Uint8Array(BOARD_CELLS);
        exact = true;
        rapfiDbActive = true;
        selectedNextByRoute.clear();
        persistedDbBase64 = "";
        service.ensureCurrent();
        emitWorkspaceChanged();
        return applyCurrentBoard(true, "record-import");
      },
      exportPuzzle() {
        const puzzle = serializePuzzle();
        return puzzle ? JSON.parse(JSON.stringify(puzzle)) : null;
      },
      importPuzzle(value) { return importPuzzleInternal(value); },
      exportYXDB() {
        const service = db();
        if (workspaceMode !== WORKSPACE_RECORD || !rapfiDbActive || !exact || !service?.isReady) return null;
        if (service.history().includes(PASS)) throw new Error("打譜模式含 PASS，無法匯出 YXDB");
        service.ensureCurrent();
        const bytes = service.snapshotYXDB();
        return bytes?.length ? { bytes, recordCount: service.recordCount() } : null;
      },
      ensureActive() { return activateRapfiDatabase(); },
      isActive() { return Boolean(rapfiDbActive && exact && db()?.isReady); },
      playAt(move, source = "manual") {
        const service = db();
        const index = Number(move);
        if (!workspaceMode || (workspaceMode === WORKSPACE_PUZZLE && puzzlePhase !== PUZZLE_TREE)
          || !rapfiDbActive || !exact || !service?.isReady || !Number.isInteger(index)
          || index < 0 || index >= BOARD_CELLS || Number(service.board()[index])) return false;
        const parentKey = routeKey();
        if (!service.play(index, true)) return false;
        selectedNextByRoute.set(parentKey, index);
        persistedDbBase64 = "";
        return applyCurrentBoard(true, source);
      },
      navigateStep(direction) {
        const service = db();
        if (!rapfiDbActive || !exact || !service?.isReady) return false;
        if (direction < 0) {
          const history = service.history();
          if (service.ply() <= basePly || !history.length) return false;
          const move = history[history.length - 1];
          if (!service.undo()) return false;
          rememberSelectedNext(move);
          return applyCurrentBoard(false, "record-navigation");
        }
        const moves = queryChildren();
        const move = selectedNextMove(moves);
        if (move == null) return false;
        rememberSelectedNext(move);
        if (!service.play(move, false)) return false;
        return applyCurrentBoard(false, "record-navigation");
      },
      navigateBranch(direction) {
        const service = db();
        if (!rapfiDbActive || !exact || !service?.isReady) return false;
        if (direction < 0) {
          if (service.ply() <= basePly) return false;
          do {
            const history = service.history();
            const move = history[history.length - 1];
            if (!service.undo()) break;
            rememberSelectedNext(move);
            if (queryChildren().length > 1 || service.ply() <= basePly) break;
          } while (service.ply() > basePly);
          return applyCurrentBoard(false, "record-navigation");
        }
        let moves = queryChildren();
        if (!moves.length) return false;
        do {
          const move = selectedNextMove(moves);
          if (move == null) break;
          rememberSelectedNext(move);
          if (!service.play(move, false)) break;
          moves = queryChildren();
        } while (moves.length === 1);
        return applyCurrentBoard(false, "record-navigation");
      },
      appendPass() {
        const service = db();
        if (workspaceMode !== WORKSPACE_PUZZLE || puzzlePhase !== PUZZLE_TREE || !rapfiDbActive || !exact || !service?.isReady) return false;
        const parentKey = routeKey();
        if (!service.play(PASS, true)) return false;
        selectedNextByRoute.set(parentKey, PASS);
        persistedDbBase64 = "";
        return applyCurrentBoard(true, "manual");
      },
      deleteCurrentAndFollowing() {
        const service = db();
        if (!rapfiDbActive || !exact || !service?.isReady || service.ply() <= basePly) return false;
        if (!service.deleteCurrentAndChildren() || !service.undo()) return false;
        selectedNextByRoute.delete(routeKey());
        persistedDbBase64 = "";
        return applyCurrentBoard(true, "record-edit");
      },
      transform(transform) {
        const service = db();
        const normalized = Number(transform);
        if (!rapfiDbActive || !exact || !service?.isReady || !Number.isInteger(normalized) || normalized < 0 || normalized > 7) return false;
        const original = service.history();
        const transformed = original.map(move => transformMove(move, normalized));
        if (!restoreDbHistory(transformed)) { restoreDbHistory(original); return false; }
        if (workspaceMode === WORKSPACE_PUZZLE) {
          const nextRoot = new Uint8Array(BOARD_CELLS);
          for (let index = 0; index < BOARD_CELLS; index++) {
            if (puzzleRootBoard[index]) nextRoot[transformMove(index, normalized)] = puzzleRootBoard[index];
          }
          puzzleRootBoard = nextRoot;
        }
        selectedNextByRoute.clear();
        return applyCurrentBoard(false, "record-transform");
      },
      invalidate() { notify(); return true; },
    };

    global.addEventListener("vcf-rules-changed", () => {
      if (restoringRule || !rapfiDbActive || !db()?.isReady) return;
      const service = db();
      const nextRule = normalizeRule(activeRule());
      if (nextRule === currentRule) { notify(); return; }
      const moves = service.history();
      service.cloneRule(currentRule, nextRule);
      currentRule = nextRule;
      if (!restoreDbHistory(moves)) return;
      selectedNextByRoute.clear();
      persistedDbBase64 = "";
      exact = true;
      applyCurrentBoard(true, "rule-change");
    });

    notify();
  }

  installWorkbenchRecordState();

  function installWorkspaceModeUI() {
    const boardCard = document.querySelector(".vcf-board-card");
    const boardWrap = boardCard?.querySelector(".vcf-board-wrap");
    if (!boardCard || document.getElementById("vcf-workspace-mode")) return false;
    const panel = document.createElement("section");
    panel.id = "vcf-workspace-mode";
    panel.setAttribute("aria-label", "工作模式");
    panel.innerHTML = `
      <div class="vcf-workspace-mode-row">
        <span class="vcf-workspace-mode-title">工作模式</span>
        <span class="vcf-workspace-mode-badge" data-mode-badge>尚未選擇</span>
        <button type="button" data-new-mode="record">新增打譜</button>
        <button type="button" data-new-mode="puzzle">新增題目</button>
        <span class="vcf-workspace-format" data-format>請先選擇模式</span>
      </div>
      <div class="vcf-workspace-mode-row vcf-puzzle-controls" data-puzzle-controls hidden>
        <label>攻方
          <select data-puzzle-attacker aria-label="題目攻方">
            <option value="1">黑方</option>
            <option value="2">白方</option>
          </select>
        </label>
        <span data-setup-tools>
          <button type="button" data-setup-tool="1">放黑子</button>
          <button type="button" data-setup-tool="2">放白子</button>
          <button type="button" data-setup-tool="0">橡皮擦</button>
        </span>
        <button type="button" data-commit-puzzle>開始編輯解答</button>
        <button type="button" data-edit-puzzle hidden>重編初始盤面</button>
      </div>
    `;
    if (boardWrap) boardCard.insertBefore(panel, boardWrap);
    else boardCard.prepend(panel);

    const badge = panel.querySelector("[data-mode-badge]");
    const format = panel.querySelector("[data-format]");
    const puzzleControls = panel.querySelector("[data-puzzle-controls]");
    const setupTools = panel.querySelector("[data-setup-tools]");
    const attacker = panel.querySelector("[data-puzzle-attacker]");
    const commit = panel.querySelector("[data-commit-puzzle]");
    const edit = panel.querySelector("[data-edit-puzzle]");
    const status = message => {
      if (typeof global.setStatus === "function") global.setStatus(message);
      else {
        const node = document.getElementById("status");
        if (node) node.textContent = message;
      }
    };
    const sync = () => {
      const state = global.VCFWorkbenchRecord?.workspace?.() || {};
      const isPuzzle = state.mode === "puzzle";
      const isSetup = isPuzzle && state.puzzlePhase === "setup";
      badge.textContent = state.mode === "record" ? "打譜模式" : isPuzzle ? (isSetup ? "題目模式・擺題" : "題目模式・解答") : "尚未選擇";
      format.textContent = state.mode === "record" ? "儲存格式：Rapfi YXDB" : isPuzzle ? "儲存格式：VCF 題目容器" : "請先選擇模式";
      puzzleControls.hidden = !isPuzzle;
      setupTools.hidden = !isSetup;
      attacker.disabled = !isSetup;
      attacker.value = String(state.attacker === WHITE ? WHITE : BLACK);
      commit.hidden = !isSetup;
      edit.hidden = !isPuzzle || isSetup;
      for (const button of panel.querySelectorAll("[data-new-mode]")) {
        button.classList.toggle("is-active", button.dataset.newMode === state.mode);
      }
      for (const button of panel.querySelectorAll("[data-setup-tool]")) {
        button.classList.toggle("is-active", Number(button.dataset.setupTool) === Number(state.setupTool));
      }
    };

    panel.addEventListener("click", event => {
      const modeButton = event.target.closest("[data-new-mode]");
      if (modeButton) {
        const nextMode = modeButton.dataset.newMode;
        const current = global.VCFWorkbenchRecord?.workspace?.()?.mode;
        const hasContent = global.VCFWorkbenchRecord?.currentBoard?.().some(stone => Number(stone) !== EMPTY);
        if ((current || hasContent) && !global.confirm("建立新工作區會清除目前盤面、注釋與分支，確定繼續？")) return;
        if (!global.VCFWorkbenchRecord?.startWorkspace?.(nextMode)) {
          status("Rapfi 棋盤尚未就緒，請稍候再選擇模式");
          return;
        }
        status(nextMode === "record" ? "打譜模式：從空盤依序落子，可儲存為 YXDB" : "題目模式：先自由擺放黑白棋，再選擇攻方並開始編輯解答");
        return;
      }
      const toolButton = event.target.closest("[data-setup-tool]");
      if (toolButton) global.VCFWorkbenchRecord?.setPuzzleSetupTool?.(Number(toolButton.dataset.setupTool));
      if (event.target.closest("[data-commit-puzzle]")) {
        if (global.VCFWorkbenchRecord?.commitPuzzleSetup?.()) status("題目根盤面已建立；後續落子會記錄為解答分支");
        else status("請先在題目盤面放入至少一顆棋子");
      }
      if (event.target.closest("[data-edit-puzzle]")) {
        if (!global.confirm("重新編輯初始盤面會清除目前解答分支，確定繼續？")) return;
        if (global.VCFWorkbenchRecord?.editPuzzleSetup?.()) status("已返回題目擺盤；原解答分支已清除");
      }
    });
    attacker.addEventListener("change", () => {
      if (global.VCFWorkbenchRecord?.setPuzzleAttacker?.(Number(attacker.value))) {
        status(attacker.value === "2" ? "題目攻方已設為白方" : "題目攻方已設為黑方");
      }
    });
    global.addEventListener("vcf-workspace-mode-changed", sync);
    global.addEventListener("vcf-rapfi-db-active", sync);
    sync();
    return true;
  }

  installWorkspaceModeUI();

  function activeExportData() {
    const recordState = global.VCFWorkbenchRecord?.snapshot?.() || {
      history: [], exact: false, board: [], rootRecordText: "", basePly: 0,
    };
    const rule = Number(document.querySelector('input[name="rules"]:checked')?.value ?? 2);
    return {
      board: normalizeBoard(recordState.board || []),
      routes: [],
      attacker: 0,
      rule,
      history: recordState.history,
      historyExact: recordState.exact,
      rootRecordText: recordState.rootRecordText || "",
      basePly: Number(recordState.basePly || 0),
    };
  }

  function timestampName() {
    const d = new Date();
    const two = value => String(value).padStart(2, "0");
    return `${d.getFullYear()}${two(d.getMonth() + 1)}${two(d.getDate())}-${two(d.getHours())}${two(d.getMinutes())}${two(d.getSeconds())}`;
  }

  function downloadBytes(bytes, filename, type = "application/octet-stream") {
    const blob = new Blob([bytes], { type });
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
      <button id="bb-export-file" type="button">匯出棋譜</button>
      <button id="bb-hard-refresh" type="button">強制重新整理</button>
      <span id="bb-export-status" aria-live="polite"></span>
    `;

    const formatSelect = panel.querySelector("#bb-export-format");
    const exportButton = panel.querySelector("#bb-export-file");
    const exportStatus = panel.querySelector("#bb-export-status");
    const syncExportMode = () => {
      const workspace = global.VCFWorkbenchRecord?.workspace?.() || {};
      const mode = workspace.mode;
      const puzzle = mode === "puzzle";
      formatSelect.hidden = puzzle;
      exportButton.textContent = puzzle ? "匯出題目" : "匯出棋譜";
      exportButton.disabled = !mode || (puzzle && workspace.puzzlePhase !== "tree");
    };
    exportButton.addEventListener("click", () => {
      exportButton.disabled = true;
      exportStatus.textContent = "正在建立檔案……";
      try {
        const stamp = timestampName();
        const mode = global.VCFWorkbenchRecord?.workspace?.()?.mode;
        if (mode === "puzzle") {
          const puzzle = global.VCFWorkbenchRecord?.exportPuzzle?.();
          if (!puzzle) throw new Error("VCF 題目尚未就緒");
          const bytes = new TextEncoder().encode(JSON.stringify(puzzle, null, 2));
          downloadBytes(bytes, `vcf-${stamp}.vcf.json`, "application/json");
          exportStatus.textContent = `已匯出 VCF 題目（${Object.keys(puzzle.nodes || {}).length.toLocaleString()} 個盤面）`;
        } else if (mode !== "record") {
          throw new Error("請先選擇打譜模式或題目模式");
        } else if (formatSelect.value === "lib") {
          const data = activeExportData();
          const result = createRenLib(data);
          downloadBytes(result.bytes, `vcf-${stamp}.lib`);
          exportStatus.textContent = `已匯出 RenLib（${result.bytes.length.toLocaleString()} bytes）`;
        } else {
          const result = global.VCFWorkbenchRecord?.exportYXDB?.();
          if (!result?.bytes?.length) throw new Error("Rapfi 棋譜尚未就緒");
          downloadBytes(result.bytes, `vcf-${stamp}.db`);
          exportStatus.textContent = `已匯出 Rapfi YXDB（${Number(result.recordCount || 0).toLocaleString()} 個盤面）`;
        }
      } catch (error) {
        console.error("Rapfi 格式匯出失敗", error);
        exportStatus.textContent = error?.message || String(error);
      } finally {
        syncExportMode();
      }
    });
    global.addEventListener("vcf-workspace-mode-changed", syncExportMode);
    syncExportMode();

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
