"use strict";

// 多組 VCF 的可選節點內支配剪枝：
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

  function storedEnabled() {
    try {
      return global.localStorage?.getItem(STORAGE_KEY) === "1";
    } catch (_) {
      return false;
    }
  }

  function control() {
    return global.document?.getElementById(CONTROL_ID) || null;
  }

  function enabled() {
    const input = control();
    return input ? input.checked : storedEnabled();
  }

  function normalizeTimeInput() {
    const input = global.document?.getElementById("vcf-multi-time-seconds");
    if (!input) return;
    input.max = String(MAX_TIME_SECONDS);
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

  function encodeLimits(value) {
    const numeric = Number(value);
    let encoded = Number.isFinite(numeric) ? Math.trunc(numeric) >>> 0 : 0;

    if ((encoded & PACKED_FLAG) === 0) {
      const unlimited = !Number.isFinite(numeric) || numeric <= 0 || encoded === 0xffffffff;
      const nodeMillions = unlimited
        ? 0
        : Math.max(1, Math.min(NODE_MASK, Math.ceil(numeric / 1_000_000)));
      encoded = (PACKED_FLAG | nodeMillions) >>> 0;
    }
    return (encoded | OPEN_FOUR_FLAG) >>> 0;
  }

  function withOpenFourFlag(param) {
    if (!enabled() || !isMultiSearch(param)) return param;
    return { ...param, maxNode: encodeLimits(param?.maxNode) };
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
          ? withOpenFourFlag(param || {})
          : param];
      });
      wrapMethod(api, "poolGetLevelPoints", args => [withOpenFourFlag(args[0] || {})]);
    }

    if (global.genEngine) {
      wrapMethod(global.genEngine, "post", args => {
        const [cmd, param] = args;
        return [cmd, cmd === "findVCF" || cmd === "getLevelPoints"
          ? withOpenFourFlag(param || {})
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