const fs = require('fs');

let html = fs.readFileSync('makevcf.html', 'utf8');
let spec = fs.readFileSync('規格書.MD', 'utf8');

function replaceExactly(text, search, replacement, label) {
  const count = text.split(search).length - 1;
  if (count !== 1) throw new Error(`${label}: expected exactly one match, got ${count}`);
  return text.replace(search, replacement);
}

function removeExactly(text, search, expectedCount, label) {
  const count = text.split(search).length - 1;
  if (count !== expectedCount) throw new Error(`${label}: expected ${expectedCount} matches, got ${count}`);
  return text.split(search).join('');
}

html = replaceExactly(
  html,
  '    manualEdits: new Array(225).fill(false),\n',
  '',
  'remove manualEdits state'
);

html = removeExactly(
  html,
  '    importState.manualEdits.fill(false);\n',
  2,
  'remove manualEdits resets'
);

html = replaceExactly(
  html,
  `      const confidence = importState.confidenceMap[index];
      const manual = importState.manualEdits[index];
      if (!stone) {
        srcCtx.beginPath();
        srcCtx.arc(point.x, point.y, step * 0.075, 0, Math.PI * 2);
        srcCtx.fillStyle = manual ? "rgba(255, 153, 0, 0.72)" : "rgba(22, 105, 220, 0.55)";
        srcCtx.fill();
      } else {
        srcCtx.beginPath();
        srcCtx.arc(point.x, point.y, step * 0.40, 0, Math.PI * 2);
        srcCtx.fillStyle = stone === 1 ? "rgba(0, 0, 0, 0.43)" : "rgba(255, 255, 255, 0.40)";
        srcCtx.strokeStyle = stone === 1 ? "rgba(0, 0, 0, 0.80)" : "rgba(45, 45, 45, 0.76)";
        srcCtx.lineWidth = Math.max(1.5, step * 0.035);
        srcCtx.fill();
        srcCtx.stroke();
      }
      if (manual) {
        srcCtx.beginPath();
        srcCtx.arc(point.x, point.y, step * 0.46, 0, Math.PI * 2);
        srcCtx.strokeStyle = "rgba(255, 145, 0, 0.95)";
        srcCtx.lineWidth = Math.max(2, step * 0.045);
        srcCtx.stroke();
      } else if (confidence < 0.62) {`,
  `      const confidence = importState.confidenceMap[index];
      if (!stone) {
        srcCtx.beginPath();
        srcCtx.arc(point.x, point.y, step * 0.075, 0, Math.PI * 2);
        srcCtx.fillStyle = "rgba(22, 105, 220, 0.55)";
        srcCtx.fill();
      } else {
        srcCtx.beginPath();
        srcCtx.arc(point.x, point.y, step * 0.40, 0, Math.PI * 2);
        srcCtx.strokeStyle = stone === 1
          ? "rgba(38, 117, 235, 0.95)"
          : "rgba(235, 193, 36, 0.95)";
        srcCtx.lineWidth = Math.max(2, step * 0.06);
        srcCtx.stroke();
      }
      if (confidence < 0.62) {`,
  'replace preview stone style'
);

html = replaceExactly(
  html,
  '    importState.manualEdits[index] = true;\n',
  '',
  'remove manual edit assignment'
);

spec = replaceExactly(
  spec,
  '- 預覽的格線、黑棋、白棋與低信心標記必須半透明，讓使用者看見底下校正後原圖。\n- 使用者點擊任一交點時，該點依「空點 → 黑子 → 白子 → 空點」循環修改；手動修改點以不同外框標示且信心設為確定。\n',
  '- 預覽的格線與低信心標記必須半透明；黑棋以中空藍色圓框、白棋以中空黃色圓框表示，讓使用者清楚看見底下校正後原圖。\n- 使用者點擊任一交點時，該點依「空點 → 黑子 → 白子 → 空點」循環修改；人工修改後使用與程式判定相同的顯示方式，不另外標示修改紀錄，且該點信心設為確定。\n',
  'update preview specification'
);

for (const forbidden of [
  'manualEdits',
  'rgba(255, 145, 0, 0.95)',
  'rgba(0, 0, 0, 0.43)',
  'rgba(255, 255, 255, 0.40)'
]) {
  if (html.includes(forbidden)) throw new Error(`obsolete preview code remains: ${forbidden}`);
}

for (const required of [
  'rgba(38, 117, 235, 0.95)',
  'rgba(235, 193, 36, 0.95)'
]) {
  if (!html.includes(required)) throw new Error(`required preview style missing: ${required}`);
}

fs.writeFileSync('makevcf.html', html);
fs.writeFileSync('規格書.MD', spec);
console.log('Applied hollow blue/yellow preview circles and removed manual edit marker code.');
