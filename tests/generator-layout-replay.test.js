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

class MockEvent {
  constructor() {
    this.stopped = false;
  }
  preventDefault() {}
  stopImmediatePropagation() {
    this.stopped = true;
  }
}

class MockElement {
  constructor(id = "") {
    this.id = id;
    this.dataset = {};
    this.hidden = false;
    this.disabled = false;
    this.textContent = "";
    this.attrs = {};
    this.capture = [];
    this.bubble = [];
    this.children = [];
    this.parentNode = null;
  }

  addEventListener(type, listener, options) {
    if (type !== "click") return;
    (options === true ? this.capture : this.bubble).push(listener);
  }

  click() {
    if (this.disabled) return;
    const event = new MockEvent();
    for (const listener of [...this.capture]) {
      listener(event);
      if (event.stopped) return;
    }
    for (const listener of [...this.bubble]) {
      listener(event);
      if (event.stopped) return;
    }
  }

  querySelector(selector) {
    if (selector === "title") {
      return this.children.find(child => child.id === "title") || null;
    }
    return elements[selector.replace(/^#/, "")] || null;
  }

  querySelectorAll(selector) {
    return selector === "rect"
      ? this.children.filter(child => child.tag === "rect")
      : [];
  }

  appendChild(child) {
    this.children.push(child);
    child.parentNode = this;
    return child;
  }

  remove() {
    if (this.parentNode) {
      this.parentNode.children = this.parentNode.children.filter(child => child !== this);
    }
  }

  setAttribute(name, value) {
    this.attrs[name] = String(value);
    if (name === "hidden") this.hidden = true;
  }

  getAttribute(name) {
    return this.attrs[name] ?? null;
  }
}

const elements = {};
for (const id of [
  "gen-replay-combined-panel",
  "gen-replay-combined-first",
  "gen-replay-combined-prev",
  "gen-replay-combined-next",
  "gen-replay-combined-last",
  "gen-replay-combined-count",
  "gen-replay-combined-badge",
  "gen-replay-combined-title",
  "gen-replay-combined-reason",
  "generator-n-layer",
  "gen-replay-panel",
]) {
  elements[id] = new MockElement(id);
}

const panel = elements["gen-replay-combined-panel"];
panel.querySelector = selector => elements[selector.replace(/^#/, "")] || null;

let currentBoard = new Array(226).fill(0);
currentBoard[225] = -1;
const makeBoard = (...points) => {
  const board = new Array(226).fill(0);
  board[225] = -1;
  for (const [idx, color] of points) board[idx] = color;
  return board;
};

const baseSteps = [
  { board: makeBoard(), title: "初始", status: "info" },
  { board: makeBoard([10, 2]), title: "舊版補守", status: "passed" },
  { board: makeBoard([10, 2], [20, 2]), title: "舊版補守 2", status: "passed" },
];
let baseIndex = baseSteps.length - 1;

function renderBase() {
  const step = baseSteps[baseIndex];
  currentBoard = step.board.slice();
  elements["gen-replay-combined-count"].textContent = `${baseIndex + 1} / ${baseSteps.length}`;
  elements["gen-replay-combined-title"].textContent = step.title;
  elements["gen-replay-combined-reason"].textContent = "base";
  elements["gen-replay-combined-badge"].dataset.status = step.status;
  elements["gen-replay-combined-prev"].disabled = baseIndex === 0;
  elements["gen-replay-combined-first"].disabled = baseIndex === 0;
  elements["gen-replay-combined-next"].disabled = baseIndex === baseSteps.length - 1;
  elements["gen-replay-combined-last"].disabled = baseIndex === baseSteps.length - 1;
  panel.hidden = false;
}

elements["gen-replay-combined-first"].addEventListener("click", () => {
  baseIndex = 0;
  renderBase();
});
elements["gen-replay-combined-prev"].addEventListener("click", () => {
  baseIndex = Math.max(0, baseIndex - 1);
  renderBase();
});
elements["gen-replay-combined-next"].addEventListener("click", () => {
  baseIndex = Math.min(baseSteps.length - 1, baseIndex + 1);
  renderBase();
});
elements["gen-replay-combined-last"].addEventListener("click", () => {
  baseIndex = baseSteps.length - 1;
  renderBase();
});
renderBase();

const timers = [];
const context = {
  console,
  Uint8Array,
  Array,
  Map,
  Set,
  Number,
  Math,
  GEN_BLACK: 1,
  GEN_WHITE: 2,
  GEN_EMPTY: 0,
  GEN_NO_BLACK: 1,
  GEN_NO_WHITE: 2,
  genCancelled: false,
  genOther: color => 3 - color,
  genName: idx => `P${idx}`,
  genGetAttacker: () => 1,
  genEl: id => id === "status" ? { textContent: "" } : null,
  document: {
    getElementById: id => elements[id] || null,
    createElementNS(_namespace, tag) {
      const element = new MockElement();
      element.tag = tag;
      return element;
    },
  },
  window: null,
  _getArr: () => currentBoard.slice(),
  _setBoardArr: board => {
    currentBoard = Array.from(board);
  },
  setTimeout(callback) {
    timers.push(callback);
    return timers.length;
  },
};
context.window = context;
context.genSetBusy = value => {
  if (value) panel.hidden = true;
  else context.setTimeout(() => {
    baseIndex = baseSteps.length - 1;
    renderBase();
  });
};

vm.createContext(context);
vm.runInContext(
  fs.readFileSync("makevcf-generator-replay-stone-attempts.js", "utf8"),
  context,
  { filename: "makevcf-generator-replay-stone-attempts.js" },
);

context.genSetBusy(true);
const firstAttempt = context.genReplayBeginDefenderAttempt({
  board: makeBoard([10, 2]),
  attacker: 1,
  defender: 2,
  idx: 10,
  phase: "mid",
});
context.genReplayEndDefenderAttempt(firstAttempt, true, "第一顆通過");
const secondAttempt = context.genReplayBeginDefenderAttempt({
  board: makeBoard([10, 2], [20, 2]),
  attacker: 1,
  defender: 2,
  idx: 20,
  phase: "mid",
});
context.genReplayEndDefenderAttempt(secondAttempt, true, "第二顆通過");
context.genSetBusy(false);
while (timers.length) timers.shift()();

if (elements["gen-replay-combined-count"].textContent !== "3 / 3") {
  throw new Error(`unexpected unified replay count: ${elements["gen-replay-combined-count"].textContent}`);
}
if (elements["gen-replay-combined-title"].textContent !== "補守：補上白子 P20") {
  throw new Error("last supplemented stone was not replayed explicitly");
}

elements["gen-replay-combined-prev"].click();
if (elements["gen-replay-combined-count"].textContent !== "2 / 3") {
  throw new Error("previous moved more than one unified replay step");
}
if (elements["gen-replay-combined-title"].textContent !== "補守：補上白子 P10") {
  throw new Error("first supplemented stone was not replayed explicitly");
}

elements["gen-replay-combined-next"].click();
if (elements["gen-replay-combined-count"].textContent !== "3 / 3") {
  throw new Error("next moved more than one unified replay step");
}

console.log("Generator layout and unified replay tests passed");
