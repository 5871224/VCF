"use strict";

(function initVCFCloudYXDB(global) {
  const BOARD_SIZE = 15;
  const BOARD_CELLS = BOARD_SIZE * BOARD_SIZE;
  const BLACK = 1;
  const WHITE = 2;
  const PASS = -1;
  const API_URL = "https://587.renju.org.tw/vcf/yxdb.php";
  const RECORD_STORAGE_KEY = "vcf_board_record_tree_v3";
  const OWNER_KEY = "vcf_cloud_owner_v1";
  const TOKEN_KEY = "vcf_cloud_token_v1";
  const MAX_BLOCK = 64 * 1024;
  const FLG = 0x64; // LZ4 frame v1 + independent blocks + content checksum
  const BD = 0x40;  // 64 KiB blocks
  const MAGIC = [0x04, 0x22, 0x4d, 0x18];

  class ByteWriter {
    constructor(initial = 1024) {
      this.buffer = new Uint8Array(Math.max(32, initial));
      this.length = 0;
    }
    ensure(extra) {
      const required = this.length + extra;
      if (required <= this.buffer.length) return;
      let size = this.buffer.length;
      while (size < required) size *= 2;
      const next = new Uint8Array(size);
      next.set(this.buffer);
      this.buffer = next;
    }
    u8(value) {
      this.ensure(1);
      this.buffer[this.length++] = Number(value) & 0xff;
    }
    u16(value) {
      this.ensure(2);
      const v = Number(value) & 0xffff;
      this.buffer[this.length++] = v & 0xff;
      this.buffer[this.length++] = (v >>> 8) & 0xff;
    }
    u32(value) {
      this.ensure(4);
      const v = Number(value) >>> 0;
      this.buffer[this.length++] = v & 0xff;
      this.buffer[this.length++] = (v >>> 8) & 0xff;
      this.buffer[this.length++] = (v >>> 16) & 0xff;
      this.buffer[this.length++] = (v >>> 24) & 0xff;
    }
    raw(values) {
      const bytes = values instanceof Uint8Array ? values : Uint8Array.from(values || []);
      this.ensure(bytes.length);
      this.buffer.set(bytes, this.length);
      this.length += bytes.length;
    }
    finish() {
      return this.buffer.slice(0, this.length);
    }
  }

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
    const P1 = 0x9e3779b1;
    const P2 = 0x85ebca77;
    const P3 = 0xc2b2ae3d;
    const P4 = 0x27d4eb2f;
    const P5 = 0x165667b1;
    let offset = 0;
    let hash;
    const round = (acc, input) => {
      acc = (acc + Math.imul(input, P2)) >>> 0;
      acc = rotl32(acc, 13);
      return Math.imul(acc, P1) >>> 0;
    };

    if (bytes.length >= 16) {
      let v1 = (Number(seed) + P1 + P2) >>> 0;
      let v2 = (Number(seed) + P2) >>> 0;
      let v3 = Number(seed) >>> 0;
      let v4 = (Number(seed) - P1) >>> 0;
      const limit = bytes.length - 16;
      while (offset <= limit) {
        v1 = round(v1, readU32LE(bytes, offset)); offset += 4;
        v2 = round(v2, readU32LE(bytes, offset)); offset += 4;
        v3 = round(v3, readU32LE(bytes, offset)); offset += 4;
        v4 = round(v4, readU32LE(bytes, offset)); offset += 4;
      }
      hash = (rotl32(v1, 1) + rotl32(v2, 7) + rotl32(v3, 12) + rotl32(v4, 18)) >>> 0;
    } else {
      hash = (Number(seed) + P5) >>> 0;
    }

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
    hash ^= hash >>> 15;
    hash = Math.imul(hash, P2) >>> 0;
    hash ^= hash >>> 13;
    hash = Math.imul(hash, P3) >>> 0;
    hash ^= hash >>> 16;
    return hash >>> 0;
  }

  function lz4CompressBlock(input) {
    const source = input instanceof Uint8Array ? input : new Uint8Array(input || 0);
    const n = source.length;
    if (!n) return new Uint8Array(0);
    const output = new Uint8Array(n + Math.ceil(n / 255) + 32);
    const table = new Int32Array(1 << 16);
    table.fill(-1);
    let out = 0;
    let anchor = 0;
    let i = 0;

    const put = value => { output[out++] = value & 0xff; };
    const putLength = value => {
      let remaining = value;
      while (remaining >= 255) {
        put(255);
        remaining -= 255;
      }
      put(remaining);
    };
    const emitSequence = (literalStart, literalLength, matchOffset, matchLength) => {
      const tokenPos = out++;
      let token = Math.min(literalLength, 15) << 4;
      if (literalLength >= 15) putLength(literalLength - 15);
      output.set(source.subarray(literalStart, literalStart + literalLength), out);
      out += literalLength;
      if (matchLength > 0) {
        put(matchOffset);
        put(matchOffset >>> 8);
        const encodedMatch = matchLength - 4;
        token |= Math.min(encodedMatch, 15);
        if (encodedMatch >= 15) putLength(encodedMatch - 15);
      }
      output[tokenPos] = token;
    };

    // The conservative 12-byte margin follows the LZ4 block end constraints and
    // keeps the generated blocks compatible with standard LZ4 decoders.
    const matchLimit = Math.max(0, n - 12);
    while (i <= matchLimit) {
      const sequence = readU32LE(source, i);
      const hash = (Math.imul(sequence, 0x9e3779b1) >>> 16) & 0xffff;
      const ref = table[hash];
      table[hash] = i;
      if (ref >= 0 && i - ref <= 0xffff
          && source[ref] === source[i]
          && source[ref + 1] === source[i + 1]
          && source[ref + 2] === source[i + 2]
          && source[ref + 3] === source[i + 3]) {
        let matchLength = 4;
        const max = n - i;
        while (matchLength < max && source[ref + matchLength] === source[i + matchLength]) matchLength++;
        emitSequence(anchor, i - anchor, i - ref, matchLength);
        i += matchLength;
        anchor = i;
        if (i <= matchLimit) {
          const back = Math.max(anchor - 2, 0);
          if (back + 4 <= n) {
            const seq2 = readU32LE(source, back);
            table[(Math.imul(seq2, 0x9e3779b1) >>> 16) & 0xffff] = back;
          }
        }
        continue;
      }
      i++;
    }
    emitSequence(anchor, n - anchor, 0, 0);
    return output.slice(0, out);
  }

  function createLZ4Frame(rawValue) {
    const raw = rawValue instanceof Uint8Array ? rawValue : new Uint8Array(rawValue || 0);
    const writer = new ByteWriter(raw.length + 64);
    writer.raw(MAGIC);
    writer.u8(FLG);
    writer.u8(BD);
    writer.u8((xxhash32(new Uint8Array([FLG, BD])) >>> 8) & 0xff);
    for (let offset = 0; offset < raw.length; offset += MAX_BLOCK) {
      const block = raw.subarray(offset, Math.min(raw.length, offset + MAX_BLOCK));
      const compressed = lz4CompressBlock(block);
      if (compressed.length < block.length) {
        writer.u32(compressed.length);
        writer.raw(compressed);
      } else {
        writer.u32((0x80000000 | block.length) >>> 0);
        writer.raw(block);
      }
    }
    writer.u32(0);
    writer.u32(xxhash32(raw));
    return writer.finish();
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

  function positionsFor(board, stone, transform) {
    const positions = [];
    for (let index = 0; index < BOARD_CELLS; index++) {
      if (board[index] !== stone) continue;
      positions.push(transformXY(index % BOARD_SIZE, Math.floor(index / BOARD_SIZE), transform));
    }
    positions.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    return positions;
  }

  function comparePositions(left, right) {
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
      const candidate = {
        black: positionsFor(board, BLACK, transform),
        white: positionsFor(board, WHITE, transform),
      };
      if (!best) {
        best = candidate;
        continue;
      }
      const blackCompare = comparePositions(candidate.black, best.black);
      if (blackCompare < 0 || (blackCompare === 0 && comparePositions(candidate.white, best.white) < 0)) best = candidate;
    }
    return best;
  }

  function yxdbKey(board, rule) {
    const canonical = canonicalPosition(board);
    const bytes = [rule, BOARD_SIZE, BOARD_SIZE];
    for (const [x, y] of canonical.black) bytes.push(x, y);
    for (const [x, y] of canonical.white) bytes.push(x, y);
    return Uint8Array.from(bytes);
  }

  function keyId(key) {
    let result = "";
    for (const value of key) result += value.toString(16).padStart(2, "0");
    return result;
  }

  function readStoredTree() {
    let saved;
    try {
      saved = JSON.parse(global.localStorage?.getItem(RECORD_STORAGE_KEY) || "null");
    } catch (_) {
      saved = null;
    }
    if (!saved?.tree || saved.exact === false) {
      throw new Error("目前棋譜沒有可驗證的完整手順，請先從空盤依原手順建立棋譜後再雲端儲存。");
    }
    return saved.tree;
  }

  function currentRule() {
    const value = Number(global.document?.querySelector('input[name="rules"]:checked')?.value ?? 2);
    return [0, 1, 2].includes(value) ? value : 2;
  }

  function buildRawYXDBFromTree(tree, rule = currentRule()) {
    const records = new Map();
    const board = new Uint8Array(BOARD_CELLS);
    let nodeCount = 0;

    const add = (recordText = "") => {
      const key = yxdbKey(board, rule);
      const id = keyId(key);
      const text = String(recordText || "");
      const existing = records.get(id);
      if (!existing) records.set(id, { key, text });
      else if (!existing.text && text) existing.text = text;
    };

    const visit = (node, depth) => {
      if (depth === 0) add(node?.recordText || "");
      const children = Array.isArray(node?.children) ? node.children : [];
      for (const child of children) {
        const move = Number(child?.move);
        const stone = Number(child?.stone);
        const expected = depth % 2 === 0 ? BLACK : WHITE;
        if (move === PASS) throw new Error("YXDB 無法表示 PASS；含 PASS 的棋譜請改用 RenLib。");
        if (!Number.isInteger(move) || move < 0 || move >= BOARD_CELLS || board[move]) {
          throw new Error("棋譜樹包含無效或重複落點，無法建立 YXDB。");
        }
        if (stone !== expected) throw new Error("棋譜樹黑白手順不一致，無法建立 YXDB。");
        board[move] = stone;
        nodeCount++;
        add(child?.recordText || "");
        visit(child, depth + 1);
        board[move] = 0;
      }
    };
    visit(tree, 0);

    const sorted = Array.from(records.values()).sort((a, b) => {
      const left = a.key;
      const right = b.key;
      for (let i = 0; i < 3; i++) if (left[i] !== right[i]) return left[i] - right[i];
      if (left.length !== right.length) return left.length - right.length;
      for (let i = 3; i < left.length; i++) if (left[i] !== right[i]) return left[i] - right[i];
      return 0;
    });

    const encoder = new TextEncoder();
    const metadata = encoder.encode('charset="UTF-8"');
    const writer = new ByteWriter(Math.max(1024, sorted.length * 24));
    writer.u32(sorted.length + 1);
    writer.u16(3);
    writer.raw([0, 0, 0]);
    writer.u16(5 + metadata.length);
    writer.raw([0, 0, 0, 0, 0]);
    writer.raw(metadata);
    for (const record of sorted) {
      const text = encoder.encode(record.text || "");
      writer.u16(record.key.length);
      writer.raw(record.key);
      writer.u16(5 + text.length);
      writer.u8(0xff);
      writer.u16(0);
      writer.u16(0);
      writer.raw(text);
    }
    return { raw: writer.finish(), recordCount: sorted.length, nodeCount };
  }

  function createCurrentYXDB() {
    const tree = readStoredTree();
    const built = buildRawYXDBFromTree(tree, currentRule());
    const bytes = createLZ4Frame(built.raw);
    return {
      bytes,
      recordCount: built.recordCount,
      nodeCount: built.nodeCount,
      rawSize: built.raw.length,
      compressedSize: bytes.length,
      compressionRatio: built.raw.length ? bytes.length / built.raw.length : 1,
    };
  }

  function randomHex(bytesLength) {
    const bytes = new Uint8Array(bytesLength);
    global.crypto.getRandomValues(bytes);
    return Array.from(bytes, value => value.toString(16).padStart(2, "0")).join("");
  }

  function cloudIdentity() {
    let owner = "";
    let token = "";
    try {
      owner = global.localStorage?.getItem(OWNER_KEY) || "";
      token = global.localStorage?.getItem(TOKEN_KEY) || "";
    } catch (_) {}
    if (!/^[0-9a-f-]{36}$/i.test(owner)) owner = global.crypto.randomUUID();
    if (!/^[0-9a-f]{64}$/i.test(token)) token = randomHex(32);
    try {
      global.localStorage?.setItem(OWNER_KEY, owner);
      global.localStorage?.setItem(TOKEN_KEY, token);
    } catch (_) {}
    return { owner: owner.toLowerCase(), token: token.toLowerCase() };
  }

  function authHeaders(extra = {}) {
    const identity = cloudIdentity();
    return {
      "X-VCF-Owner": identity.owner,
      "X-VCF-Token": identity.token,
      ...extra,
    };
  }

  async function parseJsonResponse(response) {
    const payload = await response.json().catch(() => null);
    if (!response.ok || payload?.ok === false) {
      throw new Error(payload?.error || `HTTP ${response.status}`);
    }
    return payload;
  }

  async function saveCurrent(title = "") {
    const result = createCurrentYXDB();
    const params = new URLSearchParams({
      action: "save",
      title: String(title || ""),
      record_count: String(result.recordCount),
      raw_size: String(result.rawSize),
    });
    const response = await fetch(`${API_URL}?${params}`, {
      method: "POST",
      mode: "cors",
      cache: "no-store",
      headers: authHeaders({ "Content-Type": "application/octet-stream" }),
      body: result.bytes,
    });
    return { ...(await parseJsonResponse(response)), ...result };
  }

  async function list() {
    const response = await fetch(`${API_URL}?action=list`, {
      method: "GET",
      mode: "cors",
      cache: "no-store",
      headers: authHeaders(),
    });
    const payload = await parseJsonResponse(response);
    return Array.isArray(payload.records) ? payload.records : [];
  }

  async function load(id) {
    const params = new URLSearchParams({ action: "get", id: String(Number(id)) });
    const response = await fetch(`${API_URL}?${params}`, {
      method: "GET",
      mode: "cors",
      cache: "no-store",
      headers: authHeaders(),
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      throw new Error(payload?.error || `HTTP ${response.status}`);
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    global.VCFCloudYXDB.currentBytes = bytes;
    global.VCFCloudYXDB.currentMeta = {
      id: Number(response.headers.get("X-VCF-Id") || id),
      title: decodeURIComponent(response.headers.get("X-VCF-Title") || ""),
      recordCount: Number(response.headers.get("X-VCF-Record-Count") || 0),
      rawSize: Number(response.headers.get("X-VCF-Raw-Size") || 0),
      compressedSize: Number(response.headers.get("X-VCF-Compressed-Size") || bytes.length),
      sha256: response.headers.get("X-VCF-SHA256") || "",
    };
    return bytes;
  }

  async function remove(id) {
    const params = new URLSearchParams({ action: "delete", id: String(Number(id)) });
    const response = await fetch(`${API_URL}?${params}`, {
      method: "POST",
      mode: "cors",
      cache: "no-store",
      headers: authHeaders(),
    });
    return parseJsonResponse(response);
  }

  function download(bytes, filename) {
    const url = URL.createObjectURL(new Blob([bytes], { type: "application/octet-stream" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  function injectStyle() {
    if (document.getElementById("vcf-cloud-style")) return;
    const style = document.createElement("style");
    style.id = "vcf-cloud-style";
    style.textContent = `
      #bb-cloud-save,#bb-cloud-open{min-height:38px;display:inline-flex;align-items:center;justify-content:center;padding:8px 12px;border:1px solid #39744c;border-radius:6px;background:#fff;color:#19512d;font:inherit;font-size:13px;cursor:pointer}
      #bb-cloud-save:disabled,#bb-cloud-open:disabled{opacity:.6;cursor:wait}
      #vcf-cloud-dialog{width:min(760px,calc(100vw - 24px));max-height:min(78vh,720px);border:1px solid #b9b09c;border-radius:12px;padding:0;box-shadow:0 16px 60px rgb(0 0 0 / 25%)}
      #vcf-cloud-dialog::backdrop{background:rgb(0 0 0 / 35%)}
      .vcf-cloud-dialog-body{padding:16px;display:grid;gap:12px}
      .vcf-cloud-dialog-head{display:flex;align-items:center;justify-content:space-between;gap:10px}
      .vcf-cloud-dialog-head h3{margin:0;font-size:1.05rem}
      .vcf-cloud-list{display:grid;gap:8px;overflow:auto;max-height:55vh}
      .vcf-cloud-row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:10px;align-items:center;padding:10px;border:1px solid #ddd5c5;border-radius:8px;background:#fffdf8}
      .vcf-cloud-title{font-weight:700;overflow-wrap:anywhere}
      .vcf-cloud-meta{font-size:12px;color:#6b6559;margin-top:3px}
      .vcf-cloud-actions{display:flex;gap:5px;flex-wrap:wrap;justify-content:flex-end}
      .vcf-cloud-actions button,.vcf-cloud-dialog-head button{border:1px solid #aaa;border-radius:6px;background:#fff;padding:6px 8px;cursor:pointer}
      .vcf-cloud-empty{padding:18px;text-align:center;color:#6b6559;background:#f7f4ed;border-radius:8px}
      @media(max-width:600px){.vcf-cloud-row{grid-template-columns:1fr}.vcf-cloud-actions{justify-content:flex-start}}
    `;
    document.head.appendChild(style);
  }

  function formatBytes(value) {
    const bytes = Number(value) || 0;
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
  }

  function status(message) {
    const node = document.getElementById("bb-export-status");
    if (node) node.textContent = message;
  }

  function ensureDialog() {
    let dialog = document.getElementById("vcf-cloud-dialog");
    if (dialog) return dialog;
    dialog = document.createElement("dialog");
    dialog.id = "vcf-cloud-dialog";
    dialog.innerHTML = `
      <div class="vcf-cloud-dialog-body">
        <div class="vcf-cloud-dialog-head"><h3>雲端 YXDB 棋譜</h3><button type="button" data-close>關閉</button></div>
        <div class="vcf-cloud-list" data-list></div>
      </div>`;
    dialog.querySelector("[data-close]").addEventListener("click", () => dialog.close());
    document.body.appendChild(dialog);
    return dialog;
  }

  async function refreshDialog(dialog) {
    const listNode = dialog.querySelector("[data-list]");
    listNode.innerHTML = '<div class="vcf-cloud-empty">正在讀取……</div>';
    const records = await list();
    listNode.replaceChildren();
    if (!records.length) {
      listNode.innerHTML = '<div class="vcf-cloud-empty">目前沒有雲端棋譜。</div>';
      return;
    }
    for (const record of records) {
      const row = document.createElement("div");
      row.className = "vcf-cloud-row";
      const info = document.createElement("div");
      const title = document.createElement("div");
      title.className = "vcf-cloud-title";
      title.textContent = record.title || `棋譜 #${record.id}`;
      const meta = document.createElement("div");
      meta.className = "vcf-cloud-meta";
      meta.textContent = `${record.record_count || 0} 個局面 · ${formatBytes(record.compressed_size)} · ${record.updated_at || ""}`;
      info.append(title, meta);
      const actions = document.createElement("div");
      actions.className = "vcf-cloud-actions";
      const loadButton = document.createElement("button");
      loadButton.type = "button";
      loadButton.textContent = "載入二進位";
      loadButton.addEventListener("click", async () => {
        loadButton.disabled = true;
        try {
          const bytes = await load(record.id);
          status(`已載入 ${formatBytes(bytes.length)} YXDB 到 Uint8Array（未展開 JS 結構）`);
          dialog.close();
        } catch (error) {
          status(error?.message || String(error));
        } finally {
          loadButton.disabled = false;
        }
      });
      const downloadButton = document.createElement("button");
      downloadButton.type = "button";
      downloadButton.textContent = "下載 .db";
      downloadButton.addEventListener("click", async () => {
        downloadButton.disabled = true;
        try {
          const bytes = await load(record.id);
          download(bytes, `vcf-cloud-${record.id}.db`);
        } catch (error) {
          status(error?.message || String(error));
        } finally {
          downloadButton.disabled = false;
        }
      });
      const deleteButton = document.createElement("button");
      deleteButton.type = "button";
      deleteButton.textContent = "刪除";
      deleteButton.addEventListener("click", async () => {
        if (!global.confirm(`確定刪除「${record.title || `棋譜 #${record.id}`}」？`)) return;
        deleteButton.disabled = true;
        try {
          await remove(record.id);
          await refreshDialog(dialog);
          status("雲端棋譜已刪除。");
        } catch (error) {
          status(error?.message || String(error));
        }
      });
      actions.append(loadButton, downloadButton, deleteButton);
      row.append(info, actions);
      listNode.appendChild(row);
    }
  }

  function installUI() {
    const panel = document.getElementById("bitboard-architecture-panel");
    if (!panel || document.getElementById("bb-cloud-save")) return false;
    injectStyle();
    const exportStatus = panel.querySelector("#bb-export-status");
    const saveButton = document.createElement("button");
    saveButton.id = "bb-cloud-save";
    saveButton.type = "button";
    saveButton.textContent = "雲端儲存";
    const openButton = document.createElement("button");
    openButton.id = "bb-cloud-open";
    openButton.type = "button";
    openButton.textContent = "雲端棋譜";
    panel.insertBefore(saveButton, exportStatus || null);
    panel.insertBefore(openButton, exportStatus || null);

    saveButton.addEventListener("click", async () => {
      saveButton.disabled = true;
      status("正在建立真正 LZ4 壓縮的 YXDB……");
      try {
        const defaultTitle = String(document.getElementById("vcf-record-title")?.value || "").trim();
        const title = global.prompt("棋譜標題", defaultTitle) ?? null;
        if (title === null) return;
        const result = await saveCurrent(title.trim());
        const percent = result.rawSize ? Math.round((1 - result.compressedSize / result.rawSize) * 100) : 0;
        status(`已存雲端 #${result.id}：${result.recordCount} 局面，${formatBytes(result.compressedSize)}（LZ4 節省 ${percent}%）`);
      } catch (error) {
        console.error("VCF 雲端儲存失敗", error);
        status(error?.message || String(error));
      } finally {
        saveButton.disabled = false;
      }
    });

    openButton.addEventListener("click", async () => {
      openButton.disabled = true;
      try {
        const dialog = ensureDialog();
        if (!dialog.open) dialog.showModal();
        await refreshDialog(dialog);
      } catch (error) {
        status(error?.message || String(error));
      } finally {
        openButton.disabled = false;
      }
    });
    return true;
  }

  const api = {
    API_URL,
    xxhash32,
    lz4CompressBlock,
    createLZ4Frame,
    buildRawYXDBFromTree,
    createCurrentYXDB,
    saveCurrent,
    list,
    load,
    remove,
    currentBytes: null,
    currentMeta: null,
  };
  global.VCFCloudYXDB = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;

  if (typeof document === "undefined") return;
  if (!installUI()) {
    const observer = new MutationObserver(() => {
      if (installUI()) observer.disconnect();
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }
})(typeof window !== "undefined" ? window : globalThis);
