"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

// Execute the real VCFEngine facade from index.html instead of maintaining
// another copy of its request forwarding code in this regression test.
const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const start = html.indexOf("class VCFEngine {");
const end = html.indexOf("// Worker Pool — parallel getLevelPoints", start);
assert.ok(start >= 0 && end > start, "VCFEngine facade not found in index.html");
// Trim the preceding section divider to avoid evaluating the WorkerPool class.
const source = html.slice(start, end);
const calls = [];
const context = {
  window: {
    engineAPI: {
      async send(command, param) {
        calls.push({ command, param });
        return command === "findVCF" ? { winMoves: [[1, 2, 3]] } : true;
      },
    },
  },
};
vm.createContext(context);
vm.runInContext(source + "\nthis.ExportedVCFEngine = VCFEngine;", context, {
  filename: "VCFEngine-from-index.html",
});

(async () => {
  const engine = new context.ExportedVCFEngine();
  await engine._initP;
  assert.equal(calls[0].command, "setGameRules");

  const board = Array(225).fill(0);
  const result = await engine.findVCF({
    arr: board, color: 1, mode: "single", maxVCF: 1,
    maxDepth: 200, maxNode: 30_000_000, ttExponent: 22,
    simplify: true, pruning: "strict", distanceLimited: true,
  });
  assert.equal(result.winMoves.length, 1);
  const forwarded = calls.at(-1);
  assert.equal(forwarded.command, "findVCF");
  assert.equal(forwarded.param.distanceLimited, true,
    "distance-limited checkbox option was silently dropped");
  assert.equal(forwarded.param.ttExponent, 22);
  assert.equal(forwarded.param.simplify, true);
  assert.equal(forwarded.param.pruning, "strict");
  assert.equal(forwarded.param.mode, "single");
  assert.equal(forwarded.param.maxDepth, 200);
  assert.equal(forwarded.param.maxNode, 30_000_000);
  assert.deepEqual(Array.from(forwarded.param.arr), board);

  // Existing callers that supply only a board and a color retain defaults.
  await engine.findVCF({ arr: board, color: 2 });
  const defaults = calls.at(-1).param;
  assert.equal(defaults.color, 2);
  assert.equal(defaults.maxVCF, 1);
  assert.equal(defaults.maxDepth, 200);
  assert.equal(defaults.maxNode, 5_000_000);
  assert.equal(defaults.distanceLimited, undefined);

  console.log("VCFEngine facade request forwarding regressions passed");
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
