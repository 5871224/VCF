from pathlib import Path

header = Path("rapfi/rapfi-workbench-header.js")
s = header.read_text(encoding="utf-8")

# Programmatic callers that omit historyExact retain the old deterministic setup
# behavior; the workbench UI always passes an explicit boolean, so UI exports
# never silently change the user's move order.
s = s.replace(
    "function collectYXDBPositions(rootBoard, routes, attacker, rule, history = [], historyExact = true) {",
    "function collectYXDBPositions(rootBoard, routes, attacker, rule, history = [], historyExact = null) {",
    1,
)
s = s.replace(
    "function createYXDB({ board, routes = [], attacker = 0, rule = 2, history = [], historyExact = true }) {",
    "function createYXDB({ board, routes = [], attacker = 0, rule = 2, history = [], historyExact = null }) {",
    1,
)
old = '''    const setupHistory = normalizeSetupHistory(history, rootBoard);
    if (!setupHistory) {
      throw new Error("目前盤面的落子 history 與棋盤不一致；為避免匯出錯誤手順，請清空後依原手順重新落子。");
    }
    for (const move of setupHistory) {
      setupBoard[move.index] = move.stone;
      add(setupBoard, move.recordText);
    }'''
new = '''    const setupHistory = normalizeSetupHistory(history, rootBoard);
    if (!setupHistory && historyExact == null) {
      const canonical = canonicalPosition(rootBoard);
      const count = Math.max(canonical.black.length, canonical.white.length);
      for (let i = 0; i < count; i++) {
        if (i < canonical.black.length) {
          const [x, y] = canonical.black[i];
          setupBoard[y * BOARD_SIZE + x] = BLACK;
          add(setupBoard);
        }
        if (i < canonical.white.length) {
          const [x, y] = canonical.white[i];
          setupBoard[y * BOARD_SIZE + x] = WHITE;
          add(setupBoard);
        }
      }
      return;
    }
    if (!setupHistory) {
      throw new Error("目前盤面的落子 history 與棋盤不一致；為避免匯出錯誤手順，請清空後依原手順重新落子。");
    }
    for (const move of setupHistory) {
      setupBoard[move.index] = move.stone;
      add(setupBoard, move.recordText);
    }'''
if old not in s:
    raise SystemExit("YXDB history backcompat anchor not found")
s = s.replace(old, new, 1)

s = s.replace(
    "function buildRenLibTree(rootBoard, routes, attacker, history = [], historyExact = true) {",
    "function buildRenLibTree(rootBoard, routes, attacker, history = [], historyExact = null) {",
    1,
)
s = s.replace(
    "function createRenLib({ board, routes = [], attacker = 0, history = [], historyExact = true }) {",
    "function createRenLib({ board, routes = [], attacker = 0, history = [], historyExact = null }) {",
    1,
)
old = '''    if (stoneCount.black + stoneCount.white === 0) {
      setupMoves = [];
    } else if (historyExact !== false && setupHistory) {
      setupMoves = setupHistory.map(move => move.index);
    } else {
      throw new Error("目前盤面沒有可驗證的原始落子 history；為避免 LIB 手順改變，請清空後依原手順重新落子。");
    }'''
new = '''    if (stoneCount.black + stoneCount.white === 0) {
      setupMoves = [];
    } else if (historyExact !== false && setupHistory) {
      setupMoves = setupHistory.map(move => move.index);
    } else if (historyExact == null) {
      setupMoves = deterministicSetupMoves(rootBoard, routeList.length ? attacker : 0).moves;
    } else {
      throw new Error("目前盤面沒有可驗證的原始落子 history；為避免 LIB 手順改變，請清空後依原手順重新落子。");
    }'''
if old not in s:
    raise SystemExit("RenLib history backcompat anchor not found")
s = s.replace(old, new, 1)

header.write_text(s, encoding="utf-8")
