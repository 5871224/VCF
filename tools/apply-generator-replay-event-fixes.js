"use strict";

const fs = require("fs");
const { spawnSync } = require("child_process");
function fail(message) { throw new Error(`[題目產生器架構驗證] ${message}`); }
function source(file) { return fs.readFileSync(file, "utf8"); }
function requireTokens(file, tokens, forbidden = []) {
  const text = source(file);
  for (const token of tokens) if (!text.includes(token)) fail(`${file} 缺少：${token}`);
  for (const token of forbidden) if (text.includes(token)) fail(`${file} 仍殘留：${token}`);
  const checked = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
  if (checked.status !== 0) fail(`${file} 語法失敗：${checked.stderr}`);
}
requireTokens("makevcf-generator-core.js", [
  "genRegisterFindRequestProvider", "genRegisterCandidateDecorator", "genRegisterSeedProvider",
  "genRegisterResultPresenter", "genRunValidationOperation", "genBeginStoneAttempt",
]);
requireTokens("makevcf-generator-search-policy.js", [
  "validateWithRankedDefense", "rankDefensePoints", "genValidateBySearchPolicy", "genCleanFinalTargetBoard",
]);
requireTokens("makevcf-generator-finalize.js", [
  "genFinalizeGeneratedResult", "fillRequiredColor", "validateFilledState",
]);
requireTokens("makevcf-generator-progress.js", [
  'genOnGeneratorEvent("generation:start"', 'genOnGeneratorEvent("validation:start"',
  'genOnGeneratorEvent("stone:start"', 'genOnGeneratorEvent("generation:end"',
], ["genSetBusy =", "genValidateCandidate =", "genEngine.findVCF =", "MutationObserver", "setInterval("]);
requireTokens("makevcf-generator-status-detail.js", [
  "genRegisterStatusFormatter", 'genOnGeneratorEvent("search:start"', 'genOnGeneratorEvent("stone:start"',
], ["genSetStatus =", "genEngine.findVCF =", "setTimeout("]);
console.log("題目產生器單一政策、事件回放與狀態架構驗證通過。");
