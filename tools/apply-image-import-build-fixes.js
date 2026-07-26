const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const runtimePath = 'makevcf-generator-image-import-fix.js';
const loaderPath = 'makevcf-mobile.js';
const htmlPath = 'makevcf.html';
const specPath = '規格書.MD';

function fail(message) {
  throw new Error(`[圖片匯入建置修正] ${message}`);
}

for (const requiredPath of [runtimePath, loaderPath, htmlPath, specPath]) {
  if (!fs.existsSync(requiredPath)) fail(`缺少必要檔案：${requiredPath}`);
}

const runtime = fs.readFileSync(runtimePath, 'utf8');
const loader = fs.readFileSync(loaderPath, 'utf8');

for (const token of [
  'function removeCenterText(imageData)',
  'function fitLattice(bundle, minDimension)',
  'function augmentHoughValues(values, width, height)',
  'function patchedHoughLinesP(',
  'darkOutlineCoverage >= 0.50',
  'const fallbackRecognitionCall = warpCallSequence % 2 === 0;',
]) {
  if (!runtime.includes(token)) fail(`正式修正模組缺少：${token}`);
}

for (const token of [
  'makevcf-generator-image-import-fix.js',
  'data-vcf-image-import-fix',
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
syntaxCheck('makevcf-mobile.js', loader);

console.log('圖片匯入缺邊格線與中央數字棋子正式模組已通過建置驗證。');
