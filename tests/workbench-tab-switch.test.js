"use strict";
// Browser-like smoke test: the full makevcf-layout.js must initialize before
// any tab can be clicked. Catch runtime ReferenceErrors that syntax checks miss.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const layout = fs.readFileSync(path.join(__dirname, "../makevcf-layout.js"), "utf8");

class Node {
  constructor(id = "") {
    this.id = id;
    this.dataset = {};
    this.attributes = {};
    this.children = [];
    this.listeners = {};
    this.options = [];
    this.value = "";
    this.checked = false;
    this.disabled = false;
    this.tabIndex = -1;
    this.classList = { toggle() {}, add() {}, remove() {} };
  }
  addEventListener(type, callback) {
    (this.listeners[type] ||= []).push(callback);
  }
  dispatch(type, extras = {}) {
    for (const listener of this.listeners[type] || [])
      listener({ type, target: this, preventDefault() {}, ...extras });
  }
  appendChild(node) { this.children.push(node); node.parentNode = this; }
  replaceChildren(...nodes) { this.children = nodes; this.options = nodes; }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  querySelector(selector) {
    if (selector.startsWith("#")) return this.children.find(c => c.id === selector.slice(1)) || null;
    return null;
  }
  querySelectorAll() { return []; }
  focus() { this.focused = true; }
  remove() {
    if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(x => x !== this);
  }
  get firstChild() { return this.children[0] || null; }
}
const elements = new Map();
const el = id => {
  if (!elements.has(id)) elements.set(id, new Node(id));
  return elements.get(id);
};
const tabs = ["calculation", "generator", "import"].map(tab => {
  const node = el("vcf-tab-" + tab);
  node.dataset.tab = tab;
  return node;
});
const rule = new Node("rule"); rule.checked = true; rule.value = "2";
const color = new Node("color"); color.checked = true; color.value = "1";
const ruleBox = el("rule-box");
ruleBox.querySelectorAll = () => [rule];
const document = {
  documentElement: { dataset: { vcfTab: "calculation" } },
  getElementById: el,
  querySelectorAll(selector) {
    if (selector === ".vcf-tab") return tabs;
    if (selector === 'input[name="acolor"]') return [color];
    return [];
  },
  querySelector(selector) {
    if (selector === 'input[name="acolor"]:checked') return color;
    if (selector === 'input[name="rules"]:checked') return rule;
    return null;
  },
  createElement: () => new Node(),
  createElementNS: () => new Node(),
  activeElement: null,
};
const store = new Map();
const localStorage = {
  getItem: key => store.get(key) || null,
  setItem: (key, value) => { store.set(key, String(value)); },
};
const events = new Map();
const window = {
  addEventListener(name, handler) { (events.get(name) || events.set(name, []).get(name)).push(handler); },
  dispatch(name, detail) { for (const h of events.get(name) || []) h({ detail }); },
  VCFWorkbenchRecord: { workspace: () => ({ mode: "record" }), currentRecordText: () => "" },
};
vm.runInNewContext(layout, {
  window, document, localStorage, console,
  queueMicrotask, Uint8Array, Promise,
}, { filename: "makevcf-layout.js" });
const selected = key => {
  const node = tabs.find(tab => tab.dataset.tab === key);
  return node.attributes["aria-selected"];
};
assert.equal(selected("calculation"), "true", "first tab initialized");
tabs[1].dispatch("click");
assert.equal(document.documentElement.dataset.vcfTab, "generator", "generator tab activated");
assert.equal(selected("generator"), "true");
assert.equal(selected("calculation"), "false");
assert.equal(store.get("vcf_workspace_tab"), "generator", "tab preference saved");
tabs[2].dispatch("click");
assert.equal(document.documentElement.dataset.vcfTab, "import", "image import activated");
assert.equal(selected("import"), "true");
tabs[2].dispatch("keydown", { key: "Home" });
assert.equal(document.documentElement.dataset.vcfTab, "calculation", "keyboard tab switching");
// This event also exercises BOARD_SIZE/BOARD_CELLS in the SVG overlay.
window.dispatch("vcf-record-state-changed", { nextMoves: [112] });
const layer = el("board-svg").querySelector("#vcf-record-next-move-layer");
assert.ok(layer, "next-move marker layer is initialized");
assert.equal(layer.children.length, 1);
assert.equal(layer.children[0].attributes.cx, "260");
assert.equal(layer.children[0].attributes.cy, "260");
console.log("Workbench tab clicks, keyboard navigation and SVG next-move overlays passed");
