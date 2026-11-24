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
  let activeFolderId = 0;
  let currentCloudRecord = null;
  let cloudFolders = [];
  let cloudRecords = [];
  const selectedRecordIds = new Set();
  const expandedFolderIds = new Set([0]);
  let activeDrag = null;
  let moveBusy = false;
  let lastSelectionIndex = -1;
  let explorerView = global.localStorage?.getItem("vcf_cloud_explorer_view") === "details" ? "details" : "thumbnails";

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
    selectedRecordIds.clear();
    cloudRecords = [];
    cloudFolders = [];
    activeFolderId = 0;
    currentCloudRecord = null;
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
  function encodeDocument(doc) {
    if (!global.FiveDB) throw new Error("5DB 編碼器未載入");
    const bytes = global.FiveDB.encode(doc);
    const info = global.FiveDB.validate(doc);
    const shot = global.FiveDB.preview(doc);
    const thumbnail = shot.width <= 25 && shot.height <= 25
      ? `${shot.width}x${shot.height}:${shot.board}` : "";
    return { bytes, info, thumbnail };
  }
  async function saveCurrent(fileName = "") {
    if (!authUser) throw new Error("請先登入協會會員帳號");
    const record = global.VCFWorkbenchRecord;
    if (!record?.export5DBDocument || !global.FiveDB) throw new Error("5DB 工作台尚未就緒");
    const doc = record.export5DBDocument();
    if (currentCloudRecord && !fileName) {
      const result = await updateDocument(doc, currentCloudRecord.id, currentCloudRecord.revision);
      currentCloudRecord = { ...currentCloudRecord, revision: result.revision };
      refreshAuthUI();
      return { ...result, updated: true };
    }
    const name = normalizeFileName(fileName, defaultFileName());
    const result = await saveDocument(doc, name, activeFolderId);
    currentCloudRecord = { id: Number(result.id), fileName: name, folderId: activeFolderId, revision: result.revision };
    refreshAuthUI();
    return { ...result, updated: false };
  }
  // Save a self-contained 5DB document without changing the live board.
  async function saveDocument(doc, fileName = "", folderId = 0) {
    if (!authUser) throw new Error("請先登入協會會員帳號");
    const { bytes, info, thumbnail } = encodeDocument(doc);
    const name = normalizeFileName(fileName, defaultFileName());
    const params = new URLSearchParams({ action: "save", file_name: name, title: doc.title || "", folder_id: String(folderId) });
    const response = await cloudFetch(`${FIVE_DB_API_URL}?${params}`, {
      method: "POST", cache: "no-store", credentials: "same-origin",
      headers: { "Content-Type": "application/octet-stream", "X-5DB-Preview": thumbnail },
      body: bytes,
    });
    const saved = await jsonResponse(response);
    return { ...saved, recordCount: info.nodeCount, compressedSize: bytes.length, annotationCount: info.markCount };
  }
  async function updateDocument(doc, id, revision) {
    if (!authUser) throw new Error("請先登入協會會員帳號");
    if (!/^[a-f0-9]{64}$/.test(String(revision || "")))
      throw new Error("缺少原棋譜版本資訊，請重新從雲端載入後再儲存");
    const { bytes, info, thumbnail } = encodeDocument(doc);
    const params = new URLSearchParams({ action: "update", id: String(id), revision, title: doc.title || "" });
    const response = await cloudFetch(`${FIVE_DB_API_URL}?${params}`, {
      method: "POST", cache: "no-store", credentials: "same-origin",
      headers: { "Content-Type": "application/octet-stream", "X-5DB-Preview": thumbnail },
      body: bytes,
    });
    const saved = await jsonResponse(response);
    return { ...saved, recordCount: info.nodeCount, compressedSize: bytes.length, annotationCount: info.markCount };
  }
  async function listCatalog() {
    if (!authUser) throw new Error("請先登入協會會員帳號");
    const response = await cloudFetch(`${FIVE_DB_API_URL}?action=list`, {
      cache: "no-store", credentials: "same-origin",
    });
    const payload = await jsonResponse(response);
    return { records: payload.records || [], folders: payload.folders || [] };
  }
  async function list() {
    return (await listCatalog()).records;
  }
  async function folderAction(action, fields = {}) {
    if (!authUser) throw new Error("請先登入協會會員帳號");
    const params = new URLSearchParams({ action, ...fields });
    const response = await cloudFetch(`${FIVE_DB_API_URL}?${params}`, {
      method: "POST", cache: "no-store", credentials: "same-origin",
    });
    return jsonResponse(response);
  }
  const createFolder = (name, parentId = 0) =>
    folderAction("folder_create", { name, parent_id: String(parentId) });
  const renameFolder = (id, name) =>
    folderAction("folder_rename", { id: String(id), name });
  const moveFolder = (id, parentId) =>
    folderAction("folder_move", { id: String(id), parent_id: String(parentId) });
  const deleteFolder = id => folderAction("folder_delete", { id: String(id) });
  const moveRecord = (id, folderId) =>
    folderAction("record_move", { id: String(id), folder_id: String(folderId) });
  async function moveRecords(ids, folderId) {
    if (!authUser) throw new Error("請先登入協會會員帳號");
    const unique = Array.from(new Set(ids.map(Number)));
    if (!unique.length || unique.some(id => !Number.isSafeInteger(id) || id < 1))
      throw new Error("沒有可移動的棋譜");
    // All selected records are accepted. Split only when serialized request
    // bytes approach the server's limit, not after an arbitrary record count.
    const MOVE_REQUEST_BYTES = 262144;
    const movedIds = [];
    async function sendBatch(batch) {
      const params = new URLSearchParams({ action: "records_move", folder_id: String(folderId) });
      try {
        const response = await cloudFetch(`${FIVE_DB_API_URL}?${params}`, {
          method: "POST", cache: "no-store", credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids: batch }),
        });
        const payload = await jsonResponse(response);
        if (!Array.isArray(payload.ids) || payload.ids.length !== batch.length)
          throw new Error("雲端批次移動回應不完整，請重新讀取");
        movedIds.push(...batch);
      } catch (error) {
        error.movedIds = movedIds;
        throw error;
      }
    }
    // {"ids":[]} is 10 ASCII bytes. Numeric IDs contain ASCII digits only.
    let batch = [];
    let bytes = 10;
    for (const id of unique) {
      const nextBytes = String(id).length + (batch.length ? 1 : 0);
      if (batch.length && bytes + nextBytes > MOVE_REQUEST_BYTES) {
        await sendBatch(batch);
        batch = [];
        bytes = 10;
      }
      bytes += String(id).length + (batch.length ? 1 : 0);
      batch.push(id);
    }
    if (batch.length) await sendBatch(batch);
    return { movedIds, folderId };
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
        folderId: Number(response.headers.get("X-5DB-Folder-Id") || 0),
        revision: response.headers.get("X-5DB-Revision") || "",
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
    const result = await jsonResponse(response);
    if (currentCloudRecord?.id === recordId) { currentCloudRecord = null; refreshAuthUI(); }
    return result;
  }
  async function load(id) {
    const result = await fetchRecord(id);
    const record = global.VCFWorkbenchRecord;
    if (!record?.import5DBDocument || !global.FiveDB) throw new Error("5DB 工作台尚未就緒");
    const imported = await record.import5DBDocument(global.FiveDB.decode(result.bytes));
    if (!imported) throw new Error("無法將雲端棋譜載入工作台");
    currentCloudRecord = {
      id: result.meta.id, fileName: result.meta.fileName,
      folderId: result.meta.folderId, revision: result.meta.revision,
    };
    refreshAuthUI();
    return { ...result, imported };
  }
  function formatBytes(v) {
    const n = Number(v) || 0;
    if (n < 1024) return `${n} B`;
    if (n < 1048576) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / 1048576).toFixed(2)} MB`;
  }
  function status(message) { const node = document.getElementById("bb-export-status"); if (node) node.textContent = message; }
  function explorerNotice(dialog, message) {
    const node = dialog?.querySelector("[data-explorer-notice]");
    if (node) node.textContent = message;
    status(message);
  }
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
      #vcf-shared-login-dialog{position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);margin:0;box-sizing:border-box;width:min(420px,calc(100vw - 32px));max-height:calc(100dvh - 32px);overflow-y:auto;padding:25px;border:0;border-radius:16px;background:#eee6de;color:#4f4339;box-shadow:0 28px 70px rgba(79,67,57,.24);font-family:"Noto Sans TC","Microsoft JhengHei",sans-serif}
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

      #vcf-cloud-dialog{width:min(1180px,calc(100vw - 20px));max-height:min(92dvh,940px)}
      #vcf-cloud-dialog .vcf-cloud-body{display:flex;flex-direction:column;max-height:90dvh;min-height:320px}
      #vcf-cloud-dialog .vcf-cloud-explorer{display:grid;grid-template-columns:minmax(190px,245px) minmax(0,1fr);min-height:260px;flex:1;overflow:hidden;border:1px solid #ddd5c5;border-radius:8px;background:#fff}
      #vcf-cloud-dialog .vcf-cloud-tree-pane{display:flex;flex-direction:column;min-width:0;border-right:1px solid #ddd5c5;background:#faf8f2}
      #vcf-cloud-dialog .vcf-cloud-tree-heading{padding:10px 12px;font-weight:700;font-size:13px;border-bottom:1px solid #e5ddcd}
      #vcf-cloud-dialog .vcf-cloud-tree{flex:1;overflow:auto;padding:6px;font-size:13px}
      #vcf-cloud-dialog .vcf-cloud-tree-line{display:flex;align-items:center;gap:2px;margin:1px 0;min-height:30px;white-space:nowrap}
      #vcf-cloud-dialog .vcf-cloud-tree-toggle{flex:0 0 22px;min-height:26px;border:0;background:transparent;cursor:pointer;padding:0}
      #vcf-cloud-dialog .vcf-cloud-tree-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;text-align:left;min-height:29px;padding:4px 5px;border:0;border-radius:5px;background:transparent;color:#3d3a31;cursor:pointer;font:inherit}
      #vcf-cloud-dialog .vcf-cloud-tree-name:hover{background:#e9eef0}
      #vcf-cloud-dialog .vcf-cloud-tree-name[draggable="true"]{cursor:grab}
      #vcf-cloud-dialog .vcf-cloud-tree-name.vcf-cloud-drop-target{background:#bfe4c7;color:#164c32;outline:2px solid #329456;outline-offset:-2px}
      #vcf-cloud-dialog .vcf-cloud-row[draggable="true"]{cursor:grab}
      #vcf-cloud-dialog .vcf-cloud-row[draggable="true"]:active{cursor:grabbing}
      #vcf-cloud-dialog .vcf-cloud-tree-name[aria-current="true"]{background:#dce9f4;color:#1b4e75;font-weight:700}
      #vcf-cloud-dialog .vcf-cloud-files{display:flex;flex-direction:column;min-width:0;min-height:0;overflow:hidden}
      #vcf-cloud-dialog .vcf-cloud-files-toolbar{display:flex;align-items:center;justify-content:space-between;gap:9px;padding:8px 10px;flex-wrap:wrap;border-bottom:1px solid #ddd5c5;background:#fcfbf7}
      #vcf-cloud-dialog .vcf-cloud-path{font-size:13px;font-weight:600;color:#5c5444;min-width:0;overflow-wrap:anywhere}
      #vcf-cloud-dialog .vcf-cloud-file-tools{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
      #vcf-cloud-dialog .vcf-cloud-file-tools button{min-height:30px;padding:5px 9px;border:1px solid #b9ad99;border-radius:5px;background:#fff;color:#4f4536;cursor:pointer;font-size:12px}
      #vcf-cloud-dialog .vcf-cloud-file-tools button[aria-pressed="true"]{background:#dce9f4;border-color:#83a7c4;color:#1d4d73}
      #vcf-cloud-dialog .vcf-cloud-file-tools button:disabled{opacity:.45;cursor:default}
      #vcf-cloud-dialog .vcf-cloud-selected-count{font-size:12px;font-variant-numeric:tabular-nums}
      #vcf-cloud-dialog .vcf-cloud-explorer-notice{font-size:12px;color:#655943;padding:0 16px 10px;min-height:14px;overflow-wrap:anywhere}
      #vcf-cloud-dialog .vcf-cloud-items-scroll{min-width:0;min-height:0;overflow:auto;flex:1}
      #vcf-cloud-dialog .vcf-cloud-list{max-height:none;overflow:visible;display:grid;gap:5px;padding:8px}
      #vcf-cloud-dialog .vcf-cloud-row{display:grid;grid-template-columns:26px 94px minmax(0,1fr) auto;gap:8px;align-items:center;min-width:0;padding:8px;border:1px solid #e3dccf;border-radius:7px;background:#fffdf8;cursor:default}
      #vcf-cloud-dialog .vcf-cloud-row:hover{background:#f7f9fb}
      #vcf-cloud-dialog .vcf-cloud-row[aria-selected="true"]{background:#e2effb;border-color:#92b5d4}
      #vcf-cloud-dialog .vcf-cloud-select{grid-column:1;grid-row:1;margin:auto;cursor:pointer;accent-color:#376c99;width:16px;height:16px}
      #vcf-cloud-dialog .vcf-cloud-preview{grid-column:2;grid-row:1;width:94px}
      #vcf-cloud-dialog .vcf-cloud-info{grid-column:3;grid-row:1;min-width:0}
      #vcf-cloud-dialog .vcf-cloud-thumb-stats{margin-top:4px;color:#756e61;font-size:12px;line-height:1.4}
      #vcf-cloud-dialog [data-view="details"] .vcf-cloud-thumb-stats{display:none}
      #vcf-cloud-dialog .vcf-cloud-actions{grid-column:4;grid-row:1;justify-content:end;max-width:174px}
      #vcf-cloud-dialog .vcf-cloud-detail-count,#vcf-cloud-dialog .vcf-cloud-detail-size,#vcf-cloud-dialog .vcf-cloud-detail-date,#vcf-cloud-dialog .vcf-cloud-detail-header{display:none}
      #vcf-cloud-dialog [data-view="details"] .vcf-cloud-detail-header{display:grid;position:sticky;top:0;z-index:2;grid-template-columns:26px minmax(140px,1.7fr) minmax(160px,2fr) 62px 80px 132px 162px;min-width:810px;gap:7px;padding:8px 10px;background:#f1ede3;color:#5b5245;border-bottom:1px solid #ddd2ba;font-size:12px;font-weight:700}
      #vcf-cloud-dialog [data-view="details"] .vcf-cloud-list{min-width:810px;gap:0;padding:0}
      #vcf-cloud-dialog [data-view="details"] .vcf-cloud-row{grid-template-columns:26px minmax(140px,1.7fr) minmax(160px,2fr) 62px 80px 132px 162px;gap:7px;padding:6px 10px;min-height:40px;border:0;border-bottom:1px solid #ebe6da;border-radius:0;background:#fff}
      #vcf-cloud-dialog [data-view="details"] .vcf-cloud-row:nth-child(even){background:#faf9f6}
      #vcf-cloud-dialog [data-view="details"] .vcf-cloud-row[aria-selected="true"]{background:#e2effb}
      #vcf-cloud-dialog [data-view="details"] .vcf-cloud-preview{display:none}
      #vcf-cloud-dialog [data-view="details"] .vcf-cloud-info{display:contents}
      #vcf-cloud-dialog [data-view="details"] .vcf-cloud-title{grid-column:2;grid-row:1;white-space:nowrap;text-overflow:ellipsis;overflow:hidden;font-size:13px}
      #vcf-cloud-dialog [data-view="details"] .vcf-cloud-meta{grid-column:3;grid-row:1;white-space:nowrap;text-overflow:ellipsis;overflow:hidden;margin:0;font-size:12px}
      #vcf-cloud-dialog [data-view="details"] .vcf-cloud-detail-count{display:block;grid-column:4;grid-row:1}
      #vcf-cloud-dialog [data-view="details"] .vcf-cloud-detail-size{display:block;grid-column:5;grid-row:1}
      #vcf-cloud-dialog [data-view="details"] .vcf-cloud-detail-date{display:block;grid-column:6;grid-row:1;font-size:11px}
      #vcf-cloud-dialog [data-view="details"] .vcf-cloud-actions{grid-column:7;grid-row:1;flex-wrap:nowrap;max-width:none}
      #vcf-cloud-dialog [data-view="details"] .vcf-cloud-actions button{white-space:nowrap;padding:5px;font-size:11px}
      #vcf-cloud-dialog .vcf-cloud-row:focus-visible{outline:2px solid #276d9d;outline-offset:-2px}
      @media(max-width:650px){#vcf-cloud-dialog .vcf-cloud-body{min-height:0}#vcf-cloud-dialog .vcf-cloud-explorer{grid-template-columns:minmax(0,1fr);grid-template-rows:minmax(90px,170px) minmax(200px,1fr);max-height:70dvh}#vcf-cloud-dialog .vcf-cloud-tree-pane{border-right:0;border-bottom:1px solid #ddd5c5}#vcf-cloud-dialog .vcf-cloud-row{grid-template-columns:22px 70px minmax(0,1fr);gap:7px}#vcf-cloud-dialog .vcf-cloud-preview{width:70px}#vcf-cloud-dialog .vcf-cloud-actions{grid-column:2/-1;grid-row:2;max-width:none}#vcf-cloud-dialog [data-view="details"] .vcf-cloud-row{grid-template-columns:26px minmax(140px,1.7fr) minmax(160px,2fr) 62px 80px 132px 162px}}
      .vcf-cloud-body{padding:16px;display:grid;gap:12px}.vcf-cloud-folder-toolbar{display:flex;align-items:center;gap:6px;flex-wrap:wrap}.vcf-cloud-folder-toolbar label{display:flex;align-items:center;gap:6px;flex:1;min-width:150px}.vcf-cloud-folder-toolbar select{flex:1;min-width:100px;max-width:100%;padding:7px;border:1px solid #bbb0a0;border-radius:6px;background:#fff}.vcf-cloud-folder-toolbar button{padding:7px;border:1px solid #aaa;border-radius:6px;background:#fff;cursor:pointer}.vcf-cloud-folder-chooser{border:1px solid #b9b09c;border-radius:10px;padding:20px;max-width:min(440px,90vw)}.vcf-cloud-folder-chooser select{display:block;width:100%;padding:8px;margin:10px 0}.vcf-cloud-folder-chooser div{display:flex;justify-content:end;gap:8px}.vcf-cloud-folder-chooser button{padding:7px 14px}.vcf-cloud-head{display:flex;justify-content:space-between;align-items:center;gap:10px}.vcf-cloud-head h3{margin:0}.vcf-cloud-list{display:grid;gap:8px;overflow:auto;max-height:55vh}.vcf-cloud-row{display:grid;grid-template-columns:112px minmax(0,1fr) auto;gap:12px;align-items:center;padding:10px;border:1px solid #ddd5c5;border-radius:8px;background:#fffdf8}.vcf-cloud-preview{width:112px;aspect-ratio:1/1;display:grid;place-items:center;border:1px solid #d0b98c;border-radius:5px;background:#edcf9d;overflow:hidden;font-size:11px;color:#666}.vcf-cloud-preview svg{display:block;width:100%;height:100%}.vcf-cloud-title{font-weight:700;overflow-wrap:anywhere}.vcf-cloud-meta{font-size:12px;color:#6b6559;margin-top:3px;overflow-wrap:anywhere}.vcf-cloud-actions{display:flex;gap:5px;flex-wrap:wrap}.vcf-cloud-actions button,.vcf-cloud-head button{border:1px solid #aaa;border-radius:6px;background:#fff;padding:6px 8px;cursor:pointer}.vcf-cloud-empty{padding:18px;text-align:center;color:#6b6559;background:#f7f4ed;border-radius:8px}@media(max-width:600px){.vcf-cloud-row{grid-template-columns:88px minmax(0,1fr);gap:9px}.vcf-cloud-preview{width:88px}.vcf-cloud-actions{grid-column:1/-1;justify-content:flex-end}}
    `;
    document.head.appendChild(style);
  }
  function folderEntries(folders, excludedId = 0) {
    const byParent = new Map();
    for (const folder of folders) {
      const parent = Number(folder.parent_id || 0);
      if (!byParent.has(parent)) byParent.set(parent, []);
      byParent.get(parent).push(folder);
    }
    for (const children of byParent.values()) {
      children.sort((a, b) => String(a.name).localeCompare(String(b.name), "zh-Hant", { numeric: true }));
    }
    const entries = [{ id: 0, label: "根目錄" }];
    const walk = (parent, depth, visited) => {
      for (const folder of byParent.get(parent) || []) {
        const id = Number(folder.id);
        if (id === excludedId || visited.has(id)) continue;
        entries.push({ id, label: "　".repeat(depth) + "📁 " + folder.name });
        walk(id, depth + 1, new Set([...visited, id]));
      }
    };
    walk(0, 1, new Set());
    return entries;
  }
  function folderSelector(select, excludedId = 0) {
    if (!select) return;
    select.replaceChildren();
    for (const entry of folderEntries(cloudFolders, excludedId)) {
      const option = document.createElement("option");
      option.value = String(entry.id);
      option.textContent = entry.label;
      select.appendChild(option);
    }
  }

  function visibleCloudRecords() {
    return cloudRecords.filter(record => Number(record.folder_id || 0) === activeFolderId);
  }
  function folderPathNames(id) {
    const names = [];
    const visited = new Set();
    while (id > 0 && !visited.has(id)) {
      visited.add(id);
      const folder = cloudFolders.find(entry => Number(entry.id) === id);
      if (!folder) break;
      names.unshift(folder.name);
      id = Number(folder.parent_id || 0);
    }
    return ["根目錄", ...names];
  }
  function selectFolder(dialog, id) {
    if (activeFolderId === id) return;
    activeFolderId = id;
    selectedRecordIds.clear();
    lastSelectionIndex = -1;
    renderFolderTree(dialog);
    renderFolderContents(dialog);
  }
  function isFolderDescendant(folderId, ancestorId) {
    const seen = new Set();
    let current = folderId;
    while (current > 0 && !seen.has(current)) {
      if (current === ancestorId) return true;
      seen.add(current);
      const folder = cloudFolders.find(entry => Number(entry.id) === current);
      if (!folder) break;
      current = Number(folder.parent_id || 0);
    }
    return false;
  }
  function canDropIntoFolder(destination) {
    if (!activeDrag || moveBusy) return false;
    if (activeDrag.kind === "records") {
      return activeDrag.source !== destination && activeDrag.ids.length > 0;
    }
    if (activeDrag.kind === "folder") {
      const folder = cloudFolders.find(entry => Number(entry.id) === activeDrag.id);
      return !!folder && Number(folder.parent_id || 0) !== destination
        && !isFolderDescendant(destination, activeDrag.id);
    }
    return false;
  }
  function clearCloudDrag(dialog) {
    activeDrag = null;
    const tree = dialog?.querySelector("[data-tree]");
    for (const node of tree?.querySelectorAll?.(".vcf-cloud-drop-target") || []) {
      node.classList.remove("vcf-cloud-drop-target");
    }
  }
  async function dropIntoFolder(dialog, payload, destination) {
    if (!payload) return;
    if (payload.kind === "records") {
      await moveSelectedToFolder(dialog, payload.ids, destination);
      return;
    }
    if (payload.kind !== "folder") return;
    const id = payload.id;
    if (destination === id || isFolderDescendant(destination, id)) {
      explorerNotice(dialog, "不能將資料夾移到自己或其子資料夾。");
      return;
    }
    const folder = cloudFolders.find(entry => Number(entry.id) === id);
    if (!folder || Number(folder.parent_id || 0) === destination) return;
    if (moveBusy) return;
    moveBusy = true;
    try {
      explorerNotice(dialog, "正在移動資料夾…");
      const result = await moveFolder(id, destination);
      folder.parent_id = Number(result.folder?.parent_id ?? destination);
      expandedFolderIds.add(destination);
      renderFolderTree(dialog);
      explorerNotice(dialog, "資料夾已移動。");
    } finally { moveBusy = false; }
  }
  function renderFolderTree(dialog) {
    const tree = dialog.querySelector("[data-tree]");
    if (!tree) return;
    tree.replaceChildren();
    const childrenByParent = new Map();
    for (const folder of cloudFolders) {
      const parent = Number(folder.parent_id || 0);
      if (!childrenByParent.has(parent)) childrenByParent.set(parent, []);
      childrenByParent.get(parent).push(folder);
    }
    for (const group of childrenByParent.values()) {
      group.sort((a, b) => String(a.name).localeCompare(String(b.name), "zh-Hant", { numeric: true }));
    }
    const folderId = Number(activeFolderId);
    if (folderId > 0 && !cloudFolders.some(folder => Number(folder.id) === folderId)) activeFolderId = 0;
    for (const entry of cloudFolders) {
      let current = Number(entry.id), guard = new Set();
      if (current !== activeFolderId) continue;
      while (current > 0 && !guard.has(current)) {
        guard.add(current);
        const node = cloudFolders.find(folder => Number(folder.id) === current);
        if (!node) break;
        expandedFolderIds.add(Number(node.parent_id || 0));
        current = Number(node.parent_id || 0);
      }
    }
    const countByFolder = new Map();
    for (const record of cloudRecords) {
      const id = Number(record.folder_id || 0);
      countByFolder.set(id, (countByFolder.get(id) || 0) + 1);
    }
    const make = (id, name, depth, ancestors) => {
      if (ancestors.has(id)) return null;
      const node = document.createElement("div");
      node.className = "vcf-cloud-tree-node";
      node.setAttribute("role", "treeitem");
      const line = document.createElement("div");
      line.className = "vcf-cloud-tree-line";
      line.style.paddingLeft = Math.min(depth * 14, 140) + "px";
      const children = childrenByParent.get(id) || [];
      const expand = document.createElement("button");
      expand.className = "vcf-cloud-tree-toggle";
      expand.type = "button";
      expand.textContent = children.length ? (expandedFolderIds.has(id) ? "▾" : "▸") : " ";
      expand.disabled = !children.length;
      expand.setAttribute("aria-label", (expandedFolderIds.has(id) ? "收合 " : "展開 ") + name);
      const choose = document.createElement("button");
      choose.type = "button";
      choose.className = "vcf-cloud-tree-name";
      choose.textContent = (id === 0 ? "📂 " : "📁 ") + name + " (" + (countByFolder.get(id) || 0) + ")";
      choose.title = name;
      choose.setAttribute("aria-current", String(id === activeFolderId));
      choose.addEventListener("click", () => selectFolder(dialog, id));
      choose.draggable = id > 0;
      if (id > 0) {
        choose.title = name + "（可拖曳移動資料夾）";
        choose.addEventListener("dragstart", event => {
          if (moveBusy) { event.preventDefault(); return; }
          activeDrag = { kind: "folder", id };
          event.dataTransfer?.setData("text/plain", "VCF5DB_FOLDER");
          if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
          event.stopPropagation?.();
        });
        choose.addEventListener("dragend", () => clearCloudDrag(dialog));
      }
      choose.addEventListener("dragover", event => {
        if (!canDropIntoFolder(id)) return;
        event.preventDefault();
        if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
        choose.classList?.add("vcf-cloud-drop-target");
      });
      choose.addEventListener("dragleave", event => {
        if (!choose.contains?.(event.relatedTarget)) choose.classList?.remove("vcf-cloud-drop-target");
      });
      choose.addEventListener("drop", event => {
        if (!canDropIntoFolder(id)) return;
        event.preventDefault();
        event.stopPropagation?.();
        const payload = activeDrag;
        clearCloudDrag(dialog);
        void dropIntoFolder(dialog, payload, id).catch(error =>
          explorerNotice(dialog, error.message || String(error)));
      });
      const group = document.createElement("div");
      group.setAttribute("role", "group");
      group.hidden = !expandedFolderIds.has(id);
      if (children.length) {
        node.setAttribute("aria-expanded", String(!group.hidden));
        expand.addEventListener("click", () => {
          group.hidden = !group.hidden;
          node.setAttribute("aria-expanded", String(!group.hidden));
          expandedFolderIds[group.hidden ? "delete" : "add"](id);
          expand.textContent = group.hidden ? "▸" : "▾";
          expand.setAttribute("aria-label", (group.hidden ? "展開 " : "收合 ") + name);
        });
      }
      line.append(expand, choose);
      node.append(line, group);
      const nextAncestors = new Set([...ancestors, id]);
      for (const child of children) {
        const nested = make(Number(child.id), child.name, depth + 1, nextAncestors);
        if (nested) group.appendChild(nested);
      }
      return node;
    };
    tree.appendChild(make(0, "根目錄", 0, new Set()));
    const path = dialog.querySelector("[data-folder-path]");
    if (path) path.textContent = folderPathNames(activeFolderId).join(" / ");
    for (const action of ["rename", "move", "delete"]) {
      const button = dialog.querySelector("[data-folder-" + action + "]");
      if (button) button.disabled = activeFolderId === 0;
    }
  }
  function updateSelectionUI(dialog) {
    const current = visibleCloudRecords();
    const valid = new Set(current.map(record => Number(record.id)));
    for (const id of Array.from(selectedRecordIds)) if (!valid.has(id)) selectedRecordIds.delete(id);
    const list = dialog.querySelector("[data-list]");
    for (const row of list?.querySelectorAll?.(".vcf-cloud-row") || []) {
      const id = Number(row.dataset.recordId);
      const checked = selectedRecordIds.has(id);
      row.setAttribute("aria-selected", String(checked));
      const check = row.querySelector(".vcf-cloud-select");
      if (check) check.checked = checked;
    }
    const count = selectedRecordIds.size;
    const text = dialog.querySelector("[data-selected-count]");
    if (text) text.textContent = "已選 " + count + " / " + current.length + " 份";
    for (const action of ["batch-move", "batch-delete"]) {
      const button = dialog.querySelector("[data-" + action + "]");
      if (button) button.disabled = count === 0;
    }
    const all = dialog.querySelector("[data-select-all]");
    if (all) {
      all.disabled = current.length === 0;
      all.textContent = count === current.length && current.length > 0 ? "取消全選" : "全選";
    }
  }
  function selectRecord(dialog, id, index, event, checked = null) {
    if (checked !== null) {
      checked ? selectedRecordIds.add(id) : selectedRecordIds.delete(id);
    } else if (event.shiftKey && lastSelectionIndex >= 0) {
      const visible = visibleCloudRecords();
      if (!event.ctrlKey && !event.metaKey) selectedRecordIds.clear();
      const start = Math.min(lastSelectionIndex, index), end = Math.max(lastSelectionIndex, index);
      for (let i = start; i <= end; i++) selectedRecordIds.add(Number(visible[i].id));
    } else if (event.ctrlKey || event.metaKey) {
      selectedRecordIds.has(id) ? selectedRecordIds.delete(id) : selectedRecordIds.add(id);
    } else {
      selectedRecordIds.clear();
      selectedRecordIds.add(id);
    }
    lastSelectionIndex = index;
    updateSelectionUI(dialog);
  }
  function applyMovedRecords(dialog, ids, destination) {
    const moved = new Set(ids.map(Number));
    for (const record of cloudRecords) {
      if (moved.has(Number(record.id))) record.folder_id = destination;
    }
    for (const id of moved) selectedRecordIds.delete(id);
    renderFolderTree(dialog);
    renderFolderContents(dialog);
  }
  async function moveSelectedToFolder(dialog, ids, destination) {
    if (moveBusy) return;
    const current = visibleCloudRecords();
    const valid = new Set(current.map(record => Number(record.id)));
    const normalized = Array.from(new Set(ids.map(Number))).filter(id => valid.has(id));
    if (!normalized.length) return;
    if (destination === activeFolderId) {
      explorerNotice(dialog, "棋譜已在目前資料夾。");
      return;
    }
    if (destination !== 0 && !cloudFolders.some(folder => Number(folder.id) === destination))
      throw new Error("目的地資料夾不存在");
    moveBusy = true;
    try {
      explorerNotice(dialog, "正在移動 " + normalized.length + " 份棋譜…");
      const result = await moveRecords(normalized, destination);
      applyMovedRecords(dialog, result.movedIds, destination);
      explorerNotice(dialog, "已移動 " + result.movedIds.length + " 份棋譜。");
    } catch (error) {
      if (error.movedIds?.length) applyMovedRecords(dialog, error.movedIds, destination);
      explorerNotice(dialog, "部分棋譜移動失敗：" + (error.message || error));
      throw error;
    } finally {
      moveBusy = false;
    }
  }
  async function batchMoveRecords(dialog) {
    const ids = Array.from(selectedRecordIds);
    if (!ids.length) return;
    const destination = await chooseDestination("移動 " + ids.length + " 份棋譜到");
    if (destination === null) return;
    await moveSelectedToFolder(dialog, ids, destination);
  }
  async function batchDeleteRecords(dialog) {
    const ids = Array.from(selectedRecordIds);
    if (!ids.length) return;
    if (!confirm("確定永久刪除所選的 " + ids.length + " 份棋譜？此操作無法復原。")) return;
    let deleted = 0, problem = null;
    for (const id of ids) {
      try {
        explorerNotice(dialog, "正在刪除第 " + (deleted + 1) + " / " + ids.length + " 份棋譜…");
        await remove(id);
        previewCache.delete(id);
        selectedRecordIds.delete(id);
        deleted++;
      } catch (error) { problem = error; break; }
    }
    await refreshDialog(dialog);
    explorerNotice(dialog, "已刪除 " + deleted + " 份棋譜。" + (problem ? " 其餘未刪除：" + (problem.message || problem) : ""));
  }
  function chooseDestination(title, excludedId = 0) {
    return new Promise(resolve => {
      const picker = document.createElement("dialog");
      picker.className = "vcf-cloud-folder-chooser";
      const heading = document.createElement("h3");
      heading.textContent = title;
      const select = document.createElement("select");
      select.setAttribute("aria-label", "目的地資料夾");
      folderSelector(select, excludedId);
      const controls = document.createElement("div");
      const ok = document.createElement("button");
      ok.textContent = "確定"; ok.type = "button";
      const cancel = document.createElement("button");
      cancel.textContent = "取消"; cancel.type = "button";
      controls.append(ok, cancel);
      picker.append(heading, select, controls);
      document.body.appendChild(picker);
      let resolved = false;
      function finish(value) {
        if (resolved) return;
        resolved = true;
        picker.close();
        picker.remove();
        resolve(value);
      }
      ok.addEventListener("click", () => finish(Number(select.value)));
      cancel.addEventListener("click", () => finish(null));
      picker.addEventListener("cancel", event => { event.preventDefault(); finish(null); });
      picker.showModal();
    });
  }
  async function editFolder(dialog, action) {
    if (moveBusy) return;
    const id = activeFolderId;
    let changed = false;
    if (action === "create") {
      const name = prompt("新增子資料夾名稱", "");
      if (name === null) return;
      const result = await createFolder(name, id);
      if (result.folder?.id) {
        cloudFolders.push(result.folder);
        expandedFolderIds.add(id);
        activeFolderId = Number(result.folder.id);
        changed = true;
      }
    } else if (id > 0 && action === "rename") {
      const name = prompt("資料夾名稱", cloudFolders.find(folder => Number(folder.id) === id)?.name || "");
      if (name === null) return;
      const result = await renameFolder(id, name);
      const folder = cloudFolders.find(folder => Number(folder.id) === id);
      if (folder) { folder.name = result.folder?.name ?? name; changed = true; }
    } else if (id > 0 && action === "move") {
      const to = await chooseDestination("移動目前資料夾到", id);
      if (to === null || to === cloudFolders.find(folder => Number(folder.id) === id)?.parent_id) return;
      await moveFolder(id, to);
      const folder = cloudFolders.find(folder => Number(folder.id) === id);
      if (folder) { folder.parent_id = to; expandedFolderIds.add(to); changed = true; }
    } else if (id > 0 && action === "delete") {
      if (!confirm("刪除這個空資料夾？內有棋譜或子資料夾時無法刪除。")) return;
      await deleteFolder(id);
      cloudFolders = cloudFolders.filter(folder => Number(folder.id) !== id);
      expandedFolderIds.delete(id);
      activeFolderId = 0;
      changed = true;
    }
    if (!changed) return;
    selectedRecordIds.clear();
    lastSelectionIndex = -1;
    renderFolderTree(dialog);
    renderFolderContents(dialog);
    explorerNotice(dialog, "資料夾已更新。");
  }
  function ensureDialog() {
    let dialog = document.getElementById("vcf-cloud-dialog");
    if (dialog) return dialog;
    dialog = document.createElement("dialog"); dialog.id = "vcf-cloud-dialog";
    dialog.innerHTML = "<div class=\"vcf-cloud-body\"><div class=\"vcf-cloud-head\"><h3>我的雲端棋譜</h3><button type=\"button\" data-close>關閉</button></div><div class=\"vcf-cloud-folder-toolbar\"><button type=\"button\" data-folder-create>新增資料夾</button><button type=\"button\" data-folder-rename>重新命名</button><button type=\"button\" data-folder-move>移動資料夾</button><button type=\"button\" data-folder-delete>刪除資料夾</button></div><div class=\"vcf-cloud-explorer\"><aside class=\"vcf-cloud-tree-pane\" aria-label=\"資料夾\"><div class=\"vcf-cloud-tree-heading\">資料夾</div><nav class=\"vcf-cloud-tree\" data-tree role=\"tree\" aria-label=\"資料夾樹\"></nav></aside><section class=\"vcf-cloud-files\" aria-label=\"所選資料夾的棋譜\"><div class=\"vcf-cloud-files-toolbar\"><span class=\"vcf-cloud-path\" data-folder-path>根目錄</span><div class=\"vcf-cloud-file-tools\"><span data-selected-count class=\"vcf-cloud-selected-count\">已選 0 份</span><button type=\"button\" data-select-all>全選</button><button type=\"button\" data-batch-move disabled>移動所選</button><button type=\"button\" data-batch-delete disabled>刪除所選</button><button type=\"button\" data-view-thumbnails aria-pressed=\"true\">縮圖</button><button type=\"button\" data-view-details aria-pressed=\"false\">詳細資料</button></div></div><div class=\"vcf-cloud-items-scroll\" data-file-scroll data-view=\"thumbnails\"><div class=\"vcf-cloud-detail-header\" data-details-head><span>選取</span><span>檔名</span><span>棋譜標題</span><span>局面數</span><span>大小</span><span>修改時間</span><span>操作</span></div><div class=\"vcf-cloud-list\" data-list></div></div></section></div></div>";
    dialog.querySelector("[data-close]").addEventListener("click", () => dialog.close());
    for (const action of ["create", "rename", "move", "delete"]) {
      dialog.querySelector("[data-folder-" + action + "]").addEventListener("click", () => {
        void editFolder(dialog, action).catch(e => explorerNotice(dialog, e.message || String(e)));
      });
    }
    dialog.querySelector("[data-list]").addEventListener("keydown", event => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "a") {
        event.preventDefault();
        for (const record of visibleCloudRecords()) selectedRecordIds.add(Number(record.id));
        lastSelectionIndex = -1;
        updateSelectionUI(dialog);
      } else if (event.key === "Escape" && selectedRecordIds.size) {
        event.preventDefault();
        selectedRecordIds.clear();
        updateSelectionUI(dialog);
      }
    });
    dialog.querySelector("[data-select-all]").addEventListener("click", () => {
      const visible = visibleCloudRecords();
      const allSelected = visible.length > 0 && visible.every(r => selectedRecordIds.has(Number(r.id)));
      for (const record of visible) {
        if (allSelected) selectedRecordIds.delete(Number(record.id));
        else selectedRecordIds.add(Number(record.id));
      }
      lastSelectionIndex = -1;
      updateSelectionUI(dialog);
    });
    dialog.querySelector("[data-batch-move]").addEventListener("click", () => {
      void batchMoveRecords(dialog).catch(e => status(e.message || String(e)));
    });
    dialog.querySelector("[data-batch-delete]").addEventListener("click", () => {
      void batchDeleteRecords(dialog).catch(e => status(e.message || String(e)));
    });
    for (const mode of ["thumbnails", "details"]) {
      dialog.querySelector("[data-view-" + mode + "]").addEventListener("click", () => {
        if (explorerView === mode) return;
        explorerView = mode;
        try { global.localStorage?.setItem("vcf_cloud_explorer_view", mode); } catch (_) {}
        renderFolderContents(dialog);
      });
    }
    const notice = document.createElement("div");
    notice.className = "vcf-cloud-explorer-notice";
    notice.setAttribute("data-explorer-notice", "");
    notice.setAttribute("role", "status");
    notice.setAttribute("aria-live", "polite");
    dialog.appendChild(notice);
    dialog.addEventListener("close", () => {
      if (activePreviewObserver) activePreviewObserver.disconnect();
      activePreviewObserver = null;
      previewGeneration++;
    });
    document.body.appendChild(dialog);
    return dialog;
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

  function renderFolderContents(dialog) {
    if (activePreviewObserver) { activePreviewObserver.disconnect(); activePreviewObserver = null; }
    const generation = ++previewGeneration;
    const container = dialog.querySelector("[data-list]");
    if (!container) return;
    const scroll = dialog.querySelector("[data-file-scroll]");
    if (scroll) scroll.dataset.view = explorerView;
    for (const mode of ["thumbnails", "details"]) {
      const control = dialog.querySelector("[data-view-" + mode + "]");
      if (control) control.setAttribute("aria-pressed", String(explorerView === mode));
    }
    container.replaceChildren();
    const records = visibleCloudRecords();
    if (!records.length) {
      const empty = document.createElement("div");
      empty.className = "vcf-cloud-empty";
      empty.textContent = "目前資料夾沒有棋譜。";
      container.appendChild(empty);
      updateSelectionUI(dialog);
      return;
    }
    const missingPreviews = [];
    records.forEach((record, index) => {
      const recordId = Number(record.id);
      const fileName = record.file_name || record.title || "棋譜-" + recordId;
      const row = document.createElement("div");
      row.className = "vcf-cloud-row";
      row.dataset.recordId = String(recordId);
      row.tabIndex = 0;
      row.draggable = true;
      row.title = "可拖曳所選棋譜至左側資料夾";
      row.setAttribute("aria-selected", String(selectedRecordIds.has(recordId)));
      row.setAttribute("aria-label", fileName + ".5db");
      const previewBox = document.createElement("div");
      previewBox.className = "vcf-cloud-preview";
      if (explorerView === "thumbnails") {
        previewBox.textContent = "載入縮圖…";
        const ready = parsePreview(record.preview) ? record.preview : previewCache.get(recordId);
        if (ready) showBoardThumbnail(previewBox, ready);
        else missingPreviews.push({ record, previewBox });
      }
      const info = document.createElement("div");
      info.className = "vcf-cloud-info";
      info.innerHTML = '<div class="vcf-cloud-title"></div><div class="vcf-cloud-meta"></div><div class="vcf-cloud-thumb-stats"></div>';
      info.children[0].textContent = fileName + ".5db";
      info.children[1].textContent = record.title || "（無標題）";
      info.children[2].textContent = (record.record_count || 0) + " 個局面 · " +
        formatBytes(record.compressed_size) + " · " + (record.updated_at || "");
      const actions = document.createElement("div");
      actions.className = "vcf-cloud-actions";
      const loadButton = document.createElement("button"); loadButton.type = "button"; loadButton.textContent = "載入";
      loadButton.addEventListener("click", async event => {
        event.stopPropagation?.();
        loadButton.disabled = true;
        try {
          const loaded = await load(recordId);
          status("已載入「" + fileName + ".5db」，可編輯後按「儲存變更」。");
          dialog.close();
        } catch (error) { status(error.message || String(error)); }
        finally { loadButton.disabled = false; }
      });
      const dl = document.createElement("button");
      dl.type = "button"; dl.textContent = "下載";
      dl.addEventListener("click", async event => {
        event.stopPropagation?.();
        dl.disabled = true;
        try {
          const result = await fetchRecord(recordId);
          download(result.bytes, normalizeFileName(fileName, "棋譜-" + recordId) + ".5db");
        } catch (error) { status(error.message || String(error)); }
        finally { dl.disabled = false; }
      });
      const move = document.createElement("button");
      move.type = "button"; move.textContent = "移動";
      move.addEventListener("click", async event => {
        event.stopPropagation?.();
        const destination = await chooseDestination("移動「" + fileName + "」到");
        if (destination === null) return;
        move.disabled = true;
        try { await moveSelectedToFolder(dialog, [recordId], destination); }
        catch (error) { explorerNotice(dialog, error.message || String(error)); }
        finally { move.disabled = false; }
      });
      const del = document.createElement("button");
      del.type = "button"; del.textContent = "刪除";
      del.addEventListener("click", async event => {
        event.stopPropagation?.();
        if (!confirm("確定永久刪除「" + fileName + ".5db」？")) return;
        del.disabled = true;
        try {
          await remove(recordId);
          previewCache.delete(recordId);
          selectedRecordIds.delete(recordId);
          await refreshDialog(dialog);
          status("已刪除。");
        } catch (error) { status(error.message || String(error)); }
        finally { del.disabled = false; }
      });
      actions.append(loadButton, dl, move, del);
      const check = document.createElement("input");
      check.type = "checkbox";
      check.className = "vcf-cloud-select";
      check.checked = selectedRecordIds.has(recordId);
      check.setAttribute("aria-label", "選取 " + fileName);
      check.addEventListener("click", event => event.stopPropagation?.());
      check.addEventListener("change", () => selectRecord(dialog, recordId, index, {}, check.checked));
      row.addEventListener("dragstart", event => {
        if (moveBusy || event.target?.closest?.("button, input")) {
          event.preventDefault(); return;
        }
        if (!selectedRecordIds.has(recordId)) selectRecord(dialog, recordId, index, {});
        activeDrag = {
          kind: "records",
          ids: Array.from(selectedRecordIds),
          source: activeFolderId,
        };
        event.dataTransfer?.setData("text/plain", "VCF5DB_RECORDS");
        if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
      });
      row.addEventListener("dragend", () => clearCloudDrag(dialog));
      row.addEventListener("click", event => {
        if (event.target === check || event.target?.closest?.("button")) return;
        selectRecord(dialog, recordId, index, event);
      });
      row.addEventListener("keydown", event => {
        if (event.target !== row) return;
        if (event.key === " " || event.key === "Spacebar") {
          event.preventDefault();
          selectRecord(dialog, recordId, index, {ctrlKey:true});
        }
        if (event.key === "Enter") { event.preventDefault(); loadButton.click(); }
      });
      row.addEventListener("dblclick", event => {
        if (event.target?.closest?.("button, input")) return;
        loadButton.click();
      });
      const detailCount = document.createElement("div");
      detailCount.className = "vcf-cloud-detail-count";
      detailCount.textContent = String(record.record_count || 0);
      const detailSize = document.createElement("div");
      detailSize.className = "vcf-cloud-detail-size";
      detailSize.textContent = formatBytes(record.compressed_size);
      const detailDate = document.createElement("div");
      detailDate.className = "vcf-cloud-detail-date";
      detailDate.textContent = String(record.updated_at || "");
      row.append(previewBox, info, actions, check, detailCount, detailSize, detailDate);
      container.appendChild(row);
    });
    updateSelectionUI(dialog);
    if (explorerView !== "thumbnails" || !missingPreviews.length) return;
    // Older 5DB files have no compact preview. Decode only visible items, at
    // most two requests concurrently; details mode makes no preview requests.
    const queue = [];
    let inFlight = 0;
    const pump = () => {
      while (inFlight < 2 && queue.length && generation === previewGeneration) {
        const item = queue.shift();
        inFlight++;
        fetchRecord(item.record.id).then(result => {
          if (generation !== previewGeneration) return;
          const shot = global.FiveDB.preview(global.FiveDB.decode(result.bytes));
          const encoded = shot.width <= 25 && shot.height <= 25
            ? shot.width + "x" + shot.height + ":" + shot.board : "";
          if (encoded) previewCache.set(Number(item.record.id), encoded);
          showBoardThumbnail(item.previewBox, encoded);
        }).catch(() => {
          if (generation === previewGeneration) item.previewBox.textContent = "無法預覽";
        }).finally(() => { inFlight--; pump(); });
      }
    };
    if (typeof IntersectionObserver === "function") {
      const awaiting = new Map(missingPreviews.map(item => [item.previewBox, item]));
      const observer = new IntersectionObserver(entries => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const item = awaiting.get(entry.target);
          if (!item) continue;
          awaiting.delete(entry.target);
          observer.unobserve(entry.target);
          queue.push(item);
        }
        pump();
      }, { root: scroll || container, rootMargin: "100px" });
      activePreviewObserver = observer;
      for (const item of missingPreviews) observer.observe(item.previewBox);
    } else { queue.push(...missingPreviews); pump(); }
  }
  async function refreshDialog(dialog) {
    if (activePreviewObserver) { activePreviewObserver.disconnect(); activePreviewObserver = null; }
    const generation = ++previewGeneration;
    const container = dialog.querySelector("[data-list]");
    if (container) container.innerHTML = '<div class="vcf-cloud-empty">正在讀取……</div>';
    let catalog;
    try {
      catalog = await listCatalog();
      if (!Array.isArray(catalog.records) || !Array.isArray(catalog.folders))
        throw new Error("5DB 雲端列表內容不正確");
    } catch (error) {
      if (generation !== previewGeneration) return;
      const message = error.message || String(error);
      if (container) {
        container.replaceChildren();
        const failure = document.createElement("div");
        failure.className = "vcf-cloud-empty";
        failure.setAttribute("role", "alert");
        failure.textContent = "雲端棋譜讀取失敗：" + message;
        const retry = document.createElement("button");
        retry.type = "button";
        retry.className = "bb-cloud-btn";
        retry.textContent = "重新讀取";
        retry.addEventListener("click", () => { void refreshDialog(dialog); });
        container.append(failure, retry);
      }
      explorerNotice(dialog, "5DB 雲端棋譜讀取失敗：" + message);
      return;
    }
    if (generation !== previewGeneration) return;
    cloudRecords = catalog.records;
    cloudFolders = catalog.folders;
    const existing = new Set(cloudRecords.map(record => Number(record.id)));
    for (const id of Array.from(selectedRecordIds)) if (!existing.has(id)) selectedRecordIds.delete(id);
    renderFolderTree(dialog);
    renderFolderContents(dialog);
  }
  function refreshAuthUI() {
    const login = document.getElementById("vcf-shared-login"), user = document.getElementById("bb-cloud-user"), logoutButton = document.getElementById("bb-cloud-logout");
    const saveButton = document.getElementById("bb-cloud-save"), saveAsButton = document.getElementById("bb-cloud-save-as"), openButton = document.getElementById("bb-cloud-open");
    if (user) user.textContent = authUser ? (authUser.name || authUser.email) : "未登入";
    if (login) login.hidden = Boolean(authUser);
    if (logoutButton) logoutButton.hidden = !authUser;
    if (saveButton) {
      saveButton.disabled = !authUser || !global.VCFWorkbenchRecord?.workspace?.()?.mode;
      saveButton.textContent = currentCloudRecord ? "儲存變更" : "雲端儲存";
      saveButton.title = currentCloudRecord ? "覆寫目前載入的雲端棋譜，不改變檔名及資料夾" : "將完整 5DB 1.0 棋譜儲存到目前登入的協會會員帳號";
    }
    if (saveAsButton) {
      saveAsButton.hidden = !currentCloudRecord;
      saveAsButton.disabled = !authUser || !global.VCFWorkbenchRecord?.workspace?.()?.mode;
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
    const saveAsButton = document.createElement("button"); saveAsButton.id = "bb-cloud-save-as"; saveAsButton.className = "bb-cloud-btn"; saveAsButton.textContent = "另存新檔"; saveAsButton.hidden = true;
    const openButton = document.createElement("button"); openButton.id = "bb-cloud-open"; openButton.className = "bb-cloud-btn"; openButton.textContent = "我的雲端棋譜";
    accountSlot.appendChild(auth);
    panel.insertBefore(saveButton, exportStatus || null); panel.insertBefore(saveAsButton, exportStatus || null); panel.insertBefore(openButton, exportStatus || null);
    auth.querySelector("#vcf-shared-login").addEventListener("click", openSharedLogin);
    auth.querySelector("#bb-cloud-logout").addEventListener("click", () => { void logout().catch(e => status(e.message || String(e))); });
    saveButton.addEventListener("click", async () => {
      saveButton.disabled = true; status("正在儲存雲端棋譜……");
      try {
        let fileName = "";
        if (!currentCloudRecord) {
          fileName = prompt("檔案名稱（不影響棋譜標題）", defaultFileName());
          if (fileName === null) return;
        }
        const result = await saveCurrent(fileName);
        status(`${result.updated ? "已更新原雲端棋譜" : "已存入雲端棋譜"} #${result.id}：${result.recordCount} 局面${result.annotationCount ? `、${result.annotationCount} 個標記` : ''} / ${formatBytes(result.compressedSize)}`);
      } catch (e) { status(e.message || String(e)); } finally { refreshAuthUI(); }
    });
    saveAsButton.addEventListener("click", async () => {
      saveAsButton.disabled = true;
      try {
        const fileName = prompt("新檔案名稱（不影響棋譜標題）", (currentCloudRecord?.fileName || defaultFileName()) + "-副本");
        if (fileName === null) return;
        const result = await saveCurrent(fileName);
        status(`已另存新棋譜 #${result.id}：${result.recordCount} 個局面`);
      } catch (e) { status(e.message || String(e)); } finally { refreshAuthUI(); }
    });
    openButton.addEventListener("click", async () => { openButton.disabled = true; try { const dialog = ensureDialog(); dialog.showModal(); await refreshDialog(dialog); } catch (e) { status(e.message || String(e)); } finally { refreshAuthUI(); } });
    refreshAuthUI();
    void prepareGoogleLogin();
    return true;
  }

  const api = {
    API_URL, FIVE_DB_API_URL,
    publicConfig, authMe, logout, saveCurrent, saveDocument, fetchRecord, list, listCatalog, load, remove,
    createFolder, renameFolder, moveFolder, deleteFolder, moveRecord, moveRecords,
    currentBytes: null,
    get currentMeta() { return currentCloudRecord && { ...currentCloudRecord }; },
    get authUser() { return authUser; },
  };
  global.VCFCloud5DB = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof document === "undefined") return;

  installUI();
  global.addEventListener("vcf-workspace-mode-changed", event => {
    if (["new-workspace", "5db-import", "replace-position", "replace-history"].includes(event?.detail?.source))
      currentCloudRecord = null;
    refreshAuthUI();
  });
  authMe().catch(e => status(e.message || String(e)));
  global.addEventListener("focus", () => { void authMe().catch(() => {}); });
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) void authMe().catch(() => {});
  });
})(typeof window !== "undefined" ? window : globalThis);
