"use strict";

let engineInstance = null;
let engineBaseURL = null;
let patternInstance = null;
let analyzePoint = null;
let patternSelfTest = null;
let lookupBenchmark = null;
let boardPtr = 0;
let resultPtr = 0;
let jsBenchmarkData = null;
let jsBenchmarkSink = 0;
let activeInspection = null;
let pendingInspection = null;
const rapfiPositionCache = new Map();

const BOARD_SIZE = 15;
const BOARD_CELLS = BOARD_SIZE * BOARD_SIZE;
const RESULT_BYTES = 16;
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

function decodeCppResult() {
  const bytes = patternInstance.HEAPU8.slice(resultPtr, resultPtr + RESULT_BYTES);
  return {
    directions: Array.from(bytes.slice(0, 4)),
    pattern4: bytes[4],
    forbidden: Boolean(bytes[5]),
    forbiddenType: bytes[6],
    actualOverlineMask: bytes[7],
    sameLineDoubleFourMask: bytes[8],
    realThreeDirections: bytes[9],
  };
}

function analyzeWithCpp(data) {
  if (!analyzePoint || !patternInstance) throw new Error("VCF Pattern Engine 尚未完成載入");
  const board = data.board instanceof Uint8Array ? data.board : Uint8Array.from(data.board);
  if (board.length !== BOARD_CELLS) throw new Error("盤面必須包含 225 格");
  patternInstance.HEAPU8.set(board, boardPtr);

  const results = [];
  for (let method = 0; method < 3; method++) {
    const ok = analyzePoint(boardPtr, data.idx, data.side, data.rule, method, resultPtr);
    if (!ok) throw new Error(`C++ Wasm 棋型分析失敗（method=${method}）`);
    results.push(decodeCppResult());
  }
  return results;
}

function p4CharToCode(char) {
  if (char === ".") return 0;
  if (char === "X") return 1;
  if (/^[A-L]$/.test(char)) return 13 - (char.charCodeAt(0) - 65);
  return null;
}

function parsePatternRow(line) {
  const values = line.trim().split(/\s+/)
    .filter((token) => /^[A-LX.]$/.test(token))
    .slice(0, BOARD_SIZE)
    .map(p4CharToCode);
  return values.length === BOARD_SIZE && values.every(Number.isInteger) ? values : null;
}

function parseForbidCoordinates(line) {
  const match = line.match(/^FORBID\s+([0-9]*)\.$/);
  const set = new Set();
  if (!match) return set;
  const text = match[1];
  for (let i = 0; i + 3 < text.length; i += 4) {
    const x = Number(text.slice(i, i + 2));
    const y = Number(text.slice(i + 2, i + 4));
    if (x >= 0 && x < BOARD_SIZE && y >= 0 && y < BOARD_SIZE) set.add(`${x},${y}`);
  }
  return set;
}

function stripMessagePrefix(output) {
  const text = String(output);
  return text.startsWith("MESSAGE ") ? text.slice(8) : text;
}

function officialPointFromCache(cache, data) {
  const x = data.idx % BOARD_SIZE;
  const uiY = Math.floor(data.idx / BOARD_SIZE);
  const internalY = BOARD_SIZE - 1 - uiY;
  const internalIdx = internalY * BOARD_SIZE + x;
  const pattern4Board = data.side === 1 ? cache.blackPattern4 : cache.whitePattern4;
  return {
    directionsAvailable: false,
    pattern4: pattern4Board?.[internalIdx] ?? null,
    forbiddenApplicable: data.rule === 2 && data.side === 1,
    forbidden: data.rule === 2 && data.side === 1
      ? cache.forbiddenCoordinates.has(`${x},${uiY}`)
      : false,
    source: "Rapfi TRACEBOARD + YXSHOWFORBID",
  };
}

function postInspection(data, cppResults, cache) {
  post("inspect", {
    requestId: data.requestId,
    idx: data.idx,
    side: data.side,
    rule: data.rule,
    cppResults,
    rapfi: officialPointFromCache(cache, data),
  });
}

function finishActiveInspection(forbidLine) {
  if (!activeInspection) return;
  const { data, cppResults, blackRows, whiteRows } = activeInspection;
  const blackPattern4 = blackRows.flat();
  const whitePattern4 = whiteRows.flat();
  const cache = {
    blackPattern4: blackPattern4.length === BOARD_CELLS ? blackPattern4 : null,
    whitePattern4: whitePattern4.length === BOARD_CELLS ? whitePattern4 : null,
    forbiddenCoordinates: parseForbidCoordinates(forbidLine),
  };
  rapfiPositionCache.set(data.positionKey, cache);
  if (rapfiPositionCache.size > 12) rapfiPositionCache.delete(rapfiPositionCache.keys().next().value);
  postInspection(data, cppResults, cache);
  activeInspection = null;

  if (pendingInspection) {
    const next = pendingInspection;
    pendingInspection = null;
    processInspection(next);
  }
}

function handleEngineStdout(output) {
  if (!activeInspection) {
    post("stdout", output);
    return;
  }

  const line = stripMessagePrefix(output);
  if (line.includes("Pattern4----Black")) {
    activeInspection.section = "black";
    return;
  }
  if (line.includes("Pattern4----White")) {
    activeInspection.section = "white";
    return;
  }
  if (activeInspection.section) {
    const row = parsePatternRow(line);
    if (row) {
      const target = activeInspection.section === "black"
        ? activeInspection.blackRows
        : activeInspection.whiteRows;
      target.push(row);
      if (target.length >= BOARD_SIZE) activeInspection.section = null;
      return;
    }
  }
  if (line.startsWith("FORBID ")) {
    finishActiveInspection(line);
  }
}

function startOfficialInspection(data, cppResults) {
  activeInspection = {
    data,
    cppResults,
    section: null,
    blackRows: [],
    whiteRows: [],
  };
  engineInstance.sendCommand(`INFO RULE ${data.rule}`);
  engineInstance.sendCommand(data.boardCommand);
  engineInstance.sendCommand("TRACEBOARD");
  engineInstance.sendCommand("YXSHOWFORBID");
}

function processInspection(data) {
  try {
    const cppResults = analyzeWithCpp(data);
    const cached = rapfiPositionCache.get(data.positionKey);
    if (cached) {
      postInspection(data, cppResults, cached);
      return;
    }
    if (activeInspection) {
      pendingInspection = data;
      return;
    }
    startOfficialInspection(data, cppResults);
  } catch (error) {
    post("inspectError", {
      requestId: data.requestId,
      message: error?.stack || error?.message || String(error),
    });
  }
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
        onReceiveStdout: handleEngineStdout,
        onReceiveStderr: (output) => post("stderr", output),
        onExit: (code) => post("exit", code),
        setStatus: (status) => post("status", status),
        wasmMemory: new WebAssembly.Memory({ initial: 1024, maximum: 8192 }),
      });

      const patternBaseURL = new URL("./", data.patternURL).href;
      self.importScripts(data.patternURL);
      if (typeof self.VCFPatternEngine !== "function") {
        throw new Error("找不到獨立 VCF C++ Wasm 棋型模組");
      }
      patternInstance = await self.VCFPatternEngine({
        locateFile: (url) => new URL(url, patternBaseURL).href,
      });
      analyzePoint = patternInstance.cwrap(
        "vcfAnalyzePoint",
        "number",
        ["number", "number", "number", "number", "number", "number"],
      );
      patternSelfTest = patternInstance.cwrap("vcfPatternSelfTest", "number", []);
      lookupBenchmark = patternInstance.cwrap(
        "vcfLookupBenchmark",
        "number",
        ["number", "number", "number", "number"],
      );
      const mismatches = patternSelfTest();
      if (mismatches !== 0) throw new Error(`C++ Wasm 三種棋型表自我檢查失敗：${mismatches}`);
      boardPtr = patternInstance._malloc(BOARD_CELLS);
      resultPtr = patternInstance._malloc(RESULT_BYTES);
      prepareJsBenchmark();
      post("ready", { patternSelfTest: mismatches });
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

  if (type === "inspect") {
    if (!engineInstance || !analyzePoint) {
      post("inspectError", { requestId: data?.requestId, message: "棋型模組尚未載入" });
      return;
    }
    if (activeInspection) pendingInspection = data;
    else processInspection(data);
    return;
  }

  if (type === "benchmark") {
    if (!lookupBenchmark) {
      post("benchmarkError", "獨立 C++ Wasm 棋型模組尚未完成載入");
      return;
    }
    try {
      const iterations = Number(data?.iterations ?? 1000000);
      const rounds = Number(data?.rounds ?? 9);
      const rule = Number(data?.rule ?? 2);
      const side = Number(data?.side ?? 1);
      const methods = [
        { key: "wasmTernaryNs", run: (count) => lookupBenchmark(rule, side, 0, count) },
        { key: "wasmHelperNs", run: (count) => lookupBenchmark(rule, side, 1, count) },
        { key: "wasmBinaryNs", run: (count) => lookupBenchmark(rule, side, 2, count) },
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
      if (patternInstance) {
        if (boardPtr) patternInstance._free(boardPtr);
        if (resultPtr) patternInstance._free(resultPtr);
      }
      engineInstance?.terminate?.();
    } finally {
      self.close();
    }
  }
};
