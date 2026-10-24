"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const FiveDB = require("../rapfi/5db-format.js");
class Element {
  constructor(tag = "div") {
    this.tag = tag; this.children = []; this.attrs = {};
    this.listeners = {}; this.parentNode = null; this.id = "";
    this.className = ""; this.hidden = false; this.disabled = false;
    this._text = ""; this._html = ""; this.open = false;
  }
  set textContent(v) { this._text = String(v); this.children = []; }
  get textContent() { return this._text || this.children.map(x => x.textContent).join(""); }
  set innerHTML(html) {
    this._html = String(html); this.children = [];
    if (html.includes('id="vcf-google-login"')) {
      const login = new Element(); login.id = "vcf-google-login";
      const user = new Element("span"); user.id = "bb-cloud-user";
      const logout = new Element("button"); logout.id = "bb-cloud-logout";
      this.append(login, user, logout);
    } else if (html.includes('data-list')) {
      const head = new Element(); const close = new Element("button");
      close.attrs["data-close"] = ""; head.append(close);
      const list = new Element(); list.attrs["data-list"] = "";
      this.append(head, list);
    } else if (html.includes("vcf-cloud-title")) {
      this.append(new Element(), new Element());
    }
  }
  get firstElementChild() { return this.children[0] || null; }
  get lastElementChild() { return this.children.at(-1) || null; }
  get firstChild() { return this.children[0] || null; }
  append(...xs) { for (const x of xs) { this.children.push(x); x.parentNode = this; } }
  appendChild(x) { this.append(x); return x; }
  insertBefore(x) { this.append(x); return x; }
  replaceChildren(...xs) { this.children = []; this.append(...xs); }
  remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(x => x !== this); }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  querySelector(selector) {
    for (const child of this.children) {
      if (selector[0] === "#" && child.id === selector.slice(1)) return child;
      if (selector[0] === "[" && Object.hasOwn(child.attrs, selector.slice(1, -1))) return child;
      const nested = child.querySelector(selector);
      if (nested) return nested;
    }
    return null;
  }
  addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
  async click() {
    for (const fn of this.listeners.click || []) await fn({ target: this, preventDefault() {} });
  }
  showModal() { this.open = true; }
  close() { this.open = false; }
}
const panel = new Element(); panel.id = "bitboard-architecture-panel";
const document = {
  head: new Element("head"), body: new Element("body"),
  createElement: tag => new Element(tag),
  createElementNS: (_ns, tag) => new Element(tag),
  getElementById(id) {
    if (id === panel.id) return panel;
    return panel.querySelector("#" + id) || this.body.querySelector("#" + id) || this.head.querySelector("#" + id);
  },
};
const documentFor = (title, moves) => {
  const board = Array(225).fill(0); board[5] = 1;
  return {
    width:15,height:15,mode:"record",nextSide:2,title,board,currentPath: moves.length ? [0] : [],
    root:{move:-1,stone:0,text:"",marks:[],children:moves.map(move=>({move,stone:2,text:"",marks:[],children:[]}))},
  };
};
const now = documentFor("新版標題", [10]);
const old = documentFor("舊版標題", [20]);
const newBoard = FiveDB.preview(now);
const storage = new Map([["vcf_google_auth_token_v1", "test-token"]]);
const localStorage = {
  getItem: k => storage.get(k) || null,
  setItem: (k,v) => storage.set(k,v),
  removeItem: k => storage.delete(k),
};
let fileGets = 0;
const fetch = async url => {
  const u = String(url);
  if (u.includes("public_config")) return { status:200, ok:true, json:async()=>({ok:true}) };
  if (u.includes("auth_me")) return { status:200, ok:true, json:async()=>({ok:true,user:{email:"example@gmail.com"}}) };
  if (u.includes("action=list")) return { status:200,ok:true,json:async()=>({ok:true,records:[
    {id:1,file_name:"新棋譜",title:"新版標題",record_count:2,compressed_size:250,preview:`15x15:${newBoard.board}`},
    {id:2,file_name:"舊棋譜",title:"舊版標題",record_count:2,compressed_size:250},
  ]}) };
  if (u.includes("action=get&id=2")) {
    fileGets++;
    const b = FiveDB.encode(old);
    return {status:200,ok:true,headers:{get:()=>""},arrayBuffer:async()=>b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength)};
  }
  throw Error("Unexpected request " + u);
};
const observers = [];
class FakeObserver {
  constructor(callback, opts) { this.callback=callback; this.opts=opts; this.targets=[]; observers.push(this); }
  observe(el) { this.targets.push(el); }
  unobserve(el) { this.targets=this.targets.filter(x=>x!==el); }
  disconnect() { this.targets=[]; }
  trigger() { this.callback(this.targets.map(target=>({target,isIntersecting:true}))); }
}
const window = {
  FiveDB, VCFWorkbenchRecord:{workspace:()=>({mode:"record"})},
  addEventListener() {}, dispatchEvent() {},
};
vm.runInNewContext(fs.readFileSync("rapfi/vcf-5db-cloud.js", "utf8"), {
  window, document, localStorage, fetch, URLSearchParams, AbortController,
  setTimeout, clearTimeout, TextEncoder, TextDecoder, Date, Uint8Array, Blob,
  IntersectionObserver: FakeObserver, console,
}, {filename:"vcf-5db-cloud.js"});
(async () => {
  await new Promise(setImmediate);
  await document.getElementById("bb-cloud-open").click();
  const dialog = document.getElementById("vcf-cloud-dialog");
  assert.equal(dialog.open, true);
  const list = dialog.querySelector("[data-list]");
  assert.equal(list.children.length, 2, "both cloud files appear");
  const [fresh, previous] = list.children;
  assert.equal(fresh.children[0].children[0].tag, "svg", "saved preview is instant");
  const circles = fresh.children[0].children[0].children.filter(x=>x.tag==="circle");
  assert.equal(circles.length,2,"both setup and current-branch stones are visible");
  assert.equal(fresh.children[1].children[0].textContent,"新棋譜.5db");
  assert.equal(fileGets,0,"opening a list must not download whole 5DB files");
  assert.equal(previous.children[0].textContent,"載入縮圖…","older file waits for visibility");
  assert.equal(observers.at(-1).targets.length,1,"only missing thumbnail is lazy");
  observers.at(-1).trigger();
  await new Promise(setImmediate);
  assert.equal(fileGets,1,"only the visible old file is requested");
  assert.equal(previous.children[0].children[0].tag,"svg","old file renders after decode");
  assert.equal(previous.children[0].children[0].children.filter(x=>x.tag==="circle").length,2);
  await document.getElementById("bb-cloud-open").click();
  assert.equal(fileGets,1,"older previews are kept in session cache");
  console.log("Cloud 5DB thumbnails: immediate preview, saved branch, lazy old records and cache passed");
})().catch(error => {console.error(error); process.exitCode = 1;});
