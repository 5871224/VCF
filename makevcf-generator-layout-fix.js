"use strict";

// 題目產生器分頁的補充版面規則：
// - 速找／最短 VCF 使用黑色文字。
// - 不重複顯示「VCF 題目產生器」標題。
// - 產生、停止、顯示答案、顯示 N 點固定在產生器最上方。
// - 題庫固定併入產生器最下方。
(function installGeneratorRequestedLayout(global) {
  if (global.__generatorRequestedLayoutInstalled) return;
  global.__generatorRequestedLayoutInstalled = true;

  const style = document.createElement("style");
  style.dataset.generatorRequestedLayout = "true";
  style.textContent = `
    #btn-fast-vcf,
    #btn-shortest-vcf {
      color: #000 !important;
      -webkit-text-fill-color: #000 !important;
    }
    #btn-fast-vcf:hover:not(:disabled),
    #btn-shortest-vcf:hover:not(:disabled) {
      color: #000 !important;
      -webkit-text-fill-color: #000 !important;
    }
    #generator-panel > .gen-actions {
      width: 100%;
      margin: 0 0 10px !important;
    }
    #generator-panel .gen-title-row:empty {
      display: none !important;
    }
    #generator-panel #vcf-question-bank {
      width: 100%;
      max-width: none;
      margin: 12px 0 0;
    }
  `;
  document.head.appendChild(style);

  function removeRepeatedGeneratorTitle(panel) {
    panel.querySelectorAll("h1, h2, h3, .gen-title").forEach(element => {
      if (element.textContent.trim() === "VCF 題目產生器") element.remove();
    });

    const titleRow = panel.querySelector(".gen-title-row");
    if (
      titleRow &&
      !titleRow.querySelector("button, input, select, textarea, a") &&
      !titleRow.textContent.trim()
    ) {
      titleRow.hidden = true;
    }
  }

  function applyLayout() {
    const panel = document.getElementById("generator-panel");
    if (!panel) return false;

    removeRepeatedGeneratorTitle(panel);

    const actions = panel.querySelector(".gen-actions");
    if (actions && panel.firstElementChild !== actions) {
      panel.insertBefore(actions, panel.firstElementChild);
    }

    const bank = document.getElementById("vcf-question-bank");
    if (bank && bank.parentElement !== panel) panel.appendChild(bank);
    else if (bank && panel.lastElementChild !== bank) panel.appendChild(bank);

    return Boolean(actions && (!bank || bank.parentElement === panel));
  }

  let queued = false;
  const queueApply = () => {
    if (queued) return;
    queued = true;
    queueMicrotask(() => {
      queued = false;
      applyLayout();
    });
  };

  const observe = () => {
    if (!document.body) return;
    new MutationObserver(queueApply).observe(document.body, {
      childList: true,
      subtree: true,
    });
  };

  if (document.body) observe();
  else document.addEventListener("DOMContentLoaded", () => {
    observe();
    queueApply();
  }, { once: true });

  // 某些舊版介面會暫時攔截第一個全頁 MutationObserver；保留短期輪詢，
  // 確保 Supabase 題庫稍晚載入時仍會被移到產生器最下方。
  const started = Date.now();
  const timer = global.setInterval(() => {
    const complete = applyLayout();
    if (complete && Date.now() - started > 1500) global.clearInterval(timer);
    else if (Date.now() - started > 15000) global.clearInterval(timer);
  }, 100);

  queueApply();
  global.addEventListener("load", queueApply, { once: true });
})(window);
