"use strict";

const fs = require("fs");
const path = require("path");
const root = path.resolve(__dirname, "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");
const exists = file => fs.existsSync(path.join(root, file));

const worker = read("rapfi/vcf-bitboard-worker.js");
for (const token of [
  "function normalizeRules(rules)",
  "runSmokeCheck",
  'selfTestMode: runSmokeCheck ? "smoke" : "skipped"',
  'searchV2SelfTest: "ci-only"',
  "validatedCandidates = new Map()",
  "validatedCandidates.set(idx, checked.stats)",
]) if (!worker.includes(token)) throw new Error(`worker performance contract missing: ${token}`);
for (const forbidden of [
  "Number(data?.rules) || 2",
  'cwrap("vcfBbSelfTest"',
  'cwrap("vcfBbSearchV2SelfTest"',
  "const tested = baseBoard.slice()",
  'cwrap("vcfBbRouteDefense"',
  "ptr.points = moduleInstance._malloc",
]) if (worker.includes(forbidden)) throw new Error(`worker redundant runtime work remains: ${forbidden}`);

const main = read("rapfi/vcf-bitboard-main.js");
for (const token of [
  "runSmokeCheck",
  "new RpcWorker({ runSmokeCheck: false })",
  "this.ruleChain.catch(() => true).then",
  "if (this.appliedRules === normalized) return true",
  "service.writeSyncBoard(arr);",
]) if (!main.includes(token)) throw new Error(`main performance contract missing: ${token}`);
for (const forbidden of [
  "Uint8Array.from(arr || [])",
  'cwrap("vcfBbSelfTest"',
  "global.getLevelPoint(idx, color, arr)",
]) if (main.includes(forbidden)) throw new Error(`main redundant allocation or validation remains: ${forbidden}`);

const core = read("makevcf-generator-core.js");
if (!core.includes('if (type === "findVCF") normalized.pruning = genSelectedPruning();')) {
  throw new Error("generator request normalization is not single-pass");
}
for (const forbidden of ["const withRules =", "const withPruning =", "arr: board.slice()"] ) {
  if (core.includes(forbidden)) throw new Error(`generator redundant request copy remains: ${forbidden}`);
}

const validation = read("makevcf-generator-validate.js");
for (const forbidden of [
  "const beforeMove =",
  "async function genFindAnalyzedGroups",
  "function genResolveValidationSteps",
  "...Array.from(state.autoBlockDefenders",
]) if (validation.includes(forbidden)) throw new Error(`generator redundant validation remains: ${forbidden}`);
if (!validation.includes("board[idx] = GEN_EMPTY;\n        standardBoard = genCloneBoard(board);")) {
  throw new Error("live-four board clone is not delayed until needed");
}

const candidate = read("rapfi/vcf-candidate-worker.js");
if (candidate.includes("HEAPU8.slice(resultPtr") || candidate.includes("bytes.slice(0, 4)")) {
  throw new Error("candidate worker still copies Wasm result buffers per point");
}

const dashboard = read("rapfi/rapfi-bitboard-dashboard.js");
if (dashboard.includes("arr: Array.from(param.arr")) {
  throw new Error("dashboard still clones boards before the canonical request layer");
}
if (!dashboard.includes("if (checkBlackFoul) service.writeSyncBoard(base);")) {
  throw new Error("dashboard does not reuse the unchanged foul-check board");
}

for (const obsolete of [
  "tools/apply-image-import-build-fixes.js",
  "tools/apply-generator-replay-event-fixes.js",
]) if (exists(obsolete)) throw new Error(`duplicated architecture validator remains: ${obsolete}`);

const packageJson = JSON.parse(read("package.json"));
if (packageJson.scripts["verify:source"]) throw new Error("duplicated verify:source script remains");
if (!packageJson.scripts["test:architecture"].includes("runtime-performance-contract.test.js")) {
  throw new Error("runtime performance contract is not part of architecture tests");
}

const pages = read(".github/workflows/pages.yml");
const workbench = read(".github/workflows/workbench-ci.yml");
for (const source of [pages, workbench]) {
  if (source.includes("npm run verify:source")) throw new Error("workflow still repeats source architecture validation");
}
if (!pages.includes("npm run test:runtime")) throw new Error("Pages build does not run actual Worker/Wasm regression tests");

console.log("Runtime validation and performance contracts passed");
