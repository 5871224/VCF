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
    this.ready = this.start();
  }

  async start() {
    if (window.engineAPI) {
      await window.engineAPI.send("setGameRules", { rules: this.rules });
      return;
    }
    if (this.worker) this.worker.terminate();
    this.worker = new Worker("eval/worker.js");
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
    if (window.engineAPI) return window.engineAPI.send(cmd, param);
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
    const useBitboardGeneratorMode = Boolean(window.engineAPI);
    return (await this.post("findVCF", {
      arr: arr.slice(),
      color,
      maxVCF,
      // 題目驗證必須同時取得目標步數與較短 VCF，預設使用固定目標深度的多組搜尋。
      mode: options.mode || (useBitboardGeneratorMode ? "multi" : undefined),
      simplify: options.simplify ?? useBitboardGeneratorMode,
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
    if (window.engineAPI) {
      await window.engineAPI.cancel();
      this.ready = this.start();
      await this.ready;
      return;
    }
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
