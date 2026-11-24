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

  // Verify the actual ABI budgets without needing a million-node position.
  const searchAPI = vm.runInContext("api", context);
  const originalDistance = searchAPI.findDistanceV1;
  const originalFull = searchAPI.findModeV3;
  const budgets = [];
  searchAPI.findDistanceV1 = (...args) => {
    budgets.push([args[4], args[6]]);
    return originalDistance(...args);
  };
  searchAPI.findModeV3 = (...args) => {
    budgets.push(["full", args[8]]);
    return originalFull(...args);
  };
  try {
    for (const [maxNode, expected] of [
      [200000000, [[0, 10000000], [1, 20000000], [2, 40000000], ["full", 200000000]]],
      [20000000, [[0, 10000000], [1, 20000000], [2, 40000000], ["full", 20000000]]],
      [25000, [[0, 10000000], [1, 20000000], [2, 40000000], ["full", 25000]]],
    ]) {
      budgets.length = 0;
      await call("findVCF", {
        arr: new Array(225).fill(0), color: 1, rules: 2, mode: "single",
        distanceLimited: true, ttExponent: 20, maxDepth: 11, maxNode,
      });
      if (JSON.stringify(budgets) !== JSON.stringify(expected)) {
        throw new Error(`distance search budget mismatch: ${JSON.stringify(budgets)}`);
      }
    }
  } finally {
    searchAPI.findDistanceV1 = originalDistance;
    searchAPI.findModeV3 = originalFull;
  }

  // Stop at a stage boundary; no subsequent phase or full DFS may run.
  const cooperativeApi = vm.runInContext("api", context);
  const originalAsyncDistance = cooperativeApi.findDistanceV1Async;
  const originalAsyncFull = cooperativeApi.findModeV3Async;
  const stoppedPhases = [];
  cooperativeApi.findDistanceV1Async = async (...args) => {
    stoppedPhases.push(args[4]);
    const result = await originalAsyncDistance(...args);
    context.self.onmessage({ data: { type: "stopSingle", data: { requestId: stopId } } });
    return result;
  };
  cooperativeApi.findModeV3Async = async (...args) => {
    stoppedPhases.push("full");
    return originalAsyncFull(...args);
  };
  const stopId = nextId;
  try {
    const stopped = await call("findVCF", {
      arr: new Array(225).fill(0), color: 1, rules: 2, mode: "single",
      distanceLimited: true, cooperativeStop: true, maxDepth: 11, maxNode: 20000000,
    });
    if (!stopped.manualStopped || !stopped.aborted || stopped.vcfCount ||
        stopped.searchAttempts.length !== 1 || JSON.stringify(stoppedPhases) !== "[0]" ||
        stopped.searchDiagnostics.countedNodes !== stopped.nodeCount ||
        stopped.searchDiagnostics.rootNodes.reduce((n, x) => n + x.nodes, 0) !== stopped.nodeCount) {
      throw new Error("cooperative cancellation lost statistics or continued another phase");
    }
  } finally {
    cooperativeApi.findDistanceV1Async = originalAsyncDistance;
    cooperativeApi.findModeV3Async = originalAsyncFull;
  }
  const afterStop = await call("findVCF", {
    arr: singleBoard, color: 1, rules: 2, mode: "single",
    cooperativeStop: true, maxDepth: 11, maxNode: 25000,
  });
  if (!afterStop.vcfCount || afterStop.manualStopped) {
    throw new Error("cooperative stop leaked into a subsequent search");
  }

  // Exercise the real Wasm checkpoint on a dense, difficult 41+41 position.
  // Do not mock the engine or inject the stop flag directly.
  const hardBlack = "G15 J15 O15 B14 F14 L14 M14 A13 G13 J12 M12 O12 P12 P11 C10 H10 P9 A8 C8 H8 N8 F7 P7 A6 L6 L5 A4 C4 K4 O4 F3 B2 C2 F2 L2 N2 O2 E1 G1 J1 O1".split(" ");
  const hardWhite = "A15 D15 F15 M15 N15 A14 C14 E14 H14 K14 C13 D13 L13 A12 A11 K11 A10 K10 A9 G8 K8 L7 M7 B6 C6 F6 H6 K6 B5 M5 G4 P4 D3 J3 K3 H2 J2 P2 B1 M1 N1".split(" ");
  let checkpointChecked = false;
  for (const mirror of [false, true]) {
    const hardBoard = new Array(225).fill(0);
    for (const [color, stones] of [[1, hardBlack], [2, hardWhite]]) {
      for (const point of stones) {
        const x = "ABCDEFGHJKLMNOP".indexOf(point[0]);
        const y = 15 - Number(point.slice(1));
        hardBoard[y * 15 + (mirror ? 14 - x : x)] = color;
      }
    }
    const hardId = nextId;
    const hardResult = call("findVCF", {
      arr: hardBoard, color: 1, rules: 2, mode: "single",
      cooperativeStop: true, ttExponent: 18, maxDepth: 200, maxNode: 2000001,
    });
    const stopTimer = setTimeout(() => context.self.onmessage({
      data: { type: "stopSingle", data: { requestId: hardId } },
    }), 0);
    let stopped;
    try { stopped = await hardResult; }
    finally { clearTimeout(stopTimer); }
    if (stopped.nodeCount < 2000000 && !stopped.aborted) continue;
    const diag = stopped.searchDiagnostics;
    if (!stopped.manualStopped || !stopped.aborted || stopped.vcfCount ||
        stopped.nodeCount !== 2000000 || diag.countedNodes !== stopped.nodeCount ||
        diag.rootNodes.reduce((n, x) => n + x.nodes, 0) !== stopped.nodeCount ||
        diag.depthNodes.reduce((n, x) => n + x.nodes, 0) !== stopped.nodeCount) {
      throw new Error("real 2M-node cooperative stop lost diagnostics: " +
        JSON.stringify({ nodes: stopped.nodeCount, aborted: stopped.aborted, manualStopped: stopped.manualStopped }));
    }
    checkpointChecked = true;
    break;
  }
  if (!checkpointChecked) throw new Error("hard position did not reach the real 2M-node checkpoint");

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
