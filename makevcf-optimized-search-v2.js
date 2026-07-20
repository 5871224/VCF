"use strict";

// Optimized VCF search: keep one untouched full-depth search authoritative,
// and start one symmetry-transformed hedge only when the search is not already fast.
(function initOptimizedVCFSearchV2() {
  if (window.__optimizedVCFSearchV2Loaded) return;
  window.__optimizedVCFSearchV2Loaded = true;

  const N = 15;
  const POINTS = 225;
  const HEDGE_DELAY_MS = 25;
  const HEDGE_SYMMETRIES = [1, 4, 6, 3];

  const xy = (x, y, symmetry) => {
    const max = N - 1;
    switch (symmetry) {
      case 1: return [max - y, x];
      case 2: return [max - x, max - y];
      case 3: return [y, max - x];
      case 4: return [max - x, y];
      case 5: return [x, max - y];
      case 6: return [y, x];
      case 7: return [max - y, max - x];
      default: return [x, y];
    }
  };

  const inverseSymmetry = symmetry => symmetry === 1 ? 3 : symmetry === 3 ? 1 : symmetry;

  function mapIndex(idx, symmetry) {
    if (idx < 0 || idx >= POINTS) return idx;
    const [x, y] = xy(idx % N, Math.floor(idx / N), symmetry);
    return y * N + x;
  }

  function mapBoard(arr, symmetry) {
    const mapped = new Array(226).fill(0);
    mapped[225] = -1;
    for (let idx = 0; idx < POINTS; idx++) mapped[mapIndex(idx, symmetry)] = arr[idx] || 0;
    return mapped;
  }

  function restoreMoves(moves, symmetry) {
    const inverse = inverseSymmetry(symmetry);
    return Array.from(moves || [], idx => mapIndex(idx, inverse));
  }

  class WorkerSlot {
    constructor(index) {
      this.index = index;
      this.worker = null;
      this.pending = null;
    }

    start() {
      this.stop(false);
      this.worker = new Worker("eval/worker.js");
      this.worker.onmessage = event => {
        if (event.data?.cmd !== "resolve" || !this.pending) return;
        const pending = this.pending;
        this.pending = null;
        pending.resolve(event.data.param || { winMoves: [], nodeCount: 0 });
      };
      this.worker.onerror = event => {
        if (!this.pending) return;
        const pending = this.pending;
        this.pending = null;
        pending.reject(new Error(event?.message || `Worker ${this.index + 1} 執行失敗`));
      };
    }

    send(cmd, param) {
      return new Promise((resolve, reject) => {
        this.pending = { resolve, reject };
        this.worker.postMessage({ cmd, param });
      });
    }

    stop(reject = true) {
      if (this.pending) {
        const pending = this.pending;
        this.pending = null;
        if (reject) pending.reject(new Error("搜尋已停止"));
        else pending.resolve(null);
      }
      this.worker?.terminate();
      this.worker = null;
    }
  }

  class HedgedVCFEngine {
    constructor() {
      const cores = Number(navigator.hardwareConcurrency || 2);
      this.count = cores >= 4 ? 2 : 1;
      this.rules = Number(document.querySelector('input[name="rules"]:checked')?.value || 2);
      this.slots = Array.from({ length: this.count }, (_, index) => new WorkerSlot(index));
      this.token = 0;
      this.searchSequence = 0;
      this.ready = this.initialize();
    }

    async initialize() {
      this.slots.forEach(slot => slot.start());
      await Promise.all(this.slots.map(slot => slot.send("setGameRules", { rules: this.rules })));
    }

    async ensureReady() {
      await this.ready;
    }

    async reset() {
      this.token++;
      this.slots.forEach(slot => slot.stop(false));
      this.ready = this.initialize();
      await this.ready;
    }

    async setRules(rules) {
      this.rules = Number(rules || 2);
      await this.ensureReady();
      await Promise.all(this.slots.map(slot => slot.send("setGameRules", { rules: this.rules })));
    }

    async cancel() {
      await this.reset();
    }

    async find(arr, color) {
      await this.ensureReady();
      const token = ++this.token;
      const symmetry = HEDGE_SYMMETRIES[this.searchSequence++ % HEDGE_SYMMETRIES.length];

      return new Promise((resolve, reject) => {
        let done = false;
        let hedgeStarted = false;
        let hedgeTimer = null;

        const finish = result => {
          if (done || token !== this.token) return;
          done = true;
          if (hedgeTimer) clearTimeout(hedgeTimer);
          resolve(result);
          this.reset().catch(console.error);
        };

        const fail = error => {
          if (done || token !== this.token) return;
          done = true;
          if (hedgeTimer) clearTimeout(hedgeTimer);
          reject(error);
          this.reset().catch(console.error);
        };

        const searchParam = board => ({
          arr: board,
          color,
          maxVCF: 1,
          maxDepth: 200,
          maxNode: 5000000,
        });

        // Authoritative search: identical board and limits as the original button.
        this.slots[0].send("findVCF", searchParam(Array.from(arr))).then(info => {
          if (done || token !== this.token || !info) return;
          const route = info.winMoves?.[0] || [];
          finish({
            winMoves: route.length ? [Array.from(route)] : [],
            nodeCount: Number(info.nodeCount || 0),
            workerCount: this.count,
            winner: "primary",
            hedgeStarted,
            symmetry,
          });
        }).catch(fail);

        if (this.count > 1) {
          hedgeTimer = setTimeout(() => {
            if (done || token !== this.token) return;
            hedgeStarted = true;
            this.slots[1].send("findVCF", searchParam(mapBoard(arr, symmetry))).then(info => {
              if (done || token !== this.token || !info) return;
              const route = info.winMoves?.[0] || [];
              // A negative hedge result is not authoritative; wait for the primary.
              if (!route.length) return;
              finish({
                winMoves: [restoreMoves(route, symmetry)],
                nodeCount: Number(info.nodeCount || 0),
                workerCount: this.count,
                winner: "hedge",
                hedgeStarted: true,
                symmetry,
              });
            }).catch(error => console.warn("VCF hedge worker failed", error));
          }, HEDGE_DELAY_MS);
        }
      });
    }
  }

  function boot() {
    const box = document.getElementById("btns");
    const status = document.getElementById("status");
    const originalBlack = document.getElementById("btn-black");
    const originalWhite = document.getElementById("btn-white");
    if (!box || !status || !originalBlack || !originalWhite || typeof window._getArr !== "function") return;

    const optimizedEngine = new HedgedVCFEngine();
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
    panel.innerHTML = `<b>VCF 搜尋速度比較</b>
      <div>原版：<span id="speed-old">尚未測試</span></div>
      <div>優化版：<span id="speed-new">引擎預熱中</span></div>
      <div id="speed-diff">請在相同盤面與顏色分別執行兩種搜尋。</div>`;
    status.insertAdjacentElement("afterend", panel);

    const style = document.createElement("style");
    style.textContent = `
      #vcf-app-shell .vcf-optimized-action,.vcf-optimized-action{color:#fff;background:#39745a;border-color:#39745a}
      #vcf-app-shell .vcf-optimized-action:hover:not(:disabled){background:#2d6049;border-color:#2d6049}
      #vcf-speed-comparison{width:100%;margin-top:9px;padding:9px 11px;border:1px solid #cfd8c5;border-radius:8px;background:#f7fbf4;color:#354333;font-size:12px;line-height:1.55}
      #vcf-speed-comparison b{font-size:13px}#speed-diff{margin-top:5px;padding-top:5px;border-top:1px solid #dce5d5;font-weight:600}`;
    document.head.appendChild(style);

    const rules = () => Number(document.querySelector('input[name="rules"]:checked')?.value || 2);
    const fingerprint = (arr, color) => `${rules()}|${color}|${arr.slice(0, POINTS).join("")}`;
    const rate = (nodes, seconds) => seconds <= 0 ? "—"
      : nodes / seconds >= 1e6 ? `${(nodes / seconds / 1e6).toFixed(2)}M nodes/s`
      : nodes / seconds >= 1000 ? `${(nodes / seconds / 1000).toFixed(1)}K nodes/s`
      : `${Math.round(nodes / seconds)} nodes/s`;
    const resultText = result => !result ? "尚未測試"
      : `${result.seconds.toFixed(6)}s｜${result.nodeText || fmtNodes(result.nodes)}｜${result.rateText || rate(result.nodes, result.seconds)}｜${result.found ? `找到 ${result.moves} 手` : "未找到"}${result.mode ? `｜${result.mode}` : ""}`;

    function render() {
      document.getElementById("speed-old").textContent = resultText(results.original);
      if (results.optimized) document.getElementById("speed-new").textContent = resultText(results.optimized);
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
        difference.textContent = "⚠ 兩種搜尋結果不同，請保留此盤面進一步檢查。";
        return;
      }
      const ratio = original.seconds / optimized.seconds;
      difference.textContent = ratio > 1.005 ? `優化版快 ${ratio.toFixed(2)} 倍`
        : ratio < 0.995 ? `優化版慢 ${(1 / ratio).toFixed(2)} 倍`
        : "兩者速度接近";
      if (original.found && original.moves !== optimized.moves) {
        difference.textContent += `；路線手數 ${original.moves}／${optimized.moves}`;
      }
    }

    function beginOriginal(color) {
      const arr = window._getArr();
      if (!arr.slice(0, POINTS).some(value => value > 0)) return;
      originalPending = { color, fingerprint: fingerprint(arr, color), startedAt: performance.now() };
    }

    originalBlack.addEventListener("click", () => beginOriginal(1), true);
    originalWhite.addEventListener("click", () => beginOriginal(2), true);

    new MutationObserver(() => {
      if (!originalPending) return;
      const text = status.textContent || "";
      const name = originalPending.color === 1 ? "黑子" : "白子";
      if (!text.startsWith(`${name} VCF 找到`) && !text.startsWith(`${name} VCF 未找到`) && !text.startsWith("搜索失敗")) return;
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

    optimizedEngine.ensureReady().then(() => {
      setOptimizedDisabled(false);
      document.getElementById("speed-new").textContent = optimizedEngine.count > 1
        ? `尚未測試｜主 Worker 已預熱，${HEDGE_DELAY_MS}ms 後才啟動備援`
        : "尚未測試｜單 Worker 已預熱";
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
        // Initialization is deliberately excluded from the measured search time.
        await optimizedEngine.ensureReady();
        setStatus(optimizedEngine.count > 1
          ? `正在搜索 ${name} VCF；超過 ${HEDGE_DELAY_MS}ms 才啟動對稱備援...`
          : `正在以已預熱 Worker 搜索 ${name} VCF...`);
        const startedAt = performance.now();
        const info = await optimizedEngine.find(arr, color);
        if (!info) {
          if (busy) setStatus("優化搜索已停止");
          return;
        }

        const seconds = (performance.now() - startedAt) / 1000;
        const route = info.winMoves?.[0] || [];
        const nodes = Number(info.nodeCount || 0);
        const found = route.length > 0;
        const mode = info.winner === "hedge"
          ? `對稱備援勝出（延遲 ${HEDGE_DELAY_MS}ms）`
          : info.hedgeStarted
            ? "原盤主搜尋勝出（備援已啟動）"
            : "原盤主搜尋完成（未啟動備援）";

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
          await optimizedEngine.setRules(Number(radio.value));
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
      await optimizedEngine.cancel();
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
