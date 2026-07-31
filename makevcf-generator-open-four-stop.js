"use strict";

// 統一多組型搜尋的使用者時間／節點限制，並提供可選的節點內支配剪枝：
// 同一盤面若已有直接五或活四勝法，只搜尋全部終局候選，
// 不再展開後面的單防死四分支。快速、嚴格模式共同適用。
(function initOpenFourStopOption(global) {
  if (global.__openFourStopOptionLoaded) return;
  global.__openFourStopOptionLoaded = true;

  const STORAGE_KEY = "vcf_stop_after_open_four";
  const CONTROL_ID = "vcf-stop-after-open-four";
  const PACKED_FLAG = 0x80000000;
  const OPEN_FOUR_FLAG = 0x40000000;
  const NODE_MASK = 0x000003ff;
  const MAX_TIME_SECONDS = 0x000fffff;
  const DEFAULT_TIME_SECONDS = 30;
  const DEFAULT_NODE_MILLIONS = 20;
  const LEGACY_UNLIMITED_NODES = 0xffffffff;

  function storageGet(key) {
    try {
      return global.localStorage?.getItem(key) ?? null;
    } catch (_) {
      return null;
    }
  }

  function storedEnabled() {
    return storageGet(STORAGE_KEY) === "1";
  }

  function control() {
    return global.document?.getElementById(CONTROL_ID) || null;
  }

  function enabled() {
    const input = control();
    return input ? input.checked : storedEnabled();
  }

  function clampInteger(value, min, max, fallback) {
    if (value == null || String(value).trim() === "") return fallback;
    const parsed = Math.trunc(Number(value));
    return Number.isFinite(parsed)
      ? Math.max(min, Math.min(max, parsed))
      : fallback;
  }

  function selectedSearchLimits() {
    const timeInput = global.document?.getElementById("vcf-multi-time-seconds") || null;
    const nodeInput = global.document?.getElementById("vcf-multi-node-millions") || null;
    const storedTime = storageGet("vcf_multi_time_seconds");
    const storedNodes = storageGet("vcf_multi_node_millions");

    // 在正式工作台／題目產生器使用欄位目前值；隔離測試或沒有介面的
    // 呼叫端則保留原本傳入值，避免憑空套用頁面預設。
    if (!timeInput && !nodeInput && storedTime == null && storedNodes == null) return null;

    return {
      timeSeconds: clampInteger(
        timeInput?.value ?? storedTime,
        0,
        MAX_TIME_SECONDS,
        DEFAULT_TIME_SECONDS,
      ),
      nodeMillions: clampInteger(
        nodeInput?.value ?? storedNodes,
        0,
        NODE_MASK,
        DEFAULT_NODE_MILLIONS,
      ),
    };
  }

  function normalizeTimeInput() {
    const input = global.document?.getElementById("vcf-multi-time-seconds");
    if (!input) return;
    input.max = String(MAX_TIME_SECONDS);
    if (!input.__openFourTimeLimitBound) {
      input.addEventListener("input", normalizeTimeInput);
      input.addEventListener("change", normalizeTimeInput);
      Object.defineProperty(input, "__openFourTimeLimitBound", { value: true });
    }
    const value = Math.trunc(Number(input.value));
    if (Number.isFinite(value) && value > MAX_TIME_SECONDS) {
      input.value = String(MAX_TIME_SECONDS);
      try {
        global.localStorage?.setItem("vcf_multi_time_seconds", input.value);
      } catch (_) {}
    }
  }

  function installControl() {
    const host = global.document?.getElementById("vcf-search-options");
    if (!host) return false;
    normalizeTimeInput();
    if (control()) return true;

    const label = global.document.createElement("label");
    label.className = "vcf-option-check";
    label.title = "同一盤面若有直接連五或活四勝法，只保留全部終局候選，不再搜尋其他死四延伸；快速與嚴格剪枝都適用。";

    const input = global.document.createElement("input");
    input.id = CONTROL_ID;
    input.type = "checkbox";
    input.checked = storedEnabled();
    input.addEventListener("change", () => {
      try {
        global.localStorage?.setItem(STORAGE_KEY, input.checked ? "1" : "0");
      } catch (_) {}
    });

    label.append(input, "活四不搜後續");
    const pruning = global.document.getElementById("vcf-multi-pruning")?.closest("label");
    if (pruning?.parentNode === host)
      pruning.insertAdjacentElement("afterend", label);
    else
      host.appendChild(label);
    return true;
  }

  function isMultiSearch(param) {
    const mode = param?.mode ?? param?.searchMode;
    if (mode === "single" || Number(mode) === 0) return false;
    if (mode === "multi" || mode === "shortest" || Number(mode) > 0) return true;
    return Number(param?.maxVCF || 1) > 1;
  }

  function encodeCallerLimits(value) {
    const numeric = Number(value);
    let encoded = Number.isFinite(numeric) ? Math.trunc(numeric) >>> 0 : 0;

    // 舊主橋接以 0xffffffff 表示不限節點；它的 bit 31 雖然為 1，
    // 但不是新版封裝值，必須先正規化成只有封裝旗標的不限格式。
    if (encoded === LEGACY_UNLIMITED_NODES) {
      return PACKED_FLAG;
    }
    if ((encoded & PACKED_FLAG) !== 0) return encoded;

    const unlimited = !Number.isFinite(numeric) || numeric <= 0;
    const nodeMillions = unlimited
      ? 0
      : Math.max(1, Math.min(NODE_MASK, Math.ceil(numeric / 1_000_000)));
    return (PACKED_FLAG | nodeMillions) >>> 0;
  }

  function encodeLimits(value, useOpenFourFlag) {
    const selected = selectedSearchLimits();
    let encoded;

    if (selected) {
      // 題目產生器舊流程即使仍傳入 500 萬等歷史預設，也必須以使用者
      // 現在設定的時間／節點欄位覆蓋，0 分別代表不限時間／不限節點。
      encoded = (
        PACKED_FLAG +
        selected.timeSeconds * 1024 +
        selected.nodeMillions
      ) >>> 0;
    } else {
      encoded = encodeCallerLimits(value);
    }

    // 每次請求都依目前勾選狀態重設 bit 30，避免沿用舊請求或超大時間值。
    encoded = (encoded & ~OPEN_FOUR_FLAG) >>> 0;
    if (useOpenFourFlag) encoded = (encoded | OPEN_FOUR_FLAG) >>> 0;
    return encoded;
  }

  function withOpenFourSetting(param) {
    if (!isMultiSearch(param)) return param;
    return { ...param, maxNode: encodeLimits(param?.maxNode, enabled()) };
  }

  function wrapMethod(target, name, transform) {
    const current = target?.[name];
    if (typeof current !== "function" || current.__openFourStopWrapped) return false;
    const wrapped = function(...args) {
      return current.apply(this, transform(args));
    };
    Object.defineProperty(wrapped, "__openFourStopWrapped", { value: true });
    target[name] = wrapped;
    return true;
  }

  function installApiWrappers() {
    const api = global.engineAPI;
    if (api) {
      wrapMethod(api, "send", args => {
        const [cmd, param] = args;
        return [cmd, cmd === "findVCF" || cmd === "getLevelPoints"
          ? withOpenFourSetting(param || {})
          : param];
      });
      wrapMethod(api, "poolGetLevelPoints", args => [withOpenFourSetting(args[0] || {})]);
    }

    if (global.genEngine) {
      wrapMethod(global.genEngine, "post", args => {
        const [cmd, param] = args;
        return [cmd, cmd === "findVCF" || cmd === "getLevelPoints"
          ? withOpenFourSetting(param || {})
          : param];
      });
    }

    if (typeof global.setBusy === "function" && !global.setBusy.__openFourStopWrapped) {
      const originalSetBusy = global.setBusy;
      const wrappedSetBusy = function(value) {
        const result = originalSetBusy.apply(this, arguments);
        const input = control();
        if (input) input.disabled = Boolean(value);
        return result;
      };
      Object.defineProperty(wrappedSetBusy, "__openFourStopWrapped", { value: true });
      global.setBusy = wrappedSetBusy;
    }
  }

  global.vcfStopAfterOpenFourEnabled = enabled;
  global.vcfGetSearchLimitSnapshot = selectedSearchLimits;
  global.vcfEncodeCurrentMultiLimits = value => encodeLimits(value, enabled());

  let rounds = 0;
  const timer = global.setInterval(() => {
    installControl();
    installApiWrappers();
    rounds++;
    if (rounds >= 600) global.clearInterval(timer);
  }, 100);

  installControl();
  installApiWrappers();
})(window);