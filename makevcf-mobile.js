"use strict";

// Keep the 15x15 board completely visible on narrow mobile screens.
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
