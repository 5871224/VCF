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
