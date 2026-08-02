"use strict";

(function installShortestVcfUi(global) {
  const CHECKBOX_ID = "vcf-same-type-trim-live-four";
  const STORAGE_KEY = "vcf_same_type_trim_live_four";
  const multiButton = document.getElementById("btn-multi-vcf");
  if (!multiButton || document.getElementById("btn-shortest-vcf")) return;

  function normalizeGroupsKeepingLiveFour(groups, color) {
    const attacker = Number(color) === 2 ? 2 : 1;
    const defender = 3 - attacker;
    const seen = new Set();
    const processed = [];
    for (const source of Array.isArray(groups) ? groups : []) {
      const moves = Array.from(source || [])
        .filter(idx => Number.isInteger(idx) && idx >= 0 && idx < 225);
      if (!moves.length) continue;
      const key = moves
        .map((idx, index) => `${idx}:${(index & 1) ? defender : attacker}`)
        .sort()
        .join(",");
      if (seen.has(key)) continue;
      seen.add(key);
      processed.push(moves);
    }
    processed.sort((left, right) => left.length - right.length);
    return processed;
  }

  function storedChecked() {
    try {
      const value = localStorage.getItem(STORAGE_KEY);
      return value == null ? true : value !== "0";
    } catch (_) {
      return true;
    }
  }

  const label = document.createElement("label");
  label.id = "vcf-same-type-trim-live-four-label";
  label.title = "勾選：最後以活四取勝時，同型比較只取到活四前一手；未勾選：把活四落子也納入同型比較。";
  const sameTypeCheck = document.createElement("input");
  sameTypeCheck.id = CHECKBOX_ID;
  sameTypeCheck.type = "checkbox";
  sameTypeCheck.checked = storedChecked();
  sameTypeCheck.addEventListener("change", () => {
    try { localStorage.setItem(STORAGE_KEY, sameTypeCheck.checked ? "1" : "0"); } catch (_) {}
  });
  label.append(sameTypeCheck, document.createTextNode("同型-活四取前一手"));
  multiButton.insertAdjacentElement("afterend", label);

  global.vcfRegisterTrimGroupsProvider?.("live-four-grouping", options => {
    if (sameTypeCheck.checked) return undefined;
    return normalizeGroupsKeepingLiveFour(options?.groups, options?.color);
  }, 100);

  global.vcfRegisterStatusFormatter?.("live-four-grouping", message => {
    if (sameTypeCheck.checked) return message;
    return String(message)
      .replace("修剪活四尾步並去重", "保留活四尾步並去重")
      .replace(/→修剪後/g, "→同型整理後");
  }, 100);

  const button = document.createElement("button");
  button.id = "btn-shortest-vcf";
  button.type = "button";
  button.className = multiButton.className;
  button.textContent = "最短 VCF";
  label.insertAdjacentElement("afterend", button);

  global.vcfRegisterBusyHook?.("shortest-vcf", value => {
    button.disabled = Boolean(value);
    sameTypeCheck.disabled = Boolean(value);
  });

  const integerValue = (id, fallback, max) => {
    const parsed = Math.trunc(Number(document.getElementById(id)?.value));
    return Number.isFinite(parsed) ? Math.max(0, Math.min(max, parsed)) : fallback;
  };
  const packLimits = (seconds, millions) => (
    0x80000000 + seconds * 1024 + millions
  ) >>> 0;
  const formatInteger = value => Math.max(0, Math.round(Number(value) || 0)).toLocaleString("zh-TW");
  const showStatus = message => global.setStatus?.(message);

  button.addEventListener("click", async () => {
    const arr = global._getArr?.();
    if (!arr || !arr.slice(0, 225).some(value => value > 0)) {
      showStatus("請先擺好棋型");
      return;
    }

    const color = typeof getAColor === "function" ? getAColor() : 1;
    const colorName = color === 1 ? "黑" : "白";
    const encodedLimits = packLimits(
      integerValue("vcf-multi-time-seconds", 30, 2097151),
      integerValue("vcf-multi-node-millions", 20, 1023),
    );
    const started = performance.now();
    let timer = 0;

    if (typeof setBusy === "function") setBusy(true);
    global.vcfInvalidateAnalysis?.();
    const updateProgress = () => {
      const elapsedSeconds = ((performance.now() - started) / 1000).toFixed(1);
      showStatus(`正在搜尋 ${colorName}子最短 VCF……已執行 ${elapsedSeconds} 秒`);
    };

    try {
      updateProgress();
      timer = global.setInterval(updateProgress, 250);
      const info = await global.VCFBitboard.main.call("findShortestVCF", {
        arr: Array.from(arr).slice(0, 225),
        color,
        rules: global.VCFBitboard.rules,
        maxDepth: 200,
        maxNode: encodedLimits,
      });
      global.clearInterval(timer);
      timer = 0;

      const route = info?.winMoves?.[0] || [];
      const elapsedSeconds = (performance.now() - started) / 1000;
      const nodeCount = Number(info?.nodeCount || 0);
      const rate = elapsedSeconds > 0 ? nodeCount / elapsedSeconds : 0;
      const stats = `${elapsedSeconds.toFixed(4)} 秒，${formatInteger(nodeCount)} 節點，${formatInteger(rate)} 節點/秒`;

      if (route.length) {
        try { lastVCFMoves = route; } catch (_) {}
        global._showVCF?.(route, color);
        if (info.shortestProven) {
          showStatus(`${colorName}子最短 VCF：${route.length} 手；已完整證明 ${Math.max(0, route.length - 2)} 手以內無解（${stats}）`);
        } else {
          showStatus(`${colorName}子已找到 ${route.length} 手 VCF，但搜尋因限制中止，尚未證明為最短（${stats}）`);
        }
      } else if (info?.aborted) {
        showStatus(`${colorName}子在限制內未找到 VCF，搜尋尚未完整（${stats}）`);
      } else {
        showStatus(`${colorName}子在搜尋上限內無 VCF（${stats}）`);
      }
    } catch (error) {
      console.error("最短 VCF 搜尋失敗", error);
      showStatus(`最短 VCF 搜尋失敗：${error?.message || error}`);
    } finally {
      if (timer) global.clearInterval(timer);
      if (typeof setBusy === "function") setBusy(false);
    }
  });
})(window);
