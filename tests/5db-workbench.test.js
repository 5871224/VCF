"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const FiveDB = require("../rapfi/5db-format.js");
const script = fs.readFileSync("rapfi/rapfi-workbench-header.js", "utf8");
function createWorkbench() {
  let board = new Uint8Array(225), history = [];
  const disk = new Map(), routes = new Map();
  const title = { value: "", dispatchEvent() {}, addEventListener() {} };
  const service = {
    isReady: true,
    clear() { board = new Uint8Array(225); history = []; return true; },
    resetBoard() { board = new Uint8Array(225); history = []; return true; },
    ensureCurrent() { return true; },
    board() { return board; },
    history() { return history.slice(); },
    ply() { return history.length; },
    sideToMove() { return history.length % 2 === 0 ? 1 : 2; },
    replayMove(move) {
      if (move !== -1 && (!Number.isInteger(move) || move < 0 || move >= 225 || board[move])) return false;
      if (move >= 0) board[move] = this.sideToMove();
      history.push(move);
      return true;
    },
    play(move) { return this.replayMove(move); },
    undo() {
      if (!history.length) return false;
      const move = history.pop();
      if (move >= 0) board[move] = 0;
      return true;
    },
    children() { return []; },
    getDisplayText() { return ""; },
    setDisplayText() { return true; },
  };
  const win = {
    FiveDB, VCFRapfiDB: service, VCF_CLOUD_API_URL: "",
    localStorage: {
      getItem: k => disk.get(k) || null,
      setItem: (k,v) => disk.set(k,v),
      removeItem: k => disk.delete(k),
    },
    addEventListener() {},
    dispatchEvent() {},
    vcfNotifyBoardChanged() {},
    _renderBoardArr() {},
    _setBoardArr() {},
    VCFStaticAnnotations: {
      reset() { routes.clear(); },
      list() { return routes.get(win.VCFWorkbenchRecord?.annotationRoute()) || []; },
      count() { return [...routes.values()].reduce((n,v)=>n+v.length,0); },
      importData(data) { routes.clear(); for(const [k,v] of Object.entries(data)) routes.set(k,v); },
      setMark(mark) {
        const key = win.VCFWorkbenchRecord.annotationRoute();
        routes.set(key,[...(routes.get(key)||[]),mark]);
        return true;
      },
      transform() { return true; },
    },
  };
  const document = {
    getElementById: id => id === "vcf-record-title" ? title : null,
    querySelector: q => q === 'input[name="rules"]:checked' ? { value: "2" } : null,
  };
  vm.runInNewContext(script, {
    window: win, document, localStorage: win.localStorage, console, Uint8Array, TextEncoder, TextDecoder, URL,
    queueMicrotask, btoa, atob, setTimeout, clearTimeout,
    CustomEvent: class CustomEvent { constructor(type,options){ this.type=type; this.detail=options?.detail; }},
    Event: class Event { constructor(type){this.type=type;} },
  }, { filename: "rapfi-workbench-header.js" });
  return { win, service, title, disk };
}
(async () => {
  const { win, title } = createWorkbench();
  await new Promise(setImmediate);
  const record = win.VCFWorkbenchRecord;
  assert.equal(record.startWorkspace("record"), true);
  assert.equal(record.playAt(112),true);
  assert.equal(record.playAt(113),true);
  assert.equal(record.navigateStep(-1),true);
  assert.equal(record.playAt(97),true);
  assert.equal(record.navigateStep(-1),true);
  assert.equal(record.navigateStep(1),true);
  assert.equal(record.currentBoard()[97],2,"last selected branch must be restored");
  record.setCurrentRecordText("選定支線");
  win.VCFStaticAnnotations.setMark({type:"circle",x:6,y:6,color:1,filled:true});
  title.value="棋譜測試";
  const saved=record.export5DBDocument();
  assert.equal(saved.root.children[0].children.length,2,"both branches must remain");
  assert.equal(saved.currentPath.length,2);
  const bytes=FiveDB.encode(saved);
  const reload=createWorkbench();
  await new Promise(setImmediate);
  assert.equal(await reload.win.VCFWorkbenchRecord.import5DBDocument(FiveDB.decode(bytes)),true);
  const next=reload.win.VCFWorkbenchRecord;
  assert.equal(next.currentBoard()[97],2,"loaded board must retain its original direction");
  assert.equal(next.currentBoard()[113],0);
  assert.equal(next.currentRecordText(),"選定支線");
  assert.equal(reload.win.VCFStaticAnnotations.count(),1);
  assert.equal(next.navigateStep(-1),true);
  assert.equal(next.navigateStep(1),true);
  assert.equal(next.currentBoard()[97],2,"last selected route is restored after stepping back");
  assert.equal(next.navigateStep(-1),true);
  assert.equal(next.playAt(113),true);
  assert.equal(next.currentBoard()[113],2,"second branch is independently editable");
  assert.equal(next.currentRecordText(),"","branch notes must not be shared");
  const abnormal=Array(225).fill(0);
  for(const i of [10,11,12,13,14,15,16,17]) abnormal[i]=1;
  for(const i of [40,41,42]) abnormal[i]=2;
  const irregular={
    width:15,height:15,mode:"puzzle",nextSide:2,title:"不規則黑白子",board:abnormal,
    currentPath:[0],root:{move:-1,stone:0,text:"開始",marks:[],
      children:[{move:100,stone:2,text:"白先行",marks:[],children:[]}]},
  };
  const loaded=createWorkbench();
  await new Promise(setImmediate);
  assert.equal(await loaded.win.VCFWorkbenchRecord.import5DBDocument(irregular),true);
  assert.deepEqual(Array.from(loaded.win.VCFWorkbenchRecord.currentBoard()),(()=>{
    const x=abnormal.slice();x[100]=2;return x;})());
  assert.equal(loaded.win.VCFWorkbenchRecord.export5DBDocument().root.children[0].stone,2);
  console.log("5DB live workbench: branches, notes, marks, reload, orientation, irregular setup passed");
})().catch(err=>{console.error(err);process.exitCode=1;});
