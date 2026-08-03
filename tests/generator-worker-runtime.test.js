"use strict";

const fs = require("fs");
const vm = require("vm");

const calls = [];
const pruningSelect = { value: "fast", disabled: false };

class WorkerMock {
  constructor(url) {
    this.url = String(url);
    this.onmessage = null;
    this.onerror = null;
  }

  postMessage(message) {
    calls.push(message);
    let result = true;
    if (message.type === "findVCF") {
      result = { winMoves: [[1, 2, 3]], nodeCount: 3, aborted: false };
    } else if (message.type === "getBlockVCF") {
      result = { points: [4, 5], nodeCount: 2 };
    } else if (message.type === "trimVCFGroups") {
      result = message.data.groups;
    }
    queueMicrotask(() => this.onmessage?.({
      data: { id: message.id, ok: true, result },
    }));
  }

  terminate() {}
}

const source = fs.readFileSync("makevcf-generator-core.js", "utf8") +
  "\n;globalThis.__generatorTest = { genEngine, genSetBusy };";
const context = {
  console,
  URL,
  Worker: WorkerMock,
  Map,
  Array,
  Number,
  Error,
  Date,
  Object,
  Promise,
  Boolean,
  Math,
  queueMicrotask,
  setTimeout,
  localStorage: {
    getItem() { return null; },
  },
  document: {
    baseURI: "https://example.test/VCF/",
    getElementById(id) { return id === "vcf-multi-pruning" ? pruningSelect : null; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
  },
  window: {
    engineAPI: {
      send() { throw new Error("generator must use its dedicated worker"); },
      cancel() { throw new Error("generator must not cancel main engine"); },
    },
  },
};
context.globalThis = context;
vm.createContext(context);
vm.runInContext(source, context, { filename: "makevcf-generator-core.js" });

(async () => {
  const { genEngine: engine, genSetBusy } = context.__generatorTest;
  await engine.ready;
  if (engine.backend !== "bitboard-generator-worker") {
    throw new Error(`unexpected generator backend: ${engine.backend}`);
  }
  if (!engine.worker || !engine.worker.url.endsWith("/rapfi/vcf-bitboard-worker.js")) {
    throw new Error(`unexpected worker URL: ${engine.worker && engine.worker.url}`);
  }
  const initCall = calls.find(call => call.type === "init");
  if (!initCall?.data?.moduleURL?.endsWith("/rapfi/engine/vcf-bitboard-engine.js")) {
    throw new Error(`unexpected module URL: ${initCall?.data?.moduleURL}`);
  }

  await engine.findVCF(new Array(226).fill(0), 1, 64, {
    mode: "shortest",
    pruning: "strict",
    maxDepth: 11,
    maxNode: 5_000_000,
  });
  let findCall = calls.filter(call => call.type === "findVCF").at(-1);
  if (!findCall || findCall.data.mode !== "shortest" || findCall.data.pruning !== "fast") {
    throw new Error(`fast dropdown was not honored: ${JSON.stringify(findCall?.data)}`);
  }

  pruningSelect.value = "strict";
  await engine.findVCF(new Array(226).fill(0), 1, 64, {
    mode: "multi",
    pruning: "fast",
    maxDepth: 11,
    maxNode: 5_000_000,
  });
  findCall = calls.filter(call => call.type === "findVCF").at(-1);
  if (!findCall || findCall.data.mode !== "multi" || findCall.data.pruning !== "strict") {
    throw new Error(`strict dropdown was not honored: ${JSON.stringify(findCall?.data)}`);
  }
  if (findCall.data.maxVCF !== 64 || findCall.data.maxDepth !== 11) {
    throw new Error("generator validation limits were not forwarded");
  }

  genSetBusy(true);
  if (!pruningSelect.disabled) throw new Error("pruning dropdown remained enabled during generation");
  genSetBusy(false);
  if (pruningSelect.disabled) throw new Error("pruning dropdown was not re-enabled");

  const points = await engine.getBlockVCF(new Array(226).fill(0), 1, [1, 2, 3], true);
  if (points.join(",") !== "4,5") throw new Error("getBlockVCF response was not normalized");

  console.log("Generator Bitboard worker and pruning selection tests passed");
})().catch(error => {
  console.error(error);
  process.exit(1);
});
