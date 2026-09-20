"use strict";

(function initVCFRapfiDB(global) {
  const scriptURL = document.currentScript?.src || new URL("rapfi/vcf-rapfi-db.js", location.href).href;
  const decoder = new TextDecoder("utf-8");
  const encoder = new TextEncoder();
  let module = null;
  let api = null;

  function requireReady() {
    if (!module || !api) throw new Error("Rapfi DB Wasm 尚未就緒");
    return { module, api };
  }

  function bind(instance) {
    return {
      init: instance.cwrap("vcfRapfiDbInit", "number", ["number"]),
      resetBoard: instance.cwrap("vcfRapfiDbResetBoard", "number", ["number"]),
      clear: instance.cwrap("vcfRapfiDbClear", "number", ["number"]),
      ensureCurrent: instance.cwrap("vcfRapfiDbEnsureCurrent", "number", []),
      replayMove: instance.cwrap("vcfRapfiDbReplayMove", "number", ["number", "number"]),
      play: instance.cwrap("vcfRapfiDbPlay", "number", ["number", "number"]),
      undo: instance.cwrap("vcfRapfiDbUndo", "number", []),
      ply: instance.cwrap("vcfRapfiDbPly", "number", []),
      historyMove: instance.cwrap("vcfRapfiDbHistoryMove", "number", ["number"]),
      sideToMove: instance.cwrap("vcfRapfiDbSideToMove", "number", []),
      boardCell: instance.cwrap("vcfRapfiDbBoardCell", "number", ["number"]),
      isForbidden: instance.cwrap("vcfRapfiDbIsForbidden", "number", ["number"]),
      setDisplayText: instance.cwrap("vcfRapfiDbSetDisplayText", "number", ["number", "number"]),
      getDisplayText: instance.cwrap("vcfRapfiDbGetDisplayText", "number", []),
      textPtr: instance.cwrap("vcfRapfiDbTextPtr", "number", []),
      textLength: instance.cwrap("vcfRapfiDbTextLength", "number", []),
      queryChildren: instance.cwrap("vcfRapfiDbQueryChildren", "number", []),
      childMove: instance.cwrap("vcfRapfiDbChildMove", "number", ["number"]),
      queryBoardTexts: instance.cwrap("vcfRapfiDbQueryBoardTexts", "number", []),
      boardTextMove: instance.cwrap("vcfRapfiDbBoardTextMove", "number", ["number"]),
      boardTextValue: instance.cwrap("vcfRapfiDbBoardTextValue", "number", ["number"]),
      recordCount: instance.cwrap("vcfRapfiDbRecordCount", "number", []),
      deleteCurrentAndChildren: instance.cwrap("vcfRapfiDbDeleteCurrentAndChildren", "number", []),
      exportYXDB: instance.cwrap("vcfRapfiDbExportYXDB", "number", []),
      importYXDB: instance.cwrap("vcfRapfiDbImportYXDB", "number", ["number", "number", "number"]),
      bytesPtr: instance.cwrap("vcfRapfiDbBytesPtr", "number", []),
      bytesLength: instance.cwrap("vcfRapfiDbBytesLength", "number", []),
    };
  }

  function withBytes(text, callback) {
    const { module: instance } = requireReady();
    const bytes = encoder.encode(String(text || ""));
    const ptr = instance._malloc(Math.max(1, bytes.length));
    try {
      if (bytes.length) instance.HEAPU8.set(bytes, ptr);
      return callback(ptr, bytes.length);
    } finally {
      instance._free(ptr);
    }
  }

  function withByteArray(value, callback) {
    const { module: instance } = requireReady();
    const bytes = value instanceof Uint8Array ? value : new Uint8Array(value || 0);
    const ptr = instance._malloc(Math.max(1, bytes.length));
    try {
      if (bytes.length) instance.HEAPU8.set(bytes, ptr);
      return callback(ptr, bytes.length);
    } finally {
      instance._free(ptr);
    }
  }

  function readResultText(length = null) {
    const { module: instance, api: bound } = requireReady();
    const size = length == null ? bound.textLength() : Number(length);
    if (!(size > 0)) return "";
    const ptr = bound.textPtr();
    return ptr ? decoder.decode(instance.HEAPU8.slice(ptr, ptr + size)) : "";
  }

  const facade = {
    get isReady() { return Boolean(module && api); },
    get ready() { return readyPromise; },
    init(rule = 2) { return Boolean(requireReady().api.init(Number(rule))); },
    clear(rule = 2) { return Boolean(requireReady().api.clear(Number(rule))); },
    resetBoard(rule = 2) { return Boolean(requireReady().api.resetBoard(Number(rule))); },
    ensureCurrent() { return Boolean(requireReady().api.ensureCurrent()); },
    replayMove(move, createRecord = true) {
      return Boolean(requireReady().api.replayMove(Number(move), createRecord ? 1 : 0));
    },
    play(move, createRecord = true) {
      return Boolean(requireReady().api.play(Number(move), createRecord ? 1 : 0));
    },
    undo() { return Boolean(requireReady().api.undo()); },
    ply() { return requireReady().api.ply(); },
    history() {
      const { api: bound } = requireReady();
      const result = [];
      for (let i = 0, n = bound.ply(); i < n; i++) result.push(bound.historyMove(i));
      return result;
    },
    sideToMove() { return requireReady().api.sideToMove(); },
    board() {
      const { api: bound } = requireReady();
      return Array.from({ length: 225 }, (_, i) => bound.boardCell(i));
    },
    isForbidden(move) { return Boolean(requireReady().api.isForbidden(Number(move))); },
    setDisplayText(text) {
      const { api: bound } = requireReady();
      return Boolean(withBytes(text, (ptr, length) => bound.setDisplayText(ptr, length)));
    },
    getDisplayText() {
      const { api: bound } = requireReady();
      return readResultText(bound.getDisplayText());
    },
    children() {
      const { api: bound } = requireReady();
      const count = bound.queryChildren();
      return Array.from({ length: count }, (_, i) => bound.childMove(i));
    },
    boardTexts() {
      const { api: bound } = requireReady();
      const count = bound.queryBoardTexts();
      const result = [];
      for (let i = 0; i < count; i++) {
        const move = bound.boardTextMove(i);
        const length = bound.boardTextValue(i);
        result.push({ move, text: readResultText(length) });
      }
      return result;
    },
    snapshotYXDB() {
      const { module: instance, api: bound } = requireReady();
      const length = bound.exportYXDB();
      if (!(length > 0)) return new Uint8Array();
      const ptr = bound.bytesPtr();
      return ptr ? instance.HEAPU8.slice(ptr, ptr + length) : new Uint8Array();
    },
    restoreYXDB(value, rule = 2) {
      const { api: bound } = requireReady();
      return Boolean(withByteArray(value, (ptr, length) => (
        length > 0 && bound.importYXDB(ptr, length, Number(rule))
      )));
    },
    deleteCurrentAndChildren() { return Boolean(requireReady().api.deleteCurrentAndChildren()); },
    recordCount() { return requireReady().api.recordCount(); },
  };

  const readyPromise = (async () => {
    if (typeof global.VCFRapfiDBModule !== "function") {
      throw new Error("找不到 Rapfi DB Wasm 模組工廠");
    }
    module = await global.VCFRapfiDBModule({
      locateFile: file => new URL(`engine/${file}`, scriptURL).href,
    });
    api = bind(module);
    api.init(Number(document.querySelector('input[name="rules"]:checked')?.value ?? 2));
    global.dispatchEvent(new CustomEvent("vcf-rapfi-db-ready"));
    return facade;
  })().catch(error => {
    console.error("Rapfi DB Wasm 初始化失敗", error);
    throw error;
  });

  global.VCFRapfiDB = facade;
})(window);
