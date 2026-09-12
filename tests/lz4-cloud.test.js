"use strict";

const assert = require("node:assert/strict");
const {
  xxhash32,
  createLZ4Frame,
  buildRawYXDBFromTree,
} = require("../rapfi/vcf-lz4-cloud.js");

function readU32LE(bytes, offset) {
  return (bytes[offset]
    | (bytes[offset + 1] << 8)
    | (bytes[offset + 2] << 16)
    | (bytes[offset + 3] << 24)) >>> 0;
}

function decodeBlock(block, expectedMax = 64 * 1024) {
  const out = new Uint8Array(expectedMax);
  let ip = 0;
  let op = 0;
  while (ip < block.length) {
    const token = block[ip++];
    let literalLength = token >>> 4;
    if (literalLength === 15) {
      let value;
      do {
        value = block[ip++];
        literalLength += value;
      } while (value === 255);
    }
    out.set(block.subarray(ip, ip + literalLength), op);
    ip += literalLength;
    op += literalLength;
    if (ip >= block.length) break;
    const offset = block[ip] | (block[ip + 1] << 8);
    ip += 2;
    assert.ok(offset > 0 && offset <= op, "invalid LZ4 offset");
    let matchLength = (token & 0x0f) + 4;
    if ((token & 0x0f) === 15) {
      let value;
      do {
        value = block[ip++];
        matchLength += value;
      } while (value === 255);
    }
    const ref = op - offset;
    for (let i = 0; i < matchLength; i++) out[op++] = out[ref + i];
  }
  return out.slice(0, op);
}

function decodeFrame(frame) {
  assert.deepEqual(Array.from(frame.subarray(0, 4)), [0x04, 0x22, 0x4d, 0x18]);
  const flg = frame[4];
  const bd = frame[5];
  assert.equal(flg, 0x64);
  assert.equal(bd, 0x40);
  assert.equal(frame[6], (xxhash32(new Uint8Array([flg, bd])) >>> 8) & 0xff);
  let offset = 7;
  const chunks = [];
  let total = 0;
  while (true) {
    const sizeField = readU32LE(frame, offset);
    offset += 4;
    if (sizeField === 0) break;
    const uncompressed = Boolean(sizeField & 0x80000000);
    const size = sizeField & 0x7fffffff;
    const block = frame.subarray(offset, offset + size);
    offset += size;
    const decoded = uncompressed ? block.slice() : decodeBlock(block);
    chunks.push(decoded);
    total += decoded.length;
  }
  const raw = new Uint8Array(total);
  let out = 0;
  for (const chunk of chunks) {
    raw.set(chunk, out);
    out += chunk.length;
  }
  const checksum = readU32LE(frame, offset);
  assert.equal(checksum, xxhash32(raw));
  return raw;
}

function repetitiveData(size) {
  const source = new Uint8Array(size);
  const phrase = Buffer.from("VCF-RAPFI-YXDB-0123456789-", "ascii");
  for (let i = 0; i < source.length; i++) source[i] = phrase[i % phrase.length];
  return source;
}

{
  const raw = repetitiveData(180000);
  const frame = createLZ4Frame(raw);
  const decoded = decodeFrame(frame);
  assert.deepEqual(decoded, raw);
  assert.ok(frame.length < raw.length / 4, `expected compression, got ${frame.length}/${raw.length}`);
}

{
  const raw = new Uint8Array(130000);
  let value = 0x12345678;
  for (let i = 0; i < raw.length; i++) {
    value ^= value << 13;
    value ^= value >>> 17;
    value ^= value << 5;
    raw[i] = value & 0xff;
  }
  const frame = createLZ4Frame(raw);
  assert.deepEqual(decodeFrame(frame), raw);
}

{
  const tree = {
    move: null,
    stone: 0,
    recordText: "root",
    children: [
      {
        move: 112,
        stone: 1,
        recordText: "H8",
        children: [
          { move: 113, stone: 2, recordText: "I8", children: [] },
          { move: 97, stone: 2, recordText: "H7", children: [] },
        ],
      },
    ],
  };
  const built = buildRawYXDBFromTree(tree, 2);
  assert.equal(built.nodeCount, 3);
  // The two second-ply positions are rotations of each other around center H8,
  // so YXDB canonicalization intentionally merges them into one position.
  assert.equal(built.recordCount, 3);
  const frame = createLZ4Frame(built.raw);
  assert.deepEqual(decodeFrame(frame), built.raw);
}

console.log("lz4-cloud tests passed");
