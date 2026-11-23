"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const FiveDB = require("../rapfi/5db-format.js");
const source = fs.readFileSync("rapfi/vcf-5db-cloud.js", "utf8");
const php = fs.readFileSync("api/5db.php", "utf8");
const calls = [];
const fetch = async (url, options = {}) => {
  const parsed = new URL(String(url), "https://example.test");
  const action = parsed.searchParams.get("action");
  calls.push({ action, params: parsed.searchParams, options });
  if (action === "auth_me") return { status: 200, ok: true, json: async () => ({
    ok: true, logged_in: true, data: { user_id: 1, email: "tester@example.com" },
  }) };
  if (action === "list") return { status: 200, ok: true, json: async () => ({
    ok: true, records: [{ id: 12, file_name: "一號", title: "題目", folder_id: 7 }],
    folders: [{ id: 7, name: "題庫", parent_id: 0 }, { id: 8, name: "進階", parent_id: 7 }],
  }) };
  if (action === "save") return { status: 200, ok: true, json: async () => ({ok: true, id: 13}) };
  if (action === "records_move") {
    const ids = JSON.parse(options.body).ids;
    return { status: 200, ok: true, json: async () => ({
      ok: true, ids, folder_id: Number(parsed.searchParams.get("folder_id")), moved: ids.length,
    }) };
  }
  if (["folder_create", "folder_rename", "folder_move", "folder_delete", "record_move"].includes(action))
    return { status: 200, ok: true, json: async () => ({ok: true}) };
  throw Error("Unknown call " + parsed.toString());
};
const window = {FiveDB, addEventListener() {}, VCFWorkbenchRecord: {}};
const document = {getElementById: () => null, addEventListener() {}};
vm.runInNewContext(source, {window, document, fetch, URLSearchParams,
  AbortController, setTimeout, clearTimeout, Uint8Array, Blob, Date, console},
{filename: "vcf-5db-cloud.js"});
(async () => {
  const api = window.VCFCloud5DB;
  await api.authMe();
  const listing = await api.listCatalog();
  assert.equal(listing.records[0].folder_id, 7);
  assert.equal(listing.folders[1].parent_id, 7);
  assert.equal((await api.list()).length, 1, "existing list contract remains records array");
  await api.createFolder("第二層", 7);
  await api.renameFolder(8, "測試");
  await api.moveFolder(8, 0);
  await api.deleteFolder(8);
  await api.moveRecord(12, 7);
  await api.moveRecords([12, 13, 14], 7);
  const bulk = calls.filter(call => call.action === "records_move");
  assert.equal(bulk.length, 1, "three files move with one authenticated POST");
  assert.equal(bulk[0].options.method, "POST");
  assert.equal(bulk[0].options.credentials, "same-origin");
  assert.equal(bulk[0].params.get("folder_id"), "7");
  assert.deepEqual(JSON.parse(bulk[0].options.body).ids, [12, 13, 14]);
  assert.equal(bulk[0].options.headers["Content-Type"], "application/json");
  const ids = Array.from({length: 2001}, (_, i) => i + 1);
  await api.moveRecords(ids, 8);
  assert.equal(calls.filter(call => call.action === "records_move").length, 2,
    "more than 2000 records move in a single request with no record-count limit");
  const large = Array.from({length: 100000}, (_, i) => i + 1);
  const before = calls.length;
  await api.moveRecords(large, 8);
  const largeCalls = calls.slice(before).filter(call => call.action === "records_move");
  assert.ok(largeCalls.length > 1, "very large selection is automatically split by byte size");
  assert.equal(largeCalls.reduce((n, call) => n + JSON.parse(call.options.body).ids.length, 0),
    large.length, "every selected item is included without truncation");
  assert.ok(largeCalls.every(call => call.options.body.length <= 262144),
    "all requests obey the backend payload-byte safeguard");
  assert.ok(largeCalls.some(call => JSON.parse(call.options.body).ids.length > 2000),
    "a batch can contain over 2000 selected records");
  assert.equal(largeCalls.at(0).options.body.length > 200000, true,
    "request uses most of available payload size before splitting");
  assert.ok(php.includes("const FIVE_DB_MOVE_REQUEST_BYTES = 262144"), "backend checks request bytes");
  assert.ok(php.includes("array_is_list($ids)"), "backend validates JSON list");
  assert.ok(!php.includes("count($ids) > 2000"), "backend has no count ceiling");
  assert.ok(!php.includes("一次最多移動 2000"), "obsolete count error removed");
  assert.ok(calls.every(call => call.action !== "get"), "moves never retrieve original 5DB files");
  assert.ok(php.includes("if ($action === 'records_move')"), "batch route implemented");
  assert.ok(php.includes("if ($changed > 0) writeManifest5($fp, $manifest)"),
    "all record folder IDs updated in one manifest write per batch");
  assert.ok(php.includes("if (!isset($records[(string)$id]))") || php.includes("!isset($records[(string)$id])"),
    "missing record aborts before write");
  const names = calls.map(call => call.action);
  for (const name of ["folder_create", "folder_rename", "folder_move", "folder_delete", "record_move"]) {
    const call = calls.find(c => c.action === name);
    assert.ok(call, name + " request");
    assert.equal(call.options.method, "POST", name + " must be write-only");
    assert.equal(call.options.credentials, "same-origin", "folder changes require Sched cookie");
  }
  assert.equal(calls.find(c => c.action === "folder_create").params.get("parent_id"), "7");
  assert.equal(calls.find(c => c.action === "record_move").params.get("folder_id"), "7");
  const doc = {width:15,height:15,mode:"puzzle",phase:"setup",nextSide:1,title:"棋譜標題",
    board:Array(225).fill(0),currentPath:[],root:{move:-1,stone:0,text:"",marks:[],children:[]}};
  await api.saveDocument(doc, "練習01", 8);
  const save = calls.find(c => c.action === "save");
  assert.equal(save.params.get("folder_id"), "8");
  assert.equal(save.params.get("title"), "棋譜標題");
  assert.equal(save.params.get("file_name"), "練習01");
  assert.equal(FiveDB.decode(save.options.body).title, "棋譜標題");
  assert.ok(!php.includes("FIVE_DB_MAX_RECORDS"), "no hard record-count cap");
  assert.ok(php.includes("FIVE_DB_MAX_ACCOUNT"), "byte-cap still applies");
  assert.ok(php.includes("function uniqueSibling5"), "duplicate sibling names rejected");
  assert.ok(php.includes("if ($cursor === $id)"), "folder cycles blocked");
  assert.ok(php.includes("資料夾仍有子資料夾"), "non-empty folder removal blocked");
  console.log("5DB cloud nested folders, old listing API, cookie authentication and unrestricted count passed");
})().catch(error => {console.error(error); process.exitCode = 1;});
