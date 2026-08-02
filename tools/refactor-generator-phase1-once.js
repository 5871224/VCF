"use strict";

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const root = process.cwd();
const file = relative => path.join(root, relative);
const read = relative => fs.readFileSync(file(relative), "utf8");
const write = (relative, content) => fs.writeFileSync(file(relative), content, "utf8");

function fail(message) {
  throw new Error(`[題目產生器第一階段重構] ${message}`);
}

function replaceOnce(content, oldText, newText, label) {
  const first = content.indexOf(oldText);
  if (first < 0) fail(`${label}：找不到預期內容`);
  if (content.indexOf(oldText, first + oldText.length) >= 0) {
    fail(`${label}：預期內容出現超過一次`);
  }
  return content.slice(0, first) + newText + content.slice(first + oldText.length);
}

function removeFrom(content, marker, label) {
  const index = content.indexOf(marker);
  if (index < 0) fail(`${label}：找不到起點`);
  return content.slice(0, index).trimEnd() + "\n";
}

function runLegacyBake(script) {
  if (!fs.existsSync(file(script))) return;
  const source = read(script);
  if (!source.includes("writeFileSync") && !source.includes("replaceOnce")) return;
  execFileSync(process.execPath, [script], { cwd: root, stdio: "inherit" });
}

// 先把過去只在 Pages 建置時才出現的修正寫回正式來源。
runLegacyBake("tools/apply-image-import-build-fixes.js");
runLegacyBake("tools/apply-generator-replay-event-fixes.js");

// makevcf-mobile.js 只保留手機版面，不再兼任功能模組載入器。
{
  const relative = "makevcf-mobile.js";
  let source = read(relative);
  const marker = "// These file names match the Pages makevcf-generator-*.js copy rule.";
  if (source.includes(marker)) source = removeFrom(source, marker, relative);
  write(relative, source);
}

// Bitboard 相容層只安裝相容 API；頁首與題庫改由 HTML 固定載入。
{
  const relative = "rapfi/vcf-bitboard-generator-compat.js";
  let source = read(relative);
  const marker = "(function loadRapfiWorkbenchTools() {";
  if (source.includes(marker)) {
    const replacement = `(function prepareRapfiWorkbenchTools() {\n  // Dashboard 建立快速操作列前先隱藏舊說明面板，避免版面閃動。\n  if (document.getElementById("bb-compact-header-style")) return;\n  const style = document.createElement("style");\n  style.id = "bb-compact-header-style";\n  style.textContent = \`\n    #bitboard-architecture-panel:not(.bb-quick-actions) {\n      display: none !important;\n    }\n  \`;\n  document.head.appendChild(style);\n})();\n`;
    source = source.slice(0, source.indexOf(marker)) + replacement;
  }
  write(relative, source);
}

// 沿用加成模組只保留加成與既有介面同步，不再串接其他腳本。
{
  const relative = "makevcf-generator-reuse-bonus.js";
  let source = read(relative);
  const policyStart = "// Load the final target-board policy first, then the complete defense-point policy,";
  const guardStart = "// The unified interface only needs one layout pass.";
  if (source.includes(policyStart)) {
    const start = source.indexOf(policyStart);
    const guard = source.indexOf(guardStart, start);
    if (guard < 0) fail(`${relative}：找不到介面觀察器區段`);
    source = source.slice(0, start) +
      "// 題目產生器政策由 makevcf.html 依固定順序載入。\n\n" +
      source.slice(guard);
  }

  const compactStart = "// The card layout is created later in the build-injected script list. Load the";
  if (source.includes(compactStart)) {
    const start = source.indexOf(compactStart);
    source = source.slice(0, start) + `// 固定腳本順序會在本檔之後載入版面模組；這裡只負責同步既有控制項。\n(function initializeUnifiedInterfaceSelectors() {\n  stabilizeUnifiedInterfaceSelectors();\n  let attempts = 0;\n  const timer = window.setInterval(() => {\n    attempts++;\n    if (stabilizeUnifiedInterfaceSelectors() || attempts >= 160) {\n      window.clearInterval(timer);\n    }\n  }, 50);\n  document.addEventListener("change", event => {\n    const input = event.target;\n    if (\n      input instanceof HTMLInputElement &&\n      (input.id === "vcf-show-calculation-settings" || input.id === "vcf-show-multi-settings")\n    ) {\n      stabilizeUnifiedInterfaceSelectors();\n    }\n  }, true);\n  window.addEventListener("load", stabilizeUnifiedInterfaceSelectors, { once: true });\n})();\n`;
  }
  write(relative, source);
}

// Evaluator 不再在檔尾插入另一支 script；相容層改由 HTML 明確載入。
{
  const relative = "eval/Evaluator.js";
  let source = read(relative);
  const marker = "(function loadRootGeneratorCompatibilityAfterEvaluator() {";
  if (source.includes(marker)) source = removeFrom(source, marker, relative);
  write(relative, source);
}

// makevcf.html 成為唯一可直接審核的固定載入表。
{
  const relative = "makevcf.html";
  let html = read(relative);

  const dynamicFeatureStart = "<script>\n(function installRootBitboardFeatures() {";
  if (html.includes(dynamicFeatureStart)) {
    const start = html.indexOf(dynamicFeatureStart);
    const end = html.indexOf("</script>", start);
    if (end < 0) fail(`${relative}：找不到根工作台動態功能載入結尾`);
    html = html.slice(0, start) + html.slice(end + "</script>".length);
  }

  const oldScripts = `<!-- 手機棋盤自適應 -->\n<script src="makevcf-mobile.js"></script>\n<!-- VCF 題目產生器：與主分析頁共用同一棋盤 -->\n<script src="emoji/emoji.js"></script>\n<script src="eval/EvaluatorJScript.js"></script>\n<script src="eval/EvaluatorCore.js"></script>\n<script src="eval/Evaluator.js"></script>\n<script src="makevcf-generator-core.js"></script>\n<script src="makevcf-generator-base.js"></script>\n<script src="makevcf-generator-layer.js"></script>\n<script src="makevcf-generator-validate.js"></script>\n<script src="makevcf-generator-integrated.js"></script>\n<script src="makevcf-generator-reuse-bonus.js"></script>\n<script src="makevcf-generator-concentration.js"></script>\n<script src="makevcf-generator-main.js"></script>\n<script src="makevcf-generator-order-mode.js"></script>\n<script src="makevcf-generator-balance.js"></script>\n<script src="makevcf-generator-unique.js"></script>\n<script src="makevcf-generator-summary.js"></script>\n<!-- 卡片化介面 -->\n<script src="makevcf-layout.js"></script>\n<!-- 獨立的優化 VCF 搜尋與速度比較 -->\n<script src="makevcf-optimized-search-v2.js"></script>`;

  const fixedScripts = `<!-- 手機棋盤自適應 -->\n<script src="makevcf-mobile.js"></script>\n<!-- VCF 題目產生器：固定載入順序，不再由功能檔動態插入腳本 -->\n<script src="emoji/emoji.js"></script>\n<script src="eval/EvaluatorJScript.js"></script>\n<script src="eval/EvaluatorCore.js"></script>\n<script src="eval/Evaluator.js"></script>\n<script src="rapfi/vcf-bitboard-generator-compat.js"></script>\n<script src="makevcf-generator-core.js"></script>\n<script src="makevcf-generator-base.js"></script>\n<script src="makevcf-generator-layer.js"></script>\n<script src="makevcf-generator-validate.js"></script>\n<script src="makevcf-generator-integrated.js"></script>\n<script src="makevcf-generator-reuse-bonus.js"></script>\n<script src="makevcf-generator-concentration.js"></script>\n<script src="makevcf-generator-main.js"></script>\n<script src="makevcf-generator-order-mode.js"></script>\n<script src="makevcf-generator-balance.js"></script>\n<script src="makevcf-generator-unique.js"></script>\n<script src="makevcf-generator-summary.js"></script>\n<!-- 目標盤面、補守、最終補色與回放政策 -->\n<script src="makevcf-generator-target-board-v3.js"></script>\n<script src="makevcf-generator-defense-points.js"></script>\n<script src="makevcf-generator-extension-other-vcf-fix.js"></script>\n<script src="makevcf-generator-protected-defenders.js"></script>\n<script src="makevcf-generator-progress.js"></script>\n<script src="makevcf-generator-status-detail.js"></script>\n<!-- 卡片化工作台與產生器介面 -->\n<script src="makevcf-layout.js"></script>\n<script src="rapfi/rapfi-bitboard-dashboard.js"></script>\n<script src="rapfi/vcf-shortest-vcf-ui.js"></script>\n<script src="rapfi/vcf-forbidden-overlay.js"></script>\n<script src="rapfi/rapfi-workbench-header.js"></script>\n<script src="rapfi/rapfi-question-bank.js"></script>\n<script src="makevcf-generator-layout-fix.js"></script>\n<script src="makevcf-generator-ui-compact.js"></script>\n<script src="makevcf-generator-open-four-stop.js"></script>\n<script src="makevcf-generator-settings-persistence.js"></script>\n<script src="makevcf-generator-image-import-fix.js"></script>\n<!-- 根工作台不啟動舊的優化搜尋覆寫 -->\n<script src="makevcf-optimized-search-v2.js"></script>`;

  if (!html.includes(fixedScripts)) html = replaceOnce(html, oldScripts, fixedScripts, relative);
  write(relative, html);
}

const sourceOrderTest = `"use strict";\n\nconst fs = require("fs");\n\nconst html = fs.readFileSync("makevcf.html", "utf8");\nconst scriptSources = Array.from(html.matchAll(/<script[^>]+src=["']([^"']+)["'][^>]*><\\/script>/g), match => match[1]);\nconst requiredOrder = [\n  "makevcf-mobile.js",\n  "eval/Evaluator.js",\n  "rapfi/vcf-bitboard-generator-compat.js",\n  "makevcf-generator-core.js",\n  "makevcf-generator-main.js",\n  "makevcf-generator-summary.js",\n  "makevcf-generator-target-board-v3.js",\n  "makevcf-generator-defense-points.js",\n  "makevcf-generator-extension-other-vcf-fix.js",\n  "makevcf-generator-protected-defenders.js",\n  "makevcf-generator-progress.js",\n  "makevcf-layout.js",\n  "rapfi/rapfi-bitboard-dashboard.js",\n  "rapfi/vcf-shortest-vcf-ui.js",\n  "rapfi/vcf-forbidden-overlay.js",\n  "rapfi/rapfi-workbench-header.js",\n  "rapfi/rapfi-question-bank.js",\n  "makevcf-generator-layout-fix.js",\n  "makevcf-generator-ui-compact.js",\n  "makevcf-generator-open-four-stop.js",\n  "makevcf-generator-settings-persistence.js",\n  "makevcf-generator-image-import-fix.js",\n  "makevcf-optimized-search-v2.js",\n];\nlet previous = -1;\nfor (const source of requiredOrder) {\n  const index = scriptSources.indexOf(source);\n  if (index < 0) throw new Error(\`missing fixed script: \${source}\`);\n  if (index <= previous) throw new Error(\`invalid fixed script order near: \${source}\`);\n  previous = index;\n}\nfor (const token of [\n  "rapfi/engine/vcf-bitboard-engine.js",\n  "rapfi/vcf-bitboard-main.js",\n]) {\n  if (!html.includes(token)) throw new Error("missing root bridge token: " + token);\n}\nif (new Set(scriptSources).size !== scriptSources.length) {\n  throw new Error("duplicate script source in makevcf.html");\n}\nif (html.includes("installRootBitboardFeatures")) {\n  throw new Error("root workbench features are still dynamically injected");\n}\n\nfor (const relative of [\n  "makevcf-mobile.js",\n  "makevcf-generator-reuse-bonus.js",\n  "rapfi/vcf-bitboard-generator-compat.js",\n]) {\n  const source = fs.readFileSync(relative, "utf8");\n  if (/\\bscript\\.src\\s*=/.test(source)) {\n    throw new Error(\`dynamic script injection remains in \${relative}\`);\n  }\n}\n\nconst evaluator = fs.readFileSync("eval/Evaluator.js", "utf8");\nif (evaluator.includes("loadRootGeneratorCompatibilityAfterEvaluator")) {\n  throw new Error("Evaluator.js still injects the generator compatibility script");\n}\n\nfor (const relative of [\n  "tools/apply-image-import-build-fixes.js",\n  "tools/apply-generator-replay-event-fixes.js",\n]) {\n  const source = fs.readFileSync(relative, "utf8");\n  if (/\\b(?:writeFileSync|appendFileSync|renameSync|unlinkSync)\\s*\\(/.test(source)) {\n    throw new Error(\`build verification mutates source files: \${relative}\`);\n  }\n}\n\nconsole.log("Generator source order and non-mutating build checks passed");\n`;
write("tests/generator-source-order.test.js", sourceOrderTest);

const verifyBuild = `"use strict";\n\nconst fs = require("fs");\nconst { spawnSync } = require("child_process");\n\nfunction fail(message) { throw new Error(\`[正式建置驗證] \${message}\`); }\nfunction syntaxCheck(filename) {\n  const result = spawnSync(process.execPath, ["--check", filename], { encoding: "utf8" });\n  if (result.stdout) process.stdout.write(result.stdout);\n  if (result.stderr) process.stderr.write(result.stderr);\n  if (result.status !== 0) fail(\`\${filename} JavaScript 語法檢查失敗\`);\n}\nfunction requireTokens(filename, tokens) {\n  const source = fs.readFileSync(filename, "utf8");\n  for (const token of tokens) if (!source.includes(token)) fail(\`\${filename} 缺少：\${token}\`);\n  return source;\n}\n\nrequireTokens("makevcf-generator-image-import-fix.js", [\n  "function removeCenterText(imageData)",\n  "function analyzeStoneAt(",\n  "function fitLattice(bundle, width, height)",\n  "function addSyntheticOuterLines(",\n]);\nconst defense = requireTokens("makevcf-generator-defense-points.js", [\n  "async function rankDefensePoints(state, unwanted)",\n  "async function validateWithRankedDefense(",\n  "async function cleanFinalTargetBoard(state, expectedBoard, targetSteps, budget)",\n  'phase: "mid"',\n  'phase: "final"',\n  "genReplayBeginDefenderAttempt",\n  "genReplayEndDefenderAttempt",\n]);\nrequireTokens("makevcf-generator-balance.js", [\n  "generatorOptionsWithFinalBalance",\n  "黑白子數已補齊",\n]);\nrequireTokens("makevcf-generator-extension-other-vcf-fix.js", [\n  "requiredFinalFill",\n  "FILL_TIME_LIMIT_MS",\n  'mode: "shortest"',\n  'phase: "balance"',\n]);\nconst html = requireTokens("makevcf.html", [\n  "__vcfRootBitboardWorkbench",\n  "window.history.replaceState",\n  '<script src="rapfi/vcf-bitboard-generator-compat.js"></script>',\n  '<script src="makevcf-generator-target-board-v3.js"></script>',\n  '<script src="makevcf-generator-defense-points.js"></script>',\n  '<script src="makevcf-generator-progress.js"></script>',\n  '<script src="rapfi/rapfi-bitboard-dashboard.js"></script>',\n]);\nconst evaluator = fs.readFileSync("eval/Evaluator.js", "utf8");\nrequireTokens("makevcf-optimized-search-v2.js", [\n  "if (window.__vcfRootBitboardWorkbench) return;",\n]);\n\nfor (const obsolete of [\n  "validateWithStreamingDefense",\n  "budget.failedPoints instanceof Set",\n  "failedPoints.add(failedKey)",\n]) if (defense.includes(obsolete)) fail(\`補守仍殘留舊邏輯：\${obsolete}\`);\nif (html.includes("installRootBitboardFeatures")) fail("根工作台仍動態載入正式功能");\nif (evaluator.includes("loadRootGeneratorCompatibilityAfterEvaluator")) fail("Evaluator.js 仍動態載入相容層");\n\nfor (const filename of [\n  "makevcf-mobile.js",\n  "makevcf-generator-reuse-bonus.js",\n  "rapfi/vcf-bitboard-generator-compat.js",\n  "makevcf-generator-image-import-fix.js",\n  "makevcf-generator-defense-points.js",\n  "makevcf-generator-balance.js",\n  "makevcf-generator-extension-other-vcf-fix.js",\n  "makevcf-generator-progress.js",\n  "eval/Evaluator.js",\n  "makevcf-optimized-search-v2.js",\n]) syntaxCheck(filename);\n\nconsole.log("圖片匯入、固定載入順序、補守、最終補色與根工作台來源一致性驗證通過。");\n`;
write("tools/apply-image-import-build-fixes.js", verifyBuild);

const verifyReplay = `"use strict";\n\nconst fs = require("fs");\nconst { spawnSync } = require("child_process");\n\nfunction fail(message) { throw new Error(\`[補子回放事件驗證] \${message}\`); }\nfunction check(filename, tokens, forbidden = []) {\n  const source = fs.readFileSync(filename, "utf8");\n  for (const token of tokens) if (!source.includes(token)) fail(\`\${filename} 缺少：\${token}\`);\n  for (const token of forbidden) if (source.includes(token)) fail(\`\${filename} 仍殘留：\${token}\`);\n  const result = spawnSync(process.execPath, ["--check", filename], { encoding: "utf8" });\n  if (result.status !== 0) fail(\`\${filename} 語法檢查失敗：\${result.stderr}\`);\n}\n\ncheck("makevcf-generator-defense-points.js", [\n  'phase: "mid"',\n  'phase: "final"',\n  "validateWithRankedDefense(",\n  "genReplayBeginDefenderAttempt",\n  "genReplayEndDefenderAttempt",\n]);\ncheck("makevcf-generator-extension-other-vcf-fix.js", [\n  'phase: "balance"',\n  "filledAttackerStone",\n  "新增其他攻方 VCF",\n]);\ncheck("makevcf-generator-progress.js", [\n  "stageTitleForAddedStone(color, idx, attacker)",\n  "genReplayBeginDefenderAttempt",\n  "genReplayEndDefenderAttempt",\n  'phase === "balance"',\n  'role === "attacker"',\n], [\n  "Worker.prototype.postMessage",\n  "MAX_KNOWN_BOARDS",\n  "findOneStoneParent",\n]);\n\nconsole.log("補守、補齊子數與統一回放明確事件驗證通過。");\n`;
write("tools/apply-generator-replay-event-fixes.js", verifyReplay);

// CI 加入來源一致性測試，並擴大會觸發題目產生器 CI 的檔案範圍。
{
  const relative = ".github/workflows/vcf-generator-ci.yml";
  let workflow = read(relative);
  const pathMarker = "      - 'makevcf-generator-*.js'\n";
  const extraPaths = "      - 'makevcf-generator-*.js'\n      - 'makevcf.html'\n      - 'makevcf-mobile.js'\n      - 'makevcf-optimized-search-v2.js'\n      - 'eval/Evaluator.js'\n      - 'tools/apply-*-build-fixes.js'\n      - 'tools/apply-generator-replay-event-fixes.js'\n      - 'tests/generator-source-order.test.js'\n";
  if (!workflow.includes("tests/generator-source-order.test.js")) {
    workflow = replaceOnce(workflow, pathMarker, extraPaths, `${relative} paths`);
  }
  const testMarker = "      - name: Test generator layout and unified replay\n        run: node tests/generator-layout-replay.test.js\n";
  const testBlock = testMarker + "\n      - name: Verify generator source order and non-mutating build\n        run: node tests/generator-source-order.test.js\n";
  if (!workflow.includes("Verify generator source order and non-mutating build")) {
    workflow = replaceOnce(workflow, testMarker, testBlock, `${relative} test step`);
  }
  write(relative, workflow);
}

// 文件只描述新的正式狀態。
{
  const relative = "檔案用途總覽.MD";
  let doc = read(relative);
  doc = doc.replace("目前共 129 個檔案", "目前共 130 個檔案");
  doc = doc.replace(
    "沿用棋子加成、連五點 N 標記及題目產生器擴充載入入口。",
    "沿用棋子加成、連五點 N 標記及固定介面選擇器同步。",
  );
  doc = doc.replace(
    "手機棋盤 CSS，以及圖片、補守、狀態與版面擴充的動態載入入口。",
    "手機棋盤自適應 CSS；不負責載入其他題目產生器模組。",
  );
  doc = doc.replace(
    "題目產生器同步棋型／禁手相容層，並載入頁首與題庫。",
    "題目產生器同步棋型／禁手相容層；頁首與題庫由根頁固定載入。",
  );
  doc = doc.replace(
    "| `tests/generator-layout-replay.test.js` | 測試 | 題目產生器版面與統一逐顆補子回放測試。 |",
    "| `tests/generator-layout-replay.test.js` | 測試 | 題目產生器版面與統一逐顆補子回放測試。 |\n| `tests/generator-source-order.test.js` | 測試 | 驗證根頁固定腳本順序、無分散式動態載入及建置腳本不改寫來源。 |",
  );
  doc = doc.replace(
    "驗證圖片模組、題目補守、唯一根網址 Bitboard 注入與正式建置必要 token。",
    "唯讀驗證圖片模組、固定載入順序、題目補守、根網址 Bitboard 與正式來源必要 token。",
  );
  doc = doc.replace(
    "驗證多組補守、最終補色與統一回放的明確事件。",
    "唯讀驗證多組補守、最終補色與統一回放的明確事件。",
  );
  write(relative, doc);
}

{
  const relative = "規格書.MD";
  let doc = read(relative);
  const marker = "- 模板枚舉使用頁面提供的同步棋型與禁手函式；根工作台由 `rapfi/vcf-bitboard-generator-compat.js` 提供相容層。";
  const replacement = marker + "\n- 題目產生器、工作台 UI、回放與題庫腳本由 `makevcf.html` 依單一固定順序載入；功能模組不得再以動態 `<script>` 注入其他正式模組。\n- Pages 建置只能驗證正式來源，不得在部署時改寫 `makevcf.html`、題目產生器、Evaluator 或回放程式。";
  if (!doc.includes("功能模組不得再以動態 `<script>`")) {
    doc = replaceOnce(doc, marker, replacement, relative);
  }
  write(relative, doc);
}

{
  const relative = "AGENTS.md";
  let doc = read(relative);
  const marker = "- 建置腳本不得注入已淘汰的舊流程；程式重構後同步更新建置驗證。";
  const replacement = marker + "\n- `makevcf.html` 必須明確列出正式腳本順序；`makevcf-mobile.js`、加成、相容、狀態或回放模組不得動態載入其他正式功能檔。\n- Pages 與 CI 建置驗證不得使用 `writeFileSync`、字串替換或其他方式改寫 Git 追蹤來源。";
  if (!doc.includes("Pages 與 CI 建置驗證不得使用 `writeFileSync`")) {
    doc = replaceOnce(doc, marker, replacement, relative);
  }
  write(relative, doc);
}

console.log("題目產生器第一階段重構已套用到正式來源。");
