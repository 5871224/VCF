"use strict";

const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");
const exists = file => fs.existsSync(path.join(root, file));

for (const removed of [
  "app",
  "cpp",
  "vcf-live-four-grouping-option.js",
  "rapfi/vcf-bitboard-worker-v4.js",
  "rapfi/vcf-first-nontarget-worker.js",
  "eval/engine.js",
  "VCF介面規格.MD",
  "介面配置規格.MD",
]) {
  if (exists(removed)) throw new Error(`obsolete project path remains: ${removed}`);
}

const main = read("rapfi/vcf-bitboard-main.js");
for (const token of [
  "const normalizeRules = rules =>",
  "vcfBbLegacyGetLevelPointCompat",
  "vcfBbLegacyTestLineFourCompat",
  "global.vcfNormalizeRules = normalizeRules",
  "this.rules = normalizeRules(rules)",
]) if (!main.includes(token)) throw new Error(`bitboard runtime contract missing: ${token}`);
if (main.includes("Number(rules) || 2")) throw new Error("free-rule falsy fallback remains");

const bitboardWorker = read("rapfi/vcf-bitboard-worker.js");
for (const [file, source] of [
  ["rapfi/vcf-bitboard-main.js", main],
  ["rapfi/vcf-bitboard-worker.js", bitboardWorker],
]) {
  if (source.includes("VCFRapfiDB") || source.includes("vcfRapfiDb")) {
    throw new Error(`${file} must not depend on the Rapfi record DB; VCF search hot path must stay isolated`);
  }
}

const rapfiDbSearchIsolation = read("rapfi/vcf-rapfi-db.js");
if (rapfiDbSearchIsolation.includes("findVCF") || rapfiDbSearchIsolation.includes("vcfRegisterEngineRequestProvider")) {
  throw new Error("Rapfi record DB adapter must not participate in VCF search requests");
}

const runtime = read("rapfi/vcf-bitboard-generator-compat.js");
for (const token of [
  "global.vcfSetRules = async rules =>",
  'new CustomEvent("vcf-board-changed"',
  "global.vcfRegisterStatusFormatter",
  "global.vcfRegisterTrimGroupsProvider",
  "global.vcfRegisterSearchHandler",
  "global.vcfInvalidateAnalysis",
]) if (!runtime.includes(token)) throw new Error(`workbench runtime contract missing: ${token}`);

const noOverrides = [
  "rapfi/rapfi-bitboard-dashboard.js",
  "rapfi/vcf-shortest-vcf-ui.js",
  "rapfi/rapfi-question-bank.js",
  "rapfi/vcf-forbidden-overlay.js",
  "rapfi/rapfi-workbench-header.js",
  "rapfi/vcf-record-tools.js",
  "makevcf-generator-integrated.js",
];
const forbiddenAssignments = [
  /\bsetBusy\s*=(?!=)/,
  /\bsetStatus\s*=(?!=)/,
  /\bdoSearch\s*=(?!=)/,
  /\bdoAddVCF\s*=(?!=)/,
  /engine\.findVCF\s*=/,
  /engine\.trimVCFGroups\s*=/,
  /pool\.getLevelPoints\s*=/,
  /genEngine\.findVCF\s*=/,
  /_setBoardArr\s*=/,
  /_clearBoard\s*=/,
];
for (const file of noOverrides) {
  const source = read(file);
  for (const pattern of forbiddenAssignments) {
    if (pattern.test(source)) throw new Error(`${file} still overrides ${pattern}`);
  }
}

const dashboard = read("rapfi/rapfi-bitboard-dashboard.js");
for (const token of [
  'vcfRegisterSearchHandler?.("single"',
  'vcfRegisterSearchHandler?.("multi"',
  'vcfRegisterSearchHandler?.("add"',
  "vcfRegisterEngineRequestProvider",
  "genRegisterFindRequestProvider",
]) if (!dashboard.includes(token)) throw new Error(`dashboard registration missing: ${token}`);
if (dashboard.includes("stopImmediatePropagation")) throw new Error("dashboard still intercepts button events directly");

const layout = read("makevcf-layout.js");
new Function(layout); // parse the actual browser layout script, not only string contracts
for (const token of [
  'document.title = "五子棋工作台"',
  '<h1>五子棋工作台</h1>',
  'prevStepButton.id = "btn-vcf-step-prev"',
  'nextStepButton.id = "btn-vcf-step-next"',
  '"btn-vcf-prev": "上一組"',
  '"btn-vcf-next": "下一組"',
  'calcGroupSelect.id = "vcf-calculation-group-select"',
  "calculationDisplay",
  "renderRecordNextMoveMarkers",
  "renderCalculationNextMoveMarkers",
  "route.slice(0, ply)",
  "decompressLZ4Frame",
  "parseYXDB",
  "parseRenLib",
  'button.id = "bb-import-record"',
  'window.VCFWorkbenchRecord?.importYXDB?.(bytes, parsed.rule, state.history, state.basePly)',
  'window.VCFWorkbenchRecord?.importRoutes?.(routes, rule, openHistory)',
  'recordNavigation.id = "vcf-record-navigation"',
  'recordCommentInput.id = "vcf-record-comment-input"',
  'replaceRapfiComment',
  'parsedImportState',
  'collectRenLibRoutes',
  'setupHistoryForParsedBoard',
]) if (!layout.includes(token)) throw new Error(`branch replay contract missing: ${token}`);
if (layout.includes("MutationObserver") || layout.includes("setInterval(")) {
  throw new Error("branch replay must not poll or observe the whole page");
}
if (layout.includes("if (currentReplayRoute().length)")) {
  throw new Error("record navigation must never fall through to VCF calculation playback");
}
if (!layout.includes("VCF 計算展示只使用 SVG overlay，不呼叫 _setBoardArr，也不寫入 VCFWorkbenchRecord")) {
  throw new Error("calculation display isolation contract missing");
}
if (!layout.includes("function renderCalculationDisplay({ updateStatus = true } = {})")
    || !layout.includes("renderCalculationDisplay({ updateStatus: false })")
    || !layout.includes('if (updateStatus && typeof setStatus === "function")')) {
  throw new Error("calculation result sync must preserve completed search statistics");
}
const workbenchHtml = read("makevcf.html");
if (workbenchHtml.includes('pathname.endsWith("/VCF")')
    || workbenchHtml.includes('pathname.endsWith("/VCF/index.html")')) {
  throw new Error("Bitboard deployment entry must not be hard-coded to /VCF");
}
for (const token of [
  'if (pathname.endsWith("/index.html"))',
  'const entryName = trimmedPath.split("/").filter(Boolean).pop() || "";',
  'if (entryName.includes(".")) return;',
  'vcf-bitboard-main.js?v=20260914-bd-timing',
]) if (!workbenchHtml.includes(token)) {
  throw new Error(`path-independent Bitboard entry contract missing: ${token}`);
}
if (!workbenchHtml.includes("includeStats: true")
    || !workbenchHtml.includes("const pureStats = combinePureEngineStats(vcfResult, blockResult, data)")) {
  throw new Error("defense statistics display contract missing");
}
if (!main.includes("normalized.includeStats ? result : result.points")) {
  throw new Error("getBlockVCF detailed statistics bridge missing");
}

const recordTools = read("rapfi/vcf-record-tools.js");
new Function(recordTools);
if (recordTools.includes("VCFImportedRecordAPI")) {
  throw new Error("record tools must route only through VCFWorkbenchRecord");
}
if (!recordTools.includes("const basePly = Math.max(0, Math.min(history.length, Number(snapshot?.basePly || 0)))")) {
  throw new Error("record hand numbers must ignore imported setup plies");
}
for (const token of [
  'double_arrow_left.svg',
  'photo.svg',
  'edit.svg',
  'font.svg',
  'cancel.svg',
  'number.svg',
  'flip.svg',
  'rotate_90.svg',
  'forbidden.svg',
  'circle.svg',
  'circle_n.svg',
  'vcf-record-marker-text',
  'deleteCurrentAndFollowing',
  'transformRecord(4)',
  'transformRecord(1)',
]) if (!recordTools.includes(token)) throw new Error(`record tools contract missing: ${token}`);
for (const excluded of ['share.svg', 'link.svg', 'grid_3x3.svg', 'flag.svg', 'flag_check.svg']) {
  if (recordTools.includes(excluded)) throw new Error(`excluded record control returned: ${excluded}`);
}
for (const icon of [
  'double_arrow_left.svg','arrow_left.svg','arrow_right.svg','double_arrow_right.svg','photo.svg','edit.svg','font.svg','Aa.svg','star.svg','arrow.svg','delete.svg','cancel.svg','number.svg','settings.svg','dock_top.svg','dock_left.svg','flip.svg','rotate_90.svg','forbidden.svg','circle.svg','circle_n.svg'
]) {
  if (!exists(`rapfi/record-svg/${icon}`)) throw new Error(`record SVG missing: ${icon}`);
}

const questionBank = read("rapfi/rapfi-question-bank.js");
for (const token of ["vcf-board-changed", "vcfRegisterBusyHook", "vcfWithBoardChangeSource"]) {
  if (!questionBank.includes(token)) throw new Error(`question bank event contract missing: ${token}`);
}
const forbidden = read("rapfi/vcf-forbidden-overlay.js");
if (!forbidden.includes("vcf-board-changed") || !forbidden.includes("vcf-rule-changed")) {
  throw new Error("forbidden overlay is not event driven");
}
const header = read("rapfi/rapfi-workbench-header.js");
if (!header.includes("vcfSetRules")) throw new Error("header does not use canonical rule API");
if (header.includes("MutationObserver") || header.includes("setInterval(")) {
  throw new Error("header still polls or observes the whole page");
}
for (const token of [
  "global.VCFRapfiFormats = RapfiFormats",
  "createYXDB",
  "addYXDBSetupPath",
  "createRenLib",
  'Rapfi YXDB (.db)',
  'RenLib (.lib)',
  'rootRecordText',
  'setCurrentRecordText',
  'vcf-record-state-changed',
  'appendPass()',
  'deleteCurrentAndFollowing()',
  'transform(transform)',
  'vcf_rapfi_workbench_v1',
  'snapshotYXDB()',
  'restoreYXDB(base64ToBytes(saved.db), currentRule)',
  'service.children()',
  'service.history()',
  'service.getDisplayText()',
  'service.setDisplayText(String(text || ""))',
  'service.deleteCurrentAndChildren()',
  'service.cloneRule(currentRule, nextRule)',
  'positionBackend: rapfiDbActive ? "rapfi-db" : "initializing"',
  'global.addEventListener("vcf-rapfi-db-ready"',
  'YXDB 無法表示 PASS',
]) if (!header.includes(token)) throw new Error(`Rapfi export contract missing: ${token}`);

const rapfiFormats = require(path.join(root, "rapfi/rapfi-workbench-header.js"));
const boardOf = stones => {
  const board = new Array(225).fill(0);
  for (const [idx, color] of stones) board[idx] = color;
  return board;
};
const formatBoard = boardOf([[112, 1], [113, 2]]);
const yxdb = rapfiFormats.createYXDB({ board: formatBoard, rule: 2 });
if (yxdb.recordCount !== 3) throw new Error("YXDB must include empty→setup root path");
if (!yxdb.compressed) throw new Error("YXDB export must use a standard LZ4 frame");
if (Array.from(yxdb.bytes.slice(0, 7)).join(",") !== "4,34,77,24,68,64,94") {
  throw new Error("YXDB LZ4 frame header is not Rapfi-compatible");
}
function unwrapTestLZ4(bytes) {
  let offset = 7;
  const chunks = [];
  let length = 0;
  while (offset + 4 <= bytes.length) {
    let blockSize = (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0;
    offset += 4;
    if (blockSize === 0) break;
    if (!(blockSize & 0x80000000)) throw new Error("test fixture expects uncompressed LZ4 blocks");
    blockSize &= 0x7fffffff;
    const block = bytes.slice(offset, offset + blockSize);
    if (block.length !== blockSize) throw new Error("YXDB LZ4 block is truncated");
    chunks.push(block);
    length += blockSize;
    offset += blockSize;
  }
  if (offset + 4 > bytes.length) throw new Error("YXDB LZ4 content checksum is missing");
  const payload = new Uint8Array(length);
  let out = 0;
  for (const chunk of chunks) { payload.set(chunk, out); out += chunk.length; }
  return payload;
}
const yxdbPayload = unwrapTestLZ4(yxdb.bytes);
if (Array.from(yxdbPayload.slice(0, 4)).join(",") !== "4,0,0,0") {
  throw new Error("YXDB record-count header is invalid after LZ4 unwrap");
}
const mirroredBoard = boardOf([[112, 1], [111, 2]]);
const mirroredYXDB = rapfiFormats.createYXDB({ board: mirroredBoard, rule: 2 });
if (Buffer.compare(Buffer.from(yxdb.bytes), Buffer.from(mirroredYXDB.bytes)) !== 0) {
  throw new Error("YXDB symmetry canonicalization is inconsistent");
}

const markedBoard = boardOf([[112, 1], [98, 2], [113, 1], [97, 2]]);
// Diagonal reflection (x,y) -> (y,x): 112->112, 98->126, 113->127, 97->111.
const markedMirror = boardOf([[112, 1], [126, 2], [127, 1], [111, 2]]);
const markedYXDB = rapfiFormats.createYXDB({
  board: markedBoard,
  rule: 2,
  history: [
    { index: 112, stone: 1 },
    { index: 98, stone: 2 },
    { index: 113, stone: 1 },
    { index: 97, stone: 2, recordText: "@BTXT@70A\b對稱標記" },
  ],
  historyExact: true,
});
const markedMirrorYXDB = rapfiFormats.createYXDB({
  board: markedMirror,
  rule: 2,
  history: [
    { index: 112, stone: 1 },
    { index: 126, stone: 2 },
    { index: 127, stone: 1 },
    { index: 111, stone: 2, recordText: "@BTXT@07A\b對稱標記" },
  ],
  historyExact: true,
});
if (Buffer.compare(Buffer.from(markedYXDB.bytes), Buffer.from(markedMirrorYXDB.bytes)) !== 0) {
  throw new Error("YXDB canonicalization did not transform @BTXT@ marker coordinates with the board");
}
const formatRoutes = [[111, 126, 110]];
const routedYXDB = rapfiFormats.createYXDB({ board: formatBoard, routes: formatRoutes, attacker: 1, rule: 2 });
if (routedYXDB.recordCount !== 6) throw new Error("YXDB setup path + route prefixes were not persisted");
const routedPayload = unwrapTestLZ4(routedYXDB.bytes);
if (!Buffer.from(routedPayload).includes(Buffer.from('charset="UTF-8"'))) {
  throw new Error("YXDB UTF-8 metadata is missing");
}
const annotatedYXDB = rapfiFormats.createYXDB({
  board: formatBoard,
  rule: 2,
  history: [
    { index: 112, stone: 1, recordText: "第一手盤面注釋" },
    { index: 113, stone: 2, recordText: "第二手盤面注釋" },
  ],
  historyExact: true,
  rootRecordText: "空盤注釋",
});
const annotatedPayload = Buffer.from(unwrapTestLZ4(annotatedYXDB.bytes));
for (const text of ["空盤注釋", "第一手盤面注釋", "第二手盤面注釋"]) {
  if (!annotatedPayload.includes(Buffer.from(text))) throw new Error(`YXDB missing per-position comment: ${text}`);
}
let rejectedInvalidYXDB = false;
try {
  rapfiFormats.createYXDB({ board: boardOf([[10, 1], [11, 1]]) });
} catch (error) {
  rejectedInvalidYXDB = /無法無損表示/.test(String(error.message));
}
if (!rejectedInvalidYXDB) throw new Error("YXDB accepted a non-alternating static position");
let rejectedWrongAttacker = false;
try {
  rapfiFormats.createYXDB({ board: formatBoard, routes: [[111]], attacker: 2, rule: 2 });
} catch (error) {
  rejectedWrongAttacker = /下一手應為黑/.test(String(error.message));
}
if (!rejectedWrongAttacker) throw new Error("YXDB accepted a route with the wrong side to move");
const lib = rapfiFormats.createRenLib({ board: formatBoard, routes: formatRoutes, attacker: 1 });
if (Array.from(lib.bytes.slice(0, 10)).join(",") !== "255,82,101,110,76,105,98,255,3,0") {
  throw new Error("RenLib 3.x header is invalid");
}
const arbitraryLib = rapfiFormats.createRenLib({ board: boardOf([[0, 1], [1, 1], [2, 1], [30, 2]]) });
if (arbitraryLib.bytes.length <= 20) throw new Error("RenLib did not encode an arbitrary static setup with PASS");
const whiteFirstLib = rapfiFormats.createRenLib({ board: boardOf([[30, 2]]) });
if (whiteFirstLib.bytes[20] !== 0 || whiteFirstLib.bytes[22] !== 0) {
  throw new Error("RenLib white-first static setup is missing the legacy ROOT plus real PASS");
}

const image = read("makevcf-generator-image-import-fix.js");
for (const token of ["vcfRegisterImageDataProcessor", "vcfRegisterHoughLineProvider", "installWhenCvReady"]) {
  if (!image.includes(token)) throw new Error(`image registry missing: ${token}`);
}
if (image.includes("new Error().stack") || image.includes("warpCallSequence") || image.includes("setInterval(")) {
  throw new Error("image import still relies on stack inspection or unbounded polling");
}
if ((image.match(/prototype\.getImageData\s*=/g) || []).length !== 1) {
  throw new Error("image data adapter must be installed exactly once");
}
if ((image.match(/cv\.HoughLinesP\s*=/g) || []).length !== 1) {
  throw new Error("Hough adapter must be installed exactly once");
}

const legacy = read("makevcf-optimized-search-v2.js");
if (!legacy.includes("__vcfLegacyBenchmarkRemoved") || /new Worker|MutationObserver|setBusy\s*=/.test(legacy)) {
  throw new Error("legacy optimized search is not a passive compatibility stub");
}

for (const file of ["README.md", "AGENTS.md", "檔案用途總覽.MD", "規格書.MD"]) {
  const source = read(file);
  for (const obsolete of ["VCF介面規格.MD", "介面配置規格.MD", "`app/` Electron", "`cpp/` Native"]) {
    if (source.includes(obsolete)) throw new Error(`${file} still references obsolete content: ${obsolete}`);
  }
}

const pages = read(".github/workflows/pages.yml");
if (pages.includes("cp -R eval emoji bitboard rapfi")) throw new Error("Pages still deploys whole source directories");
if (!pages.includes("prepare-pages-site.py")) throw new Error("Pages does not use the deployment allowlist builder");
const pagesBuilder = read("tools/prepare-pages-site.py");
if (!pagesBuilder.includes('"vcf-record-tools.js"') || !pagesBuilder.includes('"record-svg"')) {
  throw new Error("Pages allowlist is missing record tools or SVG assets");
}

const pureStatsHtml = read("makevcf.html");
const pureStatsDashboard = read("rapfi/rapfi-bitboard-dashboard.js");
const pureStatsShortest = read("rapfi/vcf-shortest-vcf-ui.js");
const pureStatsMain = read("rapfi/vcf-bitboard-main.js");
for (const token of [
  "function normalizePureEngineStats(info = {})",
  "function combinePureEngineStats(...items)",
  "function formatPureEngineStats(info = {})",
  "window.vcfFormatPureEngineStats = formatPureEngineStats",
]) if (!pureStatsHtml.includes(token)) throw new Error(`pure engine stats helper missing: ${token}`);
if (!pureStatsDashboard.includes("window.vcfFormatPureEngineStats(info)")
    || !pureStatsDashboard.includes("window.vcfFormatPureEngineStats(data)")
    || !pureStatsDashboard.includes("elapsedMs += Number(info?.elapsedMs || 0)")
    || !pureStatsDashboard.includes("Math.max(0, ...results.map(result => Number(result.elapsedMs || 0)))")) {
  throw new Error("dashboard final statistics must use pure engine timing");
}
if (!pureStatsShortest.includes("global.vcfFormatPureEngineStats?.(info)")) {
  throw new Error("shortest VCF final statistics must use pure engine timing");
}
if (!pureStatsMain.includes("nodesPerSecond: elapsedMs > 0 ? nodeCount * 1000 / elapsedMs : 0")) {
  throw new Error("parallel engine result must return pure throughput");
}
if (!pureStatsHtml.includes('rapfi/vcf-shortest-vcf-ui.js?v=20260914-pure-engine-stats')) {
  throw new Error("pure engine stats scripts must be cache-busted");
}
console.log("Workbench and repository architecture checks passed");

// Rapfi DB-backed record model contract.
if (!layout.includes('btn-vcf-branch-prev')) throw new Error('棋譜導覽需固定包含前一分支按鈕');
if (!layout.includes('btn-vcf-branch-next')) throw new Error('棋譜導覽需固定包含後一分支按鈕');
if (!layout.includes('parseRapfiRecordText')) throw new Error('YXDB loader 必須解析 Rapfi record text');
if (!recordTools.includes('vcf-record-marker-layer') || !recordTools.includes('parseRecordText')) {
  throw new Error('工作台必須由 record-tools 顯示 Rapfi @BTXT@ 盤面標記');
}
if (!header.includes('VCFWorkbenchRecord')) throw new Error('盤面必須保存可匯出的落子 history');
if (!header.includes('normalizeSetupHistory')) throw new Error('YXDB setup path 必須以實際 history 驗證');


// Manual record-tree navigation and visible annotation contract.
for (const token of [
  'calculationNavigation.id = "vcf-calculation-navigation"',
  '<strong>展示計算</strong>',
  'calcPrevStepButton.id = "btn-vcf-calc-step-prev"',
  'calcNextStepButton.id = "btn-vcf-calc-step-next"',
  'calcPrevGroupButton.id = "btn-vcf-calc-group-prev"',
  'calcNextGroupButton.id = "btn-vcf-calc-group-next"',
  'window.addEventListener("vcf-result-changed"',
  'calculationNavigation.classList.toggle("is-active", hasResult)',
]) if (!layout.includes(token)) throw new Error(`calculation display contract missing: ${token}`);
if (layout.includes('if (currentReplayRoute().length) {\n      moveVcfReplay(-1)')) {
  throw new Error("record previous-step button still delegates to VCF calculation replay");
}
if (layout.includes('if (currentReplayRoute().length && moveVcfBranch(-1)) return;')) {
  throw new Error("record branch button still delegates to VCF calculation replay");
}
for (const forbiddenToken of [
  "importedTree",
  "VCFImportedRecordAPI",
  "moveImportedStep",
  "moveImportedBranch",
  "renderImportedNode",
]) {
  if (layout.includes(forbiddenToken)) {
    throw new Error(`obsolete imported-record tree remains: ${forbiddenToken}`);
  }
}
const dashboardResultLifecycle = read("rapfi/rapfi-bitboard-dashboard.js");
for (const token of [
  'const notifyVcfResultChanged = () =>',
  'new CustomEvent("vcf-result-changed"',
  'notifyVcfResultChanged();',
]) if (!dashboardResultLifecycle.includes(token)) throw new Error(`VCF result lifecycle contract missing: ${token}`);
const calculationEntry = read("makevcf.html");
if (!calculationEntry.includes('makevcf-layout.js?v=20260920-rollback1')
    || !calculationEntry.includes('rapfi/rapfi-bitboard-dashboard.js?v=20260914-pure-engine-stats')) {
  throw new Error("calculation display scripts must be cache-busted");
}

for (const token of [
  'boardCard.appendChild(annotationCard)',
  'recordCommentInput.id = "vcf-record-comment-input"',
  'renderRecordNextMoveMarkers',
  'vcf-record-next-move-layer',
  'VCFWorkbenchRecord?.navigateStep?.(-1)',
  'VCFWorkbenchRecord?.navigateStep?.(1)',
  'VCFWorkbenchRecord?.navigateBranch?.(-1)',
  'VCFWorkbenchRecord?.navigateBranch?.(1)',
  'renderRecordNextMoveMarkers(event.detail?.nextMoves || [])',
]) if (!layout.includes(token)) throw new Error(`manual record navigation contract missing: ${token}`);
for (const token of [
  'vcf_rapfi_workbench_v1',
  'navigateStep(direction)',
  'navigateBranch(direction)',
  'selectedNextMove',
  'const nextMoves = queryChildren();',
  'nextBranchCount: nextMoves.length',
  'service.undo()',
  'service.play(move, false)',
  'service.snapshotYXDB()',
  'async importYXDB(bytes, rule, history = [], importedBasePly = 0)',
  'async importRoutes(routes, rule, openHistory = [])',
  'basePly',
]) if (!header.includes(token)) throw new Error(`Rapfi record state contract missing: ${token}`);
for (const forbiddenToken of [
  'vcf_board_record_tree_v3',
  'vcf_board_history_v2',
  'positionRecords',
  'sharedChildKeyCache',
  'sharedNextMoveCache',
  'sharedNextMovesForNode',
  'rebuildRapfiDatabase',
  'js-fallback',
]) {
  if (header.includes(forbiddenToken)) {
    throw new Error(`obsolete JavaScript record-state fallback remains: ${forbiddenToken}`);
  }
}
const entry = read("makevcf.html");
if (!entry.includes('makevcf-layout.js?v=20260920-rollback1')
    || !entry.includes('rapfi/rapfi-workbench-header.js?v=20260920-rollback1')
    || !entry.includes('rapfi/vcf-record-tools.js?v=20260920-rollback1')) {
  throw new Error("record UI scripts must be cache-busted and load the record tools module");
}

const cloudYXDB = read("rapfi/vcf-lz4-cloud.js");
for (const token of [
  'window.VCFRecordImportAPI = {',
  'loadRecordBytes(rawBytes',
  'options?.openAtEnd ? deepestParsedNode(parsed) : parsed.current',
  'VCFWorkbenchRecord?.importYXDB?.(bytes, parsed.rule, state.history, state.basePly)',
  'VCFWorkbenchRecord?.importRoutes?.(routes, rule, openHistory)',
]) if (!layout.includes(token)) throw new Error(`record byte importer contract missing: ${token}`);
for (const token of [
  'const importer = global.VCFRecordImportAPI;',
  'importer.loadBytes(result.bytes',
  'loadButton.textContent = "載入棋譜";',
]) if (!cloudYXDB.includes(token)) throw new Error(`cloud record load contract missing: ${token}`);
const rapfiDbAdapter = read("rapfi/vcf-rapfi-db.js");
for (const token of [
  'global.VCFRapfiDB = facade;',
  'global.VCFRapfiDBModule',
  'vcfRapfiDbQueryChildren',
  'vcfRapfiDbSetDisplayText',
  'vcfRapfiDbGetDisplayText',
  'vcfRapfiDbExportYXDB',
  'vcfRapfiDbImportYXDB',
  'vcfRapfiDbDeleteCurrentAndChildren',
  'vcfRapfiDbCloneRule',
  'snapshotYXDB()',
  'restoreYXDB(value, rule = 2)',
]) if (!rapfiDbAdapter.includes(token)) throw new Error(`Rapfi DB adapter contract missing: ${token}`);
const rapfiDbBridge = read("rapfi/vcf-rapfi-db-bridge.cpp");
for (const token of [
  'DBClient',
  'DBRecord',
  'constructDBKey',
  'vcfRapfiDbQueryChildren',
  'vcfRapfiDbSetDisplayText',
  'vcfRapfiDbGetDisplayText',
  'YXDBStorage',
  'vcfRapfiDbExportYXDB',
  'vcfRapfiDbImportYXDB',
  'vcfRapfiDbDeleteCurrentAndChildren',
  'vcfRapfiDbCloneRule',
]) if (!rapfiDbBridge.includes(token)) throw new Error(`Rapfi DB bridge contract missing: ${token}`);
const pagesBuilderCloud = read("tools/prepare-pages-site.py");
if (!pagesBuilderCloud.includes('rapfi/vcf-lz4-cloud.js?v=20260913-cloud-load-board')) {
  throw new Error("cloud record script must be cache-busted in Pages artifact");
}
if (!pagesBuilderCloud.includes('rapfi/engine/vcf-rapfi-db.js')
    || !pagesBuilderCloud.includes('rapfi/vcf-rapfi-db.js?v=20260920-rapfi-db')
    || !pagesBuilderCloud.includes('vcf-rapfi-db.*')) {
  throw new Error("Rapfi DB bridge must be deployed before the workbench header");
}

const recordToolsMarkerToggle = read("rapfi/vcf-record-tools.js");
for (const token of [
  'const SETTINGS_VERSION = 2;',
  'editMode: true,',
  'if (savedVersion < SETTINGS_VERSION) state.editMode = true;',
  'JSON.stringify({ ...state, version: SETTINGS_VERSION })',
]) if (!recordToolsMarkerToggle.includes(token)) throw new Error(`direct board edit contract missing: ${token}`);
for (const token of [
  'markerInput.classList.add("vcf-record-marker-control")',
  'const markerControlsVisible = state.editMode && state.markerMode',
  'markerInput.hidden = !markerControlsVisible',
  'button.hidden = !markerControlsVisible',
  'const markerText = markerInput.value.trim()',
  'if (point.index >= 0) addOrReplaceMarker(point.index)',
]) if (!recordToolsMarkerToggle.includes(token)) throw new Error(`marker toggle contract missing: ${token}`);

const pagesBuild = read("tools/prepare-pages-site.py");
if (pagesBuild.includes('<script src="rapfi/engine/vcf-rapfi-db.js"></script>') || pagesBuild.includes('<script src="rapfi/vcf-rapfi-db.js')) throw new Error("GitHub Pages must not auto-load Rapfi DB during root startup");
