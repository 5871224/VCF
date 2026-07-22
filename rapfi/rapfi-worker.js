"use strict";

let engineInstance = null;
let engineBaseURL = null;
let lookupBenchmarkInstance = null;
let lookupBenchmark = null;
let jsBenchmarkData = null;
let jsBenchmarkSink = 0;

const BENCH_SAMPLE_COUNT = 4096;
const BENCH_SAMPLE_MASK = BENCH_SAMPLE_COUNT - 1;

function post(type, data) {
  self.postMessage({ type, data });
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function prepareJsBenchmark() {
  if (jsBenchmarkData) return jsBenchmarkData;

  const powers = new Uint32Array(10);
  powers[0] = 1;
  for (let i = 1; i < powers.length; i++) powers[i] = powers[i - 1] * 3;

  const ownToTernary = new Uint32Array(1024);
  const blockToTernary = new Uint32Array(1024);
  for (let mask = 0; mask < 1024; mask++) {
    let ownKey = 0;
    let blockKey = 0;
    for (let bit = 0; bit < 10; bit++) {
      if ((mask >>> bit) & 1) {
        ownKey += powers[bit];
        blockKey += powers[bit] * 2;
      }
    }
    ownToTernary[mask] = ownKey;
    blockToTernary[mask] = blockKey;
  }

  const ternaryTable = new Uint8Array(59049);
  for (let i = 0; i < ternaryTable.length; i++) {
    ternaryTable[i] = ((i * 13) ^ (i >>> 3)) & 15;
  }

  const binaryTable = new Uint8Array(1 << 20);
  for (let i = 0; i < binaryTable.length; i++) {
    binaryTable[i] = ((i * 7) ^ (i >>> 5)) & 15;
  }

  const ternaryKeys = new Uint32Array(BENCH_SAMPLE_COUNT);
  const ownMasks = new Uint16Array(BENCH_SAMPLE_COUNT);
  const blockMasks = new Uint16Array(BENCH_SAMPLE_COUNT);
  const binaryKeys = new Uint32Array(BENCH_SAMPLE_COUNT);
  let state = 0x9e3779b9;

  for (let sample = 0; sample < BENCH_SAMPLE_COUNT; sample++) {
    let ownMask = 0;
    let blockMask = 0;
    let ternaryKey = 0;
    for (let bit = 0; bit < 10; bit++) {
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
      const cell = (state >>> 0) % 3;
      if (cell === 1) {
        ownMask |= 1 << bit;
        ternaryKey += powers[bit];
      } else if (cell === 2) {
        blockMask |= 1 << bit;
        ternaryKey += powers[bit] * 2;
      }
    }
    ownMasks[sample] = ownMask;
    blockMasks[sample] = blockMask;
    ternaryKeys[sample] = ternaryKey;
    binaryKeys[sample] = ownMask | (blockMask << 10);
  }

  jsBenchmarkData = {
    ownToTernary,
    blockToTernary,
    ternaryTable,
    binaryTable,
    ternaryKeys,
    ownMasks,
    blockMasks,
    binaryKeys,
  };
  return jsBenchmarkData;
}

function runJsBenchmark(mode, iterations) {
  const data = prepareJsBenchmark();
  let checksum = jsBenchmarkSink;
  const start = performance.now();

  if (mode === 0) {
    const { ternaryTable, ternaryKeys } = data;
    for (let i = 0; i < iterations; i++) {
      checksum += ternaryTable[ternaryKeys[i & BENCH_SAMPLE_MASK]];
    }
  } else if (mode === 1) {
    const { ownToTernary, blockToTernary, ternaryTable, ownMasks, blockMasks } = data;
    for (let i = 0; i < iterations; i++) {
      const sample = i & BENCH_SAMPLE_MASK;
      const key = ownToTernary[ownMasks[sample]] + blockToTernary[blockMasks[sample]];
      checksum += ternaryTable[key];
    }
  } else {
    const { binaryTable, binaryKeys } = data;
    for (let i = 0; i < iterations; i++) {
      checksum += binaryTable[binaryKeys[i & BENCH_SAMPLE_MASK]];
    }
  }

  const elapsedMs = performance.now() - start;
  jsBenchmarkSink = checksum;
  return elapsedMs * 1000000 / iterations;
}

function runInterleavedBenchmarks(methods, iterations, rounds) {
  const warmupIterations = Math.min(iterations, 200000);
  const values = Object.fromEntries(methods.map((method) => [method.key, []]));

  for (const method of methods) method.run(warmupIterations);

  for (let round = 0; round < rounds; round++) {
    const offset = round % methods.length;
    for (let step = 0; step < methods.length; step++) {
      const method = methods[(offset + step) % methods.length];
      values[method.key].push(method.run(iterations));
    }
  }

  return Object.fromEntries(
    Object.entries(values).map(([key, samples]) => [key, median(samples)]),
  );
}

self.onmessage = async (event) => {
  const { type, data } = event.data || {};

  if (type === "init") {
    try {
      engineBaseURL = new URL("./", data.engineURL).href;
      self.importScripts(data.engineURL);
      if (typeof self.Rapfi !== "function") throw new Error("找不到 Rapfi 模組工廠");

      engineInstance = await self.Rapfi({
        locateFile: (url) => new URL(url, engineBaseURL).href,
        onReceiveStdout: (output) => post("stdout", output),
        onReceiveStderr: (output) => post("stderr", output),
        onExit: (code) => post("exit", code),
        setStatus: (status) => post("status", status),
        wasmMemory: new WebAssembly.Memory({
          initial: 1024,
          maximum: 8192,
        }),
      });

      const benchmarkBaseURL = new URL("./", data.benchmarkURL).href;
      self.importScripts(data.benchmarkURL);
      if (typeof self.VCFLookupBenchmark !== "function") {
        throw new Error("找不到獨立 VCF 查表基準模組");
      }
      lookupBenchmarkInstance = await self.VCFLookupBenchmark({
        locateFile: (url) => new URL(url, benchmarkBaseURL).href,
      });
      lookupBenchmark = lookupBenchmarkInstance.cwrap(
        "vcfLookupBenchmark",
        "number",
        ["number", "number"],
      );

      prepareJsBenchmark();
      post("ready", true);
    } catch (error) {
      post("error", error?.stack || error?.message || String(error));
    }
    return;
  }

  if (type === "command") {
    if (!engineInstance) {
      post("error", "Rapfi 尚未完成載入");
      return;
    }
    engineInstance.sendCommand(String(data || ""));
    return;
  }

  if (type === "benchmark") {
    if (!lookupBenchmark) {
      post("benchmarkError", "獨立查表基準尚未完成載入");
      return;
    }
    try {
      const iterations = Number(data?.iterations ?? 1000000);
      const rounds = Number(data?.rounds ?? 9);
      const methods = [
        { key: "wasmTernaryNs", run: (count) => lookupBenchmark(0, count) },
        { key: "wasmHelperNs", run: (count) => lookupBenchmark(1, count) },
        { key: "wasmBinaryNs", run: (count) => lookupBenchmark(2, count) },
        { key: "jsTernaryNs", run: (count) => runJsBenchmark(0, count) },
        { key: "jsHelperNs", run: (count) => runJsBenchmark(1, count) },
        { key: "jsBinaryNs", run: (count) => runJsBenchmark(2, count) },
      ];

      post("benchmark", {
        iterations,
        rounds,
        ...runInterleavedBenchmarks(methods, iterations, rounds),
      });
    } catch (error) {
      post("benchmarkError", error?.stack || error?.message || String(error));
    }
    return;
  }

  if (type === "terminate") {
    try {
      engineInstance?.terminate?.();
    } finally {
      self.close();
    }
  }
};
