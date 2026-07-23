"use strict";

(function installCompactWorkbenchHeader() {
  const install = () => {
    const panel = document.getElementById("bitboard-architecture-panel");
    if (!panel) return;

    panel.className = "bb-quick-actions";
    panel.innerHTML = `
      <a class="bb-lab-link" href="rapfi/lab.html">Rapfi 官方對照／棋型實驗室</a>
      <button id="bb-hard-refresh" type="button">強制重新整理</button>
    `;

    const style = document.createElement("style");
    style.textContent = `
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
    document.head.appendChild(style);

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
  };

  if (document.readyState === "complete") install();
  else window.addEventListener("load", install, { once: true });
})();
