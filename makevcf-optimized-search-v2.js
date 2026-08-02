"use strict";

// 保留檔名只為相容既有 HTML 載入順序。
// 舊 eval/worker.js 漸進搜尋、DOM 監看與主流程覆寫已移除；正式工作台只使用 Bitboard 引擎。
(function markLegacyBenchmarkRemoved(global) {
  global.__vcfLegacyBenchmarkRemoved = true;
})(window);
