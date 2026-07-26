const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const runtimePath = 'makevcf-generator-image-import-fix.js';
const houghV2Path = 'makevcf-generator-image-import-fix-v2.js';
const loaderPath = 'makevcf-mobile.js';
const htmlPath = 'makevcf.html';
const specPath = '規格書.MD';

function fail(message) {
  throw new Error(`[圖片匯入建置驗證] ${message}`);
}

for (const requiredPath of [runtimePath, houghV2Path, loaderPath, htmlPath, specPath]) {
  if (!fs.existsSync(requiredPath)) fail(`缺少必要檔案：${requiredPath}`);
}

const runtime = fs.readFileSync(runtimePath, 'utf8');
const houghV2 = fs.readFileSync(houghV2Path, 'utf8');
const loader = fs.readFileSync(loaderPath, 'utf8');

for (const token of [
  'function removeCenterText(imageData)',
  'function analyzeStoneAt(',
  'darkOutlineCoverage >= 0.50',
  'const fallbackRecognitionCall = warpCallSequence % 2 === 0;',
]) {
  if (!runtime.includes(token)) fail(`數字棋子修正模組缺少：${token}`);
}

for (const token of [
  'function fitLattice(bundle, width, height)',
  'function addSyntheticOuterLines(',
  'const originalValues = Array.from(lines.data32S || [])',
  'patchedHoughLinesP[V2_FLAG] = true',
  'window.setInterval(',
]) {
  if (!houghV2.includes(token)) fail(`缺邊晶格修正模組缺少：${token}`);
}

for (const token of [
  'makevcf-generator-image-import-fix.js',
  'makevcf-generator-image-import-fix-v2.js',
  'loadImageImportRuntimeFixes',
]) {
  if (!loader.includes(token)) fail(`載入入口缺少：${token}`);
}

function syntaxCheck(filename, content) {
  const temporaryPath = path.join(os.tmpdir(), filename);
  fs.writeFileSync(temporaryPath, content, 'utf8');
  const result = spawnSync(process.execPath, ['--check', temporaryPath], {
    encoding: 'utf8',
    stdio: 'pipe',
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.status !== 0) fail(`${filename} JavaScript 語法檢查失敗`);
}

syntaxCheck('makevcf-generator-image-import-fix.js', runtime);
syntaxCheck('makevcf-generator-image-import-fix-v2.js', houghV2);
syntaxCheck('makevcf-mobile.js', loader);

console.log('圖片匯入數字棋子與缺邊晶格修正已通過正式建置驗證。');
