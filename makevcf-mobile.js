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

// These file names match the Pages makevcf-generator-*.js copy rule.
(function loadImageImportRuntimeFixes() {
  function loadScript(src, marker) {
    return new Promise((resolve, reject) => {
      const existing = document.querySelector(`script[data-vcf-image-import-fix="${marker}"]`);
      if (existing) {
        if (existing.dataset.loaded === "true") resolve();
        else {
          existing.addEventListener("load", resolve, { once: true });
          existing.addEventListener("error", reject, { once: true });
        }
        return;
      }
      const script = document.createElement("script");
      script.src = src;
      script.async = false;
      script.dataset.vcfImageImportFix = marker;
      script.addEventListener("load", () => {
        script.dataset.loaded = "true";
        resolve();
      }, { once: true });
      script.addEventListener("error", reject, { once: true });
      document.body.appendChild(script);
    });
  }

  loadScript("makevcf-generator-image-import-fix.js", "base")
    .then(() => loadScript("makevcf-generator-image-import-fix-v2.js", "hough-v2"))
    .catch(error => console.error("圖片匯入修正載入失敗", error));
})();

// 延伸層的別組 VCF 補守修正會自行等待題目產生器驗證政策安裝完成。
(function loadExtensionOtherVCFBlockingFix() {
  if (document.querySelector('script[data-vcf-extension-other-vcf-fix="true"]')) {
    return;
  }
  const script = document.createElement("script");
  script.src = "makevcf-generator-extension-other-vcf-fix.js";
  script.async = false;
  script.dataset.vcfExtensionOtherVcfFix = "true";
  script.addEventListener(
    "error",
    () => console.error("延伸層別組 VCF 補守修正載入失敗"),
    { once: true },
  );
  document.body.appendChild(script);
})();

// 詳細狀態模組只改寫顯示文字，會自行等待所有題目產生驗證修正安裝完成。
(function loadGeneratorDetailedStatus() {
  if (document.querySelector('script[data-vcf-generator-status-detail="true"]')) {
    return;
  }
  const script = document.createElement("script");
  script.src = "makevcf-generator-status-detail.js";
  script.async = false;
  script.dataset.vcfGeneratorStatusDetail = "true";
  script.addEventListener(
    "error",
    () => console.error("題目產生詳細狀態模組載入失敗"),
    { once: true },
  );
  document.body.appendChild(script);
})();
