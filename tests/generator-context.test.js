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
const busyEvents = [];
const generatorEvents = [];
const context = {
  console,
  Object,
  TypeError,
  Error,
  Date,
  Map,
  Array,
  genBusy: false,
  genCurrent: null,
  genOther: color => 3 - color,
  genEl: element,
  genInputs: () => [],
  document: { getElementById: element },
  window: { genIntegrationSetBusy(value) { busyEvents.push(`integration:${value}`); } },
};
vm.createContext(context);
vm.runInContext(source.slice(start, busyEnd) + `
;globalThis.__api = {
  genRegisterOptionProvider, genResolveOptions, genRegisterBusyHook,
  genOnGeneratorEvent, genEmitGeneratorEvent,
  genBeginGeneratorOperation, genEndGeneratorOperation, genFindGeneratorOperation,
  genBeginStoneAttempt, genEndStoneAttempt,
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
  before(value) { busyEvents.push(`first-before:${value}`); },
  after(value) { busyEvents.push(`first-after:${value}`); },
});
api.genRegisterBusyHook("second", {
  before(value) { busyEvents.push(`second-before:${value}`); },
  after(value) { busyEvents.push(`second-after:${value}`); },
});

for (const type of ["validation:start", "stone:start", "stone:end", "validation:end"]) {
  api.genOnGeneratorEvent(type, `test-${type}`, event => generatorEvents.push(event));
}

const counters = { attempts: 0 };
const generation = api.genBeginGenerationContext({
  attacker: 1, rules: 2, targetSteps: 3, options, counters,
});
if (api.genGetGenerationContext() !== generation) throw new Error("GenerationContext was not activated");
if (api.genGetActiveOptions().beta !== 2) throw new Error("active options are unavailable");
if (!Object.isFrozen(api.genGetActiveOptions())) throw new Error("generation options are mutable");

const validation = api.genBeginGeneratorOperation("validation", { expectedSteps: 3 });
if (api.genFindGeneratorOperation("validation") !== validation) {
  throw new Error("active validation operation was not found");
}
const stone = api.genBeginStoneAttempt({ attacker: 1, defender: 2, idx: 10, phase: "mid" });
api.genEndStoneAttempt(stone, true, "passed");
api.genEndGeneratorOperation(validation, { passed: true });
if (generatorEvents.length !== 4) {
  throw new Error(`unexpected generator event count: ${generatorEvents.length}`);
}
if (generatorEvents[1].validationOperationId !== validation.id) {
  throw new Error("stone event was not linked to the active validation");
}
if (generatorEvents[2].reason !== "passed" || !generatorEvents[2].passed) {
  throw new Error("stone result event did not preserve its outcome");
}

api.genSetBusy(true);
api.genSetBusy(false);
const expected = [
  "second-before:true", "first-before:true", "integration:true",
  "first-after:true", "second-after:true",
  "second-before:false", "first-before:false", "integration:false",
  "first-after:false", "second-after:false",
];
if (busyEvents.join("|") !== expected.join("|")) {
  throw new Error(`unexpected busy hook order: ${busyEvents.join("|")}`);
}
api.genEndGenerationContext(generation);
if (api.genGetGenerationContext() !== null) throw new Error("GenerationContext was not cleared");
if (api.genFindGeneratorOperation("validation") !== null) {
  throw new Error("operation stack was not cleared with GenerationContext");
}

console.log("Generator GenerationContext and event runtime tests passed");
