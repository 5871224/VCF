const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const runtimePath = 'makevcf-generator-image-import-fix.js';
const houghV2Path = 'makevcf-generator-image-import-fix-v2.js';
const loaderPath = 'makevcf-mobile.js';
const evaluatorPath = 'eval/Evaluator.js';
const htmlPath = 'makevcf.html';
const specPath = '規格書.MD';

function fail(message) {
  throw new Error(`[正式建置驗證] ${message}`);
}

for (const requiredPath of [
  runtimePath,
  houghV2Path,
  loaderPath,
  evaluatorPath,
  htmlPath,
  specPath,
]) {
  if (!fs.existsSync(requiredPath)) fail(`缺少必要檔案：${requiredPath}`);
}

const runtime = fs.readFileSync(runtimePath, 'utf8');
const houghV2 = fs.readFileSync(houghV2Path, 'utf8');
const loader = fs.readFileSync(loaderPath, 'utf8');

for (const token of [
  'function removeCenterText(imageData)',
  'function analyzeStoneAt(',
  'darkOutlineCoverage >= 0.50',
  'const fallbackRecognitionCall = warpCallSequence % 2 === 0;',
]) {
  if (!runtime.includes(token)) fail(`數字棋子修正模組缺少：${token}`);
}

for (const token of [
  'function fitLattice(bundle, width, height)',
  'function addSyntheticOuterLines(',
  'const originalValues = Array.from(lines.data32S || [])',
  'patchedHoughLinesP[V2_FLAG] = true',
  'window.setInterval(',
]) {
  if (!houghV2.includes(token)) fail(`缺邊晶格修正模組缺少：${token}`);
}

for (const token of [
  'makevcf-generator-image-import-fix.js',
  'makevcf-generator-image-import-fix-v2.js',
  'loadImageImportRuntimeFixes',
]) {
  if (!loader.includes(token)) fail(`載入入口缺少：${token}`);
}

function syntaxCheck(filename, content) {
  const temporaryPath = path.join(os.tmpdir(), filename);
  fs.writeFileSync(temporaryPath, content, 'utf8');
  const result = spawnSync(process.execPath, ['--check', temporaryPath], {
    encoding: 'utf8',
    stdio: 'pipe',
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.status !== 0) fail(`${filename} JavaScript 語法檢查失敗`);
}

syntaxCheck('makevcf-generator-image-import-fix.js', runtime);
syntaxCheck('makevcf-generator-image-import-fix-v2.js', houghV2);
syntaxCheck('makevcf-mobile.js', loader);

// GitHub Pages copies makevcf.html to both /index.html and /makevcf.html.
// Turn both root-level files into the same Bitboard workbench directly, without
// redirecting to /rapfi/. The nested /rapfi/ page keeps using the existing Pages
// injection and therefore ignores these root-only loaders.
let html = fs.readFileSync(htmlPath, 'utf8');
const firstScriptMarker = '<script>\n"use strict";';
const bodyEndMarker = '</body>';
if (!html.includes(firstScriptMarker)) fail('makevcf.html 找不到主要程式入口');
if (!html.includes(bodyEndMarker)) fail('makevcf.html 找不到 body 結尾');

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

if (!html.includes('__vcfRootBitboardWorkbench')) {
  html = html.replace(firstScriptMarker, rootBridge + firstScriptMarker);
  html = html.replace(bodyEndMarker, rootFeatures + bodyEndMarker);
  fs.writeFileSync(htmlPath, html, 'utf8');
}

// The root Pages script list still loads the old Evaluator files before
// makevcf-generator-core.js. Re-apply the Bitboard compatibility layer at the
// end of Evaluator.js so it is the last definition seen by the generator core.
let evaluator = fs.readFileSync(evaluatorPath, 'utf8');
const evaluatorCompatMarker = '__vcfRootGeneratorCompatAfterEvaluator';
const evaluatorCompat = String.raw`

(function loadRootGeneratorCompatibilityAfterEvaluator() {
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
  fs.writeFileSync(evaluatorPath, evaluator, 'utf8');
}
syntaxCheck('Evaluator.js', evaluator);

for (const token of [
  '__vcfRootBitboardWorkbench',
  'rapfi/engine/vcf-bitboard-engine.js',
  'rapfi/vcf-bitboard-main.js',
  'rapfi/rapfi-bitboard-dashboard.js',
  'rapfi/vcf-shortest-vcf-ui.js',
  'rapfi/vcf-forbidden-overlay.js',
]) {
  if (!html.includes(token)) fail(`根網址 Bitboard 工作台缺少：${token}`);
}
if (!evaluator.includes('rapfi/vcf-bitboard-generator-compat.js')) {
  fail('Evaluator.js 未在產生器核心前重載 Bitboard 相容層');
}

console.log('圖片匯入修正與根網址 Bitboard 工作台已通過正式建置驗證。');
