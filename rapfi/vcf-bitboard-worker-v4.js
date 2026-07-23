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
  return {
    ...stats,
    moves: Array.from(moduleInstance.HEAPU8.subarray(ptr.points, ptr.points + count)),
    immediate: stats.routeCount > 0,
    optimizedRootV4: true,
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
      const result = await init(data.moduleURL);
      if (!ensureRootV4Api())
        throw new Error("Bitboard Wasm 未匯出根候選 V4 API");
      post(id, true, { ...result, rootV4: true });
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
