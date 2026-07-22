"use strict";

const BOARD_SIZE = 15;
const BOARD_CELLS = BOARD_SIZE * BOARD_SIZE;
const RESULT_BYTES = 16;
const EMPTY = 0;
const B4 = 11;

let patternInstance = null;
let analyzePoint = null;
let boardPtr = 0;
let resultPtr = 0;

function post(type, data) {
  self.postMessage({ type, data });
}

function decodeResult() {
  const bytes = patternInstance.HEAPU8.slice(resultPtr, resultPtr + RESULT_BYTES);
  return {
    directions: Array.from(bytes.slice(0, 4)),
    pattern4: bytes[4],
    forbidden: Boolean(bytes[5]),
    forbiddenType: bytes[6],
  };
}

function findCandidates(data) {
  if (!patternInstance || !analyzePoint) throw new Error("C++ Wasm 棋型模組尚未完成載入");
  const board = data.board instanceof Uint8Array ? data.board : Uint8Array.from(data.board || []);
  if (board.length !== BOARD_CELLS) throw new Error("盤面必須包含 225 格");

  const side = Number(data.side);
  const rule = Number(data.rule);
  patternInstance.HEAPU8.set(board, boardPtr);

  const startedAt = performance.now();
  const candidates = [];
  for (let idx = 0; idx < BOARD_CELLS; idx++) {
    if (board[idx] !== EMPTY) continue;
    const ok = analyzePoint(boardPtr, idx, side, rule, 0, resultPtr);
    if (!ok) throw new Error(`C++ Wasm 根候選判斷失敗（idx=${idx}）`);
    const result = decodeResult();
    const createsFourOrFive = result.directions.some((pattern) => pattern >= B4);
    if (createsFourOrFive && !result.forbidden) {
      candidates.push({
        idx,
        directions: result.directions,
        pattern4: result.pattern4,
      });
    }
  }

  return {
    requestId: data.requestId,
    candidates,
    elapsedMs: performance.now() - startedAt,
  };
}

self.onmessage = async (event) => {
  const { type, data } = event.data || {};

  if (type === "init") {
    try {
      const baseURL = new URL("./", data.patternURL).href;
      self.importScripts(data.patternURL);
      if (typeof self.VCFPatternEngine !== "function") {
        throw new Error("找不到獨立 VCF C++ Wasm 棋型模組");
      }
      patternInstance = await self.VCFPatternEngine({
        locateFile: (url) => new URL(url, baseURL).href,
      });
      const selfTest = patternInstance.cwrap("vcfPatternSelfTest", "number", []);
      analyzePoint = patternInstance.cwrap(
        "vcfAnalyzePoint",
        "number",
        ["number", "number", "number", "number", "number", "number"],
      );
      const mismatches = selfTest();
      if (mismatches !== 0) throw new Error(`三種棋型表自我檢查失敗：${mismatches}`);
      boardPtr = patternInstance._malloc(BOARD_CELLS);
      resultPtr = patternInstance._malloc(RESULT_BYTES);
      post("ready", { mismatches });
    } catch (error) {
      post("error", error?.stack || error?.message || String(error));
    }
    return;
  }

  if (type === "findCandidates") {
    try {
      post("candidates", findCandidates(data || {}));
    } catch (error) {
      post("candidateError", {
        requestId: data?.requestId,
        message: error?.stack || error?.message || String(error),
      });
    }
    return;
  }

  if (type === "terminate") {
    if (patternInstance) {
      if (boardPtr) patternInstance._free(boardPtr);
      if (resultPtr) patternInstance._free(resultPtr);
    }
    self.close();
  }
};
