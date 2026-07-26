const fs = require('fs');
let html = fs.readFileSync('makevcf.html', 'utf8');

function replaceFunction(text, startToken, endToken, replacement) {
  const start = text.indexOf(startToken);
  const end = text.indexOf(endToken, start + startToken.length);
  if (start < 0 || end < 0) throw new Error('periodic-grid function boundary not found');
  return text.slice(0, start) + replacement + text.slice(end);
}

const replacement = `  function fitPeriodicGridBundle(bundle, width, height) {
    const minDimension = Math.min(width, height);
    const lines = bundle.filter(line => line.length >= minDimension * 0.08);
    if (lines.length < 6) return null;
    const minSpacing = minDimension * 0.028;
    const maxSpacing = minDimension * 0.105;
    let referenceA = 0, referenceB = 0, referenceWeight = 0;
    for (const line of lines) {
      referenceA += line.a * line.length;
      referenceB += line.b * line.length;
      referenceWeight += line.length;
    }
    referenceA /= referenceWeight || 1;
    referenceB /= referenceWeight || 1;
    const referenceNorm = Math.sqrt(referenceA * referenceA + referenceB * referenceB) || 1;
    referenceA /= referenceNorm;
    referenceB /= referenceNorm;
    const imageCenterRho = referenceA * (width - 1) * 0.5 + referenceB * (height - 1) * 0.5;
    const cornerRhos = [
      0,
      referenceA * (width - 1),
      referenceB * (height - 1),
      referenceA * (width - 1) + referenceB * (height - 1),
    ];
    const imageMinRho = Math.min(...cornerRhos);
    const imageMaxRho = Math.max(...cornerRhos);
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
      const lowRho = phase;
      const highRho = phase + spacing * (SIZE - 1);
      const boardCenterRho = (lowRho + highRho) * 0.5;
      const centerScore = clamp01(1 - Math.abs(boardCenterRho - imageCenterRho) / (minDimension * 0.28));
      const overflow = Math.max(0, imageMinRho - lowRho) + Math.max(0, highRho - imageMaxRho);
      const boundsScore = clamp01(1 - overflow / (minDimension * 0.16));
      const score =
        coverage * 0.32 +
        interiorCoverage * 0.20 +
        spanCoverage * 0.14 +
        matchQuality * 0.12 +
        centerScore * 0.16 +
        boundsScore * 0.06;
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

html = replaceFunction(html, '  function fitPeriodicGridBundle(', '  function detectHoughCandidates(', replacement);
html = html.replace('fitPeriodicGridBundle(bundleA, minDimension)', 'fitPeriodicGridBundle(bundleA, width, height)');
html = html.replace('fitPeriodicGridBundle(bundleB, minDimension)', 'fitPeriodicGridBundle(bundleB, width, height)');
if (!html.includes('const centerScore = clamp01(1 - Math.abs(boardCenterRho - imageCenterRho)')) throw new Error('center preference missing');
fs.writeFileSync('makevcf.html', html);
console.log('Centered periodic grid extrapolation.');
