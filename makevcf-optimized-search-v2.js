"use strict";

// Experimental VCF benchmark using one pre-warmed worker and an original-order
// first-result search. The existing VCF buttons and engine remain untouched.
(function initOriginalStyleVCFExperiment() {
  if (window.__originalStyleVCFExperimentLoaded) return;
  window.__originalStyleVCFExperimentLoaded = true;

  const POINTS = 225;

  class FirstVCFEngine {
    constructor() {
      this.rules = Number(document.querySelector('input[name="rules"]:checked')?.value || 2);
      this.worker = null;
      this.pending = null;
      this.generation = 0;
      this.ready = this.restart();
    }

    createWorker(generation) {
      const worker = new Worker("eval/worker-first-vcf.js");
      worker.onmessage = event => {
        if (generation !== this.generation || event.data?.cmd !== "resolve" || !this.pending) return;
        const pending = this.pending;
        this.pending = null;
        pending.resolve(event.data.param || null);
      };
      worker.onerror = event => {
        console.error("First VCF worker error", event);
        if (generation !== this.generation || !this.pending) return;
        const pending = this.pending;
        this.pending = null;
        pending.reject(new Error(event?.message || "優化 Worker 執行失敗"));
      };
      return worker;
    }

    post(cmd, param) {
      return new Promise((resolve, reject) => {
        this.pending = { resolve, reject };
        this.worker.postMessage({ cmd, param });
      });
    }

    async restart() {
      this.generation++;
      const generation = this.generation;
      if (this.pending) {
        const pending = this.pending;
        this.pending = null;
        pending.resolve(null);
      }
      this.worker?.terminate();
      this.worker = this.createWorker(generation);
      await this.post("setGameRules", { rules: this.rules });
    }

    async ensureReady() {
      await this.ready;
    }

    async setRules(rules) {
      this.rules = Number(rules || 2);
      await this.ensureReady();
      await this.post("setGameRules", { rules: this.rules });
    }

    async find(arr, color) {
      await this.ensureReady();
      return this.post("findFirstVCF", {
        arr: Array.from(arr),
        color,
        maxDepth: 200,
        maxNode: 5000000,
      });
    }

    async cancel() {
      this.ready = this.restart();
      await this.ready;
    }
  }

  function boot() {
    const actionBox = document.getElementById("btns");
    const status = document.getElementById("status");
    const originalBlack = document.getElementById("btn-black");
    const originalWhite = document.getElementById("btn-white");
    if (!actionBox || !status || !originalBlack || !originalWhite || typeof window._getArr !== "function") return;

    const engine = new FirstVCFEngine();
    let busy = false;
    let originalPending = null;
    const results = { original: null, optimized: null };

    function makeButton(id, text, color) {
      const button = document.createElement("button");
      button.id = id;
      button.type = "button";
      button.textContent = text;
      button.dataset.color = String(color);
      button.className = "vcf-optimized-action";
      button.disabled = true;
      return button;
    }

    const optimizedBlack = makeButton("btn-black-optimized", "優化找黑 VCF", 1);
    const optimizedWhite = makeButton("btn-white-optimized", "優化找白 VCF", 2);
    originalWhite.insertAdjacentElement("afterend", optimizedWhite);
    originalWhite.insertAdjacentElement("afterend", optimizedBlack);

    const panel = document.createElement("section");
    panel.id = "vcf-speed-comparison";
    panel.innerHTML = `
      <div class="vcf-speed-title">VCF 搜尋速度比較</div>
      <div class="vcf-speed-row"><strong>原版</strong><span id="speed-old">尚未測試</span></div>
      <div class="vcf-speed-row"><strong>優化版</strong><span id="speed-new">引擎預熱中</span></div>
      <div id="speed-diff" class="vcf-speed-difference">請在相同盤面與顏色分別執行兩種搜尋。</div>
    `;
    status.insertAdjacentElement("afterend", panel);

    const style = document.createElement("style");
    style.dataset.originalStyleVcfExperiment = "true";
    style.textContent = `
      #vcf-app-shell .vcf-optimized-action,.vcf-optimized-action{color:#fff;background:#39745a;border-color:#39745a}
      #vcf-app-shell .vcf-optimized-action:hover:not(:disabled),.vcf-optimized-action:hover:not(:disabled){color:#fff;background:#2d6049;border-color:#2d6049}
      #vcf-speed-comparison{width:100%;margin-top:9px;padding:9px 11px;border:1px solid #cfd8c5;border-radius:8px;background:#f7fbf4;color:#354333;font-size:12px;line-height:1.55}
      .vcf-speed-title{margin-bottom:5px;font-size:13px;font-weight:700}
      .vcf-speed-row{display:grid;grid-template-columns:52px minmax(0,1fr);gap:7px;align-items:start}
      .vcf-speed-row span{overflow-wrap:anywhere}
      .vcf-speed-difference{margin-top:5px;padding-top:5px;border-top:1px solid #dce5d5;font-weight:600}
    `;
    document.head.appendChild(style);

    const currentRules = () => Number(document.querySelector('input[name="rules"]:checked')?.value || 2);
    const fingerprint = (arr, color) => `${currentRules()}|${color}|${Array.from(arr).slice(0, POINTS).join("")}`;

    function rate(nodes, seconds) {
      if (!Number.isFinite(nodes) || seconds <= 0) return "—";
      const value = nodes / seconds;
      return value >= 1e6 ? `${(value / 1e6).toFixed(2)}M nodes/s`
        : value >= 1000 ? `${(value / 1000).toFixed(1)}K nodes/s`
        : `${Math.round(value)} nodes/s`;
    }

    function resultText(result) {
      if (!result) return "尚未測試";
      const nodeText = result.nodeText || fmtNodes(result.nodes);
      const rateText = result.rateText || rate(result.nodes, result.seconds);
      const outcome = result.found ? `找到 ${result.moves} 手` : "未找到";
      return `${result.seconds.toFixed(6)}s｜${nodeText}｜${rateText}｜${outcome}${result.mode ? `｜${result.mode}` : ""}`;
    }

    function render() {
      document.getElementById("speed-old").textContent = resultText(results.original);
      document.getElementById("speed-new").textContent = resultText(results.optimized);
      const difference = document.getElementById("speed-diff");
      const original = results.original;
      const optimized = results.optimized;

      if (!original || !optimized) {
        difference.textContent = "請在相同盤面與顏色分別執行兩種搜尋。";
        return;
      }
      if (original.fingerprint !== optimized.fingerprint) {
        difference.textContent = "兩次測試的盤面、顏色或規則不同，不能直接比較。";
        return;
      }
      if (original.found !== optimized.found) {
        difference.textContent = "⚠ 兩種搜尋結果不同，請保留此盤面供後續修正。";
        return;
      }

      const ratio = original.seconds / optimized.seconds;
      difference.textContent = ratio > 1.005
        ? `優化版快 ${ratio.toFixed(2)} 倍`
        : ratio < 0.995
          ? `優化版慢 ${(1 / ratio).toFixed(2)} 倍`
          : "兩者速度接近";

      if (original.found && original.moves !== optimized.moves) {
        difference.textContent += `；兩者都找到 VCF，路線手數為 ${original.moves}／${optimized.moves}`;
      }
    }

    function beginOriginal(color) {
      const arr = window._getArr();
      if (!arr.slice(0, POINTS).some(value => value > 0)) return;
      originalPending = {
        color,
        fingerprint: fingerprint(arr, color),
        startedAt: performance.now(),
      };
    }

    originalBlack.addEventListener("click", () => beginOriginal(1), true);
    originalWhite.addEventListener("click", () => beginOriginal(2), true);

    new MutationObserver(() => {
      if (!originalPending) return;
      const text = status.textContent || "";
      const name = originalPending.color === 1 ? "黑子" : "白子";
      const complete = text.startsWith(`${name} VCF 找到`) ||
        text.startsWith(`${name} VCF 未找到`) ||
        text.startsWith("搜索失敗");
      if (!complete) return;

      const timeMatch = text.match(/（([\d.]+)s[，）]/);
      const nodeMatch = text.match(/，([\d.]+[MK]? nodes)/);
      const rateMatch = text.match(/，([\d.]+[MK]? nodes\/s)）/);
      const moveMatch = text.match(/共\s*(\d+)\s*手/);
      results.original = {
        fingerprint: originalPending.fingerprint,
        seconds: timeMatch ? Number(timeMatch[1]) : (performance.now() - originalPending.startedAt) / 1000,
        nodeText: nodeMatch?.[1] || "節點不明",
        rateText: rateMatch?.[1] || "—",
        found: /VCF 找到/.test(text),
        moves: Number(moveMatch?.[1] || 0),
      };
      originalPending = null;
      render();
    }).observe(status, { childList: true, characterData: true, subtree: true });

    function setOptimizedDisabled(value) {
      optimizedBlack.disabled = Boolean(value);
      optimizedWhite.disabled = Boolean(value);
    }

    const oldSetBusy = window.setBusy;
    if (typeof oldSetBusy === "function") {
      const wrapped = value => {
        oldSetBusy(value);
        setOptimizedDisabled(value);
      };
      window.setBusy = wrapped;
      try { setBusy = wrapped; } catch (_) {}
    }

    engine.ensureReady().then(() => {
      setOptimizedDisabled(false);
      document.getElementById("speed-new").textContent = "尚未測試｜單 Worker 已預熱";
    }).catch(error => {
      console.error(error);
      document.getElementById("speed-new").textContent = "優化引擎初始化失敗";
    });

    async function run(color) {
      if (busy) return;
      const arr = window._getArr();
      if (!arr.slice(0, POINTS).some(value => value > 0)) {
        setStatus("請先擺好棋型");
        return;
      }

      busy = true;
      const name = color === 1 ? "黑子" : "白子";
      const currentFingerprint = fingerprint(arr, color);
      lastParam = { arr, color };
      lastVCFMoves = null;
      resetVcfGroups();
      window._clearVCF();
      window._clearAnalysis();
      setBusy(true);

      try {
        await engine.ensureReady();
        setStatus(`正在以原版順序、找到即停方式搜索 ${name} VCF...`);
        const startedAt = performance.now();
        const info = await engine.find(arr, color);
        if (!info) {
          if (busy) setStatus("優化搜索已停止");
          return;
        }

        const seconds = (performance.now() - startedAt) / 1000;
        const route = info.winMoves?.[0] || [];
        const nodes = Number(info.nodeCount || 0);
        const found = route.length > 0;
        const completedStates = Number(info.completedStates || 0);
        const mode = `原版順序・找到即停；完成局面 ${completedStates}`;

        if (found) {
          lastVCFMoves = Array.from(route);
          window._showVCF(lastVCFMoves, color);
          document.getElementById("btn-block-vcf").disabled = false;
        }

        setStatus(`優化 ${name} VCF ${found ? `找到，共 ${route.length} 手` : "未找到"}（${seconds.toFixed(6)}s，${fmtNodes(nodes)}，${rate(nodes, seconds)}；${mode}）`);
        results.optimized = {
          fingerprint: currentFingerprint,
          seconds,
          nodes,
          found,
          moves: route.length,
          mode,
        };
        render();
      } catch (error) {
        console.error(error);
        setStatus(`優化搜索失敗：${error?.message || String(error)}`);
      } finally {
        busy = false;
        setBusy(false);
      }
    }

    optimizedBlack.addEventListener("click", () => run(1));
    optimizedWhite.addEventListener("click", () => run(2));

    document.querySelectorAll('input[name="rules"]').forEach(radio => {
      radio.addEventListener("change", async () => {
        if (busy) return;
        setOptimizedDisabled(true);
        try {
          await engine.setRules(Number(radio.value));
        } finally {
          setOptimizedDisabled(false);
        }
      });
    });

    document.getElementById("btn-stop")?.addEventListener("click", async event => {
      if (!busy) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      busy = false;
      setStatus("正在停止優化搜索...");
      await engine.cancel();
      setBusy(false);
      setStatus("已停止優化搜索");
    }, true);

    render();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => setTimeout(boot, 0), { once: true });
  } else {
    setTimeout(boot, 0);
  }
})();
