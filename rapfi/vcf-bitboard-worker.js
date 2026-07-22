"use strict";

let moduleInstance = null;
let readyPromise = null;
let currentRules = 2;

const BOARD_CELLS = 225;
const MAX_ROUTES = 64;
const MAX_ROUTE_PLY = 224;
const STATS_BYTES = 16;

const EMPTY = 0;
const BLACK = 1;
const WHITE = 2;
const RENJU = 2;
const MAX = 14;
const MAX_FREE = 15;
const FOUL_MAX = 30;
const FOUL_MAX_FREE = 31;
const THREE_FREE = 7;
const FOUR_NOFREE = 8;
const FOUR_FREE = 9;
const LINE_DOUBLE_FOUR = 24;
const SIX = 28;
const DIRECTION_X = [1, 0, 1, 1];
const DIRECTION_Y = [0, 1, 1, -1];

let ptr = {};
let api = {};

function post(id, ok, result, error) {
  self.postMessage({ id, ok, result, error });
}

function toBoard(input) {
  const source = input instanceof Uint8Array ? input : Uint8Array.from(input || []);
  const board = new Uint8Array(BOARD_CELLS);
  board.set(source.subarray(0, BOARD_CELLS));
  return board;
}

function readStats() {
  const view = new DataView(moduleInstance.HEAPU8.buffer, ptr.stats, STATS_BYTES);
  const nodes = view.getUint32(0, true);
  const elapsedMicros = view.getUint32(4, true);
  return {
    nodeCount: nodes,
    elapsedMs: elapsedMicros / 1000,
    routeCount: view.getUint16(8, true),
    candidateCount: view.getUint16(10, true),
    maxPly: view.getUint16(12, true),
    aborted: Boolean(view.getUint8(14)),
    nodesPerSecond: elapsedMicros > 0 ? nodes * 1_000_000 / elapsedMicros : 0,
  };
}

function writeBoard(board) {
  moduleInstance.HEAPU8.set(board, ptr.board);
}

function writeRoute(route) {
  const moves = Uint8Array.from(route || []).subarray(0, MAX_ROUTE_PLY);
  moduleInstance.HEAPU8.fill(0, ptr.route, ptr.route + MAX_ROUTE_PLY);
  moduleInstance.HEAPU8.set(moves, ptr.route);
  return moves.length;
}

function searchModeValue(mode, maxVCF = 1) {
  if (mode === "shortest" || Number(mode) === 2) return 2;
  if (mode === "multi" || Number(mode) === 1 || Number(maxVCF) > 1) return 1;
  return 0;
}

function pruningModeValue(pruning) {
  return pruning === "fast" || Number(pruning) === 1 ? 1 : 0;
}

function findVCF(param) {
  const board = toBoard(param.arr);
  writeBoard(board);
  const maxVCF = Math.max(1, Math.min(MAX_ROUTES, Number(param.maxVCF) || 1));
  const maxDepth = Math.max(1, Math.min(MAX_ROUTE_PLY, Number(param.maxDepth) || 200));
  const maxNode = Math.max(1, Math.min(0xffffffff, Number(param.maxNode) || 5_000_000));
  const mode = searchModeValue(param.mode, maxVCF);
  const simplify = mode !== 0 || Boolean(param.simplify);
  const pruning = pruningModeValue(param.pruning);
  moduleInstance.HEAPU8.fill(0, ptr.moves, ptr.moves + MAX_ROUTES * MAX_ROUTE_PLY);
  moduleInstance.HEAPU16.fill(0, ptr.lengths >>> 1, (ptr.lengths >>> 1) + MAX_ROUTES);

  let count;
  if (api.findModeV3) {
    count = api.findModeV3(
      ptr.board,
      Number(param.color) || 1,
      Number(param.rules ?? currentRules),
      mode,
      simplify ? 1 : 0,
      pruning,
      maxVCF,
      maxDepth,
      maxNode,
      ptr.moves,
      ptr.lengths,
      MAX_ROUTE_PLY,
      ptr.stats,
    );
  } else if (api.findMode) {
    count = api.findMode(
      ptr.board,
      Number(param.color) || 1,
      Number(param.rules ?? currentRules),
      mode,
      simplify ? 1 : 0,
      maxVCF,
      maxDepth,
      maxNode,
      ptr.moves,
      ptr.lengths,
      MAX_ROUTE_PLY,
      ptr.stats,
    );
  } else {
    count = api.find(
      ptr.board,
      Number(param.color) || 1,
      Number(param.rules ?? currentRules),
      maxVCF,
      maxDepth,
      maxNode,
      ptr.moves,
      ptr.lengths,
      MAX_ROUTE_PLY,
      ptr.stats,
    );
  }

  const lengths = moduleInstance.HEAPU16.subarray(ptr.lengths >>> 1, (ptr.lengths >>> 1) + count);
  const winMoves = [];
  for (let route = 0; route < count; route++) {
    const length = lengths[route];
    const start = ptr.moves + route * MAX_ROUTE_PLY;
    winMoves.push(Array.from(moduleInstance.HEAPU8.subarray(start, start + length)));
  }
  return {
    ...readStats(),
    vcfCount: count,
    winMoves,
    searchMode: mode === 2 ? "shortest" : mode === 1 ? "multi" : "single",
    pruning: pruning ? "fast" : "strict",
    simplified: simplify,
  };
}

function validateRoute(param) {
  const board = toBoard(param.arr);
  writeBoard(board);
  const routeLen = writeRoute(param.moves);
  const valid = api.validate(
    ptr.board,
    Number(param.color) || 1,
    Number(param.rules ?? currentRules),
    ptr.route,
    routeLen,
    Math.max(1, Number(param.maxNode) || 5_000_000),
    ptr.stats,
  );
  return { ...readStats(), valid: Boolean(valid) };
}

function moveIndex(idx, offset, direction) {
  if (idx < 0 || idx >= BOARD_CELLS || direction < 0 || direction > 3) return BOARD_CELLS;
  const x = idx % 15 + DIRECTION_X[direction] * offset;
  const y = Math.floor(idx / 15) + DIRECTION_Y[direction] * offset;
  return x >= 0 && x < 15 && y >= 0 && y < 15 ? y * 15 + x : BOARD_CELLS;
}

function legacyLevelPoint(board, idx, side, rules) {
  writeBoard(board);
  return api.levelPointCompat(ptr.board, idx, side, rules);
}

function legacyLineFour(board, idx, direction, side, rules) {
  writeBoard(board);
  return api.lineFourCompat(ptr.board, idx, direction, side, rules);
}

function legacyBlockFourPoint(board, idx, direction, side, rules, lineInfo = 0) {
  const encoded = (Number(lineInfo) >>> 8) & 0xff;
  if (encoded < BOARD_CELLS) return encoded;
  writeBoard(board);
  return api.blockFour(ptr.board, idx, direction, side, rules);
}

function legacyIsFoul(board, idx, rules) {
  if (rules !== RENJU || idx < 0 || idx >= BOARD_CELLS) return false;
  const previous = board[idx];
  if (previous !== EMPTY && previous !== BLACK) return false;
  board[idx] = EMPTY;
  writeBoard(board);
  const result = Boolean(api.foul(ptr.board, idx, rules));
  board[idx] = previous;
  return result;
}

function scanInitialCounterFours(board, defender, rules) {
  const result = new Uint8Array(BOARD_CELLS);
  for (let idx = 0; idx < BOARD_CELLS; idx++) {
    if (board[idx] !== EMPTY) continue;
    if ((legacyLevelPoint(board, idx, defender, rules) & FOUL_MAX) === FOUR_NOFREE) result[idx] = 1;
  }
  return result;
}

function addLineCounterFours(blockMask, board, center, direction, defender, rules) {
  const mask = defender === BLACK && rules === RENJU ? FOUL_MAX : MAX;
  for (let offset = -4; offset <= 4; offset++) {
    const idx = moveIndex(center, offset, direction);
    if (idx >= BOARD_CELLS || board[idx] !== EMPTY) continue;
    const lineInfo = legacyLineFour(board, idx, direction, defender, rules);
    if ((lineInfo & mask) === FOUR_NOFREE) blockMask[idx] = 1;
  }
}

function validateDefensePoint(baseBoard, attacker, rules, routeLen, idx, maxNode) {
  const defender = 3 - attacker;
  if (idx < 0 || idx >= BOARD_CELLS || baseBoard[idx] !== EMPTY) {
    return { blocks: false, stats: null };
  }
  if (defender === BLACK && rules === RENJU && legacyIsFoul(baseBoard, idx, rules)) {
    return { blocks: false, stats: null };
  }
  const tested = baseBoard.slice();
  tested[idx] = defender;
  writeBoard(tested);
  const stillWins = api.validate(
    ptr.board,
    attacker,
    rules,
    ptr.route,
    routeLen,
    maxNode,
    ptr.stats,
  );
  const stats = readStats();
  return { blocks: !stillWins && !stats.aborted, stats };
}

function oldGetBlockCandidates(baseBoard, attacker, rules, route, includeFour, maxNode) {
  const defender = 3 - attacker;
  const blockMask = new Uint8Array(BOARD_CELLS);
  const initialCounterFours = scanInitialCounterFours(baseBoard, defender, rules);
  const board = baseBoard.slice();
  let fast = true;
  let fourCount = 0;
  const lineInfoList = [];
  let fFourCount = 0;
  const fLineInfoList = [];
  let end = 0;
  const len = route.length;
  const endIdx = route[len - 1];

  if (attacker === BLACK && rules === RENJU) {
    for (let i = 0; i < len; i += 2) {
      const attack = route[end++];
      if (attack >= BOARD_CELLS || board[attack] !== EMPTY) {
        fast = false;
        break;
      }
      board[attack] = BLACK;

      let threeCount = 0;
      for (let direction = 0; direction < 4; direction++) {
        const lineInfo = legacyLineFour(board, attack, direction, BLACK, rules);
        const value = lineInfo & MAX_FREE;
        if (value === THREE_FREE) threeCount++;
        if (end === len && value === FOUR_FREE) {
          fourCount += 2;
          lineInfoList.push({ lineInfo, direction });
        }
      }
      if (threeCount > 1) {
        fast = false;
        break;
      }

      if (end < len) {
        const defense = route[end++];
        if (defense >= BOARD_CELLS || board[defense] !== EMPTY) {
          fast = false;
          break;
        }
        board[defense] = WHITE;
      }
    }
  } else {
    for (let i = 0; i < len; i++) {
      const idx = route[end++];
      if (idx >= BOARD_CELLS || board[idx] !== EMPTY) {
        fast = false;
        break;
      }
      board[idx] = (i & 1) ? defender : attacker;
    }

    if (end === len) {
      for (let direction = 0; direction < 4; direction++) {
        const lineInfo = legacyLineFour(board, endIdx, direction, attacker, rules);
        switch (lineInfo & FOUL_MAX_FREE) {
          case FOUR_FREE:
          case LINE_DOUBLE_FOUR:
            fourCount += 2;
            lineInfoList.push({ lineInfo, direction });
            break;
          case FOUR_NOFREE:
            fourCount += 1;
            lineInfoList.push({ lineInfo, direction });
            break;
        }
      }

      if (fourCount === 1 && lineInfoList.length) {
        const finalLine = lineInfoList[0];
        const foulIdx = legacyBlockFourPoint(
          board,
          endIdx,
          finalLine.direction,
          attacker,
          rules,
          finalLine.lineInfo,
        );
        if (foulIdx < BOARD_CELLS && board[foulIdx] === EMPTY) {
          blockMask[foulIdx] = 1;
          board[foulIdx] = BLACK;
          for (let direction = 0; direction < 4; direction++) {
            const lineInfo = legacyLineFour(board, foulIdx, direction, BLACK, rules);
            switch (lineInfo & FOUL_MAX_FREE) {
              case SIX:
                fFourCount += 3;
                break;
              case LINE_DOUBLE_FOUR:
                fFourCount += 2;
                fLineInfoList.push({ lineInfo, direction });
                break;
              case FOUR_FREE:
                fFourCount += 1;
                break;
              case FOUR_NOFREE:
                fFourCount += 1;
                fLineInfoList.push({ lineInfo, direction });
                break;
            }
          }
          board[foulIdx] = EMPTY;
          if (fFourCount < 2) fast = false;
        } else {
          fast = false;
        }
      }
    }
  }

  if (fast) {
    if (fourCount === 1 && fFourCount === 2 && lineInfoList.length) {
      const finalLine = lineInfoList[0];
      const foulIdx = legacyBlockFourPoint(
        board,
        endIdx,
        finalLine.direction,
        attacker,
        rules,
        finalLine.lineInfo,
      );
      if (foulIdx < BOARD_CELLS) {
        for (const foulLine of fLineInfoList) {
          const bIdx = legacyBlockFourPoint(
            board,
            foulIdx,
            foulLine.direction,
            BLACK,
            rules,
            foulLine.lineInfo,
          );
          const lineDoubleFour = (foulLine.lineInfo & FOUL_MAX_FREE) === LINE_DOUBLE_FOUR;
          if (!lineDoubleFour && bIdx < BOARD_CELLS) board[bIdx] = BLACK;
          for (const sign of [-1, 1]) {
            let state = lineDoubleFour ? -1 : 0;
            for (let distance = 1; distance <= 5; distance++) {
              const idx = moveIndex(foulIdx, distance * sign, foulLine.direction);
              if (idx >= BOARD_CELLS || board[idx] === WHITE) break;
              if (board[idx] !== EMPTY) continue;
              state++;
              if (state) {
                const previous = bIdx < BOARD_CELLS ? board[bIdx] : EMPTY;
                if (bIdx < BOARD_CELLS) board[bIdx] = EMPTY;
                board[idx] = BLACK;
                if (!legacyIsFoul(board, foulIdx, rules)) blockMask[idx] = 1;
                board[idx] = EMPTY;
                if (bIdx < BOARD_CELLS) board[bIdx] = previous;
                break;
              }
            }
          }
          if (bIdx < BOARD_CELLS) board[bIdx] = EMPTY;
        }
      }
    } else if (fourCount === 2) {
      if (lineInfoList.length === 1) {
        const finalLine = lineInfoList[0];
        const blockPoints = [BOARD_CELLS, BOARD_CELLS];
        for (const sign of [-1, 1]) {
          for (let distance = 1; distance <= 4; distance++) {
            const idx = moveIndex(endIdx, distance * sign, finalLine.direction);
            if (idx >= BOARD_CELLS) break;
            if (board[idx] === EMPTY) {
              blockMask[idx] = 1;
              blockPoints[(sign + 1) / 2] = idx;
              break;
            }
          }
        }

        if ((finalLine.lineInfo & FOUL_MAX_FREE) === FOUR_FREE) {
          board[endIdx] = EMPTY;
          for (let i = 0; i < 2; i++) {
            const point = blockPoints[i];
            if (point >= BOARD_CELLS) continue;
            board[point] = attacker;
            const lineInfo = legacyLineFour(board, point, finalLine.direction, attacker, rules);
            const legal = rules !== RENJU || attacker !== BLACK || !legacyIsFoul(board, point, rules);
            if ((lineInfo & FOUL_MAX_FREE) === FOUR_FREE && legal) {
              const redundant = blockPoints[(i + 1) % 2];
              if (redundant < BOARD_CELLS) blockMask[redundant] = 0;
              board[point] = EMPTY;
              break;
            }
            board[point] = EMPTY;
          }
          board[endIdx] = attacker;
        }
      } else if (lineInfoList.length >= 2) {
        for (let i = 0; i < 2; i++) {
          const item = lineInfoList[i];
          const idx = legacyBlockFourPoint(board, endIdx, item.direction, attacker, rules, item.lineInfo);
          if (idx < BOARD_CELLS) blockMask[idx] = 1;
        }
      }
    }

    if (end > 0) {
      board[route[--end]] = EMPTY;
      blockMask[route[end]] = 1;
      for (let i = end - 1; i >= 0; i -= 2) {
        end--;
        const defenseMove = route[end];
        for (let direction = 0; direction < 4; direction++) {
          addLineCounterFours(blockMask, board, defenseMove, direction, defender, rules);
        }
        board[defenseMove] = EMPTY;
        blockMask[defenseMove] = 1;
        if (end <= 0) break;
        board[route[--end]] = EMPTY;
        blockMask[route[end]] = 1;
      }
    }

    for (let idx = 0; idx < BOARD_CELLS; idx++) {
      if (initialCounterFours[idx]) blockMask[idx] = includeFour ? 1 : 0;
    }
  } else {
    for (let i = 0; i < end; i++) board[route[i]] = EMPTY;
    for (let idx = 0; idx < BOARD_CELLS; idx++) {
      if (!includeFour && initialCounterFours[idx]) continue;
      if (baseBoard[idx] !== EMPTY) continue;
      const checked = validateDefensePoint(baseBoard, attacker, rules, len, idx, maxNode);
      if (checked.blocks) blockMask[idx] = 1;
    }
  }

  const candidates = [];
  for (let idx = 0; idx < BOARD_CELLS; idx++) {
    if (!blockMask[idx] || baseBoard[idx] !== EMPTY) continue;
    if (defender === BLACK && rules === RENJU && legacyIsFoul(baseBoard, idx, rules)) continue;
    candidates.push(idx);
  }
  return { candidates, fast };
}

function getBlockVCF(param) {
  const startedAt = performance.now();
  const baseBoard = toBoard(param.arr);
  const attacker = Number(param.color) || BLACK;
  const rules = Number(param.rules ?? currentRules);
  const route = Array.from(param.vcfMoves || [])
    .filter(idx => Number.isInteger(idx) && idx >= 0 && idx < BOARD_CELLS)
    .slice(0, MAX_ROUTE_PLY);
  const routeLen = writeRoute(route);
  const maxNode = Math.max(1, Number(param.maxNode) || 5_000_000);
  const includeFour = param.includeFour !== false;

  if (!routeLen || (routeLen & 1) === 0) {
    return {
      nodeCount: 0,
      elapsedMs: performance.now() - startedAt,
      routeCount: 0,
      candidateCount: 0,
      maxPly: 0,
      aborted: false,
      nodesPerSecond: 0,
      points: [],
      candidateMode: "legacy-getBlockVCF",
    };
  }

  const generated = oldGetBlockCandidates(baseBoard, attacker, rules, route, includeFour, maxNode);
  const points = [];
  let totalNodes = 0;
  let maxPly = 0;
  let aborted = false;
  const seen = new Set();

  for (const idx of generated.candidates) {
    if (seen.has(idx)) continue;
    seen.add(idx);
    const checked = validateDefensePoint(baseBoard, attacker, rules, routeLen, idx, maxNode);
    if (checked.stats) {
      totalNodes += checked.stats.nodeCount || 0;
      maxPly = Math.max(maxPly, checked.stats.maxPly || 0);
      aborted = aborted || Boolean(checked.stats.aborted);
    }
    if (checked.blocks) points.push(idx);
  }

  const elapsedMs = performance.now() - startedAt;
  return {
    nodeCount: totalNodes,
    elapsedMs,
    routeCount: points.length,
    candidateCount: generated.candidates.length,
    maxPly,
    aborted,
    nodesPerSecond: elapsedMs > 0 ? totalNodes * 1000 / elapsedMs : 0,
    points,
    candidateMode: generated.fast ? "legacy-fast" : "legacy-bruteforce",
  };
}

function getLevelPoints(param) {
  const board = toBoard(param.arr);
  writeBoard(board);
  const rawIndices = Array.isArray(param.indices) || ArrayBuffer.isView(param.indices)
    ? Array.from(param.indices).filter(idx => Number.isInteger(idx) && idx >= 0 && idx < BOARD_CELLS)
    : [];
  const indices = Uint16Array.from(rawIndices);
  if (indices.length) moduleInstance.HEAPU16.set(indices, ptr.indices >>> 1);
  moduleInstance.HEAPU16.fill(0, ptr.outIndices >>> 1, (ptr.outIndices >>> 1) + BOARD_CELLS);
  moduleInstance.HEAPU16.fill(0, ptr.labels >>> 1, (ptr.labels >>> 1) + BOARD_CELLS);

  const maxDepth = Math.max(1, Math.min(MAX_ROUTE_PLY, Number(param.maxDepth) || 200));
  const maxNode = Math.max(1, Number(param.maxNode) || 5_000_000);
  const mode = searchModeValue(param.searchMode, 1);
  const simplify = mode !== 0 || Boolean(param.simplify);
  const pruning = pruningModeValue(param.pruning);
  let count;
  if (api.scanModeV3) {
    count = api.scanModeV3(
      ptr.board,
      Number(param.color) || 1,
      Number(param.placeColor || param.color) || 1,
      Number(param.rules ?? currentRules),
      mode,
      simplify ? 1 : 0,
      pruning,
      indices.length ? ptr.indices : 0,
      indices.length,
      maxDepth,
      maxNode,
      ptr.outIndices,
      ptr.labels,
      BOARD_CELLS,
      ptr.stats,
    );
  } else {
    count = api.scanMode(
      ptr.board,
      Number(param.color) || 1,
      Number(param.placeColor || param.color) || 1,
      Number(param.rules ?? currentRules),
      mode,
      simplify ? 1 : 0,
      indices.length ? ptr.indices : 0,
      indices.length,
      maxDepth,
      maxNode,
      ptr.outIndices,
      ptr.labels,
      BOARD_CELLS,
      ptr.stats,
    );
  }

  const outIdx = moduleInstance.HEAPU16.subarray(ptr.outIndices >>> 1, (ptr.outIndices >>> 1) + count);
  const labels = moduleInstance.HEAPU16.subarray(ptr.labels >>> 1, (ptr.labels >>> 1) + count);
  const items = [];
  for (let i = 0; i < count; i++) items.push({ idx: outIdx[i], label: String(labels[i]) });
  return {
    ...readStats(),
    items,
    searchMode: mode === 2 ? "shortest" : mode === 1 ? "multi" : "single",
    pruning: pruning ? "fast" : "strict",
  };
}

function trimVCFGroups(param) {
  const base = toBoard(param.arr);
  const attacker = Number(param.color) || 1;
  const defender = 3 - attacker;
  const rules = Number(param.rules ?? currentRules);
  const groups = Array.isArray(param.groups) ? param.groups : [];
  const seen = new Set();
  const processed = [];

  for (const source of groups) {
    const moves = Array.from(source || []).filter(idx => Number.isInteger(idx) && idx >= 0 && idx < BOARD_CELLS);
    if (!moves.length) continue;
    const board = base.slice();
    for (let i = 0; i < moves.length - 1; i++) {
      if (board[moves[i]] !== 0) break;
      board[moves[i]] = (i & 1) ? defender : attacker;
    }
    writeBoard(board);
    const finalIndex = moves[moves.length - 1];
    const finalSide = ((moves.length - 1) & 1) ? defender : attacker;
    const rawLevel = api.levelPoint(ptr.board, finalIndex, finalSide, rules);
    const level = rawLevel & 0x0f;
    const normalized = level === 9 ? moves.slice(0, -1) : moves;
    const key = normalized
      .map((idx, i) => `${idx}:${(i & 1) ? defender : attacker}`)
      .sort()
      .join(",");
    if (!seen.has(key)) {
      seen.add(key);
      processed.push(moves);
    }
  }
  processed.sort((a, b) => a.length - b.length);
  return processed;
}

async function init(url) {
  if (readyPromise) return readyPromise;
  readyPromise = (async () => {
    const base = new URL("./", url).href;
    self.importScripts(url);
    if (typeof self.VCFBitboardModule !== "function") throw new Error("找不到 VCFBitboardModule");
    moduleInstance = await self.VCFBitboardModule({ locateFile: file => new URL(file, base).href });
    api = {
      find: moduleInstance.cwrap("vcfBbFind", "number", Array(10).fill("number")),
      findMode: moduleInstance.cwrap("vcfBbFindMode", "number", Array(12).fill("number")),
      findModeV3: moduleInstance._vcfBbFindModeV3
        ? moduleInstance.cwrap("vcfBbFindModeV3", "number", Array(13).fill("number"))
        : null,
      validate: moduleInstance.cwrap("vcfBbValidateRoute", "number", Array(7).fill("number")),
      routeDefense: moduleInstance.cwrap("vcfBbRouteDefense", "number", Array(9).fill("number")),
      scan: moduleInstance.cwrap("vcfBbScanPoints", "number", Array(12).fill("number")),
      scanMode: moduleInstance.cwrap("vcfBbScanPointsMode", "number", Array(14).fill("number")),
      scanModeV3: moduleInstance._vcfBbScanPointsModeV3
        ? moduleInstance.cwrap("vcfBbScanPointsModeV3", "number", Array(15).fill("number"))
        : null,
      levelPoint: moduleInstance.cwrap("vcfBbLegacyGetLevelPoint", "number", Array(4).fill("number")),
      levelPointCompat: moduleInstance.cwrap("vcfBbLegacyGetLevelPointCompat", "number", Array(4).fill("number")),
      lineFourCompat: moduleInstance.cwrap("vcfBbLegacyTestLineFourCompat", "number", Array(5).fill("number")),
      blockFour: moduleInstance.cwrap("vcfBbLegacyGetBlockFourPoint", "number", Array(5).fill("number")),
      foul: moduleInstance.cwrap("vcfBbLegacyIsFoul", "number", Array(3).fill("number")),
      selfTest: moduleInstance.cwrap("vcfBbSelfTest", "number", []),
      searchV2SelfTest: moduleInstance.cwrap("vcfBbSearchV2SelfTest", "number", []),
    };
    const test = api.selfTest();
    if (test !== 0) throw new Error(`Bitboard C++ Wasm 自我檢查失敗：${test}`);
    const searchTest = api.searchV2SelfTest();
    if (searchTest !== 0) throw new Error(`Bitboard 搜尋自我檢查失敗：${searchTest}`);

    ptr.board = moduleInstance._malloc(BOARD_CELLS);
    ptr.moves = moduleInstance._malloc(MAX_ROUTES * MAX_ROUTE_PLY);
    ptr.lengths = moduleInstance._malloc(MAX_ROUTES * 2);
    ptr.stats = moduleInstance._malloc(STATS_BYTES);
    ptr.route = moduleInstance._malloc(MAX_ROUTE_PLY);
    ptr.points = moduleInstance._malloc(BOARD_CELLS);
    ptr.indices = moduleInstance._malloc(BOARD_CELLS * 2);
    ptr.outIndices = moduleInstance._malloc(BOARD_CELLS * 2);
    ptr.labels = moduleInstance._malloc(BOARD_CELLS * 2);
    return { selfTest: test, searchV2SelfTest: searchTest, optimizedV3: Boolean(api.findModeV3) };
  })();
  return readyPromise;
}

self.onmessage = async event => {
  const { id, type, data } = event.data || {};
  try {
    if (type === "init") {
      post(id, true, await init(data.moduleURL));
      return;
    }
    await readyPromise;
    let result;
    switch (type) {
      case "setGameRules":
        currentRules = Number(data?.rules) || 2;
        result = true;
        break;
      case "findVCF": result = findVCF(data || {}); break;
      case "isVCF": result = validateRoute(data || {}); break;
      case "getBlockVCF": result = getBlockVCF(data || {}); break;
      case "getLevelPoints": result = getLevelPoints(data || {}); break;
      case "trimVCFGroups": result = trimVCFGroups(data || {}); break;
      default: throw new Error(`未知 Bitboard 指令：${type}`);
    }
    post(id, true, result);
  } catch (error) {
    post(id, false, null, error?.stack || error?.message || String(error));
  }
};