"use strict";

// Remember every user-adjustable setting in the main workbench and generator.
// All setting controls are loaded in a fixed order before this module runs.
(function initVCFUserSettingPersistence(global) {
  if (global.__vcfUserSettingPersistenceLoaded) return;
  global.__vcfUserSettingPersistenceLoaded = true;

  const STORAGE_PREFIX = "vcf_user_setting_v1:";
  const ROOT_SELECTORS = [
    "#rule-box",
    "#analysis-box",
    "#vcf-search-options",
    "#generator-panel",
  ];
  const CONTROL_SELECTOR = [
    'input:not([type="button"]):not([type="submit"]):not([type="reset"]):not([type="file"]):not([type="hidden"]):not([type="image"])',
    "select",
    "textarea",
  ].join(",");

  const boundControls = new WeakSet();

  function storageGet(key) {
    try {
      return global.localStorage?.getItem(key) ?? null;
    } catch (_) {
      return null;
    }
  }

  function storageSet(key, value) {
    try {
      global.localStorage?.setItem(key, value);
    } catch (_) {}
  }

  function settingRoot(control) {
    for (const selector of ROOT_SELECTORS) {
      const root = control.closest?.(selector);
      if (root) return root;
    }
    return null;
  }

  function settingIdentity(control) {
    const root = settingRoot(control);
    if (!root) return null;
    const rootName = root.id || root.tagName.toLowerCase();
    const type = String(control.type || control.tagName || "").toLowerCase();

    if (type === "radio") {
      if (!control.name) return null;
      return `${rootName}:radio:${control.name}`;
    }
    if (control.id) return `${rootName}:id:${control.id}`;
    if (control.name) return `${rootName}:name:${control.name}`;
    return null;
  }

  function storageKey(control) {
    const identity = settingIdentity(control);
    return identity ? STORAGE_PREFIX + identity : null;
  }

  function isEligible(control) {
    if (!control?.matches?.(CONTROL_SELECTOR)) return false;
    if (!settingRoot(control)) return false;
    const type = String(control.type || "").toLowerCase();
    return type !== "password";
  }

  function currentValue(control) {
    const type = String(control.type || "").toLowerCase();
    if (type === "checkbox") return control.checked ? "1" : "0";
    if (type === "radio") return control.checked ? String(control.value) : null;
    return String(control.value ?? "");
  }

  function scheduleChange(control) {
    queueMicrotask(() => control.dispatchEvent(new Event("change", { bubbles: true })));
  }

  function applyStoredValue(control, raw, notify = true) {
    if (raw == null) return false;
    const type = String(control.type || "").toLowerCase();
    let changed = false;

    if (type === "checkbox") {
      const next = raw === "1" || raw === "true";
      changed = control.checked !== next;
      control.checked = next;
    } else if (type === "radio") {
      if (String(control.value) !== raw) return false;
      changed = !control.checked;
      control.checked = true;
    } else if (control.tagName === "SELECT") {
      const exists = Array.from(control.options || []).some(option => String(option.value) === raw);
      if (!exists) return false;
      changed = String(control.value) !== raw;
      control.value = raw;
    } else if (type === "number" || type === "range") {
      const parsed = Number(raw);
      if (!Number.isFinite(parsed)) return false;
      let next = parsed;
      const min = Number(control.min);
      const max = Number(control.max);
      if (control.min !== "" && Number.isFinite(min)) next = Math.max(min, next);
      if (control.max !== "" && Number.isFinite(max)) next = Math.min(max, next);
      const text = String(next);
      changed = String(control.value) !== text;
      control.value = text;
    } else {
      changed = String(control.value) !== raw;
      control.value = raw;
    }

    if (changed && notify) scheduleChange(control);
    return changed;
  }

  function saveControl(control) {
    const key = storageKey(control);
    if (!key) return;
    const value = currentValue(control);
    if (value != null) storageSet(key, value);
  }

  function restoreControl(control, notify = true) {
    const key = storageKey(control);
    if (!key) return false;
    return applyStoredValue(control, storageGet(key), notify);
  }

  function seedControl(control) {
    const key = storageKey(control);
    if (!key || storageGet(key) != null) return;
    saveControl(control);
  }

  function bindControl(control) {
    if (!isEligible(control) || boundControls.has(control)) return;
    boundControls.add(control);

    const save = () => saveControl(control);
    control.addEventListener("change", save);
    if (String(control.type || "").toLowerCase() !== "radio") {
      control.addEventListener("input", save);
    }

    restoreControl(control);
    seedControl(control);
  }

  function scanControls(root = global.document) {
    if (!root?.querySelectorAll) return;
    if (root.matches?.(CONTROL_SELECTOR)) bindControl(root);
    root.querySelectorAll(CONTROL_SELECTOR).forEach(bindControl);
  }

  function restoreAll() {
    ROOT_SELECTORS.forEach(selector => {
      const root = global.document?.querySelector(selector);
      if (!root) return;
      scanControls(root);
      root.querySelectorAll(CONTROL_SELECTOR).forEach(control => restoreControl(control));
    });
  }

  global.addEventListener("storage", event => {
    if (!event.key?.startsWith(STORAGE_PREFIX)) return;
    restoreAll();
  });

  const initialize = () => {
    scanControls();
    restoreAll();
  };
  initialize();
  global.addEventListener("DOMContentLoaded", initialize, { once: true });
  global.addEventListener("load", initialize, { once: true });
})(window);
