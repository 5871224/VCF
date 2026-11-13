"use strict";

(function initVCFCloud5DB(global) {
  const API_URL = String(global.VCF_CLOUD_API_URL || "/Sched/api/index.php");
  const FIVE_DB_API_URL = String(global.VCF_5DB_API_URL || "/BD1/api/5db.php");

  let authUser = null;
  let googleClientId = "";
  let googleScriptPromise = null;
  let googleButtonRendered = false;
  let googleUnavailable = false;
  let loginBusy = false;
  const previewCache = new Map();
  let activePreviewObserver = null;
  let previewGeneration = 0;

  async function jsonResponse(response) {
    const payload = await response.json().catch(() => null);
    if (response.status === 401) { authUser = null; refreshAuthUI(); }
    if (!response.ok || payload?.ok === false) {
      throw new Error(payload?.error || `伺服器回應 HTTP ${response.status}`);
    }
    if (!payload || typeof payload !== "object") {
      throw new Error(`雲端 API 回應格式不正確（HTTP ${response.status}），請檢查 PHP 是否正常執行`);
    }
    return payload;
  }
  // A failed endpoint must never leave the cloud dialog on an endless spinner.
  async function cloudFetch(url, options = {}, timeoutMs = 18000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, { ...options, signal: controller.signal });
    } catch (error) {
      if (controller.signal.aborted) {
        throw new Error("5DB 雲端伺服器回應逾時，請檢查主機連線及登入驗證服務");
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
  async function publicConfig() {
    const response = await fetch(`${API_URL}?action=public_config`, { cache: "no-store", credentials: "same-origin" });
    const payload = await jsonResponse(response);
    return String(payload.data?.google_client_id || "");
  }
  async function authMe() {
    try {
      const response = await fetch(`${API_URL}?action=auth_me`, { cache: "no-store", credentials: "same-origin" });
      const payload = await jsonResponse(response);
      authUser = payload.logged_in ? payload.data || null : null;
    } catch (error) { authUser = null; throw error; }
    refreshAuthUI();
    return authUser;
  }
  async function logout() {
    const response = await fetch(`${API_URL}?action=auth_logout`, {
      method: "POST", cache: "no-store", credentials: "same-origin",
      headers: { "Content-Type": "application/json" }, body: "{}",
    });
    await jsonResponse(response);
    previewCache.clear();
    authUser = null;
    refreshAuthUI();
    status("已登出協會會員帳號。");
  }

  function normalizeFileName(value, fallback = "") {
    const name = String(value ?? "").trim().replace(/\.5db$/i, "");
    if (!name) return fallback;
    if (/[\\/:*?"<>|\u0000-\u001f]/.test(name) || name === "." || name === "..")
      throw new Error("檔案名稱包含不允許的字元");
    return name;
  }
  function defaultFileName() {
    const d = new Date(), p = n => String(n).padStart(2, "0");
    return `5db-${d.getFullYear()}${p(d.getMonth()+1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
  }
  async function saveCurrent(fileName = "") {
    if (!authUser) throw new Error("請先登入協會會員帳號");
    const record = global.VCFWorkbenchRecord;
    if (!record?.export5DBDocument || !global.FiveDB) throw new Error("5DB 工作台尚未就緒");
    const doc = record.export5DBDocument();
    const bytes = global.FiveDB.encode(doc);
    const info = global.FiveDB.validate(doc);
    const shot = global.FiveDB.preview(doc);
    const thumbnail = shot.width <= 25 && shot.height <= 25
      ? `${shot.width}x${shot.height}:${shot.board}` : "";
    const name = normalizeFileName(fileName, defaultFileName());
    const params = new URLSearchParams({ action: "save", file_name: name, title: doc.title || "" });
    const response = await cloudFetch(`${FIVE_DB_API_URL}?${params}`, {
      method: "POST", cache: "no-store", credentials: "same-origin",
      headers: { "Content-Type": "application/octet-stream", "X-5DB-Preview": thumbnail },
      body: bytes,
    });
    const saved = await jsonResponse(response);
    return { ...saved, recordCount: info.nodeCount, compressedSize: bytes.length, annotationCount: info.markCount };
  }
  async function list() {
    if (!authUser) throw new Error("請先登入協會會員帳號");
    const response = await cloudFetch(`${FIVE_DB_API_URL}?action=list`, {
      cache: "no-store", credentials: "same-origin",
    });
    return (await jsonResponse(response)).records || [];
  }
  async function fetchRecord(id) {
    if (!authUser) throw new Error("請先登入協會會員帳號");
    const recordId = Number(id);
    if (!Number.isSafeInteger(recordId) || recordId < 1) throw new Error("棋譜編號無效");
    const response = await cloudFetch(`${FIVE_DB_API_URL}?action=get&id=${recordId}`, {
      cache: "no-store", credentials: "same-origin",
    });
    if (!response.ok) {
      if (response.status === 401) { authUser = null; refreshAuthUI(); }
      const payload = await response.json().catch(() => null);
      throw new Error(payload?.error || `HTTP ${response.status}`);
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    const data = global.FiveDB?.decode?.(bytes);
    if (!data) throw new Error("雲端棋譜不是有效的 5DB 1.0");
    return {
      bytes, meta: {
        id: recordId,
        title: decodeURIComponent(response.headers.get("X-5DB-Title") || ""),
        fileName: decodeURIComponent(response.headers.get("X-5DB-File-Name") || ""),
        recordCount: Number(response.headers.get("X-5DB-Record-Count") || 0),
        compressedSize: bytes.length,
      },
    };
  }
  async function remove(id) {
    if (!authUser) throw new Error("請先登入協會會員帳號");
    const recordId = Number(id);
    if (!Number.isSafeInteger(recordId) || recordId < 1) throw new Error("棋譜編號無效");
    const response = await cloudFetch(`${FIVE_DB_API_URL}?action=delete&id=${recordId}`, {
      method: "POST", cache: "no-store", credentials: "same-origin",
    });
    return jsonResponse(response);
  }
  async function load(id) {
    const result = await fetchRecord(id);
    const importer = global.VCFRecordImportAPI;
    if (!importer?.loadBytes) throw new Error("5DB 載入模組尚未就緒");
    const imported = await importer.loadBytes(result.bytes, `cloud-${id}.5db`);
    return { ...result, imported };
  }
  function formatBytes(v) {
    const n = Number(v) || 0;
    if (n < 1024) return `${n} B`;
    if (n < 1048576) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / 1048576).toFixed(2)} MB`;
  }
  function status(message) { const node = document.getElementById("bb-export-status"); if (node) node.textContent = message; }
  function download(bytes, filename) {
    const url = URL.createObjectURL(new Blob([bytes], { type: "application/octet-stream" }));
    const a = document.createElement("a"); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
  function injectStyle() {
    if (document.getElementById("vcf-cloud-style")) return;
    const style = document.createElement("style"); style.id = "vcf-cloud-style";
    style.textContent = `
      #vcf-account-actions #bb-cloud-auth{display:flex;align-items:center;justify-content:flex-end;gap:7px;flex-wrap:wrap;padding:0}
      #bb-cloud-user{font-size:12px;color:#4f5d50}.bb-cloud-btn{min-height:36px;padding:7px 10px;border:1px solid #39744c;border-radius:6px;background:#fff;color:#19512d;font:inherit;font-size:13px;cursor:pointer}.bb-cloud-btn:disabled{opacity:.5;cursor:not-allowed}
      #vcf-cloud-dialog{width:min(760px,calc(100vw - 24px));max-height:min(86vh,850px);border:1px solid #b9b09c;border-radius:12px;padding:0;box-shadow:0 16px 60px rgb(0 0 0 / 25%)}#vcf-cloud-dialog::backdrop{background:rgb(0 0 0 / 35%)}
      #vcf-shared-login-dialog{box-sizing:border-box;width:min(420px,calc(100vw - 32px));max-height:calc(100dvh - 32px);overflow-y:auto;padding:25px;border:0;border-radius:16px;background:#eee6de;color:#4f4339;box-shadow:0 28px 70px rgba(79,67,57,.24);font-family:"Noto Sans TC","Microsoft JhengHei",sans-serif}
      #vcf-shared-login-dialog::backdrop{background:rgba(79,67,57,.55)}
      #vcf-shared-login-dialog [hidden]{display:none!important}
      #vcf-shared-login-dialog .sched-email-auth-heading{display:flex;justify-content:space-between;align-items:center;gap:12px}
      #vcf-shared-login-dialog .sched-email-auth-heading h2{margin:0;color:#4f4339;font-size:23px}
      #vcf-shared-login-dialog .sched-email-auth-close{width:34px;height:34px;border:0;padding:0;background:transparent;color:#817367;font-size:28px;cursor:pointer}
      #vcf-shared-login-dialog .sched-email-auth-choices{display:flex;flex-wrap:wrap;align-items:center;justify-content:center;gap:12px;padding-top:22px}
      #vcf-shared-login-dialog .sched-email-auth-google{display:flex;align-items:center;width:90px;height:32px}
      #vcf-shared-login-dialog .sched-email-auth-google-button{display:flex;align-items:center;justify-content:center;width:90px;height:32px;overflow:hidden}
      #vcf-shared-login-dialog .sched-email-auth-email-choice{box-sizing:border-box;width:90px;height:32px;padding:0 7px;border:1px solid #cdbba8;border-radius:5px;background:#eee6de;color:#4f4339;font:inherit;font-size:13px;font-weight:600;cursor:pointer}
      #vcf-shared-login-dialog .sched-email-auth-email-choice:hover,#vcf-shared-login-dialog .sched-email-auth-email-choice[aria-expanded="true"]{background:rgba(217,201,184,.42)}
      #vcf-shared-login-dialog .sched-email-auth-email-choice:focus-visible{outline:2px solid #725b48;outline-offset:2px}
      #vcf-shared-login-dialog .sched-email-auth-form{margin-top:20px}
      #vcf-shared-login-dialog .sched-email-auth-form label{display:block;margin:12px 0;color:#5f5044;font-size:14px;font-weight:600}
      #vcf-shared-login-dialog .sched-email-auth-form input{display:block;box-sizing:border-box;width:100%;min-height:38px;margin-top:6px;padding:8px 10px;border:1px solid #cdbba8;border-radius:10px;background:#f8f4ef;color:#4f4339;font:inherit;font-size:16px;outline:none}
      #vcf-shared-login-dialog .sched-email-auth-form input:focus{border-color:#a88d74;background:#fffaf6;box-shadow:0 0 0 4px rgba(168,141,116,.22)}
      #vcf-shared-login-dialog .sched-email-auth-submit{width:100%;margin-top:12px;padding:12px;border:0;border-radius:9px;background:#725b48;color:#fff;font-size:16px;font-weight:700;cursor:pointer}
      #vcf-shared-login-dialog .sched-email-auth-submit:disabled{opacity:.55;cursor:wait}
      #vcf-shared-login-dialog .sched-email-auth-google-help{margin:8px 0 0;color:#817367;text-align:center;font-size:13px;line-height:1.6}
      #vcf-shared-login-dialog .sched-email-auth-error{color:#d92d20;font-size:14px}
      #vcf-shared-login-dialog .sched-email-auth-notice{line-height:1.7}
      #vcf-shared-login-dialog .sched-email-auth-actions{display:flex;flex-wrap:wrap;justify-content:center;gap:16px;margin-top:20px}
      #vcf-shared-login-dialog .sched-email-auth-actions button{border:0;background:transparent;padding:4px;color:#725b48;font:inherit;cursor:pointer}
      .vcf-cloud-body{padding:16px;display:grid;gap:12px}.vcf-cloud-head{display:flex;justify-content:space-between;align-items:center;gap:10px}.vcf-cloud-head h3{margin:0}.vcf-cloud-list{display:grid;gap:8px;overflow:auto;max-height:55vh}.vcf-cloud-row{display:grid;grid-template-columns:112px minmax(0,1fr) auto;gap:12px;align-items:center;padding:10px;border:1px solid #ddd5c5;border-radius:8px;background:#fffdf8}.vcf-cloud-preview{width:112px;aspect-ratio:1/1;display:grid;place-items:center;border:1px solid #d0b98c;border-radius:5px;background:#edcf9d;overflow:hidden;font-size:11px;color:#666}.vcf-cloud-preview svg{display:block;width:100%;height:100%}.vcf-cloud-title{font-weight:700;overflow-wrap:anywhere}.vcf-cloud-meta{font-size:12px;color:#6b6559;margin-top:3px;overflow-wrap:anywhere}.vcf-cloud-actions{display:flex;gap:5px;flex-wrap:wrap}.vcf-cloud-actions button,.vcf-cloud-head button{border:1px solid #aaa;border-radius:6px;background:#fff;padding:6px 8px;cursor:pointer}.vcf-cloud-empty{padding:18px;text-align:center;color:#6b6559;background:#f7f4ed;border-radius:8px}@media(max-width:600px){.vcf-cloud-row{grid-template-columns:88px minmax(0,1fr);gap:9px}.vcf-cloud-preview{width:88px}.vcf-cloud-actions{grid-column:1/-1;justify-content:flex-end}}
    `;
    document.head.appendChild(style);
  }
  function ensureDialog() {
    let dialog = document.getElementById("vcf-cloud-dialog");
    if (dialog) return dialog;
    dialog = document.createElement("dialog"); dialog.id = "vcf-cloud-dialog";
    dialog.innerHTML = '<div class="vcf-cloud-body"><div class="vcf-cloud-head"><h3>我的雲端棋譜</h3><button type="button" data-close>關閉</button></div><div class="vcf-cloud-list" data-list></div></div>';
    dialog.querySelector("[data-close]").addEventListener("click", () => dialog.close()); document.body.appendChild(dialog); return dialog;
  }
  function ensureLoginDialog() {
    let dialog = document.getElementById("vcf-shared-login-dialog");
    if (dialog) return dialog;
    dialog = document.createElement("dialog");
    dialog.id = "vcf-shared-login-dialog";
    // 與 Sched EmailAuthDialog 使用相同的欄位、模式和樣式；直接在 BD1
    // 顯示一層登入視窗，不再將另一整頁放進 iframe。
    dialog.innerHTML = `
      <div class="sched-email-auth-heading"><h2 data-title>登入</h2><button type="button" class="sched-email-auth-close" data-close aria-label="關閉">×</button></div>
      <div class="sched-email-auth-choices" data-choices>
        <div class="sched-email-auth-google" data-google-wrap><div class="sched-email-auth-google-button" data-google aria-label="Google 登入"></div></div>
        <button type="button" class="sched-email-auth-email-choice" data-email-choice aria-expanded="false">Email 登入</button>
      </div>
      <p class="sched-email-auth-google-help" data-google-error role="status" hidden>Google 登入暫時無法載入，請改用 Email 登入，或重新整理頁面。</p>
      <form class="sched-email-auth-form" data-form hidden>
        <label data-name-row hidden>姓名<input name="name" type="text" autocomplete="name" maxlength="100" required disabled></label>
        <label data-email-row>Email<input name="email" type="email" autocomplete="email" maxlength="255" required></label>
        <label data-password-row>密碼<input name="password" type="password" autocomplete="current-password" required></label>
        <p class="sched-email-auth-error" data-error role="alert" hidden></p>
        <button class="sched-email-auth-submit" data-submit type="submit">登入</button>
      </form>
      <div class="sched-email-auth-notice" data-notice role="status" hidden></div>
      <p class="sched-email-auth-error" data-choice-error role="alert" hidden></p>
      <nav class="sched-email-auth-actions" data-actions hidden>
        <button type="button" data-register>註冊 Email 帳號</button>
        <button type="button" data-forgot>忘記密碼？</button>
        <button type="button" data-back hidden>返回 Email 登入</button>
      </nav>`;
    dialog.querySelector("[data-close]").addEventListener("click", () => { if (!loginBusy) dialog.close(); });
    dialog.querySelector("[data-email-choice]").addEventListener("click", () => {
      changeLoginMode(dialog, dialog.dataset.mode === "login" ? "choose" : "login");
    });
    dialog.querySelector("[data-register]").addEventListener("click", () => changeLoginMode(dialog, "register"));
    dialog.querySelector("[data-forgot]").addEventListener("click", () => changeLoginMode(dialog, "forgot"));
    dialog.querySelector("[data-back]").addEventListener("click", () => changeLoginMode(dialog, "login"));
    dialog.querySelector("[data-form]").addEventListener("submit", event => { event.preventDefault(); void submitLoginForm(dialog); });
    dialog.addEventListener("cancel", event => { if (loginBusy) event.preventDefault(); });
    dialog.addEventListener("close", () => {
      dialog.querySelector('[name="password"]').value = "";
      void authMe().catch(() => {});
    });
    document.body.appendChild(dialog);
    changeLoginMode(dialog, "choose");
    return dialog;
  }
  function changeLoginMode(dialog, mode) {
    dialog.dataset.mode = mode;
    const titles = { choose: "登入", login: "登入", register: "Email 註冊", forgot: "忘記密碼", reset: "設定新密碼", notice: "信箱通知" };
    const labels = { login: "登入", register: "註冊並寄送驗證信", forgot: "寄送重設密碼連結", reset: "重設密碼" };
    const form = dialog.querySelector("[data-form]");
    const isForm = ["login", "register", "forgot", "reset"].includes(mode);
    dialog.querySelector("[data-title]").textContent = titles[mode] || "Email 登入";
    dialog.querySelector("[data-choices]").hidden = mode !== "choose" && mode !== "login";
    dialog.querySelector("[data-email-choice]").setAttribute("aria-expanded", String(mode === "login"));
    form.hidden = !isForm;
    const nameRow = dialog.querySelector("[data-name-row]");
    const emailRow = dialog.querySelector("[data-email-row]");
    const passwordRow = dialog.querySelector("[data-password-row]");
    nameRow.hidden = mode !== "register";
    emailRow.hidden = mode === "reset";
    passwordRow.hidden = mode === "forgot";
    nameRow.querySelector("input").disabled = nameRow.hidden;
    emailRow.querySelector("input").disabled = emailRow.hidden;
    passwordRow.querySelector("input").disabled = passwordRow.hidden;
    passwordRow.firstChild.textContent = mode === "login" ? "密碼" : "新密碼（至少 6 個字元）";
    const password = passwordRow.querySelector("input");
    password.value = "";
    password.minLength = mode === "login" ? 0 : 6;
    password.autocomplete = mode === "login" ? "current-password" : "new-password";
    dialog.querySelector("[data-submit]").textContent = labels[mode] || "送出";
    dialog.querySelector("[data-notice]").hidden = mode !== "notice";
    dialog.querySelector("[data-actions]").hidden = mode === "choose";
    dialog.querySelector("[data-register]").hidden = mode !== "login";
    dialog.querySelector("[data-forgot]").hidden = mode !== "login";
    dialog.querySelector("[data-back]").hidden = mode === "login";
    showLoginError(dialog, "");
  }
  function showLoginError(dialog, message) {
    for (const selector of ["[data-error]", "[data-choice-error]"]) {
      const node = dialog.querySelector(selector);
      node.textContent = message;
      node.hidden = !message || (selector === "[data-error]" ? dialog.querySelector("[data-form]").hidden : !dialog.querySelector("[data-form]").hidden);
    }
  }
  function setLoginBusy(dialog, busy) {
    loginBusy = busy;
    dialog.querySelector("[data-submit]").disabled = busy;
    dialog.querySelector("[data-submit]").textContent = busy ? "處理中…" : ({ login: "登入", register: "註冊並寄送驗證信", forgot: "寄送重設密碼連結", reset: "重設密碼" }[dialog.dataset.mode] || "送出");
  }
  async function postLoginAction(action, data) {
    const response = await cloudFetch(`${API_URL}?action=${action}`, {
      method: "POST", cache: "no-store", credentials: "same-origin",
      headers: { "Content-Type": "application/json" }, body: JSON.stringify(data),
    });
    return jsonResponse(response);
  }
  async function finishLogin(dialog) {
    const user = await authMe();
    if (!user) throw new Error("登入成功，但尚未取得會員資料，請重新登入");
    previewCache.clear();
    dialog.close();
    status(`已登入：${user.name || user.email || "協會會員"}`);
  }
  async function submitLoginForm(dialog) {
    if (loginBusy) return;
    const mode = dialog.dataset.mode;
    const action = { login: "auth_email_login", register: "auth_email_register", forgot: "auth_email_forgot", reset: "auth_email_reset" }[mode];
    if (!action) return;
    showLoginError(dialog, "");
    setLoginBusy(dialog, true);
    const form = dialog.querySelector("[data-form]");
    const data = {
      email: form.elements.email.value.trim(),
      name: form.elements.name.value.trim(),
      password: form.elements.password.value,
    };
    try {
      const result = await postLoginAction(action, data);
      if (mode === "login") await finishLogin(dialog);
      else {
        changeLoginMode(dialog, "notice");
        dialog.querySelector("[data-notice]").textContent = result.data?.message || "完成";
      }
    } catch (error) { showLoginError(dialog, error.message || "登入失敗"); }
    finally { setLoginBusy(dialog, false); }
  }
  async function onGoogleCredential(response) {
    const dialog = ensureLoginDialog();
    if (loginBusy || !response?.credential) return;
    showLoginError(dialog, "");
    setLoginBusy(dialog, true);
    try {
      await postLoginAction("auth_google", { id_token: response.credential });
      await finishLogin(dialog);
    } catch (error) { showLoginError(dialog, error.message || "Google 登入失敗"); }
    finally { setLoginBusy(dialog, false); }
  }
  function loadGoogleScript() {
    if (global.google?.accounts?.id) return Promise.resolve();
    if (!googleScriptPromise) {
      googleScriptPromise = new Promise((resolve, reject) => {
        const script = document.createElement("script");
        script.src = "https://accounts.google.com/gsi/client";
        script.async = true;
        script.onload = resolve;
        script.onerror = () => reject(new Error("Google 登入元件載入失敗"));
        document.head.appendChild(script);
      }).catch(error => { googleScriptPromise = null; throw error; });
    }
    return googleScriptPromise;
  }
  function renderGoogleButton(dialog) {
    if (googleButtonRendered || !googleClientId || !global.google?.accounts?.id) return;
    const target = dialog.querySelector("[data-google]");
    global.google.accounts.id.initialize({ client_id: googleClientId, callback: onGoogleCredential });
    global.google.accounts.id.renderButton(target, { type: "standard", size: "medium", text: "signin", shape: "rectangular", width: 90 });
    googleButtonRendered = true;
  }
  async function prepareGoogleLogin() {
    try {
      googleClientId = await publicConfig();
      if (!googleClientId) throw new Error("Google 登入尚未設定");
      await loadGoogleScript();
      googleUnavailable = false;
    } catch (_) { googleUnavailable = true; }
    const dialog = document.getElementById("vcf-shared-login-dialog");
    if (dialog) {
      dialog.querySelector("[data-google-error]").hidden = !googleUnavailable;
      dialog.querySelector("[data-google-wrap]").hidden = !googleClientId;
      if (dialog.open) renderGoogleButton(dialog);
    }
  }
  function openSharedLogin() {
    const dialog = ensureLoginDialog();
    changeLoginMode(dialog, "choose");
    dialog.querySelector("[data-google-error]").hidden = !googleUnavailable;
    dialog.querySelector("[data-google-wrap]").hidden = !googleClientId;
    if (!dialog.open) dialog.showModal();
    renderGoogleButton(dialog);
  }

  function parsePreview(value) {
    const match = /^(\d{1,3})x(\d{1,3}):([012]+)$/.exec(String(value || ""));
    if (!match) return null;
    const width = Number(match[1]), height = Number(match[2]);
    if (width < 1 || height < 1 || width > 25 || height > 25 || match[3].length !== width * height) return null;
    return { width, height, board: match[3] };
  }
  function makeBoardThumbnail(snapshot) {
    const ns = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(ns, "svg");
    svg.setAttribute("viewBox", "0 0 160 160");
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", `棋盤縮圖 ${snapshot.width}×${snapshot.height}`);
    const shape = (tag, attrs) => {
      const node = document.createElementNS(ns, tag);
      for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, String(value));
      svg.appendChild(node);
      return node;
    };
    shape("rect", { x: 0, y: 0, width: 160, height: 160, fill: "#edcf9d" });
    const unit = 140 / Math.max(snapshot.width - 1, snapshot.height - 1, 1);
    const ox = (160 - (snapshot.width - 1) * unit) / 2;
    const oy = (160 - (snapshot.height - 1) * unit) / 2;
    for (let x = 0; x < snapshot.width; x++) {
      const sx = ox + x * unit;
      shape("line", { x1: sx, y1: oy, x2: sx, y2: oy + (snapshot.height - 1) * unit, stroke: "#80643a", "stroke-width": .7 });
    }
    for (let y = 0; y < snapshot.height; y++) {
      const sy = oy + y * unit;
      shape("line", { x1: ox, y1: sy, x2: ox + (snapshot.width - 1) * unit, y2: sy, stroke: "#80643a", "stroke-width": .7 });
    }
    for (let index = 0; index < snapshot.board.length; index++) {
      const stone = snapshot.board.charAt(index);
      if (stone !== "1" && stone !== "2") continue;
      shape("circle", {
        cx: ox + (index % snapshot.width) * unit,
        cy: oy + Math.floor(index / snapshot.width) * unit,
        r: unit * .43,
        fill: stone === "1" ? "#1c1c1c" : "#fdfdfb",
        stroke: stone === "1" ? "#161616" : "#555047",
        "stroke-width": stone === "1" ? .6 : 1.05,
      });
    }
    return svg;
  }
  function showBoardThumbnail(element, raw) {
    const snapshot = parsePreview(raw);
    if (!snapshot) { element.textContent = "無法預覽"; return false; }
    element.replaceChildren(makeBoardThumbnail(snapshot));
    return true;
  }

  async function refreshDialog(dialog) {
    if (activePreviewObserver) { activePreviewObserver.disconnect(); activePreviewObserver = null; }
    const generation = ++previewGeneration;
    const container = dialog.querySelector("[data-list]"); container.innerHTML = '<div class="vcf-cloud-empty">正在讀取……</div>';
    let records;
    try {
      records = await list();
      if (!Array.isArray(records)) throw new Error("5DB 雲端列表內容不正確");
    } catch (error) {
      const message = error?.message || String(error);
      container.replaceChildren();
      const errorBox = document.createElement("div");
      errorBox.className = "vcf-cloud-empty";
      errorBox.setAttribute("role", "alert");
      errorBox.textContent = "雲端棋譜讀取失敗：" + message;
      const retry = document.createElement("button");
      retry.type = "button";
      retry.className = "bb-cloud-btn";
      retry.textContent = "重新讀取";
      retry.addEventListener("click", () => { void refreshDialog(dialog); });
      container.append(errorBox, retry);
      status("5DB 雲端棋譜讀取失敗：" + message);
      return;
    }
    if (generation !== previewGeneration) return;
    container.replaceChildren();
    if (!records.length) { container.innerHTML = '<div class="vcf-cloud-empty">這個會員帳號目前沒有雲端棋譜。</div>'; return; }
    const missingPreviews = [];
    for (const record of records) {
      const row = document.createElement("div"); row.className = "vcf-cloud-row";
      const previewBox = document.createElement("div");
      previewBox.className = "vcf-cloud-preview";
      previewBox.textContent = "載入縮圖…";
      const readyPreview = parsePreview(record.preview) ? record.preview : previewCache.get(record.id);
      if (readyPreview) showBoardThumbnail(previewBox, readyPreview);
      else missingPreviews.push({ record, previewBox });
      const info = document.createElement("div"); info.innerHTML = `<div class="vcf-cloud-title"></div><div class="vcf-cloud-meta"></div>`;
      const fileName = record.file_name || record.title || `棋譜-${record.id}`;
      info.firstElementChild.textContent = fileName + ".5db";
      info.lastElementChild.textContent = (record.file_name && record.title ? `棋譜標題：${record.title} · ` : "") +
        `${record.record_count || 0} 個局面 · ${formatBytes(record.compressed_size)} · ${record.updated_at || ""}`;
      const actions = document.createElement("div"); actions.className = "vcf-cloud-actions";
      const loadButton = document.createElement("button"); loadButton.textContent = "載入 5DB";
      loadButton.addEventListener("click", async () => { loadButton.disabled = true; try { const loaded = await load(record.id); status(`已載入「${fileName}.5db」：${loaded.imported?.nodeCount ?? record.record_count ?? 0} 個局面${loaded.imported?.annotationCount ? `、${loaded.imported.annotationCount} 個標記` : ''}`); dialog.close(); } catch (e) { status(e.message || String(e)); } finally { loadButton.disabled = false; } });
      const dl = document.createElement("button"); dl.textContent = "下載 .5db"; dl.addEventListener("click", async () => { dl.disabled = true; try { const r = await fetchRecord(record.id); download(r.bytes, `${normalizeFileName(fileName, `棋譜-${record.id}`)}.5db`); } catch (e) { status(e.message || String(e)); } finally { dl.disabled = false; } });
      const del = document.createElement("button"); del.textContent = "刪除"; del.addEventListener("click", async () => { if (!confirm(`確定刪除「${fileName}.5db」？`)) return; del.disabled = true; try { await remove(record.id); await refreshDialog(dialog); status("已刪除。"); } catch (e) { status(e.message || String(e)); } });
      actions.append(loadButton, dl, del); row.append(previewBox, info, actions); container.appendChild(row);
    }
    // Existing 5DB entries have no preview metadata. Decode those files only
    // when their thumbnails are visible; never fetch every record eagerly.
    const queue = [];
    let inFlight = 0;
    const pump = () => {
      while (inFlight < 2 && queue.length && generation === previewGeneration) {
        const item = queue.shift();
        inFlight++;
        fetchRecord(item.record.id).then(result => {
          if (generation !== previewGeneration) return;
          const shot = global.FiveDB.preview(global.FiveDB.decode(result.bytes));
          const encoded = shot.width <= 25 && shot.height <= 25 ? `${shot.width}x${shot.height}:${shot.board}` : "";
          if (encoded) previewCache.set(item.record.id, encoded);
          showBoardThumbnail(item.previewBox, encoded);
        }).catch(() => {
          if (generation === previewGeneration) item.previewBox.textContent = "無法預覽";
        }).finally(() => { inFlight--; pump(); });
      }
    };
    const add = item => { queue.push(item); pump(); };
    if (typeof IntersectionObserver === "function") {
      const awaiting = new Map(missingPreviews.map(item => [item.previewBox, item]));
      const observer = new IntersectionObserver(entries => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const item = awaiting.get(entry.target);
          if (!item) continue;
          awaiting.delete(entry.target);
          observer.unobserve(entry.target);
          add(item);
        }
      }, { root: container, rootMargin: "100px" });
      activePreviewObserver = observer;
      for (const item of missingPreviews) observer.observe(item.previewBox);
    } else {
      for (const item of missingPreviews) add(item);
    }
  }
  function refreshAuthUI() {
    const login = document.getElementById("vcf-shared-login"), user = document.getElementById("bb-cloud-user"), logoutButton = document.getElementById("bb-cloud-logout");
    const saveButton = document.getElementById("bb-cloud-save"), openButton = document.getElementById("bb-cloud-open");
    if (user) user.textContent = authUser ? (authUser.name || authUser.email) : "未登入";
    if (login) login.hidden = Boolean(authUser);
    if (logoutButton) logoutButton.hidden = !authUser;
    if (saveButton) {
      saveButton.disabled = !authUser || !global.VCFWorkbenchRecord?.workspace?.()?.mode;
      saveButton.title = "將完整 5DB 1.0 棋譜儲存到目前登入的協會會員帳號";
    }
    if (openButton) { openButton.disabled = !authUser; openButton.title = "查看此帳號的 5DB 1.0 棋譜"; }
  }
  function installUI() {
    const panel = document.getElementById("bitboard-architecture-panel");
    const accountSlot = document.getElementById("vcf-account-actions");
    if (!panel || !accountSlot || document.getElementById("bb-cloud-auth")) return false;
    injectStyle();
    const exportStatus = panel.querySelector("#bb-export-status");
    const auth = document.createElement("div"); auth.id = "bb-cloud-auth";
    auth.innerHTML = '<button id="vcf-shared-login" class="bb-cloud-btn" type="button">登入</button><span id="bb-cloud-user"></span><button id="bb-cloud-logout" class="bb-cloud-btn" type="button" hidden>登出</button>';
    const saveButton = document.createElement("button"); saveButton.id = "bb-cloud-save"; saveButton.className = "bb-cloud-btn"; saveButton.textContent = "雲端儲存";
    const openButton = document.createElement("button"); openButton.id = "bb-cloud-open"; openButton.className = "bb-cloud-btn"; openButton.textContent = "我的雲端棋譜";
    accountSlot.appendChild(auth);
    panel.insertBefore(saveButton, exportStatus || null); panel.insertBefore(openButton, exportStatus || null);
    auth.querySelector("#vcf-shared-login").addEventListener("click", openSharedLogin);
    auth.querySelector("#bb-cloud-logout").addEventListener("click", () => { void logout().catch(e => status(e.message || String(e))); });
    saveButton.addEventListener("click", async () => {
      saveButton.disabled = true; status("正在建立雲端棋譜及標記……");
      try {
        const fileName = prompt("檔案名稱（不影響棋譜標題）", defaultFileName());
        if (fileName === null) return;
        const result = await saveCurrent(fileName);
        status(`已存入你的帳號 #${result.id}：${result.recordCount} 局面${result.annotationCount ? `、${result.annotationCount} 個標記` : ''} / ${formatBytes(result.compressedSize)}`);
      } catch (e) { status(e.message || String(e)); } finally { refreshAuthUI(); }
    });
    openButton.addEventListener("click", async () => { openButton.disabled = true; try { const dialog = ensureDialog(); dialog.showModal(); await refreshDialog(dialog); } catch (e) { status(e.message || String(e)); } finally { refreshAuthUI(); } });
    refreshAuthUI();
    void prepareGoogleLogin();
    return true;
  }

  const api = {
    API_URL, FIVE_DB_API_URL,
    publicConfig, authMe, logout, saveCurrent, list, load, remove,
    currentBytes: null, currentMeta: null,
    get authUser() { return authUser; },
  };
  global.VCFCloud5DB = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof document === "undefined") return;

  installUI();
  global.addEventListener("vcf-workspace-mode-changed", refreshAuthUI);
  authMe().catch(e => status(e.message || String(e)));
  global.addEventListener("focus", () => { void authMe().catch(() => {}); });
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) void authMe().catch(() => {});
  });
})(typeof window !== "undefined" ? window : globalThis);
