"use strict";

// Keep the 15x15 board completely visible on narrow mobile screens and provide
// lightweight responsive presentation rules shared by workbench overlays.
(function applyMobileBoardLayout() {
  const style = document.createElement("style");
  style.dataset.vcfMobileLayout = "true";
  style.textContent = `
    #board-svg {
      width: min(520px, calc(100vw - 24px));
      height: auto;
      aspect-ratio: 1 / 1;
      max-width: 100%;
      flex: 0 0 auto;
    }

    /* 圖片手順表只保留手順欄；黑點代表奇數黑手，白點代表偶數白手。 */
    #vcf-image-order-table th:nth-child(2),
    #vcf-image-order-table th:nth-child(3),
    #vcf-image-order-table td:nth-child(2),
    #vcf-image-order-table td:nth-child(3) {
      display: none;
    }

    #vcf-image-order-table tbody td:first-child {
      font-weight: 700;
    }

    #vcf-image-order-table tbody td:first-child::before {
      content: "";
      display: inline-block;
      width: 14px;
      height: 14px;
      margin-right: 7px;
      border-radius: 50%;
      vertical-align: -2px;
      box-sizing: border-box;
    }

    #vcf-image-order-table tbody tr:nth-child(odd) td:first-child::before {
      background: #111;
      border: 1px solid #111;
    }

    #vcf-image-order-table tbody tr:nth-child(even) td:first-child::before {
      background: #fff;
      border: 1px solid #555;
    }

    #vcf-image-order-table tbody tr.is-missing td:first-child {
      box-shadow: inset 0 0 0 2px rgba(190, 116, 0, 0.42);
    }

    @media (max-width: 600px) {
      body {
        padding: max(6px, env(safe-area-inset-top)) max(6px, env(safe-area-inset-right))
          max(6px, env(safe-area-inset-bottom)) max(6px, env(safe-area-inset-left));
        gap: 7px;
        overflow-x: hidden;
      }

      #board-svg {
        width: min(520px, calc(100vw - 12px - env(safe-area-inset-left) - env(safe-area-inset-right)));
      }

      #status,
      #generator-panel,
      #import-panel {
        width: 100%;
        max-width: 100%;
        min-width: 0;
      }

      #rule-box,
      #analysis-box,
      #btns,
      #btns2 {
        max-width: 100%;
      }
    }
  `;
  document.head.appendChild(style);
})();
