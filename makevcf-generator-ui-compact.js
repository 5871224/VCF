"use strict";

(function initUnifiedVCFInterface() {
  if (window.__compactVCFInterfaceLoaded) return;
  window.__compactVCFInterfaceLoaded = true;

  const RULE_SELECT_ID = "vcf-rule-select";
  const FAST_BUTTON_ID = "btn-fast-vcf";
  const STYLE_ID = "vcf-unified-interface-style";
  const PENDING_CLASS = "vcf-interface-pending";
  const READY_CLASS = "vcf-interface-ready";
  const RULE_NAMES = { 2: "有禁", 1: "無禁", 0: "自由" };

  document.documentElement.classList.add(PENDING_CLASS);

  function installStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      html.${PENDING_CLASS} body > *:not(#camera-overlay){visibility:hidden}
      html.${READY_CLASS} body > *{visibility:visible}
      #bitboard-architecture-panel{display:none!important}
      #vcf-app-shell{width:min(100%,1180px)}
      #vcf-app-shell>.vcf-app-header p,.vcf-card-heading p{display:none}
      .vcf-top-grid{grid-template-columns:minmax(0,570px) minmax(430px,1fr)}
      .vcf-control-stack{display:block!important;min-width:0}
      .vcf-workspace{min-width:0}
      .vcf-tabs{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px;margin-bottom:8px;padding:5px;border:1px solid var(--vcf-border,#d6c89f);border-radius:11px;background:#e8dfc9}
      #vcf-app-shell .vcf-tab{min-height:42px;padding:8px 6px;border:1px solid transparent;border-radius:8px;background:transparent;color:#65583d;font-weight:700}
      #vcf-app-shell .vcf-tab[aria-selected="true"]{border-color:#b9ad8e;background:#fffdf7;color:#304f72;box-shadow:0 2px 6px #59461514}
      .vcf-tab-panel[hidden]{display:none!important}
      .vcf-tab-panel{min-width:0;padding:13px;border:1px solid var(--vcf-border,#d6c89f);border-radius:12px;background:var(--vcf-card,#fffdf7);box-shadow:0 3px 12px #4f3e1d12}
      .vcf-calc-panel{display:grid;gap:10px}
      .vcf-section{display:grid;gap:8px;padding:10px;border:1px solid #e7dec6;border-radius:10px;background:#fffefb}
      .vcf-section-title{margin:0;color:#65583d;font-size:12px;font-weight:800;letter-spacing:.03em}
      .vcf-inline{display:flex;align-items:center;flex-wrap:wrap;gap:8px;min-width:0}
      #analysis-box{display:flex!important;align-items:center;flex-wrap:wrap;gap:8px!important;font-size:13px!important}
      #analysis-box label,.vcf-inline>label,.vcf-settings-grid>label,#rule-box .vcf-rule-select-label{display:inline-flex;align-items:center;gap:6px;min-height:36px;padding:6px 10px;border:1px solid #ddd2b5;border-radius:8px;background:#faf6e9;font-size:13px;font-weight:600;white-space:nowrap}
      #analysis-box label{border-radius:999px}
      .vcf-actions{display:grid;gap:8px;width:100%}
      .vcf-cols-2{grid-template-columns:repeat(2,minmax(0,1fr))}
      .vcf-cols-3{grid-template-columns:repeat(3,minmax(0,1fr))}
      .vcf-cols-4{grid-template-columns:repeat(4,minmax(0,1fr))}
      #vcf-app-shell button{min-width:0}
      #${FAST_BUTTON_ID},#btn-shortest-vcf{color:#fff;background:var(--vcf-accent,#355f8d);border-color:var(--vcf-accent,#355f8d);font-weight:700}
      #${FAST_BUTTON_ID}:hover:not(:disabled),#btn-shortest-vcf:hover:not(:disabled){color:#fff;background:#294f78}
      .vcf-setting-toggle{display:flex;align-items:center;justify-content:center;gap:7px;min-height:42px;padding:7px 9px;border:1px solid #c9bea0;border-radius:8px;background:#fff;color:#4f4634;font-size:13px;font-weight:700;cursor:pointer;user-select:none}
      .vcf-setting-toggle:has(input:checked){border-color:#7798b9;background:#e8f0f8;color:#294f78}
      .vcf-settings-card[hidden]{display:none!important}
      .vcf-settings-card{padding:10px;border:1px dashed #cdbf9d;border-radius:9px;background:#fbf7ec}
      .vcf-settings-card h3{margin:0 0 8px;color:#5d5138;font-size:14px}
      .vcf-settings-grid{display:flex;align-items:center;flex-wrap:wrap;gap:8px}
      #${RULE_SELECT_ID},#vcf-search-options select,#vcf-search-options input[type="number"]{min-width:0;padding:6px 8px;border:1px solid #bdb397;border-radius:6px;background:#fff;color:inherit;font:inherit}
      #vcf-search-options input[type="number"]{width:72px;text-align:right}
      #vcf-multi-pruning{min-width:108px}
      #vcf-add-search-mode{min-width:78px}
      .vcf-compat-host,.vcf-rule-radio-compat,#btns>[hidden]{position:absolute!important;width:1px!important;height:1px!important;overflow:hidden!important;clip-path:inset(50%)!important;white-space:nowrap!important}
      #vcf-app-shell #generator-panel,#vcf-app-shell #import-panel{width:100%;max-width:none;margin:0;padding:0;border:0;border-radius:0;background:transparent;box-shadow:none}
      #generator-panel .gen-title-row{justify-content:space-between;margin:0 0 10px;padding:0 0 10px}
      #generator-panel .gen-controls{display:grid!important;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px!important;margin:0!important}
      #generator-panel .vcf-gen-group{display:flex;align-content:flex-start;flex-wrap:wrap;gap:8px;min-width:0;padding:10px;border:1px solid #e7dec6;border-radius:9px;background:#fffefb}
      #generator-panel .vcf-gen-group-title{flex-basis:100%;margin:0;color:#65583d;font-size:12px;font-weight:800}
      #generator-panel .gen-controls label,#generator-panel .gen-controls fieldset{display:inline-flex;align-items:center;gap:6px;min-height:36px;padding:6px 9px;border:1px solid #ddd2b5;border-radius:8px;background:#faf6e9;white-space:nowrap}
      #generator-panel .gen-actions{display:grid!important;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px!important;width:100%;margin-top:10px!important}
      #generator-panel .gen-legend{justify-content:flex-start!important;padding:8px 10px;border-radius:8px;background:#faf7ef}
      #generator-panel .gen-note{margin-top:0!important;padding:9px 10px;border-left:3px solid #c9b46f;border-radius:6px;background:#fbf7ea;text-align:left!important}
      #import-panel>.vcf-card-heading{display:none}
      #import-panel #import-toolbar{display:grid!important;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px!important;width:100%;margin:0 0 9px!important}
      #import-panel #import-status{margin:0 0 10px!important}
      #import-panel .canvas-card{width:100%;max-width:none;min-width:0;margin:0;padding:10px;border-radius:9px;box-shadow:none}
      #import-panel #import-actions{display:block!important;margin:9px 0 0!important;padding:8px 10px;border-radius:8px;background:#faf7ef;text-align:left;line-height:1.5}
      @media(max-width:920px){.vcf-top-grid{grid-template-columns:1fr}.vcf-control-stack{width:100%}}
      @media(max-width:700px){.vcf-cols-4,#generator-panel .gen-actions,#import-panel #import-toolbar{grid-template-columns:repeat(2,minmax(0,1fr))}#generator-panel .gen-controls{grid-template-columns:1fr}}
      @media(max-width:520px){.vcf-tabs{gap:4px;padding:4px}#vcf-app-shell .vcf-tab{min-height:40px;padding:7px 4px;font-size:12px}.vcf-cols-3{grid-template-columns:1fr}.vcf-inline,.vcf-settings-grid{align-items:stretch}.vcf-inline>label,.vcf-settings-grid>label{flex:1 1 150px}}
      @media(max-width:360px){.vcf-tabs,.vcf-actions,.vcf-cols-2,.vcf-cols-4,#generator-panel .gen-actions,#import-panel #import-toolbar{grid-template-columns:1fr}}
    `;
    document.head.appendChild(style);
  }

  installStyle();

  const section = title => {
    const box = document.createElement("section");
    box.className = "vcf-section";
    const h = document.createElement("h3");
    h.className = "vcf-section-title";
    h.textContent = title;
    box.appendChild(h);
    return box;
  };

  const actions = columns => {
    const row = document.createElement("div");
    row.className = `vcf-actions vcf-cols-${columns}`;
    return row;
  };

  const move = (element, target) => {
    if (element && target && element.parentNode !== target) target.appendChild(element);
  };

  function selectedAnalysisColor() {
    return Number(document.querySelector('input[name="acolor"]:checked')?.value) === 2 ? 2 : 1;
  }

  async function applyRuleDirectly(rules) {
    if (typeof searching !== "undefined" && searching) return false;
    if (typeof setStatus === "function") setStatus("正在切換規則...");
    try {
      const tasks = [];
      if (typeof engine !== "undefined" && engine?.setRules) tasks.push(engine.setRules(rules));
      if (typeof pool !== "undefined" && pool?.setRules) tasks.push(pool.setRules(rules));
      await Promise.all(tasks);
      if (typeof setStatus === "function") setStatus(`${RULE_NAMES[rules]}，就緒`);
      window.dispatchEvent(new CustomEvent("vcf-rule-changed", { detail: { rules } }));
      return true;
    } catch (error) {
      console.error(error);
      if (typeof setStatus === "function") setStatus(`切換規則失敗：${error?.message || error}`);
      return false;
    }
  }

  function installRuleSelect(ruleBox) {
    let select = document.getElementById(RULE_SELECT_ID);
    if (select) return select;

    for (const value of [2, 1, 0]) {
      if (ruleBox.querySelector(`input[name="rules"][value="${value}"]`)) continue;
      const label = document.createElement("label");
      const radio = document.createElement("input");
      radio.type = "radio";
      radio.name = "rules";
      radio.value = String(value);
      label.append(radio, ` ${RULE_NAMES[value]}`);
      ruleBox.appendChild(label);
    }

    const radios = Array.from(ruleBox.querySelectorAll('input[name="rules"]'));
    const current = radios.find(radio => radio.checked) || radios.find(radio => radio.value === "2");
    const compatibility = document.createElement("span");
    compatibility.className = "vcf-rule-radio-compat";
    radios.forEach(radio => {
      const label = radio.closest("label");
      if (label?.parentNode === ruleBox) compatibility.appendChild(label);
    });

    const label = document.createElement("label");
    label.className = "vcf-rule-select-label";
    label.append("規則");
    select = document.createElement("select");
    select.id = RULE_SELECT_ID;
    select.setAttribute("aria-label", "規則");
    [2, 1, 0].forEach(value => {
      const option = document.createElement("option");
      option.value = String(value);
      option.textContent = RULE_NAMES[value];
      select.appendChild(option);
    });
    select.value = current?.value || "2";
    label.appendChild(select);
    ruleBox.append(label, compatibility);

    select.addEventListener("change", async () => {
      const previous = radios.find(radio => radio.checked)?.value || "2";
      const selected = ruleBox.querySelector(`input[name="rules"][value="${select.value}"]`);
      if (!selected || (typeof searching !== "undefined" && searching)) {
        select.value = previous;
        return;
      }
      selected.checked = true;
      if (ruleBox.dataset.threeRulesReady === "1" || selected.value !== "0") {
        selected.dispatchEvent(new Event("change", { bubbles: true }));
      } else if (!await applyRuleDirectly(Number(selected.value))) {
        ruleBox.querySelector(`input[name="rules"][value="${previous}"]`).checked = true;
        select.value = previous;
      }
    });

    ruleBox.addEventListener("change", event => {
      const radio = event.target;
      if (radio instanceof HTMLInputElement && radio.name === "rules" && radio.checked) select.value = radio.value;
    });

    const syncDisabled = () => { select.disabled = radios.some(radio => radio.disabled); };
    syncDisabled();
    new MutationObserver(syncDisabled).observe(compatibility, { subtree: true, attributes: true, attributeFilter: ["disabled"] });
    return select;
  }

  function installFastButton(mainActions) {
    const black = document.getElementById("btn-black");
    const white = document.getElementById("btn-white");
    if (!black || !white) return null;
    let button = document.getElementById(FAST_BUTTON_ID);
    if (!button) {
      button = document.createElement("button");
      button.id = FAST_BUTTON_ID;
      button.type = "button";
      button.textContent = "速找 VCF";
      button.title = "依目前分析色搜尋第一組 VCF";
      button.addEventListener("click", () => {
        const target = selectedAnalysisColor() === 2 ? white : black;
        if (!target.disabled) target.click();
      });
      mainActions.insertBefore(button, black);
    }
    black.hidden = true;
    white.hidden = true;
    const sync = () => { button.disabled = (selectedAnalysisColor() === 2 ? white : black).disabled; };
    sync();
    document.querySelectorAll('input[name="acolor"]').forEach(radio => radio.addEventListener("change", sync));
    new MutationObserver(sync).observe(black, { attributes: true, attributeFilter: ["disabled"] });
    new MutationObserver(sync).observe(white, { attributes: true, attributeFilter: ["disabled"] });
    return button;
  }

  function settingToggle(id, text, target, key) {
    const label = document.createElement("label");
    label.className = "vcf-setting-toggle";
    const input = document.createElement("input");
    input.id = id;
    input.type = "checkbox";
    try { input.checked = localStorage.getItem(key) === "1"; } catch (_) {}
    const update = () => {
      target.hidden = !input.checked;
      try { localStorage.setItem(key, input.checked ? "1" : "0"); } catch (_) {}
    };
    input.addEventListener("change", update);
    label.append(input, text);
    update();
    return label;
  }

  function simplifyPruningOptions() {
    const select = document.getElementById("vcf-multi-pruning");
    const fast = select?.querySelector('option[value="fast"]');
    const strict = select?.querySelector('option[value="strict"]');
    if (fast) fast.textContent = "集合子集";
    if (strict) strict.textContent = "完全同盤";
  }

  function groupGenerator(panel) {
    const controls = panel.querySelector(".gen-controls");
    if (!controls || controls.dataset.grouped === "1") return;
    controls.dataset.grouped = "1";
    const children = Array.from(controls.children);
    const makeGroup = title => {
      const group = document.createElement("div");
      group.className = "vcf-gen-group";
      const h = document.createElement("h3");
      h.className = "vcf-gen-group-title";
      h.textContent = title;
      group.appendChild(h);
      return group;
    };
    const conditions = makeGroup("題目條件");
    const preferences = makeGroup("候選偏好");
    children.forEach((child, index) => (index < 2 ? conditions : preferences).appendChild(child));
    controls.append(conditions, preferences);
  }

  function installTabs(host, panels) {
    const tabs = document.createElement("div");
    tabs.className = "vcf-tabs";
    tabs.setAttribute("role", "tablist");
    const defs = [
      ["calculation", "VCF計算", panels.calculation],
      ["generator", "VCF 題目產生器", panels.generator],
      ["import", "圖片匯入", panels.import],
    ];
    let active = "calculation";
    try {
      const stored = localStorage.getItem("vcf_workspace_tab");
      if (defs.some(([key]) => key === stored)) active = stored;
    } catch (_) {}
    const activate = key => {
      defs.forEach(([tabKey, , panel]) => {
        const button = tabs.querySelector(`[data-tab="${tabKey}"]`);
        const selected = tabKey === key;
        button?.setAttribute("aria-selected", selected ? "true" : "false");
        if (button) button.tabIndex = selected ? 0 : -1;
        panel.hidden = !selected;
      });
      try { localStorage.setItem("vcf_workspace_tab", key); } catch (_) {}
    };
    defs.forEach(([key, text, panel]) => {
      panel.classList.add("vcf-tab-panel");
      panel.id = `vcf-tab-panel-${key}`;
      panel.setAttribute("role", "tabpanel");
      const button = document.createElement("button");
      button.type = "button";
      button.className = "vcf-tab";
      button.dataset.tab = key;
      button.setAttribute("role", "tab");
      button.setAttribute("aria-controls", panel.id);
      button.textContent = text;
      button.addEventListener("click", () => activate(key));
      tabs.appendChild(button);
    });
    host.append(tabs, panels.calculation, panels.generator, panels.import);
    activate(active);
  }

  function readyForOnePass() {
    return Boolean(
      document.getElementById("vcf-app-shell") &&
      document.getElementById("generator-panel") &&
      document.getElementById("import-panel") &&
      document.getElementById("vcf-search-options") &&
      document.getElementById("btn-shortest-vcf") &&
      document.getElementById("show-forbidden") &&
      document.getElementById("vcf-stop-after-open-four") &&
      document.getElementById("vcf-same-type-trim-live-four")
    );
  }

  function install() {
    const app = document.getElementById("vcf-app-shell");
    const topGrid = app?.querySelector(".vcf-top-grid");
    const oldStack = app?.querySelector(".vcf-control-stack");
    const searchCard = app?.querySelector(".vcf-search-card");
    const analysisCard = app?.querySelector(".vcf-analysis-card");
    const ruleBox = document.getElementById("rule-box");
    const mainActions = document.getElementById("btns");
    const analysisBox = document.getElementById("analysis-box");
    const analysisActions = document.getElementById("btns2");
    const generatorPanel = document.getElementById("generator-panel");
    const importPanel = document.getElementById("import-panel");
    if (!app || !topGrid || !oldStack || !searchCard || !ruleBox || !mainActions || !analysisBox || !analysisActions || !generatorPanel || !importPanel) return false;
    if (app.dataset.unifiedInterfaceReady === "1") return true;

    simplifyPruningOptions();
    const ruleSelect = installRuleSelect(ruleBox);
    const fastButton = installFastButton(mainActions);
    if (!ruleSelect || !fastButton) return false;

    const existingSearchOptions = document.getElementById("vcf-search-options");
    const workspace = document.createElement("div");
    workspace.className = "vcf-workspace";

    const calcPanel = document.createElement("section");
    calcPanel.className = "vcf-calc-panel";

    const analysisSection = section("分析");
    const analysisRow = document.createElement("div");
    analysisRow.className = "vcf-inline";
    analysisRow.appendChild(analysisBox);
    analysisSection.appendChild(analysisRow);

    const calcSettings = document.createElement("div");
    calcSettings.className = "vcf-settings-card";
    calcSettings.id = "vcf-calculation-settings-card";
    calcSettings.innerHTML = '<h3>計算設定</h3><div class="vcf-settings-grid"></div>';
    const calcSettingsGrid = calcSettings.lastElementChild;

    const calcSection = section("VCF 搜尋");
    const calcRow = actions(3);
    const calcToggle = settingToggle("vcf-show-calculation-settings", "計算設定", calcSettings, "vcf_show_calculation_settings");
    calcRow.append(fastButton, calcToggle);
    calcSection.append(calcRow, calcSettings);

    const multiSettings = document.createElement("div");
    multiSettings.className = "vcf-settings-card";
    multiSettings.id = "vcf-multi-settings-card";
    multiSettings.innerHTML = '<h3>多組設定</h3><div class="vcf-settings-grid"></div>';
    const multiSettingsGrid = multiSettings.lastElementChild;

    const multiSection = section("多組 VCF");
    const multiRow = actions(4);
    const multiToggle = settingToggle("vcf-show-multi-settings", "多組設定", multiSettings, "vcf_show_multi_settings");
    multiSection.append(multiRow, multiSettings);

    const defenseSection = section("防守");
    const defenseRow = actions(2);
    defenseSection.appendChild(defenseRow);

    const extensionSection = section("延伸搜尋");
    const extensionRow = actions(4);
    extensionSection.appendChild(extensionRow);

    const boardSection = section("棋盤操作");
    const boardRow = actions(4);
    boardSection.appendChild(boardRow);

    calcPanel.append(analysisSection, calcSection, multiSection, defenseSection, extensionSection, boardSection);

    const generatorTab = document.createElement("section");
    groupGenerator(generatorPanel);
    generatorTab.appendChild(generatorPanel);

    const importTab = document.createElement("section");
    importTab.appendChild(importPanel);

    installTabs(workspace, { calculation: calcPanel, generator: generatorTab, import: importTab });

    const searchOptions = existingSearchOptions || document.createElement("div");
    searchOptions.classList.add("vcf-compat-host");
    mainActions.classList.add("vcf-compat-host");
    analysisActions.classList.add("vcf-compat-host");
    ruleBox.classList.add("vcf-compat-host");
    calcPanel.append(searchOptions, ruleBox, mainActions, analysisActions);
    oldStack.replaceWith(workspace);

    const labels = {
      "btn-stop": "停止",
      "btn-continue": "繼續搜尋",
      "btn-clear-vcf": "清除標記",
      "btn-clear": "清空棋盤",
      "btn-block-vcf": "單一路線防守",
      "btn-block-vcf-all": "全部路線防守",
      "btn-multi-vcf": "多組 VCF",
      "btn-vcf-prev": "上一組",
      "btn-vcf-next": "下一組",
      "btn-level3": "VCT 選點",
      "btn-add-black": "補黑找 VCF",
      "btn-add-white": "補白找 VCF",
      "btn-shortest-vcf": "最短 VCF",
    };
    Object.entries(labels).forEach(([id, text]) => {
      const button = document.getElementById(id);
      if (button) button.textContent = text;
    });

    const reconcile = () => {
      simplifyPruningOptions();
      const dynamicSearchOptions = document.getElementById("vcf-search-options");
      if (dynamicSearchOptions) {
        dynamicSearchOptions.classList.add("vcf-compat-host");
        move(dynamicSearchOptions, calcPanel);
      }
      move(document.getElementById("show-forbidden")?.closest("label"), analysisRow);
      move(document.getElementById("btn-shortest-vcf"), calcRow);
      move(calcToggle, calcRow);
      [
        document.getElementById("vcf-multi-time-seconds")?.closest("label"),
        document.getElementById("vcf-multi-node-millions")?.closest("label"),
        document.getElementById("vcf-simplify-route")?.closest("label"),
        document.getElementById(RULE_SELECT_ID)?.closest("label"),
      ].forEach(element => move(element, calcSettingsGrid));
      ["btn-multi-vcf", "btn-vcf-prev", "btn-vcf-next"].forEach(id => move(document.getElementById(id), multiRow));
      move(multiToggle, multiRow);
      [
        document.getElementById("vcf-multi-pruning")?.closest("label"),
        document.getElementById("vcf-stop-after-open-four")?.closest("label"),
        document.getElementById("vcf-same-type-trim-live-four")?.closest("label"),
      ].forEach(element => move(element, multiSettingsGrid));
      ["btn-block-vcf", "btn-block-vcf-all"].forEach(id => move(document.getElementById(id), defenseRow));
      ["btn-level3", "btn-add-black", "btn-add-white"].forEach(id => move(document.getElementById(id), extensionRow));
      move(document.getElementById("vcf-add-search-mode")?.closest("label"), extensionRow);
      ["btn-stop", "btn-continue", "btn-clear-vcf", "btn-clear"].forEach(id => move(document.getElementById(id), boardRow));
      document.getElementById("btn-black-optimized")?.setAttribute("hidden", "");
      document.getElementById("btn-white-optimized")?.setAttribute("hidden", "");
    };
    reconcile();
    new MutationObserver(reconcile).observe(document.body, { childList: true, subtree: true });

    if (typeof window.setBusy === "function" && !window.setBusy.__unifiedUiWrapped) {
      const base = window.setBusy;
      const wrapped = function(value) {
        const result = base.apply(this, arguments);
        document.getElementById("vcf-show-calculation-settings").disabled = Boolean(value);
        document.getElementById("vcf-show-multi-settings").disabled = Boolean(value);
        return result;
      };
      Object.defineProperty(wrapped, "__unifiedUiWrapped", { value: true });
      window.setBusy = wrapped;
      try { setBusy = wrapped; } catch (_) {}
    }

    app.dataset.compactInterfaceReady = "1";
    app.dataset.unifiedInterfaceReady = "1";
    document.documentElement.classList.remove(PENDING_CLASS);
    document.documentElement.classList.add(READY_CLASS);
    return true;
  }

  const started = performance.now();
  const timer = window.setInterval(() => {
    const elapsed = performance.now() - started;
    if ((readyForOnePass() || elapsed >= 1800) && install()) {
      window.clearInterval(timer);
      return;
    }
    if (elapsed >= 5000) {
      window.clearInterval(timer);
      document.documentElement.classList.remove(PENDING_CLASS);
      document.documentElement.classList.add(READY_CLASS);
    }
  }, 40);
})();
