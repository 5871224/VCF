const fs = require('fs');

let html = fs.readFileSync('makevcf.html', 'utf8');
let spec = fs.readFileSync('規格書.MD', 'utf8');

function replaceFunction(text, startToken, endToken, replacement, label) {
  const start = text.indexOf(startToken);
  const end = text.indexOf(endToken, start + startToken.length);
  if (start < 0 || end < 0) throw new Error(`${label}: function boundary not found`);
  return text.slice(0, start) + replacement + text.slice(end);
}

function replaceExactly(text, search, replacement, label) {
  const count = text.split(search).length - 1;
  if (count !== 1) throw new Error(`${label}: expected exactly one match, got ${count}`);
  return text.replace(search, replacement);
}

const annulusHelper = `  function sampleStoneAnnulusFeature(data, width, height, cx, cy, step) {
    const values = [];
    const radialValues = [];
    for (let angleIndex = 0; angleIndex < 96; angleIndex++) {
      const angle = (angleIndex / 96) * Math.PI * 2;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      const directionValues = [];
      for (const radiusRatio of [0.24, 0.29, 0.34, 0.38]) {
        const value = pixelLum(data, width, height, cx + cos * step * radiusRatio, cy + sin * step * radiusRatio);
        values.push(value);
        directionValues.push(value);
      }
      radialValues.push(median(directionValues));
    }
    const tone = median(values);
    const directionTone = median(radialValues);
    const deviations = radialValues.map(value => Math.abs(value - directionTone));
    const mad = median(deviations);
    const tolerance = Math.max(18, mad * 2.4 + 7);
    const purity = radialValues.filter(value => Math.abs(value - directionTone) <= tolerance).length / radialValues.length;
    const sorted = radialValues.slice().sort((a, b) => a - b);
    const lower = sorted[Math.floor(sorted.length * 0.18)] || directionTone;
    const upper = sorted[Math.floor(sorted.length * 0.82)] || directionTone;
    return {
      tone: directionTone * 0.76 + tone * 0.24,
      median: directionTone,
      mad,
      purity,
      lower,
      upper,
      spread: upper - lower,
    };
  }

`;

if (!html.includes('function sampleStoneAnnulusFeature(')) {
  html = replaceExactly(
    html,
    '  function radialBoundaryFeature(data, width, height, cx, cy, step) {',
    annulusHelper + '  function radialBoundaryFeature(data, width, height, cx, cy, step) {',
    'insert annulus helper'
  );
}

const occupancy = `  function computeCircleOccupancy(radial, bodyDelta, profileDelta, thinLineScore, annularPurity) {
    const toneContrast = Math.abs(bodyDelta);
    const profileContrast = Math.abs(profileDelta);
    const signedStrength = Math.abs(radial.signedMedian);
    const polarityAligned = bodyDelta * radial.signedMedian <= -42 && toneContrast >= 8 && signedStrength >= 4;
    const profileAligned = bodyDelta * profileDelta > 0;
    const coverageScore = clamp01((radial.dominantCoverage - 0.24) / 0.58);
    const radialStrengthScore = clamp01((radial.absoluteMedian - 4) / 34);
    const toneContrastScore = clamp01((toneContrast - 7) / 55);
    const profileScore = clamp01((profileContrast - 3) / 35);
    const annularScore = clamp01((annularPurity - 0.28) / 0.62);
    const score = clamp01(
      coverageScore * 0.22 +
      radialStrengthScore * 0.17 +
      toneContrastScore * 0.24 +
      profileScore * 0.13 +
      annularScore * 0.20 +
      (polarityAligned && profileAligned ? 0.12 : 0) -
      thinLineScore * 0.05
    );
    const normalCircle =
      radial.dominantCoverage >= 0.42 &&
      radial.absoluteMedian >= 8 &&
      toneContrast >= 12 &&
      profileContrast >= 5 &&
      polarityAligned;
    const veryStrongCircle =
      radial.dominantCoverage >= 0.66 &&
      radial.absoluteMedian >= 15 &&
      toneContrast >= 9;
    const outlinedWhiteCircle =
      radial.whiteCoverage >= 0.66 &&
      radial.absoluteMedian >= 9 &&
      bodyDelta >= 4 &&
      profileDelta >= 12;
    const numberedCircle =
      annularPurity >= 0.52 &&
      toneContrast >= 15 &&
      radial.dominantCoverage >= 0.28 &&
      radial.absoluteMedian >= 5;
    return {
      score,
      candidate: normalCircle || veryStrongCircle || outlinedWhiteCircle || numberedCircle,
      polarityAligned,
      profileAligned,
      outlinedWhiteCircle,
      numberedCircle,
    };
  }

`;
html = replaceFunction(
  html,
  '  function computeCircleOccupancy(',
  '  function extractCellFeatures(',
  occupancy,
  'replace occupancy classifier'
);

const extract = `  function extractCellFeatures(data, width, height, point, step, row, col) {
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
        if (distance <= 0.18) addStatsSample(centerAcc, data, index);
        if (distance >= 0.22 && distance <= 0.39) addStatsSample(bodyAcc, data, index);
        if (distance >= 0.42 && distance <= 0.57) addStatsSample(ringAcc, data, index);
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
    const referenceTone = localTone * 0.76 + background.mean * 0.24;
    const annulus = sampleStoneAnnulusFeature(data, width, height, point.x, point.y, step);
    const radial = radialBoundaryFeature(data, width, height, point.x, point.y, step);
    const thinLine = thinGridLineFeature(data, width, height, point.x, point.y, step, row, col);
    const bodyDelta = annulus.tone - referenceTone;
    const ringDelta = ring.mean - referenceTone;
    const profileDelta = annulus.tone - ring.mean;
    const circle = computeCircleOccupancy(radial, bodyDelta, profileDelta, thinLine.score, annulus.purity);
    const colorKey = bodyDelta * 0.82 + radial.signedMedian * -0.18;
    return {
      point, row, col, center, body, ring, background, localTone, referenceTone,
      annulus, radial, thinLine, bodyDelta, ringDelta, profileDelta,
      profileContrast: Math.abs(profileDelta),
      occupancyScore: circle.score,
      circleCandidate: circle.candidate,
      outlinedWhiteCircle: circle.outlinedWhiteCircle,
      numberedCircle: circle.numberedCircle,
      colorKey,
    };
  }

`;
html = replaceFunction(
  html,
  '  function extractCellFeatures(',
  '  function kmeansTwo(',
  extract,
  'replace cell feature extraction'
);

const classify = `  function classifyBoardFeatures(features) {
    const occupancyValues = features.map(feature => feature.occupancyScore);
    const occupancyClusters = kmeansTwo(occupancyValues);
    const separation = occupancyClusters ? occupancyClusters.high - occupancyClusters.low : 0;
    const occupancyThreshold = separation >= 0.10
      ? clamp(occupancyClusters.threshold, 0.43, 0.66)
      : 0.47;

    const occupiedIndexes = [];
    for (let index = 0; index < features.length; index++) {
      const feature = features[index];
      const numberedAccepted = feature.numberedCircle && feature.occupancyScore >= occupancyThreshold - 0.08;
      if (feature.circleCandidate && (feature.occupancyScore >= occupancyThreshold || numberedAccepted)) occupiedIndexes.push(index);
    }
    const occupiedSet = new Set(occupiedIndexes);

    const colorValues = occupiedIndexes.map(index => features[index].colorKey);
    const colorClusters = colorValues.length >= 4 ? kmeansTwo(colorValues) : null;
    const colorSeparation = colorClusters ? colorClusters.high - colorClusters.low : 0;
    const useColorClusters = !!colorClusters && colorSeparation >= 20 && colorClusters.lowCount >= 2 && colorClusters.highCount >= 2;

    importState.classificationMeta = features;
    for (let index = 0; index < features.length; index++) {
      const feature = features[index];
      let stone = 0;
      let confidence = clamp(0.58 + Math.abs(feature.occupancyScore - occupancyThreshold) * 1.7, 0, 1);
      if (occupiedSet.has(index)) {
        const strongBlack = feature.bodyDelta <= -13 && feature.annulus.purity >= 0.44;
        const strongWhite = feature.bodyDelta >= 11 && feature.annulus.purity >= 0.44;
        if (feature.outlinedWhiteCircle) stone = 2;
        else if (strongBlack) stone = 1;
        else if (strongWhite) stone = 2;
        else if (useColorClusters) stone = feature.colorKey < colorClusters.threshold ? 1 : 2;
        else stone = feature.bodyDelta < 0 ? 1 : 2;

        const colorMargin = useColorClusters
          ? Math.abs(feature.colorKey - colorClusters.threshold) / Math.max(18, colorSeparation)
          : Math.abs(feature.bodyDelta) / 55;
        confidence = clamp(confidence * 0.58 + clamp01(colorMargin) * 0.42, 0, 1);
      }
      importState.recognizedBoard[index] = stone;
      importState.confidenceMap[index] = confidence;
    }
  }

`;
html = replaceFunction(
  html,
  '  function classifyBoardFeatures(',
  '  function renderRecognitionPreview(',
  classify,
  'replace board classifier'
);

const specNeedle = '- 黑白分類必須使用扣除局部光照後的相對亮度與圓周極性，不得用絕對亮度直接把高光區判成白棋；寬廣漸層反光若沒有棋子剖面，應維持空點。白底棋盤上的白色描邊棋子，若中心接近棋盤底色但具有高覆蓋率暗色圓框與明顯中心／外圈剖面，仍應辨識為白棋。';
const specReplacement = specNeedle + '\n- 棋子中央可能印有手數或其他反色文字；有子與黑白判定必須忽略中心文字區，改以約 0.24～0.38 格距的棋身環帶進行多方向中位數與純度判斷。少數方向被一位或兩位數字污染時，不得使整顆棋子變成空點或反色。';
if (!spec.includes('棋子中央可能印有手數或其他反色文字')) {
  if (!spec.includes(specNeedle)) throw new Error('spec insertion point missing');
  spec = spec.replace(specNeedle, specReplacement);
}

for (const required of [
  'function sampleStoneAnnulusFeature(',
  'annularPurity >= 0.52',
  'const numberedCircle =',
  'const bodyDelta = annulus.tone - referenceTone;',
  'feature.annulus.purity >= 0.44',
]) {
  if (!html.includes(required)) throw new Error(`required token missing: ${required}`);
}

fs.writeFileSync('makevcf.html', html);
fs.writeFileSync('規格書.MD', spec);
console.log('Applied center-text-resistant annulus recognition.');
