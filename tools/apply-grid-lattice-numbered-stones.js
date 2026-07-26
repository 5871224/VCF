const fs = require('fs');

let html = fs.readFileSync('makevcf.html', 'utf8');
let spec = fs.readFileSync('規格書.MD', 'utf8');

function replaceFunction(text, startToken, endToken, replacement, label) {
  const start = text.indexOf(startToken);
  const end = text.indexOf(endToken, start);
  if (start < 0 || end < 0) throw new Error(`${label}: function boundary not found`);
  return text.slice(0, start) + replacement + text.slice(end);
}

function replaceExactly(text, search, replacement, label) {
  const count = text.split(search).length - 1;
  if (count !== 1) throw new Error(`${label}: expected exactly one match, got ${count}`);
  return text.replace(search, replacement);
}

const latticeHelpers = `  function makeParallelLine(bundle, rho) {
    let a = 0;
    let b = 0;
    let weight = 0;
    for (const line of bundle) {
      const lineWeight = Math.max(1, line.length || 1);
      a += line.a * lineWeight;
      b += line.b * lineWeight;
      weight += lineWeight;
    }
    const norm = Math.sqrt(a * a + b * b) || 1;
    a /= norm;
    b /= norm;
    return { a, b, c: -rho, rho, length: weight / Math.max(1, bundle.length) };
  }

  function fitGridLatticePairs(bundle, minDimension) {
    if (bundle.length < 5) return [];
    const minStep = minDimension * 0.030;
    const maxStep = minDimension * 0.086;
    const tolerance = Math.max(3.5, minDimension * 0.010);
    const observedMin = bundle[0].rho;
    const observedMax = bundle[bundle.length - 1].rho;
    const stepMap = new Map();

    for (let left = 0; left < bundle.length; left++) {
      for (let right = left + 1; right < bundle.length; right++) {
        const difference = bundle[right].rho - bundle[left].rho;
        for (let gaps = 1; gaps <= 7; gaps++) {
          const step = difference / gaps;
          if (step < minStep || step > maxStep) continue;
          const key = Math.round(step * 2) / 2;
          stepMap.set(key, (stepMap.get(key) || 0) + Math.min(bundle[left].length, bundle[right].length));
        }
      }
    }

    const candidateSteps = Array.from(stepMap.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 18)
      .map(entry => entry[0]);
    const fits = [];

    for (const step of candidateSteps) {
      for (const anchor of bundle) {
        for (let gridIndex = 0; gridIndex < SIZE; gridIndex++) {
          const start = anchor.rho - gridIndex * step;
          const end = start + (SIZE - 1) * step;
          const missingBefore = Math.max(0, (observedMin - start) / step);
          const missingAfter = Math.max(0, (end - observedMax) / step);
          if (missingBefore > 3.4 || missingAfter > 3.4) continue;

          const used = new Set();
          const matchedIndexes = [];
          let residual = 0;
          let lengthSupport = 0;
          for (let index = 0; index < SIZE; index++) {
            const target = start + index * step;
            let bestLine = -1;
            let bestDistance = Infinity;
            for (let lineIndex = 0; lineIndex < bundle.length; lineIndex++) {
              if (used.has(lineIndex)) continue;
              const distance = Math.abs(bundle[lineIndex].rho - target);
              if (distance < bestDistance) {
                bestDistance = distance;
                bestLine = lineIndex;
              }
            }
            if (bestLine < 0 || bestDistance > tolerance) continue;
            used.add(bestLine);
            matchedIndexes.push(index);
            residual += bestDistance / tolerance;
            lengthSupport += Math.min(1, bundle[bestLine].length / (minDimension * 0.42));
          }

          const support = matchedIndexes.length;
          if (support < 7) continue;
          const span = matchedIndexes[matchedIndexes.length - 1] - matchedIndexes[0];
          if (span < 9) continue;
          const coverage = support / SIZE;
          const spanCoverage = span / (SIZE - 1);
          const residualScore = 1 - residual / support;
          const lengthScore = lengthSupport / support;
          const missingPenalty = (missingBefore + missingAfter) / 7;
          const score = coverage * 0.43 + spanCoverage * 0.27 + residualScore * 0.20 + lengthScore * 0.10 - missingPenalty * 0.06;
          fits.push({ start, end, step, score, coverage, spanCoverage, support });
        }
      }
    }

    fits.sort((a, b) => b.score - a.score);
    const unique = [];
    for (const fit of fits) {
      if (fit.coverage < 0.47 || fit.score < 0.48) continue;
      if (unique.some(existing => Math.abs(existing.start - fit.start) < tolerance && Math.abs(existing.end - fit.end) < tolerance)) continue;
      unique.push(fit);
      if (unique.length >= 4) break;
    }

    return unique.map(fit => ({
      low: makeParallelLine(bundle, fit.start),
      high: makeParallelLine(bundle, fit.end),
      weight: minDimension * (2.2 + fit.score),
      source: 'lattice',
      lattice: fit,
    }));
  }

`;

html = replaceExactly(
  html,
  '  function detectHoughCandidates(gray) {',
  latticeHelpers + '  function detectHoughCandidates(gray) {',
  'insert lattice helpers'
);

const detectHough = `  function detectHoughCandidates(gray) {
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
      cv.Canny(blur, edge, 34, 116);
      const kernelSize = Math.max(3, Math.round(minDimension / 260) * 2 + 1);
      kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(kernelSize, kernelSize));
      cv.morphologyEx(edge, closed, cv.MORPH_CLOSE, kernel, new cv.Point(-1, -1), 1);
      cv.HoughLinesP(
        closed,
        lines,
        1,
        Math.PI / 180,
        Math.max(32, Math.round(minDimension * 0.052)),
        Math.max(42, Math.round(minDimension * 0.090)),
        Math.max(14, Math.round(minDimension * 0.062))
      );
      const segments = [];
      const values = lines.data32S || [];
      for (let i = 0; i + 3 < values.length; i += 4) {
        const x1 = values[i], y1 = values[i + 1], x2 = values[i + 2], y2 = values[i + 3];
        const dx = x2 - x1, dy = y2 - y1;
        const length = Math.sqrt(dx * dx + dy * dy);
        if (length < minDimension * 0.085) continue;
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
      const pairsA = [...fitGridLatticePairs(bundleA, minDimension), ...boundaryPairs(bundleA, minDimension)]
        .sort((a, b) => b.weight - a.weight)
        .slice(0, 9);
      const pairsB = [...fitGridLatticePairs(bundleB, minDimension), ...boundaryPairs(bundleB, minDimension)]
        .sort((a, b) => b.weight - a.weight)
        .slice(0, 9);
      if (!pairsA.length || !pairsB.length) return [];
      const candidates = [];
      for (const a of pairsA) {
        for (const b of pairsB) {
          const pts = [
            lineIntersection(a.low, b.low),
            lineIntersection(a.high, b.low),
            lineIntersection(a.high, b.high),
            lineIntersection(a.low, b.high),
          ];
          if (pts.some(point => !point)) continue;
          const quad = orderCorners(pts);
          if (!isUsableQuad(quad, width, height)) continue;
          const lattice = a.source === 'lattice' || b.source === 'lattice';
          for (const inset of lattice ? [-0.012, 0, 0.012] : [-0.02, 0, 0.02, 0.045]) {
            candidates.push({ quad: insetQuad(quad, inset), source: lattice ? 'hough-lattice' : 'hough', inset, lattice });
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
html = replaceFunction(html, '  function detectHoughCandidates(gray) {', '  function evaluateCandidateSet(', detectHough, 'replace Hough detection');

const robustRadial = `  function robustTone(values, trimRatio = 0.20) {
    if (!values.length) return 0;
    const sorted = values.slice().sort((a, b) => a - b);
    const trim = Math.min(Math.floor(sorted.length * trimRatio), Math.floor((sorted.length - 1) / 2));
    const middle = sorted.slice(trim, sorted.length - trim);
    const trimmedMean = middle.reduce((sum, value) => sum + value, 0) / Math.max(1, middle.length);
    return median(sorted) * 0.68 + trimmedMean * 0.32;
  }

  function radialBoundaryFeature(data, width, height, cx, cy, step) {
    const signedDifferences = [];
    const absoluteDifferences = [];
    const outlineDarkness = [];
    for (let index = 0; index < 64; index++) {
      const angle = (index / 64) * Math.PI * 2;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      const inside = robustTone([0.23, 0.29, 0.35].map(radius =>
        pixelLum(data, width, height, cx + cos * step * radius, cy + sin * step * radius)
      ), 0);
      const border = Math.min(...[0.39, 0.42, 0.45].map(radius =>
        pixelLum(data, width, height, cx + cos * step * radius, cy + sin * step * radius)
      ));
      const outside = robustTone([0.52, 0.58, 0.64].map(radius =>
        pixelLum(data, width, height, cx + cos * step * radius, cy + sin * step * radius)
      ), 0);
      const difference = outside - inside;
      signedDifferences.push(difference);
      absoluteDifferences.push(Math.abs(difference));
      outlineDarkness.push(Math.max(0, Math.min(inside, outside) - border));
    }
    const threshold = 8;
    const blackCoverage = signedDifferences.filter(value => value >= threshold).length / signedDifferences.length;
    const whiteCoverage = signedDifferences.filter(value => value <= -threshold).length / signedDifferences.length;
    const darkOutlineCoverage = outlineDarkness.filter(value => value >= 7).length / outlineDarkness.length;
    return {
      signedMedian: median(signedDifferences),
      signedMean: signedDifferences.reduce((sum, value) => sum + value, 0) / signedDifferences.length,
      absoluteMedian: median(absoluteDifferences),
      absoluteMean: absoluteDifferences.reduce((sum, value) => sum + value, 0) / absoluteDifferences.length,
      blackCoverage,
      whiteCoverage,
      dominantCoverage: Math.max(blackCoverage, whiteCoverage),
      mixedCoverage: Math.min(blackCoverage, whiteCoverage),
      darkOutlineMedian: median(outlineDarkness),
      darkOutlineMean: outlineDarkness.reduce((sum, value) => sum + value, 0) / outlineDarkness.length,
      darkOutlineCoverage,
    };
  }

`;
html = replaceFunction(html, '  function radialBoundaryFeature(', '  function thinGridLineFeature(', robustRadial, 'replace radial feature');

const occupancy = `  function computeCircleOccupancy(radial, bodyDelta, profileDelta, thinLineScore) {
    const toneContrast = Math.abs(bodyDelta);
    const profileContrast = Math.abs(profileDelta);
    const signedStrength = Math.abs(radial.signedMedian);
    const polarityAligned = bodyDelta * radial.signedMedian <= -48 && toneContrast >= 8 && signedStrength >= 4;
    const profileAligned = bodyDelta * profileDelta > 0;
    const coverageScore = clamp01((radial.dominantCoverage - 0.24) / 0.58);
    const radialStrengthScore = clamp01((radial.absoluteMedian - 4) / 34);
    const toneContrastScore = clamp01((toneContrast - 6) / 55);
    const profileScore = clamp01((profileContrast - 3) / 35);
    const outlineScore = clamp01((radial.darkOutlineCoverage - 0.28) / 0.60) * 0.55 + clamp01((radial.darkOutlineMedian - 4) / 24) * 0.45;
    const score = clamp01(
      coverageScore * 0.25 +
      radialStrengthScore * 0.18 +
      toneContrastScore * 0.22 +
      profileScore * 0.17 +
      outlineScore * 0.16 +
      (polarityAligned && profileAligned ? 0.12 : 0) -
      thinLineScore * 0.06
    );
    const normalCircle =
      radial.dominantCoverage >= 0.42 &&
      radial.absoluteMedian >= 7 &&
      toneContrast >= 10 &&
      profileContrast >= 5 &&
      polarityAligned &&
      profileAligned;
    const veryStrongCircle =
      radial.dominantCoverage >= 0.66 &&
      radial.absoluteMedian >= 14 &&
      toneContrast >= 8 &&
      profileContrast >= 4 &&
      polarityAligned;
    const outlinedWhiteCircle =
      radial.darkOutlineCoverage >= 0.54 &&
      radial.darkOutlineMedian >= 7 &&
      bodyDelta >= -5 &&
      profileDelta >= 10;
    return {
      score,
      candidate: normalCircle || veryStrongCircle || outlinedWhiteCircle,
      polarityAligned,
      profileAligned,
      outlinedWhiteCircle,
    };
  }

`;
html = replaceFunction(html, '  function computeCircleOccupancy(', '  function extractCellFeatures(', occupancy, 'replace occupancy');

const extract = `  function extractCellFeatures(data, width, height, point, step, row, col) {
    const centerAcc = createStatsAccumulator();
    const bodyAcc = createStatsAccumulator();
    const ringAcc = createStatsAccumulator();
    const backgroundAcc = createStatsAccumulator();
    const stoneBandValues = [];
    const rimValues = [];
    const outsideValues = [];
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
        if (distance >= 0.30 && distance <= 0.49) addStatsSample(ringAcc, data, index);
        if (distance >= 0.22 && distance <= 0.36) stoneBandValues.push(luminance);
        if (distance >= 0.38 && distance <= 0.47) rimValues.push(luminance);
        if (distance >= 0.52 && distance <= 0.70 && isBoardInteriorDirection(row, col, dx, dy, step)) outsideValues.push(luminance);
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
    const stoneTone = robustTone(stoneBandValues, 0.24);
    const rimTone = robustTone(rimValues, 0.18);
    const outsideTone = robustTone(outsideValues, 0.22);
    const localTone = sampleLocalBoardTone(data, width, height, point.x, point.y, step, row, col);
    const referenceTone = localTone * 0.52 + background.mean * 0.23 + outsideTone * 0.25;
    const radial = radialBoundaryFeature(data, width, height, point.x, point.y, step);
    const thinLine = thinGridLineFeature(data, width, height, point.x, point.y, step, row, col);
    const bodyDelta = stoneTone - referenceTone;
    const ringDelta = rimTone - referenceTone;
    const profileDelta = stoneTone - rimTone;
    const circle = computeCircleOccupancy(radial, bodyDelta, profileDelta, thinLine.score);
    const colorKey = stoneTone * 0.76 + bodyDelta * 0.24;
    return {
      point, row, col, center, body, ring, background, localTone, referenceTone,
      stoneTone, rimTone, outsideTone,
      radial, thinLine, bodyDelta, ringDelta, profileDelta,
      profileContrast: Math.abs(profileDelta),
      occupancyScore: circle.score,
      circleCandidate: circle.candidate,
      outlinedWhiteCircle: circle.outlinedWhiteCircle,
      colorKey,
    };
  }
`;
html = replaceFunction(html, '  function extractCellFeatures(', '  function kmeansTwo(', extract + '  function kmeansTwo(', 'replace cell features');

html = replaceExactly(
  html,
  '      if (!contourBest || contourBest.score < 0.64 || contourBest.coverage < 0.56) {',
  '      if (!contourBest || contourBest.score < 0.74 || contourBest.coverage < 0.66) {',
  'broaden Hough fallback'
);

html = replaceExactly(
  html,
  '    const useColorClusters = !!colorClusters && colorSeparation >= 24 && colorClusters.lowCount >= 2 && colorClusters.highCount >= 2;',
  '    const useColorClusters = !!colorClusters && colorSeparation >= 34 && colorClusters.lowCount >= 2 && colorClusters.highCount >= 2;',
  'color cluster separation'
);

html = replaceExactly(
  html,
  `        const strongBlack = feature.bodyDelta <= -16 && feature.radial.signedMedian >= 7;
        const strongWhite = feature.bodyDelta >= 16 && feature.radial.signedMedian <= -7;
        if (strongBlack) stone = 1;
        else if (strongWhite) stone = 2;`,
  `        const strongBlack = feature.bodyDelta <= -12 && (feature.radial.signedMedian >= 5 || feature.radial.blackCoverage >= 0.52);
        const strongWhite = feature.outlinedWhiteCircle || (feature.bodyDelta >= 12 && (feature.radial.signedMedian <= -5 || feature.radial.whiteCoverage >= 0.48));
        if (strongBlack) stone = 1;
        else if (strongWhite) stone = 2;`,
  'number-resistant color rules'
);

spec = replaceExactly(
  spec,
  '- 輪廓結果可信度不足時，才執行 `HoughLinesP`，將線段分成兩個主要方向、合併重複線，並由兩組邊界線建立棋盤候選。',
  '- 輪廓結果可信度不足時，執行 `HoughLinesP`，將線段分成兩個主要方向並合併重複線。若最外側格線被棋子遮住，必須從至少 7 條可見內部格線擬合 15 路等距晶格，容許缺失格線並向兩端外推第一／第十五路，不得要求四條外框都完整可見。',
  'spec lattice detection'
);

spec = replaceExactly(
  spec,
  '- 黑白分類必須使用扣除局部光照後的相對亮度與圓周極性，不得用絕對亮度直接把高光區判成白棋；寬廣漸層反光若沒有棋子剖面，應維持空點。白底棋盤上的白色描邊棋子，若中心接近棋盤底色但具有高覆蓋率暗色圓框與明顯中心／外圈剖面，仍應辨識為白棋。',
  '- 黑白分類必須使用扣除局部光照後的相對亮度與圓周極性，不得用絕對亮度直接把高光區判成白棋；寬廣漸層反光若沒有棋子剖面，應維持空點。白底棋盤上的白色描邊棋子，若中心接近棋盤底色但具有高覆蓋率暗色圓框與明顯中心／外圈剖面，仍應辨識為白棋。棋子中央若有手數或文字，中心區不得主導判斷，必須以避開中央文字的棋身環帶、圓形邊界與外圈背景作為主要特徵。',
  'spec numbered stones'
);

for (const token of [
  'function fitGridLatticePairs(',
  "source: 'hough-lattice'",
  'function robustTone(',
  'darkOutlineCoverage',
  'stoneBandValues',
  'feature.outlinedWhiteCircle',
]) {
  if (!html.includes(token)) throw new Error(`missing generated token: ${token}`);
}

fs.writeFileSync('makevcf.html', html);
fs.writeFileSync('規格書.MD', spec);
console.log('Applied missing-border lattice detection and number-resistant stone recognition.');
