"use strict";

let moduleInstance = null;
let readyPromise = null;
let currentRules = 2;

const BOARD_CELLS = 225;
const MAX_ROUTES = 64;
const MAX_ROUTE_PLY = 224;
const STATS_BYTES = 16;

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
  const view = new DataView(moduleInstance.HEAPU8.buffer, ptr.stats, STATS_BYTES);
  const nodes = view.getUint32(0, true);
  const elapsedMicros = view.getUint32(4, true);
  return {
    nodeCount: nodes,
    elapsedMs: elapsedMicros / 1000,
    routeCount: view.getUint16(8, true),
    candidateCount: view.getUint16(10, true),
    maxPly: view.getUint16(12, true),
    aborted: Boolean(view.getUint8(14)),
    nodesPerSecond: elapsedMicros > 0 ? nodes * 1_000_000 / elapsedMicros : 0,
  };
}

function writeBoard(board) {
  moduleInstance.HEAPU8.set(board, ptr.board);
}

function writeRoute(route) {
  const moves = Uint8Array.from(route || []).subarray(0, MAX_ROUTE_PLY);
  moduleInstance.HEAPU8.fill(0, ptr.route, ptr.route + MAX_ROUTE_PLY);
  moduleInstance.HEAPU8.set(moves, ptr.route);
  return moves.length;
}

function searchModeValue(mode, maxVCF = 1) {
  if (mode === "shortest" || Number(mode) === 2) return 2;
  if (mode === "multi" || Number(mode) === 1 || Number(maxVCF) > 1) return 1;
  return 0;
}

function resolveSimplify(param, mode) {
  // 明確傳入 true/false 時尊重呼叫端；未指定時，多組與最短模式預設精簡。
  return param.simplify == null ? mode !== 0 : Boolean(param.simplify);
}

function findVCF(param) {
  const board = toBoard(param.arr);
  writeBoard(board);
  const maxVCF = Math.max(1, Math.min(MAX_ROUTES, Number(param.maxVCF) || 1));
  const maxDepth = Math.max(1, Math.min(MAX_ROUTE_PLY, Number(param.maxDepth) || 200));
  const maxNode = Math.max(1, Math.min(0xffffffff, Number(param.maxNode) || 5_000_000));
  const mode = searchModeValue(param.mode, maxVCF);
  const simplify = resolveSimplify(param, mode);
  moduleInstance.HEAPU8.fill(0, ptr.moves, ptr.moves + MAX_ROUTES * MAX_ROUTE_PLY);
  moduleInstance.HEAPU16.fill(0, ptr.lengths >>> 1, (ptr.lengths >>> 1) + MAX_ROUTES);

  const count = api.findMode
    ? api.findMode(
      ptr.board,
      Number(param.color) || 1,
      Number(param.rules ?? currentRules),
      mode,
      simplify ? 1 : 0,
      maxVCF,
      maxDepth,
      maxNode,
      ptr.moves,
      ptr.lengths,
      MAX_ROUTE_PLY,
      ptr.stats,
    )
    : api.find(
      ptr.board,
      Number(param.color) || 1,
      Number(param.rules ?? currentRules),
      maxVCF,
      maxDepth,
      maxNode,
      ptr.moves,
      ptr.lengths,
      MAX_ROUTE_PLY,
      ptr.stats,
    );

  const lengths = moduleInstance.HEAPU16.subarray(ptr.lengths >>> 1, (ptr.lengths >>> 1) + count);
  const winMoves = [];
  for (let route = 0; route < count; route++) {
    const length = lengths[route];
    const start = ptr.moves + route * MAX_ROUTE_PLY;
    winMoves.push(Array.from(moduleInstance.HEAPU8.subarray(start, start + length)));
  }
  return {
    ...readStats(),
    vcfCount: count,
    winMoves,
    searchMode: mode === 2 ? "shortest" : mode === 1 ? "multi" : "single",
    simplified: simplify,
  };
}

function validateRoute(param) {
  const board = toBoard(param.arr);
  writeBoard(board);
  const routeLen = writeRoute(param.moves);
  const valid = api.validate(
    ptr.board,
    Number(param.color) || 1,
    Number(param.rules ?? currentRules),
    ptr.route,
    routeLen,
    Math.max(1, Number(param.maxNode) || 5_000_000),
    ptr.stats,
  );
  return { ...readStats(), valid: Boolean(valid) };
}

function getBlockVCF(param) {
  const board = toBoard(param.arr);
  writeBoard(board);
  const routeLen = writeRoute(param.vcfMoves);
  moduleInstance.HEAPU8.fill(0, ptr.points, ptr.points + BOARD_CELLS);
  const count = api.routeDefense(
    ptr.board,
    Number(param.color) || 1,
    Number(param.rules ?? currentRules),
    ptr.route,
    routeLen,
    Math.max(1, Number(param.maxNode) || 5_000_000),
    ptr.points,
    BOARD_CELLS,
    ptr.stats,
  );
  return {
    ...readStats(),
    points: Array.from(moduleInstance.HEAPU8.subarray(ptr.points, ptr.points + count)),
  };
}

function getLevelPoints(param) {
  const board = toBoard(param.arr);
  writeBoard(board);
  const rawIndices = Array.isArray(param.indices) || ArrayBuffer.isView(param.indices)
    ? Array.from(param.indices).filter(idx => Number.isInteger(idx) && idx >= 0 && idx < BOARD_CELLS)
    : [];
  const indices = Uint16Array.from(rawIndices);
  if (indices.length) moduleInstance.HEAPU16.set(indices, ptr.indices >>> 1);
  moduleInstance.HEAPU16.fill(0, ptr.outIndices >>> 1, (ptr.outIndices >>> 1) + BOARD_CELLS);
  moduleInstance.HEAPU16.fill(0, ptr.labels >>> 1, (ptr.labels >>> 1) + BOARD_CELLS);

  const maxDepth = Math.max(1, Math.min(MAX_ROUTE_PLY, Number(param.maxDepth) || 200));
  const maxNode = Math.max(1, Number(param.maxNode) || 5_000_000);
  const mode = searchModeValue(param.searchMode, 1);
  const simplify = resolveSimplify(param, mode);
  const count = api.scanMode
    ? api.scanMode(
      ptr.board,
      Number(param.color) || 1,
      Number(param.placeColor || param.color) || 1,
      Number(param.rules ?? currentRules),
      mode,
      simplify ? 1 : 0,
      indices.length ? ptr.indices : 0,
      indices.length,
      maxDepth,
      maxNode,
      ptr.outIndices,
      ptr.labels,
      BOARD_CELLS,
      ptr.stats,
    )
    : api.scan(
      ptr.board,
      Number(param.color) || 1,
      Number(param.placeColor || param.color) || 1,
      Number(param.rules ?? currentRules),
      indices.length ? ptr.indices : 0,
      indices.length,
      maxDepth,
      maxNode,
      ptr.outIndices,
      ptr.labels,
      BOARD_CELLS,
      ptr.stats,
    );

  const outIdx = moduleInstance.HEAPU16.subarray(ptr.outIndices >>> 1, (ptr.outIndices >>> 1) + count);
  const labels = moduleInstance.HEAPU16.subarray(ptr.labels >>> 1, (ptr.labels >>> 1) + count);
  const items = [];
  for (let i = 0; i < count; i++) items.push({ idx: outIdx[i], label: String(labels[i]) });
  return {
    ...readStats(),
    items,
    searchMode: mode === 2 ? "shortest" : mode === 1 ? "multi" : "single",
  };
}

function trimVCFGroups(param) {
  const base = toBoard(param.arr);
  const attacker = Number(param.color) || 1;
  const defender = 3 - attacker;
  const rules = Number(param.rules ?? currentRules);
  const groups = Array.isArray(param.groups) ? param.groups : [];
  const seen = new Set();
  const processed = [];

  for (const source of groups) {
    const moves = Array.from(source || []).filter(idx => Number.isInteger(idx) && idx >= 0 && idx < BOARD_CELLS);
    if (!moves.length) continue;
    const board = base.slice();
    for (let i = 0; i < moves.length - 1; i++) {
      if (board[moves[i]] !== 0) break;
      board[moves[i]] = (i & 1) ? defender : attacker;
    }
    writeBoard(board);
    const finalIndex = moves[moves.length - 1];
    const finalSide = ((moves.length - 1) & 1) ? defender : attacker;
    const rawLevel = api.levelPoint(ptr.board, finalIndex, finalSide, rules);
    const level = rawLevel & 0x0f;
    const normalized = level === 9 ? moves.slice(0, -1) : moves;
    const key = normalized
      .map((idx, i) => `${idx}:${(i & 1) ? defender : attacker}`)
      .sort()
      .join(",");
    if (!seen.has(key)) {
      seen.add(key);
      processed.push(moves);
    }
  }
  processed.sort((a, b) => a.length - b.length);
  return processed;
}

async function init(url) {
  if (readyPromise) return readyPromise;
  readyPromise = (async () => {
    const base = new URL("./", url).href;
    self.importScripts(url);
    if (typeof self.VCFBitboardModule !== "function") throw new Error("找不到 VCFBitboardModule");
    moduleInstance = await self.VCFBitboardModule({ locateFile: file => new URL(file, base).href });
    api = {
      find: moduleInstance.cwrap("vcfBbFind", "number", Array(10).fill("number")),
      findMode: moduleInstance.cwrap("vcfBbFindMode", "number", Array(12).fill("number")),
      validate: moduleInstance.cwrap("vcfBbValidateRoute", "number", Array(7).fill("number")),
      routeDefense: moduleInstance.cwrap("vcfBbRouteDefense", "number", Array(9).fill("number")),
      scan: moduleInstance.cwrap("vcfBbScanPoints", "number", Array(12).fill("number")),
      scanMode: moduleInstance.cwrap("vcfBbScanPointsMode", "number", Array(14).fill("number")),
      levelPoint: moduleInstance.cwrap("vcfBbLegacyGetLevelPoint", "number", Array(4).fill("number")),
      selfTest: moduleInstance.cwrap("vcfBbSelfTest", "number", []),
      searchV2SelfTest: moduleInstance.cwrap("vcfBbSearchV2SelfTest", "number", []),
    };
    const test = api.selfTest();
    if (test !== 0) throw new Error(`Bitboard C++ Wasm 自我檢查失敗：${test}`);
    const searchTest = api.searchV2SelfTest();
    if (searchTest !== 0) throw new Error(`Bitboard 搜尋 V2 自我檢查失敗：${searchTest}`);

    ptr.board = moduleInstance._malloc(BOARD_CELLS);
    ptr.moves = moduleInstance._malloc(MAX_ROUTES * MAX_ROUTE_PLY);
    ptr.lengths = moduleInstance._malloc(MAX_ROUTES * 2);
    ptr.stats = moduleInstance._malloc(STATS_BYTES);
    ptr.route = moduleInstance._malloc(MAX_ROUTE_PLY);
    ptr.points = moduleInstance._malloc(BOARD_CELLS);
    ptr.indices = moduleInstance._malloc(BOARD_CELLS * 2);
    ptr.outIndices = moduleInstance._malloc(BOARD_CELLS * 2);
    ptr.labels = moduleInstance._malloc(BOARD_CELLS * 2);
    return { selfTest: test, searchV2SelfTest: searchTest };
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
        currentRules = Number(data?.rules) || 2;
        result = true;
        break;
      case "findVCF": result = findVCF(data || {}); break;
      case "isVCF": result = validateRoute(data || {}); break;
      case "getBlockVCF": result = getBlockVCF(data || {}); break;
      case "getLevelPoints": result = getLevelPoints(data || {}); break;
      case "trimVCFGroups": result = trimVCFGroups(data || {}); break;
      default: throw new Error(`未知 Bitboard 指令：${type}`);
    }
    post(id, true, result);
  } catch (error) {
    post(id, false, null, error?.stack || error?.message || String(error));
  }
};
