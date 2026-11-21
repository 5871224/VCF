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

  // Observability-only ABI: exact node totals must match the existing engine.
  const singleBoard = new Array(225).fill(0);
  for (const x of [5, 6, 7]) singleBoard[7 * 15 + x] = 1;
  const singleResult = await call("findVCF", {
    arr: singleBoard, color: 1, rules: 2, mode: "single",
    maxDepth: 11, maxNode: 25000,
  });
  const diagnostics = singleResult.searchDiagnostics;
  if (!diagnostics || diagnostics.version !== 1) {
    throw new Error("single VCF search diagnostics ABI is unavailable");
  }
  if (diagnostics.countedNodes !== singleResult.nodeCount
      || diagnostics.hits > diagnostics.probes
      || diagnostics.replacements > diagnostics.writes
      || diagnostics.depthNodes.reduce((total, item) => total + item.nodes, 0) !== singleResult.nodeCount
      || diagnostics.rootNodes.reduce((total, item) => total + item.nodes, 0) !== singleResult.nodeCount) {
    throw new Error("single VCF diagnostics counters are inconsistent");
  }

  // Identical tactical position must give the same answer across 2^18..2^22.
  let sameVCF = null;
  for (const exponent of [18, 19, 20, 21, 22, 20]) {
    const result = await call("findVCF", {
      arr: singleBoard, color: 1, rules: 2, mode: "single",
      ttExponent: exponent, maxDepth: 11, maxNode: 25000,
    });
    if (result.searchDiagnostics?.ttExponent !== exponent ||
        result.searchDiagnostics?.countedNodes !== result.nodeCount) {
      throw new Error(`2^${exponent} diagnostic mismatch`);
    }
    const route = JSON.stringify(result.winMoves);
    if (sameVCF !== null && route !== sameVCF) {
      throw new Error(`2^${exponent} changed VCF route`);
    }
    sameVCF = route;
  }
  let rejectedExponent = false;
  try {
    await call("findVCF", {
      arr: singleBoard, color: 1, rules: 2, mode: "single",
      ttExponent: 23, maxDepth: 11, maxNode: 25000,
    });
  } catch (error) {
    rejectedExponent = /18～22/.test(String(error.message));
  }
  if (!rejectedExponent) throw new Error("invalid transposition table exponent was accepted");

  // The opt-in distance mode must leave the original single mode intact.
  // The merged diagnosis must account for every distance probe and fallback.
  const distanceResult = await call("findVCF", {
    arr: singleBoard, color: 1, rules: 2, mode: "single",
    distanceLimited: true, ttExponent: 20, maxDepth: 11, maxNode: 25000,
  });
  const distanceDiag = distanceResult.searchDiagnostics;
  if (!distanceResult.distanceLimited || !distanceResult.searchAttempts?.length
      || !distanceResult.vcfCount || !distanceResult.winMoves[0]?.length
      || distanceDiag.countedNodes !== distanceResult.nodeCount
      || distanceDiag.hits > distanceDiag.probes
      || distanceDiag.depthNodes.reduce((n, x) => n + x.nodes, 0) !== distanceResult.nodeCount
      || distanceDiag.rootNodes.reduce((n, x) => n + x.nodes, 0) !== distanceResult.nodeCount
      || distanceResult.searchAttempts.reduce((n, x) => n + x.nodes, 0) !== distanceResult.nodeCount) {
    throw new Error("distance-limited single VCF probe or aggregate diagnostics mismatch");
  }
  const distanceValid = await call("isVCF", {
    arr: singleBoard, color: 1, rules: 2, moves: distanceResult.winMoves[0],
    maxNode: 200000,
  });
  if (!distanceValid.valid) throw new Error("distance-limited VCF proof failed validation");

  const emptyDistance = await call("findVCF", {
    arr: new Array(225).fill(0), color: 1, rules: 2, mode: "single",
    distanceLimited: true, ttExponent: 20, maxDepth: 11, maxNode: 25000,
  });
  if (emptyDistance.vcfCount !== 0 || emptyDistance.aborted ||
      emptyDistance.searchAttempts?.length !== 4 ||
      emptyDistance.searchAttempts.at(-1)?.name !== "原始完整 DFS" ||
      emptyDistance.nodeCount !== emptyDistance.searchDiagnostics.countedNodes) {
    throw new Error("distance probe did not fall back to the exhaustive single VCF engine");
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
