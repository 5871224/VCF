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

  function collectYXDBPositions(rootBoard, routes, attacker, rule) {
    const records = new Map();
    const add = board => {
      assertRapfiPosition(board);
      const key = yxdbKeyBytes(board, rule);
      records.set(keyString(key), { key });
    };

    add(rootBoard);
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

  function createYXDB({ board, routes = [], attacker = 0, rule = 2 }) {
    const normalizedBoard = normalizeBoard(board);
    const normalizedRule = [0, 1, 2].includes(Number(rule)) ? Number(rule) : 2;
    const routeList = normalizedRoutes(routes);
    const side = routeList.length ? Number(attacker) : 0;
    if (routeList.length && side !== BLACK && side !== WHITE) {
      throw new Error("YXDB 匯出需要知道 VCF 攻方");
    }
    const records = collectYXDBPositions(normalizedBoard, routeList, side, normalizedRule);
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
      writer.u16(record.key.length);
      writer.raw(record.key);
      writer.u16(5);
      writer.u8(0xff); // Database::LABEL_NONE (-1)
      writer.u16(0);   // value
      writer.u16(0);   // depth/bound
    }

    return { bytes: writer.finish(), recordCount: records.length, compressed: false };
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

  function buildRenLibTree(rootBoard, routes, attacker) {
    const routeList = normalizedRoutes(routes);
    const root = makeTreeNode();
    const setup = deterministicSetupMoves(rootBoard, routeList.length ? attacker : 0);
    let setupTail = root;
    for (const move of setup.moves) setupTail = appendChild(setupTail, move);

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

  function createRenLib({ board, routes = [], attacker = 0 }) {
    const normalizedBoard = normalizeBoard(board);
    const tree = buildRenLibTree(normalizedBoard, routes, Number(attacker));
    if (!tree.children.length) throw new Error("空白盤面且沒有 VCF 路線，無法建立有效 RenLib 檔案");
    const writer = new ByteWriter();
    writer.raw([
      0xff, 0x52, 0x65, 0x6e, 0x4c, 0x69, 0x62, 0xff,
      3, 0,
      0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
    ]);
    writeRenLibChildren(writer, tree.children);
    return { bytes: writer.finish() };
  }

  const RapfiFormats = {
    createYXDB,
    createRenLib,
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
    return { board, routes, attacker, rule };
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
          exportStatus.textContent = `已匯出 YXDB（${result.recordCount} 個盤面，未壓縮）`;
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
