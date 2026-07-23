"use strict";

// 保留原 Worker 的全部指令，只增加根候選列舉與指定根搜尋。
self.importScripts("vcf-bitboard-worker.js");

const baseVCFWorkerHandler = self.onmessage;

function ensureRootV4Api() {
  if (!api.rootCandidatesV4 && moduleInstance?._vcfBbRootCandidatesV4) {
    api.rootCandidatesV4 = moduleInstance.cwrap(
      "vcfBbRootCandidatesV4",
      "number",
      Array(6).fill("number"),
    );
  }
  if (!api.findForcedRootV4 && moduleInstance?._vcfBbFindForcedRootV4) {
    api.findForcedRootV4 = moduleInstance.cwrap(
      "vcfBbFindForcedRootV4",
      "number",
      Array(11).fill("number"),
    );
  }
  return Boolean(api.rootCandidatesV4 && api.findForcedRootV4);
}

// 正式 Worker 啟動只做固定成本的基本 ABI 自測。
// 512 組候選差異與 128 組根搜尋比較由 GitHub Actions 執行，
// 不可在每個瀏覽器 Worker 啟動時重跑。
async function initV4Lightweight(url) {
  if (readyPromise) return readyPromise;
  readyPromise = (async () => {
    const base = new URL("./", url).href;
    self.importScripts(url);
    if (typeof self.VCFBitboardModule !== "function") throw new Error("找不到 VCFBitboardModule");
    moduleInstance = await self.VCFBitboardModule({ locateFile: file => new URL(file, base).href });
    api = {
      find: moduleInstance.cwrap("vcfBbFind", "number", Array(10).fill("number")),
      findMode: moduleInstance.cwrap("vcfBbFindMode", "number", Array(12).fill("number")),
      findModeV3: moduleInstance._vcfBbFindModeV3
        ? moduleInstance.cwrap("vcfBbFindModeV3", "number", Array(13).fill("number"))
        : null,
      validate: moduleInstance.cwrap("vcfBbValidateRoute", "number", Array(7).fill("number")),
      routeDefense: moduleInstance.cwrap("vcfBbRouteDefense", "number", Array(9).fill("number")),
      scan: moduleInstance.cwrap("vcfBbScanPoints", "number", Array(12).fill("number")),
      scanMode: moduleInstance.cwrap("vcfBbScanPointsMode", "number", Array(14).fill("number")),
      scanModeV3: moduleInstance._vcfBbScanPointsModeV3
        ? moduleInstance.cwrap("vcfBbScanPointsModeV3", "number", Array(15).fill("number"))
        : null,
      levelPoint: moduleInstance.cwrap("vcfBbLegacyGetLevelPoint", "number", Array(4).fill("number")),
      levelPointCompat: moduleInstance.cwrap("vcfBbLegacyGetLevelPointCompat", "number", Array(4).fill("number")),
      lineFourCompat: moduleInstance.cwrap("vcfBbLegacyTestLineFourCompat", "number", Array(5).fill("number")),
      blockFour: moduleInstance.cwrap("vcfBbLegacyGetBlockFourPoint", "number", Array(5).fill("number")),
      foul: moduleInstance.cwrap("vcfBbLegacyIsFoul", "number", Array(3).fill("number")),
      selfTest: moduleInstance.cwrap("vcfBbSelfTest", "number", []),
      searchV2SelfTest: moduleInstance.cwrap("vcfBbSearchV2SelfTest", "number", []),
    };

    const test = api.selfTest();
    if (test !== 0) throw new Error(`Bitboard C++ Wasm 自我檢查失敗：${test}`);

    ptr.board = moduleInstance._malloc(BOARD_CELLS);
    ptr.moves = moduleInstance._malloc(MAX_ROUTES * MAX_ROUTE_PLY);
    ptr.lengths = moduleInstance._malloc(MAX_ROUTES * 2);
    ptr.stats = moduleInstance._malloc(STATS_BYTES);
    ptr.route = moduleInstance._malloc(MAX_ROUTE_PLY);
    ptr.points = moduleInstance._malloc(BOARD_CELLS);
    ptr.indices = moduleInstance._malloc(BOARD_CELLS * 2);
    ptr.outIndices = moduleInstance._malloc(BOARD_CELLS * 2);
    ptr.labels = moduleInstance._malloc(BOARD_CELLS * 2);

    if (!ensureRootV4Api()) throw new Error("Bitboard Wasm 未匯出根候選 V4 API");
    return {
      selfTest: test,
      searchV2SelfTest: "ci-only",
      optimizedV3: Boolean(api.findModeV3),
      rootV4: true,
    };
  })();
  return readyPromise;
}

function getRootCandidatesV4(param) {
  if (!ensureRootV4Api()) throw new Error("目前 Wasm 不支援根候選 V4 API");
  const board = toBoard(param.arr);
  writeBoard(board);
  moduleInstance.HEAPU8.fill(0, ptr.points, ptr.points + BOARD_CELLS);
  const count = api.rootCandidatesV4(
    ptr.board,
    Number(param.color) || BLACK,
    Number(param.rules ?? currentRules),
    ptr.points,
    BOARD_CELLS,
    ptr.stats,
  );
  const stats = readStats();
  let moves = Array.from(moduleInstance.HEAPU8.subarray(ptr.points, ptr.points + count));
  const immediate = stats.routeCount > 0;

  // 根平行目前改為明確 opt-in。主程式未傳 parallelRoot=true 時，
  // 非直接勝只回傳第一個候選，使其立即回退共享 TT 的單 Worker 搜尋。
  if (!immediate && param.parallelRoot !== true && moves.length > 1)
    moves = moves.slice(0, 1);

  return {
    ...stats,
    moves,
    immediate,
    optimizedRootV4: true,
    parallelRootEnabled: param.parallelRoot === true,
  };
}

function findForcedRootV4(param) {
  if (!ensureRootV4Api()) throw new Error("目前 Wasm 不支援指定根搜尋 V4 API");
  const board = toBoard(param.arr);
  writeBoard(board);
  moduleInstance.HEAPU8.fill(0, ptr.route, ptr.route + MAX_ROUTE_PLY);
  moduleInstance.HEAPU16[ptr.lengths >>> 1] = 0;

  const maxDepth = Math.max(1, Math.min(MAX_ROUTE_PLY, Number(param.maxDepth) || 200));
  const maxNode = Math.max(1, Math.min(0xffffffff, Number(param.maxNode) || 5_000_000));
  const valid = api.findForcedRootV4(
    ptr.board,
    Number(param.color) || BLACK,
    Number(param.rules ?? currentRules),
    Number(param.rootMove),
    param.simplify ? 1 : 0,
    maxDepth,
    maxNode,
    ptr.route,
    ptr.lengths,
    MAX_ROUTE_PLY,
    ptr.stats,
  );
  const length = moduleInstance.HEAPU16[ptr.lengths >>> 1];
  const route = valid
    ? Array.from(moduleInstance.HEAPU8.subarray(ptr.route, ptr.route + length))
    : [];
  return {
    ...readStats(),
    valid: Boolean(valid),
    vcfCount: valid ? 1 : 0,
    winMoves: valid ? [route] : [],
    rootMove: Number(param.rootMove),
    optimizedRootV4: true,
  };
}

self.onmessage = async event => {
  const { id, type, data } = event.data || {};

  if (type === "init") {
    try {
      post(id, true, await initV4Lightweight(data.moduleURL));
    } catch (error) {
      post(id, false, null, error?.stack || error?.message || String(error));
    }
    return;
  }

  if (type !== "rootCandidatesV4" && type !== "findForcedRootV4") {
    return baseVCFWorkerHandler.call(self, event);
  }

  try {
    await readyPromise;
    const result = type === "rootCandidatesV4"
      ? getRootCandidatesV4(data || {})
      : findForcedRootV4(data || {});
    post(id, true, result);
  } catch (error) {
    post(id, false, null, error?.stack || error?.message || String(error));
  }
};

// CI trigger only.
