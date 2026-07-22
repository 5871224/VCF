"use strict";

const SIZE = 15;
const EMPTY = 0;
const BLACK = 1;
const WHITE = 2;

const PATTERN_NAMES = [
  "DEAD", "OL", "B1", "F1", "B2", "F2", "F2A", "F2B",
  "B3", "F3", "F3S", "B4", "F4", "F5",
];
const PATTERN_ZH = [
  "死型", "長連／同線雙四", "眠一", "活一", "眠二", "活二", "跳活二", "強活二",
  "眠三", "活三", "強活三", "眠四", "活四", "五連",
];
const PATTERN4_NAMES = [
  "NONE", "FORBID", "L_FLEX2", "K_BLOCK3", "J_FLEX2_2X", "I_BLOCK3_PLUS",
  "H_FLEX3", "G_FLEX3_PLUS", "F_FLEX3_2X", "E_BLOCK4", "D_BLOCK4_PLUS",
  "C_BLOCK4_FLEX3", "B_FLEX4", "A_FIVE",
];
const PATTERN4_ZH = [
  "無顯著棋型", "禁手候選", "活二", "眠三", "雙活二", "眠三複合",
  "活三", "活三複合", "雙活三", "眠四", "眠四複合", "四三", "活四／雙眠四", "成五",
];
const FORBIDDEN_TYPES = [
  "不適用", "合法", "合法正五", "長連禁手", "四四禁手", "三三禁手", "假禁手", "不可落子",
];
const DIRECTION_NAMES = ["橫向", "縱向", "左上－右下", "左下－右上"];
const CPP_METHOD_NAMES = [
  "C++ Wasm：三進位 key 已維護",
  "C++ Wasm：兩張 1024 輔助表",
  "C++ Wasm：二進位 2^20 大表",
];

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
const compareTitle = document.querySelector("#compareTitle");
const compareStatus = document.querySelector("#compareStatus");
const compareBody = document.querySelector("#patternCompareBody");

const benchmarkCells = {
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
let hoveredIndex = -1;
let worker = null;
let engineReady = false;
let engineBusy = false;
let benchmarkBusy = false;
let hoverTimer = 0;
let inspectRequestId = 0;
let boardVersion = 0;

function stoneName(stone) {
  return stone === BLACK ? "黑棋" : "白棋";
}

function coordinateName(idx) {
  return `${String.fromCharCode(65 + (idx % SIZE))}${Math.floor(idx / SIZE) + 1}`;
}

function patternLabel(code) {
  return Number.isInteger(code) && PATTERN_NAMES[code]
    ? `${PATTERN_NAMES[code]}／${PATTERN_ZH[code]}`
    : "—";
}

function pattern4Label(code) {
  return Number.isInteger(code) && PATTERN4_NAMES[code]
    ? `${PATTERN4_NAMES[code]}／${PATTERN4_ZH[code]}`
    : "—";
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
  point.classList.toggle("hovered", index === hoveredIndex);
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

function resetComparison(message = "將滑鼠移到空點，查看落子後的四方向棋型與禁手判斷。") {
  compareTitle.textContent = "空點棋型比較";
  compareStatus.className = "compare-status neutral";
  compareStatus.textContent = message;
  compareBody.replaceChildren();
}

function markBoardChanged() {
  boardVersion++;
  inspectRequestId++;
  clearTimeout(hoverTimer);
  resetComparison();
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
  markBoardChanged();
  renderPoint(index);
  renderAll();
  return true;
}

function scheduleInspect(index) {
  if (index < 0 || stones[index] !== EMPTY) return;
  hoveredIndex = index;
  renderAll();
  clearTimeout(hoverTimer);
  hoverTimer = setTimeout(() => inspectPoint(index), 80);
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
    point.addEventListener("mouseenter", () => scheduleInspect(index));
    point.addEventListener("focus", () => scheduleInspect(index));
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

function positionKey(rule, side) {
  let key = `${boardVersion}:${rule}:${side}:`;
  for (let i = 0; i < stones.length; i++) key += stones[i];
  return key;
}

function inspectPoint(index) {
  if (!engineReady || engineBusy || benchmarkBusy || stones[index] !== EMPTY) return;
  const requestId = ++inspectRequestId;
  const rule = Number(ruleSelect.value);
  compareTitle.textContent = `${coordinateName(index)} 落下${stoneName(nextStone)}後`;
  compareStatus.className = "compare-status loading";
  compareStatus.textContent = "C++ Wasm 與官方 Rapfi 判斷中…";
  worker.postMessage({
    type: "inspect",
    data: {
      requestId,
      board: Array.from(stones),
      idx: index,
      side: nextStone,
      rule,
      positionKey: positionKey(rule, nextStone),
      boardCommand: buildBoardCommand("YXBOARD"),
    },
  });
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
    if (x >= 0 && x < SIZE && y >= 0 && y < SIZE && stones[index] === EMPTY) suggestion = index;
    renderAll();
  }
}

function sameCppResult(a, b) {
  return a.pattern4 === b.pattern4
    && a.forbidden === b.forbidden
    && a.forbiddenType === b.forbiddenType
    && a.directions.every((value, index) => value === b.directions[index]);
}

function addCell(row, text, className = "") {
  const cell = document.createElement("td");
  cell.textContent = text;
  if (className) cell.className = className;
  row.append(cell);
}

function renderInspection(data) {
  if (data.requestId !== inspectRequestId) return;
  const baseline = data.cppResults[0];
  const cppAllMatch = data.cppResults.every((item) => sameCppResult(item, baseline));
  compareBody.replaceChildren();

  data.cppResults.forEach((item, methodIndex) => {
    const row = document.createElement("tr");
    addCell(row, CPP_METHOD_NAMES[methodIndex], "method-cell");
    item.directions.forEach((pattern, direction) => {
      const matches = pattern === baseline.directions[direction];
      addCell(row, patternLabel(pattern), matches ? "match" : "mismatch");
    });
    addCell(row, pattern4Label(item.pattern4), item.pattern4 === baseline.pattern4 ? "match" : "mismatch");
    const forbidText = item.forbidden
      ? `是／${FORBIDDEN_TYPES[item.forbiddenType] ?? "禁手"}`
      : `否／${FORBIDDEN_TYPES[item.forbiddenType] ?? "合法"}`;
    addCell(row, forbidText,
      item.forbidden === baseline.forbidden && item.forbiddenType === baseline.forbiddenType
        ? "match" : "mismatch");
    addCell(row, methodIndex === 0 ? "比較基準" : sameCppResult(item, baseline) ? "一致" : "有差異",
      methodIndex === 0 || sameCppResult(item, baseline) ? "match" : "mismatch");
    compareBody.append(row);
  });

  const rapfiRow = document.createElement("tr");
  rapfiRow.className = "rapfi-row";
  addCell(rapfiRow, "Rapfi 官方", "method-cell");
  DIRECTION_NAMES.forEach(() => addCell(rapfiRow, "官方協定未提供", "unavailable"));
  const p4Comparable = Number.isInteger(data.rapfi.pattern4);
  const p4Match = p4Comparable && data.rapfi.pattern4 === baseline.pattern4;
  addCell(rapfiRow, p4Comparable ? pattern4Label(data.rapfi.pattern4) : "未取得",
    p4Match ? "match" : "mismatch");

  let forbidText = "不適用";
  let forbidMatch = true;
  if (data.rapfi.forbiddenApplicable) {
    forbidText = data.rapfi.forbidden ? "是／官方禁手" : "否／官方合法";
    forbidMatch = data.rapfi.forbidden === baseline.forbidden;
  }
  addCell(rapfiRow, forbidText, forbidMatch ? "match" : "mismatch");
  const rapfiParts = [p4Match ? "Pattern4 一致" : "Pattern4 有差異"];
  if (data.rapfi.forbiddenApplicable) rapfiParts.push(forbidMatch ? "禁手一致" : "禁手有差異");
  rapfiParts.push("方向不可比較");
  addCell(rapfiRow, rapfiParts.join("；"), p4Match && forbidMatch ? "partial-match" : "mismatch");
  compareBody.append(rapfiRow);

  compareTitle.textContent = `${coordinateName(data.idx)} 落下${stoneName(data.side)}後`;
  const officialComparable = p4Match && forbidMatch;
  compareStatus.className = `compare-status ${cppAllMatch && officialComparable ? "ok" : "warning"}`;
  compareStatus.textContent = cppAllMatch
    ? `三種 C++ Wasm 完全一致；Rapfi ${officialComparable ? "Pattern4／禁手一致" : "存在差異"}。Rapfi 官方協定沒有逐方向 Pattern2x 輸出。`
    : "三種 C++ Wasm 出現差異，請以紅色欄位定位。";
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
  setStatus("loading", "正在載入官方 Rapfi 與獨立 C++ Wasm 棋型模組…");
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
    if (type === "inspect") {
      renderInspection(data);
      return;
    }
    if (type === "inspectError") {
      if (data.requestId !== inspectRequestId) return;
      compareStatus.className = "compare-status warning";
      compareStatus.textContent = `棋型比較失敗：${data.message}`;
      return;
    }
    if (type === "benchmark") {
      benchmarkBusy = false;
      formatBenchmark(benchmarkCells.wasmTernary, data.wasmTernaryNs, data.iterations);
      formatBenchmark(benchmarkCells.wasmHelper, data.wasmHelperNs, data.iterations);
      formatBenchmark(benchmarkCells.wasmBinary, data.wasmBinaryNs, data.iterations);
      formatBenchmark(benchmarkCells.jsTernary, data.jsTernaryNs, data.iterations);
      formatBenchmark(benchmarkCells.jsHelper, data.jsHelperNs, data.iterations);
      formatBenchmark(benchmarkCells.jsBinary, data.jsBinaryNs, data.iterations);
      benchmarkDetail.textContent = `每項 ${data.iterations.toLocaleString("zh-TW")} 次，共 ${data.rounds} 輪交錯執行並顯示中位數。C++ Wasm 使用真正 14 種棋型表；JS 列仍是相同尺寸的查表速度基準。`;
      resultElement.textContent = "C++ Wasm 與 JavaScript 查表速度比較完成。";
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
      loadDetail.textContent = "載入完成；三種棋型表自我檢查 0 差異";
      setStatus("ready", "Rapfi 與 C++ Wasm 棋型模組已就緒");
      sendCommand("START 15");
      renderAll();
      return;
    }
    if (type === "error") {
      engineReady = false;
      engineBusy = false;
      benchmarkBusy = false;
      setStatus("error", "引擎載入失敗");
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
    setStatus("error", "Worker 發生錯誤");
    log("!", error.message || String(error));
    renderAll();
  };

  worker.postMessage({
    type: "init",
    data: {
      engineURL: new URL("./engine/rapfi-single-simd128.js", location.href).href,
      patternURL: new URL("./engine/vcf-pattern-engine.js", location.href).href,
    },
  });
}

undoButton.addEventListener("click", () => {
  if (engineBusy || benchmarkBusy) return;
  clearSuggestion();
  const move = history.pop();
  if (!move) return;
  stones[move.index] = EMPTY;
  nextStone = move.stone;
  markBoardChanged();
  renderAll();
});

clearButton.addEventListener("click", () => {
  if (engineBusy || benchmarkBusy) return;
  stones.fill(EMPTY);
  history.length = 0;
  nextStone = BLACK;
  suggestion = -1;
  hoveredIndex = -1;
  resetStats();
  markBoardChanged();
  renderAll();
});

acceptButton.addEventListener("click", () => {
  if (suggestion >= 0) play(suggestion);
});

ruleSelect.addEventListener("change", () => {
  inspectRequestId++;
  resetComparison("規則已變更，將滑鼠移到空點重新分析。");
  if (hoveredIndex >= 0 && stones[hoveredIndex] === EMPTY) scheduleInspect(hoveredIndex);
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
  benchmarkDetail.textContent = "真正 14 種 C++ Wasm 棋型表與 JavaScript 查表基準正在同一個 Worker 中依序測量。";
  resultElement.textContent = "正在比較 C++ Wasm 與 JavaScript 查表速度…";
  renderAll();
  worker.postMessage({
    type: "benchmark",
    data: {
      rule: Number(ruleSelect.value),
      side: nextStone,
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
  inspectRequestId++;
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

resetComparison();
renderAll();
startWorker();
