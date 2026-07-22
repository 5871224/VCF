"use strict";

(function initBitboardDashboard() {
  document.title = "VCF Bitboard C++ WebAssembly 工作台";
  const panel = document.createElement("section");
  panel.id = "bitboard-architecture-panel";
  panel.innerHTML = `
    <div class="bb-title-row">
      <div>
        <h1>VCF Bitboard C++ WebAssembly 工作台</h1>
        <p>原主頁功能已整合；棋型、禁手、VCF 遞迴、防守驗證與逐點掃描改由獨立 C++ Wasm 執行。</p>
      </div>
      <a class="bb-lab-link" href="rapfi/lab.html">Rapfi 官方對照／棋型實驗室</a>
    </div>
    <div class="bb-status-grid">
      <div><strong>核心</strong><span>225 位 Bitboard＋C++ Wasm SIMD128</span></div>
      <div><strong>搜尋</strong><span>純 VCF：只展開眠四、活四、成五</span></div>
      <div><strong>平行</strong><span>${window.engineAPI?.workerCount || 1} 個獨立 Wasm Worker</span></div>
      <div><strong>Rapfi</strong><span>官方程式維持原樣，只放在對照實驗室</span></div>
    </div>
    <p id="bb-engine-status" class="bb-engine-status">Bitboard 引擎初始化中……</p>
  `;

  const style = document.createElement("style");
  style.textContent = `
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
    @media (max-width: 430px) { .bb-status-grid { grid-template-columns: 1fr; } }
  `;
  document.head.appendChild(style);
  document.body.insertBefore(panel, document.body.firstChild);

  const status = panel.querySelector("#bb-engine-status");
  Promise.all([
    window.VCFBitboard?.syncReady,
    window.VCFBitboard?.main?.ready,
  ]).then(() => {
    status.className = "bb-engine-status ready";
    status.textContent = "Bitboard C++ Wasm 已就緒；所有主功能不會回退到 eval/worker.js。";
  }).catch(error => {
    status.className = "bb-engine-status error";
    status.textContent = `Bitboard 引擎初始化失敗：${error?.message || error}`;
  });
})();
