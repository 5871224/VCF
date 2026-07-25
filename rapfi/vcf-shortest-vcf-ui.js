"use strict";

(function installShortestVcfUi() {
  let attempts = 0;

  const init = () => {
    const multiButton = document.getElementById("btn-multi-vcf");
    if (!multiButton || !window.VCFBitboard?.main) {
      if (attempts++ < 200) window.setTimeout(init, 50);
      return;
    }
    if (document.getElementById("btn-shortest-vcf")) return;

    const button = document.createElement("button");
    button.id = "btn-shortest-vcf";
    button.type = "button";
    button.className = multiButton.className;
    button.textContent = "最短 VCF";
    multiButton.insertAdjacentElement("afterend", button);

    if (typeof setBusy === "function") {
      const baseSetBusy = setBusy;
      setBusy = function(value) {
        baseSetBusy(value);
        button.disabled = Boolean(value);
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
    const formatNodes = value => `${Number(value || 0).toLocaleString("zh-TW")} 節點`;
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
        const elapsedText = `${((performance.now() - started) / 1000).toFixed(3)} 秒`;
        const statsText = `${elapsedText}，${formatNodes(info?.nodeCount)}`;

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
