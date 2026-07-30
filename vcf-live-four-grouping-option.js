"use strict";

// Workbench multi-VCF may optionally compare same-type routes at the move before
// a final open four. The problem generator always compares the complete route,
// including that final open-four move.
(function initVCFLiveFourGroupingOption() {
  if (window.__vcfLiveFourGroupingOptionLoaded) return;
  window.__vcfLiveFourGroupingOptionLoaded = true;

  const CHECKBOX_ID = "vcf-same-type-trim-live-four";
  const STORAGE_KEY = "vcf_same_type_trim_live_four";

  function normalizedGroupsWithLiveFour(groups, color) {
    const attacker = Number(color) === 2 ? 2 : 1;
    const defender = 3 - attacker;
    const seen = new Set();
    const processed = [];

    for (const source of Array.isArray(groups) ? groups : []) {
      const moves = Array.from(source || [])
        .filter(idx => Number.isInteger(idx) && idx >= 0 && idx < 225);
      if (!moves.length) continue;

      // Keep the final open-four move in the same-type key. Only the order of
      // equivalent attacker/defender stones is ignored, matching the existing
      // trimVCFGroups set comparison.
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

  function getCheckbox() {
    return document.getElementById(CHECKBOX_ID);
  }

  function shouldTrimWorkbenchLiveFour() {
    const checkbox = getCheckbox();
    return checkbox ? checkbox.checked : readCheckedDefault();
  }

  function installCheckbox() {
    if (getCheckbox()) return getCheckbox();
    const options = document.getElementById("vcf-search-options");
    if (!options) return null;

    const label = document.createElement("label");
    label.className = "vcf-option-check";
    label.title = "勾選：最後以活四取勝時，同型比較只取到活四前一手；未勾選：把活四落子也納入同型比較。";

    const checkbox = document.createElement("input");
    checkbox.id = CHECKBOX_ID;
    checkbox.type = "checkbox";
    checkbox.checked = readCheckedDefault();
    checkbox.addEventListener("change", () => {
      try { localStorage.setItem(STORAGE_KEY, checkbox.checked ? "1" : "0"); } catch (_) {}
    });

    label.appendChild(checkbox);
    label.appendChild(document.createTextNode("同型-活四取前一手"));

    const pruningLabel = document.getElementById("vcf-multi-pruning")?.closest("label");
    if (pruningLabel?.parentNode === options) pruningLabel.insertAdjacentElement("afterend", label);
    else options.appendChild(label);
    return checkbox;
  }

  function installWorkbenchOverride() {
    if (window.__vcfWorkbenchLiveFourGroupingWrapped) return true;
    if (typeof engine === "undefined" || !engine || typeof engine.trimVCFGroups !== "function") return false;

    const originalTrimVCFGroups = engine.trimVCFGroups.bind(engine);
    engine.trimVCFGroups = async function trimVCFGroupsBySelectedSameTypeMode(options = {}) {
      if (shouldTrimWorkbenchLiveFour()) return originalTrimVCFGroups(options);
      return normalizedGroupsWithLiveFour(options.groups, options.color);
    };

    window.__vcfWorkbenchLiveFourGroupingWrapped = true;
    return true;
  }

  function installGeneratorOverride() {
    if (window.__vcfGeneratorLiveFourGroupingWrapped) return true;
    if (typeof genEngine === "undefined" || !genEngine || typeof genEngine.trimGroups !== "function") return false;

    // Generator same-type comparison is fixed: never remove a final open-four
    // move, regardless of the workbench checkbox.
    genEngine.trimGroups = async function trimGeneratorGroupsKeepingLiveFour(_arr, groups, color) {
      return normalizedGroupsWithLiveFour(groups, color);
    };

    window.__vcfGeneratorLiveFourGroupingWrapped = true;
    return true;
  }

  function installBusyState() {
    if (window.__vcfLiveFourGroupingBusyWrapped) return true;
    if (typeof setBusy !== "function") return false;

    const originalSetBusy = setBusy;
    setBusy = function setBusyWithLiveFourOption(value) {
      originalSetBusy(value);
      const checkbox = getCheckbox();
      if (checkbox) checkbox.disabled = Boolean(value);
    };
    window.__vcfLiveFourGroupingBusyWrapped = true;
    return true;
  }

  function installStatusWording() {
    if (window.__vcfLiveFourGroupingStatusWrapped) return true;
    if (typeof setStatus !== "function") return false;

    const originalSetStatus = setStatus;
    setStatus = function setStatusWithLiveFourMode(text) {
      let message = String(text ?? "");
      if (!shouldTrimWorkbenchLiveFour()) {
        message = message
          .replace("修剪活四尾步並去重", "保留活四尾步並去重")
          .replace(/→修剪後/g, "→同型整理後");
      }
      originalSetStatus(message);
    };
    window.__vcfLiveFourGroupingStatusWrapped = true;
    return true;
  }

  function installAll() {
    installCheckbox();
    const complete = [
      installWorkbenchOverride(),
      installGeneratorOverride(),
      installBusyState(),
      installStatusWording(),
    ].every(Boolean);
    return complete;
  }

  if (!installAll()) {
    let attempts = 0;
    const timer = window.setInterval(() => {
      attempts++;
      if (installAll() || attempts >= 100) window.clearInterval(timer);
    }, 50);
  }
})();
