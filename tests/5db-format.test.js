"use strict";
const assert = require("node:assert/strict");
const { encode, decode, validate } = require("../rapfi/5db-format.js");
const root = {
  move: -1, stone: 0, text: "原始方向", marks: [
    { type: "circle", x: 1, y: 2, color: 0, filled: true },
    { type: "text", x: 2, y: 2, color: 1, text: "甲" },
    { type: "line", x: 0, y: 0, tx: 5, ty: 6, color: 3 },
    { type: "arrow", x: 4, y: 4, tx: 1, ty: 2, color: 6 },
  ], children: [
    { move: 0, stone: 1, text: "分支A", marks: [], children: [{ move: 1, stone: 1, text: "連續黑棋", marks: [], children: [] }] },
    { move: 4, stone: 2, text: "分支B", marks: [], children: [] },
  ],
};
const doc = {
  width: 9, height: 9, mode: "puzzle", nextSide: 2, title: "題目 5DB",
  board: Array(81).fill(0), currentPath: [0, 0], root,
};
doc.board[10] = 1;
doc.board[11] = 1;
doc.board[12] = 1;
doc.board[20] = 2;
const bytes = encode(doc);
assert.equal(Buffer.from(bytes.subarray(0,4)).toString(), "5DB1");
const loaded = decode(bytes);
assert.deepEqual(loaded, doc);
assert.equal(validate(loaded).nodeCount, 4);
assert.deepEqual(encode(loaded), bytes, "encode should be deterministic");
const mirrored = structuredClone(doc);
mirrored.board[10] = 0;
mirrored.board[18] = 1;
assert.notDeepEqual(encode(mirrored), bytes, "5DB must never canonicalize a board");
const blank = { ...doc, board: Array(81).fill(0), currentPath: [], root: { move: -1, stone: 0, text: "", marks: [], children: [] } };
assert.deepEqual(decode(encode(blank)), blank, "empty roots must roundtrip");
const sizes = [[5,5], [13,13], [15,15], [19,19], [255,255]];
for (const [width, height] of sizes) {
  const sample = { ...blank, width, height, board: Array(width * height).fill(0) };
  assert.deepEqual(decode(encode(sample)), sample);
}
const corrupt = Uint8Array.from(bytes);
corrupt[corrupt.length-1] ^= 1;
assert.throws(() => decode(corrupt), /校驗碼/);
assert.throws(() => decode(new Uint8Array([86,67,70,68,66,1,0,0])), /5DB/);
assert.throws(() => encode({ ...doc, currentPath: [3] }), /目前路線/);
assert.throws(() => encode({ ...doc, root: { ...doc.root, children: [
  { move: 0, stone: 1, children: [], marks: [] },
  { move: 0, stone: 2, children: [], marks: [] },
] }}), /重複落點/);
console.log("5DB binary codec: setup, direct coordinates, branches, non-alternating stones, markers, dimensions, integrity passed");
