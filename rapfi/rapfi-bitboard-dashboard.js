"use strict";

(function initBitboardDashboard() {
  document.title = "VCF Bitboard C++ WebAssembly 工作台";

  const searchOptions = document.createElement("div");
  searchOptions.id = "vcf-search-options";
  searchOptions.innerHTML = `
    <label class="vcf-option-check">
      <input id="vcf-simplify-route" type="checkbox">
      精簡手順
    </label>
    <label class="vcf-option-select">
      多組剪枝：
      <select id="vcf-multi-pruning">
        <option value="fast">高速多組 VCF（集合子集）</option>
        <option value="strict">嚴格多組 VCF（完全同盤）</option>
      </select>
    </label>
    <label class="vcf-option-select">
      補子搜尋：
      <select id="vcf-add-search-mode">
        <option value="single">單組 VCF（速度）</option>
        <option value="shortest">多組 VCF（最少步）</option>
      </select>
    </label>
  `;
  const analysisBox = document.getElementById("analysis-box");
  if (analysisBox) analysisBox.insertAdjacentElement("afterend", searchOptions);

  const panel = document.createElement("section");
  panel.id = "bitboard-architecture-panel";
  panel.innerHTML = `
    <div class="bb-title-row">
      <div>
        <h1>VCF Bitboard C++ WebAssembly 工作台</h1>
        <p>單組使用固定式勝負 TT；多組可切換嚴格同盤剪枝或高速集合子集剪枝。棋型、禁手、VCF 遞迴、防守驗證與逐點掃描皆由獨立 C++ Wasm 執行。</p>
      </div>
      <a class="bb-lab-link" href="rapfi/lab.html">Rapfi 官方對照／棋型實驗室</a>
    </div>
    <div class="bb-status-grid">
      <div><strong>單組 VCF</strong><span>Rapfi 式固定 bucket TT，找到一組立即回傳</span></div>
      <div><strong>多組 VCF</strong><span>嚴格完全同盤／高速黑白集合子集兩種剪枝</span></div>
      <div><strong>多組精簡</strong><span>先以原始手順做子集去重，再精簡保留下來的路線</span></div>
      <div><strong>平行</strong><span>${window.engineAPI?.workerCount || 1} 個獨立 Wasm Worker</span></div>
    </div>
    <p id="bb-engine-status" class="bb-engine-status">Bitboard 引擎初始化中……</p>
  `;

  const style = document.createElement("style");
  style.textContent = `
    #vcf-search-options {
      display:flex; gap:12px; flex-wrap:wrap; justify-content:center; align-items:center;
      width:min(100%,1120px); padding:7px 10px; border:1px solid #bdc9b8;
      border-radius:7px; background:#f7fbf4; font-size:13px;
    }
    #vcf-search-options label { display:flex; align-items:center; gap:5px; cursor:pointer; }
    #vcf-search-options select { padding:5px 7px; border:1px solid #aaa; border-radius:5px; background:#fff; font-size:13px; }
    #bitboard-architecture-panel {
      width: min(100%, 1120px); padding: 12px 14px; border: 1px solid #8ca28e;
      border-radius: 8px; background: #f5fff6; box-shadow: 0 2px 8px #0001;
    }
    .bb-title-row { display: flex; justify-content: space-between; gap: 14px; align-items: center; flex-wrap: wrap; }
    .bb-title-row h1 { margin: 0 0 4px; font-size: 20px; color: #194c2b; }
    .bb-title-row p { margin: 0; font-size: 13px; color: #45634e; line-height: 1.5; }
    .bb-lab-link { padding: 7px 10px; border: 1px solid #39744c; border-radius: 6px; background: #fff; color: #19512d; text-decoration: none; font-size: 13px; }
    .bb-status-grid { display: grid; grid-template-columns: repeat(4, minmax(0,1fr)); gap: 7px; margin-top: 10px; }
    .bb-status-grid div { padding: 7px 9px; border-radius: 6px; background: #fff; min-width: 0; }
    .bb-status-grid strong { display: block; color: #376344; font-size: 11px; margin-bottom: 2px; }
    .bb-status-grid span { font-size: 12px; line-height: 1.4; }
    .bb-engine-status { margin: 9px 0 0; padding: 6px 9px; border-radius: 5px; background: #fff7d1; color: #6c561d; font-size: 12px; text-align: center; }
    .bb-engine-status.ready { background: #daf3e1; color: #145e2c; }
    .bb-engine-status.error { background: #ffe1de; color: #8b241d; }
    @media (max-width: 760px) { .bb-status-grid { grid-template-columns: 1fr 1fr; } }
    @media (max-width: 430px) { .bb-status-grid { grid-template-columns: 1fr; } #vcf-search-options{align-items:stretch;flex-direction:column;} }
  `;
  document.head.appendChild(style);
  document.body.insertBefore(panel, document.body.firstChild);

  const simplifyCheck = document.getElementById("vcf-simplify-route");
  const pruningSelect = document.getElementById("vcf-multi-pruning");
  const addModeSelect = document.getElementById("vcf-add-search-mode");
  try {
    simplifyCheck.checked = localStorage.getItem("vcf_simplify_route") === "1";
    pruningSelect.value = localStorage.getItem("vcf_multi_pruning") === "strict" ? "strict" : "fast";
    addModeSelect.value = localStorage.getItem("vcf_add_search_mode") === "shortest" ? "shortest" : "single";
  } catch (_) {}
  simplifyCheck.addEventListener("change", () => {
    try { localStorage.setItem("vcf_simplify_route", simplifyCheck.checked ? "1" : "0"); } catch (_) {}
  });
  pruningSelect.addEventListener("change", () => {
    try { localStorage.setItem("vcf_multi_pruning", pruningSelect.value); } catch (_) {}
  });
  addModeSelect.addEventListener("change", () => {
    try { localStorage.setItem("vcf_add_search_mode", addModeSelect.value); } catch (_) {}
  });

  const selectedPruning = () => pruningSelect.value === "strict" ? "strict" : "fast";
  const pruningName = () => selectedPruning() === "fast" ? "高速剪枝" : "嚴格剪枝";

  if (typeof setBusy === "function") {
    const originalSetBusy = setBusy;
    setBusy = function(v) {
      originalSetBusy(v);
      simplifyCheck.disabled = Boolean(v);
      pruningSelect.disabled = Boolean(v);
      addModeSelect.disabled = Boolean(v);
    };
  }

  if (typeof engine !== "undefined" && engine && typeof engine.findVCF === "function") {
    const originalFindVCF = engine.findVCF.bind(engine);
    engine.findVCF = async options => {
      const normalized = { ...options };
      normalized.mode = normalized.mode || (Number(normalized.maxVCF || 1) > 1 ? "multi" : "single");
      if (normalized.simplify == null) normalized.simplify = normalized.mode === "multi" || normalized.mode === "shortest";
      if (normalized.pruning == null && normalized.mode !== "single") normalized.pruning = selectedPruning();
      if (window.engineAPI) {
        await engine._initP;
        return (await window.engineAPI.send("findVCF", normalized)) || { winMoves: [] };
      }
      return originalFindVCF(normalized);
    };
  }

  if (typeof pool !== "undefined" && pool && typeof pool.getLevelPoints === "function") {
    const originalPoolGetLevelPoints = pool.getLevelPoints.bind(pool);
    pool.getLevelPoints = async options => {
      if (window.engineAPI) {
        await pool._initP;
        return window.engineAPI.poolGetLevelPoints({
          ...options,
          pruning: options.pruning || selectedPruning(),
          arr: Array.from(options.arr || []),
        });
      }
      return originalPoolGetLevelPoints(options);
    };
  }

  if (typeof genEngine !== "undefined" && genEngine && typeof genEngine.post === "function") {
    genEngine.findVCF = async (arr, color, maxVCF = 64, options = {}) => {
      await genEngine.ready;
      const useBitboardGeneratorMode = Boolean(window.engineAPI);
      return (await genEngine.post("findVCF", {
        arr: arr.slice(),
        color,
        maxVCF,
        mode: options.mode || (useBitboardGeneratorMode ? "shortest" : undefined),
        simplify: options.simplify ?? useBitboardGeneratorMode,
        pruning: options.pruning || selectedPruning(),
        maxDepth: Math.max(1, Number(options.maxDepth) || 200),
        maxNode: Math.max(1, Number(options.maxNode) || 5000000),
      })) || { winMoves: [], nodeCount: 0 };
    };
  }

  if (typeof doSearch === "function") {
    doSearch = async function(arr, color) {
      lastParam = { arr, color };
      setBusy(true);
      window._clearVCF();
      window._clearAnalysis();
      resetVcfGroups();
      const simplify = Boolean(simplifyCheck.checked);
      setStatus(`正在搜索 ${color===1?"黑子":"白子"} VCF${simplify ? "並精簡手順" : ""}...`);
      try {
        const t0 = performance.now();
        const info = await engine.findVCF({
          arr,
          color,
          mode: "single",
          simplify,
          maxVCF: 1,
          maxDepth: 200,
          maxNode: 5000000,
        });
        if (info && info.winMoves && info.winMoves[0] && info.winMoves[0].length) {
          lastVCFMoves = info.winMoves[0];
          window._showVCF(lastVCFMoves, color);
          const note = simplify ? "，已精簡手順" : "";
          setStatus(`${color===1?"黑子":"白子"} VCF 找到，共 ${lastVCFMoves.length} 手${note}（${elapsed(t0)}，${fmtNodes(info.nodeCount)}，${fmtRate(info.nodeCount, t0)}）`);
        } else {
          setStatus(`${color===1?"黑子":"白子"} VCF 未找到（${elapsed(t0)}，${fmtNodes(info?.nodeCount || 0)}，${fmtRate(info?.nodeCount || 0, t0)}）`);
        }
      } catch (e) {
        console.error(e);
        setStatus("搜索失敗：" + (e && e.message || String(e)));
      }
      setBusy(false);
    };
  }

  // 原頁面多組按鈕只取 20 組，也沒有執行中資訊。使用 capture listener 先接管事件，
  // 固定以 64 組／500 萬節點搜尋，並在 Worker 計算期間持續顯示已執行時間。
  const multiButton = document.getElementById("btn-multi-vcf");
  if (multiButton) {
    multiButton.addEventListener("click", async event => {
      event.preventDefault();
      event.stopImmediatePropagation();

      const arr = window._getArr();
      if (!arr.slice(0, 225).some(v => v > 0)) {
        setStatus("請先擺好棋型");
        return;
      }

      const color = getAColor();
      const cName = color === 1 ? "黑" : "白";
      const maxRoutes = 64;
      const maxDepth = 200;
      const maxNode = 5000000;
      const modeName = pruningName();
      const t0 = performance.now();
      let progressTimer = 0;

      setBusy(true);
      window._clearVCF();
      window._clearAnalysis();
      resetVcfGroups();

      const updateProgress = () => {
        const seconds = ((performance.now() - t0) / 1000).toFixed(1);
        setStatus(`搜索 ${cName} 多組 VCF（${modeName}，先去重後精簡）……已執行 ${seconds} 秒；上限 ${maxRoutes} 組／${(maxNode / 1000000).toFixed(0)} 百萬節點`);
      };

      try {
        updateProgress();
        progressTimer = window.setInterval(updateProgress, 250);
        const info = await engine.findVCF({
          arr,
          color,
          mode: "multi",
          simplify: true,
          pruning: selectedPruning(),
          maxVCF: maxRoutes,
          maxDepth,
          maxNode,
        });
        window.clearInterval(progressTimer);
        progressTimer = 0;

        const rawGroups = (info?.winMoves || []).filter(moves => moves && moves.length);
        if (!rawGroups.length) {
          const limitNotes = [];
          if (info?.aborted) limitNotes.push("已達 500 萬節點上限，搜尋未完整");
          if ((info?.vcfCount || 0) >= maxRoutes) limitNotes.push("已達 64 組上限");
          const warning = limitNotes.length ? `；${limitNotes.join("；")}` : "";
          setStatus(`${cName} VCF 未找到（${modeName}，${elapsed(t0)}，${fmtNodes(info?.nodeCount || 0)}，${fmtRate(info?.nodeCount || 0, t0)}${warning}）`);
          return;
        }

        setStatus(`後處理：${rawGroups.length} 組路線修剪活四尾步並去重……`);
        const groups = await engine.trimVCFGroups({ arr, groups: rawGroups, color });
        if (!groups) return;
        if (!groups.length) {
          setStatus(`${cName} VCF 後處理後無結果（${modeName}，${elapsed(t0)}，${fmtNodes(info?.nodeCount || 0)}）`);
          return;
        }

        vcfGroups = groups;
        vcfGroupColor = color;
        setVcfGroup(0);

        const uniqueStarts = new Set(groups.map(moves => moves[0])).size;
        const trimNote = rawGroups.length !== groups.length
          ? `，原 ${rawGroups.length} 組→修剪後 ${groups.length} 組`
          : `，共 ${groups.length} 組`;
        const limitNotes = [];
        if ((info?.vcfCount || 0) >= maxRoutes) limitNotes.push("已達 64 組上限，可能仍有其他路線");
        if (info?.aborted) limitNotes.push("已達 500 萬節點上限，搜尋未完整");
        const warning = limitNotes.length ? `；${limitNotes.join("；")}` : "";
        setStatus(`${cName} VCF（${modeName}）：${uniqueStarts} 個起點，最短 ${groups[0].length} 手${trimNote}（${elapsed(t0)}，${fmtNodes(info?.nodeCount || 0)}，${fmtRate(info?.nodeCount || 0, t0)}${warning}）`);
      } catch (error) {
        console.error(error);
        setStatus(`多組 VCF 搜索失敗：${error?.message || error}`);
      } finally {
        if (progressTimer) window.clearInterval(progressTimer);
        setBusy(false);
      }
    }, true);
  }

  if (typeof doAddVCF === "function") {
    doAddVCF = async function(arr, placeColor) {
      const color = getAColor();
      const placeName = placeColor===1 ? "黑" : "白";
      const vcfName = color===1 ? "黑" : "白";
      const searchMode = addModeSelect.value === "shortest" ? "shortest" : "single";
      const modeName = searchMode === "shortest" ? `多組 VCF／最少步／${pruningName()}` : "單組 VCF／速度";
      const lightColor = "#7799ee";
      const darkColor = "#001188";
      setBusy(true);
      window._clearAnalysis();
      try {
        setStatus(`補${placeName}逐點試下，找${vcfName} VCF（${modeName}，${pool.workerCount} 核並行）...`);
        const t0 = performance.now();
        const data = await pool.getLevelPoints({
          arr,
          color,
          placeColor,
          searchMode,
          pruning: selectedPruning(),
          simplify: searchMode === "shortest",
          maxDepth: 200,
          maxNode: 5000000,
        });
        if (!data) return;
        const { items: result, nodeCount } = data;
        if (result.length) {
          const vcfLabels = result.filter(r => r.label !== "4" && r.label !== "5").map(r => Number(r.label));
          const minL = vcfLabels.length ? Math.min(...vcfLabels) : 0;
          const maxL = vcfLabels.length ? Math.max(...vcfLabels) : 0;
          window._showAnalysisLabels(result, item => {
            if (item.label === "5") return "#ff66aa";
            if (item.label === "4") return "#c05000";
            const t = maxL === minL ? 1 : (Number(item.label) - minL) / (maxL - minL);
            return lerpColor(lightColor, darkColor, t);
          }, "#fff");
          if (vcfLabels.length) {
            const targetLength = searchMode === "shortest" ? minL : maxL;
            const ringIdx = result
              .filter(r => r.label !== "4" && r.label !== "5" && Number(r.label) === targetLength)
              .map(r => r.idx);
            window._showAnalysisRing(ringIdx, "#00ccff");
          }
          const n5 = result.filter(r => r.label === "5").length;
          const n4 = result.filter(r => r.label === "4").length;
          const nV = result.length - n5 - n4;
          const s5 = n5 ? `連五 ${n5} 個，` : "";
          const stepNote = searchMode === "shortest" && vcfLabels.length ? `，最少 ${minL} 手` : "";
          setStatus(`補${placeName}找${vcfName} VCF（${modeName}）：${s5}四 ${n4} 個，VCF ${nV} 個${stepNote}（${elapsed(t0)}，${fmtNodes(nodeCount)}，${fmtRate(nodeCount, t0)}）`);
        } else {
          window._clearAnalysis();
          setStatus(`補${placeName}找${vcfName} VCF（${modeName}）：無結果（${elapsed(t0)}，${fmtNodes(nodeCount)}，${fmtRate(nodeCount, t0)}）`);
        }
      } finally {
        setBusy(false);
      }
    };
  }

  const status = panel.querySelector("#bb-engine-status");
  Promise.all([
    window.VCFBitboard?.syncReady,
    window.VCFBitboard?.main?.ready,
  ]).then(() => {
    status.className = "bb-engine-status ready";
    status.textContent = "Bitboard C++ Wasm 已就緒；嚴格與高速多組剪枝已分開實作。";
  }).catch(error => {
    status.className = "bb-engine-status error";
    status.textContent = `Bitboard 引擎初始化失敗：${error?.message || error}`;
  });
})();
