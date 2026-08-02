const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const runtimePath = "makevcf-generator-image-import-fix.js";
const loaderPath = "makevcf-mobile.js";
const evaluatorPath = "eval/Evaluator.js";
const optimizedPath = "makevcf-optimized-search-v2.js";
const defensePath = "makevcf-generator-defense-points.js";
const balancePath = "makevcf-generator-balance.js";
const finalBalancePath = "makevcf-generator-extension-other-vcf-fix.js";
const htmlPath = "makevcf.html";
const specPath = "規格書.MD";

function fail(message) {
  throw new Error(`[正式建置驗證] ${message}`);
}

for (const requiredPath of [
  runtimePath,
  loaderPath,
  evaluatorPath,
  optimizedPath,
  defensePath,
  balancePath,
  finalBalancePath,
  htmlPath,
  specPath,
]) {
  if (!fs.existsSync(requiredPath)) fail(`缺少必要檔案：${requiredPath}`);
}

function syntaxCheck(filename, content) {
  const safeName = String(filename).replace(/[\\/]/g, "_");
  const temporaryPath = path.join(os.tmpdir(), safeName);
  fs.writeFileSync(temporaryPath, content, "utf8");
  const result = spawnSync(process.execPath, ["--check", temporaryPath], {
    encoding: "utf8",
    stdio: "pipe",
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.status !== 0) fail(`${filename} JavaScript 語法檢查失敗`);
}

const runtime = fs.readFileSync(runtimePath, "utf8");
const loader = fs.readFileSync(loaderPath, "utf8");

for (const token of [
  "function removeCenterText(imageData)",
  "function analyzeStoneAt(",
  "darkOutlineCoverage >= 0.50",
  "const fallbackRecognitionCall = warpCallSequence % 2 === 0;",
]) {
  if (!runtime.includes(token)) fail(`數字棋子修正模組缺少：${token}`);
}

for (const token of [
  "function fitLattice(bundle, width, height)",
  "function addSyntheticOuterLines(",
  "const originalValues = Array.from(lines.data32S || [])",
  "patchedHoughLinesP[V2_FLAG] = true",
  "window.setInterval(",
]) {
  if (!runtime.includes(token)) fail(`缺邊晶格修正模組缺少：${token}`);
}

for (const token of [
  "makevcf-generator-image-import-fix.js",
  "makevcf-generator-extension-other-vcf-fix.js",
  "loadImageImportRuntimeFixes",
]) {
  if (!loader.includes(token)) fail(`載入入口缺少：${token}`);
}

syntaxCheck(runtimePath, runtime);
syntaxCheck(loaderPath, loader);

// 新版較短／其他 VCF 使用多組搜尋、覆蓋數排序與有界遞迴回溯。
// 舊版串流補守的 failedPoints 注入已淘汰，正式建置只驗證新版結構。
const defense = fs.readFileSync(defensePath, "utf8");
for (const token of [
  "const STATE_LIMIT = 96;",
  "async function rankDefensePoints(state, unwanted)",
  "async function validateWithRankedDefense(",
  "const ranked = await rankDefensePoints(candidate, unwanted);",
  "for (const { idx } of ranked)",
  "async function cleanFinalTargetBoard(state, expectedBoard, targetSteps, budget)",
  "budget.nodes++ >= STATE_LIMIT",
  "genSelectedPruning()",
]) {
  if (!defense.includes(token)) fail(`新版多組補守缺少：${token}`);
}
for (const obsolete of [
  "validateWithStreamingDefense",
  "budget.failedPoints instanceof Set",
  "failedPoints.add(failedKey)",
]) {
  if (defense.includes(obsolete)) fail(`新版多組補守仍殘留舊邏輯：${obsolete}`);
}
syntaxCheck(defensePath, defense);

// 黑白子數補齊已與 VCF 補守完全分離；建置只驗證新結構，不再注入舊遞迴。
const balance = fs.readFileSync(balancePath, "utf8");
const finalBalance = fs.readFileSync(finalBalancePath, "utf8");
for (const token of [
  "generatorOptionsWithFinalBalance",
  "黑白子數已補齊",
]) {
  if (!balance.includes(token)) fail(`最終補齊控制缺少：${token}`);
}
for (const removedToken of [
  "validateWithAutoBlock",
  "fillDefenderStones",
  "balanceFillDefenders",
]) {
  if (balance.includes(removedToken)) {
    fail(`balance.js 仍殘留舊混合邏輯：${removedToken}`);
  }
}
for (const token of [
  "requiredFinalFill",
  "boardKey(board, remaining)",
  "FILL_TIME_LIMIT_MS",
  "cancelGeneratorImmediately",
  'mode: "shortest"',
]) {
  if (!finalBalance.includes(token)) fail(`最終補齊驗證缺少：${token}`);
}
for (const removedToken of [
  "balanceFillBlack",
  "balanceFillWhite",
  "balanceFillAttackers",
  "balanceFillDefenders",
  "balanceFillStones",
]) {
  if (finalBalance.includes(removedToken)) {
    fail(`最終補齊仍重複保存分類清單：${removedToken}`);
  }
}
syntaxCheck(balancePath, balance);
syntaxCheck(finalBalancePath, finalBalance);

// GitHub Pages copies makevcf.html to both /index.html and /makevcf.html.
let html = fs.readFileSync(htmlPath, "utf8");
const firstScriptPattern = /<script>\r?\n"use strict";/;
const bodyEndMarker = "</body>";
if (!firstScriptPattern.test(html)) fail("makevcf.html 找不到主要程式入口");
if (!html.includes(bodyEndMarker)) fail("makevcf.html 找不到 body 結尾");

const rootBridge = String.raw`<script>
(function installRootBitboardBridge() {
  const pathname = window.location.pathname.replace(/\/+$/, "");
  const isRootWorkbench =
    pathname.endsWith("/VCF") ||
    pathname.endsWith("/VCF/index.html") ||
    pathname.endsWith("/VCF/makevcf.html");
  if (!isRootWorkbench) return;

  window.__vcfRootBitboardWorkbench = true;
  document.write('<script src="rapfi/engine/vcf-bitboard-engine.js"><\/script>');
  document.write('<script src="rapfi/vcf-bitboard-main.js"><\/script>');
})();
</script>
`;

const rootFeatures = String.raw`<script>
(function installRootBitboardFeatures() {
  if (!window.__vcfRootBitboardWorkbench) return;

  async function loadScript(src) {
    await new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = src;
      script.async = false;
      script.addEventListener("load", resolve, { once: true });
      script.addEventListener("error", () => reject(new Error("載入失敗：" + src)), { once: true });
      document.head.appendChild(script);
    });
  }

  async function loadWorkbenchFeatures() {
    try {
      await loadScript("rapfi/rapfi-bitboard-dashboard.js");
      await loadScript("rapfi/vcf-shortest-vcf-ui.js");
      await loadScript("rapfi/vcf-forbidden-overlay.js");
    } catch (error) {
      console.error("根網址新版工作台載入失敗", error);
      const status = document.getElementById("status");
      if (status) status.textContent = error.message || String(error);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", loadWorkbenchFeatures, { once: true });
  } else {
    loadWorkbenchFeatures();
  }
})();
</script>
`;

if (!html.includes("__vcfRootBitboardWorkbench")) {
  html = html.replace(firstScriptPattern, marker => rootBridge + marker);
  html = html.replace(bodyEndMarker, rootFeatures + bodyEndMarker);
  fs.writeFileSync(htmlPath, html, "utf8");
}

let evaluator = fs.readFileSync(evaluatorPath, "utf8");
const evaluatorCompatMarker = "__vcfRootGeneratorCompatAfterEvaluator";
const evaluatorCompat = String.raw`

(function loadRootGeneratorCompatibilityAfterEvaluator() {
  if (typeof window === "undefined") return;
  const pathname = window.location.pathname.replace(/\/+$/, "");
  const isRootWorkbench =
    pathname.endsWith("/VCF") ||
    pathname.endsWith("/VCF/index.html") ||
    pathname.endsWith("/VCF/makevcf.html");
  if (!isRootWorkbench || window.${evaluatorCompatMarker}) return;
  window.${evaluatorCompatMarker} = true;
  document.write('<script src="rapfi/vcf-bitboard-generator-compat.js"><\/script>');
})();
`;
if (!evaluator.includes(evaluatorCompatMarker)) {
  evaluator += evaluatorCompat;
  fs.writeFileSync(evaluatorPath, evaluator, "utf8");
}
syntaxCheck(evaluatorPath, evaluator);

let optimized = fs.readFileSync(optimizedPath, "utf8");
const optimizedMarker = "if (window.__vcfRootBitboardWorkbench) return;";
if (!optimized.includes(optimizedMarker)) {
  const lineBreak = optimized.includes("\r\n") ? "\r\n" : "\n";
  const oldHeader = [
    "  if (window.__iterativeVCFExperimentLoaded) return;",
    "  window.__iterativeVCFExperimentLoaded = true;",
  ].join(lineBreak);
  const newHeader = [
    "  if (window.__iterativeVCFExperimentLoaded) return;",
    "  if (window.__vcfRootBitboardWorkbench) return;",
    "  window.__iterativeVCFExperimentLoaded = true;",
  ].join(lineBreak);
  if (!optimized.includes(oldHeader)) fail("找不到舊優化搜尋初始化位置");
  optimized = optimized.replace(oldHeader, newHeader);
  fs.writeFileSync(optimizedPath, optimized, "utf8");
}
syntaxCheck(optimizedPath, optimized);

for (const token of [
  "__vcfRootBitboardWorkbench",
  "rapfi/engine/vcf-bitboard-engine.js",
  "rapfi/vcf-bitboard-main.js",
  "rapfi/rapfi-bitboard-dashboard.js",
  "rapfi/vcf-shortest-vcf-ui.js",
  "rapfi/vcf-forbidden-overlay.js",
]) {
  if (!html.includes(token)) fail(`根網址 Bitboard 工作台缺少：${token}`);
}
if (!evaluator.includes("rapfi/vcf-bitboard-generator-compat.js")) {
  fail("Evaluator.js 未在產生器核心前重載 Bitboard 相容層");
}
if (!optimized.includes(optimizedMarker)) {
  fail("舊優化搜尋仍會在根網址啟動");
}

console.log("圖片匯入、根網址 Bitboard 工作台、新版多組 VCF 補守與最終黑白子數分離已通過正式建置驗證。");
