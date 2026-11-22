"use strict";
(function initVCFBatchBenchmark(global) {
  const panel = document.getElementById("vcf-tab-panel-benchmark");
  if (!panel) return;
  const $ = id => document.getElementById(id);
  const COLS = "ABCDEFGHJKLMNOP";
  const DATASET_PREFIX = "夢幻の構想-";
  let items = [], selected = new Set(), busy = false, stopped = false, worker = null, workerId = 0;
  let pending = new Map();
  const results = new Map();
  let cloudFolders = [];
  let sourceKind = "local";
  let sortField = "order";
  let descending = false;
  const collator = new Intl.Collator("zh-Hant", { numeric: true, sensitivity: "base" });

  const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, char =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
  function label(item) {
    return item.title || "無題";
  }
  function setStatus(value) {
    $("vcf-batch-status").textContent = value;
  }
  function coordIndex(value) {
    const match = /^([A-HJ-P])(1[0-5]|[1-9])$/.exec(String(value || "").trim().toUpperCase());
    if (!match) throw new Error("座標不合法：" + value);
    return (15 - Number(match[2])) * 15 + COLS.indexOf(match[1]);
  }
  function puzzleSerial(value) {
    const raw = String(value ?? "").trim().toUpperCase();
    if (/^[0-9]+$/.test(raw) && Number.isSafeInteger(Number(raw)) && Number(raw) > 0)
      return String(Number(raw)).padStart(3, "0");
    if (/^S[0-9]+$/.test(raw) && Number.isSafeInteger(Number(raw.slice(1)))
        && Number(raw.slice(1)) > 0)
      return "S" + String(Number(raw.slice(1))).padStart(2, "0");
    throw new Error("題號不合法：" + value);
  }
  function puzzleToDocument(p) {
    const board = Array(225).fill(0);
    for (const [key, stone] of [["black", 1], ["white", 2]]) {
      if (!Array.isArray(p[key])) throw new Error("題目 #" + p.no + " 缺少 " + key);
      for (const at of p[key]) {
        const idx = coordIndex(at);
        if (board[idx]) throw new Error("題目 #" + p.no + " 重複落點 " + at);
        board[idx] = stone;
      }
    }
    if (p.first !== "黑先" && p.first !== "白先") throw new Error("題目 #" + p.no + " 缺少先手");
    const title = "第 " + puzzleSerial(p.no) + " 題｜" +
      (p.title || "無題") + "｜" + (p.section || "未分類") + "｜" + (p.author || "作者未記載");
    return {
      width: 15, height: 15, mode: "puzzle", phase: "setup",
      nextSide: p.first === "白先" ? 2 : 1, title, board, currentPath: [],
      root: { move: -1, stone: 0, text: "《夢幻の構想》 第 " + p.no + " 題；" +
        p.first + "；原書頁碼：" + (p.page || "不詳") + "。僅供個人學習；不含解答。",
        marks: [], children: [] },
    };
  }
  function normalizePuzzles(source) {
    if (!source || !Array.isArray(source.puzzles)) throw new Error("不是預期的題目 JSON（缺少 puzzles）");
    if (source.puzzles.length > 1000) throw new Error("一次最多處理 1000 題");
    const seen = new Set();
    return source.puzzles.map(p => {
      const serial = puzzleSerial(p.no);
      if (seen.has(serial)) throw new Error("題號無效或重複：" + p.no);
      seen.add(serial);
      const no = /^[0-9]+$/.test(serial) ? Number(serial) : serial;
      const doc = puzzleToDocument(p);
      global.FiveDB.validate(doc);
      return {
        key: "local:" + no, no, title: label(p), category: p.section || "",
        author: p.author || "", first: p.first, answerMoves: p.moves ?? "",
        cloudId: 0, doc, folderId: 0, fileName: DATASET_PREFIX + serial,
      };
    });
  }
  function descendants(folderId, parentId) {
    if (parentId === 0) return true;
    let current = folderId;
    const seen = new Set();
    while (current > 0 && !seen.has(current)) {
      if (current === parentId) return true;
      seen.add(current);
      const folder = cloudFolders.find(item => Number(item.id) === current);
      if (!folder) break;
      current = Number(folder.parent_id || 0);
    }
    return false;
  }
  function currentItems() {
    const term = $("vcf-batch-filter").value.trim().toLocaleLowerCase();
    const chosen = Number($("vcf-batch-folder").value || -1);
    const withChildren = $("vcf-batch-include-subfolders").checked;
    return items.filter(item => {
      if (sourceKind === "cloud" && chosen >= 0) {
        const folder = Number(item.folderId || 0);
        if (folder !== chosen && !(withChildren && descendants(folder, chosen))) return false;
      }
      return !term || [item.fileName, item.title].some(value =>
        String(value).toLocaleLowerCase().includes(term));
    }).sort((a, b) => {
      const av = sortField === "order" ? items.indexOf(a) : sortField === "folder" ? a.folderId
        : sortField === "status" ? (results.get(a.key)?.status || "")
        : sortField === "phase" ? (results.get(a.key)?.phase || "")
        : sortField === "ms" ? (results.get(a.key)?.ms ?? -1)
        : sortField === "nodes" ? (results.get(a.key)?.nodes ?? -1)
        : a[sortField] ?? "";
      const bv = sortField === "order" ? items.indexOf(b) : sortField === "folder" ? b.folderId
        : sortField === "status" ? (results.get(b.key)?.status || "")
        : sortField === "phase" ? (results.get(b.key)?.phase || "")
        : sortField === "ms" ? (results.get(b.key)?.ms ?? -1)
        : sortField === "nodes" ? (results.get(b.key)?.nodes ?? -1)
        : b[sortField] ?? "";
      const comparison = typeof av === "number" && typeof bv === "number"
        ? av - bv : collator.compare(String(av), String(bv));
      return (descending ? -1 : 1) * comparison;
    });
  }
  function updateFolderSelectors(folders) {
    cloudFolders = Array.isArray(folders) ? folders : [];
    const byParent = new Map();
    for (const folder of cloudFolders) {
      const parent = Number(folder.parent_id || 0);
      if (!byParent.has(parent)) byParent.set(parent, []);
      byParent.get(parent).push(folder);
    }
    const options = [{ id: 0, label: "根目錄" }];
    const walk = (id, depth, ancestors) => {
      const children = (byParent.get(id) || []).slice().sort((a, b) =>
        collator.compare(String(a.name), String(b.name)));
      for (const folder of children) {
        const nextId = Number(folder.id);
        if (ancestors.has(nextId)) continue;
        options.push({ id: nextId, label: "　".repeat(depth) + "📁 " + folder.name });
        walk(nextId, depth + 1, new Set([...ancestors, nextId]));
      }
    };
    walk(0, 1, new Set());
    for (const [elementId, withAll] of [["vcf-batch-folder", true], ["vcf-batch-target-folder", false]]) {
      const el = $(elementId), previous = el.value;
      el.replaceChildren();
      const entries = withAll ? [{ id: -1, label: "全部資料夾" }, ...options] : options;
      for (const entry of entries) {
        const option = document.createElement("option");
        option.value = String(entry.id);
        option.textContent = entry.label;
        el.appendChild(option);
      }
      el.value = entries.some(entry => String(entry.id) === previous) ? previous : String(withAll ? -1 : 0);
    }
  }
  async function loadFolders() {
    const cloud = global.VCFCloud5DB;
    if (!cloud?.listCatalog) throw new Error("雲端資料夾功能尚未載入，請重新整理頁面");
    await cloud.authMe();
    const catalog = await cloud.listCatalog();
    updateFolderSelectors(catalog.folders);
    if (sourceKind === "cloud") render();
    return catalog;
  }
  function syncControls() {
    $("vcf-batch-run").disabled = busy || !selected.size;
    $("vcf-batch-upload").disabled = busy || !items.some(item => selected.has(item.key) && item.doc);
    $("vcf-batch-stop").disabled = !busy;
    $("vcf-batch-csv").disabled = !results.size;
    $("vcf-batch-source").disabled = busy;
    $("vcf-batch-cloud").disabled = busy;
    $("vcf-batch-folder-refresh").disabled = busy;
    $("vcf-batch-target-folder").disabled = busy || sourceKind !== "local";
    $("vcf-batch-folder").disabled = busy || sourceKind !== "cloud";
    const visible = currentItems();
    $("vcf-batch-selected").textContent = "已選取 " + visible.filter(item => selected.has(item.key)).length
      + " / " + visible.length + " 份棋譜";
  }
  function render() {
    const visible = currentItems();
    $("vcf-batch-table-body").innerHTML = visible.map((item, index) => {
      const result = results.get(item.key);
      return "<tr><td><input type='checkbox' data-batch-id='" + escapeHtml(item.key) +
        "' " + (selected.has(item.key) ? "checked" : "") + "></td><td>" + (index + 1) +
        "</td><td>" + escapeHtml(item.fileName) + "</td><td>" + escapeHtml(item.title) +
        "</td><td>" + escapeHtml(result?.status || "") + "</td><td>" +
        escapeHtml(result?.phase || "") + "</td><td>" +
        escapeHtml(result ? result.ms.toFixed(3) : "") + "</td><td>" +
        escapeHtml(result ? result.nodes.toLocaleString("en-US") : "") + "</td></tr>";
    }).join("");
    for (const head of panel.querySelectorAll("th[data-sort]")) {
      const active = head.dataset.sort === sortField;
      head.setAttribute("aria-sort", active ? (descending ? "descending" : "ascending") : "none");
      head.title = active ? (descending ? "降冪，點擊切換升冪" : "升冪，點擊切換降冪") : "點擊排序";
    }
    syncControls();
  }
  function setItems(next, note) {
    if (busy) return;
    items = next;
    selected = new Set(items.map(item => item.key));
    results.clear();
    render();
    setStatus(note);
    $("vcf-batch-progress").value = 0;
    $("vcf-batch-progress").max = Math.max(items.length, 1);
  }
  async function loadJson(file) {
    if (!file) return;
    sourceKind = "local";
    if (file.size > 8 * 1024 * 1024) throw new Error("JSON 檔案超過 8 MB");
    if (!global.FiveDB) throw new Error("5DB 編碼器未載入");
    const content = JSON.parse(await file.text());
    const next = normalizePuzzles(content);
    setItems(next, "已載入 " + next.length + " 題；請勾選測速或匯入的題目。");
    try { await loadFolders(); } catch (_) { /* Local testing works without login. */ }
  }
  async function loadCloud() {
    const catalog = await loadFolders();
    sourceKind = "cloud";
    const next = catalog.records.map(record => ({
      key: "cloud:" + record.id, cloudId: Number(record.id),
      title: String(record.title || ""), fileName: String(record.file_name || "棋譜-" + record.id),
      folderId: Number(record.folder_id || 0), doc: null,
    }));
    setItems(next, "已讀取雲端 " + next.length + " 份棋譜，請選擇資料夾並勾選測速項目。");
  }
  async function getDocument(item) {
    if (item.doc) return item.doc;
    const cloud = global.VCFCloud5DB;
    if (!cloud?.fetchRecord) throw new Error("雲端讀取功能未就緒");
    const record = await cloud.fetchRecord(item.cloudId);
    const doc = global.FiveDB.decode(record.bytes);
    if (doc.width !== 15 || doc.height !== 15) throw new Error("批次 VCF 僅支援 15×15 棋盤");
    return doc;
  }

  async function uploadSelected() {
    const cloud = global.VCFCloud5DB;
    if (!cloud?.saveDocument) throw new Error("雲端匯入功能未就緒");
    const queue = currentItems().filter(item => item.doc && selected.has(item.key));
    if (!queue.length) throw new Error("請先選擇本機 JSON 題目");
    await cloud.authMe();
    const existing = await cloud.list();
    const destination = Number($("vcf-batch-target-folder").value || 0);
    const names = new Set(existing.filter(r => Number(r.folder_id || 0) === destination)
      .map(r => String(r.file_name || "")));
    busy = true; stopped = false; syncControls();
    let saved = 0, skipped = 0, failed = 0, done = 0;
    $("vcf-batch-progress").max = queue.length;
    $("vcf-batch-progress").value = 0;
    try {
      for (const item of queue) {
        if (stopped) break;
        try {
          if (names.has(item.fileName)) {
            skipped++;
          } else {
            await cloud.saveDocument(item.doc, item.fileName, destination);
            names.add(item.fileName);
            saved++;
          }
        } catch (error) {
          failed++;
          setStatus("第 " + item.no + " 題上傳失敗：" + (error.message || error));
          // Authentication, quota or network failures should not produce 389 repeated requests.
          break;
        }
        done++;
        $("vcf-batch-progress").value = done;
        setStatus("雲端匯入 " + done + "/" + queue.length + "；新增 " + saved +
          "、已存在 " + skipped + "、失敗 " + failed + "。");
      }
    } finally {
      busy = false; syncControls();
    }
    setStatus("雲端匯入結束：新增 " + saved + "、已存在略過 " + skipped +
      "、失敗 " + failed + (stopped ? "（已停止）" : "") +
      "。可再次按匯入繼續，已存在的題號不會重複建立。");
  }

  function closeWorker() {
    if (worker) worker.terminate();
    worker = null;
    for (const reject of pending.values()) reject(new Error("已停止測速"));
    pending.clear();
  }
  function callWorker(type, data) {
    if (!worker) return Promise.reject(new Error("Worker 未啟動"));
    return new Promise((resolve, reject) => {
      const id = ++workerId;
      pending.set(id, reject);
      const handler = event => {
        if (event.data?.id !== id) return;
        worker?.removeEventListener("message", handler);
        pending.delete(id);
        event.data.ok ? resolve(event.data.result) : reject(new Error(event.data.error || "Worker 搜尋失敗"));
      };
      worker.addEventListener("message", handler);
      worker.postMessage({ id, type, data });
    });
  }
  async function openWorker() {
    const src = document.querySelector('script[src*="vcf-bitboard-main.js"]')?.src || document.baseURI;
    const rev = new URL(src, document.baseURI).searchParams.get("v");
    const asset = path => {
      const url = new URL(path, document.baseURI);
      if (rev) url.searchParams.set("v", rev);
      return url.href;
    };
    worker = new Worker(asset("rapfi/vcf-bitboard-worker.js"));
    worker.onerror = event => {
      for (const reject of pending.values()) reject(new Error(event.message || "Worker 失敗"));
      pending.clear();
      closeWorker();
    };
    await callWorker("init", { moduleURL: asset("rapfi/engine/vcf-bitboard-engine.js"), runSmokeCheck: false });
  }
  async function runSelected() {
    const queue = currentItems().filter(item => selected.has(item.key));
    if (!queue.length) throw new Error("請先選擇題目");
    const settings = {
      rules: Number($("vcf-batch-rules").value),
      maxNode: Number($("vcf-batch-nodes").value) * 1e6,
      maxDepth: Number($("vcf-batch-depth").value),
      ttExponent: Number($("vcf-batch-tt").value),
      distanceLimited: $("vcf-batch-distance").checked,
    };
    if (![0, 1, 2].includes(settings.rules) || !Number.isSafeInteger(settings.maxNode)
        || settings.maxNode < 1 || settings.maxNode > 0xffffffff
        || !Number.isInteger(settings.maxDepth) || settings.maxDepth < 1 || settings.maxDepth > 224)
      throw new Error("搜尋參數超出允許範圍");
    busy = true; stopped = false; syncControls();
    let done = 0, found = 0;
    $("vcf-batch-progress").max = queue.length;
    $("vcf-batch-progress").value = 0;
    try {
      await openWorker();
      await callWorker("setGameRules", { rules: settings.rules });
      for (const item of queue) {
        if (stopped) break;
        setStatus("正在搜尋 " + (done + 1) + "/" + queue.length + "：" + item.title);
        const started = performance.now();
        try {
          const doc = await getDocument(item);
          // Existing cloud records may be saved on a branch, not only at root.
          const position = global.FiveDB.preview(doc);
          let side = doc.nextSide;
          if (doc.currentPath.length) {
            let node = doc.root;
            for (const childIndex of doc.currentPath) node = node.children[childIndex];
            side = 3 - node.stone;
          }
          const info = await callWorker("findVCF", {
            arr: Array.from(position.board, Number), color: side, rules: settings.rules,
            mode: "single", maxVCF: 1, ...settings,
          });
          const attempts = info.searchAttempts || [];
          const last = attempts.find(x => x.found) || attempts.at(-1);
          const hit = info.vcfCount > 0;
          results.set(item.key, {
            status: hit ? "找到 VCF" : info.aborted ? "達節點上限" : "指定範圍內未找到",
            phase: last?.name || "完整 DFS",
            ms: Number(info.elapsedMs || 0), wallMs: performance.now() - started,
            nodes: Number(info.nodeCount || 0), maxPly: Number(info.maxPly || 0),
            config: { ...settings },
            route: hit ? (info.winMoves?.[0] || []).map(index =>
              COLS[index % 15] + (15 - Math.floor(index / 15))).join(" ") : "",
          });
          if (hit) found++;
        } catch (error) {
          if (stopped) break;
          results.set(item.key, {
            status: "錯誤：" + (error.message || error), phase: "", ms: 0,
            wallMs: performance.now() - started, nodes: 0, maxPly: 0,
            config: { ...settings }, route: "",
          });
        }
        done++;
        $("vcf-batch-progress").value = done;
        setStatus("完成 " + done + "/" + queue.length + "；找到 " + found + " 題。");
        render();
      }
    } finally {
      closeWorker();
      busy = false; syncControls();
      setStatus("測速" + (stopped ? "已停止" : "完成") + "；本次 " + done +
        " 題，找到 " + found + " 題。可匯出 CSV 或更換參數重新測試。");
    }
  }
  function exportCsv() {
    const fields = ["序號", "檔名", "標題", "狀態", "搜尋階段", "引擎耗時(ms)",
      "實際耗時(ms)", "節點數", "搜尋深度", "規則", "節點上限",
      "最大深度", "同型表次方", "距離限制", "解答手順"];
    const rows = [fields];
    for (const [index, item] of currentItems().entries()) {
      const result = results.get(item.key);
      if (!result) continue;
      rows.push([index + 1, item.fileName, item.title,
        result.status, result.phase, result.ms, result.wallMs, result.nodes, result.maxPly,
        result.config.rules, result.config.maxNode, result.config.maxDepth,
        result.config.ttExponent, result.config.distanceLimited ? "是" : "否", result.route]);
    }
    const csv = "\ufeff" + rows.map(row => row.map(value => '"' +
      String(value ?? "").replace(/"/g, '""') + '"').join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url; a.download = "VCF批次測速.csv"; document.body.appendChild(a);
    a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 0);
  }
  function action(task) {
    task().catch(error => setStatus(error.message || String(error))).finally(syncControls);
  }
  $("vcf-batch-source").addEventListener("change", event => {
    const file = event.target.files?.[0];
    action(() => loadJson(file));
    event.target.value = "";
  });
  $("vcf-batch-cloud").addEventListener("click", () => action(loadCloud));
  $("vcf-batch-folder-refresh").addEventListener("click", () => action(loadFolders));
  $("vcf-batch-folder").addEventListener("change", render);
  $("vcf-batch-include-subfolders").addEventListener("change", render);
  panel.querySelector(".vcf-batch-table thead").addEventListener("click", event => {
    const header = event.target.closest("th[data-sort]");
    if (!header) return;
    const field = header.dataset.sort;
    if (field === sortField) descending = !descending;
    else { sortField = field; descending = false; }
    render();
  });
  $("vcf-batch-filter").addEventListener("input", render);
  $("vcf-batch-table-body").addEventListener("change", event => {
    const key = event.target.dataset.batchId;
    if (!key) return;
    event.target.checked ? selected.add(key) : selected.delete(key);
    syncControls();
  });
  $("vcf-batch-all").addEventListener("click", () => {
    for (const item of currentItems()) selected.add(item.key);
    render();
  });
  $("vcf-batch-none").addEventListener("click", () => {
    for (const item of currentItems()) selected.delete(item.key);
    render();
  });
  $("vcf-batch-upload").addEventListener("click", () => action(uploadSelected));
  $("vcf-batch-run").addEventListener("click", () => action(runSelected));
  $("vcf-batch-stop").addEventListener("click", () => { stopped = true; closeWorker(); setStatus("正在停止……"); });
  $("vcf-batch-csv").addEventListener("click", exportCsv);
  syncControls();
})(window);
