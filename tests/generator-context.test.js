"use strict";

const fs = require("fs");
const vm = require("vm");

const source = fs.readFileSync("makevcf-generator-core.js", "utf8");
const start = source.indexOf("const genOptionProviders = [];");
const end = source.indexOf("function genSetBusy(value)");
if (start < 0 || end < 0) throw new Error("missing GenerationContext core section");
const busyEnd = source.indexOf("\n}", end) + 2;

const elements = new Map();
const element = id => {
  if (!elements.has(id)) elements.set(id, { id, disabled: false });
  return elements.get(id);
};
const events = [];
const context = {
  console,
  Object,
  TypeError,
  Error,
  Date,
  genBusy: false,
  genCurrent: null,
  genOther: color => 3 - color,
  genEl: element,
  genInputs: () => [],
  document: { getElementById: element },
  window: { genIntegrationSetBusy(value) { events.push(`integration:${value}`); } },
};
vm.createContext(context);
vm.runInContext(source.slice(start, busyEnd) + `
;globalThis.__api = {
  genRegisterOptionProvider, genResolveOptions, genRegisterBusyHook,
  genBeginGenerationContext, genGetGenerationContext, genGetActiveOptions,
  genEndGenerationContext, genSetBusy
};`, context);

const api = context.__api;
api.genRegisterOptionProvider("first", options => ({ ...options, alpha: 1 }));
api.genRegisterOptionProvider("second", options => ({ ...options, beta: options.alpha + 1 }));
const options = api.genResolveOptions({ base: true });
if (!options.base || options.alpha !== 1 || options.beta !== 2) {
  throw new Error("option providers did not resolve in registration order");
}

api.genRegisterBusyHook("first", {
  before(value) { events.push(`first-before:${value}`); },
  after(value) { events.push(`first-after:${value}`); },
});
api.genRegisterBusyHook("second", {
  before(value) { events.push(`second-before:${value}`); },
  after(value) { events.push(`second-after:${value}`); },
});

const counters = { attempts: 0 };
const generation = api.genBeginGenerationContext({
  attacker: 1, rules: 2, targetSteps: 3, options, counters,
});
if (api.genGetGenerationContext() !== generation) throw new Error("GenerationContext was not activated");
if (api.genGetActiveOptions().beta !== 2) throw new Error("active options are unavailable");
if (!Object.isFrozen(api.genGetActiveOptions())) throw new Error("generation options are mutable");

api.genSetBusy(true);
api.genSetBusy(false);
const expected = [
  "second-before:true", "first-before:true", "integration:true",
  "first-after:true", "second-after:true",
  "second-before:false", "first-before:false", "integration:false",
  "first-after:false", "second-after:false",
];
if (events.join("|") !== expected.join("|")) {
  throw new Error(`unexpected busy hook order: ${events.join("|")}`);
}
api.genEndGenerationContext(generation);
if (api.genGetGenerationContext() !== null) throw new Error("GenerationContext was not cleared");

console.log("Generator GenerationContext runtime tests passed");
