"use strict";
// Dedicated Rapfi VCF Worker; no imports or globals from VCF Bitboard.
let rapfiModulePromise = null;
function standaloneModule() {
  if (!rapfiModulePromise) {
    importScripts(new URL("./engine/rapfi-vcf-standalone.js", self.location.href).href);
    rapfiModulePromise = RapfiVCFStandaloneModule({
      locateFile: name => new URL("./engine/" + name, self.location.href).href,
    }).catch(error => {
      rapfiModulePromise = null;
      throw error;
    });
  }
  return rapfiModulePromise;
}
self.onmessage = async event => {
  const { id, board, attacker, rule, maxNodes, maxPly } = event.data || {};
  try {
    if (!Number.isSafeInteger(id) || !Array.isArray(board) || board.length !== 225
        || !board.every(stone => Number.isInteger(stone) && stone >= 0 && stone <= 2)
        || (attacker !== 1 && attacker !== 2) || ![0, 1, 2].includes(rule)
        || !Number.isSafeInteger(maxNodes) || maxNodes < 1 || maxNodes > 100000000
        || !Number.isInteger(maxPly) || maxPly < 1 || maxPly > 224) {
      throw new Error("Rapfi VCF 輸入盤面或限制無效");
    }
    const wasm = await standaloneModule();
    const boardPtr = wasm._malloc(225);
    const movesPtr = wasm._malloc(225);
    const statsPtr = wasm._malloc(20);
    if (!boardPtr || !movesPtr || !statsPtr) {
      if (boardPtr) wasm._free(boardPtr);
      if (movesPtr) wasm._free(movesPtr);
      if (statsPtr) wasm._free(statsPtr);
      throw new Error("Rapfi VCF 記憶體不足");
    }
    try {
      wasm.HEAPU8.set(board, boardPtr);
      wasm.HEAPU32.fill(0, statsPtr >>> 2, (statsPtr >>> 2) + 5);
      const result = wasm._rapfiStandaloneVCF(boardPtr, attacker, rule, maxNodes, maxPly, movesPtr, statsPtr);
      if (result < 0) throw new Error("Rapfi VCF 無法建立這個盤面");
      const offset = statsPtr >>> 2;
      const nodes = wasm.HEAPU32[offset];
      const elapsedMicros = wasm.HEAPU32[offset + 1];
      const maxPlySeen = wasm.HEAPU32[offset + 2];
      const aborted = Boolean(wasm.HEAPU32[offset + 3]);
      const routeLength = result === 1 ? wasm.HEAPU32[offset + 4] : 0;
      if (routeLength > 225) throw new Error("Rapfi VCF 回傳無效手順");
      const route = Array.from(wasm.HEAPU8.slice(movesPtr, movesPtr + routeLength));
      self.postMessage({ id, type: "result", found: result === 1,
        nodes, elapsedMicros, maxPlySeen, aborted, route });
    } finally {
      wasm._free(boardPtr);
      wasm._free(movesPtr);
      wasm._free(statsPtr);
    }
  } catch (error) {
    self.postMessage({ id, type: "error", message: String(error?.message || error) });
  }
};
