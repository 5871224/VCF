"use strict";

// Experimental VCF search: run the existing untouched findVCF in parallel
// on symmetric versions of the same board, and return the first result.
(function initOptimizedVCFSearchV2() {
  if (window.__optimizedVCFSearchV2Loaded) return;
  window.__optimizedVCFSearchV2Loaded = true;

  const N = 15, POINTS = 225, SYM = [0,1,2,3,4,5,6,7];
  const xy = (x, y, s) => {
    const m = N - 1;
    switch (s) {
      case 1: return [m-y, x];
      case 2: return [m-x, m-y];
      case 3: return [y, m-x];
      case 4: return [m-x, y];
      case 5: return [x, m-y];
      case 6: return [y, x];
      case 7: return [m-y, m-x];
      default: return [x, y];
    }
  };
  const inv = s => s === 1 ? 3 : s === 3 ? 1 : s;
  const mapIdx = (idx, s) => {
    if (idx < 0 || idx >= POINTS) return idx;
    const [x, y] = xy(idx % N, Math.floor(idx / N), s);
    return y * N + x;
  };
  const mapBoard = (arr, s) => {
    const out = new Array(226).fill(0); out[225] = -1;
    for (let i = 0; i < POINTS; i++) out[mapIdx(i, s)] = arr[i] || 0;
    return out;
  };
  const restoreMoves = (moves, s) => Array.from(moves || [], i => mapIdx(i, inv(s)));

  class Slot {
    constructor(index) { this.index = index; this.worker = null; this.pending = null; }
    start() {
      this.stop(false);
      this.worker = new Worker("eval/worker.js");
      this.worker.onmessage = e => {
        if (e.data?.cmd !== "resolve" || !this.pending) return;
        const p = this.pending; this.pending = null; p.resolve(e.data.param || {});
      };
      this.worker.onerror = e => {
        if (!this.pending) return;
        const p = this.pending; this.pending = null;
        p.reject(new Error(e?.message || `Worker ${this.index + 1} 執行失敗`));
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
        const p = this.pending; this.pending = null;
        if (reject) p.reject(new Error("搜尋已停止"));
        else p.resolve(null);
      }
      this.worker?.terminate(); this.worker = null;
    }
  }

  class ParallelEngine {
    constructor() {
      this.count = Math.max(2, Math.min(Number(navigator.hardwareConcurrency || 4), 4));
      this.rules = Number(document.querySelector('input[name="rules"]:checked')?.value || 2);
      this.slots = Array.from({length:this.count}, (_, i) => new Slot(i));
      this.token = 0; this.cancelCurrent = null;
      this.ready = this.init();
    }
    async init() {
      this.slots.forEach(s => s.start());
      await Promise.all(this.slots.map(s => s.send("setGameRules", {rules:this.rules})));
    }
    async reset() {
      this.token++;
      this.cancelCurrent?.(); this.cancelCurrent = null;
      this.slots.forEach(s => s.stop(false));
      this.ready = this.init();
      await this.ready;
    }
    async setRules(rules) {
      this.rules = Number(rules || 2);
      await this.ready;
      await Promise.all(this.slots.map(s => s.send("setGameRules", {rules:this.rules})));
    }
    cancel() { return this.reset(); }
    async find(arr, color) {
      await this.ready;
      const token = ++this.token, syms = SYM.slice(0, this.count);
      return new Promise((resolve, reject) => {
        let left = this.count, done = false, nodes = 0, errors = 0;
        this.cancelCurrent = () => { if (!done) { done = true; resolve(null); } };
        const finish = result => {
          if (done || token !== this.token) return;
          done = true; this.cancelCurrent = null; resolve(result);
          this.reset().catch(console.error);
        };
        syms.forEach((s, i) => {
          this.slots[i].send("findVCF", {
            arr: mapBoard(arr, s), color, maxVCF:1, maxDepth:200, maxNode:5000000
          }).then(info => {
            if (done || token !== this.token) return;
            const n = Number(info?.nodeCount || 0); nodes += n;
            const route = info?.winMoves?.[0] || [];
            if (route.length) {
              finish({winMoves:[restoreMoves(route, s)], nodeCount:n, totalCompletedNodes:nodes, workerCount:this.count});
            } else if (--left === 0) {
              finish({winMoves:[], nodeCount:nodes, totalCompletedNodes:nodes, workerCount:this.count});
            }
          }).catch(err => {
            if (done || token !== this.token) return;
            errors++; left--;
            if (left) return;
            this.cancelCurrent = null;
            if (errors === this.count) { done = true; reject(err); this.reset().catch(console.error); }
            else finish({winMoves:[], nodeCount:nodes, totalCompletedNodes:nodes, workerCount:this.count});
          });
        });
      });
    }
  }

  function boot() {
    const box = document.getElementById("btns"), status = document.getElementById("status");
    const b0 = document.getElementById("btn-black"), w0 = document.getElementById("btn-white");
    if (!box || !status || !b0 || !w0 || typeof window._getArr !== "function") return;

    const engine2 = new ParallelEngine();
    let busy = false, originalPending = null;
    const results = {original:null, optimized:null};
    const mkBtn = (id, text, color) => {
      const b = document.createElement("button");
      b.id=id; b.type="button"; b.textContent=text; b.dataset.color=color; b.className="vcf-optimized-action";
      return b;
    };
    const ob = mkBtn("btn-black-optimized", "優化找黑 VCF", 1);
    const ow = mkBtn("btn-white-optimized", "優化找白 VCF", 2);
    w0.insertAdjacentElement("afterend", ow); w0.insertAdjacentElement("afterend", ob);

    const panel = document.createElement("section");
    panel.id = "vcf-speed-comparison";
    panel.innerHTML = `<b>VCF 搜尋速度比較</b>
      <div>原版：<span id="speed-old">尚未測試</span></div>
      <div>優化版：<span id="speed-new">尚未測試</span></div>
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
    const fp = (arr,color) => `${rules()}|${color}|${arr.slice(0,POINTS).join("")}`;
    const rate = (n,s) => s<=0 ? "—" : n/s>=1e6 ? `${(n/s/1e6).toFixed(2)}M nodes/s` : n/s>=1000 ? `${(n/s/1000).toFixed(1)}K nodes/s` : `${Math.round(n/s)} nodes/s`;
    const text = r => !r ? "尚未測試" : `${r.sec.toFixed(6)}s｜${r.nodeText || fmtNodes(r.nodes)}｜${r.rateText || rate(r.nodes,r.sec)}｜${r.found?`找到 ${r.moves} 手`:"未找到"}${r.mode?`｜${r.mode}`:""}`;
    function render() {
      document.getElementById("speed-old").textContent=text(results.original);
      document.getElementById("speed-new").textContent=text(results.optimized);
      const d=document.getElementById("speed-diff"), a=results.original, b=results.optimized;
      if(!a||!b) return d.textContent="請在相同盤面與顏色分別執行兩種搜尋。";
      if(a.fp!==b.fp) return d.textContent="兩次測試的盤面、顏色或規則不同，不能直接比較。";
      if(a.found!==b.found) return d.textContent="⚠ 兩種搜尋結果不同，請保留此盤面進一步檢查。";
      const q=a.sec/b.sec;
      d.textContent=q>1.005?`優化版快 ${q.toFixed(2)} 倍`:q<.995?`優化版慢 ${(1/q).toFixed(2)} 倍`:"兩者速度接近";
      if(a.found&&a.moves!==b.moves) d.textContent+=`；路線手數 ${a.moves}／${b.moves}`;
    }

    const beginOld=color=>{
      const arr=window._getArr(); if(!arr.slice(0,POINTS).some(v=>v>0)) return;
      originalPending={color,fp:fp(arr,color),t:performance.now()};
    };
    b0.addEventListener("click",()=>beginOld(1),true); w0.addEventListener("click",()=>beginOld(2),true);
    new MutationObserver(()=>{
      if(!originalPending)return;
      const s=status.textContent||"", name=originalPending.color===1?"黑子":"白子";
      if(!s.startsWith(`${name} VCF 找到`)&&!s.startsWith(`${name} VCF 未找到`)&&!s.startsWith("搜索失敗"))return;
      const tm=s.match(/（([\d.]+)s[，）]/), nd=s.match(/，([\d.]+[MK]? nodes)/), rt=s.match(/，([\d.]+[MK]? nodes\/s)）/), mv=s.match(/共\s*(\d+)\s*手/);
      results.original={fp:originalPending.fp,sec:tm?Number(tm[1]):(performance.now()-originalPending.t)/1000,nodeText:nd?.[1]||"節點不明",rateText:rt?.[1]||"—",found:/VCF 找到/.test(s),moves:Number(mv?.[1]||0)};
      originalPending=null;render();
    }).observe(status,{childList:true,characterData:true,subtree:true});

    const oldSetBusy=window.setBusy;
    if(typeof oldSetBusy==="function"){
      const wrapped=v=>{oldSetBusy(v);ob.disabled=ow.disabled=!!v;};
      window.setBusy=wrapped; try{setBusy=wrapped}catch(_){ }
    }

    async function run(color){
      if(busy)return;
      const arr=window._getArr(); if(!arr.slice(0,POINTS).some(v=>v>0))return setStatus("請先擺好棋型");
      busy=true; const name=color===1?"黑子":"白子", fingerprint=fp(arr,color), t=performance.now();
      lastParam={arr,color};lastVCFMoves=null;resetVcfGroups();window._clearVCF();window._clearAnalysis();setBusy(true);
      setStatus(`正在以 ${engine2.count} 核對稱並行搜索 ${name} VCF...`);
      try{
        const info=await engine2.find(arr,color); if(!info){if(!busy)return;throw new Error("引擎沒有回傳結果");}
        const sec=(performance.now()-t)/1000, route=info.winMoves?.[0]||[], nodes=Number(info.nodeCount||0), found=route.length>0;
        const mode=`${info.workerCount} 核對稱並行；${found?"節點為勝出分支":"節點為完成分支合計"}`;
        if(found){lastVCFMoves=Array.from(route);window._showVCF(lastVCFMoves,color);document.getElementById("btn-block-vcf").disabled=false;}
        setStatus(`優化 ${name} VCF ${found?`找到，共 ${route.length} 手`:"未找到"}（${sec.toFixed(6)}s，${fmtNodes(nodes)}，${rate(nodes,sec)}；${mode}）`);
        results.optimized={fp:fingerprint,sec,nodes,found,moves:route.length,mode};render();
      }catch(e){console.error(e);setStatus(`優化搜索失敗：${e?.message||String(e)}`);}
      finally{busy=false;setBusy(false);}
    }
    ob.addEventListener("click",()=>run(1));ow.addEventListener("click",()=>run(2));
    document.querySelectorAll('input[name="rules"]').forEach(r=>r.addEventListener("change",()=>engine2.setRules(Number(r.value)).catch(e=>setStatus(`優化引擎切換規則失敗：${e.message}`))));
    document.getElementById("btn-stop")?.addEventListener("click",async e=>{
      if(!busy)return;e.preventDefault();e.stopImmediatePropagation();busy=false;setStatus("正在停止優化搜索...");
      try{await engine2.cancel();setStatus("已停止優化搜索");}catch(err){setStatus(`停止優化搜索失敗：${err.message}`);}finally{setBusy(false);}
    },true);
    engine2.ready.catch(e=>setStatus(`優化引擎初始化失敗：${e.message}`));
    render();
  }

  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",()=>setTimeout(boot,0),{once:true});
  else setTimeout(boot,0);
})();
