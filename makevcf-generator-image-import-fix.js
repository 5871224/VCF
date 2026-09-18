"use strict";

(function installImageImportRuntimeFix() {
  const SIZE = 15;
  const OUTER_MARGIN_CELLS = 0.68;
  const PATCH_FLAG = Symbol.for("vcf.imageImportRuntimeFix");
  const imageDataProcessors = [];
  const houghLineProviders = [];

  window.vcfRegisterImageDataProcessor = (name, processor, priority = 0) => {
    if (!name || typeof processor !== "function") throw new TypeError("圖片處理器需要名稱與函式");
    const entry = { name: String(name), processor, priority: Number(priority) || 0 };
    const index = imageDataProcessors.findIndex(item => item.name === entry.name);
    if (index >= 0) imageDataProcessors[index] = entry;
    else imageDataProcessors.push(entry);
    imageDataProcessors.sort((a, b) => b.priority - a.priority || a.name.localeCompare(b.name));
  };

  window.vcfRegisterHoughLineProvider = (name, provider, priority = 0) => {
    if (!name || typeof provider !== "function") throw new TypeError("Hough 格線提供者需要名稱與函式");
    const entry = { name: String(name), provider, priority: Number(priority) || 0 };
    const index = houghLineProviders.findIndex(item => item.name === entry.name);
    if (index >= 0) houghLineProviders[index] = entry;
    else houghLineProviders.push(entry);
    houghLineProviders.sort((a, b) => b.priority - a.priority || a.name.localeCompare(b.name));
  };

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

  function installImageDataAdapter() {
    const prototype = window.CanvasRenderingContext2D?.prototype;
    if (!prototype || prototype.getImageData[PATCH_FLAG]) return;
    const original = prototype.getImageData;
    function processedGetImageData(...args) {
      let imageData = original.apply(this, args);
      if (this.canvas?.id !== "warped-canvas") return imageData;
      for (const entry of imageDataProcessors) {
        imageData = entry.processor(imageData, { canvas: this.canvas, context: this }) || imageData;
      }
      return imageData;
    }
    processedGetImageData[PATCH_FLAG] = true;
    processedGetImageData.__vcfOriginal = original;
    prototype.getImageData = processedGetImageData;
  }

  window.vcfRegisterImageDataProcessor("numbered-stone-centers", removeCenterText, 100);

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

  window.vcfRegisterHoughLineProvider("permissive-internal-lattice", (values, context) => {
    const { cv, image, original, rho, theta, threshold, minLineLength, maxLineGap } = context;
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
        Math.max(maxLineGap || 0, Math.round(Math.min(image.cols, image.rows) * 0.09)),
      );
      const merged = [...values, ...Array.from(permissive.data32S || [])];
      return augmentHoughValues(merged, image.cols, image.rows);
    } catch (error) {
      console.warn("VCF 內部格線外推失敗，沿用原始 Hough 結果。", error);
      return values;
    } finally {
      permissive?.delete();
    }
  }, 100);

  function installHoughAdapter() {
    const cv = window.cv;
    if (!cv?.HoughLinesP || cv.HoughLinesP[PATCH_FLAG]) return false;
    const original = cv.HoughLinesP;
    function registeredHoughLinesP(image, lines, rho, theta, threshold, minLineLength, maxLineGap) {
      original.call(cv, image, lines, rho, theta, threshold, minLineLength, maxLineGap);
      let values = Array.from(lines.data32S || []);
      const context = {
        cv, image, lines, original, rho, theta, threshold, minLineLength, maxLineGap,
        width: image.cols, height: image.rows,
      };
      for (const entry of houghLineProviders) {
        const next = entry.provider(values, context);
        if (Array.isArray(next)) values = next;
      }
      if (values.length !== (lines.data32S?.length || 0)) {
        lines.create(values.length / 4, 1, cv.CV_32SC4);
        lines.data32S.set(values);
      }
    }
    registeredHoughLinesP[PATCH_FLAG] = true;
    registeredHoughLinesP.__vcfOriginal = original;
    cv.HoughLinesP = registeredHoughLinesP;
    return true;
  }

  function installWhenCvReady(attempt = 0) {
    if (installHoughAdapter() || attempt >= 160) return;
    window.setTimeout(() => installWhenCvReady(attempt + 1), 125);
  }

  installImageDataAdapter();
  installWhenCvReady();
})();

// 缺邊棋盤晶格修正必須在基礎圖片辨識修正之後安裝。
"use strict";

(function installImageImportHoughFixV2() {
  const SIZE = 15;

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

  if (typeof window.vcfRegisterHoughLineProvider === "function") {
    window.vcfRegisterHoughLineProvider("missing-edge-lattice", (values, context) => (
      addSyntheticOuterLines(values, context.width, context.height)
    ), 50);
  }
})();

(function installImageMoveOrderEditor(global) {
  const BOARD_SIZE = 15;
  const BOARD_CELLS = BOARD_SIZE * BOARD_SIZE;
  const BLACK = 1;
  const WHITE = 2;
  const OUTER_MARGIN_CELLS = 0.68;

  const importPanel = document.getElementById("import-panel");
  const importToolbar = document.getElementById("import-toolbar");
  const importCanvases = document.getElementById("import-canvases");
  const sourceCanvas = document.getElementById("source-canvas");
  const applyButton = document.getElementById("btn-import-apply");
  const resetButton = document.getElementById("btn-import-reset");
  const redetectButton = document.getElementById("btn-import-redetect");
  const imageInput = document.getElementById("image-file-input");
  const cameraInput = document.getElementById("camera-file-input");
  if (!importPanel || !importToolbar || !importCanvases || !sourceCanvas || !applyButton) return;

  const state = {
    active: false,
    sourceMode: "recognized",
    currentNumber: 1,
    selectedNumber: 0,
    orderByIndex: new Array(BOARD_CELLS).fill(0),
    board: new Uint8Array(BOARD_CELLS),
  };

  const style = document.createElement("style");
  style.id = "vcf-image-move-order-style";
  style.textContent = `
    .vcf-image-order-canvas-wrap{position:relative;width:100%}
    .vcf-image-order-canvas-wrap>.import-canvas{position:relative;z-index:1}
    #vcf-image-order-overlay{position:absolute;inset:0;width:100%;height:100%;z-index:2;pointer-events:none}
    #vcf-image-order-panel{margin:0 auto 8px;width:min(100%,780px);padding:9px;border:1px solid #d8c48a;border-radius:6px;background:#fffdf5}
    #vcf-image-order-panel[hidden]{display:none}
    .vcf-image-order-controls{display:flex;gap:6px;flex-wrap:wrap;align-items:center;justify-content:center}
    .vcf-image-order-controls label{display:inline-flex;gap:5px;align-items:center;font-size:13px}
    #vcf-image-order-current{width:72px;padding:7px 6px;border:1px solid #aaa;border-radius:4px;text-align:center}
    #vcf-image-order-status{margin:7px 0;font-size:12px;line-height:1.5;text-align:center;color:#65552f}
    #vcf-image-order-status.is-error{color:#a0462a;font-weight:600}
    .vcf-image-order-table-wrap{max-height:230px;overflow:auto;border:1px solid #ddd3b8;border-radius:5px;background:#fff}
    #vcf-image-order-table{width:100%;border-collapse:collapse;font-size:12px}
    #vcf-image-order-table th,#vcf-image-order-table td{padding:5px 7px;border-bottom:1px solid #eee6d2;text-align:center}
    #vcf-image-order-table thead th{position:sticky;top:0;background:#f7efd8;z-index:1}
    #vcf-image-order-table tbody tr{cursor:pointer}
    #vcf-image-order-table tbody tr:hover{background:#eef5ff}
    #vcf-image-order-table tbody tr.is-selected{background:#dcecff;outline:1px solid #6b9bd2}
    #vcf-image-order-table tbody tr.is-missing td:first-child{font-weight:700;color:#b25d00}
    #vcf-image-order-table tbody tr.is-invalid{background:#fff0ef;color:#a3342b}
    @media(max-width:600px){
      #vcf-image-order-panel{padding:7px}
      .vcf-image-order-controls button{padding:7px 9px}
      #vcf-image-order-table th,#vcf-image-order-table td{padding:6px 4px}
    }
  `;
  document.head.appendChild(style);

  const toggleButton = document.createElement("button");
  toggleButton.id = "btn-import-move-order";
  toggleButton.type = "button";
  toggleButton.textContent = "加上手順";
  toggleButton.disabled = true;
  toggleButton.title = "先完成黑白子辨識後，才能加入手順";
  importToolbar.insertBefore(toggleButton, applyButton);

  const panel = document.createElement("div");
  panel.id = "vcf-image-order-panel";
  panel.hidden = true;
  panel.innerHTML = `
    <div class="vcf-image-order-controls">
      <label>目前手順 <input id="vcf-image-order-current" type="number" min="1" max="999" step="1" value="1"></label>
      <button id="vcf-image-order-insert-1" type="button" disabled>插入 1</button>
      <button id="vcf-image-order-insert-2" type="button" disabled>插入 2</button>
      <button id="vcf-image-order-compact" type="button">整理缺號</button>
      <button id="vcf-image-order-clear-selected" type="button" disabled>清除所選</button>
    </div>
    <div id="vcf-image-order-status">先從下表點選要開始的手順，再點預覽中的棋子。</div>
    <div class="vcf-image-order-table-wrap">
      <table id="vcf-image-order-table">
        <thead><tr><th>手順</th><th>狀態</th><th>位置</th></tr></thead>
        <tbody></tbody>
      </table>
    </div>
  `;
  importPanel.insertBefore(panel, importCanvases);

  const currentInput = panel.querySelector("#vcf-image-order-current");
  const insert1Button = panel.querySelector("#vcf-image-order-insert-1");
  const insert2Button = panel.querySelector("#vcf-image-order-insert-2");
  const compactButton = panel.querySelector("#vcf-image-order-compact");
  const clearSelectedButton = panel.querySelector("#vcf-image-order-clear-selected");
  const orderStatus = panel.querySelector("#vcf-image-order-status");
  const tableBody = panel.querySelector("tbody");

  const wrapper = document.createElement("div");
  wrapper.className = "vcf-image-order-canvas-wrap";
  sourceCanvas.parentNode.insertBefore(wrapper, sourceCanvas);
  wrapper.appendChild(sourceCanvas);
  const overlay = document.createElement("canvas");
  overlay.id = "vcf-image-order-overlay";
  wrapper.appendChild(overlay);
  const overlayContext = overlay.getContext("2d");

  function readBoard() {
    const raw = global._getArr?.() || [];
    const board = new Uint8Array(BOARD_CELLS);
    for (let index = 0; index < BOARD_CELLS; index++) {
      const stone = Number(raw[index]);
      board[index] = stone === BLACK || stone === WHITE ? stone : 0;
    }
    return board;
  }

  function stoneCount(board = state.board) {
    let count = 0;
    for (const stone of board) if (stone === BLACK || stone === WHITE) count++;
    return count;
  }

  function coordinateName(index) {
    const x = index % BOARD_SIZE;
    const y = Math.floor(index / BOARD_SIZE);
    return `${String.fromCharCode(65 + x)}${y + 1}`;
  }

  function findIndexForNumber(number) {
    return state.orderByIndex.findIndex(value => value === number);
  }

  function assignedNumbers() {
    const numbers = new Set();
    for (const value of state.orderByIndex) if (value > 0) numbers.add(value);
    return numbers;
  }

  function firstUnassigned(start = 1) {
    const used = assignedNumbers();
    let number = Math.max(1, Math.floor(Number(start) || 1));
    while (used.has(number) && number < 999) number++;
    return number;
  }

  function isNotationMode() {
    return state.sourceMode === "notation";
  }

  function buildNotationBoard() {
    const board = new Uint8Array(BOARD_CELLS);
    for (let index = 0; index < BOARD_CELLS; index++) {
      const number = Number(state.orderByIndex[index]) || 0;
      if (number > 0) board[index] = number % 2 ? BLACK : WHITE;
    }
    return board;
  }

  function refreshNotationBoard() {
    if (isNotationMode()) state.board = buildNotationBoard();
  }

  function pruneAssignments(board = state.board) {
    if (isNotationMode()) return;
    for (let index = 0; index < BOARD_CELLS; index++) {
      if (!board[index]) state.orderByIndex[index] = 0;
    }
  }

  function validate(board = state.board) {
    const workingBoard = isNotationMode() ? buildNotationBoard() : board;
    const total = isNotationMode()
      ? state.orderByIndex.reduce((count, number) => count + (Number(number) > 0 ? 1 : 0), 0)
      : stoneCount(workingBoard);
    const byNumber = new Map();
    let assigned = 0;
    const parityErrors = [];
    const extras = [];
    for (let index = 0; index < BOARD_CELLS; index++) {
      const number = Number(state.orderByIndex[index]) || 0;
      if (!number) continue;
      if (!workingBoard[index]) continue;
      assigned++;
      byNumber.set(number, index);
      if (number > total) extras.push(number);
      const expected = number % 2 ? BLACK : WHITE;
      if (!isNotationMode() && workingBoard[index] !== expected) parityErrors.push(number);
    }
    const missing = [];
    for (let number = 1; number <= total; number++) {
      if (!byNumber.has(number)) missing.push(number);
    }
    const complete = total > 0 && assigned === total && missing.length === 0 && extras.length === 0;
    return {
      total,
      assigned,
      missing,
      extras: Array.from(new Set(extras)).sort((a, b) => a - b),
      parityErrors: Array.from(new Set(parityErrors)).sort((a, b) => a - b),
      valid: complete && parityErrors.length === 0,
    };
  }

  function buildExactHistory(board = readBoard()) {
    const workingBoard = isNotationMode() ? buildNotationBoard() : board;
    pruneAssignments(workingBoard);
    const result = validate(workingBoard);
    if (!result.valid) return null;
    const history = [];
    for (let number = 1; number <= result.total; number++) {
      const index = findIndexForNumber(number);
      if (index < 0) return null;
      history.push({ index, stone: workingBoard[index] });
    }
    return history;
  }

  function renderOverlay() {
    if (overlay.width !== sourceCanvas.width) overlay.width = sourceCanvas.width;
    if (overlay.height !== sourceCanvas.height) overlay.height = sourceCanvas.height;
    overlayContext.clearRect(0, 0, overlay.width, overlay.height);
    if (!state.active) return;
    const denominator = (BOARD_SIZE - 1) + OUTER_MARGIN_CELLS * 2;
    const stepX = overlay.width / denominator;
    const stepY = overlay.height / denominator;
    const marginX = stepX * OUTER_MARGIN_CELLS;
    const marginY = stepY * OUTER_MARGIN_CELLS;
    const radius = Math.max(9, Math.min(stepX, stepY) * 0.22);
    const fontSize = Math.max(11, Math.min(stepX, stepY) * 0.30);
    overlayContext.textAlign = "center";
    overlayContext.textBaseline = "middle";
    overlayContext.font = `700 ${fontSize}px system-ui, sans-serif`;

    for (let index = 0; index < BOARD_CELLS; index++) {
      const number = state.orderByIndex[index];
      if (!number) continue;
      const x = marginX + (index % BOARD_SIZE) * stepX;
      const y = marginY + Math.floor(index / BOARD_SIZE) * stepY;
      const expected = number % 2 ? BLACK : WHITE;
      const invalid = !isNotationMode() && state.board[index] && state.board[index] !== expected;
      overlayContext.beginPath();
      overlayContext.arc(x, y, radius, 0, Math.PI * 2);
      overlayContext.fillStyle = invalid ? "rgba(205,45,45,.94)" : "rgba(25,115,210,.94)";
      overlayContext.fill();
      overlayContext.lineWidth = Math.max(1.5, radius * 0.14);
      overlayContext.strokeStyle = number === state.selectedNumber ? "rgba(40,190,80,.98)" : "rgba(255,255,255,.94)";
      overlayContext.stroke();
      overlayContext.fillStyle = "#fff";
      overlayContext.fillText(String(number), x, y + 0.5);
    }
  }

  function statusText() {
    const result = validate();
    const parts = [isNotationMode() ? `已標 ${result.assigned} 手` : `已標 ${result.assigned}/${result.total}`];
    if (result.missing.length) parts.push(`缺號：${result.missing.slice(0, 12).join("、")}${result.missing.length > 12 ? "…" : ""}`);
    if (result.extras.length) parts.push(`超出棋子數：${result.extras.slice(0, 8).join("、")}`);
    if (result.parityErrors.length) parts.push(`黑白奇偶不符：${result.parityErrors.slice(0, 12).join("、")}${result.parityErrors.length > 12 ? "…" : ""}`);
    if (result.valid) return { text: `手順完整，共 ${result.total} 手；可按「套用到棋盤」建立正式棋譜手順。`, error: false };
    return { text: parts.join("；"), error: result.parityErrors.length > 0 || result.extras.length > 0 };
  }

  function renderTable() {
    const maxAssigned = Math.max(0, ...state.orderByIndex);
    const maxNumber = Math.max(100, stoneCount(), maxAssigned, Number(state.currentNumber) || 1);
    const fragment = document.createDocumentFragment();
    tableBody.replaceChildren();
    for (let number = 1; number <= Math.min(999, maxNumber); number++) {
      const index = findIndexForNumber(number);
      const row = document.createElement("tr");
      row.dataset.number = String(number);
      if (number === state.selectedNumber) row.classList.add("is-selected");
      if (index < 0) row.classList.add("is-missing");
      let status = "未標記";
      let position = "—";
      if (index >= 0) {
        position = coordinateName(index);
        const expected = number % 2 ? BLACK : WHITE;
        if (state.board[index] !== expected) {
          row.classList.add("is-invalid");
          status = `已標記（應為${expected === BLACK ? "黑" : "白"}）`;
        } else {
          status = `已標記（${state.board[index] === BLACK ? "黑" : "白"}）`;
        }
      }
      row.innerHTML = `<td>${number}</td><td>${status}</td><td>${position}</td>`;
      row.addEventListener("click", () => {
        state.selectedNumber = number;
        state.currentNumber = number;
        currentInput.value = String(number);
        renderAll();
      });
      fragment.appendChild(row);
    }
    tableBody.appendChild(fragment);
  }

  function renderAll() {
    refreshNotationBoard();
    panel.dataset.sourceMode = state.sourceMode;
    currentInput.value = String(state.currentNumber);
    const hasSelection = state.selectedNumber > 0;
    insert1Button.disabled = !hasSelection;
    insert2Button.disabled = !hasSelection;
    clearSelectedButton.disabled = !hasSelection || findIndexForNumber(state.selectedNumber) < 0;
    const validation = validate();
    if (isNotationMode()) applyButton.disabled = !validation.valid;
    const status = statusText();
    orderStatus.textContent = status.text;
    orderStatus.classList.toggle("is-error", status.error);
    renderTable();
    renderOverlay();
  }

  function clearOrders() {
    state.orderByIndex.fill(0);
    state.sourceMode = "recognized";
    state.currentNumber = 1;
    state.selectedNumber = 0;
    state.board = new Uint8Array(BOARD_CELLS);
    state.active = false;
    panel.dataset.sourceMode = state.sourceMode;
    panel.hidden = true;
    toggleButton.textContent = "加上手順";
    toggleButton.title = "先完成黑白子辨識後，才能加入手順";
    renderOverlay();
  }

  function stopOrderMode() {
    state.active = false;
    panel.hidden = true;
    toggleButton.textContent = "加上手順";
    renderOverlay();
  }

  function startRecognizedOrderMode() {
    if (applyButton.hidden) return;
    state.sourceMode = "recognized";
    panel.dataset.sourceMode = state.sourceMode;
    toggleButton.title = "在已辨識的黑白棋子上加入手順";
    applyButton.click();
    state.board = readBoard();
    pruneAssignments(state.board);
    if (!stoneCount(state.board)) return;
    state.active = true;
    panel.hidden = false;
    toggleButton.textContent = "結束手順";
    state.currentNumber = firstUnassigned(1);
    state.selectedNumber = 0;
    renderAll();
  }

  function startNotationPaperMode({ reset = true } = {}) {
    if (applyButton.hidden) return false;
    state.sourceMode = "notation";
    panel.dataset.sourceMode = state.sourceMode;
    if (reset) state.orderByIndex.fill(0);
    state.board = buildNotationBoard();
    state.active = true;
    panel.hidden = false;
    toggleButton.textContent = "結束手順";
    toggleButton.disabled = false;
    toggleButton.title = "記譜紙模式：可在任意交點標記手順";
    state.currentNumber = firstUnassigned(1);
    state.selectedNumber = 0;
    renderAll();
    return true;
  }

  function startOrderMode() {
    if (isNotationMode()) startNotationPaperMode({ reset: false });
    else startRecognizedOrderMode();
  }

  function syncAvailability() {
    const ready = !applyButton.hidden;
    toggleButton.disabled = !ready;
    if (!ready && state.active) stopOrderMode();
  }

  function eventToBoardIndex(event) {
    const rect = sourceCanvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return -1;
    const x = (event.clientX - rect.left) * sourceCanvas.width / rect.width;
    const y = (event.clientY - rect.top) * sourceCanvas.height / rect.height;
    const denominator = (BOARD_SIZE - 1) + OUTER_MARGIN_CELLS * 2;
    const stepX = sourceCanvas.width / denominator;
    const stepY = sourceCanvas.height / denominator;
    const marginX = stepX * OUTER_MARGIN_CELLS;
    const marginY = stepY * OUTER_MARGIN_CELLS;
    const column = Math.round((x - marginX) / stepX);
    const row = Math.round((y - marginY) / stepY);
    if (column < 0 || column >= BOARD_SIZE || row < 0 || row >= BOARD_SIZE) return -1;
    const centerX = marginX + column * stepX;
    const centerY = marginY + row * stepY;
    if (Math.abs(x - centerX) > stepX * 0.48 || Math.abs(y - centerY) > stepY * 0.48) return -1;
    return row * BOARD_SIZE + column;
  }

  function assignCurrentNumber(index) {
    if (!isNotationMode() && !state.board[index]) {
      orderStatus.textContent = "此交點不是已辨識的黑／白棋子，不能加入手順。";
      orderStatus.classList.add("is-error");
      return;
    }
    const number = Math.max(1, Math.min(999, Math.floor(Number(state.currentNumber) || 1)));
    for (let other = 0; other < BOARD_CELLS; other++) {
      if (other !== index && state.orderByIndex[other] === number) {
        state.orderByIndex[other] = 0;
        if (isNotationMode()) state.board[other] = 0;
      }
    }
    state.orderByIndex[index] = number;
    if (isNotationMode()) state.board[index] = number % 2 ? BLACK : WHITE;
    state.selectedNumber = number;
    state.currentNumber = firstUnassigned(number + 1);
    renderAll();
  }

  function insertAtSelection(amount) {
    const target = state.selectedNumber;
    if (!target) return;
    const entries = [];
    for (let index = 0; index < BOARD_CELLS; index++) {
      const number = state.orderByIndex[index];
      if (number >= target) entries.push({ index, number });
    }
    entries.sort((a, b) => b.number - a.number);
    for (const entry of entries) state.orderByIndex[entry.index] = entry.number + amount;
    refreshNotationBoard();
    state.currentNumber = target;
    currentInput.value = String(target);
    renderAll();
    if (amount === 1 && !isNotationMode()) {
      orderStatus.textContent += "；已插入 1 手，後續黑白奇偶會交換，需繼續校正。";
      orderStatus.classList.add("is-error");
    }
  }

  function compactMissingNumbers() {
    const entries = [];
    for (let index = 0; index < BOARD_CELLS; index++) {
      const number = state.orderByIndex[index];
      if (number > 0) entries.push({ index, number });
    }
    entries.sort((a, b) => a.number - b.number || a.index - b.index);
    state.orderByIndex.fill(0);
    entries.forEach((entry, offset) => { state.orderByIndex[entry.index] = offset + 1; });
    refreshNotationBoard();
    state.selectedNumber = 0;
    state.currentNumber = firstUnassigned(1);
    renderAll();
  }

  toggleButton.addEventListener("click", () => {
    if (state.active) stopOrderMode();
    else startOrderMode();
  });

  currentInput.addEventListener("change", () => {
    state.currentNumber = Math.max(1, Math.min(999, Math.floor(Number(currentInput.value) || 1)));
    currentInput.value = String(state.currentNumber);
    renderAll();
  });

  insert1Button.addEventListener("click", () => insertAtSelection(1));
  insert2Button.addEventListener("click", () => insertAtSelection(2));
  compactButton.addEventListener("click", compactMissingNumbers);
  clearSelectedButton.addEventListener("click", () => {
    const index = findIndexForNumber(state.selectedNumber);
    if (index >= 0) {
      state.orderByIndex[index] = 0;
      if (isNotationMode()) state.board[index] = 0;
    }
    state.currentNumber = state.selectedNumber || state.currentNumber;
    renderAll();
  });

  sourceCanvas.addEventListener("pointerup", event => {
    if (!state.active) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const index = eventToBoardIndex(event);
    if (index >= 0) assignCurrentNumber(index);
  }, true);

  function applyNotationToWorkbench() {
    refreshNotationBoard();
    const history = buildExactHistory(state.board);
    if (!history) {
      orderStatus.textContent = "手順尚未連續完整，請先補齊缺號後再套用到棋盤。";
      orderStatus.classList.add("is-error");
      return false;
    }
    const nextColor = history.length % 2 === 0 ? BLACK : WHITE;
    global._setBoardArr?.(Array.from(state.board), nextColor);
    if (global.VCFWorkbenchRecord?.setHistory) {
      global.VCFWorkbenchRecord.setHistory(history, true);
    }
    orderStatus.textContent = `已將記譜紙手順套用到棋盤，共 ${history.length} 手。`;
    orderStatus.classList.remove("is-error");
    return true;
  }

  applyButton.addEventListener("click", event => {
    if (!isNotationMode()) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    applyNotationToWorkbench();
    if (state.active) renderAll();
  }, true);

  applyButton.addEventListener("click", () => {
    if (isNotationMode()) return;
    queueMicrotask(() => {
      const board = readBoard();
      state.board = board;
      pruneAssignments(board);
      const history = buildExactHistory(board);
      if (history && global.VCFWorkbenchRecord?.setHistory) {
        global.VCFWorkbenchRecord.setHistory(history, true);
      }
      if (state.active) renderAll();
    });
  });

  resetButton?.addEventListener("click", clearOrders);
  redetectButton?.addEventListener("click", clearOrders);
  imageInput?.addEventListener("change", clearOrders);
  cameraInput?.addEventListener("change", clearOrders);
  document.addEventListener("paste", event => {
    const hasImage = Array.from(event.clipboardData?.items || []).some(item => item.type.startsWith("image/"));
    if (hasImage) clearOrders();
  });
  global.addEventListener("resize", () => renderOverlay());

  global.VCFImageMoveOrder = {
    startNotationPaperMode: () => startNotationPaperMode({ reset: true }),
    reset: clearOrders,
    isNotationMode,
  };

  const availabilityObserver = new MutationObserver(syncAvailability);
  availabilityObserver.observe(applyButton, { attributes: true, attributeFilter: ["hidden"] });
  syncAvailability();
  renderOverlay();
})(typeof window !== "undefined" ? window : globalThis);
