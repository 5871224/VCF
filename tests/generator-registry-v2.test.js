"use strict";

const fs = require("fs");
const vm = require("vm");
const source = fs.readFileSync("makevcf-generator-core.js", "utf8");
const start = source.indexOf("const genOptionProviders = [];");
const end = source.indexOf("function genSetBusy(value)");
if (start < 0 || end < 0) throw new Error("missing generator registry section");

const events = [];
const context = {
  console,
  Map, Array, Object, Number, String, Boolean, Date, Error, TypeError,
  genCloneBoard: board => Array.from(board || []),
  genOther: color => 3 - color,
  genGetGenerationContext: () => context.__generation || null,
};
vm.createContext(context);
vm.runInContext(source.slice(start, end) + `
;globalThis.__api = {
 genRegisterStatusFormatter, genFormatStatus,
 genRegisterFindRequestProvider, genResolveFindRequest,
 genRegisterCandidateDecorator, genDecorateLayerCandidates,
 genRegisterLayerRecordDecorator, genDecorateLayerRecord,
 genRegisterAnalysisDecorator, genDecorateAnalysis,
 genRegisterExpectedBaseBoardDecorator, genDecorateExpectedBaseBoard,
 genRegisterSeedProvider, genEligibleSeedProviders,
 genRegisterResultPresenter, genPresentResult,
 genOnGeneratorEvent, genEmitGeneratorEvent,
 genBeginGeneratorOperation, genEndGeneratorOperation,
};`, context);
const api = context.__api;

api.genRegisterStatusFormatter("late", text => `${text}-late`, 20);
api.genRegisterStatusFormatter("early", text => `${text}-early`, 10);
if (api.genFormatStatus("x") !== "x-early-late") throw new Error("status formatter priority is wrong");

api.genRegisterFindRequestProvider("depth", request => ({ options: { maxDepth: request.options.maxDepth + 2 } }), 20);
api.genRegisterFindRequestProvider("mode", request => ({ options: { mode: `${request.options.mode}-x` } }), 10);
const request = api.genResolveFindRequest({ board: [1, 0], color: 1, maxVCF: 3, options: { mode: "multi", maxDepth: 5 } });
if (request.options.mode !== "multi-x" || request.options.maxDepth !== 7) throw new Error("find providers did not compose");

api.genRegisterCandidateDecorator("add", candidates => candidates.map(item => ({ ...item, score: item.score + 1 })), 10);
api.genRegisterCandidateDecorator("double", candidates => candidates.map(item => ({ ...item, score: item.score * 2 })), 20);
const decorated = api.genDecorateLayerCandidates([{ score: 2 }], {});
if (decorated[0].score !== 6) throw new Error("candidate decorators did not compose");

api.genRegisterLayerRecordDecorator("record", record => ({ ...record, extra: true }));
if (!api.genDecorateLayerRecord({ ok: true }, {}, 1).extra) throw new Error("record decorator failed");
api.genRegisterAnalysisDecorator("analysis", analysis => ({ ...analysis, marked: true }));
if (!api.genDecorateAnalysis({ valid: true }, [], [], 1).marked) throw new Error("analysis decorator failed");
api.genRegisterExpectedBaseBoardDecorator("expected", board => board.concat(2));
if (api.genDecorateExpectedBaseBoard([1], {}).join(",") !== "1,2") throw new Error("expected board decorator failed");

const provider = () => null;
provider.canHandle = value => value.allowed;
api.genRegisterSeedProvider("seed", provider);
if (api.genEligibleSeedProviders({ allowed: true }).length !== 1 || api.genEligibleSeedProviders({ allowed: false }).length !== 0) throw new Error("seed provider filter failed");
api.genRegisterResultPresenter("present", (_result, info) => events.push(info.name));
api.genPresentResult({}, { name: "shown" });
if (events.at(-1) !== "shown") throw new Error("result presenter failed");

api.genOnGeneratorEvent("search:start", "test", event => events.push(`${event.type}:${event.operation.parentId || 0}`));
api.genOnGeneratorEvent("stone:start", "test", event => events.push(`${event.type}:${event.operation.parentId || 0}`));
const search = api.genBeginGeneratorOperation("search", {});
const stone = api.genBeginGeneratorOperation("stone", {});
api.genEndGeneratorOperation(stone, {});
api.genEndGeneratorOperation(search, {});
if (!events.includes(`stone:start:${search.id}`)) throw new Error("nested operation relationship failed");

console.log("Generator registry runtime tests passed");
