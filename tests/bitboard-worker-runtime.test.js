"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { performance } = require("perf_hooks");
const { pathToFileURL, fileURLToPath } = require("url");

const root = path.resolve(__dirname, "..");
const engineDir = path.resolve(process.env.VCF_BITBOARD_ENGINE_DIR || path.join(root, "rapfi/engine"));
const engineScript = path.join(engineDir, "vcf-bitboard-engine.js");
if (!fs.existsSync(engineScript)) throw new Error(`missing built Bitboard engine: ${engineScript}`);

const callbacks = new Map();
const context = {
  console, performance, URL, Uint8Array, Uint16Array, Uint32Array, DataView,
  ArrayBuffer, Math, Number, Boolean, String, Set, Map, Promise, Error, Object,
  Array, parseInt, setTimeout, clearTimeout,
};
context.self = context;
context.self.postMessage = message => callbacks.get(message.id)?.(message);
context.self.importScripts = url => {
  context.self.VCFBitboardModule = require(fileURLToPath(url));
};
vm.createContext(context);
vm.runInContext(
  fs.readFileSync(path.join(root, "rapfi/vcf-bitboard-worker.js"), "utf8"),
  context,
  { filename: "vcf-bitboard-worker.js" },
);

let nextId = 1;
async function call(type, data) {
  const id = nextId++;
  const response = new Promise(resolve => callbacks.set(id, resolve));
  context.self.onmessage({ data: { id, type, data } });
  const message = await response;
  callbacks.delete(id);
  if (!message.ok) throw new Error(message.error || `${type} failed`);
  return message.result;
}

function normalized(result) {
  const copy = { ...result };
  delete copy.elapsedMs;
  delete copy.nodesPerSecond;
  return copy;
}

(async () => {
  const initialized = await call("init", {
    moduleURL: pathToFileURL(engineScript).href,
    runSmokeCheck: true,
  });
  if (initialized.selfTest !== 0 || initialized.selfTestMode !== "smoke") {
    throw new Error(`unexpected runtime smoke result: ${JSON.stringify(initialized)}`);
  }
  if (initialized.searchV2SelfTest !== "ci-only") {
    throw new Error("full search self-test is not CI-only");
  }

  await call("setGameRules", { rules: 0 });
  const freeBoard = new Array(225).fill(0);
  for (const [idx, color] of [[111, 1], [112, 1], [113, 1], [114, 1], [110, 2]]) freeBoard[idx] = color;
  const request = { arr: freeBoard, color: 1, maxVCF: 4, mode: "multi", maxDepth: 15, maxNode: 250000 };
  const implicitFree = normalized(await call("findVCF", request));
  const explicitFree = normalized(await call("findVCF", { ...request, rules: 0 }));
  if (JSON.stringify(implicitFree) !== JSON.stringify(explicitFree)) {
    throw new Error("Worker current rule does not preserve free-rule value 0");
  }

  const catchFoul = new Array(225).fill(0);
  for (let x = 0; x <= 3; x++) catchFoul[7 * 15 + x] = 1;
  catchFoul[7 * 15 + 5] = 1;
  catchFoul[2 * 15 + 4] = 1;
  for (let y = 3; y <= 5; y++) catchFoul[y * 15 + 4] = 2;
  const defense = await call("getBlockVCF", {
    arr: catchFoul,
    color: 2,
    rules: 2,
    vcfMoves: [6 * 15 + 4],
    maxNode: 100000,
    includeFour: true,
  });
  if (defense.candidateMode !== "legacy-bruteforce" || JSON.stringify(defense.points) !== "[94]") {
    throw new Error(`fallback defense result changed: ${JSON.stringify(defense)}`);
  }
  if (defense.nodeCount !== 2 || defense.aborted) {
    throw new Error(`fallback successful validation was recomputed or aborted: ${JSON.stringify(defense)}`);
  }

  console.log("Bitboard Worker runtime regressions passed");
})().catch(error => {
  console.error(error);
  process.exit(1);
});
