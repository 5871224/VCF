"use strict";

// Reorganize the analysis page into clear, responsive cards without changing feature IDs.
(function initVCFCardLayout() {
  if (document.getElementById("vcf-app-shell")) return;

  const board = document.getElementById("board-svg");
  const ruleBox = document.getElementById("rule-box");
  const mainActions = document.getElementById("btns");
  const analysisBox = document.getElementById("analysis-box");
  const analysisActions = document.getElementById("btns2");
  const status = document.getElementById("status");
  const generatorPanel = document.getElementById("generator-panel");
  const importPanel = document.getElementById("import-panel");
  if (!board || !ruleBox || !mainActions || !analysisBox || !analysisActions || !status) return;

  function makeHeading(title, description) {
    const heading = document.createElement("div");
    heading.className = "vcf-card-heading";
    const text = document.createElement("div");
    const h2 = document.createElement("h2");
    h2.textContent = title;
    const p = document.createElement("p");
    p.textContent = description;
    text.append(h2, p);
    heading.appendChild(text);
    return heading;
  }

  function makeCard(title, description, className) {
    const card = document.createElement("section");
    card.className = `vcf-card ${className || ""}`.trim();
    card.appendChild(makeHeading(title, description));
    return card;
  }

  const app = document.createElement("main");
  app.id = "vcf-app-shell";

  const pageHeader = document.createElement("header");
  pageHeader.className = "vcf-app-header";
  pageHeader.innerHTML = `
    <div>
      <h1>VCF 分析與題目工具</h1>
      <p>擺好棋型後，依需求選擇搜尋、進階分析或自動產生題目。</p>
    </div>
  `;
  app.appendChild(pageHeader);

  const topGrid = document.createElement("div");
  topGrid.className = "vcf-top-grid";

  const boardCard = makeCard("棋盤", "點擊交替放置黑白棋；再次點擊可移除棋子。", "vcf-board-card");
  const boardWrap = document.createElement("div");
  boardWrap.className = "vcf-board-wrap";
  boardWrap.appendChild(board);
  boardCard.append(boardWrap, status);

  const controlStack = document.createElement("div");
  controlStack.className = "vcf-control-stack";

  const searchCard = makeCard("基本搜尋", "選擇規則後，直接尋找黑方或白方 VCF。", "vcf-search-card");
  ruleBox.classList.add("vcf-option-row");
  mainActions.classList.add("vcf-action-grid");
  searchCard.append(ruleBox, mainActions);

  const analysisCard = makeCard("進階分析", "針對目前盤面查看防點、多組路線與延伸選點。", "vcf-analysis-card");
  analysisBox.classList.add("vcf-option-row");
  analysisActions.classList.add("vcf-action-grid");
  analysisCard.append(analysisBox, analysisActions);

  controlStack.append(searchCard, analysisCard);
  topGrid.append(boardCard, controlStack);
  app.appendChild(topGrid);

  if (generatorPanel) {
    generatorPanel.classList.add("vcf-card", "vcf-generator-card");
    app.appendChild(generatorPanel);
  }

  if (importPanel) {
    importPanel.classList.add("vcf-card", "vcf-import-card");
    if (!importPanel.querySelector(":scope > .vcf-card-heading")) {
      importPanel.prepend(makeHeading("圖片匯入", "從圖片、截圖或手機拍照辨識棋盤，再套用到上方棋盤。"));
    }
    app.appendChild(importPanel);
  }

  document.body.insertBefore(app, document.body.firstChild);

  const labels = {
    "btn-black": "找黑 VCF",
    "btn-white": "找白 VCF",
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
    "btn-add-white": "補白找 VCF"
  };
  for (const [id, text] of Object.entries(labels)) {
    const button = document.getElementById(id);
    if (button) button.textContent = text;
  }

  ["btn-black", "btn-white"].forEach(id => document.getElementById(id)?.classList.add("vcf-primary-action"));
  ["btn-clear", "btn-clear-vcf"].forEach(id => document.getElementById(id)?.classList.add("vcf-muted-action"));
  document.getElementById("btn-stop")?.classList.add("vcf-danger-action");

  const style = document.createElement("style");
  style.dataset.vcfCardLayout = "true";
  style.textContent = `
    :root {
      --vcf-bg: #eee6d3;
      --vcf-card: #fffdf7;
      --vcf-border: #d6c89f;
      --vcf-text: #302919;
      --vcf-muted: #74684c;
      --vcf-accent: #355f8d;
      --vcf-accent-soft: #e8f0f8;
      --vcf-danger: #a54a42;
    }

    body {
      display: block;
      min-height: 100vh;
      padding: 14px;
      background: var(--vcf-bg);
      color: var(--vcf-text);
    }

    #vcf-app-shell {
      width: min(100%, 1120px);
      margin: 0 auto;
      display: grid;
      gap: 14px;
    }

    .vcf-app-header {
      display: flex;
      align-items: end;
      justify-content: space-between;
      padding: 4px 2px 2px;
    }

    .vcf-app-header h1 {
      margin: 0;
      font-size: clamp(22px, 3vw, 30px);
      line-height: 1.2;
      color: #3d321d;
    }

    .vcf-app-header p,
    .vcf-card-heading p {
      margin: 4px 0 0;
      color: var(--vcf-muted);
      font-size: 13px;
      line-height: 1.45;
    }

    .vcf-top-grid {
      display: grid;
      grid-template-columns: minmax(0, 580px) minmax(320px, 1fr);
      gap: 14px;
      align-items: start;
    }

    .vcf-control-stack {
      display: grid;
      gap: 14px;
    }

    .vcf-card,
    #vcf-app-shell #generator-panel,
    #vcf-app-shell #import-panel {
      width: 100%;
      min-width: 0;
      margin: 0;
      padding: 14px;
      border: 1px solid var(--vcf-border);
      border-radius: 12px;
      background: var(--vcf-card);
      box-shadow: 0 3px 12px #4f3e1d12;
    }

    .vcf-card-heading,
    #generator-panel .gen-title-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 12px;
      padding-bottom: 10px;
      border-bottom: 1px solid #e7dec6;
      text-align: left;
    }

    .vcf-card-heading h2,
    #generator-panel .gen-title-row h2 {
      margin: 0;
      font-size: 17px;
      color: #46391f;
    }

    .vcf-board-wrap {
      display: flex;
      justify-content: center;
      width: 100%;
    }

    #vcf-app-shell #board-svg {
      width: min(520px, 100%);
      height: auto;
      aspect-ratio: 1 / 1;
      max-width: 100%;
    }

    #vcf-app-shell #status,
    #vcf-app-shell #gen-status,
    #vcf-app-shell #import-status {
      width: 100%;
      min-width: 0;
      margin-top: 12px;
      padding: 9px 11px;
      border-radius: 8px;
      line-height: 1.4;
    }

    .vcf-option-row,
    #generator-panel .gen-controls {
      display: flex;
      align-items: center;
      justify-content: flex-start;
      flex-wrap: wrap;
      gap: 8px 12px;
      margin-bottom: 11px;
      font-size: 14px;
    }

    .vcf-option-row label,
    #generator-panel .gen-controls label,
    #generator-panel .gen-controls fieldset {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      min-height: 36px;
      padding: 6px 10px;
      border: 1px solid #ddd2b5;
      border-radius: 999px;
      background: #faf6e9;
      white-space: nowrap;
    }

    #analysis-box {
      justify-content: flex-start;
    }

    .vcf-action-grid,
    #generator-panel .gen-actions,
    #import-toolbar,
    #import-actions {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 8px;
      width: 100%;
      margin: 0;
    }

    #vcf-app-shell button {
      min-width: 0;
      min-height: 42px;
      padding: 8px 10px;
      border-color: #c9bea0;
      border-radius: 8px;
      background: #fff;
      font-weight: 600;
      line-height: 1.2;
    }

    #vcf-app-shell button:hover:not(:disabled) {
      background: var(--vcf-accent-soft);
      border-color: #8ba8c4;
    }

    #vcf-app-shell .vcf-primary-action,
    #generator-panel #gen-btn-generate {
      color: #fff;
      background: var(--vcf-accent);
      border-color: var(--vcf-accent);
    }

    #vcf-app-shell .vcf-primary-action:hover:not(:disabled),
    #generator-panel #gen-btn-generate:hover:not(:disabled) {
      background: #294f78;
    }

    #vcf-app-shell .vcf-muted-action {
      color: #625a48;
      background: #f2eee4;
    }

    #vcf-app-shell .vcf-danger-action {
      color: #fff;
      background: var(--vcf-danger);
      border-color: var(--vcf-danger);
    }

    #vcf-app-shell #generator-panel .gen-title-row {
      justify-content: flex-start;
    }

    #vcf-app-shell #generator-panel .gen-controls,
    #vcf-app-shell #generator-panel .gen-actions,
    #vcf-app-shell #generator-panel .gen-legend {
      justify-content: flex-start;
    }

    #vcf-app-shell #generator-panel .gen-actions {
      grid-template-columns: repeat(4, minmax(0, 1fr));
      margin-top: 11px;
    }

    #vcf-app-shell #generator-panel .gen-note {
      margin-top: 10px;
      text-align: left;
    }

    #vcf-app-shell #import-panel {
      max-width: none;
    }

    #vcf-app-shell #import-canvases {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    #vcf-app-shell .canvas-card {
      min-width: 0;
      border-radius: 9px;
      box-shadow: none;
    }

    @media (max-width: 820px) {
      body { padding: 8px; }
      #vcf-app-shell { gap: 10px; }
      .vcf-top-grid { grid-template-columns: 1fr; gap: 10px; }
      .vcf-control-stack { grid-template-columns: 1fr 1fr; gap: 10px; }
      .vcf-card,
      #vcf-app-shell #generator-panel,
      #vcf-app-shell #import-panel { padding: 11px; border-radius: 10px; }
      #vcf-app-shell #generator-panel .gen-actions { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    }

    @media (max-width: 600px) {
      .vcf-app-header { padding: 2px 2px 0; }
      .vcf-app-header p { font-size: 12px; }
      .vcf-control-stack { grid-template-columns: 1fr; }
      .vcf-card-heading { margin-bottom: 9px; padding-bottom: 8px; }
      .vcf-option-row,
      #generator-panel .gen-controls { gap: 6px; margin-bottom: 9px; }
      .vcf-option-row label,
      #generator-panel .gen-controls label,
      #generator-panel .gen-controls fieldset { min-height: 34px; padding: 5px 8px; font-size: 13px; }
      .vcf-action-grid,
      #generator-panel .gen-actions,
      #import-toolbar,
      #import-actions { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px; }
      #vcf-app-shell button { min-height: 40px; padding: 7px 6px; font-size: 13px; }
      #vcf-app-shell #import-canvases { grid-template-columns: 1fr; }
      #vcf-app-shell #status { margin-top: 9px; }
    }

    @media (max-width: 380px) {
      .vcf-action-grid,
      #generator-panel .gen-actions,
      #import-toolbar,
      #import-actions { grid-template-columns: 1fr; }
    }
  `;
  document.head.appendChild(style);
})();
