'use strict';

const assert = require('assert');
const P = require('../pattern-compare.js');

const board = new Array(225).fill(0);
const tableInfo = P.ensureOptimizedTables();
console.log(`optimized table build: ${tableInfo.buildMs.toFixed(2)} ms`);

let seed = 0x12345678;
function random() {
  seed ^= seed << 13;
  seed ^= seed >>> 17;
  seed ^= seed << 5;
  return (seed >>> 0) / 0x100000000;
}

const rules = [P.RULES.FREESTYLE, P.RULES.STANDARD, P.RULES.RENJU];
let checked = 0;

for (let round = 0; round < 80; round++) {
  board.fill(0);
  for (let i = 0; i < 225; i++) {
    const value = random();
    board[i] = value < 0.16 ? P.BLACK : value < 0.32 ? P.WHITE : P.EMPTY;
  }

  for (const rule of rules) {
    for (const side of [P.BLACK, P.WHITE]) {
      for (let sample = 0; sample < 24; sample++) {
        const idx = (random() * 225) | 0;
        if (board[idx] !== P.EMPTY) continue;
        const comparison = P.comparePoint(board, idx, side, rule);
        assert(
          comparison.directionMatches.every(Boolean),
          `direction mismatch round=${round} idx=${idx} rule=${rule} side=${side}`,
        );
        assert(
          comparison.pattern4Match,
          `pattern4 mismatch round=${round} idx=${idx} rule=${rule} side=${side}`,
        );
        if (rule === P.RULES.RENJU && side === P.BLACK) {
          assert(
            comparison.forbiddenMatch,
            `forbidden mismatch round=${round} idx=${idx}`,
          );
        }
        checked++;
      }
    }
  }
}

function setBlack(coords) {
  board.fill(P.EMPTY);
  for (const [x, y] of coords) board[y * 15 + x] = P.BLACK;
}

const center = 7 * 15 + 7;

setBlack([[4, 7], [5, 7], [6, 7], [8, 7], [9, 7]]);
let comparison = P.comparePoint(board, center, P.BLACK, P.RULES.RENJU);
assert.equal(comparison.referenceForbidden.type, '長連禁手');
assert.equal(comparison.optimizedForbidden.type, '長連禁手');

setBlack([[5, 7], [6, 7], [8, 7], [9, 7]]);
comparison = P.comparePoint(board, center, P.BLACK, P.RULES.RENJU);
assert.equal(comparison.referenceForbidden.forbidden, false);
assert.equal(comparison.referenceForbidden.type, '合法正五');

setBlack([[5, 7], [6, 7], [8, 7], [7, 5], [7, 6], [7, 8]]);
comparison = P.comparePoint(board, center, P.BLACK, P.RULES.RENJU);
assert.equal(comparison.referenceForbidden.type, '四四禁手');
assert.equal(comparison.optimizedForbidden.type, '四四禁手');

setBlack([[6, 7], [8, 7], [7, 6], [7, 8]]);
comparison = P.comparePoint(board, center, P.BLACK, P.RULES.RENJU);
assert.equal(comparison.referenceForbidden.type, '三三禁手');
assert.equal(comparison.optimizedForbidden.type, '三三禁手');

console.log(`random comparisons: ${checked}`);
console.log('pattern and forbidden comparison tests passed');
