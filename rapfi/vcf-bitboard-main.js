"use strict";

(function initVCFBitboardBridge(global) {
  const moduleURL = new URL("rapfi/engine/vcf-bitboard-engine.js", document.baseURI).href;
  const workerURL = new URL("rapfi/vcf-bitboard-worker.js", document.baseURI).href;
  const desiredWorkers = Math.max(1, Math.min(navigator.hardwareConcurrency || 4, 8));

  class RpcWorker {
    constructor() {
      this.worker = null;
      this.nextId = 1;
      this.pending = new Map();
      this.ready = this.start();
    }

    async start() {
      this.terminate();
      this.worker = new Worker(workerURL);
      this.worker.onmessage = event => {
        const { id, ok, result, error } = event.data || {};
        const pending = this.pending.get(id);
        if (!pending) return;
        this.pending.delete(id);
        ok ? pending.resolve(result) : pending.reject(new Error(error || "Bitboard Worker 失敗"));
      };
      this.worker.onerror = event => {
        const error = new Error(event.message || "Bitboard Worker 發生錯誤");
        for (const pending of this.pending.values()) pending.reject(error);
        this.pending.clear();
      };
      return this.callRaw("init", { moduleURL });
    }

    callRaw(type, data) {
      return new Promise((resolve, reject) => {
        const id = this.nextId++;
        this.pending.set(id, { resolve, reject });
        this.worker.postMessage({ id, type, data });
      });
    }

    async call(type, data) {
      await this.ready;
      return this.callRaw(type, data);
    }

    terminate() {
      if (this.worker) this.worker.terminate();
      this.worker = null;
      for (const pending of this.pending.values()) pending.reject(new Error("計算已中止"));
      this.pending.clear();
    }
  }

  class BitboardEngineService {
    constructor() {
      this.rules = 2;
      this.main = new RpcWorker();
      // 單次 VCF 只使用 main；批次掃點第一次呼叫時才建立 Worker 池，
      // 避免頁面啟動時無條件載入最多 8 份 Wasm 引擎。
      this.pool = [];
      this.poolReady = null;
      this.syncModule = null;
      this.syncBoardPtr = 0;
      this.cancelPromise = null;
      this.syncApi = null;
      this.syncReady = this.initSyncModule();
    }

    async initSyncModule() {
      if (typeof global.VCFBitboardModule !== "function") {
        throw new Error("找不到 VCFBitboardModule 工廠");
      }
      const base = new URL("./", moduleURL).href;
      this.syncModule = await global.VCFBitboardModule({
        locateFile: file => new URL(file, base).href,
      });
      this.syncApi = {
        levelPoint: this.syncModule.cwrap("vcfBbLegacyGetLevelPoint", "number", ["number", "number", "number", "number"]),
        lineFour: this.syncModule.cwrap("vcfBbLegacyTestLineFour", "number", ["number", "number", "number", "number", "number"]),
        blockFour: this.syncModule.cwrap("vcfBbLegacyGetBlockFourPoint", "number", ["number", "number", "number", "number", "number"]),
        foul: this.syncModule.cwrap("vcfBbLegacyIsFoul", "number", ["number", "number", "number"]),
        selfTest: this.syncModule.cwrap("vcfBbSelfTest", "number", []),
      };
      const result = this.syncApi.selfTest();
      if (result !== 0) throw new Error(`主執行緒 Bitboard Wasm 自我檢查失敗：${result}`);
      this.syncBoardPtr = this.syncModule._malloc(225);
      this.installLegacyGlobals();
      return true;
    }

    writeSyncBoard(arr) {
      if (!this.syncModule || !this.syncBoardPtr) throw new Error("Bitboard Wasm 尚未就緒");
      const source = arr instanceof Uint8Array ? arr : Uint8Array.from(arr || []);
      this.syncModule.HEAPU8.fill(0, this.syncBoardPtr, this.syncBoardPtr + 225);
      this.syncModule.HEAPU8.set(source.subarray(0, 225), this.syncBoardPtr);
    }

    installLegacyGlobals() {
      const service = this;
      global.setGameRules = rules => { service.rules = Number(rules) || 2; };
      global.getLevelPoint = (idx, color, arr) => {
        service.writeSyncBoard(arr);
        return service.syncApi.levelPoint(service.syncBoardPtr, idx, color, service.rules);
      };
      global.isFoul = (idx, arr) => {
        service.writeSyncBoard(arr);
        return Boolean(service.syncApi.foul(service.syncBoardPtr, idx, service.rules));
      };
      global.testLineFour = (idx, direction, color, arr) => {
        service.writeSyncBoard(arr);
        return service.syncApi.lineFour(service.syncBoardPtr, idx, direction, color, service.rules);
      };
      global.testLine = global.testLineFour;
      global.testLineThree = global.testLineFour;
      global.getBlockFourPoint = (idx, arr, lineInfo) => {
        const encoded = (Number(lineInfo) >>> 8) & 0xff;
        if (encoded < 225) return encoded;
        service.writeSyncBoard(arr);
        for (let direction = 0; direction < 4; direction++) {
          const point = service.syncApi.blockFour(service.syncBoardPtr, idx, direction, arr?.[idx] || 1, service.rules);
          if (point >= 0 && point < 225) return point;
        }
        return 225;
      };
      global.getLevel = (arr, color) => {
        let best = 0;
        for (let idx = 0; idx < 225; idx++) {
          if ((arr[idx] || 0) !== 0) continue;
          best = Math.max(best, global.getLevelPoint(idx, color, arr) & 0x1f);
        }
        return best;
      };
      global.moveIdx = (idx, offset, direction) => {
        const dx = [1, 0, 1, 1][direction] || 0;
        const dy = [0, 1, 1, -1][direction] || 0;
        const x = idx % 15 + dx * offset;
        const y = Math.floor(idx / 15) + dy * offset;
        return x >= 0 && x < 15 && y >= 0 && y < 15 ? y * 15 + x : 225;
      };
    }

    async ensurePool() {
      if (this.pool.length === desiredWorkers && !this.poolReady) return this.pool;
      if (!this.poolReady) {
        this.pool = Array.from({ length: desiredWorkers }, () => new RpcWorker());
        this.poolReady = Promise.all(
          this.pool.map(worker => worker.call("setGameRules", { rules: this.rules })),
        ).then(() => {
          this.poolReady = null;
          return this.pool;
        }).catch(error => {
          this.pool.forEach(worker => worker.terminate());
          this.pool = [];
          this.poolReady = null;
          throw error;
        });
      }
      return this.poolReady;
    }

    async broadcastRules(rules) {
      this.rules = Number(rules) || 2;
      await Promise.all([
        this.main.call("setGameRules", { rules: this.rules }),
        ...this.pool.map(worker => worker.call("setGameRules", { rules: this.rules })),
      ]);
      await this.syncReady;
      return true;
    }

    async send(cmd, param = {}) {
      switch (cmd) {
        case "setGameRules": return this.broadcastRules(param.rules);
        case "findVCF": return this.main.call("findVCF", { ...param, rules: this.rules });
        case "isVCF": {
          const result = await this.main.call("isVCF", {
            arr: param.arr,
            color: param.color,
            moves: param.moves,
            maxNode: param.maxNode,
            rules: this.rules,
          });
          return result.valid;
        }
        case "getBlockVCF": {
          const result = await this.main.call("getBlockVCF", { ...param, rules: this.rules });
          return result.points;
        }
        case "getLevelPoints": return this.main.call("getLevelPoints", { ...param, rules: this.rules });
        case "trimVCFGroups": return this.main.call("trimVCFGroups", { ...param, rules: this.rules });
        default: throw new Error(`不支援的 C++ Wasm 指令：${cmd}`);
      }
    }

    async poolGetLevelPoints(param) {
      const pool = await this.ensurePool();
      const arr = Array.from(param.arr || []).slice(0, 225);
      const sourceIndices = Array.isArray(param.indices)
        ? param.indices.filter(idx => arr[idx] === 0)
        : Array.from({ length: 225 }, (_, idx) => idx).filter(idx => arr[idx] === 0);
      const chunks = Array.from({ length: pool.length }, () => []);
      sourceIndices.forEach((idx, i) => chunks[i % chunks.length].push(idx));
      const results = await Promise.all(pool.map((worker, i) => {
        if (!chunks[i].length) return Promise.resolve({ items: [], nodeCount: 0, elapsedMs: 0, aborted: false });
        return worker.call("getLevelPoints", {
          ...param,
          arr,
          indices: chunks[i],
          rules: this.rules,
        });
      }));
      return {
        items: results.flatMap(result => result.items || []),
        nodeCount: results.reduce((sum, result) => sum + (result.nodeCount || 0), 0),
        elapsedMs: Math.max(0, ...results.map(result => result.elapsedMs || 0)),
        aborted: results.some(result => result.aborted),
      };
    }

    async cancel() {
      if (this.cancelPromise) return this.cancelPromise;
      this.cancelPromise = (async () => {
        this.main.terminate();
        this.pool.forEach(worker => worker.terminate());
        this.main = new RpcWorker();
        this.pool = [];
        this.poolReady = null;
        await this.broadcastRules(this.rules);
        return true;
      })();
      try {
        return await this.cancelPromise;
      } finally {
        this.cancelPromise = null;
      }
    }
  }

  const service = new BitboardEngineService();
  global.VCFBitboard = service;
  global.engineAPI = {
    workerCount: desiredWorkers,
    send: (cmd, param) => service.send(cmd, param),
    cancel: () => service.cancel(),
    poolGetLevelPoints: param => service.poolGetLevelPoints(param),
    poolCancel: () => service.cancel(),
    poolSetRules: rules => service.broadcastRules(rules),
  };
})(window);
