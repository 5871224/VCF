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
const ruleSelect = document.querySelector("#ruleSelect");
const timeSelect = document.querySelector("#timeSelect");
const resultElement = document.querySelector("#result");
const consoleElement = document.querySelector("#console");
const commandForm = document.querySelector("#commandForm");
const commandInput = document.querySelector("#commandInput");

const statElements = {
  DEPTH: document.querySelector("#depth"),
  SELDEPTH: document.querySelector("#seldepth"),
  NODES: document.querySelector("#nodes"),
  SPEED: document.querySelector("#speed"),
  EVAL: document.querySelector("#evaluation"),
  WINRATE: document.querySelector("#winrate"),
};

const stones = new Uint8Array(SIZE * SIZE);
const history = [];
let nextStone = BLACK;
let suggestion = -1;
let worker = null;
let engineReady = false;
let engineBusy = false;

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
  undoButton.disabled = history.length === 0 || engineBusy;
  acceptButton.disabled = suggestion < 0 || engineBusy;
  analyzeButton.disabled = !engineReady || engineBusy;
  resultElement.textContent = suggestion >= 0
    ? `Rapfi 建議 ${suggestion % SIZE},${Math.floor(suggestion / SIZE)}；目前輪到${stoneName(nextStone)}。`
    : `目前輪到${stoneName(nextStone)}。`;
}

function clearSuggestion() {
  const previous = suggestion;
  suggestion = -1;
  if (previous >= 0) renderPoint(previous);
}

function play(index, stone = nextStone) {
  if (engineBusy || stones[index] !== EMPTY) return false;
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

function sendCommand(command) {
  if (!worker || !engineReady) return false;
  log(">", command.replaceAll("\n", " ↵ "));
  worker.postMessage({ type: "command", data: command });
  return true;
}

function buildBoardCommand() {
  const lines = ["BOARD"];
  for (const move of history) {
    const x = move.index % SIZE;
    const y = Math.floor(move.index / SIZE);
    const sideFlag = move.stone === nextStone ? 1 : 2;
    lines.push(`${x},${y},${sideFlag}`);
  }
  lines.push("DONE");
  return lines.join("\n");
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

function parseStdout(output) {
  log("<", output);

  const infoMatch = output.match(/^INFO\s+(DEPTH|SELDEPTH|NODES|SPEED|EVAL|WINRATE)\s+(.+)$/);
  if (infoMatch) {
    statElements[infoMatch[1]].textContent = infoMatch[2];
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
  analyzeButton.disabled = true;
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
      setStatus("error", "Rapfi 載入失敗");
      log("!", String(data));
      renderAll();
      return;
    }
    if (type === "exit") {
      engineReady = false;
      engineBusy = false;
      setStatus("error", `Rapfi 已結束（${data}）`);
      renderAll();
    }
  };

  worker.onerror = (error) => {
    engineReady = false;
    engineBusy = false;
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
  if (engineBusy) return;
  clearSuggestion();
  const move = history.pop();
  if (!move) return;
  stones[move.index] = EMPTY;
  nextStone = move.stone;
  renderPoint(move.index);
  renderAll();
});

clearButton.addEventListener("click", () => {
  if (engineBusy) return;
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
  if (!engineReady || engineBusy) return;
  clearSuggestion();
  resetStats();
  engineBusy = true;
  renderAll();
  resultElement.textContent = "Rapfi 搜尋中…";
  sendCommand(`INFO RULE ${ruleSelect.value}`);
  sendCommand(`INFO TIMEOUT_TURN ${timeSelect.value}`);
  sendCommand("INFO TIMEOUT_MATCH 100000000");
  sendCommand("INFO TIME_LEFT 2147483647");
  sendCommand(buildBoardCommand());
});

restartButton.addEventListener("click", () => {
  engineBusy = false;
  engineReady = false;
  suggestion = -1;
  startWorker();
  renderAll();
});

commandForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const command = commandInput.value.trim();
  if (!command || !engineReady) return;
  sendCommand(command);
  commandInput.value = "";
});

renderAll();
startWorker();
