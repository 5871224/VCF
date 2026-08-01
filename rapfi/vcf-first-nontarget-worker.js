"use strict";

let moduleInstance = null;
let readyPromise = null;
let currentRules = 2;

const BOARD_CELLS = 225;
const MAX_ROUTE_PLY = 224;
const OUTPUT_ROUTES = 2;
const STATS_BYTES = 16;
const MODE_FIRST_NON_TARGET = 3;
const ENGINE_CACHE_VERSION = "first-nontarget-v2";

let ptr = {};
let api = {};

function post(id, ok, result, error) {
  self.postMessage({ id, ok, result, error });
}

function toBoard(input) {
  const source = input instanceof Uint8Array ? input : Uint8Array.from(input || []);
  const board = new Uint8Array(BOARD_CELLS);
  board.set(source.subarray(0, BOARD_CELLS));
  return board;
}

function readStats() {
  const view = new DataView(
    moduleInstance.HEAPU8.buffer,
    ptr.stats,
    STATS_BYTES,
  );
  const nodes = view.getUint32(0, true);
  const elapsedMicros = view.getUint32(4, true);
  return {
    nodeCount: nodes,
    elapsedMs: elapsedMicros / 1000,
    routeCount: view.getUint16(8, true),
    candidateCount: view.getUint16(10, true),
    maxPly: view.getUint16(12, true),
    aborted: Boolean(view.getUint8(14)),
    stopReason: view.getUint8(15),
    nodesPerSecond:
      elapsedMicros > 0 ? (nodes * 1_000_000) / elapsedMicros : 0,
  };
}

function pruningValue(value) {
  return value === "fast" || Number(value) === 1 ? 1 : 0;
}

function findFirstNonTarget(param) {
  const board = toBoard(param.arr);
  const targetBoard = toBoard(param.targetBoard);
  moduleInstance.HEAPU8.set(board, ptr.board);

  // 模式 3 以 outMoves 開頭 225 bytes 作為目標標準盤面輸入；
  // C++ 會先複製，之後才把兩條輸出路線覆寫回同一區域。
  moduleInstance.HEAPU8.fill(
    0,
    ptr.moves,
    ptr.moves + OUTPUT_ROUTES * MAX_ROUTE_PLY,
  );
  moduleInstance.HEAPU8.set(targetBoard, ptr.moves);
  moduleInstance.HEAPU16.fill(
    0,
    ptr.lengths >>> 1,
    (ptr.lengths >>> 1) + OUTPUT_ROUTES,
  );

  api.findModeV3(
    ptr.board,
    Number(param.color) === 2 ? 2 : 1,
    Number(param.rules ?? currentRules),
    MODE_FIRST_NON_TARGET,
    param.blockOtherVCF === false ? 0 : 1,
    pruningValue(param.pruning),
    Math.max(0, Math.trunc(Number(param.expectedSteps) || 0)),
    Math.max(1, Math.min(MAX_ROUTE_PLY, Number(param.maxDepth) || 200)),
    Number(param.maxNode) >>> 0,
    ptr.moves,
    ptr.lengths,
    MAX_ROUTE_PLY,
    ptr.stats,
  );

  const targetLength = moduleInstance.HEAPU16[ptr.lengths >>> 1];
  const unwantedLength = moduleInstance.HEAPU16[(ptr.lengths >>> 1) + 1];
  const targetMoves = targetLength
    ? Array.from(
        moduleInstance.HEAPU8.subarray(
          ptr.moves,
          ptr.moves + targetLength,
        ),
      )
    : [];
  const unwantedStart = ptr.moves + MAX_ROUTE_PLY;
  const unwantedMoves = unwantedLength
    ? Array.from(
        moduleInstance.HEAPU8.subarray(
          unwantedStart,
          unwantedStart + unwantedLength,
        ),
      )
    : [];

  return {
    ...readStats(),
    targetMoves,
    unwantedMoves,
    foundTarget: targetMoves.length > 0,
    foundUnwanted: unwantedMoves.length > 0,
    searchMode: "first-non-target",
  };
}

async function init(moduleURL) {
  if (readyPromise) return readyPromise;
  readyPromise = (async () => {
    const source = new URL(moduleURL);
    source.searchParams.set("_engine", ENGINE_CACHE_VERSION);
    const base = new URL("./", source).href;
    const cacheQuery = source.search;

    self.importScripts(source.href);
    if (typeof self.VCFBitboardModule !== "function") {
      throw new Error("找不到 VCFBitboardModule");
    }
    moduleInstance = await self.VCFBitboardModule({
      locateFile: file => {
        const url = new URL(file, base);
        url.search = cacheQuery;
        return url.href;
      },
    });
    api = {
      findModeV3: moduleInstance.cwrap(
        "vcfBbFindModeV3",
        "number",
        Array(13).fill("number"),
      ),
      selfTest: moduleInstance.cwrap("vcfBbSelfTest", "number", []),
      searchV2SelfTest: moduleInstance.cwrap(
        "vcfBbSearchV2SelfTest",
        "number",
        [],
      ),
    };

    const patternTest = api.selfTest();
    const searchTest = api.searchV2SelfTest();
    if (patternTest !== 0 || searchTest !== 0) {
      throw new Error(
        `Bitboard Wasm 自我檢查失敗：${patternTest} / ${searchTest}`,
      );
    }

    ptr.board = moduleInstance._malloc(BOARD_CELLS);
    ptr.moves = moduleInstance._malloc(OUTPUT_ROUTES * MAX_ROUTE_PLY);
    ptr.lengths = moduleInstance._malloc(OUTPUT_ROUTES * 2);
    ptr.stats = moduleInstance._malloc(STATS_BYTES);
    return { patternTest, searchTest };
  })();
  return readyPromise;
}

self.onmessage = async event => {
  const { id, type, data } = event.data || {};
  try {
    if (type === "init") {
      post(id, true, await init(data.moduleURL));
      return;
    }
    await readyPromise;

    let result;
    switch (type) {
      case "setGameRules":
        currentRules = Number(data?.rules);
        if (![0, 1, 2].includes(currentRules)) currentRules = 2;
        result = true;
        break;
      case "findFirstNonTarget":
        result = findFirstNonTarget(data || {});
        break;
      default:
        throw new Error(`未知第一非目標 VCF 指令：${type}`);
    }
    post(id, true, result);
  } catch (error) {
    post(id, false, null, error?.stack || error?.message || String(error));
  }
};
