"use strict";
const assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path");
const read=n=>fs.readFileSync(path.join(__dirname,"..",n),"utf8");
const files={
 html:read("index.html"),header:read("rapfi/rapfi-workbench-header.js"),
 recordTools:read("rapfi/vcf-record-tools.js"),
 layout:read("makevcf-layout.js"),codec:read("rapfi/5db-format.js"),
 cloud:read("rapfi/vcf-5db-cloud.js"),marks:read("rapfi/vcf-static-annotations.js"),
 server:read("api/5db.php"),builder:read("tools/prepare-pages-site.py"),
 srvbuild:read("tools/prepare-server-site.py"),deploy:read(".github/workflows/deploy-bd1.yml"),
 dashboard:read("rapfi/rapfi-bitboard-dashboard.js"),
 bitboardMain:read("rapfi/vcf-bitboard-main.js"),
 bitboardWorker:read("rapfi/vcf-bitboard-worker.js"),
};
function has(which, tokens) { for(const t of tokens) assert.ok(files[which].includes(t),which+": missing "+t); }
function lacks(which,tokens) {for(const t of tokens) assert.ok(!files[which].includes(t),which+": obsolete "+t);}
has("html",["rapfi/5db-format.js","rapfi/rapfi-workbench-header.js","makevcf-layout.js",
  "rapfi/vcf-static-annotations.js",'accept=".5db,application/octet-stream"']);
assert.ok(files.html.indexOf("rapfi/5db-format.js")<files.html.indexOf("rapfi/rapfi-workbench-header.js"));
lacks("html",['value="vcfdb"','value="yxdb"','value="lib"',"vcf-cloud-annotation-codec.js"]);
has("codec",["function validate(doc)","function encode(doc)","function decode(value)",
  "function checksum(bytes)","currentPath","nextSide","node.stone","node.marks",
  "function checkMark(mark, width, height)","MAX_NODES","MAX_MARKS", "function preview(doc)",
  'doc.phase === "setup"', "modeCode <= 2"]);
// Check for actual legacy implementation calls, not words in comments.
lacks("codec",["constructDBKey(", "canonicalPosition(", "YXDBStorage(", "parseYXDB("]);
has("header",["let fiveDBDoc = null","let fiveDBPath = []","const replay5DBPath = path =>",
  "const import5DBMarks = () =>","const capture5DBMarks = () =>","fiveDBNode(fiveDBPath)",
  "global.FiveDB.encode(doc)","async import5DBDocument(source)",
  "export5DBDocument()","initialize5DB(","fiveDBDoc.currentPath",
  "setGeneratedPuzzleAnswer(moves, attacker)", 'doc.phase = PUZZLE_SETUP',
  'source.phase !== PUZZLE_SETUP',
  "fiveDBNode(fiveDBPath)?.children","fiveDBDoc = JSON.parse(JSON.stringify(source))",
  'global.FiveDB.encode(doc)','"record-transform"','"5db-import"',
  'downloadBytes(bytes, "5db-" + timestampName() + ".5db")']);
has("layout",['async function loadRecordBytes(rawBytes, fileName = "棋譜.5db")',
  "window.FiveDB.decode(rawBytes)","import5DBDocument?.(doc)",
  'return loadRecordBytes(bytes, file.name || "棋譜.5db");',"不支援舊版棋譜格式"]);
lacks("layout",["window.VCFWorkbenchRecord?.importYXDB?.(",
  "window.VCFWorkbenchRecord?.importRoutes?.(", "function parseYXDB(", "function parseRenLib(", "function decompressLZ4Frame("]);
lacks("header",["importYXDB(", "importRoutes(", "exportYXDB()", "createRenLib(", "createYXDB(", "serializePuzzle(", "restoreYXDB(", "snapshotYXDB(", "vcf-puzzle-v1"]);
lacks("marks",["encode, decode"]);
lacks("header",["global.VCFRapfiFormats", "wrapLZ4Frame("]);
has("cloud",["global.VCFCloud5DB = api","FIVE_DB_API_URL","cloudFetch(", "controller.abort()", "雲端棋譜讀取失敗：", "重新讀取", "global.FiveDB.encode(doc)",
 "global.FiveDB?.decode?.(bytes)", "makeBoardThumbnail(snapshot)", "IntersectionObserver", "previewCache",
  "X-5DB-Preview", 'cloud-\${id}.5db',
 'file_name: name', "record.export5DBDocument()", '檔案名稱（不影響棋譜標題）',
 "auth_me","/Sched/api/index.php","credentials: \"same-origin\"",
 "sched-email-auth-heading","auth_email_login","auth_email_register","auth_email_forgot",
 "global.google.accounts.id.renderButton", "auth_google", "postLoginAction("]);
has("cloud", ["#vcf-shared-login-dialog{position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);margin:0;"]);
lacks("cloud",["VCFCloudYXDB","createLZ4Frame","vcf_google_auth_token_v1",
 "admin_user_delete","admin_user_role","admin_user_status","bb-cloud-admin",
 "/Sched/rank-auth.html", "<iframe", "loginPollTimer"]);
has("server",["FIVE_DB_MAX_FILE","verify5(","fnv1a32","FIVE_DB_MAX_ACCOUNT", "HTTP_X_5DB_PREVIEW", "file_name' => $fileName",
  "sched_site_auth","AuthTokenService.php","authCurrentUser(","flock(","storage5(","DOCUMENT_ROOT", "publicRoot", "privateBase",
  "realpath(","FILTER_VALIDATE_EMAIL","LOCK_EX","action === 'save'","action === 'get'"]);
has("builder",['"5db-format.js"']);
has("header",["const boardForPath = (path = fiveDBPath) =>", "const routeForPath = path =>",
  "fiveDBDoc.board[move] = normalized", 'positionBackend: recordActive ? "5db"',
  'global.dispatchEvent(new CustomEvent("vcf-workbench-ready"))']);
lacks("header",["VCFRapfiDB", "rapfiDbActive", "service.replayMove", "service.board()"]);
lacks("html",["VCFRapfiDB", "vcf-rapfi-db.js", "__vcfRapfiDbScheduled"]);
lacks("builder",["vcf-rapfi-db"]);
lacks("deploy",["vcf-rapfi-db", "Rapfi DB bridge"]);
has("recordTools",['board.addEventListener("pointerdown"',
  'board.addEventListener("contextmenu"', '!global.PointerEvent || event.pointerType === "touch"']);
has("srvbuild",['ROOT / "api" / "5db.php"','VCF_5DB_API_URL="/BD1/api/5db.php"']);
has("deploy",["php -l api/5db.php","test -s _site/api/5db.php","npm run test:architecture"]);
has("srvbuild",["window.VCF_CLOUD_API_URL=", "vcf-5db-cloud.js"]);
has("deploy",["--api-url /Sched/api/index.php"]);
has("deploy",["https://www.renju.org.tw/BD1/"]);
lacks("server",["https://www.renju.org.tw/BD/api/yxdb.php", "Authorization: Bearer"]);
lacks("deploy",["https://587.renju.org.tw/"]);
assert.ok(files.html.indexOf("棋盤操作") < files.html.indexOf('<h3 class="vcf-section-title">分析'), "board controls must appear first");
assert.ok(files.html.indexOf('id="vcf-calculation-navigation"') > files.html.indexOf('id="btn-multi-vcf"'), "playback must follow multi VCF");
assert.ok(files.html.indexOf('id="vcf-calculation-navigation"') < files.html.indexOf('id="btn-block-vcf"'), "playback belongs inside multi VCF");
assert.ok(files.html.includes('id="btn-rapfi-vcf-benchmark"') && !files.html.includes("Rapfi VCF（獨立測速）"));
assert.ok(files.layout.includes('board.addEventListener("wheel"'), "VCF playback must support board wheel");
assert.ok(files.layout.includes("window.VCFOverlayPlayback.step(delta)"), "single VCF must use native SVG playback");
assert.ok(files.html.includes("window.VCFOverlayPlayback = {"), "SVG renderer must own current route and step position");
assert.ok(files.html.includes("rapfi/rapfi-workbench-header.js?v=20261113-5db-workbench")
  && files.html.includes("rapfi/vcf-record-tools.js?v=20261113-5db-workbench"),
  "new 5DB editor and right-click handler must invalidate the previous browser cache");
// A newly deployed checkbox cannot work if the browser reuses an older
// calculation script, Worker or Wasm. All Bitboard assets share one revision.
const cacheVersion = asset => {
  const marker = asset + "?v=";
  const start = files.html.indexOf(marker);
  assert.ok(start >= 0, "missing cache-busting version for " + asset);
  const version = files.html.slice(start + marker.length).match(/^[a-zA-Z0-9.-]+/)?.[0];
  assert.ok(version, "invalid cache-busting version for " + asset);
  return version;
};
const engineRevision = cacheVersion("rapfi/engine/vcf-bitboard-engine.js");
assert.equal(cacheVersion("rapfi/vcf-bitboard-main.js"), engineRevision);
assert.equal(cacheVersion("rapfi/rapfi-bitboard-dashboard.js"), engineRevision);
has("bitboardMain", [
  'document.currentScript?.src', 'searchParams.get("v")',
  'url.searchParams.set("v", assetRevision)',
  'const workerURL = versionedAssetURL("rapfi/vcf-bitboard-worker.js")',
]);
has("bitboardWorker", [
  'const assetRevision = moduleURL.searchParams.get("v")',
  'assetURL.searchParams.set("v", assetRevision)',
]);
has("dashboard", [
  "距離限制：", "未啟用（原始 DFS）",
  "distanceLimited && info?.distanceLimited !== true",
]);

// Image import: DOM alignment, drag/drop, pointer zoom and mouse-only white stones.
has("html", ['id="import-image-viewport"', 'id="import-image-transform"',
  'imageViewport.addEventListener("drop"', 'imageViewport.addEventListener("wheel"',
  'imageViewport.addEventListener("pointerdown"', 'imageViewport.addEventListener("pointermove"',
  'imageViewport.addEventListener("pointerup", finishImageTouch, true)',
  'activeImageTouches', 'imageTouches.size > 1', 'resetImageView()',
  'imageTransform.style.transform', 'const color = evt.button === 2 ? 2 : 1',
  'imageViewport.addEventListener("contextmenu"']);
const mobilePresentation = read("makevcf-mobile.js");
assert.ok(mobilePresentation.includes("canvasWrap.getBoundingClientRect().height"),
  "move-order table height must use unzoomed viewport");
assert.ok(mobilePresentation.includes('event.pointerType === "touch" && !event.isPrimary'),
  "second finger must cancel touch hold when pinching");

// Execute the actual preview edit handler with a 15x15 synthetic grid.
// Desktop mouse: left=black/clear, right=white/clear. Touch: existing cycle.
const editStart = files.html.indexOf("  function editPreviewPoint(evt) {");
const editEnd = files.html.indexOf("  function renderNotationPaperPreview()", editStart);
assert.ok(editStart >= 0 && editEnd > editStart, "image editor must be present");
const factory = new Function("importState", "getCanvasPoint", "sourceCanvas",
  "WARP_SIZE", "nearestGridIndex", "getRefinedGridStep", "renderRecognitionPreview",
  "setImportStatus", "SIZE",
  files.html.slice(editStart, editEnd) + "\nreturn editPreviewPoint;");
const board = Array(225).fill(0);
const grid = Array.from({length:15}, (_, i) => 30 + i * 60);
const state = {mode:"recognized", recognizedBoard:board, confidenceMap:Array(225).fill(0),
  gridXs:grid, gridYs:grid};
const nearest = (values, coordinate) => {
  let bestIndex = 0, bestDistance = Infinity;
  values.forEach((value, index) => {
    const distance = Math.abs(value - coordinate);
    if (distance < bestDistance) {bestIndex=index; bestDistance=distance;}
  });
  return {index:bestIndex, distance:bestDistance};
};
const edit = factory(state, () => ({x:30,y:30}), {width:900,height:900}, 900, nearest,
  () => 60, () => {}, () => {}, 15);
const pointer = (pointerType, button) => ({pointerType,button,preventDefault() {}});
edit(pointer("mouse",0)); assert.equal(board[0],1);
edit(pointer("mouse",0)); assert.equal(board[0],0);
edit(pointer("mouse",2)); assert.equal(board[0],2);
edit(pointer("mouse",2)); assert.equal(board[0],0);
edit(pointer("mouse",2)); assert.equal(board[0],2);
edit(pointer("mouse",0)); assert.equal(board[0],1);
edit(pointer("touch",0)); assert.equal(board[0],2);
edit(pointer("touch",0)); assert.equal(board[0],0);

console.log("5DB workbench and deployment integration contract passed");
