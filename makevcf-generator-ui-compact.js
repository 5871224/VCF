"use strict";

// Keep the existing feature IDs and rule radio state for compatibility, while
// presenting a simpler card layout and one visible rule selector.
(function initCompactVCFInterface() {
  if (window.__compactVCFInterfaceLoaded) return;
  window.__compactVCFInterfaceLoaded = true;

  const RULE_SELECT_ID = "vcf-rule-select";
  const STYLE_ID = "vcf-compact-interface-style";
  const RULE_NAMES = {
    2: "有禁",
    1: "無禁",
    0: "自由",
  };

  function installStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      .vcf-control-stack {
        grid-template-columns: 1fr !important;
      }
      .vcf-search-card > .vcf-option-row,
      .vcf-search-card > #vcf-search-options {
        margin-bottom: 9px;
      }
      .vcf-search-card > .vcf-action-grid + .vcf-action-grid {
        margin-top: 8px;
      }
      #rule-box .vcf-rule-select-label {
        display: inline-flex;
        align-items: center;
        gap: 7px;
        min-height: 36px;
        padding: 6px 10px;
        border: 1px solid #ddd2b5;
        border-radius: 8px;
        background: #faf6e9;
        font-size: 14px;
        font-weight: 600;
        white-space: nowrap;
      }
      #${RULE_SELECT_ID} {
        min-width: 104px;
        padding: 6px 30px 6px 9px;
        border: 1px solid #bdb397;
        border-radius: 6px;
        background: #fff;
        color: inherit;
        font: inherit;
        cursor: pointer;
      }
      #${RULE_SELECT_ID}:disabled {
        opacity: .58;
        cursor: default;
      }
      @media (max-width: 600px) {
        #rule-box .vcf-rule-select-label {
          min-height: 34px;
          padding: 5px 8px;
          font-size: 13px;
        }
      }
    `;
    document.head.appendChild(style);
  }

  function ensureRuleRadio(ruleBox, value) {
    let radio = ruleBox.querySelector(`input[name="rules"][value="${value}"]`);
    if (radio) return radio;

    const label = document.createElement("label");
    radio = document.createElement("input");
    radio.type = "radio";
    radio.name = "rules";
    radio.value = String(value);
    label.append(radio, document.createTextNode(` ${RULE_NAMES[value]}`));
    ruleBox.appendChild(label);
    return radio;
  }

  async function applyRuleDirectly(rules) {
    if (typeof searching !== "undefined" && searching) return false;
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
      if (typeof setStatus === "function") setStatus(`${RULE_NAMES[rules]}，就緒`);
      window.dispatchEvent(new CustomEvent("vcf-rule-changed", { detail: { rules } }));
      return true;
    } catch (error) {
      console.error(error);
      if (typeof setStatus === "function") {
        setStatus(`切換規則失敗：${error?.message || error}`);
      }
      return false;
    }
  }

  function installRuleSelect(ruleBox) {
    const existing = document.getElementById(RULE_SELECT_ID);
    if (existing) return existing;

    for (const value of [2, 1, 0]) ensureRuleRadio(ruleBox, value);
    const radios = Array.from(ruleBox.querySelectorAll('input[name="rules"]'));
    const current = radios.find(radio => radio.checked) || radios.find(radio => radio.value === "2");

    const compatibility = document.createElement("span");
    compatibility.className = "vcf-rule-radio-compat";
    compatibility.hidden = true;
    for (const radio of radios) {
      const label = radio.closest("label");
      if (label && label.parentNode === ruleBox) compatibility.appendChild(label);
    }

    const visibleLabel = document.createElement("label");
    visibleLabel.className = "vcf-rule-select-label";
    visibleLabel.appendChild(document.createTextNode("規則"));

    const select = document.createElement("select");
    select.id = RULE_SELECT_ID;
    select.setAttribute("aria-label", "規則");
    for (const value of [2, 1, 0]) {
      const option = document.createElement("option");
      option.value = String(value);
      option.textContent = RULE_NAMES[value];
      select.appendChild(option);
    }
    select.value = current?.value || "2";
    visibleLabel.appendChild(select);

    for (const node of Array.from(ruleBox.childNodes)) {
      if (node.nodeType === Node.TEXT_NODE && !node.textContent.trim()) node.remove();
    }
    ruleBox.append(visibleLabel, compatibility);

    select.addEventListener("change", async () => {
      const previous = radios.find(radio => radio.checked)?.value || "2";
      const selected = ruleBox.querySelector(`input[name="rules"][value="${select.value}"]`);
      if (!selected) {
        select.value = previous;
        return;
      }

      if (typeof searching !== "undefined" && searching) {
        select.value = previous;
        return;
      }

      selected.checked = true;
      // /rapfi/ delegates all three rules from rule-box. The root page's original
      // listeners only know the two original radios, so free rule uses the same
      // engine/pool operation directly there.
      if (ruleBox.dataset.threeRulesReady === "1" || selected.value !== "0") {
        selected.dispatchEvent(new Event("change", { bubbles: true }));
      } else {
        const applied = await applyRuleDirectly(Number(selected.value));
        if (!applied) {
          const fallback = ruleBox.querySelector(`input[name="rules"][value="${previous}"]`);
          if (fallback) fallback.checked = true;
          select.value = previous;
        }
      }
    });

    ruleBox.addEventListener("change", event => {
      const radio = event.target;
      if (radio instanceof HTMLInputElement && radio.name === "rules" && radio.checked) {
        select.value = radio.value;
      }
    });

    const syncDisabled = () => {
      select.disabled = radios.some(radio => radio.disabled);
    };
    syncDisabled();
    const observer = new MutationObserver(syncDisabled);
    observer.observe(compatibility, {
      subtree: true,
      attributes: true,
      attributeFilter: ["disabled"],
    });

    return select;
  }

  function removeHeadingDescriptions(app) {
    app.querySelectorAll(".vcf-app-header p, .vcf-card-heading p").forEach(element => element.remove());
  }

  function mergeSearchCards(app) {
    const searchCard = app.querySelector(".vcf-search-card");
    const analysisCard = app.querySelector(".vcf-analysis-card");
    const ruleBox = document.getElementById("rule-box");
    const mainActions = document.getElementById("btns");
    const analysisBox = document.getElementById("analysis-box");
    const searchOptions = document.getElementById("vcf-search-options");
    const analysisActions = document.getElementById("btns2");
    if (!searchCard || !ruleBox || !mainActions || !analysisBox || !analysisActions) return false;

    const heading = searchCard.querySelector(".vcf-card-heading h2");
    if (heading) heading.textContent = "搜尋與分析";

    // Keep every original container and ID so existing and later-loaded handlers
    // continue to work. In particular, vcf-search-options contains the former
    // advanced settings (pruning, time, node and add-search mode) and must be moved
    // before the old analysis card is removed.
    searchCard.append(ruleBox, analysisBox);
    if (searchOptions) searchCard.append(searchOptions);
    searchCard.append(mainActions, analysisActions);
    if (analysisCard) analysisCard.remove();
    return true;
  }

  function install() {
    const app = document.getElementById("vcf-app-shell");
    const ruleBox = document.getElementById("rule-box");
    if (!app || !ruleBox) return false;
    if (app.dataset.compactInterfaceReady === "1") return true;

    installStyle();
    removeHeadingDescriptions(app);
    if (!mergeSearchCards(app)) return false;
    installRuleSelect(ruleBox);

    app.dataset.compactInterfaceReady = "1";
    return true;
  }

  if (install()) return;

  let attempts = 0;
  const timer = window.setInterval(() => {
    attempts++;
    if (install() || attempts >= 200) window.clearInterval(timer);
  }, 50);
})();
