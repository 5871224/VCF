"use strict";

// 保留檔名只為相容既有 HTML 載入順序。
// 舊 eval/worker.js 漸進搜尋、DOM 監看與主流程覆寫已移除；正式工作台只使用 Bitboard 引擎。
(function markLegacyBenchmarkRemoved(global) {
  global.__vcfLegacyBenchmarkRemoved = true;
})(window);

// 辨識預覽仍由 makevcf.html 負責繪製；這裡只在預覽模式統一顯示色彩，
// 不碰辨識結果、盤面資料或操作流程。非棋子遮罩改為高飽和綠色，
// 黑／白棋外圈則分別使用更醒目的藍色與黃色。
(function installRecognitionPreviewPalette(global) {
  const prototype = global.CanvasRenderingContext2D?.prototype;
  if (!prototype) return;

  const PATCH_FLAG = Symbol.for("vcf.recognitionPreviewPalette");
  if (prototype[PATCH_FLAG]) return;

  const originalFill = prototype.fill;
  const originalStroke = prototype.stroke;
  const originalStrokeRect = prototype.strokeRect;
  if (typeof originalFill !== "function" || typeof originalStroke !== "function" || typeof originalStrokeRect !== "function") return;

  const normalizeColor = value => String(value ?? "").replace(/\s+/g, "").toLowerCase();
  const fillPalette = new Map([
    ["rgba(108,176,255,0.6)", "rgba(0, 210, 90, 0.68)"],
    ["rgba(22,105,220,0.46)", "rgba(0, 195, 80, 0.72)"],
  ]);
  const strokePalette = new Map([
    ["rgba(28,98,205,0.34)", { color: "rgba(0, 150, 65, 0.72)", widthScale: 1.15 }],
    ["rgba(38,117,235,0.95)", { color: "rgba(0, 82, 255, 1)", widthScale: 1.25 }],
    ["rgba(235,193,36,0.95)", { color: "rgba(255, 190, 0, 1)", widthScale: 1.25 }],
  ]);

  function isRecognitionPreview(context) {
    return context?.canvas?.id === "source-canvas"
      && document.getElementById("import-canvas-card")?.classList.contains("preview-mode");
  }

  prototype.fill = function recognitionPreviewFill(...args) {
    if (!isRecognitionPreview(this)) return originalFill.apply(this, args);
    const mapped = fillPalette.get(normalizeColor(this.fillStyle));
    if (!mapped) return originalFill.apply(this, args);

    const previousStyle = this.fillStyle;
    this.fillStyle = mapped;
    try {
      return originalFill.apply(this, args);
    } finally {
      this.fillStyle = previousStyle;
    }
  };

  function drawMappedStroke(context, draw, args) {
    if (!isRecognitionPreview(context)) return draw.apply(context, args);
    const mapped = strokePalette.get(normalizeColor(context.strokeStyle));
    if (!mapped) return draw.apply(context, args);

    const previousStyle = context.strokeStyle;
    const previousWidth = context.lineWidth;
    context.strokeStyle = mapped.color;
    context.lineWidth = previousWidth * mapped.widthScale;
    try {
      return draw.apply(context, args);
    } finally {
      context.strokeStyle = previousStyle;
      context.lineWidth = previousWidth;
    }
  }

  prototype.stroke = function recognitionPreviewStroke(...args) {
    return drawMappedStroke(this, originalStroke, args);
  };

  prototype.strokeRect = function recognitionPreviewStrokeRect(...args) {
    return drawMappedStroke(this, originalStrokeRect, args);
  };

  prototype[PATCH_FLAG] = true;
})(window);
