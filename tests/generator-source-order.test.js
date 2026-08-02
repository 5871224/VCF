"use strict";

const fs = require("fs");

const html = fs.readFileSync("makevcf.html", "utf8");
const scriptSources = Array.from(html.matchAll(/<script[^>]+src=["']([^"']+)["'][^>]*><\/script>/g), match => match[1]);
const requiredOrder = [
  "makevcf-mobile.js",
  "eval/Evaluator.js",
  "rapfi/vcf-bitboard-generator-compat.js",
  "makevcf-generator-core.js",
  "makevcf-generator-main.js",
  "makevcf-generator-summary.js",
  "makevcf-generator-target-board-v3.js",
  "makevcf-generator-defense-points.js",
  "makevcf-generator-extension-other-vcf-fix.js",
  "makevcf-generator-protected-defenders.js",
  "makevcf-generator-progress.js",
  "makevcf-layout.js",
  "rapfi/rapfi-bitboard-dashboard.js",
  "rapfi/vcf-shortest-vcf-ui.js",
  "rapfi/vcf-forbidden-overlay.js",
  "rapfi/rapfi-workbench-header.js",
  "rapfi/rapfi-question-bank.js",
  "makevcf-generator-layout-fix.js",
  "makevcf-generator-ui-compact.js",
  "makevcf-generator-open-four-stop.js",
  "makevcf-generator-settings-persistence.js",
  "makevcf-generator-image-import-fix.js",
  "makevcf-optimized-search-v2.js",
];
let previous = -1;
for (const source of requiredOrder) {
  const index = scriptSources.indexOf(source);
  if (index < 0) throw new Error(`missing fixed script: ${source}`);
  if (index <= previous) throw new Error(`invalid fixed script order near: ${source}`);
  previous = index;
}
for (const token of [
  "rapfi/engine/vcf-bitboard-engine.js",
  "rapfi/vcf-bitboard-main.js",
]) {
  if (!html.includes(token)) throw new Error("missing root bridge token: " + token);
}
if (new Set(scriptSources).size !== scriptSources.length) {
  throw new Error("duplicate script source in makevcf.html");
}
if (html.includes("installRootBitboardFeatures")) {
  throw new Error("root workbench features are still dynamically injected");
}

for (const relative of [
  "makevcf-mobile.js",
  "makevcf-generator-reuse-bonus.js",
  "rapfi/vcf-bitboard-generator-compat.js",
]) {
  const source = fs.readFileSync(relative, "utf8");
  if (/\bscript\.src\s*=/.test(source)) {
    throw new Error(`dynamic script injection remains in ${relative}`);
  }
}

const evaluator = fs.readFileSync("eval/Evaluator.js", "utf8");
if (evaluator.includes("loadRootGeneratorCompatibilityAfterEvaluator")) {
  throw new Error("Evaluator.js still injects the generator compatibility script");
}

for (const relative of [
  "tools/apply-image-import-build-fixes.js",
  "tools/apply-generator-replay-event-fixes.js",
]) {
  const source = fs.readFileSync(relative, "utf8");
  if (/\b(?:writeFileSync|appendFileSync|renameSync|unlinkSync)\s*\(/.test(source)) {
    throw new Error(`build verification mutates source files: ${relative}`);
  }
}

const core = fs.readFileSync("makevcf-generator-core.js", "utf8");
const main = fs.readFileSync("makevcf-generator-main.js", "utf8");
for (const token of [
  "function genRegisterOptionProvider(",
  "function genRegisterBusyHook(",
  "function genBeginGenerationContext(",
  "function genGetActiveOptions(",
  "function genEndGenerationContext(",
]) {
  if (!core.includes(token)) throw new Error(`missing GenerationContext API: ${token}`);
}
for (const token of [
  "genResolveOptions({",
  "genBeginGenerationContext({",
  "genEndGenerationContext(generationContext)",
]) {
  if (!main.includes(token)) throw new Error(`main does not use GenerationContext: ${token}`);
}

for (const relative of [
  "makevcf-generator-order-mode.js",
  "makevcf-generator-balance.js",
  "makevcf-generator-unique.js",
  "makevcf-generator-target-board-v3.js",
]) {
  const source = fs.readFileSync(relative, "utf8");
  if (/\bgenOptions\s*=/.test(source)) {
    throw new Error(`genOptions wrapper remains in ${relative}`);
  }
  if (/\bgenSetBusy\s*=/.test(source)) {
    throw new Error(`control busy wrapper remains in ${relative}`);
  }
  if (!source.includes("genRegisterOptionProvider(")) {
    throw new Error(`option provider missing in ${relative}`);
  }
  if (!source.includes("genRegisterBusyHook(")) {
    throw new Error(`busy hook missing in ${relative}`);
  }
}

console.log("Generator source order, GenerationContext and non-mutating build checks passed");
