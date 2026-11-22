"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const FiveDB = require("../rapfi/5db-format.js");
const source = fs.readFileSync(path.join(__dirname, "../rapfi/vcf-batch-benchmark.js"), "utf8");

const start = source.indexOf("  const COLS = ");
const end = source.indexOf("  function currentItems()", start);
assert.ok(start > 0 && end > start, "pure batch puzzle converter must be identifiable");
const { normalizePuzzles, puzzleToDocument } = new Function(
  "global", source.slice(start, end) + "\nreturn { normalizePuzzles, puzzleToDocument };"
)({ FiveDB });

const sourcePuzzle = {
  no: 1, title: "花火", section: "一般案", author: "坂田吾朗",
  first: "黑先", black: ["K12", "P15"], white: ["A1", "H8"], moves: 21,
};
const items = normalizePuzzles({ puzzles: [sourcePuzzle] });
assert.equal(items.length, 1);
assert.equal(items[0].fileName, "夢幻の構想-001");
assert.equal(items[0].answerMoves, 21);
const doc = items[0].doc;
assert.equal(doc.title, "第 001 題｜花火｜一般案｜坂田吾朗");
assert.equal(doc.mode, "puzzle");
assert.equal(doc.phase, "setup");
assert.equal(doc.board[3 * 15 + 9], 1, "K12 coordinates respect 15-bottom notation");
assert.equal(doc.board[14], 1, "P15 is top right");
assert.equal(doc.board[14 * 15], 2, "A1 is bottom left");
assert.equal(doc.board[7 * 15 + 7], 2, "H8 is center");
assert.deepEqual(doc.currentPath, []);
assert.equal(doc.root.children.length, 0, "reference answer must never be preloaded");
const restored = FiveDB.decode(FiveDB.encode(doc));
assert.deepEqual(restored, doc, "5DB binary must roundtrip title, board and side");
const whiteDoc = puzzleToDocument({ ...sourcePuzzle, no: 2, title: null, first: "白先" });
assert.equal(whiteDoc.nextSide, 2);
assert.match(whiteDoc.title, /無題/);
assert.throws(() => normalizePuzzles({ puzzles: [sourcePuzzle, sourcePuzzle] }), /重複/);
assert.throws(() => puzzleToDocument({ ...sourcePuzzle, white: ["K12"] }), /重複落點/);
assert.throws(() => puzzleToDocument({ ...sourcePuzzle, black: ["I8"] }), /座標不合法/);
assert.throws(() => normalizePuzzles({ puzzles: Array(1001).fill(sourcePuzzle) }), /1000/);
for (const name of ["vcf-batch-run", "vcf-batch-upload", "vcf-batch-cloud", "vcf-batch-csv"]) {
  assert.ok(fs.readFileSync(path.join(__dirname, "../index.html"), "utf8").includes('id="' + name + '"'));
}
assert.ok(source.includes('new Worker(asset("rapfi/vcf-bitboard-worker.js"))'), "batch uses independent worker");
assert.ok(source.includes("cloud.saveDocument(item.doc, item.fileName)"), "cloud imports private 5DB");
assert.ok(!source.includes("puzzles: ["), "never bundle source book puzzles");
console.log("Private batch JSON->5DB conversion, side, title, coordinates and isolated benchmark passed");
