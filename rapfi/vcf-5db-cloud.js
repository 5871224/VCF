"use strict";

(function initVCFCloud5DB(global) {
  const API_URL = String(global.VCF_CLOUD_API_URL || "/BD/api/yxdb.php");
  const FIVE_DB_API_URL = String(global.VCF_5DB_API_URL || "/BD1/api/5db.php");
  const AUTH_TOKEN_KEY = "vcf_google_auth_token_v1";
  const ADMIN_EMAIL = "5871224@gmail.com";

  let authUser = null;
  let googleClientId = "";
  const previewCache = new Map();
  let activePreviewObserver = null;
  let previewGeneration = 0;

  function isAdminUser(user) {
    return String(user?.email || "").trim().toLowerCase() === ADMIN_EMAIL;
  }

  function getToken() { try { return localStorage.getItem(AUTH_TOKEN_KEY) || ""; } catch (_) { return ""; } }
  function setToken(token) {
    previewCache.clear();
    try { token ? localStorage.setItem(AUTH_TOKEN_KEY, token) : localStorage.removeItem(AUTH_TOKEN_KEY); } catch (_) {}
  }
  function authHeaders(extra = {}) {
    const token = getToken();
    return token ? { Authorization: `Bearer ${token}`, ...extra } : { ...extra };
  }
  async function jsonResponse(response) {
    const payload = await response.json().catch(() => null);
    if (response.status === 401) { setToken(""); authUser = null; refreshAuthUI(); }
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
    const response = await fetch(`${API_URL}?action=public_config`, { cache: "no-store", mode: "cors" });
    const payload = await jsonResponse(response);
    googleClientId = String(payload.google_client_id || "");
    return googleClientId;
  }
  async function authMe() {
    if (!getToken()) { authUser = null; return null; }
    try {
      const response = await fetch(`${API_URL}?action=auth_me`, { cache: "no-store", mode: "cors", headers: authHeaders() });
      const payload = await jsonResponse(response);
      authUser = payload.user || null;
    } catch (_) { authUser = null; }
    refreshAuthUI();
    return authUser;
  }
  async function onGoogleCredential(response) {
    const credential = String(response?.credential || "");
    if (!credential) throw new Error("Google 未回傳登入憑證");
    const http = await fetch(`${API_URL}?action=auth_google`, {
      method: "POST", mode: "cors", cache: "no-store", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id_token: credential }),
    });
    const payload = await jsonResponse(http);
    setToken(String(payload.token || ""));
    authUser = payload.user || null;
    refreshAuthUI();
    status(`已登入：${authUser?.name || authUser?.email || "Google 使用者"}`);
    return authUser;
  }
  async function logout() {
    const token = getToken();
    if (token) {
      try { await fetch(`${API_URL}?action=auth_logout`, { method: "POST", mode: "cors", cache: "no-store", headers: authHeaders() }); } catch (_) {}
    }
    setToken(""); authUser = null;     refreshAuthUI();
    status("已登出 Google 帳號。");
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
    if (!authUser) throw new Error("請先登入 Google 帳號");
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
      method: "POST", cache: "no-store",
      headers: authHeaders({ "Content-Type": "application/octet-stream", "X-5DB-Preview": thumbnail }),
      body: bytes,
    });
    const saved = await jsonResponse(response);
    return { ...saved, recordCount: info.nodeCount, compressedSize: bytes.length, annotationCount: info.markCount };
  }
  async function list() {
    if (!authUser) throw new Error("請先登入 Google 帳號");
    const response = await cloudFetch(`${FIVE_DB_API_URL}?action=list`, {
      cache: "no-store", headers: authHeaders(),
    });
    return (await jsonResponse(response)).records || [];
  }
  async function fetchRecord(id) {
    if (!authUser) throw new Error("請先登入 Google 帳號");
    const recordId = Number(id);
    if (!Number.isSafeInteger(recordId) || recordId < 1) throw new Error("棋譜編號無效");
    const response = await cloudFetch(`${FIVE_DB_API_URL}?action=get&id=${recordId}`, {
      cache: "no-store", headers: authHeaders(),
    });
    if (!response.ok) {
      if (response.status === 401) { setToken(""); authUser = null; refreshAuthUI(); }
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
    if (!authUser) throw new Error("請先登入 Google 帳號");
    const recordId = Number(id);
    if (!Number.isSafeInteger(recordId) || recordId < 1) throw new Error("棋譜編號無效");
    const response = await cloudFetch(`${FIVE_DB_API_URL}?action=delete&id=${recordId}`, {
      method: "POST", cache: "no-store", headers: authHeaders(),
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
      #vcf-google-login{min-height:36px}#vcf-cloud-dialog,#vcf-account-admin-dialog{width:min(760px,calc(100vw - 24px));max-height:min(78vh,720px);border:1px solid #b9b09c;border-radius:12px;padding:0;box-shadow:0 16px 60px rgb(0 0 0 / 25%)}#vcf-cloud-dialog::backdrop,#vcf-account-admin-dialog::backdrop{background:rgb(0 0 0 / 35%)}
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
  async function adminRequest(action, body = null) {
    if (!isAdminUser(authUser)) throw new Error("此帳號沒有管理員權限");
    const options = { cache: "no-store", mode: "cors", headers: authHeaders() };
    if (body !== null) {
      options.method = "POST";
      options.headers = authHeaders({ "Content-Type": "application/json" });
      options.body = JSON.stringify(body);
    }
    const response = await fetch(`${API_URL}?action=${encodeURIComponent(action)}`, options);
    return jsonResponse(response);
  }
  async function listUsers() {
    const payload = await adminRequest("admin_users");
    return Array.isArray(payload.users) ? payload.users : [];
  }
  async function setUserStatus(userId, enabled) {
    return adminRequest("admin_user_status", { user_id: Number(userId), enabled: Boolean(enabled) });
  }
  async function setUserRole(userId, role) {
    const normalized = role === "admin" ? "admin" : "user";
    return adminRequest("admin_user_role", { user_id: Number(userId), role: normalized });
  }
  async function deleteUser(userId) {
    return adminRequest("admin_user_delete", { user_id: Number(userId) });
  }
  function ensureAdminDialog() {
    let dialog = document.getElementById("vcf-account-admin-dialog");
    if (dialog) return dialog;
    dialog = document.createElement("dialog");
    dialog.id = "vcf-account-admin-dialog";
    dialog.innerHTML = '<div class="vcf-cloud-body"><div class="vcf-cloud-head"><h3>管理帳號</h3><button type="button" data-close>關閉</button></div><div class="vcf-cloud-list" data-admin-list></div></div>';
    dialog.querySelector("[data-close]").addEventListener("click", () => dialog.close());
    document.body.appendChild(dialog);
    return dialog;
  }
  async function refreshAdminDialog(dialog) {
    const container = dialog.querySelector("[data-admin-list]");
    container.innerHTML = '<div class="vcf-cloud-empty">正在讀取帳號……</div>';
    if (!isAdminUser(authUser)) {
      container.innerHTML = '<div class="vcf-cloud-empty">此帳號沒有管理員權限。</div>';
      return;
    }
    let users;
    try {
      users = await listUsers();
    } catch (error) {
      container.innerHTML = '<div class="vcf-cloud-empty"></div>';
      container.firstElementChild.textContent = error?.message || String(error);
      return;
    }
    container.replaceChildren();
    if (!users.length) {
      container.innerHTML = '<div class="vcf-cloud-empty">目前沒有帳號資料。</div>';
      return;
    }
    for (const account of users) {
      const row = document.createElement("div");
      row.className = "vcf-cloud-row";

      const info = document.createElement("div");
      const title = document.createElement("div");
      title.className = "vcf-cloud-title";
      title.textContent = account.name || account.email || `帳號 #${account.id}`;
      const meta = document.createElement("div");
      meta.className = "vcf-cloud-meta";
      const roleText = account.role === "admin" ? "管理員" : "一般使用者";
      const stateText = account.enabled === false || Number(account.enabled) === 0 ? "已停用" : "啟用";
      meta.textContent = `${account.email || ""} · ${roleText} · ${stateText}${account.last_login_at ? ` · 最後登入 ${account.last_login_at}` : ""}`;
      info.append(title, meta);

      const actions = document.createElement("div");
      actions.className = "vcf-cloud-actions";
      const isOwner = String(account.email || "").trim().toLowerCase() === ADMIN_EMAIL;

      const statusButton = document.createElement("button");
      const enabled = !(account.enabled === false || Number(account.enabled) === 0);
      statusButton.textContent = enabled ? "停用" : "啟用";
      statusButton.disabled = isOwner;
      statusButton.addEventListener("click", async () => {
        statusButton.disabled = true;
        try { await setUserStatus(account.id, !enabled); await refreshAdminDialog(dialog); }
        catch (e) { status(e.message || String(e)); statusButton.disabled = false; }
      });

      const roleButton = document.createElement("button");
      roleButton.textContent = account.role === "admin" ? "改為一般使用者" : "設為管理員";
      roleButton.disabled = isOwner;
      roleButton.addEventListener("click", async () => {
        roleButton.disabled = true;
        try { await setUserRole(account.id, account.role === "admin" ? "user" : "admin"); await refreshAdminDialog(dialog); }
        catch (e) { status(e.message || String(e)); roleButton.disabled = false; }
      });

      const deleteButton = document.createElement("button");
      deleteButton.textContent = "刪除";
      deleteButton.disabled = isOwner;
      deleteButton.addEventListener("click", async () => {
        if (!confirm(`確定刪除「${account.email || account.name || account.id}」？該帳號的登入資料與雲端棋譜將依後端政策處理。`)) return;
        deleteButton.disabled = true;
        try { await deleteUser(account.id); await refreshAdminDialog(dialog); }
        catch (e) { status(e.message || String(e)); deleteButton.disabled = false; }
      });

      actions.append(statusButton, roleButton, deleteButton);
      row.append(info, actions);
      container.appendChild(row);
    }
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
    if (!records.length) { container.innerHTML = '<div class="vcf-cloud-empty">這個 Google 帳號目前沒有雲端棋譜。</div>'; return; }
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
    const login = document.getElementById("vcf-google-login"), user = document.getElementById("bb-cloud-user"), logoutButton = document.getElementById("bb-cloud-logout");
    const saveButton = document.getElementById("bb-cloud-save"), openButton = document.getElementById("bb-cloud-open"), adminButton = document.getElementById("bb-cloud-admin");
    if (user) user.textContent = authUser ? `${authUser.name || authUser.email}${isAdminUser(authUser) ? "｜管理員" : ""}` : "未登入";
    if (login) login.hidden = Boolean(authUser);
    if (logoutButton) logoutButton.hidden = !authUser;
    if (saveButton) {
      saveButton.disabled = !authUser || !global.VCFWorkbenchRecord?.workspace?.()?.mode;
      saveButton.title = "將完整 5DB 1.0 棋譜儲存到目前登入的 Google 帳號";
    }
    if (openButton) { openButton.disabled = !authUser; openButton.title = "查看此帳號的 5DB 1.0 棋譜"; }
    if (adminButton) adminButton.hidden = !isAdminUser(authUser);
  }
  function renderGoogleButton() {
    const target = document.getElementById("vcf-google-login");
    if (!target || authUser || !googleClientId || !global.google?.accounts?.id) return false;
    target.replaceChildren();
    global.google.accounts.id.initialize({ client_id: googleClientId, callback: credential => onGoogleCredential(credential).catch(e => status(e.message || String(e))) });
    global.google.accounts.id.renderButton(target, { theme: "outline", size: "medium", text: "signin_with", shape: "rectangular" });
    return true;
  }
  function installUI() {
    const panel = document.getElementById("bitboard-architecture-panel");
    const accountSlot = document.getElementById("vcf-account-actions");
    if (!panel || !accountSlot || document.getElementById("bb-cloud-auth")) return false;
    injectStyle();
    const exportStatus = panel.querySelector("#bb-export-status");
    const auth = document.createElement("div"); auth.id = "bb-cloud-auth";
    auth.innerHTML = '<div id="vcf-google-login"></div><span id="bb-cloud-user"></span><button id="bb-cloud-admin" class="bb-cloud-btn" type="button" hidden>管理帳號</button><button id="bb-cloud-logout" class="bb-cloud-btn" type="button" hidden>登出</button>';
    const saveButton = document.createElement("button"); saveButton.id = "bb-cloud-save"; saveButton.className = "bb-cloud-btn"; saveButton.textContent = "雲端儲存";
    const openButton = document.createElement("button"); openButton.id = "bb-cloud-open"; openButton.className = "bb-cloud-btn"; openButton.textContent = "我的雲端棋譜";
    const adminButton = auth.querySelector("#bb-cloud-admin");
    accountSlot.appendChild(auth);
    panel.insertBefore(saveButton, exportStatus || null); panel.insertBefore(openButton, exportStatus || null);
    auth.querySelector("#bb-cloud-logout").addEventListener("click", () => logout());
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
    adminButton.addEventListener("click", () => { if (!isAdminUser(authUser)) return; const dialog = ensureAdminDialog(); dialog.showModal(); refreshAdminDialog(dialog); });
    refreshAuthUI(); return true;
  }

  const api = {
    API_URL, FIVE_DB_API_URL, ADMIN_EMAIL, isAdminUser,
    publicConfig, authMe, onGoogleCredential, logout, saveCurrent, list, load, remove, listUsers, setUserStatus, setUserRole, deleteUser,
    currentBytes: null, currentMeta: null,
    get authUser() { return authUser; },
  };
  global.VCFCloud5DB = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof document === "undefined") return;

  installUI();
  global.addEventListener("vcf-workspace-mode-changed", refreshAuthUI);
  Promise.all([publicConfig(), authMe()]).then(() => { refreshAuthUI(); renderGoogleButton(); }).catch(e => status(e.message || String(e)));
  global.addEventListener("load", () => { renderGoogleButton(); }, { once: true });
})(typeof window !== "undefined" ? window : globalThis);
