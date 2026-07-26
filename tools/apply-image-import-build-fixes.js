const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const htmlPath = 'makevcf.html';
const specPath = '規格書.MD';
const patcherPath = 'tools/apply-grid-lattice-numbered-stones.js';

function fail(message) {
  throw new Error(`[圖片匯入建置修正] ${message}`);
}

let html = fs.readFileSync(htmlPath, 'utf8');

// 建置可重複執行：來源若已正式合併，不再套用一次。
if (!html.includes('function fitGridLatticePairs(')) {
  let patcher = fs.readFileSync(patcherPath, 'utf8');

  const brokenBoundary = "html = replaceFunction(html, '  function extractCellFeatures(', '  function kmeansTwo(', extract + '  function kmeansTwo(', 'replace cell features');";
  const fixedBoundary = "html = replaceFunction(html, '  function extractCellFeatures(', '  function kmeansTwo(', extract, 'replace cell features');";
  if (!patcher.includes(brokenBoundary)) fail('找不到預期的棋子特徵函式邊界');
  patcher = patcher.replace(brokenBoundary, fixedBoundary);

  const oldScore = '          const score = coverage * 0.43 + spanCoverage * 0.27 + residualScore * 0.20 + lengthScore * 0.10 - missingPenalty * 0.06;';
  const newScore = [
    '          const observedCenter = (observedMin + observedMax) * 0.5;',
    '          const fittedCenter = (start + end) * 0.5;',
    '          const centerPenalty = Math.min(1, Math.abs(fittedCenter - observedCenter) / Math.max(step * 3, 1));',
    '          const score = coverage * 0.43 + spanCoverage * 0.27 + residualScore * 0.20 + lengthScore * 0.10 - missingPenalty * 0.06 - centerPenalty * 0.10;',
  ].join('\n');
  if (!patcher.includes(oldScore)) fail('找不到預期的晶格評分公式');
  patcher = patcher.replace(oldScore, newScore);

  const tempPatcher = path.join(os.tmpdir(), 'apply-grid-lattice-numbered-stones-fixed.js');
  fs.writeFileSync(tempPatcher, patcher, 'utf8');
  const result = spawnSync(process.execPath, [tempPatcher], {
    cwd: process.cwd(),
    encoding: 'utf8',
    stdio: 'pipe',
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.status !== 0) fail(`套用失敗，結束碼 ${result.status}`);
}

html = fs.readFileSync(htmlPath, 'utf8');
const requiredTokens = [
  'function fitGridLatticePairs(',
  "source: 'hough-lattice'",
  'function robustTone(',
  'darkOutlineCoverage',
  'stoneBandValues',
  'feature.outlinedWhiteCircle',
  'contourBest.score < 0.74',
  'const centerPenalty = Math.min(1, Math.abs(fittedCenter - observedCenter)',
];
for (const token of requiredTokens) {
  if (!html.includes(token)) fail(`產生結果缺少：${token}`);
}

for (const token of [
  "extract + '  function kmeansTwo('",
  'function kmeansTwo(  function kmeansTwo(',
]) {
  if (html.includes(token)) fail(`產生結果仍含損壞片段：${token}`);
}

const scriptStart = html.indexOf('<script>') + '<script>'.length;
const scriptEnd = html.lastIndexOf('</script>');
if (scriptStart < '<script>'.length || scriptEnd <= scriptStart) fail('無法抽取頁面 JavaScript');
const inlinePath = path.join(os.tmpdir(), 'makevcf-image-import-inline.js');
fs.writeFileSync(inlinePath, html.slice(scriptStart, scriptEnd), 'utf8');
const syntax = spawnSync(process.execPath, ['--check', inlinePath], { encoding: 'utf8' });
if (syntax.stdout) process.stdout.write(syntax.stdout);
if (syntax.stderr) process.stderr.write(syntax.stderr);
if (syntax.status !== 0) fail('產生後頁面 JavaScript 語法檢查失敗');

if (!fs.existsSync(specPath)) fail('規格書不存在');
console.log('圖片匯入缺邊晶格與數字棋子修正已套用並通過語法檢查。');
