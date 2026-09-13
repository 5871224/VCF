"use strict";

(function initVCFCloudYXDB(global) {
  const BOARD_SIZE = 15;
  const BOARD_CELLS = 225;
  const BLACK = 1;
  const WHITE = 2;
  const PASS = -1;
  const API_URL = "https://587.renju.org.tw/vcf/yxdb.php";
  const RECORD_STORAGE_KEY = "vcf_board_record_tree_v3";
  const AUTH_TOKEN_KEY = "vcf_google_auth_token_v1";
  const MAX_BLOCK = 64 * 1024;
  const FLG = 0x64;
  const BD = 0x40;
  const MAGIC = [0x04, 0x22, 0x4d, 0x18];
  const textDecoder = new TextDecoder("utf-8");

  let authUser = null;
  let googleClientId = "";
  let indexModulePromise = null;
  let indexModule = null;
  let indexedMeta = null;

  class ByteWriter {
    constructor(initial = 1024) {
      this.buffer = new Uint8Array(Math.max(32, initial));
      this.length = 0;
    }
    ensure(extra) {
      const needed = this.length + extra;
      if (needed <= this.buffer.length) return;
      let size = this.buffer.length;
      while (size < needed) size *= 2;
      const next = new Uint8Array(size);
      next.set(this.buffer);
      this.buffer = next;
    }
    u8(v) { this.ensure(1); this.buffer[this.length++] = v & 255; }
    u16(v) {
      this.ensure(2);
      this.buffer[this.length++] = v & 255;
      this.buffer[this.length++] = (v >>> 8) & 255;
    }
    u32(v) {
      this.ensure(4);
      v >>>= 0;
      this.buffer[this.length++] = v & 255;
      this.buffer[this.length++] = (v >>> 8) & 255;
      this.buffer[this.length++] = (v >>> 16) & 255;
      this.buffer[this.length++] = (v >>> 24) & 255;
    }
    raw(values) {
      const bytes = values instanceof Uint8Array ? values : Uint8Array.from(values || []);
      this.ensure(bytes.length);
      this.buffer.set(bytes, this.length);
      this.length += bytes.length;
    }
    finish() { return this.buffer.slice(0, this.length); }
  }

  function rotl32(v, n) { return ((v << n) | (v >>> (32 - n))) >>> 0; }
  function readU32LE(bytes, offset) {
    return (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0;
  }
  function xxhash32(value, seed = 0) {
    const bytes = value instanceof Uint8Array ? value : new Uint8Array(value || 0);
    const P1 = 0x9e3779b1, P2 = 0x85ebca77, P3 = 0xc2b2ae3d, P4 = 0x27d4eb2f, P5 = 0x165667b1;
    let offset = 0;
    const round = (acc, input) => {
      acc = (acc + Math.imul(input, P2)) >>> 0;
      return Math.imul(rotl32(acc, 13), P1) >>> 0;
    };
    let hash;
    if (bytes.length >= 16) {
      let v1 = (seed + P1 + P2) >>> 0, v2 = (seed + P2) >>> 0, v3 = seed >>> 0, v4 = (seed - P1) >>> 0;
      const limit = bytes.length - 16;
      while (offset <= limit) {
        v1 = round(v1, readU32LE(bytes, offset)); offset += 4;
        v2 = round(v2, readU32LE(bytes, offset)); offset += 4;
        v3 = round(v3, readU32LE(bytes, offset)); offset += 4;
        v4 = round(v4, readU32LE(bytes, offset)); offset += 4;
      }
      hash = (rotl32(v1, 1) + rotl32(v2, 7) + rotl32(v3, 12) + rotl32(v4, 18)) >>> 0;
    } else hash = (seed + P5) >>> 0;
    hash = (hash + bytes.length) >>> 0;
    while (offset + 4 <= bytes.length) {
      hash = (hash + Math.imul(readU32LE(bytes, offset), P3)) >>> 0;
      hash = Math.imul(rotl32(hash, 17), P4) >>> 0;
      offset += 4;
    }
    while (offset < bytes.length) {
      hash = (hash + Math.imul(bytes[offset++], P5)) >>> 0;
      hash = Math.imul(rotl32(hash, 11), P1) >>> 0;
    }
    hash ^= hash >>> 15; hash = Math.imul(hash, P2) >>> 0;
    hash ^= hash >>> 13; hash = Math.imul(hash, P3) >>> 0;
    hash ^= hash >>> 16;
    return hash >>> 0;
  }

  function lz4CompressBlock(value) {
    const source = value instanceof Uint8Array ? value : new Uint8Array(value || 0);
    const n = source.length;
    if (!n) return new Uint8Array(0);
    const output = new Uint8Array(n + Math.ceil(n / 255) + 32);
    const table = new Int32Array(1 << 16);
    table.fill(-1);
    let out = 0, anchor = 0, i = 0;
    const put = v => { output[out++] = v & 255; };
    const putLength = value => { while (value >= 255) { put(255); value -= 255; } put(value); };
    const emit = (literalStart, literalLength, matchOffset, matchLength) => {
      const tokenPos = out++;
      let token = Math.min(literalLength, 15) << 4;
      if (literalLength >= 15) putLength(literalLength - 15);
      output.set(source.subarray(literalStart, literalStart + literalLength), out);
      out += literalLength;
      if (matchLength > 0) {
        put(matchOffset); put(matchOffset >>> 8);
        const encoded = matchLength - 4;
        token |= Math.min(encoded, 15);
        if (encoded >= 15) putLength(encoded - 15);
      }
      output[tokenPos] = token;
    };
    const matchLimit = Math.max(0, n - 12);
    const matchEnd = Math.max(0, n - 5); // standard LZ4 block keeps final 5 bytes as literals
    while (i <= matchLimit) {
      const seq = readU32LE(source, i);
      const hash = (Math.imul(seq, 0x9e3779b1) >>> 16) & 0xffff;
      const ref = table[hash];
      table[hash] = i;
      if (ref >= 0 && i - ref <= 0xffff && source[ref] === source[i] && source[ref + 1] === source[i + 1]
          && source[ref + 2] === source[i + 2] && source[ref + 3] === source[i + 3]) {
        let length = 4;
        const max = Math.max(4, matchEnd - i);
        while (length < max && source[ref + length] === source[i + length]) length++;
        emit(anchor, i - anchor, i - ref, length);
        i += length;
        anchor = i;
        continue;
      }
      i++;
    }
    emit(anchor, n - anchor, 0, 0);
    return output.slice(0, out);
  }

  function createLZ4Frame(rawValue) {
    const raw = rawValue instanceof Uint8Array ? rawValue : new Uint8Array(rawValue || 0);
    const writer = new ByteWriter(raw.length + 64);
    writer.raw(MAGIC); writer.u8(FLG); writer.u8(BD);
    writer.u8((xxhash32(Uint8Array.from([FLG, BD])) >>> 8) & 255);
    for (let offset = 0; offset < raw.length; offset += MAX_BLOCK) {
      const block = raw.subarray(offset, Math.min(raw.length, offset + MAX_BLOCK));
      const compressed = lz4CompressBlock(block);
      if (compressed.length < block.length) { writer.u32(compressed.length); writer.raw(compressed); }
      else { writer.u32((0x80000000 | block.length) >>> 0); writer.raw(block); }
    }
    writer.u32(0); writer.u32(xxhash32(raw));
    return writer.finish();
  }

  function transformXY(x, y, t) {
    const m = 14;
    switch (t) {
      case 0: return [x, y]; case 1: return [m - y, x]; case 2: return [m - x, m - y]; case 3: return [y, m - x];
      case 4: return [m - x, y]; case 5: return [m - y, m - x]; case 6: return [x, m - y]; case 7: return [y, x];
      default: return [x, y];
    }
  }
  function positionsFor(board, stone, transform) {
    const result = [];
    for (let index = 0; index < BOARD_CELLS; index++) {
      if (board[index] === stone) result.push(transformXY(index % 15, Math.floor(index / 15), transform));
    }
    result.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    return result;
  }
  function comparePositions(a, b) {
    for (let i = 0; i < Math.min(a.length, b.length); i++) {
      if (a[i][0] !== b[i][0]) return a[i][0] - b[i][0];
      if (a[i][1] !== b[i][1]) return a[i][1] - b[i][1];
    }
    return a.length - b.length;
  }
  function canonicalPosition(board) {
    let best = null;
    for (let t = 0; t < 8; t++) {
      const candidate = { black: positionsFor(board, BLACK, t), white: positionsFor(board, WHITE, t) };
      if (!best || comparePositions(candidate.black, best.black) < 0
          || (comparePositions(candidate.black, best.black) === 0 && comparePositions(candidate.white, best.white) < 0)) best = candidate;
    }
    return best;
  }
  function yxdbKey(board, rule) {
    const c = canonicalPosition(board);
    const bytes = [rule, 15, 15];
    for (const [x, y] of c.black) bytes.push(x, y);
    for (const [x, y] of c.white) bytes.push(x, y);
    return Uint8Array.from(bytes);
  }
  function keyId(key) { return Array.from(key, v => v.toString(16).padStart(2, "0")).join(""); }
  function currentRule() {
    const value = Number(document.querySelector('input[name="rules"]:checked')?.value ?? 2);
    return [0, 1, 2].includes(value) ? value : 2;
  }
  function readStoredTree() {
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(RECORD_STORAGE_KEY) || "null"); } catch (_) {}
    if (!saved?.tree || saved.exact === false) throw new Error("目前棋譜沒有可驗證的完整手順，請先從空盤依原手順建立棋譜。");
    return saved.tree;
  }

  function buildRawYXDBFromTree(tree, rule = currentRule()) {
    const records = new Map();
    const board = new Uint8Array(BOARD_CELLS);
    let nodeCount = 0;
    const add = text => {
      const key = yxdbKey(board, rule), id = keyId(key), value = String(text || "");
      const existing = records.get(id);
      if (!existing) records.set(id, { key, text: value });
      else if (!existing.text && value) existing.text = value;
    };
    const visit = (node, depth) => {
      if (depth === 0) add(node?.recordText || "");
      for (const child of Array.isArray(node?.children) ? node.children : []) {
        const move = Number(child?.move), stone = Number(child?.stone), expected = depth % 2 === 0 ? BLACK : WHITE;
        if (move === PASS) throw new Error("YXDB 無法表示 PASS；含 PASS 的棋譜請改用 RenLib。");
        if (!Number.isInteger(move) || move < 0 || move >= BOARD_CELLS || board[move]) throw new Error("棋譜樹包含無效或重複落點。");
        if (stone !== expected) throw new Error("棋譜樹黑白手順不一致。");
        board[move] = stone; nodeCount++; add(child?.recordText || ""); visit(child, depth + 1); board[move] = 0;
      }
    };
    visit(tree, 0);
    const sorted = Array.from(records.values()).sort((a, b) => {
      for (let i = 0; i < 3; i++) if (a.key[i] !== b.key[i]) return a.key[i] - b.key[i];
      if (a.key.length !== b.key.length) return a.key.length - b.key.length;
      for (let i = 3; i < a.key.length; i++) if (a.key[i] !== b.key[i]) return a.key[i] - b.key[i];
      return 0;
    });
    const encoder = new TextEncoder();
    const metadata = encoder.encode('charset="UTF-8"');
    const writer = new ByteWriter(Math.max(1024, sorted.length * 24));
    writer.u32(sorted.length + 1);
    writer.u16(3); writer.raw([0, 0, 0]); writer.u16(5 + metadata.length); writer.raw([0, 0, 0, 0, 0]); writer.raw(metadata);
    for (const record of sorted) {
      const text = encoder.encode(record.text || "");
      writer.u16(record.key.length); writer.raw(record.key); writer.u16(5 + text.length);
      writer.u8(255); writer.u16(0); writer.u16(0); writer.raw(text);
    }
    return { raw: writer.finish(), recordCount: sorted.length, nodeCount };
  }
  function createCurrentYXDB() {
    const built = buildRawYXDBFromTree(readStoredTree(), currentRule());
    const bytes = createLZ4Frame(built.raw);
    return { bytes, recordCount: built.recordCount, nodeCount: built.nodeCount, rawSize: built.raw.length, compressedSize: bytes.length };
  }

  function getToken() { try { return localStorage.getItem(AUTH_TOKEN_KEY) || ""; } catch (_) { return ""; } }
  function setToken(token) { try { token ? localStorage.setItem(AUTH_TOKEN_KEY, token) : localStorage.removeItem(AUTH_TOKEN_KEY); } catch (_) {} }
  function authHeaders(extra = {}) {
    const token = getToken();
    return token ? { Authorization: `Bearer ${token}`, ...extra } : { ...extra };
  }
  async function jsonResponse(response) {
    const payload = await response.json().catch(() => null);
    if (response.status === 401) { setToken(""); authUser = null; refreshAuthUI(); }
    if (!response.ok || payload?.ok === false) throw new Error(payload?.error || `HTTP ${response.status}`);
    return payload;
  }
  async function publicConfig() {
    const response = await fetch(`${API_URL}?action=public_config`, { cache: "no-store", mode: "cors" });
    const payload = await jsonResponse(response);
    googleClientId = String(payload.google_client_id || "");
    return googleClientId;
  }
  async function authMe() {
    if (!getToken()) { authUser = null; return null; }
    try {
      const response = await fetch(`${API_URL}?action=auth_me`, { cache: "no-store", mode: "cors", headers: authHeaders() });
      const payload = await jsonResponse(response);
      authUser = payload.user || null;
    } catch (_) { authUser = null; }
    refreshAuthUI();
    return authUser;
  }
  async function onGoogleCredential(response) {
    const credential = String(response?.credential || "");
    if (!credential) throw new Error("Google 未回傳登入憑證");
    const http = await fetch(`${API_URL}?action=auth_google`, {
      method: "POST", mode: "cors", cache: "no-store", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id_token: credential }),
    });
    const payload = await jsonResponse(http);
    setToken(String(payload.token || ""));
    authUser = payload.user || null;
    refreshAuthUI();
    status(`已登入：${authUser?.name || authUser?.email || "Google 使用者"}`);
    return authUser;
  }
  async function logout() {
    const token = getToken();
    if (token) {
      try { await fetch(`${API_URL}?action=auth_logout`, { method: "POST", mode: "cors", cache: "no-store", headers: authHeaders() }); } catch (_) {}
    }
    setToken(""); authUser = null; indexedMeta = null;
    refreshAuthUI();
    status("已登出 Google 帳號。");
  }

  async function saveCurrent(title = "") {
    if (!authUser) throw new Error("請先使用 Google 登入");
    const result = createCurrentYXDB();
    const params = new URLSearchParams({ action: "save", title: String(title || ""), record_count: String(result.recordCount), raw_size: String(result.rawSize) });
    const response = await fetch(`${API_URL}?${params}`, {
      method: "POST", mode: "cors", cache: "no-store", headers: authHeaders({ "Content-Type": "application/octet-stream" }), body: result.bytes,
    });
    return { ...(await jsonResponse(response)), ...result };
  }
  async function list() {
    if (!authUser) throw new Error("請先使用 Google 登入");
    const response = await fetch(`${API_URL}?action=list`, { cache: "no-store", mode: "cors", headers: authHeaders() });
    return (await jsonResponse(response)).records || [];
  }
  async function fetchRecord(id) {
    if (!authUser) throw new Error("請先使用 Google 登入");
    const response = await fetch(`${API_URL}?action=get&id=${encodeURIComponent(Number(id))}`, { cache: "no-store", mode: "cors", headers: authHeaders() });
    if (!response.ok) {
      if (response.status === 401) { setToken(""); authUser = null; refreshAuthUI(); }
      const payload = await response.json().catch(() => null);
      throw new Error(payload?.error || `HTTP ${response.status}`);
    }
    return {
      bytes: new Uint8Array(await response.arrayBuffer()),
      meta: {
        id: Number(response.headers.get("X-VCF-Id") || id),
        title: decodeURIComponent(response.headers.get("X-VCF-Title") || ""),
        recordCount: Number(response.headers.get("X-VCF-Record-Count") || 0),
        rawSize: Number(response.headers.get("X-VCF-Raw-Size") || 0),
        compressedSize: Number(response.headers.get("X-VCF-Compressed-Size") || 0),
      },
    };
  }
  async function remove(id) {
    if (!authUser) throw new Error("請先使用 Google 登入");
    const response = await fetch(`${API_URL}?action=delete&id=${encodeURIComponent(Number(id))}`, { method: "POST", cache: "no-store", mode: "cors", headers: authHeaders() });
    return jsonResponse(response);
  }

  async function ensureIndexModule() {
    if (indexModule) return indexModule;
    if (!indexModulePromise) {
      if (typeof global.VCFYxdbIndexModule !== "function") throw new Error("YXDB WASM 模組尚未載入");
      indexModulePromise = global.VCFYxdbIndexModule({
        locateFile: file => new URL(`rapfi/engine/${file}`, location.href).href,
      }).then(module => {
        module._yxdbLoad = module.cwrap("vcfYxdbLoadFrame", "number", ["number", "number"]);
        module._yxdbQueryBoard = module.cwrap("vcfYxdbQueryBoard", "number", ["number", "number"]);
        module._yxdbTextPtr = module.cwrap("vcfYxdbResultTextPtr", "number", []);
        module._yxdbTextLength = module.cwrap("vcfYxdbResultTextLength", "number", []);
        module._yxdbRecordCount = module.cwrap("vcfYxdbRecordCount", "number", []);
        module._yxdbRawSize = module.cwrap("vcfYxdbRawSize", "number", []);
        module._yxdbIndexSlots = module.cwrap("vcfYxdbIndexSlots", "number", []);
        indexModule = module;
        return module;
      });
    }
    return indexModulePromise;
  }
  async function loadIntoIndex(bytes, meta = {}) {
    const module = await ensureIndexModule();
    const ptr = module._malloc(bytes.length);
    try {
      module.HEAPU8.set(bytes, ptr);
      const count = module._yxdbLoad(ptr, bytes.length);
      if (count < 0) throw new Error(`YXDB WASM 解析失敗（${count}）`);
      indexedMeta = { ...meta, recordCount: count, rawSize: module._yxdbRawSize(), indexSlots: module._yxdbIndexSlots() };
      global.VCFCloudYXDB.currentBytes = bytes;
      global.VCFCloudYXDB.currentMeta = indexedMeta;
      refreshQueryButton();
      return indexedMeta;
    } finally { module._free(ptr); }
  }
  async function load(id) {
    const result = await fetchRecord(id);
    await loadIntoIndex(result.bytes, result.meta);
    const importer = global.VCFRecordImportAPI;
    if (!importer?.loadBytes) throw new Error("棋譜載入模組尚未就緒，請重新整理頁面後再試");
    const title = String(result.meta?.title || "").trim();
    const imported = await importer.loadBytes(result.bytes, title ? `${title}.db` : `雲端棋譜-${id}.db`, { openAtEnd: true });
    return { ...result, imported, indexedMeta };
  }
  function readBoard() {
    const source = global._getArr?.() || [];
    const board = new Uint8Array(BOARD_CELLS);
    for (let i = 0; i < BOARD_CELLS; i++) {
      const value = Number(source[i]) || 0;
      board[i] = value === 1 || value === 2 ? value : 0;
    }
    return board;
  }
  async function queryCurrentBoard() {
    if (!indexedMeta) throw new Error("請先從「雲端棋譜」載入一個 YXDB");
    const module = await ensureIndexModule();
    const board = readBoard();
    const ptr = module._malloc(BOARD_CELLS);
    try {
      module.HEAPU8.set(board, ptr);
      const found = module._yxdbQueryBoard(ptr, currentRule());
      if (!found) return { found: false, text: "", meta: indexedMeta };
      const textPtr = module._yxdbTextPtr(), textLength = module._yxdbTextLength();
      const text = textLength > 0 ? textDecoder.decode(module.HEAPU8.slice(textPtr, textPtr + textLength)) : "";
      return { found: true, text, meta: indexedMeta };
    } finally { module._free(ptr); }
  }

  function formatBytes(v) {
    const n = Number(v) || 0;
    if (n < 1024) return `${n} B`;
    if (n < 1048576) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / 1048576).toFixed(2)} MB`;
  }
  function status(message) { const node = document.getElementById("bb-export-status"); if (node) node.textContent = message; }
  function download(bytes, filename) {
    const url = URL.createObjectURL(new Blob([bytes], { type: "application/octet-stream" }));
    const a = document.createElement("a"); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
  function injectStyle() {
    if (document.getElementById("vcf-cloud-style")) return;
    const style = document.createElement("style"); style.id = "vcf-cloud-style";
    style.textContent = `
      #bb-cloud-auth{display:flex;align-items:center;gap:7px;flex-wrap:wrap;padding:4px 0}
      #bb-cloud-user{font-size:12px;color:#4f5d50}.bb-cloud-btn{min-height:36px;padding:7px 10px;border:1px solid #39744c;border-radius:6px;background:#fff;color:#19512d;font:inherit;font-size:13px;cursor:pointer}.bb-cloud-btn:disabled{opacity:.5;cursor:not-allowed}
      #vcf-google-login{min-height:36px}#vcf-cloud-dialog{width:min(760px,calc(100vw - 24px));max-height:min(78vh,720px);border:1px solid #b9b09c;border-radius:12px;padding:0;box-shadow:0 16px 60px rgb(0 0 0 / 25%)}#vcf-cloud-dialog::backdrop{background:rgb(0 0 0 / 35%)}
      .vcf-cloud-body{padding:16px;display:grid;gap:12px}.vcf-cloud-head{display:flex;justify-content:space-between;align-items:center;gap:10px}.vcf-cloud-head h3{margin:0}.vcf-cloud-list{display:grid;gap:8px;overflow:auto;max-height:55vh}.vcf-cloud-row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:10px;align-items:center;padding:10px;border:1px solid #ddd5c5;border-radius:8px;background:#fffdf8}.vcf-cloud-title{font-weight:700}.vcf-cloud-meta{font-size:12px;color:#6b6559;margin-top:3px}.vcf-cloud-actions{display:flex;gap:5px;flex-wrap:wrap}.vcf-cloud-actions button,.vcf-cloud-head button{border:1px solid #aaa;border-radius:6px;background:#fff;padding:6px 8px;cursor:pointer}.vcf-cloud-empty{padding:18px;text-align:center;color:#6b6559;background:#f7f4ed;border-radius:8px}@media(max-width:600px){.vcf-cloud-row{grid-template-columns:1fr}}
    `;
    document.head.appendChild(style);
  }
  function ensureDialog() {
    let dialog = document.getElementById("vcf-cloud-dialog");
    if (dialog) return dialog;
    dialog = document.createElement("dialog"); dialog.id = "vcf-cloud-dialog";
    dialog.innerHTML = '<div class="vcf-cloud-body"><div class="vcf-cloud-head"><h3>我的雲端 YXDB 棋譜</h3><button type="button" data-close>關閉</button></div><div class="vcf-cloud-list" data-list></div></div>';
    dialog.querySelector("[data-close]").addEventListener("click", () => dialog.close()); document.body.appendChild(dialog); return dialog;
  }
  async function refreshDialog(dialog) {
    const container = dialog.querySelector("[data-list]"); container.innerHTML = '<div class="vcf-cloud-empty">正在讀取……</div>';
    const records = await list(); container.replaceChildren();
    if (!records.length) { container.innerHTML = '<div class="vcf-cloud-empty">這個 Google 帳號目前沒有雲端棋譜。</div>'; return; }
    for (const record of records) {
      const row = document.createElement("div"); row.className = "vcf-cloud-row";
      const info = document.createElement("div"); info.innerHTML = `<div class="vcf-cloud-title"></div><div class="vcf-cloud-meta"></div>`;
      info.firstElementChild.textContent = record.title || `棋譜 #${record.id}`;
      info.lastElementChild.textContent = `${record.record_count || 0} 個局面 · ${formatBytes(record.compressed_size)} · ${record.updated_at || ""}`;
      const actions = document.createElement("div"); actions.className = "vcf-cloud-actions";
      const loadButton = document.createElement("button"); loadButton.textContent = "載入棋譜";
      loadButton.addEventListener("click", async () => { loadButton.disabled = true; try { const loaded = await load(record.id); status(`已載入「${record.title || `棋譜 #${record.id}`}」：${loaded.imported?.nodeCount || indexedMeta.recordCount} 個局面；WASM 索引 ${indexedMeta.recordCount} 局面`); dialog.close(); } catch (e) { status(e.message || String(e)); } finally { loadButton.disabled = false; } });
      const dl = document.createElement("button"); dl.textContent = "下載 .db"; dl.addEventListener("click", async () => { dl.disabled = true; try { const r = await fetchRecord(record.id); download(r.bytes, `vcf-cloud-${record.id}.db`); } catch (e) { status(e.message || String(e)); } finally { dl.disabled = false; } });
      const del = document.createElement("button"); del.textContent = "刪除"; del.addEventListener("click", async () => { if (!confirm(`確定刪除「${record.title || `棋譜 #${record.id}`}」？`)) return; del.disabled = true; try { await remove(record.id); await refreshDialog(dialog); status("已刪除。"); } catch (e) { status(e.message || String(e)); } });
      actions.append(loadButton, dl, del); row.append(info, actions); container.appendChild(row);
    }
  }
  function refreshQueryButton() { const b = document.getElementById("bb-cloud-query"); if (b) b.disabled = !authUser || !indexedMeta; }
  function refreshAuthUI() {
    const login = document.getElementById("vcf-google-login"), user = document.getElementById("bb-cloud-user"), logoutButton = document.getElementById("bb-cloud-logout");
    const saveButton = document.getElementById("bb-cloud-save"), openButton = document.getElementById("bb-cloud-open");
    if (user) user.textContent = authUser ? `${authUser.name || authUser.email}｜只顯示此帳號棋譜` : "未登入";
    if (login) login.hidden = Boolean(authUser);
    if (logoutButton) logoutButton.hidden = !authUser;
    if (saveButton) saveButton.disabled = !authUser;
    if (openButton) openButton.disabled = !authUser;
    refreshQueryButton();
  }
  function renderGoogleButton() {
    const target = document.getElementById("vcf-google-login");
    if (!target || authUser || !googleClientId || !global.google?.accounts?.id) return false;
    target.replaceChildren();
    global.google.accounts.id.initialize({ client_id: googleClientId, callback: credential => onGoogleCredential(credential).catch(e => status(e.message || String(e))) });
    global.google.accounts.id.renderButton(target, { theme: "outline", size: "medium", text: "signin_with", shape: "rectangular" });
    return true;
  }
  function installUI() {
    const panel = document.getElementById("bitboard-architecture-panel");
    if (!panel || document.getElementById("bb-cloud-auth")) return false;
    injectStyle();
    const exportStatus = panel.querySelector("#bb-export-status");
    const auth = document.createElement("div"); auth.id = "bb-cloud-auth";
    auth.innerHTML = '<div id="vcf-google-login"></div><span id="bb-cloud-user"></span><button id="bb-cloud-logout" class="bb-cloud-btn" type="button" hidden>登出</button>';
    const saveButton = document.createElement("button"); saveButton.id = "bb-cloud-save"; saveButton.className = "bb-cloud-btn"; saveButton.textContent = "雲端儲存";
    const openButton = document.createElement("button"); openButton.id = "bb-cloud-open"; openButton.className = "bb-cloud-btn"; openButton.textContent = "我的雲端棋譜";
    const queryButton = document.createElement("button"); queryButton.id = "bb-cloud-query"; queryButton.className = "bb-cloud-btn"; queryButton.textContent = "查目前盤面"; queryButton.disabled = true;
    panel.insertBefore(auth, exportStatus || null); panel.insertBefore(saveButton, exportStatus || null); panel.insertBefore(openButton, exportStatus || null); panel.insertBefore(queryButton, exportStatus || null);
    auth.querySelector("#bb-cloud-logout").addEventListener("click", () => logout());
    saveButton.addEventListener("click", async () => {
      saveButton.disabled = true; status("正在建立 LZ4 YXDB……");
      try {
        const title = prompt("棋譜標題", "") ?? null; if (title === null) return;
        const result = await saveCurrent(title.trim());
        status(`已存入你的帳號 #${result.id}：${result.recordCount} 局面 / ${formatBytes(result.compressedSize)}`);
      } catch (e) { status(e.message || String(e)); } finally { refreshAuthUI(); }
    });
    openButton.addEventListener("click", async () => { openButton.disabled = true; try { const dialog = ensureDialog(); dialog.showModal(); await refreshDialog(dialog); } catch (e) { status(e.message || String(e)); } finally { refreshAuthUI(); } });
    queryButton.addEventListener("click", async () => {
      queryButton.disabled = true;
      try {
        const result = await queryCurrentBoard();
        status(result.found ? `YXDB 命中${result.text ? `：${result.text}` : "（無註解）"}` : "目前盤面在這份 YXDB 中找不到。");
      } catch (e) { status(e.message || String(e)); } finally { refreshQueryButton(); }
    });
    refreshAuthUI(); return true;
  }

  const api = {
    API_URL, xxhash32, lz4CompressBlock, createLZ4Frame, buildRawYXDBFromTree, createCurrentYXDB,
    publicConfig, authMe, onGoogleCredential, logout, saveCurrent, list, load, remove, loadIntoIndex, queryCurrentBoard,
    currentBytes: null, currentMeta: null,
    get authUser() { return authUser; },
  };
  global.VCFCloudYXDB = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof document === "undefined") return;

  installUI();
  Promise.all([publicConfig(), authMe()]).then(() => { refreshAuthUI(); renderGoogleButton(); }).catch(e => status(e.message || String(e)));
  global.addEventListener("load", () => { renderGoogleButton(); }, { once: true });
})(typeof window !== "undefined" ? window : globalThis);
