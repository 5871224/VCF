"use strict";
// Removable, standalone Rapfi VCF benchmark UI. Never touches Bitboard, its Worker,
// VCF overlays, chess records or the normal busy/search dispatchers.
(function rapfiStandaloneBenchmark() {
  const button = document.getElementById("btn-rapfi-vcf-benchmark");
  const status = document.getElementById("rapfi-vcf-benchmark-status");
  const msOutput = document.getElementById("rapfi-vcf-benchmark-ms");
  const nodesOutput = document.getElementById("rapfi-vcf-benchmark-nodes");
  const npsOutput = document.getElementById("rapfi-vcf-benchmark-nps");
  const routeOutput = document.getElementById("rapfi-vcf-benchmark-route");
  if (!button || !status || !msOutput || !nodesOutput || !npsOutput || !routeOutput) return;

  const workerURL = new URL("./vcf-rapfi-vcf-worker.js", document.currentScript.src);
  workerURL.searchParams.set("v", "20261019-rapfi-deep1");
  let worker = null;
  let runningId = 0;
  let nextId = 1;
  let hasResult = false;

  const number = value => Number(value).toLocaleString("zh-TW");
  const toPoint = index =>
    String.fromCharCode(97 + index % 15) + String(Math.floor(index / 15) + 1);

  function terminate() {
    if (worker) worker.terminate();
    worker = null;
    runningId = 0;
    button.textContent = "Rapfi VCF 計算";
    button.setAttribute("aria-busy", "false");
  }

  function markStale() {
    if (runningId) {
      terminate();
      status.textContent = "盤面或規則已變更，已中止本次 Rapfi 測速";
      hasResult = false;
    } else if (hasResult) {
      status.textContent = "盤面／條件已變更，以下為上次計算數據";
    }
  }

  function finish(error, message) {
    runningId = 0;
    button.textContent = "Rapfi VCF 計算";
    button.setAttribute("aria-busy", "false");
    if (error) status.textContent = "Rapfi 搜尋失敗：" + message;
  }

  button.addEventListener("click", () => {
    if (runningId) {
      terminate();
      hasResult = false;
      status.textContent = "Rapfi VCF 已手動停止（本次不產生不完整統計）";
      return;
    }
    try {
      const board = window.VCFWorkbenchRecord?.currentBoard?.();
      if (!board || board.length !== 225) throw new Error("Rapfi 棋盤資料尚未就緒");
      if (!board.some(stone => stone === 1 || stone === 2)) {
        throw new Error("請先在棋盤上擺好棋型");
      }
      const attacker = Number(document.querySelector('input[name="acolor"]:checked')?.value);
      const rule = Number(document.getElementById("vcf-rule-select")?.value);
      if (![1, 2].includes(attacker) || ![0, 1, 2].includes(rule)) {
        throw new Error("請先選擇計算方及規則");
      }
      // 0 is the standalone Rapfi C++ ABI's explicit unlimited sentinel.
      // Never inherit the normal Bitboard search time/node limits.
      const maxNodes = 0;

      msOutput.textContent = "—";
      nodesOutput.textContent = "—";
      npsOutput.textContent = "—";
      routeOutput.textContent = "—";
      status.textContent = "正在初始化／搜尋 Rapfi VCF……（首次載入時間不列入耗時）";
      hasResult = false;

      if (!worker) {
        worker = new Worker(workerURL.href);
        worker.onmessage = event => {
          const data = event.data || {};
          if (data.id !== runningId) return;
          if (data.type === "error") {
            finish(true, data.message || "未知錯誤");
            return;
          }
          const elapsedMs = data.elapsedMicros / 1000;
          const nps = data.elapsedMicros > 0 ?
            Math.round(data.nodes * 1000000 / data.elapsedMicros) : null;
          msOutput.textContent = elapsedMs.toFixed(3) + " ms";
          nodesOutput.textContent = number(data.nodes);
          npsOutput.textContent = nps === null ? "—" : number(nps) + " 節點/秒";
          routeOutput.textContent = data.found && data.route.length ?
            data.route.map(toPoint).join(" ") : "—";
          const modeText = data.found
            ? "已找到 VCF，搜尋自然結束"
            : data.aborted
              ? "搜尋已中止，結果未定"
              : "Rapfi VCF 候選已搜尋完畢，未找到（不代表其他搜尋演算法亦無解）";
          status.textContent = modeText + "；分析" + (attacker === 1 ? "黑" : "白")
            + "、規則" + ({ 0: "自由", 1: "無禁", 2: "有禁" })[rule]
            + "；最深搜尋 " + number(data.maxPlySeen) + " 層；無時間／節點限制";
          hasResult = true;
          finish(false);
        };
        worker.onerror = event => {
          if (runningId) {
            finish(true, event.message || "獨立 Worker 載入失敗");
            terminate();
          }
        };
      }
      runningId = nextId++;
      button.textContent = "停止 Rapfi VCF";
      button.setAttribute("aria-busy", "true");
      worker.postMessage({
        id: runningId, board: Array.from(board), attacker, rule,
        maxNodes, maxPly: 224,
      });
    } catch (error) {
      status.textContent = "Rapfi VCF 無法執行：" + String(error.message || error);
    }
  });

  window.addEventListener("vcf-board-changed", markStale);
  window.addEventListener("vcf-rule-changed", markStale);
  document.getElementById("vcf-rule-select")?.addEventListener("change", markStale);
  document.querySelectorAll('input[name="acolor"]').forEach(input =>
    input.addEventListener("change", markStale));
  window.addEventListener("pagehide", terminate);
})();
