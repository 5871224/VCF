"use strict";

const fs = require("fs");
const vm = require("vm");

const layoutSource = fs.readFileSync("makevcf-generator-layout-fix.js", "utf8");
for (const token of [
  "#btn-fast-vcf",
  "#btn-shortest-vcf",
  "color: #000 !important",
  "VCF 題目產生器",
  "panel.insertBefore(actions, panel.firstElementChild)",
  "panel.appendChild(bank)",
]) {
  if (!layoutSource.includes(token)) {
    throw new Error(`missing generator layout rule: ${token}`);
  }
}

const replaySource = fs.readFileSync("makevcf-generator-progress.js", "utf8");
for (const obsolete of [
  "genSetBusy =",
  "genValidateCandidate =",
  "genValidateExtensionCandidate =",
  "genShowResult =",
  "genEngine.findVCF =",
  "genEngine.trimGroups =",
  "harvestOldReplay",
  "captureOldStep",
  "setTimeout",
]) {
  if (replaySource.includes(obsolete)) {
    throw new Error(`event replay still contains wrapper/harvest logic: ${obsolete}`);
  }
}
for (const required of [
  'genOnGeneratorEvent("generation:start"',
  'genOnGeneratorEvent("validation:start"',
  'genOnGeneratorEvent("stone:start"',
  'genOnGeneratorEvent("search:end"',
  'genOnGeneratorEvent("generation:end"',
]) {
  if (!replaySource.includes(required)) {
    throw new Error(`missing event replay subscription: ${required}`);
  }
}

class MockElement {
  constructor(id = "", tag = "div") {
    this.id = id;
    this.tag = tag;
    this.dataset = {};
    this.hidden = false;
    this.disabled = false;
    this.textContent = "";
    this.children = [];
    this.parentNode = null;
    this.listeners = new Map();
    this.attrs = {};
  }
  appendChild(child) {
    this.children.push(child);
    child.parentNode = this;
    return child;
  }
  insertBefore(child, before) {
    const index = this.children.indexOf(before);
    if (index < 0) return this.appendChild(child);
    this.children.splice(index, 0, child);
    child.parentNode = this;
    return child;
  }
  remove() {
    if (!this.parentNode) return;
    this.parentNode.children = this.parentNode.children.filter(child => child !== this);
    this.parentNode = null;
  }
  get firstChild() {
    return this.children[0] || null;
  }
  get nextSibling() {
    if (!this.parentNode) return null;
    const index = this.parentNode.children.indexOf(this);
    return this.parentNode.children[index + 1] || null;
  }
  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }
  click() {
    if (this.disabled) return;
    for (const listener of this.listeners.get("click") || []) listener({});
  }
  querySelector(selector) {
    if (selector === "title") return this.children.find(child => child.tag === "title") || null;
    return elements[selector.replace(/^#/, "")] || null;
  }
  querySelectorAll(selector) {
    return selector === "rect" ? this.children.filter(child => child.tag === "rect") : [];
  }
  setAttribute(name, value) {
    this.attrs[name] = String(value);
  }
  getAttribute(name) {
    return this.attrs[name] ?? null;
  }
}

const elements = {};
const parent = new MockElement("parent");
const status = new MockElement("status");
parent.appendChild(status);
elements.status = status;

const panel = new MockElement("gen-replay-combined-panel", "section");
parent.appendChild(panel);
for (const id of [
  "gen-replay-combined-first",
  "gen-replay-combined-prev",
  "gen-replay-combined-next",
  "gen-replay-combined-last",
  "gen-replay-combined-count",
  "gen-replay-combined-badge",
  "gen-replay-combined-title",
  "gen-replay-combined-reason",
]) {
  elements[id] = new MockElement(id, id.includes("button") ? "button" : "span");
  panel.appendChild(elements[id]);
}
elements[panel.id] = panel;
const nLayer = new MockElement("generator-n-layer", "g");
elements[nLayer.id] = nLayer;

const listeners = new Map();
function on(type, name, listener) {
  const entries = listeners.get(type) || [];
  const index = entries.findIndex(entry => entry.name === name);
  if (index >= 0) entries[index] = { name, listener };
  else entries.push({ name, listener });
  listeners.set(type, entries);
}
function emit(type, detail = {}) {
  const event = { type, ...detail };
  for (const entry of listeners.get(type) || []) entry.listener(event);
}

const makeBoard = (...stones) => {
  const board = new Array(226).fill(0);
  board[225] = -1;
  for (const [idx, color] of stones) board[idx] = color;
  return board;
};
const materialBoard = makeBoard([0, 1]);
const candidateBoard = makeBoard([0, 1], [1, 1]);
const stoneBoard = makeBoard([0, 1], [1, 1], [10, 2]);
const nMask = new Uint8Array(225);
nMask[10] = 3;
let renderedBoard = null;

const context = {
  console,
  window: null,
  document: {
    head: new MockElement("head", "head"),
    getElementById(id) { return elements[id] || null; },
    querySelector() { return null; },
    createElement(tag) { return new MockElement("", tag); },
    createElementNS(_ns, tag) { return new MockElement("", tag); },
  },
  GEN_NO_BLACK: 1,
  GEN_NO_WHITE: 2,
  GEN_EMPTY: 0,
  GEN_BLACK: 1,
  GEN_WHITE: 2,
  genEl: id => elements[id] || null,
  genName: idx => `P${idx}`,
  genOther: color => 3 - color,
  genCloneBoard: board => Array.from(board),
  genBoardsEqual: (a, b) => a.every((value, index) => value === b[index]),
  genBuildExpectedBaseBoard: state => {
    const board = Array.from(state.board);
    board[2] = 1;
    return board;
  },
  genBuildExpectedExtendedBoard: (_previous, state) => {
    const board = Array.from(state.board);
    board[2] = 1;
    return board;
  },
  genAnalyzeVCFGroup: (board, _moves, attacker) => {
    const standardBoard = Array.from(board);
    standardBoard[2] = attacker;
    return { valid: true, steps: 1, standardBoard };
  },
  genOnGeneratorEvent: on,
  _setBoardArr: board => { renderedBoard = Array.from(board); },
  Uint8Array,
  Array,
  Map,
  Set,
  Number,
  Math,
  Date,
};
context.window = context;
context.globalThis = context;
vm.createContext(context);
vm.runInContext(replaySource, context, { filename: "makevcf-generator-progress.js" });

const generation = { id: 1, attacker: 1, defender: 2, options: { blockOtherVCF: false } };
const validation = { id: 11, type: "validation" };
const stone = { id: 12, type: "stone" };
const search = { id: 13, type: "search" };
const candidate = {
  board: candidateBoard,
  nMask: new Uint8Array(225),
  attacker: 1,
  addedAttackers: [],
  addedDefenders: [],
  autoBlockDefenders: [],
  layers: [{ anchor: 1, fivePoint: 2, templateId: 3 }],
};
const result = {
  board: stoneBoard,
  nMask,
  attacker: 1,
  groupCount: 1,
};

emit("generation:start", { context: generation });
emit("material:selected", {
  board: materialBoard,
  nMask: new Uint8Array(225),
  attacker: 1,
  title: "建立初始活三",
  reason: "初始材料",
});
emit("validation:start", {
  operation: validation,
  candidate,
  expectedSteps: 1,
  previousResult: null,
  phase: "base",
});
emit("stone:start", {
  operation: stone,
  validationOperationId: validation.id,
  board: stoneBoard,
  nMask,
  attacker: 1,
  defender: 2,
  idx: 10,
  phase: "mid",
});
emit("search:end", {
  operation: search,
  board: stoneBoard,
  attacker: 1,
  maxVCF: 64,
  validationOperationId: validation.id,
  stoneOperationId: stone.id,
  result: { winMoves: [[2]], nodeCount: 2, aborted: false },
});
emit("search:trimmed", {
  board: stoneBoard,
  attacker: 1,
  validationOperationId: validation.id,
  stoneOperationId: stone.id,
  result: [[2]],
});
emit("stone:end", { operation: stone, passed: true, reason: "補守通過" });
emit("validation:end", {
  operation: validation,
  candidate,
  expectedSteps: 1,
  passed: true,
  result,
});
emit("generation:result", {
  context: generation,
  result,
  targetSteps: 1,
  attacker: 1,
  counters: { attempts: 1 },
});
emit("generation:end", { context: generation, outcome: "success", stopped: false });

if (elements["gen-replay-combined-count"].textContent !== "5 / 5") {
  throw new Error(`unexpected replay count: ${elements["gen-replay-combined-count"].textContent}`);
}
if (elements["gen-replay-combined-title"].textContent !== "最終題目：1 步 VCF") {
  throw new Error("final replay step was not shown");
}
if (!renderedBoard || renderedBoard[10] !== 2) {
  throw new Error("final replay board was not rendered");
}
if (nLayer.children.length !== 1) {
  throw new Error(`N point was not rendered: ${nLayer.children.length}`);
}

elements["gen-replay-combined-prev"].click();
if (elements["gen-replay-combined-count"].textContent !== "4 / 5") {
  throw new Error("previous did not move exactly one replay step");
}
elements["gen-replay-combined-prev"].click();
if (elements["gen-replay-combined-title"].textContent !== "補守：補上白子 P10") {
  throw new Error(`stone step missing from unified timeline: ${elements["gen-replay-combined-title"].textContent}`);
}
if (elements["gen-replay-combined-badge"].dataset.status !== "passed") {
  throw new Error("stone validation result was not preserved");
}
elements["gen-replay-combined-first"].click();
if (elements["gen-replay-combined-title"].textContent !== "建立初始活三") {
  throw new Error("initial material was not the first replay step");
}

console.log("Generator layout and event replay tests passed");
