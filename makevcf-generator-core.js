"use strict";

// N 點只分為「黑方不能使用」與「白方不能使用」；同一點可同時具有兩種標記。
const GEN_NO_BLACK = 1;
const GEN_NO_WHITE = 2;
const GEN_EMPTY = 0;
const GEN_BLACK = 1;
const GEN_WHITE = 2;
const GEN_OUT = 225;
const GEN_FOUR_NOFREE = 8;
const GEN_FOUR_FREE = 9;
const GEN_FIVE = 10;
const GEN_LINE_DOUBLE_FOUR = 24;
const GEN_LINE_MASK = 0x1f;
const GEN_CENTER = { x: 7, y: 7 };
const GEN_MIN_STEPS = 1;
const GEN_MAX_STEPS = 10;

const GEN_DIRECTIONS = [
  { dx: 1, dy: 0, line: 0, name: "橫" },
  { dx: 0, dy: 1, line: 1, name: "直" },
  { dx: 1, dy: 1, line: 2, name: "右下斜" },
  { dx: 1, dy: -1, line: 3, name: "右上斜" },
];

const GEN_NEW_FOUR_TEMPLATES = [
  { id: 1, cells: ["X", "F", "S", "S", "S", "S", "X"], stoneSlots: [2, 3, 4, 5], fiveSlot: 1, xSlots: [0, 6] },
  { id: 2, cells: ["X", "S", "F", "S", "S", "S", "X"], stoneSlots: [1, 3, 4, 5], fiveSlot: 2, xSlots: [0, 6] },
  { id: 3, cells: ["X", "S", "S", "F", "S", "S", "X"], stoneSlots: [1, 2, 4, 5], fiveSlot: 3, xSlots: [0, 6] },
];

function genEl(id) {
  return document.getElementById(`gen-${id}`) || document.getElementById(id);
}

function genChecked(name) {
  return document.querySelector(`input[name="gen-${name}"]:checked`) ||
    document.querySelector(`input[name="${name}"]:checked`);
}

function genInputs(name) {
  const prefixed = document.querySelectorAll(`input[name="gen-${name}"]`);
  return prefixed.length ? prefixed : document.querySelectorAll(`input[name="${name}"]`);
}

class GeneratorVCFEngine {
  constructor() {
    this.rules = 2;
    this.worker = null;
    this.resolve = null;
    this.backend = "legacy-generator-worker";
    this.ready = this.start();
  }

  async start() {
    // 題目產生器的驗證語意依賴舊版 eval/worker.js：maxVCF=64 時會以
    // 原本的多組 VCF 流程回傳目標路線與較短路線，供自動補守子使用。
    // Bitboard C++ 的 multi 模式停止條件不同，從第 5 層起可能為單一候選
    // 長時間列舉到 64 組／節點上限。主畫面搜尋仍使用 C++；只有題目產生器
    // 固定使用自己的舊版 Worker，避免兩種語意互相污染。
    if (this.worker) this.worker.terminate();
    this.worker = new Worker(new URL("eval/worker.js", document.baseURI).href);
    this.worker.onmessage = event => {
      if (event.data.cmd === "resolve" && this.resolve) {
        const done = this.resolve;
        this.resolve = null;
        done(event.data.param);
      }
    };
    this.worker.onerror = event => {
      console.error("Generator worker error", event);
      if (this.resolve) {
        const done = this.resolve;
        this.resolve = null;
        done(null);
      }
    };
    await this.post("setGameRules", { rules: this.rules });
  }

  post(cmd, param) {
    return new Promise(resolve => {
      this.resolve = resolve;
      this.worker.postMessage({ cmd, param });
    });
  }

  async setRules(rules) {
    this.rules = rules;
    await this.ready;
    await this.post("setGameRules", { rules });
  }

  async findVCF(arr, color, maxVCF = 64, options = {}) {
    await this.ready;
    return (await this.post("findVCF", {
      arr: arr.slice(),
      color,
      maxVCF,
      // 舊版 Worker 會忽略新版 mode/pruning 欄位，但仍尊重深度與節點限制。
      // 保留欄位讓同一介面可在測試中與 Bitboard 後端比較。
      mode: options.mode,
      simplify: options.simplify,
      pruning: options.pruning,
      maxDepth: Math.max(1, Number(options.maxDepth) || 200),
      maxNode: Math.max(1, Number(options.maxNode) || 5000000),
    })) || { winMoves: [], nodeCount: 0 };
  }

  async trimGroups(arr, groups, color) {
    await this.ready;
    return (await this.post("trimVCFGroups", {
      arr: arr.slice(),
      groups: groups.map(moves => Array.from(moves)),
      color,
    })) || [];
  }

  async cancel() {
    if (this.resolve) {
      const done = this.resolve;
      this.resolve = null;
      done(null);
    }
    this.ready = this.start();
    await this.ready;
  }
}

const genEngine = new GeneratorVCFEngine();
let genCancelled = false;
let genBusy = false;
let genCurrent = null;
let genShowAnswer = false;
let genShowNPoints = false;

function genOther(color) { return color === GEN_BLACK ? GEN_WHITE : GEN_BLACK; }
function genNoMask(color) { return color === GEN_BLACK ? GEN_NO_BLACK : GEN_NO_WHITE; }
function genIsNFor(nMask, idx, color) { return idx >= 0 && idx < 225 && Boolean(nMask[idx] & genNoMask(color)); }
function genX(idx) { return idx % 15; }
function genY(idx) { return Math.floor(idx / 15); }
function genIdx(x, y) { return x >= 0 && x < 15 && y >= 0 && y < 15 ? y * 15 + x : GEN_OUT; }
function genBoard() { const arr = new Array(226).fill(0); arr[225] = -1; return arr; }
function genCloneBoard(arr) { const copy = arr.slice(0, 226); copy[225] = -1; return copy; }
function genTick() { return new Promise(resolve => setTimeout(resolve, 0)); }
function genRand(max) { return Math.floor(Math.random() * max); }

function genPointFrom(anchor, delta, direction, sign) {
  const x = genX(anchor) + direction.dx * sign * delta;
  const y = genY(anchor) + direction.dy * sign * delta;
  return genIdx(x, y);
}

function genSetStatus(text) {
  const element = genEl("status");
  if (element) element.textContent = text;
}

function genSetDetails(text) {
  const element = genEl("details");
  if (element) element.textContent = text;
}

function genGetAttacker() {
  return Number(genChecked("attacker").value);
}

function genGetRules() {
  return Number(genChecked("rules").value);
}

function genGetTargetSteps() {
  const input = genEl("target-steps");
  const value = Math.round(Number(input.value));
  const steps = Math.min(GEN_MAX_STEPS, Math.max(GEN_MIN_STEPS, Number.isFinite(value) ? value : GEN_MIN_STEPS));
  input.value = String(steps);
  return steps;
}

function genSetBusy(value) {
  genBusy = value;
  const generateButton = genEl("btn-generate");
  const stopButton = genEl("btn-stop");
  if (generateButton) generateButton.disabled = value;
  if (stopButton) stopButton.disabled = !value;

  genInputs("attacker").forEach(input => { input.disabled = value; });
  genInputs("rules").forEach(input => { input.disabled = value; });
  ["target-steps", "bonus-reuse", "bonus-center"].forEach(id => {
    const input = genEl(id);
    if (input) input.disabled = value;
  });

  const answerButton = genEl("btn-answer");
  const nButton = genEl("btn-npoints");
  if (answerButton) answerButton.disabled = value || !genCurrent;
  if (nButton) nButton.disabled = value || !genCurrent;

  if (typeof window.genIntegrationSetBusy === "function") {
    window.genIntegrationSetBusy(value);
  }
}