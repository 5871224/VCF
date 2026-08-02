"use strict";

(function initForbiddenOverlay(global) {
  const BOARD_CELLS = 225;
  const RENJU_RULE = 2;
  const METHOD = 0;
  const LABELS = new Map([
    [3, "6"],
    [4, "44"],
    [5, "33"],
  ]);
  const NS = "http://www.w3.org/2000/svg";
  const STORAGE_KEY = "vcf_show_forbidden";
  const WORKER_SOURCE = String.raw`
"use strict";
let moduleInstance = null;
let analyzeForbidden = null;
let boardPtr = 0;
let resultPtr = 0;

async function initialize(moduleURL) {
  importScripts(moduleURL);
  if (typeof self.VCFPatternEngine !== "function") {
    throw new Error("找不到 VCFPatternEngine");
  }
  moduleInstance = await self.VCFPatternEngine({
    locateFile: file => new URL(file, moduleURL).href,
  });
  analyzeForbidden = moduleInstance.cwrap(
    "vcfAnalyzeForbidden",
    "number",
    ["number", "number", "number", "number", "number"],
  );
  boardPtr = moduleInstance._malloc(225);
  resultPtr = moduleInstance._malloc(4);
}

function scan(board, requestId) {
  moduleInstance.HEAPU8.fill(0, boardPtr, boardPtr + 225);
  moduleInstance.HEAPU8.set(board, boardPtr);
  const items = [];

  for (let idx = 0; idx < 225; idx++) {
    if (board[idx]) continue;
    moduleInstance.HEAPU8.fill(0, resultPtr, resultPtr + 4);
    if (!analyzeForbidden(boardPtr, idx, 2, 0, resultPtr)) continue;
    if (moduleInstance.HEAPU8[resultPtr] !== 1) continue;
    const forbiddenType = moduleInstance.HEAPU8[resultPtr + 1];
    if (forbiddenType === 3 || forbiddenType === 4 || forbiddenType === 5) {
      items.push({ idx, forbiddenType });
    }
  }

  self.postMessage({ type: "result", requestId, items });
}

self.onmessage = async event => {
  const data = event.data || {};
  try {
    if (data.type === "init") {
      await initialize(data.moduleURL);
      self.postMessage({ type: "ready" });
      return;
    }
    if (data.type === "scan" && moduleInstance) {
      scan(new Uint8Array(data.board), data.requestId);
    }
  } catch (error) {
    self.postMessage({
      type: "error",
      requestId: data.requestId || 0,
      message: error && error.message ? error.message : String(error),
    });
  }
};
`;

  let layer = null;
  let checkbox = null;
  let worker = null;
  let workerReady = null;
  let workerBlobURL = "";
  let requestId = 0;
  let scheduled = false;

  function currentRule() {
    return Number(document.querySelector('input[name="rules"]:checked')?.value || RENJU_RULE);
  }

  function enabled() {
    return Boolean(checkbox?.checked) && currentRule() === RENJU_RULE;
  }

  function clearLayer() {
    if (!layer) return;
    while (layer.firstChild) layer.firstChild.remove();
  }

  function boardPosition(idx) {
    const size = 15;
    const cell = 34;
    const pad = 22;
    return {
      cx: pad + (idx % size) * cell,
      cy: pad + Math.floor(idx / size) * cell,
    };
  }

  function drawLabels(items) {
    clearLayer();
    if (!layer || !enabled()) return;

    for (const item of items) {
      const labelText = LABELS.get(item.forbiddenType);
      if (!labelText) continue;
      const { cx, cy } = boardPosition(item.idx);
      const group = document.createElementNS(NS, "g");
      const circle = document.createElementNS(NS, "circle");
      circle.setAttribute("cx", cx);
      circle.setAttribute("cy", cy);
      circle.setAttribute("r", 10.5);
      circle.setAttribute("fill", "#fff4e8");
      circle.setAttribute("fill-opacity", "0.92");
      circle.setAttribute("stroke", "#b42318");
      circle.setAttribute("stroke-width", "1.6");

      const text = document.createElementNS(NS, "text");
      text.setAttribute("x", cx);
      text.setAttribute("y", cy);
      text.setAttribute("text-anchor", "middle");
      text.setAttribute("dominant-baseline", "central");
      text.setAttribute("font-size", labelText.length === 1 ? "10" : "8.5");
      text.setAttribute("font-weight", "800");
      text.setAttribute("fill", "#b42318");
      text.textContent = labelText;

      group.append(circle, text);
      layer.appendChild(group);
    }
  }

  function ensureWorker() {
    if (workerReady) return workerReady;

    workerReady = new Promise((resolve, reject) => {
      workerBlobURL = URL.createObjectURL(new Blob([WORKER_SOURCE], { type: "text/javascript" }));
      worker = new Worker(workerBlobURL);
      worker.onmessage = event => {
        const data = event.data || {};
        if (data.type === "ready") {
          resolve();
          return;
        }
        if (data.type === "result") {
          if (data.requestId === requestId && enabled()) drawLabels(data.items || []);
          return;
        }
        if (data.type === "error") {
          console.error("禁手標示 Worker 失敗：", data.message);
          if (!data.requestId) reject(new Error(data.message || "禁手標示初始化失敗"));
        }
      };
      worker.onerror = event => reject(new Error(event.message || "禁手標示 Worker 建立失敗"));
      worker.postMessage({
        type: "init",
        moduleURL: new URL("rapfi/engine/vcf-pattern-engine.js", document.baseURI).href,
      });
    }).catch(error => {
      console.error("初始化禁手標示失敗", error);
      if (worker) worker.terminate();
      worker = null;
      workerReady = null;
      if (workerBlobURL) URL.revokeObjectURL(workerBlobURL);
      workerBlobURL = "";
      throw error;
    });

    return workerReady;
  }

  async function refreshForbidden() {
    scheduled = false;
    const currentRequest = ++requestId;
    clearLayer();
    if (!enabled() || typeof global._getArr !== "function") return;

    await ensureWorker();
    if (currentRequest !== requestId || !enabled()) return;

    const board = Uint8Array.from(global._getArr().slice(0, BOARD_CELLS));
    worker.postMessage({
      type: "scan",
      requestId: currentRequest,
      board: board.buffer,
    }, [board.buffer]);
  }

  function scheduleRefresh() {
    requestId++;
    clearLayer();
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      refreshForbidden().catch(error => {
        console.error("更新禁手標示失敗", error);
        clearLayer();
      });
    });
  }

  function installUI() {
    const svg = document.getElementById("board-svg");
    const ruleBox = document.getElementById("rule-box");
    if (!svg || !ruleBox) return false;

    layer = document.createElementNS(NS, "g");
    layer.id = "forbidden-overlay-layer";
    layer.setAttribute("pointer-events", "none");
    svg.appendChild(layer);

    const label = document.createElement("label");
    label.id = "show-forbidden-label";
    label.style.cursor = "pointer";
    checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.id = "show-forbidden";
    try {
      checkbox.checked = localStorage.getItem(STORAGE_KEY) === "1";
    } catch (_) {}
    label.append(checkbox, document.createTextNode(" 顯示禁手"));
    ruleBox.appendChild(label);

    checkbox.addEventListener("change", () => {
      try { localStorage.setItem(STORAGE_KEY, checkbox.checked ? "1" : "0"); } catch (_) {}
      scheduleRefresh();
    });

    for (const radio of document.querySelectorAll('input[name="rules"]')) {
      radio.addEventListener("change", scheduleRefresh);
    }

    global.addEventListener("vcf-board-changed", scheduleRefresh);
    global.addEventListener("vcf-rule-changed", scheduleRefresh);
    scheduleRefresh();
    return true;
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", installUI, { once: true });
  } else {
    installUI();
  }
})(window);
