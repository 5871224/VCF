"use strict";

const path = require("path");
const { performance } = require("perf_hooks");

const BOARD_SIZE = 15;
const BOARD_CELLS = 225;
const BLACK = 1;
const WHITE = 2;
const RENJU = 2;
const MODE_SINGLE = 0;
const MAX_ROUTE = 224;

function makeBaseBoard() {
  // 與 C++ makeTranspositionBoard(9, 23) 洗牌後相同的九條 W.XXX.W。
  const patterns = [
    [11, 8], [7, 0], [1, 0], [13, 0], [5, 8],
    [7, 8], [3, 0], [13, 8], [9, 0],
  ];
  const board = new Uint8Array(BOARD_CELLS);
  for (const [y, startX] of patterns) {
    board[y * BOARD_SIZE + startX] = WHITE;
    board[y * BOARD_SIZE + startX + 6] = WHITE;
    for (let x = startX + 2; x <= startX + 4; x++) {
      board[y * BOARD_SIZE + x] = BLACK;
    }
  }
  return board;
}

function transformPoint(x, y, symmetry) {
  if (symmetry & 4) x = BOARD_SIZE - 1 - x;
  switch (symmetry & 3) {
    case 1: return [BOARD_SIZE - 1 - y, x];
    case 2: return [BOARD_SIZE - 1 - x, BOARD_SIZE - 1 - y];
    case 3: return [y, BOARD_SIZE - 1 - x];
    default: return [x, y];
  }
}

function transformBoard(source, symmetry) {
  const board = new Uint8Array(BOARD_CELLS);
  for (let y = 0; y < BOARD_SIZE; y++) {
    for (let x = 0; x < BOARD_SIZE; x++) {
      const [tx, ty] = transformPoint(x, y, symmetry);
      board[ty * BOARD_SIZE + tx] = source[y * BOARD_SIZE + x];
    }
  }
  return board;
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length & 1
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

async function main() {
  const [, , modulePathArg, label, maxNodesArg = "1500000", repetitionsArg = "7"] = process.argv;
  if (!modulePathArg || !label) {
    throw new Error("usage: node benchmark.js module.js label [maxNodes] [repetitions]");
  }

  const modulePath = path.resolve(modulePathArg);
  const createModule = require(modulePath);
  const initStarted = performance.now();
  const moduleInstance = await createModule({
    locateFile: file => path.join(path.dirname(modulePath), file),
  });
  const initMs = performance.now() - initStarted;

  const findMode = moduleInstance.cwrap("vcfBbFindMode", "number", Array(12).fill("number"));
  const boardPtr = moduleInstance._malloc(BOARD_CELLS);
  const movesPtr = moduleInstance._malloc(MAX_ROUTE);
  const lengthsPtr = moduleInstance._malloc(2);
  const statsPtr = moduleInstance._malloc(16);
  const maxNodes = Math.max(1, Number(maxNodesArg) || 1_500_000);
  const repetitions = Math.max(1, Number(repetitionsArg) || 7);

  function search(board) {
    moduleInstance.HEAPU8.set(board, boardPtr);
    moduleInstance.HEAPU8.fill(0, movesPtr, movesPtr + MAX_ROUTE);
    moduleInstance.HEAPU16[lengthsPtr >>> 1] = 0;
    moduleInstance.HEAPU8.fill(0, statsPtr, statsPtr + 16);
    const started = performance.now();
    const count = findMode(
      boardPtr, BLACK, RENJU, MODE_SINGLE, 0, 1, 41, maxNodes,
      movesPtr, lengthsPtr, MAX_ROUTE, statsPtr,
    );
    const milliseconds = performance.now() - started;
    const view = new DataView(moduleInstance.HEAPU8.buffer, statsPtr, 16);
    return {
      milliseconds,
      nodes: view.getUint32(0, true),
      routes: count,
      length: count ? moduleInstance.HEAPU16[lengthsPtr >>> 1] : 0,
      aborted: Boolean(view.getUint8(14)),
    };
  }

  const base = makeBaseBoard();
  const cold = search(transformBoard(base, 0));
  let totalMs = 0;
  let totalNodes = 0;
  let routes = 0;
  let abortedCases = 0;
  let valid = true;

  for (let symmetry = 0; symmetry < 8; symmetry++) {
    const board = transformBoard(base, symmetry);
    const times = [];
    let representative = null;
    for (let repetition = 0; repetition < repetitions; repetition++) {
      const result = search(board);
      times.push(result.milliseconds);
      if (!representative) representative = result;
      valid = valid && result.routes === 0 && !result.aborted;
    }
    const caseMedian = median(times);
    totalMs += caseMedian;
    totalNodes += representative.nodes;
    routes += representative.routes;
    if (representative.aborted) abortedCases++;
    const nps = caseMedian > 0 ? representative.nodes * 1000 / caseMedian : 0;
    console.log(
      `WASM_CASE label=${label} symmetry=${symmetry} median_ms=${caseMedian.toFixed(3)}` +
      ` nodes=${representative.nodes} nps=${nps.toFixed(3)}` +
      ` routes=${representative.routes} length=${representative.length}` +
      ` aborted=${Number(representative.aborted)} valid=${Number(valid)}`,
    );
  }

  const nps = totalMs > 0 ? totalNodes * 1000 / totalMs : 0;
  console.log(
    `WASM_SUMMARY label=${label} init_ms=${initMs.toFixed(3)}` +
    ` cold_ms=${cold.milliseconds.toFixed(3)} median_total_ms=${totalMs.toFixed(3)}` +
    ` total_nodes=${totalNodes} nps=${nps.toFixed(3)}` +
    ` routes=${routes} aborted_cases=${abortedCases} valid=${Number(valid)}`,
  );

  moduleInstance._free(statsPtr);
  moduleInstance._free(lengthsPtr);
  moduleInstance._free(movesPtr);
  moduleInstance._free(boardPtr);
  if (!valid) process.exitCode = 2;
}

main().catch(error => {
  console.error(error && (error.stack || error.message) || String(error));
  process.exit(1);
});
