from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

def read(path):
    return (ROOT / path).read_text(encoding="utf-8")

def write(path, text):
    (ROOT / path).write_text(text, encoding="utf-8")

def replace_once(text, old, new, label):
    if old not in text:
        raise SystemExit(f"missing anchor: {label}")
    if text.count(old) != 1:
        raise SystemExit(f"anchor not unique: {label} ({text.count(old)})")
    return text.replace(old, new, 1)

# ---- makevcf-layout.js ----
path = "makevcf-layout.js"
s = read(path)

old = '''  const controlStack = document.createElement("div");
  controlStack.className = "vcf-control-stack";

  const searchCard = makeCard("基本搜尋", "選擇規則後，直接尋找黑方或白方 VCF。", "vcf-search-card");
'''
new = '''  const controlStack = document.createElement("div");
  controlStack.className = "vcf-control-stack";

  const annotationCard = makeCard("注釋", "每個盤面各自保存 Rapfi DBRecord 注釋；切換棋譜時同步顯示。", "vcf-annotation-card");
  const recordCommentInput = document.createElement("textarea");
  recordCommentInput.id = "vcf-record-comment-input";
  recordCommentInput.rows = 7;
  recordCommentInput.placeholder = "輸入目前盤面的注釋……";
  recordCommentInput.setAttribute("aria-label", "目前盤面注釋");
  const recordCommentMeta = document.createElement("div");
  recordCommentMeta.id = "vcf-record-comment-meta";
  recordCommentMeta.className = "vcf-record-comment-meta";
  recordCommentMeta.textContent = "注釋會保存到目前盤面的 DBRecord.text。";
  annotationCard.append(recordCommentInput, recordCommentMeta);

  const searchCard = makeCard("基本搜尋", "選擇規則後，直接尋找黑方或白方 VCF。", "vcf-search-card");
'''
s = replace_once(s, old, new, "annotation card insertion")
s = replace_once(s, "  controlStack.append(searchCard, analysisCard);\n", "  controlStack.append(annotationCard, searchCard, analysisCard);\n", "control stack")

old = '''  const recordComment = document.createElement("div");
  recordComment.id = "vcf-record-comment";
  recordComment.className = "vcf-record-comment";
  recordComment.textContent = "注譯：—";
  recordNavigation.appendChild(recordComment);

'''
s = replace_once(s, old, "", "remove old read-only annotation")

old = '''  function orientBoardTexts(boardTexts, transform) {
    return (boardTexts || []).map(item => {
      const [x, y] = transformXY(item.x, item.y, transform);
      return { x, y, text: item.text };
    });
  }

  function parseYXDB(rawBytes) {
'''
new = '''  function orientBoardTexts(boardTexts, transform) {
    return (boardTexts || []).map(item => {
      const [x, y] = transformXY(item.x, item.y, transform);
      return { x, y, text: item.text };
    });
  }

  // 修改注釋時只替換 DBRecord.text 的 comment 部分；若原 record 含 @BTXT@
  // 盤面文字，保留其原始座標與內容，避免只改注釋卻重寫盤面標記。
  function replaceRapfiComment(recordText, comment) {
    const raw = String(recordText || "").replace(/\\0+$/g, "");
    const encoded = String(comment ?? "").replace(/\\r\\n?/g, "\\n").replace(/\\n/g, "\\b");
    if (!raw.startsWith("@BTXT@")) return encoded;
    const separator = raw.indexOf("\\b");
    const prefix = separator >= 0 ? raw.slice(0, separator + 1) : `${raw}\\b`;
    return `${prefix}${encoded}`;
  }

  function setCommentEditorValue(value) {
    const next = String(value || "");
    if (recordCommentInput.value !== next) recordCommentInput.value = next;
  }

  function syncCommentEditorFromRecordText(recordText) {
    const meta = parseRapfiRecordText(recordText || "");
    setCommentEditorValue(meta.comment || "");
    recordCommentMeta.textContent = "目前盤面注釋；修改後會自動保存，匯出 DB 時一併寫入。";
  }

  function saveCommentEditorValue() {
    const comment = recordCommentInput.value;
    if (importedTree?.current) {
      const node = importedTree.current;
      node.comment = comment;
      node.recordText = replaceRapfiComment(node.recordText, comment);
      window.VCFWorkbenchRecord?.setCurrentRecordText?.(node.recordText);
    } else {
      const currentText = window.VCFWorkbenchRecord?.currentRecordText?.() || "";
      window.VCFWorkbenchRecord?.setCurrentRecordText?.(replaceRapfiComment(currentText, comment));
    }
    recordCommentMeta.textContent = "已保存於目前盤面；匯出 DB 時會寫入 DBRecord.text。";
  }

  recordCommentInput.addEventListener("input", saveCommentEditorValue);
  window.addEventListener("vcf-record-state-changed", event => {
    if (importedTree || document.activeElement === recordCommentInput) return;
    syncCommentEditorFromRecordText(event.detail?.recordText || "");
  });

  function parseYXDB(rawBytes) {
'''
s = replace_once(s, old, new, "comment editor helpers")

old = '''  function renderRecordAnnotations(node) {
    if (recordComment) recordComment.textContent = node?.comment ? `注譯：${node.comment}` : "注譯：—";
    let layer = board.querySelector("#vcf-record-text-layer");
'''
new = '''  function renderRecordAnnotations(node) {
    setCommentEditorValue(node?.comment || "");
    recordCommentMeta.textContent = "目前盤面注釋；修改後會自動保存，匯出 DB 時一併寫入。";
    let layer = board.querySelector("#vcf-record-text-layer");
'''
s = replace_once(s, old, new, "render annotation editor")

old = '''  function historyForImportedNode(node) {
    const reversed = [];
    let cursor = node;
    while (cursor?.parent) {
      if (Number.isInteger(cursor.move) && cursor.move >= 0) {
        reversed.push({
          index: cursor.move,
          stone: opposite(cursor.sideToMove),
          recordText: cursor.recordText || "",
        });
      }
      cursor = cursor.parent;
    }
    return reversed.reverse();
  }
'''
new = '''  function historyForImportedNode(node) {
    const reversed = [];
    let rootRecordText = "";
    let cursor = node;
    while (cursor?.parent) {
      if (!cursor.synthetic && cursor.ply === 0) rootRecordText = cursor.recordText || "";
      if (Number.isInteger(cursor.move) && cursor.move >= 0) {
        reversed.push({
          index: cursor.move,
          stone: opposite(cursor.sideToMove),
          recordText: cursor.recordText || "",
        });
      }
      cursor = cursor.parent;
    }
    return { history: reversed.reverse(), rootRecordText };
  }
'''
s = replace_once(s, old, new, "imported history with root annotation")

old = '''    const applyBoard = () => {
      window._setBoardArr?.(Array.from(node.board), node.sideToMove);
      window.VCFWorkbenchRecord?.setHistory?.(historyForImportedNode(node), true);
    };
'''
new = '''    const applyBoard = () => {
      window._setBoardArr?.(Array.from(node.board), node.sideToMove);
      const recordState = historyForImportedNode(node);
      window.VCFWorkbenchRecord?.setHistory?.(recordState.history, true, recordState.rootRecordText);
    };
'''
s = replace_once(s, old, new, "render imported history")

old = '''  window.addEventListener("vcf-board-changed", event => {
    if (!importedTree || event.detail?.source === "record-playback") return;
    importedTree = null;
  });
'''
new = '''  window.addEventListener("vcf-board-changed", event => {
    if (event.detail?.source === "record-playback") return;
    if (importedTree) importedTree = null;
    queueMicrotask(() => syncCommentEditorFromRecordText(window.VCFWorkbenchRecord?.currentRecordText?.() || ""));
  });
'''
s = replace_once(s, old, new, "board change comment sync")

old = '''    .vcf-record-comment {
      width: 100%;
      min-height: 32px;
      padding: 7px 9px;
      border: 1px solid var(--vcf-line);
      border-radius: 6px;
      background: #fffdf5;
      color: var(--vcf-text);
      font-size: 13px;
      line-height: 1.45;
      white-space: pre-wrap;
    }
'''
new = '''    .vcf-annotation-card textarea {
      width: 100%;
      min-height: 150px;
      padding: 10px 11px;
      border: 1px solid #cfc3a4;
      border-radius: 8px;
      background: #fffefa;
      color: var(--vcf-text);
      font: inherit;
      font-size: 14px;
      line-height: 1.55;
      resize: vertical;
    }

    .vcf-annotation-card textarea:focus {
      outline: 2px solid #8ba8c455;
      border-color: #789abb;
    }

    .vcf-record-comment-meta {
      margin-top: 7px;
      color: var(--vcf-muted);
      font-size: 12px;
      line-height: 1.4;
    }
'''
s = replace_once(s, old, new, "annotation editor style")

write(path, s)

# ---- rapfi/rapfi-workbench-header.js ----
path = "rapfi/rapfi-workbench-header.js"
s = read(path)
s = replace_once(s,
'''  function addYXDBSetupPath(rootBoard, add, history, historyExact) {
    const setupBoard = new Uint8Array(BOARD_CELLS);
    add(setupBoard);
''',
'''  function addYXDBSetupPath(rootBoard, add, history, historyExact, rootRecordText = "") {
    const setupBoard = new Uint8Array(BOARD_CELLS);
    add(setupBoard, rootRecordText);
''', "YXDB root record text")
s = replace_once(s,
'''  function collectYXDBPositions(rootBoard, routes, attacker, rule, history = [], historyExact = null) {
''',
'''  function collectYXDBPositions(rootBoard, routes, attacker, rule, history = [], historyExact = null, rootRecordText = "") {
''', "collect root record text")
s = replace_once(s,
'''    addYXDBSetupPath(rootBoard, add, history, historyExact);
''',
'''    addYXDBSetupPath(rootBoard, add, history, historyExact, rootRecordText);
''', "pass root record text")
s = replace_once(s,
'''  function createYXDB({ board, routes = [], attacker = 0, rule = 2, history = [], historyExact = null }) {
''',
'''  function createYXDB({ board, routes = [], attacker = 0, rule = 2, history = [], historyExact = null, rootRecordText = "" }) {
''', "create YXDB root text")
s = replace_once(s,
'''    const records = collectYXDBPositions(normalizedBoard, routeList, side, normalizedRule, history, historyExact);
''',
'''    const records = collectYXDBPositions(normalizedBoard, routeList, side, normalizedRule, history, historyExact, rootRecordText);
''', "collect YXDB root text")

start = s.index('  function installWorkbenchRecordState() {')
end = s.index('\n  installWorkbenchRecordState();', start)
new_block = r'''  function installWorkbenchRecordState() {
    const STORAGE_KEY = "vcf_board_history_v2";
    const readBoard = () => normalizeBoard(global._getArr?.());
    const oppositeStone = stone => stone === BLACK ? WHITE : BLACK;
    const replay = history => {
      const board = new Uint8Array(BOARD_CELLS);
      let expected = BLACK;
      if (!Array.isArray(history)) return null;
      for (const raw of history) {
        const index = Number(raw?.index ?? raw?.move);
        const stone = Number(raw?.stone ?? raw?.color);
        if (!Number.isInteger(index) || index < 0 || index >= BOARD_CELLS || stone !== expected || board[index]) return null;
        board[index] = stone;
        expected = oppositeStone(expected);
      }
      return board;
    };
    let history = [];
    let exact = false;
    let rootRecordText = "";
    let lastBoard = readBoard();

    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
      const restored = replay(saved?.history);
      rootRecordText = typeof saved?.rootRecordText === "string" ? saved.rootRecordText : "";
      if (restored && boardsEqual(restored, lastBoard)) {
        history = saved.history.map(item => ({
          index: Number(item.index),
          stone: Number(item.stone),
          recordText: typeof item.recordText === "string" ? item.recordText : "",
        }));
        exact = saved.exact !== false;
      }
    } catch (_) {}
    if (!lastBoard.some(Boolean)) {
      history = [];
      exact = true;
    }

    const currentRecordText = () => history.length
      ? String(history[history.length - 1]?.recordText || "")
      : String(rootRecordText || "");
    const persist = () => {
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ history, exact, rootRecordText })); } catch (_) {}
    };
    const notify = () => {
      global.dispatchEvent(new CustomEvent("vcf-record-state-changed", {
        detail: { recordText: currentRecordText(), exact, ply: history.length },
      }));
    };
    const setState = (nextHistory, nextExact, board = readBoard(), nextRootRecordText = rootRecordText) => {
      const normalized = Array.isArray(nextHistory) ? nextHistory.map(item => ({
        index: Number(item.index ?? item.move),
        stone: Number(item.stone ?? item.color),
        recordText: typeof item.recordText === "string" ? item.recordText : "",
      })) : [];
      const rebuilt = replay(normalized);
      history = rebuilt && boardsEqual(rebuilt, board) ? normalized : [];
      exact = Boolean(nextExact && rebuilt && boardsEqual(rebuilt, board));
      rootRecordText = typeof nextRootRecordText === "string" ? nextRootRecordText : "";
      if (!board.some(Boolean)) exact = true;
      lastBoard = new Uint8Array(board);
      persist();
      notify();
    };
    const syncAfterManualEdit = () => {
      const board = readBoard();
      const changed = [];
      for (let i = 0; i < BOARD_CELLS; i++) if (board[i] !== lastBoard[i]) changed.push(i);
      if (changed.length === 1 && exact) {
        const index = changed[0];
        const before = lastBoard[index];
        const after = board[index];
        if (!before && (after === BLACK || after === WHITE)) {
          const expected = history.length % 2 === 0 ? BLACK : WHITE;
          if (after === expected) history.push({ index, stone: after, recordText: "" });
          else exact = false;
        } else if (before && !after) {
          const tail = history[history.length - 1];
          if (tail?.index === index && tail?.stone === before) history.pop();
          else exact = false;
        } else {
          exact = false;
        }
      } else if (changed.length) {
        exact = false;
      }
      lastBoard = board;
      persist();
      notify();
    };

    const boardSvg = document.getElementById("board-svg");
    boardSvg?.addEventListener("click", () => queueMicrotask(syncAfterManualEdit));

    document.getElementById("btn-clear")?.addEventListener("click", () => {
      queueMicrotask(() => setState([], true, readBoard(), ""));
    });
    document.getElementById("btn-import-apply")?.addEventListener("click", () => {
      queueMicrotask(() => setState([], false, readBoard(), ""));
    });

    global.VCFWorkbenchRecord = {
      snapshot() {
        return {
          history: history.map(item => ({ ...item })),
          exact,
          board: Array.from(lastBoard),
          rootRecordText,
        };
      },
      currentRecordText,
      setCurrentRecordText(text) {
        const value = String(text || "");
        if (history.length) history[history.length - 1].recordText = value;
        else rootRecordText = value;
        persist();
        notify();
      },
      setHistory(nextHistory, nextExact = true, nextRootRecordText = rootRecordText) {
        setState(nextHistory, nextExact, readBoard(), nextRootRecordText);
      },
      invalidate() { setState([], false, readBoard(), ""); },
    };
    persist();
    notify();
  }
'''
s = s[:start] + new_block + s[end:]

s = replace_once(s,
'''    const recordState = global.VCFWorkbenchRecord?.snapshot?.() || { history: [], exact: !board.some(Boolean) };
    return { board, routes, attacker, rule, history: recordState.history, historyExact: recordState.exact };
''',
'''    const recordState = global.VCFWorkbenchRecord?.snapshot?.() || { history: [], exact: !board.some(Boolean), rootRecordText: "" };
    return {
      board,
      routes,
      attacker,
      rule,
      history: recordState.history,
      historyExact: recordState.exact,
      rootRecordText: recordState.rootRecordText || "",
    };
''', "active export root text")
write(path, s)

# ---- tests/workbench-architecture.test.js ----
path = "tests/workbench-architecture.test.js"
s = read(path)
s = replace_once(s,
'''  'recordNavigation.id = "vcf-record-navigation"',
]) if (!layout.includes(token)) throw new Error(`branch replay contract missing: ${token}`);
''',
'''  'recordNavigation.id = "vcf-record-navigation"',
  'recordCommentInput.id = "vcf-record-comment-input"',
  'replaceRapfiComment',
]) if (!layout.includes(token)) throw new Error(`branch replay contract missing: ${token}`);
''', "layout comment contracts")
s = replace_once(s,
'''  'RenLib (.lib)',
]) if (!header.includes(token)) throw new Error(`Rapfi export contract missing: ${token}`);
''',
'''  'RenLib (.lib)',
  'rootRecordText',
  'setCurrentRecordText',
  'vcf-record-state-changed',
]) if (!header.includes(token)) throw new Error(`Rapfi export contract missing: ${token}`);
''', "header comment contracts")
s = replace_once(s,
'''if (!Buffer.from(routedPayload).includes(Buffer.from('charset="UTF-8"'))) {
  throw new Error("YXDB UTF-8 metadata is missing");
}
''',
'''if (!Buffer.from(routedPayload).includes(Buffer.from('charset="UTF-8"'))) {
  throw new Error("YXDB UTF-8 metadata is missing");
}
const annotatedYXDB = rapfiFormats.createYXDB({
  board: formatBoard,
  rule: 2,
  history: [
    { index: 112, stone: 1, recordText: "第一手盤面注釋" },
    { index: 113, stone: 2, recordText: "第二手盤面注釋" },
  ],
  historyExact: true,
  rootRecordText: "空盤注釋",
});
const annotatedPayload = Buffer.from(unwrapTestLZ4(annotatedYXDB.bytes));
for (const text of ["空盤注釋", "第一手盤面注釋", "第二手盤面注釋"]) {
  if (!annotatedPayload.includes(Buffer.from(text))) throw new Error(`YXDB missing per-position comment: ${text}`);
}
''', "per-position annotation export test")
write(path, s)

# ---- 規格書.MD ----
path = "規格書.MD"
s = read(path)
s = replace_once(s,
'''- 工作台可將目前盤面，以及目前單組或多組 VCF 路線，匯出為 Rapfi／Yixin DB 相容的未壓縮 `.db`（YXDB），或 RenLib 3.x `.lib`。
''',
'''- 工作台可將目前盤面，以及目前單組或多組 VCF 路線，匯出為 Rapfi／Yixin DB 相容的標準 LZ4 frame `.db`（YXDB），或 RenLib 3.x `.lib`。
''', "spec compressed YXDB")
s = replace_once(s,
'''- 工作台可直接讀取 Rapfi YXDB `.db`（含 Rapfi 預設 LZ4 frame）與 RenLib `.lib`；棋盤下方固定顯示「棋譜導覽」，提供「上一步、下一步、前一分支、後一分支」四個按鈕。沒有可瀏覽內容時按鈕仍保留固定位置，不得因無棋譜而隱藏。
''',
'''- 工作台可直接讀取 Rapfi YXDB `.db`（含 Rapfi 預設 LZ4 frame）與 RenLib `.lib`；棋盤下方固定顯示「棋譜導覽」，提供「上一步、下一步、前一分支、後一分支」四個按鈕。沒有可瀏覽內容時按鈕仍保留固定位置，不得因無棋譜而隱藏。
- 工作台棋盤旁固定顯示「注釋」編輯區。YXDB 的每個 canonical 盤面各自對應一筆 `DBRecord.text`；切換上一步、下一步或分支時，編輯區必須同步顯示該盤面的注釋，使用者修改後立即寫回目前棋譜狀態，匯出 `.db` 時一併保存。
- 空盤注釋保存為 `rootRecordText`；第 N 手後的盤面注釋保存於第 N 筆 history 的 `recordText`。若 record text 同時含 Rapfi `@BTXT@` 盤面文字，修改一般注釋不得破壞或重排既有 `@BTXT@` 區段。
''', "spec annotation editor")
write(path, s)
