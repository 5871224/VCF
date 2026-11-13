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
    this._text = ""; this._html = ""; this.open = false; this.dataset = {};
  }
  set textContent(v) { this._text = String(v); this.children = []; }
  get textContent() { return this._text || this.children.map(x => x.textContent).join(""); }
  set innerHTML(html) {
    this._html = String(html); this.children = [];
    if (html.includes('id="vcf-shared-login"')) {
      const login = new Element("button"); login.id = "vcf-shared-login";
      const user = new Element("span"); user.id = "bb-cloud-user";
      const logout = new Element("button"); logout.id = "bb-cloud-logout";
      this.append(login, user, logout);
    } else if (html.includes('data-list')) {
      const head = new Element(); const close = new Element("button");
      close.attrs["data-close"] = ""; head.append(close);
      const list = new Element(); list.attrs["data-list"] = "";
      this.append(head, list);
    } else if (html.includes('class="sched-email-auth-heading"')) {
      const create = (parent, key, tag = "div") => {
        const node = new Element(tag); node.attrs[`data-${key}`] = ""; parent.append(node); return node;
      };
      const heading = new Element(); this.append(heading);
      create(heading, "title", "h2"); create(heading, "close", "button");
      const choices = create(this, "choices");
      const googleWrap = create(choices, "google-wrap"); create(googleWrap, "google");
      create(choices, "email-choice", "button"); create(this, "google-error", "p");
      const form = create(this, "form", "form"); form.elements = {};
      for (const [row, name] of [["name-row", "name"], ["email-row", "email"], ["password-row", "password"]]) {
        const label = create(form, row, "label");
        label.append(new Element("text"));
        const input = new Element("input"); input.attrs.name = name; input.value = "";
        label.append(input); form.elements[name] = input;
      }
      create(form, "error", "p"); create(form, "submit", "button");
      create(this, "notice"); create(this, "choice-error");
      const actions = create(this, "actions", "nav");
      create(actions, "register", "button"); create(actions, "forgot", "button"); create(actions, "back", "button");
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
      if (selector === `[name="${child.attrs.name}"]` && child.attrs.name) return child;
      if (child.tag === selector) return child;
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
const accountSlot = new Element(); accountSlot.id = "vcf-account-actions";
const document = {
  head: new Element("head"), body: new Element("body"),
  addEventListener() {},
  createElement: tag => new Element(tag),
  createElementNS: (_ns, tag) => new Element(tag),
  getElementById(id) {
    if (id === panel.id) return panel;
    if (id === accountSlot.id) return accountSlot;
    return accountSlot.querySelector("#" + id) || panel.querySelector("#" + id) || this.body.querySelector("#" + id) || this.head.querySelector("#" + id);
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
let fileGets = 0;
let emailLogins = 0;
const fetch = async url => {
  const u = String(url);
  if (u.includes("public_config")) return { status:200, ok:true, json:async()=>({ok:true,data:{}}) };
  if (u.includes("auth_me")) return { status:200, ok:true, json:async()=>({ok:true,logged_in:true,data:{user_id:5,email:"example@gmail.com",permission:"user"}}) };
  if (u.includes("auth_email_login")) { emailLogins++; return {status:200,ok:true,json:async()=>({ok:true})}; }
  if (u.includes("auth_logout")) return { status:200, ok:true, json:async()=>({ok:true}) };
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
  window, document, fetch, URLSearchParams, AbortController,
  setTimeout, clearTimeout, setInterval:()=>1, clearInterval:()=>{}, TextEncoder, TextDecoder, Date, Uint8Array, Blob,
  IntersectionObserver: FakeObserver, console,
}, {filename:"vcf-5db-cloud.js"});
(async () => {
  await new Promise(setImmediate);
  assert.equal(document.getElementById("bb-cloud-auth").parentNode, accountSlot,
    "login and logout belong to the top-right header");
  assert.equal(panel.querySelector("#bb-cloud-auth"), null,
    "account actions must not remain in the bottom quick-action panel");
  assert.equal(document.getElementById("bb-cloud-admin"), null,
    "BD1 no longer shows a member-management button to anyone");
  assert.equal(document.getElementById("vcf-shared-login").hidden, true,
    "signed-in users must not see login");
  assert.equal(document.getElementById("bb-cloud-logout").hidden, false,
    "signed-in users can sign out in the header");
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
  await window.VCFCloud5DB.logout();
  assert.equal(document.getElementById("vcf-shared-login").hidden, false,
    "logging out of Sched reveals the shared member login button");
  await document.getElementById("vcf-shared-login").click();
  const loginDialog = document.getElementById("vcf-shared-login-dialog");
  assert.equal(loginDialog.open, true);
  assert.ok(loginDialog._html.includes('sched-email-auth-heading'),
    "the single login dialog reuses Sched's visual structure");
  assert.ok(!loginDialog._html.includes('<iframe'),
    "opening login must not embed a second dialog inside an iframe");
  await loginDialog.querySelector('[data-email-choice]').click();
  assert.equal(loginDialog.dataset.mode, 'login');
  assert.equal(loginDialog.querySelector('[data-form]').hidden, false,
    "Email login expands within the same compact dialog");
  const loginForm = loginDialog.querySelector('[data-form]');
  loginForm.elements.email.value = 'example@gmail.com';
  loginForm.elements.password.value = 'test-password';
  loginForm.listeners.submit[0]({preventDefault(){}});
  await new Promise(setImmediate);
  assert.equal(emailLogins, 1, "Email credentials go directly to the Sched membership API");
  assert.equal(loginDialog.open, false, "successful login closes the one centered dialog");
  console.log("Cloud 5DB thumbnails: immediate preview, saved branch, lazy old records and cache passed");
})().catch(error => {console.error(error); process.exitCode = 1;});
