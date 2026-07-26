"use strict";

(function installImageImportHoughFixV2() {
  const SIZE = 15;
  const PATCH_FLAG = Symbol.for("vcf.imageImportRuntimeFix");
  const V2_FLAG = Symbol.for("vcf.imageImportHoughFixV2");

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function angleDistance(a, b) {
    let distance = Math.abs(a - b) % Math.PI;
    if (distance > Math.PI / 2) distance = Math.PI - distance;
    return distance;
  }

  function orientationPeaks(segments) {
    const bins = 90;
    const histogram = new Float64Array(bins);
    for (const segment of segments) {
      const bin = Math.round(segment.angle / Math.PI * bins) % bins;
      histogram[bin] += segment.length;
    }
    const smoothed = new Float64Array(bins);
    for (let index = 0; index < bins; index++) {
      for (let offset = -2; offset <= 2; offset++) {
        smoothed[index] += histogram[(index + offset + bins) % bins] * (3 - Math.abs(offset));
      }
    }
    let first = 0;
    for (let index = 1; index < bins; index++) {
      if (smoothed[index] > smoothed[first]) first = index;
    }
    let second = -1;
    let secondValue = 0;
    for (let index = 0; index < bins; index++) {
      const distance = angleDistance(first / bins * Math.PI, index / bins * Math.PI);
      if (distance < Math.PI * 0.24 || distance > Math.PI * 0.48) continue;
      if (smoothed[index] > secondValue) {
        second = index;
        secondValue = smoothed[index];
      }
    }
    return second < 0 ? null : [first / bins * Math.PI, second / bins * Math.PI];
  }

  function buildBundle(segments, peak, minDimension) {
    const normal = { x: -Math.sin(peak), y: Math.cos(peak) };
    const raw = [];
    for (const segment of segments) {
      if (angleDistance(segment.angle, peak) > Math.PI / 12) continue;
      const dx = segment.x2 - segment.x1;
      const dy = segment.y2 - segment.y1;
      const length = Math.sqrt(dx * dx + dy * dy) || 1;
      let a = -dy / length;
      let b = dx / length;
      if (a * normal.x + b * normal.y < 0) {
        a = -a;
        b = -b;
      }
      const rho = a * (segment.x1 + segment.x2) * 0.5 + b * (segment.y1 + segment.y2) * 0.5;
      raw.push({ a, b, rho, length });
    }
    raw.sort((a, b) => a.rho - b.rho);
    const merged = [];
    const tolerance = Math.max(4, minDimension * 0.006);
    for (const line of raw) {
      const previous = merged[merged.length - 1];
      if (previous && Math.abs(previous.rho - line.rho) < tolerance) {
        if (line.length > previous.length) merged[merged.length - 1] = line;
      } else {
        merged.push(line);
      }
    }
    return merged;
  }

  function imageCenterRho(a, b, width, height) {
    return a * (width - 1) * 0.5 + b * (height - 1) * 0.5;
  }

  function fitLattice(bundle, width, height) {
    const minDimension = Math.min(width, height);
    if (bundle.length < 6) return null;
    const minStep = minDimension * 0.028;
    const maxStep = minDimension * 0.105;
    const tolerance = Math.max(3.5, minDimension * 0.010);
    const stepWeights = new Map();

    for (let left = 0; left < bundle.length; left++) {
      for (let right = left + 1; right < bundle.length; right++) {
        const difference = bundle[right].rho - bundle[left].rho;
        for (let gaps = 1; gaps <= 7; gaps++) {
          const step = difference / gaps;
          if (step < minStep || step > maxStep) continue;
          const key = Math.round(step * 2) / 2;
          stepWeights.set(key, (stepWeights.get(key) || 0) + Math.min(bundle[left].length, bundle[right].length));
        }
      }
    }

    const candidateSteps = Array.from(stepWeights.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 18)
      .map(entry => entry[0]);
    let best = null;

    for (const step of candidateSteps) {
      for (const anchor of bundle) {
        for (let anchorIndex = 0; anchorIndex < SIZE; anchorIndex++) {
          const start = anchor.rho - anchorIndex * step;
          const end = start + (SIZE - 1) * step;
          const used = new Set();
          const matchedIndexes = [];
          let residual = 0;
          let lengthSupport = 0;
          let weightedA = 0;
          let weightedB = 0;
          let directionWeight = 0;

          for (let gridIndex = 0; gridIndex < SIZE; gridIndex++) {
            const target = start + gridIndex * step;
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
            const line = bundle[bestLine];
            matchedIndexes.push(gridIndex);
            residual += bestDistance / tolerance;
            lengthSupport += Math.min(1, line.length / (minDimension * 0.42));
            const weight = Math.max(1, line.length) * (1 - bestDistance / tolerance);
            weightedA += line.a * weight;
            weightedB += line.b * weight;
            directionWeight += weight;
          }

          const support = matchedIndexes.length;
          if (support < 7) continue;
          const span = matchedIndexes[support - 1] - matchedIndexes[0];
          if (span < 9 || !directionWeight) continue;
          let a = weightedA / directionWeight;
          let b = weightedB / directionWeight;
          const norm = Math.sqrt(a * a + b * b) || 1;
          a /= norm;
          b /= norm;
          const centerPenalty = Math.min(
            1,
            Math.abs((start + end) * 0.5 - imageCenterRho(a, b, width, height)) / Math.max(step * 3.2, 1)
          );
          const coverage = support / SIZE;
          const score =
            coverage * 0.43 +
            span / (SIZE - 1) * 0.25 +
            (1 - residual / support) * 0.17 +
            lengthSupport / support * 0.12 -
            centerPenalty * 0.14;
          if (!best || score > best.score) {
            best = { start, end, step, score, coverage, a, b };
          }
        }
      }
    }

    if (!best || best.coverage < 0.46 || best.score < 0.46) return null;
    return best;
  }

  function lineSegment(line, width, height) {
    const points = [];
    function add(x, y) {
      if (x < -1 || x > width || y < -1 || y > height) return;
      points.push({ x: clamp(x, 0, width - 1), y: clamp(y, 0, height - 1) });
    }
    if (Math.abs(line.b) > 1e-8) {
      add(0, line.rho / line.b);
      add(width - 1, (line.rho - line.a * (width - 1)) / line.b);
    }
    if (Math.abs(line.a) > 1e-8) {
      add(line.rho / line.a, 0);
      add((line.rho - line.b * (height - 1)) / line.a, height - 1);
    }
    if (points.length < 2) return null;
    let bestPair = [points[0], points[1]];
    let bestDistance = -1;
    for (let first = 0; first < points.length; first++) {
      for (let second = first + 1; second < points.length; second++) {
        const dx = points[first].x - points[second].x;
        const dy = points[first].y - points[second].y;
        const distance = dx * dx + dy * dy;
        if (distance > bestDistance) {
          bestDistance = distance;
          bestPair = [points[first], points[second]];
        }
      }
    }
    return bestPair.flatMap(point => [Math.round(point.x), Math.round(point.y)]);
  }

  function addSyntheticOuterLines(values, width, height) {
    const minDimension = Math.min(width, height);
    const segments = [];
    for (let index = 0; index + 3 < values.length; index += 4) {
      const x1 = values[index];
      const y1 = values[index + 1];
      const x2 = values[index + 2];
      const y2 = values[index + 3];
      const dx = x2 - x1;
      const dy = y2 - y1;
      const length = Math.sqrt(dx * dx + dy * dy);
      if (length < minDimension * 0.07) continue;
      let angle = Math.atan2(dy, dx);
      if (angle < 0) angle += Math.PI;
      if (angle >= Math.PI) angle -= Math.PI;
      segments.push({ x1, y1, x2, y2, length, angle });
    }
    const peaks = orientationPeaks(segments);
    if (!peaks) return values;
    const output = values.slice();
    for (const peak of peaks) {
      const lattice = fitLattice(buildBundle(segments, peak, minDimension), width, height);
      if (!lattice) continue;
      for (const rho of [lattice.start, lattice.end]) {
        const segment = lineSegment({ a: lattice.a, b: lattice.b, rho }, width, height);
        if (segment) output.push(...segment);
      }
    }
    return output;
  }

  function install() {
    const cv = window.cv;
    if (!cv?.HoughLinesP) return false;
    if (cv.HoughLinesP[V2_FLAG]) return true;

    const current = cv.HoughLinesP;
    const original = current.__vcfOriginal || current;
    function patchedHoughLinesP(image, lines, rho, theta, threshold, minLineLength, maxLineGap) {
      original.call(cv, image, lines, rho, theta, threshold, minLineLength, maxLineGap);
      try {
        const originalValues = Array.from(lines.data32S || []);
        const augmented = addSyntheticOuterLines(originalValues, image.cols, image.rows);
        if (augmented.length > originalValues.length) {
          lines.create(augmented.length / 4, 1, cv.CV_32SC4);
          lines.data32S.set(augmented);
        }
      } catch (error) {
        console.warn("VCF 缺邊棋盤晶格推算失敗，沿用原始 Hough 結果。", error);
      }
    }
    patchedHoughLinesP[PATCH_FLAG] = true;
    patchedHoughLinesP[V2_FLAG] = true;
    patchedHoughLinesP.__vcfOriginal = original;
    cv.HoughLinesP = patchedHoughLinesP;
    return true;
  }

  if (!install()) {
    const timer = window.setInterval(() => {
      if (install()) window.clearInterval(timer);
    }, 150);
  }
})();
