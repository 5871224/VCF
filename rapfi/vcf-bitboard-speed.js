"use strict";

(function initBitboardSpeedComparison() {
  if (window.__bitboardSpeedComparisonLoaded) return;
  window.__bitboardSpeedComparisonLoaded = true;

  const POINTS = 225;
  const SEARCH_PLAN = [
    { maxDepth: 9, maxNode: 12000 },
    { maxDepth: 17, maxNode: 60000 },
    { maxDepth: 33, maxNode: 250000 },
    { maxDepth: 200, maxNode: 5000000 },
  ];

  function boot() {
    const actionBox = document.getElementById("btns");
    const status = document.getElementById("status");
    const normalBlack = document.getElementById("btn-black");
    const normalWhite = document.getElementById("btn-white");
    if (!actionBox || !status || !normalBlack || !normalWhite || typeof window._getArr !== "function") {
      requestAnimationFrame(boot);
      return;
    }

    const results = { normal: null, iterative: null };
    let normalPending = null;
    let normalCoreResult = null;
    let busy = false;

    function makeButton(id, text, color) {
      const button = document.createElement("button");
      button.id = id;
      button.type = "button";
      button.textContent = text;
      button.dataset.color = String(color);
      button.className = "vcf-bitboard-iterative-action";
      return button;
    }

    const iterativeBlack = makeButton("btn-black-bitboard-iterative", "漸進找黑 VCF", 1);
    const iterativeWhite = makeButton("btn-white-bitboard-iterative", "漸進找白 VCF", 2);
    normalWhite.insertAdjacentElement("afterend", iterativeWhite);
    normalWhite.insertAdjacentElement("afterend", iterativeBlack);

    const panel = document.createElement("section");
    panel.id = "vcf-bitboard-speed-comparison";
    panel.innerHTML = `
      <div class="vcf-bb-speed-title">Bitboard C++ Wasm 搜尋速度比較</div>
      <div class="vcf-bb-speed-row"><strong>完整搜尋</strong><span id="bb-speed-normal">尚未測試</span></div>
      <div class="vcf-bb-speed-row"><strong>漸進加深</strong><span id="bb-speed-iterative">尚未測試</span></div>
      <div id="bb-speed-diff" class="vcf-bb-speed-diff">請在相同盤面與顏色分別執行兩種搜尋。</div>
    `;
    status.insertAdjacentElement("afterend", panel);

    const style = document.createElement("style");
    style.textContent = `
      #vcf-app-shell .vcf-bitboard-iterative-action,.vcf-bitboard-iterative-action{color:#fff;background:#39745a;border-color:#39745a}
      #vcf-app-shell .vcf-bitboard-iterative-action:hover:not(:disabled),.vcf-bitboard-iterative-action:hover:not(:disabled){color:#fff;background:#2d6049;border-color:#2d6049}
      #vcf-bitboard-speed-comparison{width:100%;margin-top:9px;padding:9px 11px;border:1px solid #cfd8c5;border-radius:8px;background:#f7fbf4;color:#354333;font-size:12px;line-height:1.55}
      .vcf-bb-speed-title{margin-bottom:5px;font-size:13px;font-weight:700}
      .vcf-bb-speed-row{display:grid;grid-template-columns:66px minmax(0,1fr);gap:7px;align-items:start}
      .vcf-bb-speed-row span{overflow-wrap:anywhere}
      .vcf-bb-speed-diff{margin-top:5px;padding-top:5px;border-top:1px solid #dce5d5;font-weight:600}
    `;
    document.head.appendChild(style);

    const currentRules = () => Number(document.querySelector('input[name="rules"]:checked')?.value || 2);
    const fingerprint = (arr, color) => `${currentRules()}|${color}|${Array.from(arr).slice(0, POINTS).join("")}`;

    function resultText(result) {
      if (!result) return "尚未測試";
      const outcome = result.found ? `找到 ${result.moves} 手` : "未找到";
      const nodeText = typeof fmtNodes === "function" ? fmtNodes(result.nodes) : `${result.nodes} nodes`;
      const speed = result.elapsedMs > 0 ? result.nodes * 1000 / result.elapsedMs : 0;
      const speedText = speed >= 1e6
        ? `${(speed / 1e6).toFixed(2)}M nodes/s`
        : speed >= 1000 ? `${(speed / 1000).toFixed(1)}K nodes/s` : `${Math.round(speed)} nodes/s`;
      return `${(result.wallMs / 1000).toFixed(6)}s｜核心 ${result.elapsedMs.toFixed(3)}ms｜${nodeText}｜${speedText}｜${outcome}${result.passes ? `｜${result.passes} 輪` : ""}`;
    }

    function render() {
      document.getElementById("bb-speed-normal").textContent = resultText(results.normal);
      document.getElementById("bb-speed-iterative").textContent = resultText(results.iterative);
      const difference = document.getElementById("bb-speed-diff");
      if (!results.normal || !results.iterative) {
        difference.textContent = "請在相同盤面與顏色分別執行兩種搜尋。";
        return;
      }
      if (results.normal.fingerprint !== results.iterative.fingerprint) {
        difference.textContent = "兩次測試的盤面、顏色或規則不同，不能直接比較。";
        return;
      }
      if (results.normal.found !== results.iterative.found) {
        difference.textContent = "⚠ 兩種限制策略的結果不同，請保留盤面供後續檢查。";
        return;
      }
      const ratio = results.normal.wallMs / Math.max(results.iterative.wallMs, 0.001);
      difference.textContent = ratio > 1.005
        ? `漸進加深快 ${ratio.toFixed(2)} 倍`
        : ratio < 0.995 ? `漸進加深慢 ${(1 / ratio).toFixed(2)} 倍` : "兩者速度接近";
      if (results.normal.found && results.normal.moves !== results.iterative.moves) {
        difference.textContent += `；路線手數為 ${results.normal.moves}／${results.iterative.moves}`;
      }
    }

    const originalFindVCF = engine.findVCF.bind(engine);
    engine.findVCF = async options => {
      const info = await originalFindVCF(options);
      if (normalPending
          && Number(options?.color) === normalPending.color
          && Number(options?.maxVCF || 1) === 1
          && Number(options?.maxDepth || 200) === 200
          && Number(options?.maxNode || 5000000) === 5000000) {
        normalCoreResult = info;
      }
      return info;
    };

    function beginNormal(color) {
      const arr = window._getArr();
      if (!arr.slice(0, POINTS).some(value => value > 0)) return;
      normalCoreResult = null;
      normalPending = {
        color,
        fingerprint: fingerprint(arr, color),
        startedAt: performance.now(),
      };
    }

    normalBlack.addEventListener("click", () => beginNormal(1), true);
    normalWhite.addEventListener("click", () => beginNormal(2), true);

    new MutationObserver(() => {
      if (!normalPending) return;
      const text = status.textContent || "";
      const name = normalPending.color === 1 ? "黑子" : "白子";
      const complete = text.startsWith(`${name} VCF 找到`) || text.startsWith(`${name} VCF 未找到`) || text.startsWith("搜索失敗");
      if (!complete) return;
      const timeSeconds = Number(text.match(/（([\d.]+)s/)?.[1]);
      const wallMs = Number.isFinite(timeSeconds) ? timeSeconds * 1000 : performance.now() - normalPending.startedAt;
      const info = normalCoreResult || {};
      results.normal = {
        fingerprint: normalPending.fingerprint,
        wallMs,
        elapsedMs: Number(info.elapsedMs) || wallMs,
        nodes: Number(info.nodeCount) || 0,
        found: Boolean(info.winMoves?.[0]?.length) || /VCF 找到/.test(text),
        moves: Number(info.winMoves?.[0]?.length || text.match(/共\s*(\d+)\s*手/)?.[1] || 0),
      };
      normalPending = null;
      normalCoreResult = null;
      render();
    }).observe(status, { childList: true, characterData: true, subtree: true });

    async function runIterative(color) {
      if (busy) return;
      const arr = window._getArr();
      if (!arr.slice(0, POINTS).some(value => value > 0)) {
        setStatus("請先擺好棋型");
        return;
      }
      busy = true;
      setBusy(true);
      const startedAt = performance.now();
      let totalNodes = 0;
      let totalWasmMs = 0;
      let info = { winMoves: [], nodeCount: 0 };
      let completedPasses = 0;
      try {
        for (const pass of SEARCH_PLAN) {
          completedPasses++;
          setStatus(`Bitboard 漸進搜尋：第 ${completedPasses}/${SEARCH_PLAN.length} 輪，深度 ${pass.maxDepth}，節點上限 ${typeof fmtNodes === "function" ? fmtNodes(pass.maxNode) : pass.maxNode}…`);
          info = await originalFindVCF({
            arr,
            color,
            maxVCF: 1,
            maxDepth: pass.maxDepth,
            maxNode: pass.maxNode,
          });
          totalNodes += Number(info?.nodeCount || 0);
          totalWasmMs += Number(info?.elapsedMs || 0);
          if (info?.winMoves?.[0]?.length) break;
        }
        const route = info?.winMoves?.[0] || [];
        lastParam = { arr, color };
        lastVCFMoves = route.length ? route : null;
        resetVcfGroups();
        window._clearVCF();
        window._clearAnalysis();
        if (route.length) window._showVCF(route, color);
        const wallMs = performance.now() - startedAt;
        results.iterative = {
          fingerprint: fingerprint(arr, color),
          wallMs,
          elapsedMs: totalWasmMs || wallMs,
          nodes: totalNodes,
          found: Boolean(route.length),
          moves: route.length,
          passes: completedPasses,
        };
        setStatus(`${color === 1 ? "黑子" : "白子"} Bitboard 漸進搜尋${route.length ? `找到，共 ${route.length} 手` : "未找到"}（${(wallMs / 1000).toFixed(6)}s，${typeof fmtNodes === "function" ? fmtNodes(totalNodes) : `${totalNodes} nodes`}）`);
        render();
      } catch (error) {
        console.error(error);
        setStatus(`Bitboard 漸進搜尋失敗：${error?.message || error}`);
      } finally {
        busy = false;
        setBusy(false);
      }
    }

    iterativeBlack.addEventListener("click", () => runIterative(1));
    iterativeWhite.addEventListener("click", () => runIterative(2));
  }

  boot();
})();
