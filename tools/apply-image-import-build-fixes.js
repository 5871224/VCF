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

function replaceOnce(content, oldText, newText, label) {
  const first = content.indexOf(oldText);
  if (first < 0) fail(`${label}：找不到預期程式區塊`);
  if (content.indexOf(oldText, first + oldText.length) >= 0) {
    fail(`${label}：預期程式區塊出現超過一次`);
  }
  return content.replace(oldText, newText);
}

syntaxCheck('makevcf-generator-image-import-fix.js', runtime);
syntaxCheck('makevcf-generator-image-import-fix-v2.js', houghV2);
syntaxCheck('makevcf-mobile.js', loader);

// 每次補守／唯一化／補齊開始時建立本輪共用的失敗狀態集合。
// 只有「相同前置盤面＋相同座標」的完整分支失敗後才禁止重試；
// 同一座標在不同前置盤面仍可能有效，必須允許再次嘗試。
let defense = fs.readFileSync(defensePath, 'utf8');
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
  '中途補守失敗點黑名單',
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
  '最終唯一化失敗點黑名單',
);

const defenseBudgetCount = (defense.match(/\{ nodes: 0 \}/g) || []).length;
if (defenseBudgetCount !== 4) {
  fail(`補守輪次預期有 4 個 budget，實際為 ${defenseBudgetCount}`);
}
defense = defense.replaceAll(
  '{ nodes: 0 }',
  '{ nodes: 0, failedPoints: new Set() }',
);
for (const token of [
  'if (failedPoints.has(failedKey)) continue;',
  'failedPoints.add(failedKey);',
  '{ nodes: 0, failedPoints: new Set() }',
]) {
  if (!defense.includes(token)) fail(`補守失敗點防重缺少：${token}`);
}
syntaxCheck('makevcf-generator-defense-points.js', defense);
fs.writeFileSync(defensePath, defense, 'utf8');

let balance = fs.readFileSync(balancePath, 'utf8');
const autoBlockLoop = `    const ranked = await getDefenseFrequency(candidate, shorter, targets[0].moves);
    for (const { idx } of ranked.slice(0, GEN_AUTO_BLOCK_BRANCH_LIMIT)) {
      if (genCancelled) return null;
      const next = addDefenderToCandidate(candidate, idx);
      if (!next) continue;
      const result = await validateWithAutoBlock(next, expectedSteps, previousResult, options, budget);
      if (result) return result;
    }
`;
const autoBlockLoopWithGuard = `    const ranked = await getDefenseFrequency(candidate, shorter, targets[0].moves);
    const failedPoints =
      budget.failedPoints instanceof Set
        ? budget.failedPoints
        : (budget.failedPoints = new Set());
    const availableRanked = ranked
      .filter(({ idx }) => {
        const failedKey =
          String(idx) + ":" + Array.from(candidate.board).slice(0, 225).join("");
        return !failedPoints.has(failedKey);
      })
      .slice(0, GEN_AUTO_BLOCK_BRANCH_LIMIT);

    for (const { idx } of availableRanked) {
      if (genCancelled) return null;
      const failedKey =
        String(idx) + ":" + Array.from(candidate.board).slice(0, 225).join("");
      const next = addDefenderToCandidate(candidate, idx);
      if (!next) continue;
      const result = await validateWithAutoBlock(next, expectedSteps, previousResult, options, budget);
      if (result) return result;
      if (!genCancelled) failedPoints.add(failedKey);
    }
`;
balance = replaceOnce(
  balance,
  autoBlockLoop,
  autoBlockLoopWithGuard,
  '舊較短 VCF 補守失敗點黑名單',
);

const fillLoop = `    const available = await dynamicFillCandidates(state, pool);
    if (!available.length) return null;
    const ordered = weightedRandomOrder(available).slice(0, GEN_FILL_BRANCH_LIMIT);

    for (const item of ordered) {
      if (genCancelled) return null;
      const next = await validateFilledState(state, item.idx, targetSteps);
      if (!next) continue;
      const completed = await fillDefendersRecursive(next, pool, targetSteps, remaining - 1, budget);
      if (completed) return completed;
    }
`;
const fillLoopWithGuard = `    const failedPoints =
      budget.failedPoints instanceof Set
        ? budget.failedPoints
        : (budget.failedPoints = new Set());
    const available = (await dynamicFillCandidates(state, pool))
      .filter(item => {
        const failedKey =
          String(item.idx) + ":" + Array.from(state.board).slice(0, 225).join("");
        return !failedPoints.has(failedKey);
      });
    if (!available.length) return null;
    const ordered = weightedRandomOrder(available).slice(0, GEN_FILL_BRANCH_LIMIT);

    for (const item of ordered) {
      if (genCancelled) return null;
      const failedKey =
        String(item.idx) + ":" + Array.from(state.board).slice(0, 225).join("");
      const next = await validateFilledState(state, item.idx, targetSteps);
      if (!next) {
        failedPoints.add(failedKey);
        continue;
      }
      const completed = await fillDefendersRecursive(next, pool, targetSteps, remaining - 1, budget);
      if (completed) return completed;
      if (!genCancelled) failedPoints.add(failedKey);
    }
`;
balance = replaceOnce(
  balance,
  fillLoop,
  fillLoopWithGuard,
  '補齊子數失敗點黑名單',
);

const balanceBudgetCount = (balance.match(/\{ nodes: 0 \}/g) || []).length;
if (balanceBudgetCount !== 3) {
  fail(`補齊輪次預期有 3 個 budget，實際為 ${balanceBudgetCount}`);
}
balance = balance.replaceAll(
  '{ nodes: 0 }',
  '{ nodes: 0, failedPoints: new Set() }',
);
for (const token of [
  'Array.from(candidate.board).slice(0, 225).join("")',
  'Array.from(state.board).slice(0, 225).join("")',
  'failedPoints.add(failedKey);',
  '{ nodes: 0, failedPoints: new Set() }',
]) {
  if (!balance.includes(token)) fail(`補齊失敗點防重缺少：${token}`);
}
syntaxCheck('makevcf-generator-balance.js', balance);
fs.writeFileSync(balancePath, balance, 'utf8');

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

// The old root script list also appends an experimental eval/worker.js benchmark.
// Keep the file for non-Bitboard experiments, but make it a no-op on the official
// root workbench so no second search engine or duplicate controls are created.
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

console.log('圖片匯入、根網址 Bitboard 工作台與盤面分層失敗點防重已通過正式建置驗證。');
