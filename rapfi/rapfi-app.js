"use strict";

const SIZE = 15;
const EMPTY = 0;
const BLACK = 1;
const WHITE = 2;

const boardElement = document.querySelector("#board");
const statusDot = document.querySelector("#statusDot");
const statusText = document.querySelector("#statusText");
const loadProgress = document.querySelector("#loadProgress");
const loadDetail = document.querySelector("#loadDetail");
const undoButton = document.querySelector("#undoButton");
const clearButton = document.querySelector("#clearButton");
const acceptButton = document.querySelector("#acceptButton");
const analyzeButton = document.querySelector("#analyzeButton");
const restartButton = document.querySelector("#restartButton");
const benchmarkButton = document.querySelector("#benchmarkButton");
const ruleSelect = document.querySelector("#ruleSelect");
const timeSelect = document.querySelector("#timeSelect");
const resultElement = document.querySelector("#result");
const consoleElement = document.querySelector("#console");
const commandForm = document.querySelector("#commandForm");
const commandInput = document.querySelector("#commandInput");
const benchmarkDetail = document.querySelector("#benchmarkDetail");

const benchmarkCells = {
  wasmFused: {
    total: document.querySelector("#wasmFusedTotal"),
    perOp: document.querySelector("#wasmFusedPerOp"),
  },
  wasmRaw: {
    total: document.querySelector("#wasmRawTotal"),
    perOp: document.querySelector("#wasmRawPerOp"),
  },
  wasmTernary: {
    total: document.querySelector("#wasmTernaryTotal"),
    perOp: document.querySelector("#wasmTernaryPerOp"),
  },
  wasmHelper: {
    total: document.querySelector("#wasmHelperTotal"),
    perOp: document.querySelector("#wasmHelperPerOp"),
  },
  wasmBinary: {
    total: document.querySelector("#wasmBinaryTotal"),
    perOp: document.querySelector("#wasmBinaryPerOp"),
  },
  jsTernary: {
    total: document.querySelector("#jsTernaryTotal"),
    perOp: document.querySelector("#jsTernaryPerOp"),
  },
  jsHelper: {
    total: document.querySelector("#jsHelperTotal"),
    perOp: document.querySelector("#jsHelperPerOp"),
  },
  jsBinary: {
    total: document.querySelector("#jsBinaryTotal"),
    perOp: document.querySelector("#jsBinaryPerOp"),
  },
  wasmPoint: {
    total: document.querySelector("#wasmPointTotal"),
    perOp: document.querySelector("#wasmPointPerOp"),
  },
};

const statElements = {
  DEPTH: document.querySelector("#depth"),
  SELDEPTH: document.querySelector("#seldepth"),
  NODES: document.querySelector("#nodes"),
  SPEED: document.querySelector("#speed"),
  EVAL: document.querySelector("#evaluation"),
  WINRATE: document.querySelector("#winrate"),
  TIME: document.querySelector("#searchTime"),
  BESTLINE: document.querySelector("#bestline"),
};

const stones = new Uint8Array(SIZE * SIZE);
const history = [];
let nextStone = BLACK;
let suggestion = -1;
let worker = null;
let engineReady = false;
let engineBusy = false;
let benchmarkBusy = false;

function stoneName(stone) {
  return stone === BLACK ? "黑棋" : "白棋";
}

function log(prefix, text) {
  const line = document.createElement("div");
  line.textContent = `${prefix} ${text}`;
  consoleElement.append(line);
  consoleElement.scrollTop = consoleElement.scrollHeight;
}

function setStatus(kind, text) {
  statusDot.className = `status-dot ${kind}`;
  statusText.textContent = text;
}

function renderPoint(index) {
  const point = boardElement.children[index];
  point.replaceChildren();
  const stone = stones[index];
  if (stone !== EMPTY) {
    const disc = document.createElement("span");
    disc.className = `stone ${stone === BLACK ? "black" : "white"}`;
    point.append(disc);
  }
  if (index === suggestion && stone === EMPTY) {
    const mark = document.createElement("span");
    mark.className = "suggestion";
    point.append(mark);
  }
}

function renderAll() {
  for (let index = 0; index < stones.length; index++) renderPoint(index);
  const locked = engineBusy || benchmarkBusy;
  undoButton.disabled = history.length === 0 || locked;
  acceptButton.disabled = suggestion < 0 || locked;
  analyzeButton.disabled = !engineReady || locked;
  benchmarkButton.disabled = !engineReady || locked;
  if (!engineBusy && !benchmarkBusy) {
    resultElement.textContent = suggestion >= 0
      ? `Rapfi 建議 ${suggestion % SIZE},${Math.floor(suggestion / SIZE)}；目前輪到${stoneName(nextStone)}。`
      : `目前輪到${stoneName(nextStone)}。`;
  }
}

function clearSuggestion() {
  const previous = suggestion;
  suggestion = -1;
  if (previous >= 0) renderPoint(previous);
}

function play(index, stone = nextStone) {
  if (engineBusy || benchmarkBusy || stones[index] !== EMPTY) return false;
  clearSuggestion();
  stones[index] = stone;
  history.push({ index, stone });
  nextStone = stone === BLACK ? WHITE : BLACK;
  renderPoint(index);
  renderAll();
  return true;
}

for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    const index = y * SIZE + x;
    const point = document.createElement("button");
    point.type = "button";
    point.className = "point";
    point.dataset.x = String(x);
    point.dataset.y = String(y);
    point.setAttribute("aria-label", `座標 ${x}, ${y}`);
    point.addEventListener("click", () => play(index));
    boardElement.append(point);
  }
}

function resetStats() {
  Object.values(statElements).forEach((element) => { element.textContent = "—"; });
}

function resetBenchmarkCells(text = "—") {
  for (const cells of Object.values(benchmarkCells)) {
    cells.total.textContent = text;
    cells.perOp.textContent = text;
  }
}

function sendCommand(command) {
  if (!worker || !engineReady) return false;
  log(">", command.replaceAll("\n", " ↵ "));
  worker.postMessage({ type: "command", data: command });
  return true;
}

function buildBoardCommand(commandName = "YXBOARD") {
  const parts = [commandName];
  for (const move of history) {
    const x = move.index % SIZE;
    const y = Math.floor(move.index / SIZE);
    const sideFlag = move.stone === nextStone ? 1 : 2;
    parts.push(`${x},${y},${sideFlag}`);
  }
  parts.push("DONE");
  return parts.join(" ");
}

function parseStatusProgress(status) {
  const match = String(status).match(/\((\d+)\/(\d+)\)/);
  if (!match) return;
  const loaded = Number(match[1]);
  const total = Number(match[2]);
  if (total > 0) {
    loadProgress.value = loaded / total;
    loadDetail.textContent = `${(loaded / 1048576).toFixed(1)} / ${(total / 1048576).toFixed(1)} MiB`;
  }
}

function formatInteger(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number.toLocaleString("zh-TW") : value;
}

function formatBenchmark(cells, ns, iterations) {
  const totalMs = ns * iterations / 1000000;
  cells.total.textContent = `${totalMs.toFixed(4)} ms`;
  cells.perOp.textContent = `${ns.toFixed(2)} ns`;
}

function parseStdout(output) {
  log("<", output);

  const infoMatch = output.match(/^INFO\s+(\S+)(?:\s+(.+))?$/);
  if (infoMatch) {
    const key = infoMatch[1];
    const value = infoMatch[2] ?? "";
    if (key === "DEPTH" || key === "SELDEPTH" || key === "EVAL" || key === "WINRATE") {
      statElements[key].textContent = value;
    } else if (key === "NODES" || key === "TOTALNODES") {
      statElements.NODES.textContent = formatInteger(value);
    } else if (key === "SPEED") {
      statElements.SPEED.textContent = `${formatInteger(value)} nodes/s`;
    } else if (key === "TOTALTIME") {
      statElements.TIME.textContent = `${formatInteger(value)} ms`;
    } else if (key === "BESTLINE") {
      statElements.BESTLINE.textContent = value || "—";
    }
    return;
  }

  const moveMatch = output.match(/^(\d+),(\d+)(?:\s|$)/);
  if (moveMatch) {
    const x = Number(moveMatch[1]);
    const y = Number(moveMatch[2]);
    const index = y * SIZE + x;
    engineBusy = false;
    if (x >= 0 && x < SIZE && y >= 0 && y < SIZE && stones[index] === EMPTY) {
      suggestion = index;
    }
    renderAll();
  }
}

function startWorker() {
  worker?.terminate();
  worker = new Worker("./rapfi-worker.js");
  engineReady = false;
  engineBusy = false;
  benchmarkBusy = false;
  analyzeButton.disabled = true;
  benchmarkButton.disabled = true;
  loadProgress.value = 0;
  loadDetail.textContent = "";
  setStatus("loading", "正在載入 Rapfi 與權重…");
  log("#", "建立 Rapfi Worker");

  worker.onmessage = (event) => {
    const { type, data } = event.data || {};
    if (type === "status") {
      parseStatusProgress(data);
      return;
    }
    if (type === "stdout") {
      parseStdout(String(data));
      return;
    }
    if (type === "stderr") {
      log("!", String(data));
      return;
    }
    if (type === "benchmark") {
      benchmarkBusy = false;
      formatBenchmark(benchmarkCells.wasmFused, data.wasmFusedNs, data.iterations);
      formatBenchmark(benchmarkCells.wasmRaw, data.wasmRawNs, data.iterations);
      formatBenchmark(benchmarkCells.wasmTernary, data.wasmTernaryNs, data.iterations);
      formatBenchmark(benchmarkCells.wasmHelper, data.wasmHelperNs, data.iterations);
      formatBenchmark(benchmarkCells.wasmBinary, data.wasmBinaryNs, data.iterations);
      formatBenchmark(benchmarkCells.jsTernary, data.jsTernaryNs, data.iterations);
      formatBenchmark(benchmarkCells.jsHelper, data.jsHelperNs, data.iterations);
      formatBenchmark(benchmarkCells.jsBinary, data.jsBinaryNs, data.iterations);
      formatBenchmark(benchmarkCells.wasmPoint, data.wasmPointNs, data.iterations);
      benchmarkDetail.textContent = `每項 ${data.iterations.toLocaleString("zh-TW")} 次，共 ${data.rounds} 輪交錯執行並顯示中位數；所有項目都在同一個 Worker、同一個瀏覽器執行。`;
      resultElement.textContent = "Rapfi、WebAssembly 查表與 JavaScript 速度比較完成。";
      renderAll();
      return;
    }
    if (type === "benchmarkError") {
      benchmarkBusy = false;
      benchmarkDetail.textContent = String(data);
      resultElement.textContent = "棋型速度比較失敗。";
      log("!", String(data));
      renderAll();
      return;
    }
    if (type === "ready") {
      engineReady = true;
      loadProgress.value = 1;
      loadDetail.textContent = "載入完成";
      setStatus("ready", "Rapfi 已就緒（單執行緒 SIMD128）");
      sendCommand("START 15");
      renderAll();
      return;
    }
    if (type === "error") {
      engineReady = false;
      engineBusy = false;
      benchmarkBusy = false;
      setStatus("error", "Rapfi 載入失敗");
      log("!", String(data));
      renderAll();
      return;
    }
    if (type === "exit") {
      engineReady = false;
      engineBusy = false;
      benchmarkBusy = false;
      setStatus("error", `Rapfi 已結束（${data}）`);
      renderAll();
    }
  };

  worker.onerror = (error) => {
    engineReady = false;
    engineBusy = false;
    benchmarkBusy = false;
    setStatus("error", "Rapfi Worker 發生錯誤");
    log("!", error.message || String(error));
    renderAll();
  };

  worker.postMessage({
    type: "init",
    data: { engineURL: new URL("./engine/rapfi-single-simd128.js", location.href).href },
  });
}

undoButton.addEventListener("click", () => {
  if (engineBusy || benchmarkBusy) return;
  clearSuggestion();
  const move = history.pop();
  if (!move) return;
  stones[move.index] = EMPTY;
  nextStone = move.stone;
  renderPoint(move.index);
  renderAll();
});

clearButton.addEventListener("click", () => {
  if (engineBusy || benchmarkBusy) return;
  stones.fill(EMPTY);
  history.length = 0;
  nextStone = BLACK;
  suggestion = -1;
  resetStats();
  renderAll();
});

acceptButton.addEventListener("click", () => {
  if (suggestion >= 0) play(suggestion);
});

analyzeButton.addEventListener("click", () => {
  if (!engineReady || engineBusy || benchmarkBusy) return;
  clearSuggestion();
  resetStats();
  engineBusy = true;
  renderAll();
  resultElement.textContent = "Rapfi 搜尋中，資訊表會隨搜尋更新…";

  sendCommand(`INFO RULE ${ruleSelect.value}`);
  sendCommand("INFO THREAD_NUM 1");
  sendCommand("INFO SHOW_DETAIL 3");
  sendCommand("INFO MAX_DEPTH 99");
  sendCommand("INFO MAX_NODE 0");
  sendCommand(`INFO TIMEOUT_TURN ${timeSelect.value}`);
  sendCommand("INFO TIMEOUT_MATCH 100000000");
  sendCommand("INFO TIME_LEFT 2147483647");
  sendCommand(buildBoardCommand("YXBOARD"));
  sendCommand("YXNBEST 1");
});

benchmarkButton.addEventListener("click", () => {
  if (!engineReady || engineBusy || benchmarkBusy) return;
  benchmarkBusy = true;
  resetBenchmarkCells("測試中…");
  benchmarkDetail.textContent = "Rapfi、三種 C++ Wasm 查表與三種 JavaScript 查表正在同一個 Worker 中交錯測量。";
  resultElement.textContent = "正在比較 WebAssembly 與 JavaScript 棋型熱路徑…";
  renderAll();
  worker.postMessage({
    type: "benchmark",
    data: {
      rule: Number(ruleSelect.value),
      iterations: 1000000,
      rounds: 9,
    },
  });
});

restartButton.addEventListener("click", () => {
  engineBusy = false;
  benchmarkBusy = false;
  engineReady = false;
  suggestion = -1;
  startWorker();
  renderAll();
});

commandForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const command = commandInput.value.trim();
  if (!command || !engineReady || engineBusy || benchmarkBusy) return;
  sendCommand(command);
  commandInput.value = "";
});

renderAll();
startWorker();
