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
  const end = text.indexOf(endToken, start + startToken.length);
  if (start < 0 || end < 0) throw new Error(`${label}: function boundary not found`);
  return text.slice(0, start) + replacement + text.slice(end);
}

const periodicGridHelpers = `  function fitPeriodicGridBundle(bundle, minDimension) {
    const lines = bundle.filter(line => line.length >= minDimension * 0.08);
    if (lines.length < 6) return null;
    const minSpacing = minDimension * 0.028;
    const maxSpacing = minDimension * 0.105;
    let best = null;

    function evaluate(spacing, phase) {
      const tolerance = Math.max(3, spacing * 0.22);
      const matches = new Map();
      for (const line of lines) {
        const gridIndex = Math.round((line.rho - phase) / spacing);
        if (gridIndex < 0 || gridIndex >= SIZE) continue;
        const error = Math.abs(line.rho - (phase + gridIndex * spacing));
        if (error > tolerance) continue;
        const lengthScore = clamp01(line.length / (minDimension * 0.72));
        const score = (1 - error / tolerance) * (0.42 + lengthScore * 0.58);
        const previous = matches.get(gridIndex);
        if (!previous || score > previous.score) matches.set(gridIndex, { line, score, error });
      }
      if (matches.size < 6) return null;
      const indexes = Array.from(matches.keys()).sort((a, b) => a - b);
      const coverage = matches.size / SIZE;
      const interiorCoverage = indexes.filter(index => index > 0 && index < SIZE - 1).length / (SIZE - 2);
      const spanCoverage = (indexes[indexes.length - 1] - indexes[0]) / (SIZE - 1);
      const matchQuality = Array.from(matches.values()).reduce((sum, item) => sum + item.score, 0) / matches.size;
      const score = coverage * 0.40 + interiorCoverage * 0.25 + spanCoverage * 0.20 + matchQuality * 0.15;
      return { score, coverage, interiorCoverage, spanCoverage, spacing, phase, matches };
    }

    for (let first = 0; first < lines.length; first++) {
      for (let second = first + 1; second < lines.length; second++) {
        const distance = lines[second].rho - lines[first].rho;
        if (distance <= 0) continue;
        for (let gridGap = 1; gridGap < SIZE; gridGap++) {
          const spacing = distance / gridGap;
          if (spacing < minSpacing || spacing > maxSpacing) continue;
          for (let anchorIndex = 0; anchorIndex < SIZE; anchorIndex++) {
            const candidate = evaluate(spacing, lines[first].rho - anchorIndex * spacing);
            if (candidate && (!best || candidate.score > best.score)) best = candidate;
          }
        }
      }
    }
    if (!best || best.coverage < 0.42 || best.spanCoverage < 0.50) return null;

    let a = 0, b = 0, totalWeight = 0;
    for (const { line, score } of best.matches.values()) {
      a += line.a * score;
      b += line.b * score;
      totalWeight += score;
    }
    if (!totalWeight) return null;
    a /= totalWeight;
    b /= totalWeight;
    const norm = Math.sqrt(a * a + b * b) || 1;
    a /= norm;
    b /= norm;
    const lowRho = best.phase;
    const highRho = best.phase + best.spacing * (SIZE - 1);
    return {
      low: { a, b, c: -lowRho, rho: lowRho, length: minDimension },
      high: { a, b, c: -highRho, rho: highRho, length: minDimension },
      spacing: best.spacing,
      coverage: best.coverage,
      score: best.score,
    };
  }

`;

html = replaceExactly(
  html,
  '  function detectHoughCandidates(gray) {',
  periodicGridHelpers + '  function detectHoughCandidates(gray) {',
  'insert periodic grid helper'
);

const detectHoughCandidates = `  function detectHoughCandidates(gray) {
    const width = gray.cols;
    const height = gray.rows;
    const minDimension = Math.min(width, height);
    let blur = null, edge = null, closed = null, kernel = null, lines = null;
    try {
      blur = new cv.Mat();
      edge = new cv.Mat();
      closed = new cv.Mat();
      lines = new cv.Mat();
      cv.GaussianBlur(gray, blur, new cv.Size(5, 5), 0);
      cv.Canny(blur, edge, 36, 120);
      const kernelSize = Math.max(3, Math.round(minDimension / 260) * 2 + 1);
      kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(kernelSize, kernelSize));
      cv.morphologyEx(edge, closed, cv.MORPH_CLOSE, kernel, new cv.Point(-1, -1), 1);
      cv.HoughLinesP(
        closed,
        lines,
        1,
        Math.PI / 180,
        Math.max(35, Math.round(minDimension * 0.065)),
        Math.max(45, Math.round(minDimension * 0.17)),
        Math.max(8, Math.round(minDimension * 0.035))
      );
      const segments = [];
      const values = lines.data32S || [];
      for (let i = 0; i + 3 < values.length; i += 4) {
        const x1 = values[i], y1 = values[i + 1], x2 = values[i + 2], y2 = values[i + 3];
        const dx = x2 - x1, dy = y2 - y1;
        const length = Math.sqrt(dx * dx + dy * dy);
        if (length < minDimension * 0.15) continue;
        let angle = Math.atan2(dy, dx);
        if (angle < 0) angle += Math.PI;
        if (angle >= Math.PI) angle -= Math.PI;
        segments.push({ x1, y1, x2, y2, length, angle });
      }
      if (segments.length < 8) return [];
      const peaks = orientationPeaks(segments);
      if (!peaks) return [];
      const bundleA = buildLineBundle(segments, peaks[0], minDimension);
      const bundleB = buildLineBundle(segments, peaks[1], minDimension);
      const candidates = [];

      const periodicA = fitPeriodicGridBundle(bundleA, minDimension);
      const periodicB = fitPeriodicGridBundle(bundleB, minDimension);
      if (periodicA && periodicB) {
        const points = [
          lineIntersection(periodicA.low, periodicB.low),
          lineIntersection(periodicA.high, periodicB.low),
          lineIntersection(periodicA.high, periodicB.high),
          lineIntersection(periodicA.low, periodicB.high),
        ];
        if (!points.some(point => !point)) {
          const quad = orderCorners(points);
          if (isUsableQuad(quad, width, height)) {
            candidates.push({
              quad,
              source: 'periodic-grid',
              periodicCoverage: Math.min(periodicA.coverage, periodicB.coverage),
              periodicScore: Math.min(periodicA.score, periodicB.score),
            });
          }
        }
      }

      const pairsA = boundaryPairs(bundleA, minDimension);
      const pairsB = boundaryPairs(bundleB, minDimension);
      if (pairsA.length && pairsB.length) {
        for (const a of pairsA) {
          for (const b of pairsB) {
            const points = [
              lineIntersection(a.low, b.low),
              lineIntersection(a.high, b.low),
              lineIntersection(a.high, b.high),
              lineIntersection(a.low, b.high),
            ];
            if (points.some(point => !point)) continue;
            const quad = orderCorners(points);
            if (!isUsableQuad(quad, width, height)) continue;
            for (const inset of [-0.02, 0, 0.02, 0.045]) {
              candidates.push({ quad: insetQuad(quad, inset), source: 'hough', inset });
            }
          }
        }
      }
      return dedupeQuads(candidates, width, height);
    } finally {
      if (blur) blur.delete();
      if (edge) edge.delete();
      if (closed) closed.delete();
      if (kernel) kernel.delete();
      if (lines) lines.delete();
    }
  }

`;

html = replaceFunction(
  html,
  '  function detectHoughCandidates(gray) {',
  '  function evaluateCandidateSet(',
  detectHoughCandidates,
  'replace Hough candidates'
);

const evaluateCandidateSet = `  function evaluateCandidateSet(gray, candidates, method, maxCandidates) {
    let best = null;
    const ordered = candidates.slice().sort((a, b) => (b.area || quadArea(b.quad)) - (a.area || quadArea(a.quad)));
    const limit = Math.min(maxCandidates, ordered.length);
    for (let i = 0; i < limit; i++) {
      const candidate = ordered[i];
      const metrics = scoreBoardCandidate(gray, candidate.quad);
      const candidateMethod = candidate.source === 'periodic-grid' ? '內部格線週期推算' : method;
      const periodicBonus = candidate.source === 'periodic-grid'
        ? clamp01((candidate.periodicCoverage || 0) - 0.35) * 0.08
        : 0;
      const rankScore = metrics.score + periodicBonus;
      if (!best || rankScore > best.rankScore) best = { ...candidate, ...metrics, method: candidateMethod, rankScore };
      if (best.score >= 0.82 && best.coverage >= 0.72) break;
    }
    return best;
  }

`;

html = replaceFunction(
  html,
  '  function evaluateCandidateSet(',
  '  function snapCandidateToGridBounds(',
  evaluateCandidateSet,
  'replace candidate evaluator'
);

html = replaceExactly(
  html,
  'if (!contourBest || contourBest.score < 0.64 || contourBest.coverage < 0.56)',
  'if (!contourBest || contourBest.score < 0.74 || contourBest.coverage < 0.66)',
  'raise Hough fallback threshold'
);

const computeCircleOccupancy = `  function computeCircleOccupancy(radial, bodyDelta, profileDelta, thinLineScore, annularPurity) {
    const toneContrast = Math.abs(bodyDelta);
    const profileContrast = Math.abs(profileDelta);
    const signedStrength = Math.abs(radial.signedMedian);
    const polarityAligned = bodyDelta * radial.signedMedian <= -60 && toneContrast >= 10 && signedStrength >= 5;
    const profileAligned = bodyDelta * profileDelta > 0;
    const coverageScore = clamp01((radial.dominantCoverage - 0.28) / 0.55);
    const radialStrengthScore = clamp01((radial.absoluteMedian - 5) / 35);
    const toneContrastScore = clamp01((toneContrast - 8) / 55);
    const profileScore = clamp01((profileContrast - 4) / 35);
    const annularScore = clamp01((annularPurity - 0.28) / 0.58);
    const score = clamp01(
      coverageScore * 0.24 +
      radialStrengthScore * 0.17 +
      toneContrastScore * 0.20 +
      profileScore * 0.16 +
      annularScore * 0.18 +
      (polarityAligned && profileAligned ? 0.13 : 0) -
      thinLineScore * 0.06
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
    const outlinedWhiteCircle =
      radial.whiteCoverage >= 0.72 &&
      radial.absoluteMedian >= 10 &&
      bodyDelta >= 5 &&
      profileDelta >= 16;
    const numberedCircle =
      annularPurity >= 0.56 &&
      radial.dominantCoverage >= 0.38 &&
      radial.absoluteMedian >= 7 &&
      toneContrast >= 16 &&
      profileContrast >= 5;
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
  computeCircleOccupancy,
  'replace circle occupancy'
);

const extractCellFeatures = `  function extractCellFeatures(data, width, height, point, step, row, col) {
    const centerAcc = createStatsAccumulator();
    const bodyAcc = createStatsAccumulator();
    const ringAcc = createStatsAccumulator();
    const backgroundAcc = createStatsAccumulator();
    const annularValues = [];
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
        const luminance = 0.299 * data[index] + 0.587 * data[index + 1] + 0.114 * data[index + 2];
        if (distance <= 0.27) addStatsSample(centerAcc, data, index);
        if (distance <= 0.39) addStatsSample(bodyAcc, data, index);
        if (distance >= 0.18 && distance <= 0.37) annularValues.push(luminance);
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
    const robustBodyTone = annularValues.length ? median(annularValues) : body.mean;
    const darkAnnularCoverage = annularValues.length
      ? annularValues.filter(value => value <= referenceTone - 18).length / annularValues.length
      : 0;
    const lightAnnularCoverage = annularValues.length
      ? annularValues.filter(value => value >= referenceTone + 18).length / annularValues.length
      : 0;
    const annularPurity = Math.max(darkAnnularCoverage, lightAnnularCoverage);
    const radial = radialBoundaryFeature(data, width, height, point.x, point.y, step);
    const thinLine = thinGridLineFeature(data, width, height, point.x, point.y, step, row, col);
    const bodyDelta = robustBodyTone - referenceTone;
    const ringDelta = ring.mean - referenceTone;
    const profileDelta = robustBodyTone - ring.mean;
    const circle = computeCircleOccupancy(radial, bodyDelta, profileDelta, thinLine.score, annularPurity);
    const colorKey = bodyDelta * 0.72 + profileDelta * 0.28;
    return {
      point, row, col, center, body, ring, background, localTone, referenceTone,
      robustBodyTone, darkAnnularCoverage, lightAnnularCoverage, annularPurity,
      radial, thinLine, bodyDelta, ringDelta, profileDelta,
      profileContrast: Math.abs(profileDelta),
      occupancyScore: circle.score,
      circleCandidate: circle.candidate,
      numberedCircle: circle.numberedCircle,
      colorKey,
    };
  }

`;

html = replaceFunction(
  html,
  '  function extractCellFeatures(',
  '  function kmeansTwo(',
  extractCellFeatures,
  'replace cell features'
);

spec = replaceExactly(
  spec,
  '- 自動定位前必須抑制圖片四周的文字、座標與說明標籤；外圍小型高對比元件不得干擾真正 15×15 棋盤的輪廓、Hough 格線與候選評分，長格線及棋盤外框則必須保留。',
  '- 自動定位前必須抑制圖片四周的文字、座標與說明標籤；外圍小型高對比元件不得干擾真正 15×15 棋盤的輪廓、Hough 格線與候選評分，長格線及棋盤外框則必須保留。若最外圍格線被棋子遮斷，必須由可見的內部等距格線擬合 15 路週期，容許缺線並向外推算第一路與第十五路，不得要求四條外框完整可見。',
  'update periodic-grid spec'
);

spec = replaceExactly(
  spec,
  '- 格線不清楚或消失只能降低空點信心，不能單獨作為有棋子的證據；有子必須同時具有一致方向的圓形邊界、相對局部背景的棋身亮度差，以及棋身到棋子外圈的剖面差。',
  '- 格線不清楚或消失只能降低空點信心，不能單獨作為有棋子的證據；有子必須同時具有一致方向的圓形邊界、相對局部背景的棋身亮度差，以及棋身到棋子外圈的剖面差。棋子中央若印有手數、字母或其他反色文字，分類必須降低中心區權重，改以避開中心的棋身環帶中位數、環帶顏色純度與圓周邊界判斷。',
  'update numbered-stone spec'
);

for (const token of [
  'function fitPeriodicGridBundle(',
  "source: 'periodic-grid'",
  'annularPurity >= 0.56',
  'const robustBodyTone = annularValues.length ? median(annularValues) : body.mean;',
]) {
  if (!html.includes(token)) throw new Error(`generated token missing: ${token}`);
}

fs.writeFileSync('makevcf.html', html);
fs.writeFileSync('規格書.MD', spec);
console.log('Applied periodic grid and numbered-stone recognition update.');
