"use strict";

(function installCompactWorkbenchHeader(global) {
  const ruleNames = { 0: "自由", 1: "無禁", 2: "有禁" };

  function installStyle() {
    let style = document.getElementById("bb-compact-header-style");
    if (!style) {
      style = document.createElement("style");
      style.id = "bb-compact-header-style";
      document.head.appendChild(style);
    }
    style.textContent = `
      #bitboard-architecture-panel:not(.bb-quick-actions){display:none!important}
      #bitboard-architecture-panel.bb-quick-actions{width:min(100%,1120px);display:flex;align-items:center;justify-content:flex-start;gap:8px;flex-wrap:wrap;padding:0;border:0;background:transparent;box-shadow:none}
      #bitboard-architecture-panel.bb-quick-actions .bb-lab-link,
      #bitboard-architecture-panel.bb-quick-actions #bb-hard-refresh{min-height:38px;display:inline-flex;align-items:center;justify-content:center;padding:8px 12px;border:1px solid #39744c;border-radius:6px;background:#fff;color:#19512d;font:inherit;font-size:13px;line-height:1.3;text-decoration:none;cursor:pointer}
      #bitboard-architecture-panel.bb-quick-actions #bb-hard-refresh:disabled{opacity:.65;cursor:wait}
    `;
  }

  function setRuleLabel(label, text) {
    for (const node of Array.from(label.childNodes)) {
      if (node.nodeType === Node.TEXT_NODE) node.remove();
    }
    label.appendChild(document.createTextNode(` ${text}`));
  }

  function installRuleOptions() {
    const ruleBox = document.getElementById("rule-box");
    if (!ruleBox || ruleBox.dataset.threeRulesReady === "1") return Boolean(ruleBox);

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
      label.append(radio, document.createTextNode(" 自由"));
      ruleBox.appendChild(label);
    }

    ruleBox.addEventListener("change", async event => {
      const radio = event.target;
      if (!(radio instanceof HTMLInputElement) || radio.name !== "rules" || !radio.checked) return;
      event.stopPropagation();
      const rules = Number(radio.value);
      if (!(rules in ruleNames)) return;
      const previous = Number(ruleBox.dataset.activeRules ?? 2);
      const success = await global.vcfSetRules?.(rules);
      if (success === false) {
        const fallback = ruleBox.querySelector(`input[name="rules"][value="${previous}"]`);
        if (fallback) fallback.checked = true;
      } else {
        ruleBox.dataset.activeRules = String(rules);
      }
    }, true);

    const selected = ruleBox.querySelector('input[name="rules"]:checked');
    ruleBox.dataset.activeRules = selected?.value || "2";
    ruleBox.dataset.threeRulesReady = "1";
    return true;
  }

  function installHeader() {
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
        if ("caches" in global) {
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
          try {
            const url = new URL(element.src || element.href, location.href);
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
  }

  installStyle();
  installRuleOptions();
  installHeader();
})(window);
