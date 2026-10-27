"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const source = fs.readFileSync("rapfi/vcf-static-annotations.js", "utf8");
const disk = new Map();
let path = "2:record:31";
const win = {
  VCFWorkbenchRecord: { annotationRoute: () => path },
  localStorage: { getItem: name => disk.get(name) || null, setItem: (name, value) => disk.set(name, value) },
  dispatchEvent() {},
  btoa: text => Buffer.from(text, "latin1").toString("base64"),
  atob: text => Buffer.from(text, "base64").toString("latin1"),
};
function boot() {
  vm.runInNewContext(source, {
    window: win, Event: class Event { constructor(name) { this.type = name; } },
    TextEncoder, TextDecoder, Blob, Response, CompressionStream, DecompressionStream,
    console,
  }, { filename: "vcf-static-annotations.js" });
  return win.VCFStaticAnnotations;
}
async function main() {
  let store = boot();
  assert.equal(store.COLORS.length, 10);
  assert.equal(store.setMark({ type: "circle", x: 1, y: 2, color: 0, filled: true }), true);
  assert.equal(store.setMark({ type: "text", x: 1, y: 2, text: "A", color: 5 }), true);
  assert.equal(store.setMark({ type: "arrow", x: 1, y: 2, tx: 5, ty: 6, color: 3 }), true);
  assert.equal(store.list().length, 3, "multiple independent marks may occupy one intersection");
  assert.equal(store.setMark({ type: "circle", x: 1, y: 2, color: 6, filled: false }), true);
  assert.equal(store.list().length, 3, "same shape on same point replaces only that shape");
  assert.equal(store.setMark({ type: "text", x: 1, y: 2, color: 7, text: "AB" }), false, "one character only");
  assert.equal(store.setMark({ type: "text", x: -1, y: 2, color: 7, text: "A" }), false);
  assert.equal(store.setMark({ type: "text", x: 1, y: 2, color: 11, text: "A" }), false);
  assert.equal(store.eraseAt(5, 6), true, "deletion from target endpoint removes connector");
  assert.equal(store.list().length, 2);
  store = boot();
  assert.equal(store.list().length, 2, "annotations survive local reload");
  assert.equal(store.transform(1), true);
  path = "2:record:27";
  const marks = store.list();
  assert.equal(marks.length, 2);
  assert.equal(marks[0].x, 12);
  assert.equal(marks[0].y, 1);
  const original = store.exportData();
  store.reset();
  assert.equal(store.count(), 0);
  store.importData(original);
  assert.equal(JSON.stringify(store.exportData()), JSON.stringify(original));
  assert.equal(store.list().length, 2);
  assert.equal(typeof store.encode, "undefined", "legacy VCFDB encoder must be removed");
  assert.equal(typeof store.decode, "undefined", "legacy VCFDB decoder must be removed");
  assert.throws(() => store.importData({ "2:record:1": [{ type: "circle", x: 99, y: 0, color: 0 }] }), /無效/);
  // Exercise the production marker placement handler, not a copied algorithm.
  const sourceUI = fs.readFileSync("rapfi/vcf-record-tools.js", "utf8");
  const from = sourceUI.indexOf("  function applyMarker(index) {");
  const to = sourceUI.indexOf("  function removeMarker(index) {", from);
  assert.ok(from >= 0 && to > from, "marker handler exists");
  const markerInput = { value: "abc" };
  const messages = [];
  const context = {
    annotation: store, markerInput, fillCheckbox: { checked: false }, arrowCheckbox: { checked: false },
    BOARD_SIZE: 15, selectedTool: "text", selectedColor: 1, pendingStart: null,
    refreshMarkerTools() {}, status(value) { messages.push(value); },
  };
  const place = vm.runInNewContext(
    "(function () { " + sourceUI.slice(from, to) + "; return applyMarker; })()",
    context, { filename: "vcf-record-marker-handler.js" }
  );
  path = "2:record:31";
  store.reset();
  place(0);
  assert.equal(markerInput.value, "bc", "first click consumes only a");
  place(1);
  assert.equal(markerInput.value, "c", "second click consumes only b");
  place(2);
  assert.equal(markerInput.value, "", "third click consumes only c");
  assert.equal(store.list().map(x => x.text).join(""), "abc", "placed marks remain individual characters");
  place(3);
  assert.equal(store.list().length, 3, "empty input cannot create an extra mark");
  assert.match(messages.at(-1), /請先輸入/);

  markerInput.value = "棋譜🙂";
  for (let i = 3; i <= 5; i++) place(i);
  assert.equal(store.list().map(x => x.text).join(""), "abc棋譜🙂", "Unicode characters are consumed without splitting surrogate pairs");
  assert.equal(markerInput.value, "");
  markerInput.value = "保留";
  context.annotation = { setMark() { return false; } };
  place(6);
  assert.equal(markerInput.value, "保留", "failed storage must not consume input");
  context.annotation = store;
  context.selectedTool = "circle";
  place(6);
  assert.equal(markerInput.value, "保留", "circle mode must not consume queued text");
  assert.equal(store.list().at(-1).type, "circle");
  // Straight lines and arrows share one UI tool and differ only by the checkbox.
  context.selectedTool = "line";
  context.arrowCheckbox.checked = false;
  place(30);
  assert.equal(context.pendingStart.x, 0);
  assert.equal(context.pendingStart.y, 2);
  place(32);
  assert.equal(store.list().at(-1).type, "line", "unchecked draws a straight line");
  assert.equal(context.pendingStart, null);
  context.arrowCheckbox.checked = true;
  place(45);
  place(47);
  assert.equal(store.list().at(-1).type, "arrow", "checked draws an arrow");
  assert.equal(context.pendingStart, null);
  context.arrowCheckbox.checked = false;
  place(45);
  place(47);
  assert.equal(store.list().at(-1).type, "line", "unchecking draws straight lines again");
  assert.equal(store.list().filter(mark => (mark.type === "line" || mark.type === "arrow") && mark.y === 3).length, 1,
    "switching the option replaces the same connector instead of overlaying it");
  context.arrowCheckbox.checked = true;
  place(60);
  place(60);
  assert.match(messages.at(-1), /起點和終點不能相同/);
  assert.equal(context.pendingStart.y, 4, "invalid endpoint keeps starting point");
  const legacy = store.exportData();
  store.reset();
  store.importData(legacy);
  assert.equal(store.list().some(mark => mark.type === "arrow"), false, "latest shape is saved as line");
  const oldFormat = JSON.parse(JSON.stringify(legacy));
  const routeKey = "2:record:31";
  oldFormat[routeKey].push({ type: "arrow", x: 8, y: 8, tx: 10, ty: 10, color: 3 });
  store.importData(oldFormat);
  assert.equal(store.list().at(-1).type, "arrow", "legacy arrow marks remain readable");

  const html = fs.readFileSync("index.html", "utf8");
  const inputTag = html.match(/<input id="vcf-record-marker-text"[^>]+>/)?.[0] || "";
  assert.ok(inputTag && !inputTag.includes("maxlength="), "marker text input accepts a long queue");
  assert.ok(!sourceUI.includes('markerInput.value = Array.from(markerInput.value).slice(0, 1)'), "typing must not truncate queued text");
  assert.equal((html.match(/data-mark-tool="line"/g) || []).length, 1, "there is one line tool");
  assert.ok(!html.includes('data-mark-tool="arrow"'), "standalone arrow tool has been removed");
  assert.match(html, /data-mark-line hidden><input id="vcf-mark-arrow" type="checkbox"> 箭頭/, "line checkbox is in the marker options");
  assert.ok(sourceUI.includes('markerTools.querySelector("[data-mark-line]").hidden = selectedTool !== "line"'),
    "arrow toggle is only visible for the line tool");
  assert.ok(sourceUI.includes('arrowCheckbox.addEventListener("change", refreshMarkerTools)'),
    "changing arrow option refreshes controls");
  const toolElements = [...html.matchAll(/<button type="button" data-mark-tool="(circle|line|text|erase)"([^>]*)>(.*?)<\/button>/g)];
  assert.deepEqual(toolElements.map(x => x[1]), ["circle", "line", "text", "erase"], "order is circle, line, text, erase");
  for (const [, tool, attrs, body] of toolElements) {
    assert.match(attrs, /class="vcf-static-marker-icon-button(?: is-active)?"/, tool + " uses unified icon buttons");
    assert.ok(attrs.includes('title="') && attrs.includes('aria-label="') && attrs.includes('aria-pressed="'),
      tool + " has tooltip and accessible state");
    assert.ok(body.includes('<img src="rapfi/record-svg/mark_' + tool + '.svg" alt=""'), tool + " renders SVG icon");
    assert.ok(fs.existsSync("rapfi/record-svg/mark_" + tool + ".svg"), tool + " asset exists");
  }
  assert.match(inputTag, /value="ABCDEFGHIJKLMNOPQRSTUVWXYZ"/, "marker queue defaults to A through Z");
  assert.ok(!html.includes('id="vcf-static-marker-help"'), "no operation instructions take up toolbar space");
  assert.ok(!sourceUI.includes("markerHelp") && !sourceUI.includes("const tips ="), "obsolete help UI logic is removed");
  assert.ok(!html.includes("點擊交點新增圓圈；右鍵刪除該交點標記"), "no stale marker instructions");
  console.log("Static annotation route, icon toolbar, marker queue, line/arrow option and legacy tests passed");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
