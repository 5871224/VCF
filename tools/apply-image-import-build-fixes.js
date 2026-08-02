"use strict";

const fs = require("fs");
const { spawnSync } = require("child_process");

function fail(message) { throw new Error(`[正式建置驗證] ${message}`); }
function syntaxCheck(filename) {
  const result = spawnSync(process.execPath, ["--check", filename], { encoding: "utf8" });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.status !== 0) fail(`${filename} JavaScript 語法檢查失敗`);
}
function requireTokens(filename, tokens) {
  const source = fs.readFileSync(filename, "utf8");
  for (const token of tokens) if (!source.includes(token)) fail(`${filename} 缺少：${token}`);
  return source;
}

requireTokens("makevcf-generator-image-import-fix.js", [
  "function removeCenterText(imageData)",
  "function analyzeStoneAt(",
  "function fitLattice(bundle, width, height)",
  "function addSyntheticOuterLines(",
]);
const defense = requireTokens("makevcf-generator-defense-points.js", [
  "async function rankDefensePoints(state, unwanted)",
  "async function validateWithRankedDefense(",
  "async function cleanFinalTargetBoard(state, expectedBoard, targetSteps, budget)",
  'phase: "mid"',
  'phase: "final"',
  "genReplayBeginDefenderAttempt",
  "genReplayEndDefenderAttempt",
]);
requireTokens("makevcf-generator-balance.js", [
  "generatorOptionsWithFinalBalance",
  "黑白子數已補齊",
]);
requireTokens("makevcf-generator-extension-other-vcf-fix.js", [
  "requiredFinalFill",
  "FILL_TIME_LIMIT_MS",
  'mode: "shortest"',
  'phase: "balance"',
]);
const html = requireTokens("makevcf.html", [
  "__vcfRootBitboardWorkbench",
  "window.history.replaceState",
  '<script src="rapfi/vcf-bitboard-generator-compat.js"></script>',
  '<script src="makevcf-generator-target-board-v3.js"></script>',
  '<script src="makevcf-generator-defense-points.js"></script>',
  '<script src="makevcf-generator-progress.js"></script>',
  '<script src="rapfi/rapfi-bitboard-dashboard.js"></script>',
]);
const evaluator = fs.readFileSync("eval/Evaluator.js", "utf8");
requireTokens("makevcf-optimized-search-v2.js", [
  "if (window.__vcfRootBitboardWorkbench) return;",
]);

for (const obsolete of [
  "validateWithStreamingDefense",
  "budget.failedPoints instanceof Set",
  "failedPoints.add(failedKey)",
]) if (defense.includes(obsolete)) fail(`補守仍殘留舊邏輯：${obsolete}`);
if (html.includes("installRootBitboardFeatures")) fail("根工作台仍動態載入正式功能");
if (evaluator.includes("loadRootGeneratorCompatibilityAfterEvaluator")) fail("Evaluator.js 仍動態載入相容層");

for (const filename of [
  "makevcf-mobile.js",
  "makevcf-generator-reuse-bonus.js",
  "rapfi/vcf-bitboard-generator-compat.js",
  "makevcf-generator-image-import-fix.js",
  "makevcf-generator-defense-points.js",
  "makevcf-generator-balance.js",
  "makevcf-generator-extension-other-vcf-fix.js",
  "makevcf-generator-progress.js",
  "eval/Evaluator.js",
  "makevcf-optimized-search-v2.js",
]) syntaxCheck(filename);

console.log("圖片匯入、固定載入順序、補守、最終補色與根工作台來源一致性驗證通過。");
