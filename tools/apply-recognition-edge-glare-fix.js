const fs = require('fs');

let html = fs.readFileSync('makevcf.html', 'utf8');
let spec = fs.readFileSync('規格書.MD', 'utf8');

function replaceFunctionRange(text, startName, endName, replacement) {
  const startToken = `  function ${startName}(`;
  const endToken = `\n  function ${endName}(`;
  const start = text.indexOf(startToken);
  if (start < 0) throw new Error(`Missing function: ${startName}`);
  const end = text.indexOf(endToken, start);
  if (end < 0) throw new Error(`Missing following function: ${endName}`);
  return text.slice(0, start) + replacement.trimEnd() + text.slice(end);
}

function replaceExactly(text, search, replacement, label) {
  const count = text.split(search).length - 1;
  if (count !== 1) throw new Error(`${label}: expected exactly one match, got ${count}`);
  return text.replace(search, replacement);
}

const featureFunctions = String.raw`  function isBoardInteriorDirection(row, col, dx, dy, step) {
    const tolerance = step * 0.06;
    if (col === 0 && dx < -tolerance) return false;
    if (col === SIZE - 1 && dx > tolerance) return false;
    if (row === 0 && dy < -tolerance) return false;
    if (row === SIZE - 1 && dy > tolerance) return false;
    return true;
  }

  function sampleLocalBoardTone(data, width, height, cx, cy, step, row, col) {
    const values = [];
    for (const radiusRatio of [0.82, 1.16, 1.50]) {
      const radius = step * radiusRatio;
      for (let index = 0; index < 64; index++) {
        const angle = (index / 64) * Math.PI * 2;
        const dx = Math.cos(angle) * radius;
        const dy = Math.sin(angle) * radius;
        if (!isBoardInteriorDirection(row, col, dx, dy, step)) continue;
        values.push(pixelLum(data, width, height, cx + dx, cy + dy));
      }
    }
    return values.length ? median(values) : pixelLum(data, width, height, cx, cy);
  }

  function radialBoundaryFeature(data, width, height, cx, cy, step) {
    const signedDifferences = [];
    const absoluteDifferences = [];
    const insideRadius = step * 0.28;
    const outsideRadius = step * 0.53;
    for (let index = 0; index < 48; index++) {
      const angle = (index / 48) * Math.PI * 2;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      const inside = pixelLum(data, width, height, cx + cos * insideRadius, cy + sin * insideRadius);
      const outside = pixelLum(data, width, height, cx + cos * outsideRadius, cy + sin * outsideRadius);
      const difference = outside - inside;
      signedDifferences.push(difference);
      absoluteDifferences.push(Math.abs(difference));
    }
    const threshold = 8;
    const blackCoverage = signedDifferences.filter(value => value >= threshold).length / signedDifferences.length;
    const whiteCoverage = signedDifferences.filter(value => value <= -threshold).length / signedDifferences.length;
    return {
      signedMedian: median(signedDifferences),
      signedMean: signedDifferences.reduce((sum, value) => sum + value, 0) / signedDifferences.length,
      absoluteMedian: median(absoluteDifferences),
      absoluteMean: absoluteDifferences.reduce((sum, value) => sum + value, 0) / absoluteDifferences.length,
      blackCoverage,
      whiteCoverage,
      dominantCoverage: Math.max(blackCoverage, whiteCoverage),
      mixedCoverage: Math.min(blackCoverage, whiteCoverage),
    };
  }

  function thinGridLineFeature(data, width, height, cx, cy, step, row, col) {
    const parallelOffset = Math.max(3, step * 0.12);
    const armStart = Math.max(3, Math.round(step * 0.20));
    const armEnd = Math.max(armStart + 2, Math.round(step * 0.48));
    let darkness = 0;
    let count = 0;

    function sampleHorizontal(sign) {
      for (let distance = armStart; distance <= armEnd; distance += 2) {
        const x = cx + sign * distance;
        const center = pixelLum(data, width, height, x, cy);
        const sides = (pixelLum(data, width, height, x, cy - parallelOffset) + pixelLum(data, width, height, x, cy + parallelOffset)) * 0.5;
        darkness += Math.max(0, sides - center);
        count++;
      }
    }

    function sampleVertical(sign) {
      for (let distance = armStart; distance <= armEnd; distance += 2) {
        const y = cy + sign * distance;
        const center = pixelLum(data, width, height, cx, y);
        const sides = (pixelLum(data, width, height, cx - parallelOffset, y) + pixelLum(data, width, height, cx + parallelOffset, y)) * 0.5;
        darkness += Math.max(0, sides - center);
        count++;
      }
    }

    if (col > 0) sampleHorizontal(-1);
    if (col < SIZE - 1) sampleHorizontal(1);
    if (row > 0) sampleVertical(-1);
    if (row < SIZE - 1) sampleVertical(1);

    const raw = count ? darkness / count : 0;
    const expectedArms = (col > 0 ? 1 : 0) + (col < SIZE - 1 ? 1 : 0) + (row > 0 ? 1 : 0) + (row < SIZE - 1 ? 1 : 0);
    return { raw, score: clamp01(raw / 17), expectedArms };
  }

  function computeCircleOccupancy(radial, bodyDelta, profileDelta, thinLineScore) {
    const toneContrast = Math.abs(bodyDelta);
    const profileContrast = Math.abs(profileDelta);
    const signedStrength = Math.abs(radial.signedMedian);
    const polarityAligned = bodyDelta * radial.signedMedian <= -60 && toneContrast >= 10 && signedStrength >= 5;
    const profileAligned = bodyDelta * profileDelta > 0;
    const coverageScore = clamp01((radial.dominantCoverage - 0.28) / 0.55);
    const radialStrengthScore = clamp01((radial.absoluteMedian - 5) / 35);
    const toneContrastScore = clamp01((toneContrast - 8) / 55);
    const profileScore = clamp01((profileContrast - 4) / 35);
    const score = clamp01(
      coverageScore * 0.28 +
      radialStrengthScore * 0.20 +
      toneContrastScore * 0.23 +
      profileScore * 0.20 +
      (polarityAligned && profileAligned ? 0.15 : 0) -
      thinLineScore * 0.08
    );
    const normalCircle =
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
    return { score, candidate: normalCircle || veryStrongCircle, polarityAligned, profileAligned };
  }

  function extractCellFeatures(data, width, height, point, step, row, col) {
    const centerAcc = createStatsAccumulator();
    const bodyAcc = createStatsAccumulator();
    const ringAcc = createStatsAccumulator();
    const backgroundAcc = createStatsAccumulator();
    const outerRadius = step * 0.80;
    const x0 = Math.max(0, Math.floor(point.x - outerRadius));
    const x1 = Math.min(width - 1, Math.ceil(point.x + outerRadius));
    const y0 = Math.max(0, Math.floor(point.y - outerRadius));
    const y1 = Math.min(height - 1, Math.ceil(point.y + outerRadius));

    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const dx = x - point.x;
        const dy = y - point.y;
        const distance = Math.sqrt(dx * dx + dy * dy) / step;
        if (distance > 0.80) continue;
        const index = (y * width + x) * 4;
        if (distance <= 0.27) addStatsSample(centerAcc, data, index);
        if (distance <= 0.39) addStatsSample(bodyAcc, data, index);
        if (distance >= 0.30 && distance <= 0.49) addStatsSample(ringAcc, data, index);
        if (
          Math.abs(dx) >= step * 0.34 &&
          Math.abs(dy) >= step * 0.34 &&
          isBoardInteriorDirection(row, col, dx, dy, step)
        ) {
          addStatsSample(backgroundAcc, data, index);
        }
      }
    }

    const center = finishStats(centerAcc);
    const body = finishStats(bodyAcc);
    const ring = finishStats(ringAcc);
    const background = finishStats(backgroundAcc);
    const localTone = sampleLocalBoardTone(data, width, height, point.x, point.y, step, row, col);
    const referenceTone = localTone * 0.72 + background.mean * 0.28;
    const radial = radialBoundaryFeature(data, width, height, point.x, point.y, step);
    const thinLine = thinGridLineFeature(data, width, height, point.x, point.y, step, row, col);
    const bodyDelta = body.mean - referenceTone;
    const ringDelta = ring.mean - referenceTone;
    const profileDelta = body.mean - ring.mean;
    const circle = computeCircleOccupancy(radial, bodyDelta, profileDelta, thinLine.score);
    const colorKey = bodyDelta * 0.72 + profileDelta * 0.28;
    return {
      point, row, col, center, body, ring, background, localTone, referenceTone,
      radial, thinLine, bodyDelta, ringDelta, profileDelta,
      profileContrast: Math.abs(profileDelta),
      occupancyScore: circle.score,
      circleCandidate: circle.candidate,
      colorKey,
    };
  }
`;

html = replaceFunctionRange(html, 'radialBoundaryFeature', 'kmeansTwo', featureFunctions);

const classifyFunction = String.raw`  function classifyBoardFeatures(features) {
    const occupancyValues = features.map(feature => feature.occupancyScore);
    const occupancyClusters = kmeansTwo(occupancyValues);
    const separation = occupancyClusters ? occupancyClusters.high - occupancyClusters.low : 0;
    const occupancyThreshold = separation >= 0.12
      ? clamp(occupancyClusters.threshold, 0.48, 0.70)
      : 0.52;

    const occupiedIndexes = [];
    for (let index = 0; index < features.length; index++) {
      const feature = features[index];
      if (feature.circleCandidate && feature.occupancyScore >= occupancyThreshold) occupiedIndexes.push(index);
    }
    const occupiedSet = new Set(occupiedIndexes);

    const colorValues = occupiedIndexes.map(index => features[index].colorKey);
    const colorClusters = colorValues.length >= 4 ? kmeansTwo(colorValues) : null;
    const colorSeparation = colorClusters ? colorClusters.high - colorClusters.low : 0;
    const useColorClusters = !!colorClusters && colorSeparation >= 24 && colorClusters.lowCount >= 2 && colorClusters.highCount >= 2;

    importState.classificationMeta = features;
    for (let index = 0; index < features.length; index++) {
      const feature = features[index];
      let stone = 0;
      let confidence = clamp(0.58 + Math.abs(feature.occupancyScore - occupancyThreshold) * 1.6, 0, 1);
      if (occupiedSet.has(index)) {
        const strongBlack = feature.bodyDelta <= -16 && feature.radial.signedMedian >= 7;
        const strongWhite = feature.bodyDelta >= 16 && feature.radial.signedMedian <= -7;
        if (strongBlack) stone = 1;
        else if (strongWhite) stone = 2;
        else if (useColorClusters) stone = feature.colorKey < colorClusters.threshold ? 1 : 2;
        else stone = feature.radial.signedMedian >= 0 ? 1 : 2;

        const colorMargin = useColorClusters
          ? Math.abs(feature.colorKey - colorClusters.threshold) / Math.max(20, colorSeparation)
          : Math.abs(feature.radial.signedMedian) / 45;
        confidence = clamp(confidence * 0.62 + clamp01(colorMargin) * 0.38, 0, 1);
      }
      importState.recognizedBoard[index] = stone;
      importState.confidenceMap[index] = confidence;
    }
  }
`;

html = replaceFunctionRange(html, 'classifyBoardFeatures', 'renderRecognitionPreview', classifyFunction);

html = replaceExactly(
  html,
  `    const features = importState.warpedIntersections.map(point =>
      extractCellFeatures(imageData.data, imageData.width, imageData.height, point, step)
    );`,
  `    const features = importState.warpedIntersections.map((point, index) =>
      extractCellFeatures(
        imageData.data,
        imageData.width,
        imageData.height,
        point,
        step,
        Math.floor(index / SIZE),
        index % SIZE
      )
    );`,
  'pass row and column to feature extraction'
);

spec = replaceExactly(
  spec,
  '- 瀏覽器版本不依賴後端或需另行訓練的模型，使用局部圓周邊界、棋子與背景亮度差、細格線可見度及全盤自適應分群，先判斷空／有子，再判斷黑／白。\n',
  '- 瀏覽器版本不依賴後端或需另行訓練的模型，先以棋盤內側取樣建立局部光照基準，再結合有方向性的圓周內外亮度、棋身到邊緣的剖面差、有效格線方向及全盤自適應分群，先判斷空／有子，再判斷黑／白。\n- 角落、邊線及內部交點分別只檢查實際存在的 2、3、4 個格線方向；背景與光照取樣不得跨到棋盤外框，避免外圍空點被深色邊框誤判。\n- 格線不清楚或消失只能降低空點信心，不能單獨作為有棋子的證據；有子必須同時具有一致方向的圓形邊界、相對局部背景的棋身亮度差，以及棋身到棋子外圈的剖面差。\n- 黑白分類必須使用扣除局部光照後的相對亮度與圓周極性，不得用絕對亮度直接把高光區判成白棋；寬廣漸層反光若沒有棋子剖面，應維持空點。\n',
  'update recognition requirements'
);

for (const forbidden of [
  'feature.thinLine.score <= 0.24',
  'feature.body.mean >= 196',
  '(1 - thinLine.score) * 0.17'
]) {
  if (html.includes(forbidden)) throw new Error(`obsolete recognition rule remains: ${forbidden}`);
}
for (const required of [
  'function computeCircleOccupancy(',
  'function sampleLocalBoardTone(',
  'circleCandidate',
  'expectedArms',
  'feature.radial.signedMedian'
]) {
  if (!html.includes(required)) throw new Error(`required recognition rule missing: ${required}`);
}

fs.writeFileSync('makevcf.html', html);
fs.writeFileSync('規格書.MD', spec);
console.log('Applied edge-aware grid sampling, local illumination normalization, and circular-profile occupancy gating.');
