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
const GEN_LINE_MASK = 0x1f;
const GEN_CENTER = { x: 7, y: 7 };
const GEN_MIN_STEPS = 2;
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

class GeneratorVCFEngine {
  constructor() {
    this.rules = 2;
    this.worker = null;
    this.resolve = null;
    this.ready = this.start();
  }

  async start() {
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

  async findVCF(arr, color, maxVCF = 64) {
    await this.ready;
    return (await this.post("findVCF", {
      arr: arr.slice(),
      color,
      maxVCF,
      maxDepth: 200,
      maxNode: 5000000,
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
  document.getElementById("status").textContent = text;
}

function genSetDetails(text) {
  document.getElementById("details").textContent = text;
}

function genGetAttacker() {
  return Number(document.querySelector('input[name="attacker"]:checked').value);
}

function genGetRules() {
  return Number(document.querySelector('input[name="rules"]:checked').value);
}

function genGetTargetSteps() {
  const input = document.getElementById("target-steps");
  const value = Math.round(Number(input.value));
  const steps = Math.min(GEN_MAX_STEPS, Math.max(GEN_MIN_STEPS, Number.isFinite(value) ? value : GEN_MIN_STEPS));
  input.value = String(steps);
  return steps;
}

function genSetBusy(value) {
  genBusy = value;
  document.getElementById("btn-generate").disabled = value;
  document.getElementById("btn-stop").disabled = !value;
  document.querySelectorAll('input[name="attacker"], input[name="rules"], #target-steps, #opt-reuse, #opt-center')
    .forEach(input => { input.disabled = value; });
  document.getElementById("btn-answer").disabled = value || !genCurrent;
  document.getElementById("btn-npoints").disabled = value || !genCurrent;
}
