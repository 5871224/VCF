"use strict";

(function installImageImportRuntimeFix() {
  const SIZE = 15;
  const OUTER_MARGIN_CELLS = 0.68;
  const PATCH_FLAG = Symbol.for("vcf.imageImportRuntimeFix");

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function median(values) {
    if (!values.length) return 0;
    const sorted = values.slice().sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2
      ? sorted[middle]
      : (sorted[middle - 1] + sorted[middle]) * 0.5;
  }

  function angleDistance(a, b) {
    let distance = Math.abs(a - b) % Math.PI;
    if (distance > Math.PI / 2) distance = Math.PI - distance;
    return distance;
  }

  function pixelIndex(width, height, x, y) {
    const px = clamp(Math.round(x), 0, width - 1);
    const py = clamp(Math.round(y), 0, height - 1);
    return (py * width + px) * 4;
  }

  function luminanceAt(data, width, height, x, y) {
    const index = pixelIndex(width, height, x, y);
    return data[index] * 0.299 + data[index + 1] * 0.587 + data[index + 2] * 0.114;
  }

  function sampleRing(data, width, height, cx, cy, radii, samples = 64) {
    const luminances = [];
    const red = [];
    const green = [];
    const blue = [];
    for (const radius of radii) {
      for (let index = 0; index < samples; index++) {
        const angle = index / samples * Math.PI * 2;
        const x = cx + Math.cos(angle) * radius;
        const y = cy + Math.sin(angle) * radius;
        const pixel = pixelIndex(width, height, x, y);
        red.push(data[pixel]);
        green.push(data[pixel + 1]);
        blue.push(data[pixel + 2]);
        luminances.push(data[pixel] * 0.299 + data[pixel + 1] * 0.587 + data[pixel + 2] * 0.114);
      }
    }
    return {
      luminance: median(luminances),
      red: median(red),
      green: median(green),
      blue: median(blue),
      values: luminances,
    };
  }

  function analyzeStoneAt(data, width, height, cx, cy, step) {
    const body = sampleRing(data, width, height, cx, cy, [step * 0.22, step * 0.28, step * 0.34], 72);
    const outside = sampleRing(data, width, height, cx, cy, [step * 0.54, step * 0.61, step * 0.68], 72);
    let darkOutlineHits = 0;
    let radialHits = 0;
    const samples = 72;
    for (let index = 0; index < samples; index++) {
      const angle = index / samples * Math.PI * 2;
      const cosine = Math.cos(angle);
      const sine = Math.sin(angle);
      const inner = luminanceAt(data, width, height, cx + cosine * step * 0.33, cy + sine * step * 0.33);
      const rim = Math.min(
        luminanceAt(data, width, height, cx + cosine * step * 0.40, cy + sine * step * 0.40),
        luminanceAt(data, width, height, cx + cosine * step * 0.44, cy + sine * step * 0.44)
      );
      const outer = luminanceAt(data, width, height, cx + cosine * step * 0.59, cy + sine * step * 0.59);
      if (Math.min(inner, outer) - rim >= 7) darkOutlineHits++;
      if (Math.abs(outer - inner) >= 12) radialHits++;
    }
    const contrast = body.luminance - outside.luminance;
    const darkOutlineCoverage = darkOutlineHits / samples;
    const radialCoverage = radialHits / samples;
    const filledStone = Math.abs(contrast) >= 22 && radialCoverage >= 0.38;
    const outlinedWhiteStone =
      darkOutlineCoverage >= 0.50 &&
      body.luminance >= outside.luminance - 10;
    return {
      occupied: filledStone || outlinedWhiteStone,
      color: contrast < -10 ? 1 : 2,
      contrast,
      darkOutlineCoverage,
      radialCoverage,
      fill: [body.red, body.green, body.blue],
      bodyLuminance: body.luminance,
    };
  }

  function removeCenterText(imageData) {
    const { data, width, height } = imageData;
    if (width < 300 || height < 300) return imageData;
    const step = (Math.min(width, height) - 1) / (SIZE - 1 + OUTER_MARGIN_CELLS * 2);
    const marginX = (width - step * (SIZE - 1)) * 0.5;
    const marginY = (height - step * (SIZE - 1)) * 0.5;

    for (let row = 0; row < SIZE; row++) {
      for (let column = 0; column < SIZE; column++) {
        const cx = marginX + column * step;
        const cy = marginY + row * step;
        const stone = analyzeStoneAt(data, width, height, cx, cy, step);
        if (!stone.occupied) continue;
        const radius = step * 0.31;
        const coreRadius = step * 0.19;
        const x0 = Math.max(0, Math.floor(cx - radius));
        const x1 = Math.min(width - 1, Math.ceil(cx + radius));
        const y0 = Math.max(0, Math.floor(cy - radius));
        const y1 = Math.min(height - 1, Math.ceil(cy + radius));
        for (let y = y0; y <= y1; y++) {
          for (let x = x0; x <= x1; x++) {
            const dx = x - cx;
            const dy = y - cy;
            const distance = Math.sqrt(dx * dx + dy * dy);
            if (distance > radius) continue;
            const index = (y * width + x) * 4;
            const pixelLuminance = data[index] * 0.299 + data[index + 1] * 0.587 + data[index + 2] * 0.114;
            const isOppositeInk = stone.color === 1
              ? pixelLuminance >= stone.bodyLuminance + 34
              : pixelLuminance <= stone.bodyLuminance - 34;
            if (distance <= coreRadius || isOppositeInk) {
              data[index] = stone.fill[0];
              data[index + 1] = stone.fill[1];
              data[index + 2] = stone.fill[2];
              data[index + 3] = 255;
            }
          }
        }
      }
    }
    return imageData;
  }

  function installImageDataPatch() {
    const prototype = window.CanvasRenderingContext2D?.prototype;
    if (!prototype || prototype.getImageData[PATCH_FLAG]) return;
    const original = prototype.getImageData;
    let lastWarpCall = 0;
    let warpCallSequence = 0;

    function patchedGetImageData(...args) {
      const imageData = original.apply(this, args);
      if (this.canvas?.id !== "warped-canvas") return imageData;
      const stack = new Error().stack || "";
      const now = performance.now();
      if (now - lastWarpCall > 450) warpCallSequence = 0;
      lastWarpCall = now;
      warpCallSequence++;
      const directRecognitionCall = stack.includes("recognizeBoard") && !stack.includes("refineWarpedIntersections");
      const fallbackRecognitionCall = warpCallSequence % 2 === 0;
      return directRecognitionCall || fallbackRecognitionCall
        ? removeCenterText(imageData)
        : imageData;
    }

    patchedGetImageData[PATCH_FLAG] = true;
    patchedGetImageData.__vcfOriginal = original;
    prototype.getImageData = patchedGetImageData;
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
    for (let index = 1; index < bins; index++) if (smoothed[index] > smoothed[first]) first = index;
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

  function fitLattice(bundle, minDimension) {
    if (bundle.length < 6) return null;
    const minStep = minDimension * 0.028;
    const maxStep = minDimension * 0.105;
    const tolerance = Math.max(3.5, minDimension * 0.010);
    const observedCenter = (bundle[0].rho + bundle[bundle.length - 1].rho) * 0.5;
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
    const steps = Array.from(stepWeights.entries()).sort((a, b) => b[1] - a[1]).slice(0, 18).map(entry => entry[0]);
    let best = null;
    for (const step of steps) {
      for (const anchor of bundle) {
        for (let anchorIndex = 0; anchorIndex < SIZE; anchorIndex++) {
          const start = anchor.rho - anchorIndex * step;
          const used = new Set();
          const indexes = [];
          let residual = 0;
          let lengthSupport = 0;
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
            indexes.push(gridIndex);
            residual += bestDistance / tolerance;
            lengthSupport += Math.min(1, bundle[bestLine].length / (minDimension * 0.42));
          }
          if (indexes.length < 7) continue;
          const span = indexes[indexes.length - 1] - indexes[0];
          if (span < 9) continue;
          const end = start + (SIZE - 1) * step;
          const coverage = indexes.length / SIZE;
          const centerPenalty = Math.min(1, Math.abs((start + end) * 0.5 - observedCenter) / Math.max(step * 3, 1));
          const score = coverage * 0.45 + span / (SIZE - 1) * 0.26 + (1 - residual / indexes.length) * 0.17 + lengthSupport / indexes.length * 0.12 - centerPenalty * 0.10;
          if (!best || score > best.score) best = { start, end, step, score, coverage };
        }
      }
    }
    if (!best || best.coverage < 0.46 || best.score < 0.48) return null;
    let a = 0;
    let b = 0;
    let weight = 0;
    for (const line of bundle) {
      a += line.a * line.length;
      b += line.b * line.length;
      weight += line.length;
    }
    const norm = Math.sqrt(a * a + b * b) || 1;
    return {
      a: a / norm,
      b: b / norm,
      lowRho: best.start,
      highRho: best.end,
    };
  }

  function lineSegment(line, width, height) {
    const points = [];
    function add(x, y) {
      if (x >= -1 && x <= width && y >= -1 && y <= height) points.push({ x: clamp(x, 0, width - 1), y: clamp(y, 0, height - 1) });
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
    let best = [points[0], points[1]];
    let bestDistance = -1;
    for (let first = 0; first < points.length; first++) {
      for (let second = first + 1; second < points.length; second++) {
        const dx = points[first].x - points[second].x;
        const dy = points[first].y - points[second].y;
        const distance = dx * dx + dy * dy;
        if (distance > bestDistance) {
          bestDistance = distance;
          best = [points[first], points[second]];
        }
      }
    }
    return [Math.round(best[0].x), Math.round(best[0].y), Math.round(best[1].x), Math.round(best[1].y)];
  }

  function augmentHoughValues(values, width, height) {
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
      const bundle = buildBundle(segments, peak, minDimension);
      const lattice = fitLattice(bundle, minDimension);
      if (!lattice) continue;
      for (const rho of [lattice.lowRho, lattice.highRho]) {
        const segment = lineSegment({ a: lattice.a, b: lattice.b, rho }, width, height);
        if (segment) output.push(...segment);
      }
    }
    return output;
  }

  function installCvPatch() {
    const cv = window.cv;
    if (!cv?.HoughLinesP || cv.HoughLinesP[PATCH_FLAG]) return false;
    const original = cv.HoughLinesP;
    function patchedHoughLinesP(image, lines, rho, theta, threshold, minLineLength, maxLineGap) {
      original.call(cv, image, lines, rho, theta, threshold, minLineLength, maxLineGap);
      let permissive = null;
      try {
        permissive = new cv.Mat();
        original.call(
          cv,
          image,
          permissive,
          rho,
          theta,
          Math.max(18, Math.round(threshold * 0.62)),
          Math.max(24, Math.round(minLineLength * 0.45)),
          Math.max(maxLineGap || 0, Math.round(Math.min(image.cols, image.rows) * 0.09))
        );
        const merged = [...Array.from(lines.data32S || []), ...Array.from(permissive.data32S || [])];
        const augmented = augmentHoughValues(merged, image.cols, image.rows);
        if (augmented.length > merged.length) {
          lines.create(augmented.length / 4, 1, cv.CV_32SC4);
          lines.data32S.set(augmented);
        } else if (merged.length > (lines.data32S?.length || 0)) {
          lines.create(merged.length / 4, 1, cv.CV_32SC4);
          lines.data32S.set(merged);
        }
      } catch (error) {
        console.warn("VCF 內部格線外推失敗，沿用原始 Hough 結果。", error);
      } finally {
        if (permissive) permissive.delete();
      }
    }
    patchedHoughLinesP[PATCH_FLAG] = true;
    patchedHoughLinesP.__vcfOriginal = original;
    cv.HoughLinesP = patchedHoughLinesP;
    return true;
  }

  installImageDataPatch();
  if (!installCvPatch()) {
    const timer = window.setInterval(() => {
      if (installCvPatch()) window.clearInterval(timer);
    }, 120);
    window.setTimeout(() => window.clearInterval(timer), 20000);
  }
})();
