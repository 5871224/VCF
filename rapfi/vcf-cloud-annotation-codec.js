"use strict";
// Store VCF-only static marks in a valid Rapfi YXDB record's text field.
// The server continues to accept an ordinary LZ4-framed YXDB with no API/schema changes.
(function initCloudAnnotationCodec(global) {
  const PREFIX = "\u001eVCF-CLOUD-MARKS-V1:";
  const SUFFIX = "\u001e";
  const MAX_RAW = 64 * 1024 * 1024;
  const MAX_JSON = 8 * 1024 * 1024;
  const te = new TextEncoder();
  const td = new TextDecoder("utf-8", { fatal: true });

  const u16 = (v, o) => v[o] | (v[o+1] << 8);
  const u32 = (v, o) => (v[o] | (v[o+1]<<8) | (v[o+2]<<16) | (v[o+3]<<24)) >>> 0;
  const put16 = (v, o, n) => { v[o] = n & 255; v[o+1] = (n >>> 8) & 255; };

  function scan(raw) {
    const bytes = raw instanceof Uint8Array ? raw : new Uint8Array(raw || 0);
    if (bytes.length < 4 || bytes.length > MAX_RAW) throw new Error("YXDB 大小不正確");
    const count = u32(bytes, 0);
    if (!count || count > 10000000) throw new Error("YXDB 局面數量不正確");
    const records = [];
    let cursor = 4;
    for (let i=0; i<count; i++) {
      if (cursor + 2 > bytes.length) throw new Error("YXDB key 長度已截斷");
      const keyLen = u16(bytes, cursor); cursor += 2;
      const keyStart = cursor;
      if (keyLen < 3 || cursor + keyLen + 2 > bytes.length) throw new Error("YXDB key 格式錯誤");
      cursor += keyLen;
      const valueLenOffset = cursor;
      const valueLen = u16(bytes, cursor); cursor += 2;
      if (valueLen < 5 || cursor + valueLen > bytes.length) throw new Error("YXDB record 格式錯誤");
      records.push({ keyStart, keyLen, valueLenOffset, valueStart: cursor, valueLen, end: cursor + valueLen });
      cursor += valueLen;
    }
    if (cursor !== bytes.length) throw new Error("YXDB 含有非預期的尾端資料");
    return { bytes, records };
  }

  function replaceText(bytes, record, text) {
    const encoded = te.encode(text);
    const nextValueLen = 5 + encoded.length;
    if (nextValueLen > 65535) throw new Error("雲端標記資料過多，超過單筆 YXDB 文字欄位上限；可改用 .vcfdb 本機匯出");
    const oldTextLen = record.valueLen - 5;
    const out = new Uint8Array(bytes.length - oldTextLen + encoded.length);
    const offset = record.valueStart + 5;
    out.set(bytes.subarray(0, offset), 0);
    put16(out, record.valueLenOffset, nextValueLen);
    out.set(encoded, offset);
    out.set(bytes.subarray(record.end), offset + encoded.length);
    return out;
  }

  function base64(bytes) {
    let binary = "";
    for (let offset=0; offset<bytes.length; offset+=8192)
      binary += String.fromCharCode(...bytes.subarray(offset, offset+8192));
    return global.btoa(binary);
  }
  function unbase64(value) {
    const binary = global.atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let i=0; i<binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  async function zip(bytes) {
    if (typeof global.CompressionStream !== "function") return { mode: "J", data: bytes };
    const stream = new Blob([bytes]).stream().pipeThrough(new global.CompressionStream("gzip"));
    return { mode: "G", data: new Uint8Array(await new Response(stream).arrayBuffer()) };
  }

  async function unzip(bytes, mode) {
    if (mode === "J") {
      if (bytes.length > MAX_JSON) throw new Error("雲端標記內容過大");
      return bytes;
    }
    if (mode !== "G" || typeof global.DecompressionStream !== "function") throw new Error("瀏覽器不支援此雲端標記壓縮格式");
    const reader = new Blob([bytes]).stream().pipeThrough(new global.DecompressionStream("gzip")).getReader();
    const parts = [];
    let total = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > MAX_JSON) { await reader.cancel(); throw new Error("雲端標記解壓縮資料過大"); }
      parts.push(value);
    }
    const output = new Uint8Array(total);
    let cursor = 0;
    for (const part of parts) { output.set(part, cursor); cursor += part.length; }
    return output;
  }

  function suffixMatch(text) {
    const start = text.lastIndexOf(PREFIX);
    if (start < 0) return null;
    const encoded = text.slice(start + PREFIX.length);
    const match = /^([JG]):([A-Za-z0-9+/]+={0,2})\u001e$/.exec(encoded);
    if (!match) throw new Error("雲端 YXDB 標記欄位損毀");
    return { start, mode: match[1], encoded: match[2] };
  }

  async function embed(raw, data) {
    const { bytes, records } = scan(raw);
    if (!data || data.version !== 1 || !data.annotations || !Array.isArray(data.history)
      || !Number.isInteger(data.basePly) || data.basePly < 0 || data.basePly > data.history.length
      || data.history.length > 225 || !data.history.every(i => Number.isInteger(i) && i >= 0 && i < 225)) {
      throw new Error("雲端棋譜標記資訊不正確");
    }
    const root = records.find(r => r.keyLen === 3 && bytes[r.keyStart+1] === 15 && bytes[r.keyStart+2] === 15)
      || records.find(r => bytes[r.keyStart+1] === 15 && bytes[r.keyStart+2] === 15);
    if (!root) throw new Error("YXDB 找不到可存標記的局面");
    const text = td.decode(bytes.subarray(root.valueStart + 5, root.end));
    if (text.includes(PREFIX)) throw new Error("YXDB 已經包含 VCF 雲端標記，不能重複包裝");
    const plain = te.encode(JSON.stringify({ format: "vcf-cloud-marks-v1", ...data }));
    if (plain.length > MAX_JSON) throw new Error("雲端標記資料過大");
    const { mode, data: packed } = await zip(plain);
    return replaceText(bytes, root, text + PREFIX + mode + ":" + base64(packed) + SUFFIX);
  }

  async function extract(raw) {
    const { bytes, records } = scan(raw);
    let matched = null;
    for (const record of records) {
      if (record.keyLen < 3 || bytes[record.keyStart+1] !== 15 || bytes[record.keyStart+2] !== 15) continue;
      const text = td.decode(bytes.subarray(record.valueStart+5, record.end));
      const match = suffixMatch(text);
      if (!match) continue;
      if (matched) throw new Error("YXDB 出現多份 VCF 標記資料");
      matched = { record, text, match };
    }
    if (!matched) return { bytes, metadata: null };
    const { record, text, match } = matched;
    let metadata;
    try { metadata = JSON.parse(td.decode(await unzip(unbase64(match.encoded), match.mode))); }
    catch (error) { throw new Error("雲端標記資料無法解析：" + (error?.message || error)); }
    if (metadata.format !== "vcf-cloud-marks-v1" || metadata.version !== 1
      || !metadata.annotations || typeof metadata.annotations !== "object" || Array.isArray(metadata.annotations)
      || !Array.isArray(metadata.history) || metadata.history.length > 225
      || !metadata.history.every(i => Number.isInteger(i) && i >= 0 && i < 225)
      || !Number.isInteger(metadata.basePly) || metadata.basePly < 0 || metadata.basePly > metadata.history.length) {
      throw new Error("YXDB 內含不支援的雲端標記版本或路線");
    }
    return { bytes: replaceText(bytes, record, text.slice(0, match.start)), metadata };
  }

  const api = Object.freeze({ embed, extract, scan });
  global.VCFCloudAnnotationCodec = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
