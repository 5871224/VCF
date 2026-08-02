"use strict";

const fs = require("fs");
const { spawnSync } = require("child_process");

function fail(message) { throw new Error(`[補子回放事件驗證] ${message}`); }
function check(filename, tokens, forbidden = []) {
  const source = fs.readFileSync(filename, "utf8");
  for (const token of tokens) if (!source.includes(token)) fail(`${filename} 缺少：${token}`);
  for (const token of forbidden) if (source.includes(token)) fail(`${filename} 仍殘留：${token}`);
  const result = spawnSync(process.execPath, ["--check", filename], { encoding: "utf8" });
  if (result.status !== 0) fail(`${filename} 語法檢查失敗：${result.stderr}`);
}

check("makevcf-generator-defense-points.js", [
  'phase: "mid"',
  'phase: "final"',
  "validateWithRankedDefense(",
  "genReplayBeginDefenderAttempt",
  "genReplayEndDefenderAttempt",
]);
check("makevcf-generator-extension-other-vcf-fix.js", [
  'phase: "balance"',
  "filledAttackerStone",
  "新增其他攻方 VCF",
]);
check("makevcf-generator-progress.js", [
  "stageTitleForAddedStone(color, idx, attacker)",
  "genReplayBeginDefenderAttempt",
  "genReplayEndDefenderAttempt",
  'phase === "balance"',
  'role === "attacker"',
], [
  "Worker.prototype.postMessage",
  "MAX_KNOWN_BOARDS",
  "findOneStoneParent",
]);

console.log("補守、補齊子數與統一回放明確事件驗證通過。");
