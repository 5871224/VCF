"use strict";

// Apply the reuse preference to both attack stones and existing defender stones.
// Every newly built dead-four candidate must also reserve all of its five points
// as N points for both sides before any validation, auto-blocking, or final fill runs.
(function initGeneratorReuseBonus() {
  if (window.__generatorReuseBonusLoaded) return;
  window.__generatorReuseBonusLoaded = true;

  const bothN = GEN_NO_BLACK | GEN_NO_WHITE;

  function renameReuseControl() {
    const input = genEl("bonus-reuse");
    const label = input?.closest("label");
    if (!label) return;

    for (const node of label.childNodes) {
      if (node === input) break;
      if (node.nodeType === Node.TEXT_NODE) {
        node.nodeValue = "沿用棋子加成 ";
        break;
      }
    }
    label.title = "0% 不加權；攻方棋，以及死四模板 X 點或五點原有的守方棋，每沿用一顆都套用相同加成；100% 時每顆沿用棋使候選權重增加 99";
  }

  function protectCandidateFivePoints(candidate) {
    if (!candidate?.nMask) return;
    const points = new Set([
      candidate.fivePoint,
      ...Array.from(candidate.lineFivePoints || []),
    ]);
    for (const idx of points) {
      if (idx >= 0 && idx < 225) candidate.nMask[idx] |= bothN;
    }
  }

  renameReuseControl();

  const originalBuildLayerCandidates = genBuildLayerCandidates;
  genBuildLayerCandidates = function buildLayerCandidatesWithDefenderReuse(
    base,
    anchor,
    direction,
    sign,
    template,
    anchorSlot,
    attacker,
    rules,
    options
  ) {
    const candidates = originalBuildLayerCandidates(
      base,
      anchor,
      direction,
      sign,
      template,
      anchorSlot,
      attacker,
      rules,
      options
    );

    for (const candidate of candidates) {
      // Mark the current layer's only winning point immediately. For same-line
      // double fours, both winning points are protected. Later defender placement
      // therefore rejects them through the normal genIsNFor() checks.
      protectCandidateFivePoints(candidate);

      const reusedDefenders = new Set();

      // Template X endpoints may reuse defender stones already present on the board.
      for (const idx of candidate.xPoints || []) {
        if (
          idx >= 0 &&
          idx < 225 &&
          base.board[idx] === candidate.defender
        ) {
          reusedDefenders.add(idx);
        }
      }

      // A defender already on the template F (five) point is temporarily removed
      // while validating the route, but is still an existing reused stone.
      if ((candidate.removedDefenders || []).includes(candidate.fivePoint)) {
        reusedDefenders.add(candidate.fivePoint);
      }

      candidate.reusedDefenders = Array.from(reusedDefenders);
      candidate.weight += reusedDefenders.size * Math.max(0, Number(options?.reuseBonus) || 0);
    }

    return candidates;
  };

  const originalLayerRecord = genLayerRecord;
  genLayerRecord = function layerRecordWithDefenderReuse(candidate, step) {
    const record = originalLayerRecord(candidate, step);
    record.reusedDefenders = Array.from(candidate.reusedDefenders || []);
    return record;
  };
})();

// 題目產生器政策由 makevcf.html 依固定順序載入。

// The unified interface only needs one layout pass. Suppress the one global
// document.body child-list observer created by that interface, while leaving all
// feature-specific observers (button disabled state, rule state, settings, etc.) intact.
(function installUnifiedInterfaceObserverGuard() {
  if (window.__vcfUnifiedInterfaceObserverGuard || typeof window.MutationObserver !== "function") return;
  window.__vcfUnifiedInterfaceObserverGuard = true;

  const NativeMutationObserver = window.MutationObserver;
  let globalLayoutObserverSuppressed = false;

  function GuardedMutationObserver(callback) {
    const observer = new NativeMutationObserver(callback);
    const nativeObserve = observer.observe.bind(observer);

    observer.observe = function observeWithUnifiedInterfaceGuard(target, options) {
      const isGlobalLayoutObserver =
        !globalLayoutObserverSuppressed &&
        window.__compactVCFInterfaceLoaded &&
        target === document.body &&
        options?.childList === true &&
        options?.subtree === true &&
        options?.attributes !== true &&
        options?.characterData !== true;

      if (isGlobalLayoutObserver) {
        globalLayoutObserverSuppressed = true;
        window.MutationObserver = NativeMutationObserver;
        return;
      }
      return nativeObserve(target, options);
    };

    return observer;
  }

  GuardedMutationObserver.prototype = NativeMutationObserver.prototype;
  Object.setPrototypeOf(GuardedMutationObserver, NativeMutationObserver);
  window.MutationObserver = GuardedMutationObserver;
})();

const unifiedButtonLabelObservers = new WeakSet();

function ensureUnifiedButtonLabel(button, text) {
  if (!button) return false;

  const restore = () => {
    if (button.textContent.trim() !== text) button.textContent = text;
    button.setAttribute("aria-label", text);
    button.title ||= text;
  };
  restore();

  if (!unifiedButtonLabelObservers.has(button)) {
    unifiedButtonLabelObservers.add(button);
    new MutationObserver(restore).observe(button, {
      childList: true,
      subtree: true,
      characterData: true,
    });
  }
  return true;
}

function stabilizeUnifiedInterfaceSelectors() {
  const style = document.getElementById("vcf-unified-interface-style");
  if (style && style.dataset.tabStability !== "1") {
    style.textContent = style.textContent
      .replace(
        "#bitboard-architecture-panel{display:none!important}",
        "#bitboard-architecture-panel:not(.bb-quick-actions){display:none!important}",
      )
      .replace(
        ".vcf-setting-toggle:has(#vcf-show-calculation-settings){order:3}",
        ".vcf-setting-toggle.vcf-calculation-toggle{order:3}",
      )
      .replace(
        ".vcf-setting-toggle:has(#vcf-show-multi-settings){order:4}",
        ".vcf-setting-toggle.vcf-multi-toggle{order:4}",
      )
      .replace(
        ".vcf-setting-toggle:has(input:checked){border-color:#7798b9;background:#e8f0f8;color:#294f78}",
        ".vcf-setting-toggle.vcf-setting-toggle-active{border-color:#7798b9;background:#e8f0f8;color:#294f78}",
      );
    style.dataset.tabStability = "1";
  }

  let regressionStyle = document.getElementById("vcf-unified-regression-style");
  if (!regressionStyle) {
    regressionStyle = document.createElement("style");
    regressionStyle.id = "vcf-unified-regression-style";
    regressionStyle.textContent = `
      #bitboard-architecture-panel.bb-quick-actions {
        display: flex !important;
        visibility: visible !important;
        width: min(100%, 1180px) !important;
        margin: 0 auto 8px !important;
      }
      #btn-fast-vcf,
      #btn-shortest-vcf {
        color: #fff !important;
        -webkit-text-fill-color: #fff !important;
        font-family: inherit !important;
        font-size: 13px !important;
        line-height: 1.2 !important;
        text-indent: 0 !important;
        visibility: visible !important;
        opacity: 1 !important;
      }
    `;
    document.head.appendChild(regressionStyle);
  }

  const app = document.getElementById("vcf-app-shell");
  const quickActions = document.getElementById("bitboard-architecture-panel");
  if (app && quickActions?.classList.contains("bb-quick-actions") && quickActions.nextElementSibling !== app) {
    document.body.insertBefore(quickActions, app);
  }

  const calculation = document.getElementById("vcf-show-calculation-settings");
  const multi = document.getElementById("vcf-show-multi-settings");
  const sync = (input, className) => {
    const label = input?.closest("label");
    if (!label) return false;
    label.classList.add(className);
    label.classList.toggle("vcf-setting-toggle-active", Boolean(input.checked));
    return true;
  };

  const fastButton = document.getElementById("btn-fast-vcf");
  const shortestButton = document.getElementById("btn-shortest-vcf");
  ensureUnifiedButtonLabel(fastButton, "速找 VCF");
  ensureUnifiedButtonLabel(shortestButton, "最短 VCF");
  if (fastButton?.parentElement && shortestButton && shortestButton.previousElementSibling !== fastButton) {
    fastButton.insertAdjacentElement("afterend", shortestButton);
  }

  return Boolean(
    sync(calculation, "vcf-calculation-toggle") &&
    sync(multi, "vcf-multi-toggle") &&
    quickActions?.classList.contains("bb-quick-actions") &&
    ensureUnifiedButtonLabel(fastButton, "速找 VCF") &&
    ensureUnifiedButtonLabel(shortestButton, "最短 VCF")
  );
}

// 固定腳本順序會在本檔之後載入版面模組；這裡只負責同步既有控制項。
(function initializeUnifiedInterfaceSelectors() {
  stabilizeUnifiedInterfaceSelectors();
  let attempts = 0;
  const timer = window.setInterval(() => {
    attempts++;
    if (stabilizeUnifiedInterfaceSelectors() || attempts >= 160) {
      window.clearInterval(timer);
    }
  }, 50);
  document.addEventListener("change", event => {
    const input = event.target;
    if (
      input instanceof HTMLInputElement &&
      (input.id === "vcf-show-calculation-settings" || input.id === "vcf-show-multi-settings")
    ) {
      stabilizeUnifiedInterfaceSelectors();
    }
  }, true);
  window.addEventListener("load", stabilizeUnifiedInterfaceSelectors, { once: true });
})();
