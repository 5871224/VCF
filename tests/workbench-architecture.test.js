"use strict";
const assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path");
const read=n=>fs.readFileSync(path.join(__dirname,"..",n),"utf8");
const files={
 html:read("index.html"),header:read("rapfi/rapfi-workbench-header.js"),
 layout:read("makevcf-layout.js"),codec:read("rapfi/5db-format.js"),
 cloud:read("rapfi/vcf-5db-cloud.js"),marks:read("rapfi/vcf-static-annotations.js"),
 server:read("api/5db.php"),builder:read("tools/prepare-pages-site.py"),
 srvbuild:read("tools/prepare-server-site.py"),deploy:read(".github/workflows/deploy-bd1.yml"),
};
function has(which, tokens) { for(const t of tokens) assert.ok(files[which].includes(t),which+": missing "+t); }
function lacks(which,tokens) {for(const t of tokens) assert.ok(!files[which].includes(t),which+": obsolete "+t);}
has("html",["rapfi/5db-format.js","rapfi/rapfi-workbench-header.js","makevcf-layout.js",
  "rapfi/vcf-static-annotations.js",'accept=".5db,application/octet-stream"']);
assert.ok(files.html.indexOf("rapfi/5db-format.js")<files.html.indexOf("rapfi/rapfi-workbench-header.js"));
lacks("html",['value="vcfdb"','value="yxdb"','value="lib"',"vcf-cloud-annotation-codec.js"]);
has("codec",["function validate(doc)","function encode(doc)","function decode(value)",
  "function checksum(bytes)","currentPath","nextSide","node.stone","node.marks",
  "function checkMark(mark, width, height)","MAX_NODES","MAX_MARKS"]);
lacks("codec",["canonical","YXDB"]);
has("header",["let fiveDBDoc = null","let fiveDBPath = []","const replay5DBPath = path =>",
  "const import5DBMarks = () =>","const capture5DBMarks = () =>","fiveDBNode(fiveDBPath)",
  "global.FiveDB.encode(document)","async import5DBDocument(source)",
  "export5DBDocument(title","initialize5DB(","fiveDBDoc.currentPath",
  "fiveDBNode(fiveDBPath)?.children","fiveDBDoc = JSON.parse(JSON.stringify(source))",
  'saveState(false)','"record-transform"','"5db-import"',
  'downloadBytes(bytes, "5db-" + timestampName() + ".5db")']);
has("layout",['async function loadRecordBytes(rawBytes, fileName = "棋譜.5db")',
  "window.FiveDB.decode(rawBytes)","import5DBDocument?.(doc)",
  'return loadRecordBytes(bytes, file.name || "棋譜.5db");',"不支援舊版棋譜格式"]);
lacks("layout",["window.VCFWorkbenchRecord?.importYXDB?.(",
  "window.VCFWorkbenchRecord?.importRoutes?.("]);
lacks("marks",["encode, decode"]);
has("cloud",["global.VCFCloud5DB = api","FIVE_DB_API_URL","global.FiveDB.encode(doc)",
 "global.FiveDB?.decode?.(bytes)",'cloud-\${id}.5db',
 "auth_me","admin_user_delete","admin_user_role","admin_user_status"]);
lacks("cloud",["VCFCloudYXDB","createLZ4Frame"]);
has("server",["FIVE_DB_MAX_FILE","verify5(","fnv1a32","FIVE_DB_MAX_ACCOUNT",
  "auth_me","Authorization: Bearer","flock(","storage5(","DOCUMENT_ROOT",
  "realpath(","FILTER_VALIDATE_EMAIL","LOCK_EX","action === 'save'","action === 'get'"]);
has("builder",['"5db-format.js"']);
has("srvbuild",['ROOT / "api" / "5db.php"','VCF_5DB_API_URL="/BD1/api/5db.php"']);
has("deploy",["php -l api/5db.php","test -s _site/api/5db.php","npm run test:architecture"]);
console.log("5DB workbench and deployment integration contract passed");
