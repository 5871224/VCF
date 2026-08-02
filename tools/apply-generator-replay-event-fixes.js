"use strict";

const fs = require("fs");
const { spawnSync } = require("child_process");

function fail(message) { throw new Error(`[題目產生器事件回放驗證] ${message}`); }
function check(filename, tokens, forbidden = []) {
  const source = fs.readFileSync(filename, "utf8");
  for (const token of tokens) if (!source.includes(token)) fail(`${filename} 缺少：${token}`);
  for (const token of forbidden) if (source.includes(token)) fail(`${filename} 仍殘留：${token}`);
  const result = spawnSync(process.execPath, ["--check", filename], { encoding: "utf8" });
  if (result.status !== 0) fail(`${filename} 語法檢查失敗：${result.stderr}`);
}

check("makevcf-generator-core.js", [
  "function genOnGeneratorEvent(",
  "function genEmitGeneratorEvent(",
  "function genBeginGeneratorOperation(",
  "function genRunValidationOperation(",
  "function genBeginStoneAttempt(",
  'genEmitGeneratorEvent("search:trimmed"',
]);
check("makevcf-generator-main.js", [
  'genEmitGeneratorEvent("material:selected"',
  'genEmitGeneratorEvent("generation:start"',
  'genEmitGeneratorEvent("generation:result"',
  'genEmitGeneratorEvent("generation:end"',
  "genRunValidationOperation(",
]);
check("makevcf-generator-summary.js", [
  'materialType: "forbiddenSkeleton"',
  "genRunValidationOperation(",
]);
check("makevcf-generator-defense-points.js", [
  'phase: "mid"',
  'phase: "final"',
  "validateWithRankedDefense(",
  "genBeginStoneAttempt(",
  "genEndStoneAttempt(",
], [
  "genReplayBeginDefenderAttempt",
  "genReplayEndDefenderAttempt",
]);
check("makevcf-generator-extension-other-vcf-fix.js", [
  'phase: "balance"',
  "filledAttackerStone",
  "新增其他攻方 VCF",
  "genBeginStoneAttempt(",
  "genEndStoneAttempt(",
], [
  "genReplayBeginDefenderAttempt",
  "genReplayEndDefenderAttempt",
]);
check("makevcf-generator-progress.js", [
  'genOnGeneratorEvent("generation:start"',
  'genOnGeneratorEvent("validation:start"',
  'genOnGeneratorEvent("stone:start"',
  'genOnGeneratorEvent("search:end"',
  'genOnGeneratorEvent("generation:end"',
], [
  "genSetBusy =",
  "genValidateCandidate =",
  "genValidateExtensionCandidate =",
  "genShowResult =",
  "genEngine.findVCF =",
  "genEngine.trimGroups =",
  "harvestOldReplay",
  "captureOldStep",
  "setTimeout(",
  "Worker.prototype.postMessage",
]);

console.log("題目產生器搜尋、驗證、補子與單一事件回放驗證通過。");
