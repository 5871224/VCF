const fs = require('fs');

let html = fs.readFileSync('makevcf.html', 'utf8');
let spec = fs.readFileSync('規格書.MD', 'utf8');

function replaceExactly(text, search, replacement, label) {
  const count = text.split(search).length - 1;
  if (count !== 1) throw new Error(`${label}: expected exactly one match, got ${count}`);
  return text.replace(search, replacement);
}

function replaceFunction(text, startToken, endToken, replacement, label) {
  const start = text.indexOf(startToken);
  if (start < 0) throw new Error(`${label}: start token not found`);
  const end = text.indexOf(endToken, start + startToken.length);
  if (end < 0) throw new Error(`${label}: end token not found`);
  return text.slice(0, start) + replacement + text.slice(end);
}

const annotationHelpers = `  function sampleGrayMedian(gray) {
    const values = [];
    for (const yRatio of [0.28, 0.42, 0.58, 0.72]) {
      for (const xRatio of [0.28, 0.42, 0.58, 0.72]) {
        const y = Math.round((gray.rows - 1) * yRatio);
        const x = Math.round((gray.cols - 1) * xRatio);
        values.push(gray.ucharPtr(y, x)[0]);
      }
    }
    return median(values) || 220;
  }

  function suppressOuterAnnotations(gray) {
    const width = gray.cols;
    const height = gray.rows;
    const minDimension = Math.min(width, height);
    const marginX = Math.max(24, Math.round(width * 0.16));
    const marginY = Math.max(24, Math.round(height * 0.16));
    const imageArea = width * height;
    let cleaned = gray.clone();
    let blur = null, binary = null, work = null, contours = null, hierarchy = null;
    try {
      blur = new cv.Mat();
      binary = new cv.Mat();
      cv.GaussianBlur(gray, blur, new cv.Size(5, 5), 0);
      let blockSize = Math.max(21, Math.round(minDimension / 24));
      if (blockSize % 2 === 0) blockSize++;
      cv.adaptiveThreshold(blur, binary, 255, cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY_INV, blockSize, 7);
      work = binary.clone();
      contours = new cv.MatVector();
      hierarchy = new cv.Mat();
      cv.findContours(work, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
      const fillValue = Math.round(sampleGrayMedian(gray));

      for (let index = 0; index < contours.size(); index++) {
        const contour = contours.get(index);
        try {
          const rect = cv.boundingRect(contour);
          const area = Math.abs(cv.contourArea(contour));
          const nearOuterBand =
            rect.x < marginX ||
            rect.y < marginY ||
            rect.x + rect.width > width - marginX ||
            rect.y + rect.height > height - marginY;
          if (!nearOuterBand) continue;

          const longSide = Math.max(rect.width, rect.height);
          const shortSide = Math.max(1, Math.min(rect.width, rect.height));
          const aspect = longSide / shortSide;
          const boardLineLike =
            longSide >= minDimension * 0.34 ||
            (aspect >= 8 && longSide >= minDimension * 0.17);
          const annotationLike =
            area <= imageArea * 0.028 &&
            longSide <= minDimension * 0.25 &&
            shortSide <= minDimension * 0.15;
          if (!annotationLike || boardLineLike) continue;

          const padding = Math.max(2, Math.round(minDimension * 0.004));
          const x0 = clamp(rect.x - padding, 0, width - 1);
          const y0 = clamp(rect.y - padding, 0, height - 1);
          const x1 = clamp(rect.x + rect.width + padding, 0, width - 1);
          const y1 = clamp(rect.y + rect.height + padding, 0, height - 1);
          cv.rectangle(
            cleaned,
            new cv.Point(x0, y0),
            new cv.Point(x1, y1),
            new cv.Scalar(fillValue, fillValue, fillValue, 255),
            -1
          );
        } finally {
          contour.delete();
        }
      }
      return cleaned;
    } catch (error) {
      console.warn('外圍文字與座標抑制失敗，改用原始灰階圖。', error);
      if (cleaned) cleaned.delete();
      return gray.clone();
    } finally {
      if (blur) blur.delete();
      if (binary) binary.delete();
      if (work) work.delete();
      if (contours) contours.delete();
      if (hierarchy) hierarchy.delete();
    }
  }

`;

if (!html.includes('  function suppressOuterAnnotations(gray) {')) {
  html = replaceExactly(
    html,
    '  function detectContourCandidates(gray) {',
    annotationHelpers + '  function detectContourCandidates(gray) {',
    'insert annotation suppression helpers'
  );
}

const autoDetectBoard = `  async function autoDetectBoard() {
    drawSource();
    if (!importState.sourceImage) return;
    const cvAvailable = await ensureCvReady();
    if (!cvAvailable) {
      setDefaultCorners();
      setImportStatus("OpenCV.js 不可用，已切到手動框選模式。");
      setImportButtons();
      return;
    }

    let src = null, gray = null, detectionGray = null;
    try {
      setImportStatus("正在抑制外圍文字並以 15 路格線模型偵測棋盤...");
      const tempCanvas = document.createElement("canvas");
      tempCanvas.width = importState.sourceImage.width;
      tempCanvas.height = importState.sourceImage.height;
      tempCanvas.getContext("2d").drawImage(importState.sourceImage, 0, 0);
      src = cv.imread(tempCanvas);
      gray = new cv.Mat();
      cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
      detectionGray = suppressOuterAnnotations(gray);

      const contourCandidates = detectContourCandidates(detectionGray);
      let contourBest = evaluateCandidateSet(detectionGray, contourCandidates, "輪廓＋15路驗證", 44);
      let chosen = contourBest;

      if (!contourBest || contourBest.score < 0.64 || contourBest.coverage < 0.56) {
        setImportStatus("輪廓可信度不足，正在改用 Hough 格線與 15 路模型...");
        const houghCandidates = detectHoughCandidates(detectionGray);
        const houghBest = evaluateCandidateSet(detectionGray, houghCandidates, "Hough格線＋15路驗證", 48);
        if (!chosen || (houghBest && houghBest.score > chosen.score)) chosen = houghBest;
      }

      if (chosen && chosen.score >= 0.34) chosen = refineBoardCandidate(detectionGray, chosen);

      if (chosen && chosen.score >= 0.40 && chosen.coverage >= 0.38) {
        importState.boardCorners = orderCorners(chosen.quad).map(projectImagePointToSourceCanvas);
        importState.mode = "cornersEditing";
        const confidence = Math.round(chosen.score * 100);
        const coverage = Math.round(chosen.coverage * 100);
        setImportStatus("已用" + chosen.method + "定位 15 路棋盤（可信度 " + confidence + "%／格線覆蓋 " + coverage + "%）；若有偏差可拖曳四角修正。");
      } else {
        setDefaultCorners();
        const bestScore = chosen ? Math.round(chosen.score * 100) : 0;
        setImportStatus("多策略偵測仍未通過 15 路格線驗證（最高 " + bestScore + "%），已提供預設棋盤框，請手動修正。", true);
      }
    } catch (e) {
      console.error(e);
      setDefaultCorners();
      setImportStatus("多策略棋盤偵測失敗，已切到手動框選模式。", true);
    } finally {
      drawSource();
      setImportButtons();
      if (src) src.delete();
      if (gray) gray.delete();
      if (detectionGray) detectionGray.delete();
    }
  }
`;

html = replaceFunction(
  html,
  '  async function autoDetectBoard() {',
  '\n  function pickCorner(',
  autoDetectBoard,
  'replace autoDetectBoard'
);

const renderRecognitionPreview = `  function renderRecognitionPreview() {
    if (!isPreviewMode()) return;
    srcCtx.clearRect(0, 0, sourceCanvas.width, sourceCanvas.height);
    srcCtx.drawImage(warpedCanvas, 0, 0, sourceCanvas.width, sourceCanvas.height);
    const scaleX = sourceCanvas.width / WARP_SIZE;
    const scaleY = sourceCanvas.height / WARP_SIZE;
    const step = getRefinedGridStep() * (scaleX + scaleY) * 0.5;

    srcCtx.save();
    srcCtx.beginPath();
    srcCtx.rect(0, 0, sourceCanvas.width, sourceCanvas.height);
    for (let index = 0; index < importState.warpedIntersections.length; index++) {
      if (!importState.recognizedBoard[index]) continue;
      const originalPoint = importState.warpedIntersections[index];
      const point = { x: originalPoint.x * scaleX, y: originalPoint.y * scaleY };
      srcCtx.moveTo(point.x + step * 0.37, point.y);
      srcCtx.arc(point.x, point.y, step * 0.37, 0, Math.PI * 2);
    }
    srcCtx.fillStyle = "rgba(108, 176, 255, 0.60)";
    srcCtx.fill("evenodd");

    srcCtx.lineWidth = Math.max(1, step * 0.022);
    srcCtx.strokeStyle = "rgba(28, 98, 205, 0.34)";
    const left = importState.gridXs[0] * scaleX;
    const top = importState.gridYs[0] * scaleY;
    const right = importState.gridXs[SIZE - 1] * scaleX;
    const bottom = importState.gridYs[SIZE - 1] * scaleY;
    srcCtx.strokeRect(left, top, right - left, bottom - top);

    for (let index = 0; index < importState.warpedIntersections.length; index++) {
      const originalPoint = importState.warpedIntersections[index];
      const point = { x: originalPoint.x * scaleX, y: originalPoint.y * scaleY };
      const stone = importState.recognizedBoard[index];
      const confidence = importState.confidenceMap[index];

      srcCtx.beginPath();
      srcCtx.arc(point.x, point.y, step * 0.065, 0, Math.PI * 2);
      srcCtx.fillStyle = stone === 1
        ? "rgba(0, 0, 0, 0.98)"
        : stone === 2
          ? "rgba(255, 255, 255, 0.98)"
          : "rgba(22, 105, 220, 0.46)";
      srcCtx.fill();

      if (stone) {
        srcCtx.beginPath();
        srcCtx.arc(point.x, point.y, step * 0.40, 0, Math.PI * 2);
        srcCtx.strokeStyle = stone === 1
          ? "rgba(38, 117, 235, 0.95)"
          : "rgba(235, 193, 36, 0.95)";
        srcCtx.lineWidth = Math.max(2, step * 0.06);
        srcCtx.stroke();
      }
      if (confidence < 0.62) {
        srcCtx.beginPath();
        srcCtx.arc(point.x, point.y, step * 0.46, 0, Math.PI * 2);
        srcCtx.strokeStyle = "rgba(220, 55, 55, 0.90)";
        srcCtx.lineWidth = Math.max(2, step * 0.04);
        srcCtx.stroke();
      }
    }
    srcCtx.restore();
  }
`;

html = replaceFunction(
  html,
  '  function renderRecognitionPreview() {',
  '\n  function recognizeBoard() {',
  renderRecognitionPreview,
  'replace renderRecognitionPreview'
);

spec = replaceExactly(
  spec,
  '- 狀態列顯示採用方法、可信度與格線覆蓋率；所有策略都未達門檻時才回退到手動四角框。\n',
  '- 狀態列顯示採用方法、可信度與格線覆蓋率；所有策略都未達門檻時才回退到手動四角框。\n- 自動定位前必須抑制圖片四周的文字、座標與說明標籤；外圍小型高對比元件不得干擾真正 15×15 棋盤的輪廓、Hough 格線與候選評分，長格線及棋盤外框則必須保留。\n',
  'update annotation suppression specification'
);

spec = replaceExactly(
  spec,
  '- 預覽棋盤只畫第一／第十五路形成的最外圍四條格線與 225 個交點，不畫中間格線；所有標記必須半透明。黑棋以中空藍色圓框、白棋以中空黃色圓框表示，讓使用者清楚看見底下校正後原圖。\n',
  '- 預覽棋盤只畫第一／第十五路形成的最外圍四條格線與 225 個交點，不畫中間格線。整張校正圖覆蓋 60% 透明淡藍遮罩；黑棋與白棋的圓內部必須從遮罩挖空為全透明，保留中空藍色／黃色外框，中心點則分別顯示為黑色／白色；空點中心仍使用淡藍色小點。\n',
  'update preview mask specification'
);

for (const required of [
  'function suppressOuterAnnotations(gray)',
  'detectionGray = suppressOuterAnnotations(gray)',
  'rgba(108, 176, 255, 0.60)',
  'srcCtx.fill("evenodd")',
  'rgba(0, 0, 0, 0.98)',
  'rgba(255, 255, 255, 0.98)',
]) {
  if (!html.includes(required)) throw new Error(`required token missing: ${required}`);
}
if (html.includes('globalCompositeOperation = "destination-out"')) {
  throw new Error('preview must not erase the underlying source image');
}

fs.writeFileSync('makevcf.html', html);
fs.writeFileSync('規格書.MD', spec);
console.log('Applied preview mask and outer annotation suppression.');
