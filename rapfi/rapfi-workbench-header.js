"use strict";

(function installCompactWorkbenchHeader() {
  const styleId = "bb-compact-header-style";
  let style = document.getElementById(styleId);
  if (!style) {
    style = document.createElement("style");
    style.id = styleId;
    document.head.appendChild(style);
  }
  style.textContent = `
    #bitboard-architecture-panel:not(.bb-quick-actions) {
      display: none !important;
    }
    #bitboard-architecture-panel.bb-quick-actions {
      width: min(100%, 1120px);
      display: flex;
      align-items: center;
      justify-content: flex-start;
      gap: 8px;
      flex-wrap: wrap;
      padding: 0;
      border: 0;
      border-radius: 0;
      background: transparent;
      box-shadow: none;
    }
    #bitboard-architecture-panel.bb-quick-actions .bb-lab-link,
    #bitboard-architecture-panel.bb-quick-actions #bb-hard-refresh {
      min-height: 38px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 8px 12px;
      border: 1px solid #39744c;
      border-radius: 6px;
      background: #fff;
      color: #19512d;
      font: inherit;
      font-size: 13px;
      line-height: 1.3;
      text-decoration: none;
      cursor: pointer;
    }
    #bitboard-architecture-panel.bb-quick-actions #bb-hard-refresh:disabled {
      opacity: .65;
      cursor: wait;
    }
  `;

  const ruleNames = {
    0: "自由",
    1: "無禁",
    2: "有禁",
  };

  const setRuleLabel = (label, text) => {
    for (const node of Array.from(label.childNodes)) {
      if (node.nodeType === Node.TEXT_NODE) node.remove();
    }
    label.appendChild(document.createTextNode(` ${text}`));
  };

  const installRuleOptions = () => {
    const ruleBox = document.getElementById("rule-box");
    if (!ruleBox) return false;
    if (ruleBox.dataset.threeRulesReady === "1") return true;

    for (const radio of ruleBox.querySelectorAll('input[name="rules"]')) {
      const label = radio.closest("label");
      const name = ruleNames[Number(radio.value)];
      if (label && name) setRuleLabel(label, name);
    }

    if (!ruleBox.querySelector('input[name="rules"][value="0"]')) {
      const label = document.createElement("label");
      const radio = document.createElement("input");
      radio.type = "radio";
      radio.name = "rules";
      radio.value = "0";
      label.appendChild(radio);
      label.appendChild(document.createTextNode(" 自由"));
      ruleBox.appendChild(label);
    }

    // 以捕捉階段統一接管三個規則，避免新增的「自由」沒有原頁面的 change 事件。
    ruleBox.addEventListener("change", async event => {
      const radio = event.target;
      if (!(radio instanceof HTMLInputElement) || radio.name !== "rules" || !radio.checked) return;
      event.stopPropagation();

      if (typeof searching !== "undefined" && searching) return;
      const rules = Number(radio.value);
      if (!(rules in ruleNames)) return;

      if (typeof setStatus === "function") setStatus("正在切換規則...");
      try {
        const tasks = [];
        if (typeof engine !== "undefined" && engine && typeof engine.setRules === "function") {
          tasks.push(engine.setRules(rules));
        }
        if (typeof pool !== "undefined" && pool && typeof pool.setRules === "function") {
          tasks.push(pool.setRules(rules));
        }
        await Promise.all(tasks);
        if (typeof setStatus === "function") setStatus(`${ruleNames[rules]}，就緒`);
        window.dispatchEvent(new CustomEvent("vcf-rule-changed", { detail: { rules } }));
      } catch (error) {
        console.error(error);
        if (typeof setStatus === "function") {
          setStatus(`切換規則失敗：${error?.message || error}`);
        }
      }
    }, true);

    ruleBox.dataset.threeRulesReady = "1";
    return true;
  };

  const install = () => {
    const panel = document.getElementById("bitboard-architecture-panel");
    if (!panel) return false;
    if (panel.dataset.compactHeaderReady === "1") return true;

    panel.className = "bb-quick-actions";
    panel.dataset.compactHeaderReady = "1";
    panel.innerHTML = `
      <a class="bb-lab-link" href="rapfi/lab.html">Rapfi 官方對照／棋型實驗室</a>
      <button id="bb-hard-refresh" type="button">強制重新整理</button>
    `;

    const refreshButton = panel.querySelector("#bb-hard-refresh");
    refreshButton.addEventListener("click", async () => {
      refreshButton.disabled = true;
      refreshButton.textContent = "強制更新中……";

      try {
        if ("caches" in window) {
          const cacheNames = await caches.keys();
          await Promise.all(cacheNames.map(name => caches.delete(name)));
        }

        const urls = new Set();
        for (const entry of performance.getEntriesByType("resource")) {
          try {
            const url = new URL(entry.name, location.href);
            if (url.origin === location.origin) urls.add(url.href);
          } catch (_) {}
        }
        document.querySelectorAll("script[src], link[rel='stylesheet'][href]").forEach(element => {
          const source = element.src || element.href;
          if (!source) return;
          try {
            const url = new URL(source, location.href);
            if (url.origin === location.origin) urls.add(url.href);
          } catch (_) {}
        });

        await Promise.allSettled(Array.from(urls, url => fetch(url, {
          cache: "reload",
          credentials: "same-origin",
        })));
      } catch (error) {
        console.warn("強制重新整理前的快取更新失敗，仍繼續重新載入。", error);
      }

      const url = new URL(location.href);
      url.searchParams.set("_refresh", String(Date.now()));
      location.replace(url.href);
    });
    return true;
  };

  installRuleOptions();
  if (install()) return;

  const observer = new MutationObserver(() => {
    installRuleOptions();
    if (install()) observer.disconnect();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });

  window.addEventListener("load", () => {
    installRuleOptions();
    install();
    observer.disconnect();
  }, { once: true });
})();