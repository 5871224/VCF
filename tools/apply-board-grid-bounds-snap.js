const fs = require('fs');

function replaceOnce(text, search, replacement, label) {
  const count = text.split(search).length - 1;
  if (count !== 1) throw new Error(`${label}: expected exactly one match, found ${count}`);
  return text.replace(search, replacement);
}

const htmlPath = 'makevcf.html';
let html = fs.readFileSync(htmlPath, 'utf8');

if (!html.includes('function snapCandidateToGridBounds(')) {
  const marker = '  function refineBoardCandidate(gray, initial) {';
  const insertion = `  function snapCandidateToGridBounds(gray, initial, workSize = 420) {
    if (!initial || !initial.quad) return initial;
    let srcPts = null, dstPts = null, matrix = null, warped = null, blurred = null, edge = null;
    try {
      const ordered = orderCorners(initial.quad);
      srcPts = cv.matFromArray(4, 1, cv.CV_32FC2, ordered.flatMap(p => [p.x, p.y]));
      dstPts = cv.matFromArray(4, 1, cv.CV_32FC2, [0, 0, workSize - 1, 0, workSize - 1, workSize - 1, 0, workSize - 1]);
      matrix = cv.getPerspectiveTransform(srcPts, dstPts);
      warped = new cv.Mat();
      blurred = new cv.Mat();
      edge = new cv.Mat();
      cv.warpPerspective(gray, warped, matrix, new cv.Size(workSize, workSize), cv.INTER_LINEAR, cv.BORDER_REPLICATE);
      cv.GaussianBlur(warped, blurred, new cv.Size(3, 3), 0);
      cv.Canny(blurred, edge, 28, 100);

      const data = edge.data;
      const axisMargin = Math.max(7, Math.round(workSize * 0.035));
      const sampleRadius = Math.max(2, Math.round(workSize / 210));
      const blockCount = SIZE - 1;

      function buildProjection(vertical) {
        const raw = new Float64Array(workSize);
        const from = axisMargin;
        const to = workSize - 1 - axisMargin;
        const span = Math.max(1, to - from + 1);
        for (let fixed = 0; fixed < workSize; fixed++) {
          let hits = 0;
          let liveBlocks = 0;
          const blockHits = new Uint16Array(blockCount);
          for (let variable = from; variable <= to; variable++) {
            let found = false;
            for (let side = -1; side <= 1; side++) {
              const x = vertical ? clamp(fixed + side, 0, workSize - 1) : variable;
              const y = vertical ? variable : clamp(fixed + side, 0, workSize - 1);
              if (data[y * workSize + x]) { found = true; break; }
            }
            if (!found) continue;
            hits++;
            const block = clamp(Math.floor(((variable - from) / span) * blockCount), 0, blockCount - 1);
            blockHits[block]++;
          }
          const minBlockHits = Math.max(1, Math.floor(span / blockCount * 0.025));
          for (const count of blockHits) if (count >= minBlockHits) liveBlocks++;
          raw[fixed] = (hits / span) * 0.72 + (liveBlocks / blockCount) * 0.28;
        }

        const smooth = new Float64Array(workSize);
        for (let i = 0; i < workSize; i++) {
          let sum = 0, weight = 0;
          for (let d = -2; d <= 2; d++) {
            const p = clamp(i + d, 0, workSize - 1);
            const w = 3 - Math.abs(d);
            sum += raw[p] * w;
            weight += w;
          }
          smooth[i] = sum / weight;
        }
        const sorted = Array.from(smooth).sort((a, b) => a - b);
        const baseline = sorted[Math.floor(sorted.length * 0.42)] || 0;
        const high = sorted[Math.floor(sorted.length * 0.94)] || baseline + 0.001;
        const scale = Math.max(0.001, high - baseline);
        for (let i = 0; i < smooth.length; i++) smooth[i] = clamp01((smooth[i] - baseline) / scale);
        return smooth;
      }

      function fitFifteenLines(projection) {
        function sampleAt(position) {
          let best = 0;
          const center = Math.round(position);
          for (let d = -sampleRadius; d <= sampleRadius; d++) {
            best = Math.max(best, projection[clamp(center + d, 0, workSize - 1)]);
          }
          return best;
        }

        const maxInset = Math.round(workSize * 0.18);
        const minSpan = workSize * 0.70;
        let best = null;
        for (let start = 0; start <= maxInset; start++) {
          for (let end = workSize - 1 - maxInset; end < workSize; end++) {
            const span = end - start;
            if (span < minSpan) continue;
            const step = span / (SIZE - 1);
            if (step < workSize / 21 || step > workSize / 10) continue;

            const lineScores = [];
            const midpointScores = [];
            for (let i = 0; i < SIZE; i++) lineScores.push(sampleAt(start + i * step));
            for (let i = 0; i < SIZE - 1; i++) midpointScores.push(sampleAt(start + (i + 0.5) * step));
            const sortedLines = lineScores.slice().sort((a, b) => a - b);
            const meanLine = lineScores.reduce((a, b) => a + b, 0) / SIZE;
            const lowerQuartile = sortedLines[Math.floor(SIZE * 0.25)];
            const coverage = lineScores.filter(value => value >= 0.26).length / SIZE;
            const meanMidpoint = midpointScores.reduce((a, b) => a + b, 0) / (SIZE - 1);
            const spanRatio = span / (workSize - 1);
            const score = meanLine * 0.46 + lowerQuartile * 0.26 + coverage * 0.20 - meanMidpoint * 0.24 + spanRatio * 0.035;
            if (!best || score > best.score) {
              best = { start, end, step, score, coverage, meanLine, meanMidpoint };
            }
          }
        }
        return best;
      }

      const xFit = fitFifteenLines(buildProjection(true));
      const yFit = fitFifteenLines(buildProjection(false));
      if (!xFit || !yFit) return initial;

      const limit = workSize - 1;
      const u0 = xFit.start / limit;
      const u1 = xFit.end / limit;
      const v0 = yFit.start / limit;
      const v1 = yFit.end / limit;
      const totalInset = u0 + (1 - u1) + v0 + (1 - v1);
      if (totalInset < 0.012) return initial;

      const snappedQuad = orderCorners([
        mapUnitSquareToQuad(u0, v0, ordered),
        mapUnitSquareToQuad(u1, v0, ordered),
        mapUnitSquareToQuad(u1, v1, ordered),
        mapUnitSquareToQuad(u0, v1, ordered),
      ]);
      if (!isUsableQuad(snappedQuad, gray.cols, gray.rows)) return initial;

      const metrics = scoreBoardCandidate(gray, snappedQuad);
      const fitCoverage = (xFit.coverage + yFit.coverage) * 0.5;
      const fitScore = (xFit.score + yFit.score) * 0.5;
      const scoreImproved = metrics.score > initial.score + 0.010;
      const coverageImproved = metrics.coverage > initial.coverage + 0.045;
      const credibleFit = fitCoverage >= 0.70 && fitScore >= 0.20;
      const notMateriallyWorse = metrics.score >= initial.score - 0.018 && metrics.coverage >= initial.coverage - 0.035;
      if (!credibleFit || (!scoreImproved && !coverageImproved && !(totalInset >= 0.045 && notMateriallyWorse))) return initial;

      return {
        ...initial,
        ...metrics,
        quad: snappedQuad,
        method: initial.method.includes('格線邊界校正') ? initial.method : initial.method + '＋格線邊界校正',
        gridBounds: { left: u0, right: u1, top: v0, bottom: v1, fitCoverage, fitScore },
      };
    } catch (e) {
      console.warn('格線邊界校正失敗', e);
      return initial;
    } finally {
      if (srcPts) srcPts.delete();
      if (dstPts) dstPts.delete();
      if (matrix) matrix.delete();
      if (warped) warped.delete();
      if (blurred) blurred.delete();
      if (edge) edge.delete();
    }
  }

`;
  html = replaceOnce(html, marker, insertion + marker, 'insert snapCandidateToGridBounds');
}

const refineOld = `    let best = { ...initial, quad: orderCorners(initial.quad) };

    for (const ratio of [-0.035, -0.018, 0.018, 0.035, 0.055]) {`;
const refineNew = `    let best = { ...initial, quad: orderCorners(initial.quad) };
    best = snapCandidateToGridBounds(gray, best) || best;

    for (const ratio of [-0.035, -0.018, 0.018, 0.035, 0.055]) {`;
if (!html.includes('best = snapCandidateToGridBounds(gray, best) || best;')) {
  html = replaceOnce(html, refineOld, refineNew, 'wire grid boundary snap');
}

fs.writeFileSync(htmlPath, html);

const specPath = '規格書.MD';
let spec = fs.readFileSync(specPath, 'utf8');
const specNeedle = '- 所有候選都先透視校正成小型正方形，再比較預期 15 條橫線與 15 條直線所在位置和半格偏移位置的邊緣強度。';
const specAddition = `${specNeedle}\n- 候選四角可能是木板、棋盤底色或裝飾外框；候選通過後必須在校正圖內重新搜尋兩軸各 15 條等距格線的實際起點與終點，將四角吸附到第一條及第十五條格線。`;
if (!spec.includes('將四角吸附到第一條及第十五條格線')) {
  spec = replaceOnce(spec, specNeedle, specAddition, 'update board import specification');
}
fs.writeFileSync(specPath, spec);

const readmePath = 'README.md';
let readme = fs.readFileSync(readmePath, 'utf8');
const readmeOld = '- 圖片、截圖與手機相機棋盤匯入，採輪廓、Hough 格線與 15 路模板驗證。';
const readmeNew = '- 圖片、截圖與手機相機棋盤匯入，採輪廓、Hough 格線、15 路模板驗證與格線邊界吸附。';
if (!readme.includes(readmeNew)) readme = replaceOnce(readme, readmeOld, readmeNew, 'update README');
fs.writeFileSync(readmePath, readme);
