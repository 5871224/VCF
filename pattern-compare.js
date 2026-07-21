(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.VCFPatternCompare = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const SIZE = 15;
  const EMPTY = 0;
  const BLACK = 1;
  const WHITE = 2;

  const RULES = Object.freeze({
    FREESTYLE: 'freestyle',
    STANDARD: 'standard',
    RENJU: 'renju',
  });

  const PATTERN = Object.freeze({
    DEAD: 0,
    OL: 1,
    B1: 2,
    F1: 3,
    B2: 4,
    F2: 5,
    F2A: 6,
    F2B: 7,
    B3: 8,
    F3: 9,
    F3S: 10,
    B4: 11,
    F4: 12,
    F5: 13,
  });

  const PATTERN_NAMES = Object.freeze([
    'DEAD', 'OL', 'B1', 'F1', 'B2', 'F2', 'F2A', 'F2B',
    'B3', 'F3', 'F3S', 'B4', 'F4', 'F5',
  ]);

  const PATTERN_ZH = Object.freeze([
    '死型', '長連／同線雙四標記', '眠一', '活一', '眠二', '活二', '跳活二', '強活二',
    '眠三', '活三', '強活三', '眠四', '活四', '五連',
  ]);

  const PATTERN4 = Object.freeze({
    NONE: 0,
    FORBID: 1,
    L_FLEX2: 2,
    K_BLOCK3: 3,
    J_FLEX2_2X: 4,
    I_BLOCK3_PLUS: 5,
    H_FLEX3: 6,
    G_FLEX3_PLUS: 7,
    F_FLEX3_2X: 8,
    E_BLOCK4: 9,
    D_BLOCK4_PLUS: 10,
    C_BLOCK4_FLEX3: 11,
    B_FLEX4: 12,
    A_FIVE: 13,
  });

  const PATTERN4_NAMES = Object.freeze([
    'NONE', 'FORBID', 'L_FLEX2', 'K_BLOCK3', 'J_FLEX2_2X', 'I_BLOCK3_PLUS',
    'H_FLEX3', 'G_FLEX3_PLUS', 'F_FLEX3_2X', 'E_BLOCK4', 'D_BLOCK4_PLUS',
    'C_BLOCK4_FLEX3', 'B_FLEX4', 'A_FIVE',
  ]);

  const PATTERN4_ZH = Object.freeze([
    '無顯著棋型', '禁手候選', '活二', '眠三', '雙活二', '眠三複合',
    '活三', '活三複合', '雙活三', '眠四', '眠四複合',
    '四三', '活四／雙眠四', '成五',
  ]);

  const DIRECTIONS = Object.freeze([
    Object.freeze({ dx: 1, dy: 0, name: '橫向' }),
    Object.freeze({ dx: 0, dy: 1, name: '縱向' }),
    Object.freeze({ dx: 1, dy: 1, name: '左上－右下' }),
    Object.freeze({ dx: 1, dy: -1, name: '左下－右上' }),
  ]);

  const SELF = 0;
  const OPPO = 1;
  const EMPT = 2;
  const NIL = 255;

  const POW3 = [1];
  for (let i = 1; i <= 10; i++) POW3[i] = POW3[i - 1] * 3;

  const memoByMode = new Map();
  const optimizedTables = new Map();
  const helperTables = new Map();
  let optimizedReady = false;
  let optimizedBuildMs = 0;

  function assertBoard(board) {
    if (!board || board.length < SIZE * SIZE) {
      throw new TypeError('board 必須至少包含 225 格');
    }
  }

  function halfLineLength(rule) {
    return rule === RULES.FREESTYLE ? 4 : 5;
  }

  function modeKey(rule, side) {
    if (rule === RULES.FREESTYLE) return 'free';
    if (rule === RULES.STANDARD) return 'standard';
    return side === BLACK ? 'renju-black' : 'renju-white';
  }

  function shouldCheckOverline(rule, side) {
    return rule === RULES.STANDARD || (rule === RULES.RENJU && side === BLACK);
  }

  function inBoard(x, y) {
    return x >= 0 && x < SIZE && y >= 0 && y < SIZE;
  }

  function indexOf(x, y) {
    return y * SIZE + x;
  }

  function getCell(board, x, y) {
    return inBoard(x, y) ? board[indexOf(x, y)] : -1;
  }

  function extractRelativeLine(board, idx, side, rule, direction) {
    assertBoard(board);
    const half = halfLineLength(rule);
    const len = half * 2 + 1;
    const mid = half;
    const x0 = idx % SIZE;
    const y0 = Math.floor(idx / SIZE);
    const { dx, dy } = DIRECTIONS[direction];
    const line = new Uint8Array(len);
    const symbols = new Array(len);

    for (let offset = -half; offset <= half; offset++) {
      const p = offset + mid;
      if (offset === 0) {
        line[p] = SELF;
        symbols[p] = '◎';
        continue;
      }
      const value = getCell(board, x0 + dx * offset, y0 + dy * offset);
      if (value === EMPTY) {
        line[p] = EMPT;
        symbols[p] = '·';
      } else if (value === side) {
        line[p] = SELF;
        symbols[p] = '●';
      } else {
        line[p] = OPPO;
        symbols[p] = value < 0 ? '│' : '○';
      }
    }

    return { line, symbols: symbols.join(''), half };
  }

  function encodeMemoLine(line) {
    let code = 0;
    for (let i = 0; i < line.length; i++) code = code * 3 + line[i];
    return code;
  }

  function countLine(line) {
    const mid = line.length >> 1;
    let realLen = 1;
    let fullLen = 1;
    let realLenInc = 1;
    let start = mid;
    let end = mid;

    for (let i = mid - 1; i >= 0; i--) {
      if (line[i] === SELF) realLen += realLenInc;
      else if (line[i] === OPPO) break;
      else realLenInc = 0;
      fullLen++;
      start = i;
    }

    realLenInc = 1;
    for (let i = mid + 1; i < line.length; i++) {
      if (line[i] === SELF) realLen += realLenInc;
      else if (line[i] === OPPO) break;
      else realLenInc = 0;
      fullLen++;
      end = i;
    }

    return { realLen, fullLen, start, end };
  }

  function shiftLine(line, centerIndex) {
    const len = line.length;
    const mid = len >> 1;
    const shifted = new Uint8Array(len);
    for (let j = 0; j < len; j++) {
      const src = j + centerIndex - mid;
      shifted[j] = src >= 0 && src < len ? line[src] : OPPO;
    }
    return shifted;
  }

  function getReferenceMemo(rule, side, lineLen) {
    const key = `${modeKey(rule, side)}:${lineLen}`;
    let memo = memoByMode.get(key);
    if (!memo) {
      memo = new Uint8Array(3 ** lineLen);
      memo.fill(NIL);
      memoByMode.set(key, memo);
    }
    return memo;
  }

  function getPatternReferenceFromLine(line, rule, side) {
    const memo = getReferenceMemo(rule, side, line.length);
    const memoCode = encodeMemoLine(line);
    const old = memo[memoCode];
    if (old !== NIL) return old;

    const { realLen, fullLen, start, end } = countLine(line);
    let pattern = PATTERN.DEAD;

    if (shouldCheckOverline(rule, side) && realLen >= 6) {
      pattern = PATTERN.OL;
    } else if (realLen >= 5) {
      pattern = PATTERN.F5;
    } else if (fullLen < 5) {
      pattern = PATTERN.DEAD;
    } else {
      const counts = new Uint8Array(PATTERN_NAMES.length);
      const f5Indices = [];
      const mid = line.length >> 1;

      for (let i = start; i <= end; i++) {
        if (line[i] !== EMPT) continue;
        const shifted = shiftLine(line, i);
        shifted[mid] = SELF;
        const childPattern = getPatternReferenceFromLine(shifted, rule, side);
        if (childPattern === PATTERN.F5 && f5Indices.length < 2) f5Indices.push(i);
        counts[childPattern]++;
      }

      if (counts[PATTERN.F5] >= 2) {
        pattern = PATTERN.F4;
        if (rule === RULES.RENJU && side === BLACK && f5Indices.length >= 2 &&
            f5Indices[1] - f5Indices[0] < 5) {
          pattern = PATTERN.OL;
        }
      } else if (counts[PATTERN.F5]) {
        pattern = PATTERN.B4;
      } else if (counts[PATTERN.F4] >= 2) {
        pattern = PATTERN.F3S;
      } else if (counts[PATTERN.F4]) {
        pattern = PATTERN.F3;
      } else if (counts[PATTERN.B4]) {
        pattern = PATTERN.B3;
      } else if (counts[PATTERN.F3S] + counts[PATTERN.F3] >= 4) {
        pattern = PATTERN.F2B;
      } else if (counts[PATTERN.F3S] + counts[PATTERN.F3] >= 3) {
        pattern = PATTERN.F2A;
      } else if (counts[PATTERN.F3S] + counts[PATTERN.F3]) {
        pattern = PATTERN.F2;
      } else if (counts[PATTERN.B3]) {
        pattern = PATTERN.B2;
      } else if (counts[PATTERN.F2] + counts[PATTERN.F2A] + counts[PATTERN.F2B]) {
        pattern = PATTERN.F1;
      } else if (counts[PATTERN.B2]) {
        pattern = PATTERN.B1;
      }
    }

    memo[memoCode] = pattern;
    return pattern;
  }

  function getTopLevelLineMeta(line, pattern, rule, side) {
    const { realLen, fullLen } = countLine(line);
    return {
      realLen,
      fullLen,
      actualOverline: shouldCheckOverline(rule, side) && realLen >= 6,
      sameLineDoubleFour: rule === RULES.RENJU && side === BLACK &&
        pattern === PATTERN.OL && realLen < 6,
    };
  }

  function classifyDirectionReference(board, idx, side, rule, direction) {
    const extracted = extractRelativeLine(board, idx, side, rule, direction);
    const pattern = getPatternReferenceFromLine(extracted.line, rule, side);
    const meta = getTopLevelLineMeta(extracted.line, pattern, rule, side);
    return {
      direction,
      directionName: DIRECTIONS[direction].name,
      pattern,
      patternName: PATTERN_NAMES[pattern],
      patternZh: PATTERN_ZH[pattern],
      lineText: extracted.symbols,
      ...meta,
    };
  }

  function buildHelperTables(cellCount) {
    let helpers = helperTables.get(cellCount);
    if (helpers) return helpers;
    const count = 1 << cellCount;
    const own = new Uint32Array(count);
    const block = new Uint32Array(count);
    for (let bits = 1; bits < count; bits++) {
      const low = bits & -bits;
      const bit = 31 - Math.clz32(low);
      const prev = bits ^ low;
      own[bits] = own[prev] + POW3[bit];
      block[bits] = block[prev] + 2 * POW3[bit];
    }
    helpers = { own, block };
    helperTables.set(cellCount, helpers);
    return helpers;
  }

  function decodeTernaryLine(key, cellCount) {
    const half = cellCount >> 1;
    const line = new Uint8Array(cellCount + 1);
    let n = key;
    for (let variableIndex = 0; variableIndex < cellCount; variableIndex++) {
      const digit = n % 3;
      n = Math.floor(n / 3);
      const lineIndex = variableIndex < half ? variableIndex : variableIndex + 1;
      line[lineIndex] = digit === 0 ? EMPT : digit === 1 ? SELF : OPPO;
    }
    line[half] = SELF;
    return line;
  }

  function buildOptimizedTable(rule, side) {
    const keyName = modeKey(rule, side);
    let table = optimizedTables.get(keyName);
    if (table) return table;
    const half = halfLineLength(rule);
    const cellCount = half * 2;
    table = new Uint8Array(3 ** cellCount);
    for (let key = 0; key < table.length; key++) {
      const line = decodeTernaryLine(key, cellCount);
      table[key] = getPatternReferenceFromLine(line, rule, side);
    }
    optimizedTables.set(keyName, table);
    buildHelperTables(cellCount);
    return table;
  }

  function ensureOptimizedTables() {
    if (optimizedReady) return { ready: true, buildMs: optimizedBuildMs };
    const now = typeof performance !== 'undefined' ? () => performance.now() : () => Date.now();
    const t0 = now();
    buildOptimizedTable(RULES.FREESTYLE, BLACK);
    buildOptimizedTable(RULES.STANDARD, BLACK);
    buildOptimizedTable(RULES.RENJU, BLACK);
    buildOptimizedTable(RULES.RENJU, WHITE);
    optimizedBuildMs = now() - t0;
    optimizedReady = true;
    return { ready: true, buildMs: optimizedBuildMs };
  }

  function extractOwnBlockBits(board, idx, side, rule, direction) {
    const half = halfLineLength(rule);
    const x0 = idx % SIZE;
    const y0 = Math.floor(idx / SIZE);
    const { dx, dy } = DIRECTIONS[direction];
    let ownBits = 0;
    let blockBits = 0;
    let variableIndex = 0;

    for (let offset = -half; offset <= half; offset++) {
      if (offset === 0) continue;
      const value = getCell(board, x0 + dx * offset, y0 + dy * offset);
      if (value === side) ownBits |= 1 << variableIndex;
      else if (value !== EMPTY) blockBits |= 1 << variableIndex;
      variableIndex++;
    }

    return { ownBits, blockBits, cellCount: half * 2 };
  }

  function classifyDirectionOptimized(board, idx, side, rule, direction) {
    ensureOptimizedTables();
    const { ownBits, blockBits, cellCount } = extractOwnBlockBits(board, idx, side, rule, direction);
    const helpers = buildHelperTables(cellCount);
    const ternaryKey = helpers.own[ownBits] + helpers.block[blockBits];
    const table = buildOptimizedTable(rule, side);
    const pattern = table[ternaryKey];
    const extracted = extractRelativeLine(board, idx, side, rule, direction);
    const meta = getTopLevelLineMeta(extracted.line, pattern, rule, side);
    return {
      direction,
      directionName: DIRECTIONS[direction].name,
      pattern,
      patternName: PATTERN_NAMES[pattern],
      patternZh: PATTERN_ZH[pattern],
      lineText: extracted.symbols,
      ternaryKey,
      ...meta,
    };
  }

  function combinePattern4(patterns, rule, side) {
    const n = new Uint8Array(PATTERN_NAMES.length);
    for (const p of patterns) n[p]++;

    if (n[PATTERN.F5] >= 1) return PATTERN4.A_FIVE;

    if (rule === RULES.RENJU && side === BLACK) {
      if (n[PATTERN.OL] >= 1) return PATTERN4.FORBID;
      if (n[PATTERN.F4] + n[PATTERN.B4] >= 2) return PATTERN4.FORBID;
      if (n[PATTERN.F3] + n[PATTERN.F3S] >= 2) return PATTERN4.FORBID;
    }

    if (n[PATTERN.B4] >= 2) return PATTERN4.B_FLEX4;
    if (n[PATTERN.F4] >= 1) return PATTERN4.B_FLEX4;
    if (n[PATTERN.B4] >= 1) {
      if (n[PATTERN.F3] >= 1 || n[PATTERN.F3S] >= 1) return PATTERN4.C_BLOCK4_FLEX3;
      if (n[PATTERN.B3] >= 1) return PATTERN4.D_BLOCK4_PLUS;
      if (n[PATTERN.F2] + n[PATTERN.F2A] + n[PATTERN.F2B] >= 1) return PATTERN4.D_BLOCK4_PLUS;
      return PATTERN4.E_BLOCK4;
    }
    if (n[PATTERN.F3] >= 1 || n[PATTERN.F3S] >= 1) {
      if (n[PATTERN.F3] + n[PATTERN.F3S] >= 2) return PATTERN4.F_FLEX3_2X;
      if (n[PATTERN.B3] >= 1) return PATTERN4.G_FLEX3_PLUS;
      if (n[PATTERN.F2] + n[PATTERN.F2A] + n[PATTERN.F2B] >= 1) return PATTERN4.G_FLEX3_PLUS;
      return PATTERN4.H_FLEX3;
    }
    if (n[PATTERN.B3] >= 1) {
      if (n[PATTERN.B3] >= 2) return PATTERN4.I_BLOCK3_PLUS;
      if (n[PATTERN.F2] + n[PATTERN.F2A] + n[PATTERN.F2B] >= 1) return PATTERN4.I_BLOCK3_PLUS;
    }
    if (n[PATTERN.F2] + n[PATTERN.F2A] + n[PATTERN.F2B] >= 2) return PATTERN4.J_FLEX2_2X;
    if (n[PATTERN.B3] >= 1) return PATTERN4.K_BLOCK3;
    if (n[PATTERN.F2] + n[PATTERN.F2A] + n[PATTERN.F2B] >= 1) return PATTERN4.L_FLEX2;
    return PATTERN4.NONE;
  }

  function classifyPoint(board, idx, side, rule, system) {
    assertBoard(board);
    if (idx < 0 || idx >= SIZE * SIZE) throw new RangeError('idx 超出棋盤');
    const fn = system === 'optimized' ? classifyDirectionOptimized : classifyDirectionReference;
    const directions = [];
    for (let direction = 0; direction < 4; direction++) {
      directions.push(fn(board, idx, side, rule, direction));
    }
    const patterns = directions.map(item => item.pattern);
    const pattern4 = combinePattern4(patterns, rule, side);
    return {
      idx,
      side,
      rule,
      system,
      directions,
      pattern4,
      pattern4Name: PATTERN4_NAMES[pattern4],
      pattern4Zh: PATTERN4_ZH[pattern4],
    };
  }

  function makeForbiddenMemoKey(board, idx, system) {
    let out = `${system}:${idx}:`;
    for (let i = 0; i < SIZE * SIZE; i++) out += board[i];
    return out;
  }

  function getForbiddenInfo(board, idx, rule, system, memo) {
    assertBoard(board);
    if (rule !== RULES.RENJU) {
      return { forbidden: false, type: '不適用', detail: '只有連珠黑棋需要禁手判斷' };
    }
    if (board[idx] !== EMPTY) {
      return { forbidden: false, type: '不可落子', detail: '該點已有棋子' };
    }

    const cache = memo || new Map();
    const memoKey = makeForbiddenMemoKey(board, idx, system);
    if (cache.has(memoKey)) return cache.get(memoKey);

    const analysis = classifyPoint(board, idx, BLACK, rule, system);
    if (analysis.pattern4 !== PATTERN4.FORBID) {
      const result = {
        forbidden: false,
        type: analysis.pattern4 === PATTERN4.A_FIVE ? '合法正五' : '否',
        detail: analysis.pattern4 === PATTERN4.A_FIVE
          ? 'Rapfi 的四方向合併先判定正五，因此不再列入禁手'
          : '未通過禁手初篩',
        analysis,
      };
      cache.set(memoKey, result);
      return result;
    }

    if (analysis.directions.some(item => item.actualOverline)) {
      const result = { forbidden: true, type: '長連禁手', detail: '落子後至少一個方向形成連續六子以上', analysis };
      cache.set(memoKey, result);
      return result;
    }

    if (analysis.directions.some(item => item.sameLineDoubleFour)) {
      const result = { forbidden: true, type: '四四禁手', detail: '同一方向內形成兩個四（Rapfi 以 OL 特殊標記）', analysis };
      cache.set(memoKey, result);
      return result;
    }

    let fourCount = 0;
    for (const item of analysis.directions) {
      if (item.pattern === PATTERN.B4 || item.pattern === PATTERN.F4) fourCount++;
    }
    if (fourCount >= 2) {
      const result = { forbidden: true, type: '四四禁手', detail: `共有 ${fourCount} 個方向形成四`, analysis };
      cache.set(memoKey, result);
      return result;
    }

    board[idx] = BLACK;
    let realThreeDirections = 0;
    try {
      for (let direction = 0; direction < 4; direction++) {
        const originalPattern = analysis.directions[direction].pattern;
        if (originalPattern !== PATTERN.F3 && originalPattern !== PATTERN.F3S) continue;

        const { dx, dy } = DIRECTIONS[direction];
        const x0 = idx % SIZE;
        const y0 = Math.floor(idx / SIZE);
        let real = false;

        for (const sign of [-1, 1]) {
          let x = x0;
          let y = y0;
          for (let step = 0; step < 4; step++) {
            x += dx * sign;
            y += dy * sign;
            if (!inBoard(x, y)) break;
            const p = indexOf(x, y);
            const value = board[p];
            if (value === BLACK) continue;
            if (value === EMPTY) {
              const extension = classifyPoint(board, p, BLACK, rule, system);
              const linePattern = extension.directions[direction].pattern;
              if (extension.pattern4 === PATTERN4.B_FLEX4 || linePattern === PATTERN.F5) {
                real = true;
              } else if (extension.pattern4 === PATTERN4.FORBID && linePattern === PATTERN.F4) {
                const nested = getForbiddenInfo(board, p, rule, system, cache);
                real = !nested.forbidden;
              }
            }
            break;
          }
          if (real) break;
        }

        if (real) realThreeDirections++;
        if (realThreeDirections >= 2) break;
      }
    } finally {
      board[idx] = EMPTY;
    }

    const result = realThreeDirections >= 2
      ? {
          forbidden: true,
          type: '三三禁手',
          detail: `共有 ${realThreeDirections} 個方向能經合法延伸形成真正活四`,
          analysis,
        }
      : {
          forbidden: false,
          type: '假禁手',
          detail: '初篩看似雙三，但不足兩個方向具有合法活四延伸點',
          analysis,
        };

    cache.set(memoKey, result);
    return result;
  }

  function comparePoint(board, idx, side, rule) {
    const reference = classifyPoint(board, idx, side, rule, 'reference');
    const optimized = classifyPoint(board, idx, side, rule, 'optimized');
    const referenceForbidden = side === BLACK
      ? getForbiddenInfo(board, idx, rule, 'reference')
      : { forbidden: false, type: '不適用', detail: '白棋沒有禁手' };
    const optimizedForbidden = side === BLACK
      ? getForbiddenInfo(board, idx, rule, 'optimized')
      : { forbidden: false, type: '不適用', detail: '白棋沒有禁手' };

    const directionMatches = reference.directions.map((item, i) => item.pattern === optimized.directions[i].pattern);
    const forbiddenMatch = referenceForbidden.forbidden === optimizedForbidden.forbidden &&
      referenceForbidden.type === optimizedForbidden.type;

    return {
      idx,
      side,
      rule,
      reference,
      optimized,
      referenceForbidden,
      optimizedForbidden,
      directionMatches,
      pattern4Match: reference.pattern4 === optimized.pattern4,
      forbiddenMatch,
      allMatch: directionMatches.every(Boolean) && reference.pattern4 === optimized.pattern4 && forbiddenMatch,
      optimizedBuildMs,
    };
  }

  function coordinateName(idx) {
    const x = idx % SIZE;
    const y = Math.floor(idx / SIZE);
    return `${String.fromCharCode(65 + x)}${y + 1}`;
  }

  return Object.freeze({
    SIZE,
    EMPTY,
    BLACK,
    WHITE,
    RULES,
    PATTERN,
    PATTERN_NAMES,
    PATTERN_ZH,
    PATTERN4,
    PATTERN4_NAMES,
    PATTERN4_ZH,
    DIRECTIONS,
    ensureOptimizedTables,
    classifyPoint,
    getForbiddenInfo,
    comparePoint,
    coordinateName,
  });
});
