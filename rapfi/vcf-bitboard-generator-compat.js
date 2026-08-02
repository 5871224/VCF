"use strict";

(function installVCFWorkbenchRuntime(global) {
  if (global.__vcfWorkbenchRuntimeInstalled) return;
  global.__vcfWorkbenchRuntimeInstalled = true;

  const normalizeRules = global.vcfNormalizeRules || (rules => {
    const value = Number(rules);
    return value === 0 || value === 1 || value === 2 ? value : 2;
  });
  global.vcfNormalizeRules = normalizeRules;

  const createRegistry = () => {
    const entries = [];
    return {
      register(name, value, priority = 0) {
        if (!name || typeof value !== "function") throw new TypeError("VCF Registry 需要名稱與函式");
        const entry = { name: String(name), value, priority: Number(priority) || 0 };
        const index = entries.findIndex(item => item.name === entry.name);
        if (index >= 0) entries[index] = entry;
        else entries.push(entry);
        entries.sort((a, b) => b.priority - a.priority || a.name.localeCompare(b.name));
        return () => {
          const current = entries.findIndex(item => item.name === entry.name);
          if (current >= 0) entries.splice(current, 1);
        };
      },
      values() { return entries.slice(); },
      first() { return entries[0] || null; },
    };
  };

  const statusFormatters = createRegistry();
  const trimProviders = createRegistry();
  const searchHandlers = new Map([
    ["single", createRegistry()],
    ["multi", createRegistry()],
    ["add", createRegistry()],
  ]);

  global.vcfRegisterStatusFormatter = (name, formatter, priority = 0) =>
    statusFormatters.register(name, formatter, priority);
  global.vcfRegisterTrimGroupsProvider = (name, provider, priority = 0) =>
    trimProviders.register(name, provider, priority);
  global.vcfRegisterSearchHandler = (kind, name, handler, priority = 0) => {
    const registry = searchHandlers.get(String(kind));
    if (!registry) throw new TypeError(`不支援的 VCF 搜尋處理器：${kind}`);
    return registry.register(name, handler, priority);
  };

  const originalSetStatus = typeof setStatus === "function" ? setStatus : null;
  if (originalSetStatus) {
    const registeredSetStatus = function registeredSetStatus(text) {
      let message = String(text ?? "");
      for (const entry of statusFormatters.values()) {
        const next = entry.value(message);
        if (next != null) message = String(next);
      }
      return originalSetStatus(message);
    };
    global.setStatus = registeredSetStatus;
    try { setStatus = registeredSetStatus; } catch (_) {}
  }

  let boardChangeSource = "";
  global.vcfWithBoardChangeSource = (source, callback) => {
    const previous = boardChangeSource;
    boardChangeSource = String(source || "api");
    try { return callback(); }
    finally { boardChangeSource = previous; }
  };

  const emitBoardChanged = (source, detail = {}) => {
    const board = typeof global._getArr === "function"
      ? Array.from(global._getArr()).slice(0, 225)
      : null;
    global.dispatchEvent(new CustomEvent("vcf-board-changed", {
      detail: { source: String(source || "unknown"), board, ...detail },
    }));
  };
  global.vcfNotifyBoardChanged = (source, detail) => emitBoardChanged(source, detail);

  const wrapBoardMutation = (name, sourceName) => {
    const original = global[name];
    if (typeof original !== "function" || original.__vcfBoardRuntimeWrapped) return;
    const wrapped = function wrappedBoardMutation(...args) {
      const source = boardChangeSource || sourceName;
      const result = original.apply(this, args);
      queueMicrotask(() => emitBoardChanged(source, {
        attacker: Number(args[1]) === 2 ? 2 : Number(args[1]) === 1 ? 1 : undefined,
      }));
      return result;
    };
    wrapped.__vcfBoardRuntimeWrapped = true;
    wrapped.__vcfOriginal = original;
    global[name] = wrapped;
  };
  wrapBoardMutation("_setBoardArr", "set-board");
  wrapBoardMutation("_clearBoard", "clear-board");
  document.getElementById("board-svg")?.addEventListener("click", () => {
    queueMicrotask(() => emitBoardChanged("manual"));
  });

  global.vcfInvalidateAnalysis = (reason = "") => {
    global._clearVCF?.();
    global._clearAnalysis?.();
    if (typeof resetVcfGroups === "function") resetVcfGroups();
    if (typeof hideGeneratedOverlays === "function") hideGeneratedOverlays();
    if (typeof invalidateGeneratedResult === "function") invalidateGeneratedResult(reason);
    global.dispatchEvent(new CustomEvent("vcf-analysis-invalidated", { detail: { reason } }));
  };

  global.vcfSetRules = async rules => {
    const value = normalizeRules(rules);
    if (typeof searching !== "undefined" && searching) return false;
    global.setStatus?.("正在切換規則...");
    try {
      const tasks = [];
      if (typeof engine !== "undefined" && engine?.setRules) tasks.push(engine.setRules(value));
      if (typeof pool !== "undefined" && pool?.setRules) tasks.push(pool.setRules(value));
      if (typeof genEngine !== "undefined" && genEngine?.setRules) tasks.push(genEngine.setRules(value));
      await Promise.all(tasks);
      document.querySelectorAll('input[name="rules"]').forEach(input => {
        input.checked = Number(input.value) === value;
      });
      const select = document.getElementById("vcf-rule-select");
      if (select) select.value = String(value);
      const names = { 0: "自由", 1: "無禁", 2: "有禁" };
      global.setStatus?.(`${names[value]}，就緒`);
      global.dispatchEvent(new CustomEvent("vcf-rule-changed", { detail: { rules: value } }));
      return true;
    } catch (error) {
      console.error("切換規則失敗", error);
      global.setStatus?.(`切換規則失敗：${error?.message || error}`);
      return false;
    }
  };

  if (typeof engine !== "undefined" && engine?.trimVCFGroups) {
    const originalTrimVCFGroups = engine.trimVCFGroups.bind(engine);
    engine.trimVCFGroups = async options => {
      for (const entry of trimProviders.values()) {
        const result = await entry.value(options);
        if (result !== undefined) return result;
      }
      return originalTrimVCFGroups(options);
    };
  }

  const installFunctionDispatcher = (kind, original) => {
    if (typeof original !== "function") return null;
    return async (...args) => {
      const entry = searchHandlers.get(kind)?.first();
      return entry ? entry.value(...args) : original(...args);
    };
  };
  if (typeof doSearch === "function") {
    const dispatcher = installFunctionDispatcher("single", doSearch);
    global.doSearch = dispatcher;
    try { doSearch = dispatcher; } catch (_) {}
  }
  if (typeof doAddVCF === "function") {
    const dispatcher = installFunctionDispatcher("add", doAddVCF);
    global.doAddVCF = dispatcher;
    try { doAddVCF = dispatcher; } catch (_) {}
  }

  document.getElementById("btn-multi-vcf")?.addEventListener("click", event => {
    const entry = searchHandlers.get("multi")?.first();
    if (!entry) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    Promise.resolve(entry.value({
      event,
      arr: global._getArr?.(),
      color: typeof getAColor === "function" ? getAColor() : 1,
    })).catch(error => {
      console.error("多組 VCF 處理器失敗", error);
      global.setStatus?.(`多組 VCF 搜尋失敗：${error?.message || error}`);
      if (typeof setBusy === "function") setBusy(false);
    });
  }, true);

  const style = document.createElement("style");
  style.id = "bb-compact-header-style";
  style.textContent = '#bitboard-architecture-panel:not(.bb-quick-actions){display:none!important}';
  document.head.appendChild(style);

  global.dispatchEvent(new CustomEvent("vcf-workbench-runtime-ready"));
})(window);
