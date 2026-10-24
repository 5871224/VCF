"use strict";
// 5DB 1.0: original-coordinate game tree; no rule, author, view angle,
// position canonicalization, or legacy format decoding.
(function install5DB(global) {
  const MAGIC = [0x35, 0x44, 0x42, 0x31]; // "5DB1"
  const HEADER = 20;
  const MAX_SIZE = 64 * 1024 * 1024;
  const MAX_NODES = 100000;
  const MAX_MARKS = 50000;
  const te = new TextEncoder();
  const td = new TextDecoder("utf-8", { fatal: true });
  const validSide = v => v === 1 || v === 2;
  function check(ok, message) { if (!ok) throw new Error("5DB：" + message); }
  function checksum(bytes) {
    let hash = 2166136261;
    for (const v of bytes) hash = Math.imul(hash ^ v, 16777619) >>> 0;
    return hash >>> 0;
  }
  class Writer {
    constructor() { this.buffer = new Uint8Array(1024); this.end = 0; }
    ensure(n) {
      check(this.end + n <= MAX_SIZE, "檔案超過 64 MB");
      if (this.end + n <= this.buffer.length) return;
      let capacity = this.buffer.length;
      while (capacity < this.end + n) capacity *= 2;
      const next = new Uint8Array(capacity);
      next.set(this.buffer); this.buffer = next;
    }
    u8(v) { this.ensure(1); this.buffer[this.end++] = v; }
    u16(v) { this.u8(v & 255); this.u8(v >>> 8 & 255); }
    u32(v) { this.u16(v & 65535); this.u16(v >>> 16 & 65535); }
    varint(v) {
      check(Number.isSafeInteger(v) && v >= 0 && v <= MAX_SIZE, "整數超出範圍");
      while (v >= 128) { this.u8((v & 127) | 128); v = Math.floor(v / 128); }
      this.u8(v);
    }
    bytes(bytes) { this.ensure(bytes.length); this.buffer.set(bytes, this.end); this.end += bytes.length; }
    text(value, max) {
      const data = te.encode(String(value || ""));
      check(data.length <= max, "文字內容過長");
      this.varint(data.length); this.bytes(data);
    }
    finish() { return this.buffer.slice(0, this.end); }
  }
  class Reader {
    constructor(bytes) { this.bytes = bytes; this.at = 0; }
    require(n) { check(n >= 0 && this.at + n <= this.bytes.length, "資料截斷"); }
    u8() { this.require(1); return this.bytes[this.at++]; }
    u16() { return this.u8() | this.u8() << 8; }
    u32() { return (this.u16() | this.u16() << 16) >>> 0; }
    varint() {
      let value = 0, mul = 1;
      for (let i = 0; i < 5; i++) {
        const b = this.u8(); value += (b & 127) * mul;
        check(value <= MAX_SIZE, "整數超出範圍");
        if (!(b & 128)) return value;
        mul *= 128;
      }
      throw new Error("5DB：可變長整數錯誤");
    }
    bytesN(n) { this.require(n); const v = this.bytes.subarray(this.at, this.at + n); this.at += n; return v; }
    text(max) { const n = this.varint(); check(n <= max, "文字內容過長"); return td.decode(this.bytesN(n)); }
  }
  const TYPES = { circle: 1, text: 2, line: 3, arrow: 4 };
  const TYPE_NAMES = ["", "circle", "text", "line", "arrow"];
  function checkMark(mark, width, height) {
    check(mark && TYPES[mark.type] && Number.isInteger(mark.x) && mark.x >= 0 && mark.x < width
      && Number.isInteger(mark.y) && mark.y >= 0 && mark.y < height
      && Number.isInteger(mark.color) && mark.color >= 0 && mark.color < 10, "標記內容不合法");
    if (mark.type === "line" || mark.type === "arrow") {
      check(Number.isInteger(mark.tx) && mark.tx >= 0 && mark.tx < width
        && Number.isInteger(mark.ty) && mark.ty >= 0 && mark.ty < height
        && (mark.tx !== mark.x || mark.ty !== mark.y), "連線座標不合法");
    } else if (mark.type === "text") {
      check(Array.from(String(mark.text || "")).length === 1, "文字標記必須是單一字元");
    }
  }
  function validate(doc) {
    check(doc && typeof doc === "object", "文件內容錯誤");
    const width = doc.width, height = doc.height;
    check(Number.isInteger(width) && width >= 1 && width <= 255
      && Number.isInteger(height) && height >= 1 && height <= 255, "棋盤尺寸不合法");
    check(doc.mode === "record" || doc.mode === "puzzle", "工作模式不合法");
    check(doc.phase == null || (doc.mode === "puzzle" && doc.phase === "setup"), "題目編輯階段不合法");
    if (doc.phase === "setup") {
      check(doc.currentPath.length === 0 && doc.root.children.length === 0, "擺盤階段不可包含解答分支");
    }
    check(validSide(doc.nextSide), "下一手顏色不合法");
    check(Array.isArray(doc.board) || ArrayBuffer.isView(doc.board), "初始盤面不合法");
    check(doc.board.length === width * height, "初始盤面尺寸不符");
    for (const stone of doc.board) check(stone === 0 || validSide(stone), "初始棋子顏色不合法");
    check(doc.root && typeof doc.root === "object" && Array.isArray(doc.root.children), "缺少棋譜樹");
    check(Array.isArray(doc.currentPath), "目前分支路線不合法");
    const stack = [{ node: doc.root, depth: 0, board: Uint8Array.from(doc.board) }];
    let nodeCount = 0, markCount = 0;
    const active = new Set();
    while (stack.length) {
      const { node, depth, board, exit } = stack.pop();
      if (exit) { active.delete(node); continue; }
      check(!active.has(node), "棋譜樹有循環");
      active.add(node); stack.push({ node, exit: true });
      check(++nodeCount <= MAX_NODES, "節點數超出上限");
      check(depth <= width * height + 1, "棋譜深度不合法");
      check(Array.isArray(node.children) && node.children.length <= width * height + 1, "分支數量不合法");
      check(typeof (node.text || "") === "string" && te.encode(node.text || "").length <= 100000, "註解不合法");
      check(Array.isArray(node.marks || []), "標記資料不合法");
      for (const mark of node.marks || []) { checkMark(mark, width, height); check(++markCount <= MAX_MARKS, "標記數量過多"); }
      if (depth === 0) {
        check((node.move == null || node.move === -1) && !node.stone, "根節點不合法");
      } else {
        check(Number.isInteger(node.move) && node.move >= -1 && node.move < width * height, "落子座標不合法");
        check(validSide(node.stone), "落子顏色不合法");
      }
      const seen = new Set();
      for (let i = node.children.length - 1; i >= 0; i--) {
        const child = node.children[i];
        check(child && Number.isInteger(child.move) && child.move >= -1 && child.move < width * height, "子節點落子錯誤");
        check(validSide(child.stone), "子節點棋子顏色不合法");
        check(!seen.has(child.move), "同一節點存在重複落點");
        seen.add(child.move);
        check(child.move < 0 || board[child.move] === 0, "棋子落在已佔用位置");
        const nextBoard = new Uint8Array(board);
        if (child.move >= 0) nextBoard[child.move] = child.stone;
        stack.push({ node: child, depth: depth + 1, board: nextBoard });
      }
    }
    check(doc.currentPath.length <= width * height + 1, "目前路線過長");
    let current = doc.root;
    for (const part of doc.currentPath) {
      check(Number.isInteger(part) && part >= 0 && part < current.children.length, "目前路線指向無效節點");
      current = current.children[part];
    }
    return { width, height, nodeCount, markCount };
  }
  // Compact saved-current-position snapshot used by the cloud list UI.
  // It preserves exact orientation and does not modify the game document.
  function preview(doc) {
    const { width, height } = validate(doc);
    const board = Array.from(doc.board);
    let node = doc.root;
    for (const branch of doc.currentPath) {
      node = node.children[branch];
      if (node.move >= 0) board[node.move] = node.stone;
    }
    return { width, height, board: board.join("") };
  }
  function encode(doc) {
    const { width, height, nodeCount } = validate(doc);
    const w = new Writer();
    w.text(doc.title || "", 2048);
    w.bytes(Uint8Array.from(doc.board));
    w.varint(doc.currentPath.length);
    for (const i of doc.currentPath) w.varint(i);
    w.varint(nodeCount);
    const stack = [doc.root];
    while (stack.length) {
      const node = stack.pop();
      w.u16(node.move == null || node.move < 0 ? 65535 : node.move);
      w.u8(node.stone || 0);
      w.text(node.text || "", 100000);
      const marks = node.marks || [];
      w.varint(marks.length);
      for (const m of marks) {
        w.u8(TYPES[m.type]); w.u8(m.x); w.u8(m.y); w.u8(m.color);
        if (m.type === "circle") w.u8(m.filled === true ? 1 : 0);
        else if (m.type === "text") w.text(m.text, 16);
        else { w.u8(m.tx); w.u8(m.ty); }
      }
      w.varint(node.children.length);
      for (let i = node.children.length - 1; i >= 0; i--) stack.push(node.children[i]);
    }
    const body = w.finish();
    const h = new Writer();
    for (const byte of MAGIC) h.u8(byte);
    // Mode 2 means a puzzle draft still in setup; legacy 0/1 bytes remain unchanged.
    h.u8(width); h.u8(height); h.u8(doc.mode === "record" ? 0 : doc.phase === "setup" ? 2 : 1); h.u8(doc.nextSide);
    h.u32(body.length); h.u32(checksum(body)); h.u32(nodeCount);
    h.bytes(body);
    return h.finish();
  }
  function decode(value) {
    const b = value instanceof Uint8Array ? value : new Uint8Array(value || 0);
    check(b.length >= HEADER && b.length <= MAX_SIZE, "檔案大小不合法");
    const r = new Reader(b);
    for (const byte of MAGIC) check(r.u8() === byte, "不是 5DB 1.0 檔案");
    const width = r.u8(), height = r.u8(), modeCode = r.u8(), nextSide = r.u8();
    check(modeCode <= 2, "5DB 工作模式代碼不合法");
    const mode = modeCode === 0 ? "record" : "puzzle";
    const bodySize = r.u32(), savedHash = r.u32(), nodeCount = r.u32();
    check(bodySize === b.length - HEADER && nodeCount >= 1 && nodeCount <= MAX_NODES, "檔案長度或節點數錯誤");
    check(checksum(b.subarray(HEADER)) === savedHash, "校驗碼不符");
    const data = new Reader(b.subarray(HEADER));
    const title = data.text(2048);
    check(width >= 1 && height >= 1, "棋盤大小錯誤");
    const board = Array.from(data.bytesN(width * height));
    const length = data.varint(), currentPath = [];
    check(length <= width * height + 1, "路線長度錯誤");
    for (let i = 0; i < length; i++) currentPath.push(data.varint());
    check(data.varint() === nodeCount, "節點數不一致");
    const readNode = () => {
      const move = data.u16(), stone = data.u8(), text = data.text(100000);
      const markCount = data.varint();
      check(markCount <= MAX_MARKS, "標記數量過多");
      const marks = [];
      for (let i = 0; i < markCount; i++) {
        const type = TYPE_NAMES[data.u8()], x = data.u8(), y = data.u8(), color = data.u8();
        check(type, "標記類型錯誤");
        const mark = { type, x, y, color };
        if (type === "circle") mark.filled = data.u8() === 1;
        else if (type === "text") mark.text = data.text(16);
        else { mark.tx = data.u8(); mark.ty = data.u8(); }
        marks.push(mark);
      }
      const childrenCount = data.varint();
      check(childrenCount <= width * height + 1, "分支數量過多");
      return { node: { move: move === 65535 ? -1 : move, stone, text, marks, children: [] }, childrenCount };
    };
    const { node: root, childrenCount } = readNode();
    const stack = [{ node: root, remaining: childrenCount }];
    let readCount = 1;
    while (stack.length) {
      const frame = stack[stack.length - 1];
      if (!frame.remaining) { stack.pop(); continue; }
      frame.remaining--;
      check(++readCount <= nodeCount, "節點數異常");
      const child = readNode();
      frame.node.children.push(child.node);
      stack.push({ node: child.node, remaining: child.childrenCount });
    }
    check(readCount === nodeCount && data.at === data.bytes.length, "尾端資料異常");
    const doc = { width, height, mode, nextSide, title, board, currentPath, root };
    if (modeCode === 2) doc.phase = "setup";
    validate(doc);
    return doc;
  }
  const api = Object.freeze({ encode, decode, validate, preview });
  global.FiveDB = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
