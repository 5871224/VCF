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
  console.log("Static annotation route, mark, and rotation tests passed");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
