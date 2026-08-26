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
  '"btn-vcf-prev": "前一分支"',
  '"btn-vcf-next": "後一分支"',
  "route.slice(0, replayPly)",
  "decompressLZ4Frame",
  "parseYXDB",
  "parseRenLib",
  'button.id = "bb-import-record"',
  'window.vcfWithBoardChangeSource("record-playback"',
  'recordNavigation.id = "vcf-record-navigation"',
  'recordCommentInput.id = "vcf-record-comment-input"',
  'replaceRapfiComment',
]) if (!layout.includes(token)) throw new Error(`branch replay contract missing: ${token}`);
if (layout.includes("MutationObserver") || layout.includes("setInterval(")) {
  throw new Error("branch replay must not poll or observe the whole page");
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

console.log("Workbench and repository architecture checks passed");

// Rapfi DB-backed record model contract.
if (!layout.includes('btn-vcf-branch-prev')) throw new Error('棋譜導覽需固定包含前一分支按鈕');
if (!layout.includes('btn-vcf-branch-next')) throw new Error('棋譜導覽需固定包含後一分支按鈕');
if (!layout.includes('parseRapfiRecordText')) throw new Error('YXDB loader 必須解析 Rapfi record text');
if (!layout.includes('vcf-record-text-layer')) throw new Error('工作台必須顯示 Rapfi @BTXT@ 盤面標記');
if (!header.includes('VCFWorkbenchRecord')) throw new Error('盤面必須保存可匯出的落子 history');
if (!header.includes('normalizeSetupHistory')) throw new Error('YXDB setup path 必須以實際 history 驗證');
