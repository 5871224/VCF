const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const runtimePath = 'makevcf-generator-image-import-fix.js';
const houghV2Path = 'makevcf-generator-image-import-fix-v2.js';
const loaderPath = 'makevcf-mobile.js';
const evaluatorPath = 'eval/Evaluator.js';
const optimizedPath = 'makevcf-optimized-search-v2.js';
const defensePath = 'makevcf-generator-defense-points.js';
const balancePath = 'makevcf-generator-balance.js';
const finalBalancePath = 'makevcf-generator-extension-other-vcf-fix.js';
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

function replaceOnce(content, oldText, newText, label) {
  const first = content.indexOf(oldText);
  if (first < 0) fail(`${label}：找不到預期程式區塊`);
  if (content.indexOf(oldText, first + oldText.length) >= 0) {
    fail(`${label}：預期程式區塊出現超過一次`);
  }
  return content.replace(oldText, newText);
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
  'makevcf-generator-extension-other-vcf-fix.js',
  'loadImageImportRuntimeFixes',
]) {
  if (!loader.includes(token)) fail(`載入入口缺少：${token}`);
}

syntaxCheck('makevcf-generator-image-import-fix.js', runtime);
syntaxCheck('makevcf-generator-image-import-fix-v2.js', houghV2);
syntaxCheck('makevcf-mobile.js', loader);

// 串流補守的同一座標只有在「相同前置盤面」完整失敗後才封鎖。
// 正式建置在乾淨 checkout 上補入防重；已補入時則只做驗證，保持可重跑。
let defense = fs.readFileSync(defensePath, 'utf8');
if (!defense.includes('budget.failedPoints instanceof Set')) {
  const defenseLayerLoop = `      for (const idx of points) {
        if (genCancelled) return null;
        const next = addLayerDefender(candidate, idx);
        if (!next) continue;
        const result = await validateWithStreamingDefense(
          next,
          expectedSteps,
          previousResult,
          policy,
          budget,
        );
        if (result) return result;
      }
`;
  const defenseLayerLoopWithGuard = `      const failedPoints =
        budget.failedPoints instanceof Set
          ? budget.failedPoints
          : (budget.failedPoints = new Set());

      for (const idx of points) {
        if (genCancelled) return null;
        const failedKey =
          String(idx) + ":" + Array.from(candidate.board).slice(0, 225).join("");
        if (failedPoints.has(failedKey)) continue;
        const next = addLayerDefender(candidate, idx);
        if (!next) continue;
        const result = await validateWithStreamingDefense(
          next,
          expectedSteps,
          previousResult,
          policy,
          budget,
        );
        if (result) return result;
        if (!genCancelled) failedPoints.add(failedKey);
      }
`;
  defense = replaceOnce(
    defense,
    defenseLayerLoop,
    defenseLayerLoopWithGuard,
    '中途補守失敗點防重',
  );

  const defenseFinalLoop = `      for (const idx of points) {
        if (genCancelled) return null;
        const added = addFinalDefender(
          state,
          expectedBoard,
          idx,
        );
        if (!added) continue;
        const result = await cleanFinalTargetBoard(
          added.state,
          added.expectedBoard,
          targetSteps,
          budget,
        );
        if (result) return result;
      }
`;
  const defenseFinalLoopWithGuard = `      const failedPoints =
        budget.failedPoints instanceof Set
          ? budget.failedPoints
          : (budget.failedPoints = new Set());

      for (const idx of points) {
        if (genCancelled) return null;
        const failedKey =
          String(idx) + ":" + Array.from(state.board).slice(0, 225).join("");
        if (failedPoints.has(failedKey)) continue;
        const added = addFinalDefender(
          state,
          expectedBoard,
          idx,
        );
        if (!added) continue;
        const result = await cleanFinalTargetBoard(
          added.state,
          added.expectedBoard,
          targetSteps,
          budget,
        );
        if (result) return result;
        if (!genCancelled) failedPoints.add(failedKey);
      }
`;
  defense = replaceOnce(
    defense,
    defenseFinalLoop,
    defenseFinalLoopWithGuard,
    '最終唯一化失敗點防重',
  );

  const defenseBudgetCount = (defense.match(/\{ nodes: 0 \}/g) || []).length;
  if (defenseBudgetCount !== 4) {
    fail(`補守輪次預期有 4 個 budget，實際為 ${defenseBudgetCount}`);
  }
  defense = defense.replaceAll(
    '{ nodes: 0 }',
    '{ nodes: 0, failedPoints: new Set() }',
  );
  fs.writeFileSync(defensePath, defense, 'utf8');
}

for (const token of [
  'Array.from(candidate.board).slice(0, 225).join("")',
  'Array.from(state.board).slice(0, 225).join("")',
  'failedPoints.add(failedKey);',
  '{ nodes: 0, failedPoints: new Set() }',
]) {
  if (!defense.includes(token)) fail(`補守失敗點防重缺少：${token}`);
}
syntaxCheck('makevcf-generator-defense-points.js', defense);

// 黑白子數補齊已與 VCF 補守完全分離；建置只驗證新結構，不再注入舊遞迴。
const balance = fs.readFileSync(balancePath, 'utf8');
const finalBalance = fs.readFileSync(finalBalancePath, 'utf8');
for (const token of [
  'generatorOptionsWithFinalBalance',
  '黑白子數已補齊',
]) {
  if (!balance.includes(token)) fail(`最終補齊控制缺少：${token}`);
}
for (const removedToken of [
  'validateWithAutoBlock',
  'fillDefenderStones',
  'balanceFillDefenders',
]) {
  if (balance.includes(removedToken)) {
    fail(`balance.js 仍殘留舊混合邏輯：${removedToken}`);
  }
}
for (const token of [
  'requiredFinalFill',
  'boardKey(board, remaining)',
  'FILL_TIME_LIMIT_MS',
  'cancelGeneratorImmediately',
  'mode: "shortest"',
]) {
  if (!finalBalance.includes(token)) fail(`最終補齊驗證缺少：${token}`);
}
for (const removedToken of [
  'balanceFillBlack',
  'balanceFillWhite',
  'balanceFillAttackers',
  'balanceFillDefenders',
  'balanceFillStones',
]) {
  if (finalBalance.includes(removedToken)) {
    fail(`最終補齊仍重複保存分類清單：${removedToken}`);
  }
}
syntaxCheck('makevcf-generator-balance.js', balance);
syntaxCheck('makevcf-generator-extension-other-vcf-fix.js', finalBalance);

// GitHub Pages copies makevcf.html to both /index.html and /makevcf.html.
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

let evaluator = fs.readFileSync(evaluatorPath, 'utf8');
const evaluatorCompatMarker = '__vcfRootGeneratorCompatAfterEvaluator';
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
  fs.writeFileSync(evaluatorPath, evaluator, 'utf8');
}
syntaxCheck('Evaluator.js', evaluator);

let optimized = fs.readFileSync(optimizedPath, 'utf8');
const optimizedMarker = 'if (window.__vcfRootBitboardWorkbench) return;';
if (!optimized.includes(optimizedMarker)) {
  const oldHeader = `  if (window.__iterativeVCFExperimentLoaded) return;\n  window.__iterativeVCFExperimentLoaded = true;`;
  const newHeader = `  if (window.__iterativeVCFExperimentLoaded) return;\n  if (window.__vcfRootBitboardWorkbench) return;\n  window.__iterativeVCFExperimentLoaded = true;`;
  if (!optimized.includes(oldHeader)) fail('找不到舊優化搜尋初始化位置');
  optimized = optimized.replace(oldHeader, newHeader);
  fs.writeFileSync(optimizedPath, optimized, 'utf8');
}
syntaxCheck('makevcf-optimized-search-v2.js', optimized);

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
if (!optimized.includes(optimizedMarker)) {
  fail('舊優化搜尋仍會在根網址啟動');
}

console.log('圖片匯入、根網址 Bitboard 工作台、VCF 補守防重與最終黑白子數分離已通過正式建置驗證。');
