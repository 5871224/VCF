"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const FiveDB = require("../rapfi/5db-format.js");
const source = fs.readFileSync(path.join(__dirname, "../rapfi/vcf-batch-benchmark.js"), "utf8");

const start = source.indexOf("  const COLS = ");
const end = source.indexOf("  function currentItems()", start);
assert.ok(start > 0 && end > start, "pure batch puzzle converter must be identifiable");
const { normalizePuzzles, puzzleToDocument } = new Function(
  "global", source.slice(start, end) + "\nreturn { normalizePuzzles, puzzleToDocument };"
)({ FiveDB });

const sourcePuzzle = {
  no: 1, title: "花火", section: "一般案", author: "坂田吾朗",
  first: "黑先", black: ["K12", "P15"], white: ["A1", "H8"], moves: 21,
};
const items = normalizePuzzles({ puzzles: [sourcePuzzle] });
assert.equal(items.length, 1);
assert.equal(items[0].fileName, "夢幻の構想-001");
assert.equal(items[0].answerMoves, 21);
const supplements = normalizePuzzles({ puzzles: [{ ...sourcePuzzle, no: "S1" }, { ...sourcePuzzle, no: "S30" }] });
assert.deepEqual(supplements.map(p => p.fileName), ["夢幻の構想-S01", "夢幻の構想-S30"]);
assert.equal(supplements[0].doc.title, "第 S01 題｜花火｜一般案｜坂田吾朗");
const doc = items[0].doc;
assert.equal(doc.title, "第 001 題｜花火｜一般案｜坂田吾朗");
assert.equal(doc.mode, "puzzle");
assert.equal(doc.phase, "setup");
assert.equal(doc.board[3 * 15 + 9], 1, "K12 coordinates respect 15-bottom notation");
assert.equal(doc.board[14], 1, "P15 is top right");
assert.equal(doc.board[14 * 15], 2, "A1 is bottom left");
assert.equal(doc.board[7 * 15 + 7], 2, "H8 is center");
assert.deepEqual(doc.currentPath, []);
assert.equal(doc.root.children.length, 0, "reference answer must never be preloaded");
const restored = FiveDB.decode(FiveDB.encode(doc));
assert.deepEqual(restored, doc, "5DB binary must roundtrip title, board and side");
const whiteDoc = puzzleToDocument({ ...sourcePuzzle, no: 2, title: null, first: "白先" });
assert.equal(whiteDoc.nextSide, 2);
assert.match(whiteDoc.title, /無題/);
assert.throws(() => normalizePuzzles({ puzzles: [sourcePuzzle, sourcePuzzle] }), /重複/);
assert.throws(() => puzzleToDocument({ ...sourcePuzzle, white: ["K12"] }), /重複落點/);
assert.throws(() => puzzleToDocument({ ...sourcePuzzle, black: ["I8"] }), /座標不合法/);
assert.throws(() => normalizePuzzles({ puzzles: Array(1001).fill(sourcePuzzle) }), /1000/);
for (const name of ["vcf-batch-run", "vcf-batch-upload", "vcf-batch-cloud", "vcf-batch-csv"]) {
  assert.ok(fs.readFileSync(path.join(__dirname, "../index.html"), "utf8").includes('id="' + name + '"'));
}
assert.ok(source.includes('new Worker(asset("rapfi/vcf-bitboard-worker.js"))'), "batch uses independent worker");
assert.ok(source.includes("...settings, totalNodeLimit: true"), "batch opts into the cumulative node cap");
assert.ok(source.includes("cloud.saveDocument(item.doc, item.fileName, destination)"), "cloud imports private 5DB");
assert.ok(source.includes("descending = !descending"), "repeated table-heading clicks toggle sort order");
assert.ok(source.includes("index + 1"), "folder-selected rows show sequential ordinals");
const benchmarkHtml = fs.readFileSync(path.join(__dirname, "../index.html"), "utf8");
assert.ok(!benchmarkHtml.includes('id="vcf-batch-filter"'), "batch UI has no unused search field");
assert.ok(!source.includes("vcf-batch-filter"), "batch logic never reads or binds an obsolete search input");
assert.ok(source.includes('$("vcf-batch-folder").disabled = busy;'),
  "cloud folder selector is available before manually choosing the cloud source");
assert.ok(source.includes('global.addEventListener("load"'),
  "cloud folders load once the injected member API is ready");
assert.ok(!source.includes("puzzles: ["), "never bundle source book puzzles");

// The real folder filter and sorter determine both visible sequence and batch queue.
const filterStart = source.indexOf("  const COLS = ");
const filterEnd = source.indexOf("  function syncControls()", filterStart);
assert.ok(filterEnd > filterStart, "folder and sorting functions are in the batch module");
const inputs = {
  "vcf-batch-folder": {value: "1"},
  "vcf-batch-include-subfolders": {checked: true},
  "vcf-batch-filter": {value: ""},
};
const filter = new Function("$", "global", source.slice(filterStart, filterEnd) + "\n" +
  "return { setData(data,folders){items=data;cloudFolders=folders;sourceKind='cloud';}," +
  "setSort(field,reverse){sortField=field;descending=reverse;}," +
  "currentItems };"
)(id => inputs[id], {FiveDB});
const folderItems = [
  {fileName:"D",title:"根",folderId:0},
  {fileName:"C",title:"子",folderId:1},
  {fileName:"B",title:"孫",folderId:2},
  {fileName:"A",title:"另一",folderId:3},
];
filter.setData(folderItems, [
  {id:1,parent_id:0,name:"題庫"},
  {id:2,parent_id:1,name:"進階"},
  {id:3,parent_id:0,name:"其他"},
]);
assert.deepEqual(filter.currentItems().map(x=>x.fileName), ["C","B"], "folder contains direct and descendant files");
inputs["vcf-batch-include-subfolders"].checked = false;
assert.deepEqual(filter.currentItems().map(x=>x.fileName), ["C"], "child files can be excluded");
inputs["vcf-batch-include-subfolders"].checked = true;
filter.setSort("fileName",false);
assert.deepEqual(filter.currentItems().map(x=>x.fileName), ["B","C"], "file name ascending");
filter.setSort("fileName",true);
assert.deepEqual(filter.currentItems().map(x=>x.fileName), ["C","B"], "file name descending");
inputs["vcf-batch-folder"].value = "0";
assert.equal(filter.currentItems().length, 4, "root includes all descendants when checked");
inputs["vcf-batch-include-subfolders"].checked = false;
assert.deepEqual(filter.currentItems().map(x=>x.fileName), ["D"], "root without descendants");

console.log("Private batch JSON->5DB conversion, side, title, coordinates and isolated benchmark passed");

async function verifyLiveFolderSelector() {
  const vm = require("node:vm");
  class Element {
    constructor(id = "") {
      this.id = id;
      this.value = "";
      this.checked = false;
      this.disabled = false;
      this.children = [];
      this.listeners = {};
      this.dataset = {};
      this.attributes = {};
      this.innerHTML = "";
      this.textContent = "";
    }
    addEventListener(type, handler) { (this.listeners[type] ||= []).push(handler); }
    dispatch(type, target = this) {
      for (const handler of this.listeners[type] || []) handler({ target, type });
    }
    click() { this.dispatch("click"); }
    appendChild(child) { this.children.push(child); }
    replaceChildren(...children) { this.children = children; }
    setAttribute(name, value) { this.attributes[name] = String(value); }
    querySelector() { return new Element(); }
    querySelectorAll() { return []; }
  }
  const elements = new Map();
  const getElementById = id => {
    if (!elements.has(id)) elements.set(id, new Element(id));
    return elements.get(id);
  };
  const mockCatalog = {
    folders: [{ id: 1, parent_id: 0, name: "題庫" },
      { id: 2, parent_id: 1, name: "第二層" }],
    records: [{ id: 10, folder_id: 0, title: "根棋譜", file_name: "ROOT" },
      { id: 11, folder_id: 1, title: "第一層棋譜", file_name: "CHILD" },
      { id: 12, folder_id: 2, title: "第二層棋譜", file_name: "GRANDCHILD" }],
  };
  let cloudRequests = 0;
  const loadedIds = [];
  const cloud = {
    load: async id => { loadedIds.push(id); return { imported: true }; },
    authMe: async () => ({ id: 1 }),
    listCatalog: async () => { cloudRequests++; return mockCatalog; },
  };
  const events = new Map();
  const global = {
    addEventListener(type, listener) { (events.get(type) || events.set(type, []).get(type)).push(listener); },
    emit(type, detail) {
      for (const listener of events.get(type) || []) listener({ type, detail });
    },
    FiveDB,
    // Production member API is injected after the batch script.
    VCFCloud5DB: undefined,
  };
  const document = {
    getElementById,
    createElement: () => new Element(),
    documentElement: { dataset: { vcfTab: "benchmark" } },
  };
  const context = { window: global, document, console };
  getElementById("vcf-batch-folder").value = "-1";
  getElementById("vcf-batch-target-folder").value = "0";
  getElementById("vcf-batch-include-subfolders").checked = true;
  vm.runInNewContext(source, context, { filename: "vcf-batch-benchmark.js" });
  const folder = getElementById("vcf-batch-folder");
  assert.equal(folder.disabled, false, "folder is immediately selectable, even before cloud import");
  assert.equal(cloudRequests, 0, "cloud API is not called before its script has loaded");
  global.VCFCloud5DB = cloud;
  global.emit("load");
  const flush = () => new Promise(resolve => setImmediate(resolve));
  await flush();
  assert.equal(cloudRequests, 1, "opening benchmark loads the cloud catalog without pressing read");
  assert.deepEqual(folder.children.map(x => x.value), ["-1", "0", "1", "2"],
    "folder choices include nested cloud folders");
  assert.match(getElementById("vcf-batch-table-body").innerHTML, /GRANDCHILD/,
    "records are displayed after automatic cloud loading");
  folder.value = "1";
  folder.dispatch("change");
  const table = () => getElementById("vcf-batch-table-body").innerHTML;
  assert.ok(table().includes("CHILD") && table().includes("GRANDCHILD") && !table().includes("ROOT"),
    "selecting a folder filters cloud records with descendants");
  getElementById("vcf-batch-include-subfolders").checked = false;
  getElementById("vcf-batch-include-subfolders").dispatch("change");
  assert.ok(table().includes("CHILD") && !table().includes("GRANDCHILD"),
    "unchecking descendant folders keeps only directly contained records");
  const body = getElementById("vcf-batch-table-body");
  const row = { dataset: { batchRow: "cloud:11" } };
  let tabClicks = 0;
  getElementById("vcf-tab-calculation").addEventListener("click", () => { tabClicks++; });
  const checkedBefore = getElementById("vcf-batch-selected").textContent;
  body.dispatch("click", { closest: selector => selector === "input[type=checkbox]" ? {} : row });
  await flush();
  assert.deepEqual(loadedIds, [], "checkbox clicks do not load records");
  body.dispatch("click", { closest: selector => selector === "tr[data-batch-row]" ? row : null });
  await flush();
  assert.deepEqual(loadedIds, [11], "row click loads the record by stable cloud ID");
  assert.equal(tabClicks, 1, "successful load opens calculation tab");
  assert.equal(getElementById("vcf-batch-selected").textContent, checkedBefore, "row click leaves batch selection unchanged");
  document.documentElement.dataset.vcfTab = "calculation";
  global.emit("vcf-workbench-tab-changed", { tab: "calculation" });
  document.documentElement.dataset.vcfTab = "benchmark";
  global.emit("vcf-workbench-tab-changed", { tab: "benchmark" });
  await flush();
  assert.equal(cloudRequests, 1, "returning to populated benchmark does not refetch cloud data");
}
verifyLiveFolderSelector().then(() =>
  console.log("VCF batch automatically loads nested cloud folders and no longer has a search field")
).catch(error => { console.error(error); process.exitCode = 1; });
