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

function genSelectedPruning() {
  const select = document.getElementById("vcf-multi-pruning");
  if (select) return select.value === "strict" ? "strict" : "fast";
  try {
    return localStorage.getItem("vcf_multi_pruning") === "strict" ? "strict" : "fast";
  } catch (_) {
    return "fast";
  }
}

function genNormalizeRules(rules) {
  const value = Number(rules);
  return value === 0 || value === 1 || value === 2 ? value : 2;
}

class GeneratorVCFEngine {
  constructor() {
    this.rules = 2;
    this.worker = null;
    this.nextId = 1;
    this.pending = new Map();
    this.backend = "bitboard-generator-worker";
    this.ready = this.start();
  }

  workerURL() {
    return new URL("rapfi/vcf-bitboard-worker.js", document.baseURI).href;
  }

  moduleURL() {
    return new URL("rapfi/engine/vcf-bitboard-engine.js", document.baseURI).href;
  }

  rejectPending(error) {
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
  }

  callRaw(type, data = {}) {
    return new Promise((resolve, reject) => {
      if (!this.worker) {
        reject(new Error("題目產生器 Bitboard Worker 尚未建立"));
        return;
      }
      const id = this.nextId++;
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ id, type, data });
    });
  }

  async start() {
    if (this.worker) this.worker.terminate();
    this.rejectPending(new Error("題目產生器引擎已重新啟動"));

    const worker = new Worker(this.workerURL());
    this.worker = worker;
    worker.onmessage = event => {
      const { id, ok, result, error } = event.data || {};
      const pending = this.pending.get(id);
      if (!pending) return;
      this.pending.delete(id);
      if (ok) pending.resolve(result);
      else pending.reject(new Error(error || "題目產生器 Bitboard Worker 失敗"));
    };
    worker.onerror = event => {
      const error = new Error(event?.message || "題目產生器 Bitboard Worker 發生錯誤");
      console.error("Generator Bitboard worker error", event);
      this.rejectPending(error);
    };

    await this.callRaw("init", { moduleURL: this.moduleURL() });
    await this.callRaw("setGameRules", { rules: this.rules });
  }

  async post(type, data = {}) {
    await this.ready;
    // 每個搜尋／驗證請求都明確附帶規則，避免自由規則 0 被 Worker 的預設值覆蓋。
    const withRules = type === "init" || type === "setGameRules"
      ? data
      : { ...data, rules: this.rules };
    const withPruning = { ...data, pruning: genSelectedPruning() };
    const normalized = type === "findVCF"
      ? { ...withPruning, rules: this.rules }
      : withRules;
    return this.callRaw(type, normalized);
  }

  async setRules(rules) {
    this.rules = genNormalizeRules(rules);
    await this.ready;
    await this.callRaw("setGameRules", { rules: this.rules });
  }

  async findVCF(arr, color, maxVCF = 64, options = {}) {
    const mode = options.mode === "shortest" ? "shortest" : options.mode === "single" ? "single" : "multi";
    const board = genCloneBoard(arr);
    const normalizedOptions = {
      ...options,
      mode,
      maxDepth: Math.max(1, Number(options.maxDepth) || 200),
      maxNode: Math.max(1, Number(options.maxNode) || 5000000),
    };
    const validationOperation = genFindGeneratorOperation("validation");
    const stoneOperation = genFindGeneratorOperation("stone");
    const operation = genBeginGeneratorOperation("search", {
      board,
      attacker: color,
      maxVCF,
      options: normalizedOptions,
      validationOperationId: validationOperation?.id || null,
      stoneOperationId: stoneOperation?.id || null,
    });
    try {
      const result = (await this.post("findVCF", {
        arr: board.slice(),
        color,
        maxVCF,
        mode,
        simplify: mode !== "single",
        pruning: genSelectedPruning(),
        maxDepth: normalizedOptions.maxDepth,
        maxNode: normalizedOptions.maxNode,
      })) || { winMoves: [], nodeCount: 0 };
      genEndGeneratorOperation(operation, {
        board,
        attacker: color,
        maxVCF,
        options: normalizedOptions,
        validationOperationId: validationOperation?.id || null,
        stoneOperationId: stoneOperation?.id || null,
        result,
      });
      return result;
    } catch (error) {
      genEndGeneratorOperation(operation, {
        board,
        attacker: color,
        maxVCF,
        options: normalizedOptions,
        validationOperationId: validationOperation?.id || null,
        stoneOperationId: stoneOperation?.id || null,
        error,
      });
      throw error;
    }
  }

  async trimGroups(arr, groups, color) {
    const attacker = Number(color) === GEN_WHITE ? GEN_WHITE : GEN_BLACK;
    const defender = genOther(attacker);
    const seen = new Set();
    const processed = [];

    for (const source of Array.isArray(groups) ? groups : []) {
      const moves = Array.from(source || [])
        .filter(idx => Number.isInteger(idx) && idx >= 0 && idx < 225);
      if (!moves.length) continue;

      const board = genCloneBoard(arr);
      let replayValid = true;
      for (let i = 0; i < moves.length - 1; i++) {
        const idx = moves[i];
        if (board[idx] !== GEN_EMPTY) {
          replayValid = false;
          break;
        }
        board[idx] = (i & 1) ? defender : attacker;
      }

      let normalized = moves;
      const finalIndex = moves[moves.length - 1];
      const finalSide = ((moves.length - 1) & 1) ? defender : attacker;
      if (
        replayValid &&
        moves.length > 1 &&
        finalSide === attacker &&
        board[finalIndex] === GEN_EMPTY
      ) {
        board[finalIndex] = attacker;
        const finalLevel = getLevelPoint(finalIndex, attacker, board) & 0x0f;
        board[finalIndex] = GEN_EMPTY;
        if (finalLevel === GEN_FOUR_FREE) normalized = moves.slice(0, -1);
      }

      // 多手路線若最後一手為活四，以活四前的攻守棋集合判定同型；
      // 一手活四必須保留該落子點，避免不同現成活三都縮成空 key。
      const key = normalized
        .map((idx, i) => `${idx}:${(i & 1) ? defender : attacker}`)
        .sort()
        .join(",");
      if (seen.has(key)) continue;
      seen.add(key);
      // 去重只改比較 key；答案與 getBlockVCF 仍使用完整路線。
      processed.push(moves);
    }

    processed.sort((a, b) => a.length - b.length);
    const validationOperation = genFindGeneratorOperation("validation");
    const stoneOperation = genFindGeneratorOperation("stone");
    genEmitGeneratorEvent("search:trimmed", {
      board: genCloneBoard(arr),
      attacker,
      groups: Array.from(groups || []),
      result: processed,
      validationOperationId: validationOperation?.id || null,
      stoneOperationId: stoneOperation?.id || null,
    });
    return processed;
  }

  async getBlockVCF(arr, color, moves, includeFour = true) {
    const result = await this.post("getBlockVCF", {
      arr: arr.slice(),
      color,
      vcfMoves: Array.from(moves || []),
      includeFour,
    });
    return Array.from(result?.points || []);
  }

  async cancel() {
    if (this.worker) this.worker.terminate();
    this.worker = null;
    this.rejectPending(new Error("題目產生器計算已中止"));
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
  return genNormalizeRules(genChecked("rules").value);
}

function genGetTargetSteps() {
  const input = genEl("target-steps");
  const value = Math.round(Number(input.value));
  const steps = Math.min(GEN_MAX_STEPS, Math.max(GEN_MIN_STEPS, Number.isFinite(value) ? value : GEN_MIN_STEPS));
  input.value = String(steps);
  return steps;
}

const genOptionProviders = [];
const genBusyHooks = [];
const genEventListeners = new Map();
const genOperationStack = [];
let genGenerationContext = null;
let genGenerationSerial = 0;
let genEventSerial = 0;
let genOperationSerial = 0;

function genRegisterOptionProvider(name, provider) {
  if (!name || typeof provider !== "function") {
    throw new TypeError("題目產生器設定提供者需要名稱與函式");
  }
  const entry = { name: String(name), provider };
  const index = genOptionProviders.findIndex(item => item.name === entry.name);
  if (index >= 0) genOptionProviders[index] = entry;
  else genOptionProviders.push(entry);
}

function genResolveOptions(baseOptions) {
  let options = { ...(baseOptions || {}) };
  for (const entry of genOptionProviders) {
    const next = entry.provider(options);
    if (!next || typeof next !== "object") {
      throw new TypeError(`題目產生器設定提供者 ${entry.name} 未回傳設定物件`);
    }
    options = { ...next };
  }
  return options;
}

function genRegisterBusyHook(name, hook) {
  if (!name || !hook || (typeof hook.before !== "function" && typeof hook.after !== "function")) {
    throw new TypeError("題目產生器忙碌狀態 Hook 需要名稱及 before/after 函式");
  }
  const entry = { name: String(name), before: hook.before, after: hook.after };
  const index = genBusyHooks.findIndex(item => item.name === entry.name);
  if (index >= 0) genBusyHooks[index] = entry;
  else genBusyHooks.push(entry);
}


function genOnGeneratorEvent(type, name, listener) {
  if (!type || !name || typeof listener !== "function") {
    throw new TypeError("題目產生器事件監聽器需要事件、名稱與函式");
  }
  const eventType = String(type);
  const entry = { name: String(name), listener };
  const listeners = genEventListeners.get(eventType) || [];
  const index = listeners.findIndex(item => item.name === entry.name);
  if (index >= 0) listeners[index] = entry;
  else listeners.push(entry);
  genEventListeners.set(eventType, listeners);
  return () => {
    const current = genEventListeners.get(eventType) || [];
    const next = current.filter(item => item.name !== entry.name);
    if (next.length) genEventListeners.set(eventType, next);
    else genEventListeners.delete(eventType);
  };
}

function genEmitGeneratorEvent(type, detail = {}) {
  const event = Object.freeze({
    type: String(type),
    sequence: ++genEventSerial,
    generationId: genGenerationContext?.id || null,
    timestamp: Date.now(),
    ...detail,
  });
  for (const entry of Array.from(genEventListeners.get(event.type) || [])) {
    try {
      entry.listener(event);
    } catch (error) {
      console.error(`題目產生器事件監聽器 ${entry.name} 執行失敗`, error);
    }
  }
  return event;
}

function genFindGeneratorOperation(type) {
  for (let index = genOperationStack.length - 1; index >= 0; index--) {
    if (genOperationStack[index].type === type) return genOperationStack[index];
  }
  return null;
}

function genBeginGeneratorOperation(type, detail = {}) {
  const parent = genOperationStack[genOperationStack.length - 1] || null;
  const operation = Object.freeze({
    id: ++genOperationSerial,
    type: String(type),
    parentId: parent?.id || null,
    generationId: genGenerationContext?.id || null,
  });
  genOperationStack.push(operation);
  genEmitGeneratorEvent(`${operation.type}:start`, {
    ...detail,
    operation,
    parentOperation: parent,
  });
  return operation;
}

function genEndGeneratorOperation(operation, detail = {}) {
  if (!operation) return null;
  const index = genOperationStack.lastIndexOf(operation);
  if (index >= 0) genOperationStack.splice(index, 1);
  return genEmitGeneratorEvent(`${operation.type}:end`, {
    ...detail,
    operation,
  });
}

async function genRunValidationOperation(
  { candidate, expectedSteps, previousResult = null, phase = "candidate" },
  validate,
) {
  const operation = genBeginGeneratorOperation("validation", {
    candidate,
    expectedSteps,
    previousResult,
    phase,
  });
  try {
    const result = await validate();
    genEndGeneratorOperation(operation, {
      candidate,
      expectedSteps,
      previousResult,
      phase,
      passed: Boolean(result),
      result,
    });
    return result;
  } catch (error) {
    genEndGeneratorOperation(operation, {
      candidate,
      expectedSteps,
      previousResult,
      phase,
      passed: false,
      error,
    });
    throw error;
  }
}

function genBeginStoneAttempt(detail) {
  const validationOperation = genFindGeneratorOperation("validation");
  return genBeginGeneratorOperation("stone", {
    ...detail,
    validationOperationId: validationOperation?.id || null,
  });
}

function genEndStoneAttempt(operation, passed, reason = "") {
  return genEndGeneratorOperation(operation, {
    passed: Boolean(passed),
    reason,
  });
}

function genFreezeOptions(options) {
  const copy = { ...(options || {}) };
  if (copy.uniqueSearchSettings) {
    copy.uniqueSearchSettings = Object.freeze({ ...copy.uniqueSearchSettings });
  }
  return Object.freeze(copy);
}

function genBeginGenerationContext({ attacker, rules, targetSteps, options, counters }) {
  if (genGenerationContext) {
    throw new Error("題目產生器已有進行中的 GenerationContext");
  }
  genGenerationContext = Object.freeze({
    id: ++genGenerationSerial,
    attacker,
    defender: genOther(attacker),
    rules,
    targetSteps,
    options: genFreezeOptions(options),
    counters,
    startedAt: Date.now(),
  });
  return genGenerationContext;
}

function genGetGenerationContext() {
  return genGenerationContext;
}

function genGetActiveOptions() {
  return genGenerationContext?.options || null;
}

function genEndGenerationContext(context) {
  if (!context || context === genGenerationContext) {
    genGenerationContext = null;
    genOperationStack.length = 0;
  }
}

function genSetBusy(value) {
  const busy = Boolean(value);
  const context = genGetGenerationContext();
  for (let index = genBusyHooks.length - 1; index >= 0; index--) {
    genBusyHooks[index].before?.(busy, context);
  }

  genBusy = busy;
  const generateButton = genEl("btn-generate");
  const stopButton = genEl("btn-stop");
  if (generateButton) generateButton.disabled = busy;
  if (stopButton) stopButton.disabled = !busy;

  genInputs("attacker").forEach(input => { input.disabled = busy; });
  genInputs("rules").forEach(input => { input.disabled = busy; });
  ["target-steps", "bonus-reuse", "bonus-center"].forEach(id => {
    const input = genEl(id);
    if (input) input.disabled = busy;
  });

  const pruningSelect = document.getElementById("vcf-multi-pruning");
  if (pruningSelect) pruningSelect.disabled = busy;

  const answerButton = genEl("btn-answer");
  const nButton = genEl("btn-npoints");
  if (answerButton) answerButton.disabled = busy || !genCurrent;
  if (nButton) nButton.disabled = busy || !genCurrent;

  if (typeof window.genIntegrationSetBusy === "function") {
    window.genIntegrationSetBusy(busy);
  }

  for (const hook of genBusyHooks) {
    hook.after?.(busy, context);
  }
}
