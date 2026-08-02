"use strict";

const fs = require("fs");
const path = require("path");
const root = path.resolve(__dirname, "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");

const core = read("makevcf-generator-core.js");
const progress = read("makevcf-generator-progress.js");
const integrated = read("makevcf-generator-integrated.js");
const policy = read("makevcf-generator-search-policy.js");
const finalizer = read("makevcf-generator-finalize.js");

for (const token of [
  "function genEmitGeneratorEvent(",
  "function genBeginGeneratorOperation(",
  "function genBeginGenerationContext(",
  "function genRegisterFindRequestProvider(",
]) if (!core.includes(token)) throw new Error(`generator event architecture missing: ${token}`);

for (const token of [
  'genOnGeneratorEvent("generation:start"',
  'genOnGeneratorEvent("stone:end"',
  'genOnGeneratorEvent("validation:end"',
]) if (!progress.includes(token)) throw new Error(`generator replay subscription missing: ${token}`);

for (const forbidden of [
  "genSetBusy =",
  "genValidateCandidate =",
  "genEngine.findVCF =",
  "MutationObserver",
  "setInterval(",
]) if (progress.includes(forbidden)) throw new Error(`generator replay patch remains: ${forbidden}`);

if (!integrated.includes('vcfRegisterBusyHook("generator-controls"')) {
  throw new Error("generator controls do not use the workbench busy hook");
}
if (integrated.includes("window.setBusy =") || integrated.includes("setBusy = wrapped")) {
  throw new Error("generator integration still replaces main busy state");
}
if (!policy.includes("genRegisterFindRequestProvider") && !core.includes("genRegisterFindRequestProvider")) {
  throw new Error("generator search request registry unavailable");
}
if (!finalizer.includes("genFinalizeGeneratedResult")) {
  throw new Error("single generator finalizer unavailable");
}

console.log("Generator event, replay and finalizer checks passed");
