const fs = require('fs');

let html = fs.readFileSync('makevcf.html', 'utf8');
let spec = fs.readFileSync('規格書.MD', 'utf8');

function replaceExactly(text, search, replacement, label) {
  const count = text.split(search).length - 1;
  if (count !== 1) throw new Error(`${label}: expected exactly one match, got ${count}`);
  return text.replace(search, replacement);
}

html = replaceExactly(
  html,
  `    const normalCircle =
      radial.dominantCoverage >= 0.46 &&
      radial.absoluteMedian >= 9 &&
      toneContrast >= 14 &&
      profileContrast >= 7 &&
      polarityAligned &&
      profileAligned;
    const veryStrongCircle =
      radial.dominantCoverage >= 0.72 &&
      radial.absoluteMedian >= 18 &&
      toneContrast >= 10 &&
      profileContrast >= 5 &&
      polarityAligned &&
      profileAligned;
    return { score, candidate: normalCircle || veryStrongCircle, polarityAligned, profileAligned };`,
  `    const normalCircle =
      radial.dominantCoverage >= 0.46 &&
      radial.absoluteMedian >= 9 &&
      toneContrast >= 14 &&
      profileContrast >= 7 &&
      polarityAligned &&
      profileAligned;
    const veryStrongCircle =
      radial.dominantCoverage >= 0.72 &&
      radial.absoluteMedian >= 18 &&
      toneContrast >= 10 &&
      profileContrast >= 5 &&
      polarityAligned &&
      profileAligned;
    const outlinedWhiteCircle =
      radial.whiteCoverage >= 0.72 &&
      radial.absoluteMedian >= 10 &&
      bodyDelta >= 5 &&
      profileDelta >= 16;
    return {
      score,
      candidate: normalCircle || veryStrongCircle || outlinedWhiteCircle,
      polarityAligned,
      profileAligned,
      outlinedWhiteCircle,
    };`,
  'add outlined white circle gate'
);

html = replaceExactly(
  html,
  `    for (const x of importState.gridXs) {
      srcCtx.beginPath();
      srcCtx.moveTo(x * scaleX, importState.gridYs[0] * scaleY);
      srcCtx.lineTo(x * scaleX, importState.gridYs[SIZE - 1] * scaleY);
      srcCtx.stroke();
    }
    for (const y of importState.gridYs) {
      srcCtx.beginPath();
      srcCtx.moveTo(importState.gridXs[0] * scaleX, y * scaleY);
      srcCtx.lineTo(importState.gridXs[SIZE - 1] * scaleX, y * scaleY);
      srcCtx.stroke();
    }

    for (let index = 0; index < importState.warpedIntersections.length; index++) {`,
  `    const left = importState.gridXs[0] * scaleX;
    const top = importState.gridYs[0] * scaleY;
    const right = importState.gridXs[SIZE - 1] * scaleX;
    const bottom = importState.gridYs[SIZE - 1] * scaleY;
    srcCtx.strokeRect(left, top, right - left, bottom - top);

    for (let index = 0; index < importState.warpedIntersections.length; index++) {`,
  'replace internal preview grid with outer border'
);

html = replaceExactly(
  html,
  `      if (!stone) {
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
      }`,
  `      srcCtx.beginPath();
      srcCtx.arc(point.x, point.y, step * 0.065, 0, Math.PI * 2);
      srcCtx.fillStyle = "rgba(22, 105, 220, 0.46)";
      srcCtx.fill();
      if (stone) {
        srcCtx.beginPath();
        srcCtx.arc(point.x, point.y, step * 0.40, 0, Math.PI * 2);
        srcCtx.strokeStyle = stone === 1
          ? "rgba(38, 117, 235, 0.95)"
          : "rgba(235, 193, 36, 0.95)";
        srcCtx.lineWidth = Math.max(2, step * 0.06);
        srcCtx.stroke();
      }`,
  'draw all 225 preview points'
);

spec = replaceExactly(
  spec,
  '- 預覽的格線與低信心標記必須半透明；黑棋以中空藍色圓框、白棋以中空黃色圓框表示，讓使用者清楚看見底下校正後原圖。\n',
  '- 預覽棋盤只畫第一／第十五路形成的最外圍四條格線與 225 個交點，不畫中間格線；所有標記必須半透明。黑棋以中空藍色圓框、白棋以中空黃色圓框表示，讓使用者清楚看見底下校正後原圖。\n',
  'update preview grid specification'
);

spec = replaceExactly(
  spec,
  '- 黑白分類必須使用扣除局部光照後的相對亮度與圓周極性，不得用絕對亮度直接把高光區判成白棋；寬廣漸層反光若沒有棋子剖面，應維持空點。\n',
  '- 黑白分類必須使用扣除局部光照後的相對亮度與圓周極性，不得用絕對亮度直接把高光區判成白棋；寬廣漸層反光若沒有棋子剖面，應維持空點。白底棋盤上的白色描邊棋子，若中心接近棋盤底色但具有高覆蓋率暗色圓框與明顯中心／外圈剖面，仍應辨識為白棋。\n',
  'add outlined white recognition specification'
);

for (const token of [
  'const outlinedWhiteCircle =',
  'candidate: normalCircle || veryStrongCircle || outlinedWhiteCircle',
  'srcCtx.strokeRect(left, top, right - left, bottom - top);',
  'step * 0.065',
]) {
  if (!html.includes(token)) throw new Error(`required token missing: ${token}`);
}

const previewStart = html.indexOf('  function renderRecognitionPreview()');
const previewEnd = html.indexOf('\n  function recognizeBoard()', previewStart);
const previewCode = html.slice(previewStart, previewEnd);
for (const obsolete of [
  'for (const x of importState.gridXs)',
  'for (const y of importState.gridYs)',
  'if (!stone) {',
]) {
  if (previewCode.includes(obsolete)) throw new Error(`obsolete preview code remains: ${obsolete}`);
}

fs.writeFileSync('makevcf.html', html);
fs.writeFileSync('規格書.MD', spec);
console.log('Applied point-only preview grid and outlined-white recognition.');
