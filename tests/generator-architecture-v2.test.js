"use strict";

const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");
const html = read("makevcf.html");
const scripts = Array.from(html.matchAll(/<script[^>]+src=["']([^"']+)["'][^>]*><\/script>/g), match => match[1]);
const generatorOrder = [
  "makevcf-generator-core.js",
  "makevcf-generator-base.js",
  "makevcf-generator-layer.js",
  "makevcf-generator-validate.js",
  "makevcf-generator-integrated.js",
  "makevcf-generator-options.js",
  "makevcf-generator-main.js",
  "makevcf-generator-summary.js",
  "makevcf-generator-search-policy.js",
  "makevcf-generator-finalize.js",
  "makevcf-generator-progress.js",
  "makevcf-generator-status-detail.js",
  "makevcf-generator-open-four-stop.js",
  "makevcf-generator-ui-compact.js",
  "makevcf-generator-layout-fix.js",
  "makevcf-generator-settings-persistence.js",
  "makevcf-generator-image-import-fix.js",
];
let previous = -1;
for (const file of generatorOrder) {
  const index = scripts.indexOf(file);
  if (index < 0) throw new Error(`missing generator module: ${file}`);
  if (index <= previous) throw new Error(`invalid generator order near ${file}`);
  previous = index;
}
if (new Set(scripts).size !== scripts.length) throw new Error("duplicate script source remains");

const removed = [
  "makevcf-generator-board.js",
  "makevcf-generator-reuse-bonus.js",
  "makevcf-generator-concentration.js",
  "makevcf-generator-order-mode.js",
  "makevcf-generator-balance.js",
  "makevcf-generator-unique.js",
  "makevcf-generator-target-board-v3.js",
  "makevcf-generator-defense-points.js",
  "makevcf-generator-extension-other-vcf-fix.js",
  "makevcf-generator-protected-defenders.js",
];
for (const file of removed) {
  if (fs.existsSync(path.join(root, file))) throw new Error(`obsolete module remains: ${file}`);
  if (html.includes(file)) throw new Error(`obsolete module remains in HTML: ${file}`);
}

const core = read("makevcf-generator-core.js");
for (const token of [
  "function genRegisterStatusFormatter(",
  "function genRegisterFindRequestProvider(",
  "function genRegisterCandidateDecorator(",
  "function genRegisterLayerRecordDecorator(",
  "function genRegisterAnalysisDecorator(",
  "function genRegisterExpectedBaseBoardDecorator(",
  "function genRegisterSeedProvider(",
  "function genRegisterResultPresenter(",
]) if (!core.includes(token)) throw new Error(`missing registry API: ${token}`);

const protectedAssignments = [
  "genValidateCandidate", "genValidateExtensionCandidate", "genExtendToTarget",
  "genShowResult", "genBuildLayerCandidates", "genLayerRecord", "genFindTwoStep",
  "genAnalyzeVCFGroup", "genBuildExpectedBaseBoard", "genSetBusy", "genOptions",
];
for (const file of generatorOrder.filter(name => name.endsWith(".js") && name !== "makevcf-generator-core.js" && name !== "makevcf-generator-main.js" && name !== "makevcf-generator-validate.js" && name !== "makevcf-generator-layer.js")) {
  const source = read(file);
  for (const name of protectedAssignments) {
    const pattern = new RegExp(`\\b${name}\\s*=`);
    if (pattern.test(source)) throw new Error(`${file} still replaces ${name}`);
  }
}

const status = read("makevcf-generator-status-detail.js");
if (!status.includes("genRegisterStatusFormatter(")) throw new Error("status formatter is not registered");
if (!status.includes('genOnGeneratorEvent("search:start"')) throw new Error("status module is not event driven");

const replay = read("makevcf-generator-progress.js");
for (const forbidden of ["genSetBusy =", "genValidateCandidate =", "genEngine.findVCF =", "MutationObserver", "setInterval("]) {
  if (replay.includes(forbidden)) throw new Error(`replay patch remains: ${forbidden}`);
}

for (const file of [
  "makevcf-generator-layout-fix.js",
  "makevcf-generator-ui-compact.js",
  "makevcf-generator-open-four-stop.js",
  "makevcf-generator-settings-persistence.js",
  "rapfi/vcf-bitboard-main.js",
]) {
  const source = read(file);
  for (const forbidden of ["setInterval(", "new MutationObserver", "script.src =", "document.createElement(\"script\")"]) {
    if (source.includes(forbidden)) throw new Error(`${file} still contains polling/dynamic patch: ${forbidden}`);
  }
}

const questionBank = read("rapfi/rapfi-question-bank.js");
const generatorLayout = read("makevcf-generator-layout-fix.js");
for (const token of [
  'window.dispatchEvent(new CustomEvent("vcf-question-bank-ready"',
  'if (!install()) {',
]) if (!questionBank.includes(token)) throw new Error(`question-bank readiness contract missing: ${token}`);
for (const token of [
  'global.addEventListener("vcf-question-bank-ready", applyLayout, { once: true })',
  'if (!bank) return false;',
  'panel.lastElementChild === bank',
]) if (!generatorLayout.includes(token)) throw new Error(`question-bank mount contract missing: ${token}`);

console.log("Generator final architecture checks passed");
