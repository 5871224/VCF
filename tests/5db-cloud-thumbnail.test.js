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
    this._text = ""; this._html = ""; this.open = false; this.dataset = {}; this.style = {};
    this.classList = {
      add: name => { if (!this.className.split(" ").includes(name)) this.className = [this.className, name].filter(Boolean).join(" "); },
      remove: name => { this.className = this.className.split(" ").filter(x => x !== name).join(" "); },
    };
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
      const toolbar = new Element();
      for (const key of ["folder-create", "folder-rename", "folder-move", "folder-delete"]) {
        const button = new Element("button"); button.attrs["data-" + key] = ""; toolbar.append(button);
      }
      const tree = new Element(); tree.attrs["data-tree"] = "";
      const path = new Element(); path.attrs["data-folder-path"] = "";
      const buttons = new Element();
      const count = new Element(); count.attrs["data-selected-count"] = ""; buttons.append(count);
      for (const key of ["select-all", "batch-move", "batch-delete", "view-thumbnails", "view-details"]) {
        const button = new Element("button"); button.attrs["data-" + key] = "";
        buttons.append(button);
      }
      const scroll = new Element(); scroll.attrs["data-file-scroll"] = "";
      const list = new Element(); list.attrs["data-list"] = ""; scroll.append(list);
      this.append(head, toolbar, tree, path, buttons, scroll);
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
      this.append(new Element(), new Element(), new Element());
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
  querySelectorAll(selector) {
    const list = [];
    const matches = el => selector.startsWith(".") && el.className.split(" ").includes(selector.slice(1));
    const walk = node => {
      for (const child of node.children) {
        if (matches(child)) list.push(child);
        walk(child);
      }
    };
    walk(this);
    return list;
  }
  querySelector(selector) {
    for (const child of this.children) {
      if (selector.startsWith(".") && child.className.split(" ").includes(selector.slice(1))) return child;
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
let catalogRequests = 0, bulkMoveRequests = [], folderMoveRequests = [];
const fetch = async (url, options = {}) => {
  const u = String(url);
  if (u.includes("public_config")) return { status:200, ok:true, json:async()=>({ok:true,data:{}}) };
  if (u.includes("auth_me")) return { status:200, ok:true, json:async()=>({ok:true,logged_in:true,data:{user_id:5,email:"example@gmail.com",permission:"user"}}) };
  if (u.includes("auth_email_login")) { emailLogins++; return {status:200,ok:true,json:async()=>({ok:true})}; }
  if (u.includes("auth_logout")) return { status:200, ok:true, json:async()=>({ok:true}) };
  if (u.includes("action=list")) { catalogRequests++; return { status:200,ok:true,json:async()=>({ok:true,records:[
    {id:1,file_name:"新棋譜",title:"新版標題",record_count:2,compressed_size:250,preview:`15x15:${newBoard.board}`},
    {id:2,file_name:"舊棋譜",title:"舊版標題",record_count:2,compressed_size:250},
  ],folders:[{id:7,name:"一般案",parent_id:0},{id:8,name:"進階",parent_id:7}]}) }; }
  if (u.includes("action=records_move")) {
    const ids = JSON.parse(options.body).ids;
    bulkMoveRequests.push({ids, url:u});
    return {status:200,ok:true,json:async()=>({ok:true,ids,folder_id:7,moved:ids.length})};
  }
  if (u.includes("action=folder_move")) {
    folderMoveRequests.push(u);
    return {status:200,ok:true,json:async()=>({ok:true,folder:{parent_id:0}})};
  }
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
  const tree = dialog.querySelector("[data-tree]");
  assert.equal(tree.children.length, 1, "tree starts with root folder");
  const root = tree.children[0];
  const folder = root.children[1].children[0];
  assert.equal(folder.children[0].children[1].textContent.includes("一般案"), true, "nested folder is shown");
  assert.equal(folder.children[1].children.length, 1, "second-level folder appears in tree");
  // View switching must preserve the file list, avoid preview downloads and not touch the board.
  await dialog.querySelector("[data-view-details]").click();
  assert.equal(dialog.querySelector("[data-file-scroll]").dataset.view, "details");
  assert.equal(dialog.querySelector("[data-view-details]").attrs["aria-pressed"], "true");
  assert.equal(fileGets, 1, "details mode must not download old previews");
  assert.equal(list.children.length, 2, "details view contains the same records");
  const firstCheckbox = list.children[0].children[3];
  firstCheckbox.checked = true;
  firstCheckbox.listeners.change[0]();
  assert.equal(dialog.querySelector("[data-selected-count]").textContent.includes("已選 1 / 2"), true);
  assert.equal(dialog.querySelector("[data-batch-move]").disabled, false);
  await dialog.querySelector("[data-select-all]").click();
  assert.equal(dialog.querySelector("[data-selected-count]").textContent.includes("已選 2 / 2"), true);
  await dialog.querySelector("[data-select-all]").click();
  assert.equal(dialog.querySelector("[data-selected-count]").textContent.includes("已選 0 / 2"), true);
  let prevented = 0;
  list.listeners.keydown[0]({ctrlKey:true,metaKey:false,key:"a",preventDefault() { prevented++; }});
  assert.equal(dialog.querySelector("[data-selected-count]").textContent.includes("已選 2 / 2"), true, "Ctrl+A selects folder files");
  list.listeners.keydown[0]({ctrlKey:false,metaKey:false,key:"Escape",preventDefault() { prevented++; }});
  assert.equal(dialog.querySelector("[data-selected-count]").textContent.includes("已選 0 / 2"), true, "Escape clears multi-selection");
  assert.equal(prevented, 2);
  // Selecting a nested folder switches contents locally without refetching catalog.
  await folder.children[0].children[1].click();
  assert.equal(list.children[0].textContent.includes("目前資料夾沒有棋譜"), true);
  assert.equal(dialog.querySelector("[data-folder-path]").textContent, "根目錄 / 一般案");
  await tree.children[0].children[0].children[1].click();
  assert.equal(list.children.length, 2, "returning to root restores all root files");
  await dialog.querySelector("[data-view-thumbnails]").click();
  assert.equal(dialog.querySelector("[data-file-scroll]").dataset.view, "thumbnails");
  // Dragging multiple selected files into a folder must use one metadata request,
  // without reloading catalog or fetching any 5DB binary.
  const beforeDragLists = catalogRequests;
  const beforeDragFiles = fileGets;
  const transfer = {effectAllowed:"",dropEffect:"",setData(type,value) {this.type=type;this.value=value;}};
  await dialog.querySelector("[data-view-details]").click();
  list.listeners.keydown[0]({ctrlKey:true,metaKey:false,key:"a",preventDefault(){}});
  const firstRow = list.children[0];
  firstRow.listeners.dragstart[0]({target:firstRow,dataTransfer:transfer,preventDefault(){}});
  assert.equal(transfer.effectAllowed,"move","dragging a selected row enables move operation");
  const dropFolder = tree.children[0].children[1].children[0].children[0].children[1];
  dropFolder.listeners.dragover[0]({dataTransfer:transfer,preventDefault(){}});
  dropFolder.listeners.drop[0]({dataTransfer:transfer,preventDefault(){},stopPropagation(){}});
  await new Promise(setImmediate);
  assert.equal(bulkMoveRequests.length,1,"multiple selected files move in a single request");
  assert.deepEqual(bulkMoveRequests[0].ids,[1,2],"drag carries complete selection");
  assert.equal(new URL(bulkMoveRequests[0].url, "https://example.test").searchParams.get("folder_id"),"7");
  assert.equal(catalogRequests,beforeDragLists,"file move doesn't refetch cloud catalog");
  assert.equal(fileGets,beforeDragFiles,"file move doesn't transfer binary 5DB");
  assert.equal(list.children[0].textContent.includes("目前資料夾沒有棋譜"),true);
  // Drag a nested folder into the root: metadata-only, no catalog refresh.
  const treeRoot = tree.children[0];
  const folderParent = treeRoot.children[1].children[0];
  const nestedFolder = folderParent.children[1].children[0];
  const nestedName = nestedFolder.children[0].children[1];
  const rootName = treeRoot.children[0].children[1];
  // A parent folder cannot be dropped into its own descendant.
  const parentName = folderParent.children[0].children[1];
  parentName.listeners.dragstart[0]({dataTransfer:transfer,stopPropagation(){},preventDefault(){}});
  let rejectedDrag = true;
  nestedName.listeners.dragover[0]({dataTransfer:transfer,preventDefault(){rejectedDrag=false;}});
  nestedName.listeners.drop[0]({dataTransfer:transfer,preventDefault(){rejectedDrag=false;}});
  assert.equal(rejectedDrag, true, "folder-to-descendant drop is rejected locally");
  assert.equal(folderMoveRequests.length, 0, "invalid destination causes no network request");
  parentName.listeners.dragend[0]();
  nestedName.listeners.dragstart[0]({dataTransfer:transfer,stopPropagation(){},preventDefault(){}});
  rootName.listeners.dragover[0]({dataTransfer:transfer,preventDefault(){}});
  rootName.listeners.drop[0]({dataTransfer:transfer,preventDefault(){},stopPropagation(){}});
  await new Promise(setImmediate);
  assert.equal(folderMoveRequests.length,1,"folder move sends one metadata request");
  assert.equal(catalogRequests,beforeDragLists,"folder move doesn't refetch catalog");
  assert.equal(tree.children[0].children[1].children.length,2,"moved subfolder becomes root sibling");
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
