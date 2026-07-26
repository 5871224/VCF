const fs = require('fs');

const htmlPath = 'makevcf.html';
const specPath = '規格書.MD';
let html = fs.readFileSync(htmlPath, 'utf8');
let spec = fs.readFileSync(specPath, 'utf8');

const oldHtml = `    const labels = ["空點", "黑子", "白子"];
    setImportStatus("已手動將第 " + (row.index + 1) + " 路、第 " + (column.index + 1) + " 路改為" + labels[importState.recognizedBoard[index]] + "。");`;
const newHtml = `    const black = importState.recognizedBoard.filter(value => value === 1).length;
    const white = importState.recognizedBoard.filter(value => value === 2).length;
    setImportStatus("目前棋子數：黑子 " + black + " 顆、白子 " + white + " 顆。");`;

if (!html.includes(oldHtml)) {
  throw new Error('Cannot find the manual-edit status block in makevcf.html');
}
html = html.replace(oldHtml, newHtml);

const oldSpec = '- 使用者點擊任一交點時，該點依「空點 → 黑子 → 白子 → 空點」循環修改；人工修改後使用與程式判定相同的顯示方式，不另外標示修改紀錄，且該點信心設為確定。';
const newSpec = '- 使用者點擊任一交點時，該點依「空點 → 黑子 → 白子 → 空點」循環修改；人工修改後使用與程式判定相同的顯示方式，不顯示修改座標或修改內容，狀態列只顯示目前黑子與白子數量，且該點信心設為確定。';

if (!spec.includes(oldSpec)) {
  throw new Error('Cannot find the manual-edit requirement in 規格書.MD');
}
spec = spec.replace(oldSpec, newSpec);

fs.writeFileSync(htmlPath, html, 'utf8');
fs.writeFileSync(specPath, spec, 'utf8');
