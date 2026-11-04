"use strict";
// Rapfi 搜尋維持專屬 Worker/WASM；只把結果整合到棋盤下方的共用狀態列。
(function rapfiStandaloneBenchmark() {
  const button = document.getElementById("btn-rapfi-vcf-benchmark");
  const statusLine = document.getElementById("status");
  if (!button || !statusLine) return;

  const workerURL = new URL("./vcf-rapfi-vcf-worker.js", document.currentScript.src);
  workerURL.searchParams.set("v", "20261019-rapfi-deep1");
  let worker = null;
  let runningId = 0;
  let nextId = 1;

  const number = value => Number(value).toLocaleString("zh-TW");
  const toPoint = index => String.fromCharCode(97 + index % 15) + String(Math.floor(index / 15) + 1);
  const report = message => {
    if (typeof window.setStatus === "function") window.setStatus(message);
    else statusLine.textContent = message;
  };
  const stats = data => {
    const elapsedMs = Math.max(0, Number(data.elapsedMicros || 0) / 1000);
    const nodeCount = Math.max(0, Number(data.nodes || 0));
    return typeof window.vcfFormatPureEngineStats === "function"
      ? window.vcfFormatPureEngineStats({ elapsedMs, nodeCount })
      : `${(elapsedMs / 1000).toFixed(4)} 秒，${number(nodeCount)} 節點，${number(elapsedMs > 0 ? Math.round(nodeCount * 1000 / elapsedMs) : 0)} 節點/秒`;
  };

  function terminate() {
    if (worker) worker.terminate();
    worker = null;
    runningId = 0;
    button.textContent = "Rapfi VCF 計算";
    button.setAttribute("aria-busy", "false");
  }

  function markStale() {
    button.title = "";
    if (!runningId) return;
    terminate();
    report("盤面、攻方或規則已變更，Rapfi VCF 搜尋已中止");
  }

  button.addEventListener("click", () => {
    if (runningId) {
      terminate();
      report("Rapfi VCF 已手動停止，未取得完整搜尋結果");
      return;
    }
    try {
      const board = window.VCFWorkbenchRecord?.currentBoard?.();
      if (!board || board.length !== 225) throw new Error("Rapfi 棋盤資料尚未就緒");
      if (!board.some(stone => stone === 1 || stone === 2)) throw new Error("請先在棋盤上擺好棋型");
      const attacker = Number(document.querySelector('input[name="acolor"]:checked')?.value);
      const rule = Number(document.getElementById("vcf-rule-select")?.value);
      if (![1, 2].includes(attacker) || ![0, 1, 2].includes(rule)) {
        throw new Error("請先選擇計算方及規則");
      }

      // maxNodes=0 是獨立 Rapfi C++ ABI 的無上限參數。
      const maxNodes = 0;
      button.title = "";
      report("Rapfi VCF 正在初始化／搜尋……（初始化時間不列入耗時）");
      if (!worker) {
        worker = new Worker(workerURL.href);
        worker.onmessage = event => {
          const data = event.data || {};
          if (data.id !== runningId) return;
          if (data.type === "error") {
            report("Rapfi VCF 搜尋失敗：" + (data.message || "未知錯誤"));
            terminate();
            return;
          }
          const resultText = data.found
            ? "已找到 VCF"
            : data.aborted
              ? "搜尋已中止，結果未定"
              : "候選已搜尋完畢，未找到（不代表其他演算法無解）";
          const route = data.found && data.route?.length ? data.route.map(toPoint).join(" ") : "";
          button.title = route ? "Rapfi VCF 手順：" + route : "";
          report(`Rapfi VCF ${resultText}（${stats(data)}）；分析${attacker === 1 ? "黑" : "白"}，規則${({ 0: "自由", 1: "無禁", 2: "有禁" })[rule]}，最深 ${number(data.maxPlySeen)} 層`);
          runningId = 0;
          button.textContent = "Rapfi VCF 計算";
          button.setAttribute("aria-busy", "false");
        };
        worker.onerror = event => {
          if (!runningId) return;
          report("Rapfi VCF 搜尋失敗：" + (event.message || "專屬 Worker 載入失敗"));
          terminate();
        };
      }
      runningId = nextId++;
      button.textContent = "停止 Rapfi VCF";
      button.setAttribute("aria-busy", "true");
      worker.postMessage({ id: runningId, board: Array.from(board), attacker, rule, maxNodes, maxPly: 224 });
    } catch (error) {
      report("Rapfi VCF 無法執行：" + String(error.message || error));
    }
  });

  window.addEventListener("vcf-board-changed", markStale);
  window.addEventListener("vcf-rule-changed", markStale);
  document.getElementById("vcf-rule-select")?.addEventListener("change", markStale);
  document.querySelectorAll('input[name="acolor"]').forEach(input =>
    input.addEventListener("change", markStale));
  window.addEventListener("pagehide", terminate);
})();
