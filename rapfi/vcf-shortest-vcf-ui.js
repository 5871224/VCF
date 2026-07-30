"use strict";

(function installShortestVcfUi() {
  const CHECKBOX_ID = "vcf-same-type-trim-live-four";
  const STORAGE_KEY = "vcf_same_type_trim_live_four";
  let attempts = 0;

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
        .map((idx, i) => `${idx}:${(i & 1) ? defender : attacker}`)
        .sort()
        .join(",");
      if (seen.has(key)) continue;
      seen.add(key);
      processed.push(moves);
    }

    processed.sort((a, b) => a.length - b.length);
    return processed;
  }

  function readCheckedDefault() {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      return stored == null ? true : stored !== "0";
    } catch (_) {
      return true;
    }
  }

  const init = () => {
    const multiButton = document.getElementById("btn-multi-vcf");
    if (!multiButton || !window.VCFBitboard?.main || typeof engine === "undefined") {
      if (attempts++ < 200) window.setTimeout(init, 50);
      return;
    }
    if (document.getElementById("btn-shortest-vcf")) return;

    let sameTypeCheck = document.getElementById(CHECKBOX_ID);
    if (!sameTypeCheck) {
      const label = document.createElement("label");
      label.id = "vcf-same-type-trim-live-four-label";
      label.title = "勾選：最後以活四取勝時，同型比較只取到活四前一手；未勾選：把活四落子也納入同型比較。";
      Object.assign(label.style, {
        display: "inline-flex",
        alignItems: "center",
        gap: "5px",
        padding: "7px 9px",
        border: "1px solid #aaa",
        borderRadius: "5px",
        background: "#fff",
        fontSize: "13px",
        cursor: "pointer",
      });

      sameTypeCheck = document.createElement("input");
      sameTypeCheck.id = CHECKBOX_ID;
      sameTypeCheck.type = "checkbox";
      sameTypeCheck.checked = readCheckedDefault();
      sameTypeCheck.addEventListener("change", () => {
        try { localStorage.setItem(STORAGE_KEY, sameTypeCheck.checked ? "1" : "0"); } catch (_) {}
      });

      label.appendChild(sameTypeCheck);
      label.appendChild(document.createTextNode("同型-活四取前一手"));
      multiButton.insertAdjacentElement("afterend", label);
    }

    if (!window.__vcfWorkbenchLiveFourGroupingWrapped && typeof engine.trimVCFGroups === "function") {
      const originalTrimVCFGroups = engine.trimVCFGroups.bind(engine);
      engine.trimVCFGroups = async function trimVCFGroupsBySelectedSameTypeMode(options = {}) {
        if (sameTypeCheck.checked) return originalTrimVCFGroups(options);
        return normalizeGroupsKeepingLiveFour(options.groups, options.color);
      };
      window.__vcfWorkbenchLiveFourGroupingWrapped = true;
    }

    if (!window.__vcfLiveFourGroupingStatusWrapped && typeof setStatus === "function") {
      const originalSetStatus = setStatus;
      setStatus = function setStatusWithLiveFourMode(text) {
        let message = String(text ?? "");
        if (!sameTypeCheck.checked) {
          message = message
            .replace("修剪活四尾步並去重", "保留活四尾步並去重")
            .replace(/→修剪後/g, "→同型整理後");
        }
        originalSetStatus(message);
      };
      window.__vcfLiveFourGroupingStatusWrapped = true;
    }

    const button = document.createElement("button");
    button.id = "btn-shortest-vcf";
    button.type = "button";
    button.className = multiButton.className;
    button.textContent = "最短 VCF";
    const optionLabel = sameTypeCheck.closest("label");
    if (optionLabel) optionLabel.insertAdjacentElement("afterend", button);
    else multiButton.insertAdjacentElement("afterend", button);

    if (typeof setBusy === "function") {
      const baseSetBusy = setBusy;
      setBusy = function(value) {
        baseSetBusy(value);
        button.disabled = Boolean(value);
        sameTypeCheck.disabled = Boolean(value);
      };
    }

    const integerValue = (id, fallback, max) => {
      const raw = document.getElementById(id)?.value;
      const parsed = Math.trunc(Number(raw));
      return Number.isFinite(parsed) ? Math.max(0, Math.min(max, parsed)) : fallback;
    };
    const packLimits = (seconds, millions) => (
      0x80000000 + seconds * 1024 + millions
    ) >>> 0;
    const formatInteger = value => {
      const number = Number(value);
      return Math.max(0, Math.round(Number.isFinite(number) ? number : 0)).toLocaleString("zh-TW");
    };
    const formatNodes = value => `${formatInteger(value)} 節點`;
    const formatRate = (nodes, elapsedSeconds) => {
      const rate = elapsedSeconds > 0 ? Number(nodes || 0) / elapsedSeconds : 0;
      return `${formatInteger(rate)} 節點/秒`;
    };
    const showStatus = message => {
      if (typeof setStatus === "function") setStatus(message);
      else console.log(message);
    };

    button.addEventListener("click", async event => {
      event.preventDefault();
      event.stopImmediatePropagation();

      const arr = window._getArr?.();
      if (!arr || !arr.slice(0, 225).some(value => value > 0)) {
        showStatus("請先擺好棋型");
        return;
      }

      const color = typeof getAColor === "function" ? getAColor() : 1;
      const colorName = color === 1 ? "黑" : "白";
      const seconds = integerValue("vcf-multi-time-seconds", 30, 2097151);
      const millions = integerValue("vcf-multi-node-millions", 20, 1023);
      const encodedLimits = packLimits(seconds, millions);
      const started = performance.now();
      let timer = 0;

      if (typeof setBusy === "function") setBusy(true);
      button.disabled = true;
      window._clearVCF?.();
      window._clearAnalysis?.();
      if (typeof resetVcfGroups === "function") resetVcfGroups();

      const updateProgress = () => {
        const elapsedSeconds = ((performance.now() - started) / 1000).toFixed(1);
        showStatus(`正在搜尋 ${colorName}子最短 VCF……已執行 ${elapsedSeconds} 秒`);
      };

      try {
        updateProgress();
        timer = window.setInterval(updateProgress, 250);
        const info = await window.VCFBitboard.main.call("findShortestVCF", {
          arr: Array.from(arr).slice(0, 225),
          color,
          rules: window.VCFBitboard.rules,
          maxDepth: 200,
          maxNode: encodedLimits,
        });
        window.clearInterval(timer);
        timer = 0;

        const route = info?.winMoves?.[0] || [];
        const elapsedSeconds = (performance.now() - started) / 1000;
        const nodeCount = Number(info?.nodeCount || 0);
        const statsText = `${elapsedSeconds.toFixed(4)} 秒，${formatNodes(nodeCount)}，${formatRate(nodeCount, elapsedSeconds)}`;

        if (route.length) {
          try { lastVCFMoves = route; } catch (_) {}
          window._showVCF?.(route, color);
          if (info.shortestProven) {
            const shorterBound = Math.max(0, route.length - 2);
            showStatus(`${colorName}子最短 VCF：${route.length} 手；已完整證明 ${shorterBound} 手以內無解（${statsText}）`);
          } else {
            showStatus(`${colorName}子已找到 ${route.length} 手 VCF，但搜尋因限制中止，尚未證明為最短（${statsText}）`);
          }
        } else if (info?.aborted) {
          showStatus(`${colorName}子在限制內未找到 VCF，搜尋尚未完整（${statsText}）`);
        } else {
          showStatus(`${colorName}子在搜尋上限內無 VCF（${statsText}）`);
        }
      } catch (error) {
        console.error(error);
        showStatus(`最短 VCF 搜尋失敗：${error?.message || error}`);
      } finally {
        if (timer) window.clearInterval(timer);
        if (typeof setBusy === "function") setBusy(false);
        button.disabled = false;
      }
    }, true);
  };

  init();
})();
