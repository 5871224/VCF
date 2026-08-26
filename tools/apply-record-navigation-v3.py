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


# ------------------------------------------------------------------
# makevcf-layout.js
# ------------------------------------------------------------------
path = "makevcf-layout.js"
s = read(path)

s = replace_once(
    s,
    "  controlStack.append(annotationCard, searchCard, analysisCard);\n  topGrid.append(boardCard, controlStack);\n",
    "  boardCard.appendChild(annotationCard);\n  controlStack.append(searchCard, analysisCard);\n  topGrid.append(boardCard, controlStack);\n",
    "annotation visible in board card",
)

anchor = '''  let replaySignature = "";
  let replayPly = 0;
  let importedTree = null;

'''
insert = '''  let replaySignature = "";
  let replayPly = 0;
  let importedTree = null;

  function renderNextMoveMarker(move) {
    let layer = board.querySelector("#vcf-record-next-move-layer");
    if (!layer) {
      layer = document.createElementNS("http://www.w3.org/2000/svg", "g");
      layer.id = "vcf-record-next-move-layer";
      layer.setAttribute("pointer-events", "none");
      board.appendChild(layer);
    }
    while (layer.firstChild) layer.firstChild.remove();
    const index = Number(move);
    if (!Number.isInteger(index) || index < 0 || index >= BOARD_CELLS) return;
    const x = index % BOARD_SIZE;
    const y = Math.floor(index / BOARD_SIZE);
    const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    circle.setAttribute("cx", 22 + x * 34);
    circle.setAttribute("cy", 22 + y * 34);
    circle.setAttribute("r", 13);
    circle.setAttribute("fill", "none");
    circle.setAttribute("stroke", "#1976c9");
    circle.setAttribute("stroke-width", "3");
    circle.setAttribute("vector-effect", "non-scaling-stroke");
    layer.appendChild(circle);
  }

'''
s = replace_once(s, anchor, insert, "next move marker")

old = '''  window.addEventListener("vcf-record-state-changed", event => {
    if (importedTree || document.activeElement === recordCommentInput) return;
    syncCommentEditorFromRecordText(event.detail?.recordText || "");
  });
'''
new = '''  window.addEventListener("vcf-record-state-changed", event => {
    if (importedTree) return;
    if (document.activeElement !== recordCommentInput) {
      syncCommentEditorFromRecordText(event.detail?.recordText || "");
    }
    renderNextMoveMarker(event.detail?.selectedNextMove);
  });
'''
s = replace_once(s, old, new, "record state listener")

old = '''  function renderRecordAnnotations(node) {
    setCommentEditorValue(node?.comment || "");
    recordCommentMeta.textContent = "目前盤面注釋；修改後會自動保存，匯出 DB 時一併寫入。";
    let layer = board.querySelector("#vcf-record-text-layer");
'''
new = '''  function renderRecordAnnotations(node) {
    setCommentEditorValue(node?.comment || "");
    recordCommentMeta.textContent = "目前盤面注釋；修改後會自動保存，匯出 DB 時一併寫入。";
    const children = node?.children || [];
    const selectedIndex = Math.max(0, Math.min(children.length - 1, Number(node?.selectedChild || 0)));
    renderNextMoveMarker(children[selectedIndex]?.move);
    let layer = board.querySelector("#vcf-record-text-layer");
'''
s = replace_once(s, old, new, "imported marker render")

old = '''    if (current.children.length > 1) {
      const count = current.children.length;
      const nextIndex = ((current.selectedChild || 0) + direction + count) % count;
      current.selectedChild = nextIndex;
      renderImportedNode(current.children[nextIndex]);
      return true;
    }
'''
new = '''    if (current.children.length > 1) {
      const count = current.children.length;
      const nextIndex = ((current.selectedChild || 0) + direction + count) % count;
      current.selectedChild = nextIndex;
      renderNextMoveMarker(current.children[nextIndex]?.move);
      importedStatus();
      return true;
    }
'''
s = replace_once(s, old, new, "imported child branch selection")

old = '''  prevStepButton.addEventListener("click", () => {
    if (!moveImportedStep(-1)) moveVcfReplay(-1);
  });
  nextStepButton.addEventListener("click", () => {
    if (!moveImportedStep(1)) moveVcfReplay(1);
  });

  previousBranchButton.addEventListener("click", () => {
    if (moveImportedBranch(-1)) return;
    if (typeof vcfGroups !== "undefined" && Array.isArray(vcfGroups) && vcfGroups.length && typeof setVcfGroup === "function") {
      if (Number(vcfGroupIdx) > 0) setVcfGroup(Number(vcfGroupIdx) - 1);
      else if (typeof setStatus === "function") setStatus("目前已是第一個 VCF 分支");
      replaySignature = "";
      replayPly = 0;
      return;
    }
    if (typeof setStatus === "function") setStatus("目前沒有可切換的前一分支");
  });
  nextBranchButton.addEventListener("click", () => {
    if (moveImportedBranch(1)) return;
    if (typeof vcfGroups !== "undefined" && Array.isArray(vcfGroups) && vcfGroups.length && typeof setVcfGroup === "function") {
      if (Number(vcfGroupIdx) < vcfGroups.length - 1) setVcfGroup(Number(vcfGroupIdx) + 1);
      else if (typeof setStatus === "function") setStatus("目前已是最後一個 VCF 分支");
      replaySignature = "";
      replayPly = 0;
      return;
    }
    if (typeof setStatus === "function") setStatus("目前沒有可切換的後一分支");
  });
'''
new = '''  prevStepButton.addEventListener("click", () => {
    if (moveImportedStep(-1)) return;
    if (currentReplayRoute().length) {
      moveVcfReplay(-1);
      const route = ensureReplayState();
      renderNextMoveMarker(route[replayPly]);
      return;
    }
    if (window.VCFWorkbenchRecord?.navigateStep?.(-1)) return;
    if (typeof setStatus === "function") setStatus("目前已是棋譜起點");
  });
  nextStepButton.addEventListener("click", () => {
    if (moveImportedStep(1)) return;
    if (currentReplayRoute().length) {
      moveVcfReplay(1);
      const route = ensureReplayState();
      renderNextMoveMarker(route[replayPly]);
      return;
    }
    if (window.VCFWorkbenchRecord?.navigateStep?.(1)) return;
    if (typeof setStatus === "function") setStatus("目前沒有下一手");
  });

  previousBranchButton.addEventListener("click", () => {
    if (moveImportedBranch(-1)) return;
    if (typeof vcfGroups !== "undefined" && Array.isArray(vcfGroups) && vcfGroups.length && typeof setVcfGroup === "function") {
      if (Number(vcfGroupIdx) > 0) setVcfGroup(Number(vcfGroupIdx) - 1);
      else if (typeof setStatus === "function") setStatus("目前已是第一個 VCF 分支");
      replaySignature = "";
      replayPly = 0;
      return;
    }
    if (window.VCFWorkbenchRecord?.navigateBranch?.(-1)) return;
    if (typeof setStatus === "function") setStatus("目前沒有可切換的前一分支");
  });
  nextBranchButton.addEventListener("click", () => {
    if (moveImportedBranch(1)) return;
    if (typeof vcfGroups !== "undefined" && Array.isArray(vcfGroups) && vcfGroups.length && typeof setVcfGroup === "function") {
      if (Number(vcfGroupIdx) < vcfGroups.length - 1) setVcfGroup(Number(vcfGroupIdx) + 1);
      else if (typeof setStatus === "function") setStatus("目前已是最後一個 VCF 分支");
      replaySignature = "";
      replayPly = 0;
      return;
    }
    if (window.VCFWorkbenchRecord?.navigateBranch?.(1)) return;
    if (typeof setStatus === "function") setStatus("目前沒有可切換的後一分支");
  });
'''
s = replace_once(s, old, new, "manual navigation buttons")

style_anchor = '''    .vcf-control-stack {
      display: grid;
      gap: 14px;
    }
'''
style_new = '''    .vcf-control-stack {
      display: grid;
      gap: 14px;
    }

    .vcf-board-card > .vcf-annotation-card {
      margin-top: 12px;
      padding: 11px;
      border-radius: 9px;
      background: #faf6e9;
      box-shadow: none;
    }
'''
s = replace_once(s, style_anchor, style_new, "inline annotation style")
write(path, s)


# ------------------------------------------------------------------
# rapfi/rapfi-workbench-header.js — replace linear history with branch tree
# ------------------------------------------------------------------
path = "rapfi/rapfi-workbench-header.js"
s = read(path)
start = s.index('  function installWorkbenchRecordState() {')
end = s.index('\n  installWorkbenchRecordState();', start)
new_block = r'''  function installWorkbenchRecordState() {
    const STORAGE_KEY = "vcf_board_record_tree_v3";
    const LEGACY_STORAGE_KEY = "vcf_board_history_v2";
    const readBoard = () => normalizeBoard(global._getArr?.());
    const oppositeStone = stone => stone === BLACK ? WHITE : BLACK;

    const makeNode = (move = null, stone = 0, recordText = "", parent = null) => ({
      move,
      stone,
      recordText: String(recordText || ""),
      children: [],
      selectedChild: 0,
      parent,
    });
    const hydrateNode = (raw, parent = null) => {
      const node = makeNode(
        Number.isInteger(Number(raw?.move)) ? Number(raw.move) : null,
        Number(raw?.stone) === BLACK || Number(raw?.stone) === WHITE ? Number(raw.stone) : 0,
        typeof raw?.recordText === "string" ? raw.recordText : "",
        parent,
      );
      node.children = Array.isArray(raw?.children) ? raw.children.map(child => hydrateNode(child, node)) : [];
      node.selectedChild = node.children.length
        ? Math.max(0, Math.min(node.children.length - 1, Number(raw?.selectedChild || 0)))
        : 0;
      return node;
    };
    const serializeNode = node => ({
      move: node.move,
      stone: node.stone,
      recordText: node.recordText || "",
      selectedChild: Number(node.selectedChild || 0),
      children: node.children.map(serializeNode),
    });
    const historyForNode = node => {
      const result = [];
      let cursor = node;
      while (cursor?.parent) {
        result.push({ index: cursor.move, stone: cursor.stone, recordText: cursor.recordText || "" });
        cursor = cursor.parent;
      }
      return result.reverse();
    };
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
    const pathIndices = node => {
      const result = [];
      let cursor = node;
      while (cursor?.parent) {
        const index = cursor.parent.children.indexOf(cursor);
        if (index < 0) return [];
        result.push(index);
        cursor = cursor.parent;
      }
      return result.reverse();
    };
    const nodeAtPath = (root, path) => {
      let node = root;
      for (const rawIndex of Array.isArray(path) ? path : []) {
        const index = Number(rawIndex);
        if (!Number.isInteger(index) || !node.children[index]) return null;
        node = node.children[index];
      }
      return node;
    };
    const buildLinearTree = (history, rootRecordText = "") => {
      const root = makeNode(null, 0, rootRecordText, null);
      let node = root;
      for (const raw of history || []) {
        const child = makeNode(Number(raw.index), Number(raw.stone), raw.recordText || "", node);
        node.children.push(child);
        node.selectedChild = 0;
        node = child;
      }
      return { root, current: node };
    };

    let root = makeNode();
    let current = root;
    let exact = false;
    let lastBoard = readBoard();
    let restored = false;

    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
      if (saved?.tree) {
        const candidateRoot = hydrateNode(saved.tree);
        const candidateCurrent = nodeAtPath(candidateRoot, saved.currentPath) || candidateRoot;
        const candidateBoard = replay(historyForNode(candidateCurrent));
        if (candidateBoard && boardsEqual(candidateBoard, lastBoard)) {
          root = candidateRoot;
          current = candidateCurrent;
          exact = saved.exact !== false;
          restored = true;
        }
      }
    } catch (_) {}

    if (!restored) {
      try {
        const saved = JSON.parse(localStorage.getItem(LEGACY_STORAGE_KEY) || "null");
        const legacyHistory = Array.isArray(saved?.history) ? saved.history.map(item => ({
          index: Number(item.index),
          stone: Number(item.stone),
          recordText: typeof item.recordText === "string" ? item.recordText : "",
        })) : [];
        const legacyBoard = replay(legacyHistory);
        if (legacyBoard && boardsEqual(legacyBoard, lastBoard)) {
          const linear = buildLinearTree(legacyHistory, typeof saved?.rootRecordText === "string" ? saved.rootRecordText : "");
          root = linear.root;
          current = linear.current;
          exact = saved?.exact !== false;
          restored = true;
        }
      } catch (_) {}
    }

    if (!lastBoard.some(Boolean) && !restored) {
      root = makeNode();
      current = root;
      exact = true;
    }

    const currentHistory = () => historyForNode(current);
    const currentRecordText = () => String(current?.recordText || "");
    const selectedNextNode = () => {
      if (!exact || !current?.children?.length) return null;
      current.selectedChild = Math.max(0, Math.min(current.children.length - 1, Number(current.selectedChild || 0)));
      return current.children[current.selectedChild] || null;
    };
    const persist = () => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({
          tree: serializeNode(root),
          currentPath: pathIndices(current),
          exact,
        }));
      } catch (_) {}
    };
    const notify = () => {
      const next = selectedNextNode();
      const siblings = current?.parent?.children || [];
      global.dispatchEvent(new CustomEvent("vcf-record-state-changed", {
        detail: {
          recordText: currentRecordText(),
          exact,
          ply: currentHistory().length,
          canPrev: Boolean(exact && current?.parent),
          canNext: Boolean(next),
          selectedNextMove: next?.move ?? null,
          nextBranchCount: current?.children?.length || 0,
          siblingCount: siblings.length,
          siblingIndex: siblings.indexOf(current),
        },
      }));
    };
    const applyCurrentBoard = () => {
      if (!exact) return false;
      const history = currentHistory();
      const board = replay(history);
      if (!board) return false;
      const sideToMove = history.length % 2 === 0 ? BLACK : WHITE;
      const apply = () => global._setBoardArr?.(Array.from(board), sideToMove);
      if (typeof global.vcfWithBoardChangeSource === "function") {
        global.vcfWithBoardChangeSource("record-navigation", apply);
      } else {
        apply();
      }
      lastBoard = new Uint8Array(board);
      persist();
      notify();
      return true;
    };
    const resetToHistory = (nextHistory, nextExact, nextRootRecordText = "") => {
      const normalized = Array.isArray(nextHistory) ? nextHistory.map(item => ({
        index: Number(item.index ?? item.move),
        stone: Number(item.stone ?? item.color),
        recordText: typeof item.recordText === "string" ? item.recordText : "",
      })) : [];
      const rebuilt = replay(normalized);
      const board = readBoard();
      const valid = Boolean(rebuilt && boardsEqual(rebuilt, board));
      const linear = buildLinearTree(valid ? normalized : [], nextRootRecordText);
      root = linear.root;
      current = linear.current;
      exact = Boolean(nextExact && valid);
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
          const expected = currentHistory().length % 2 === 0 ? BLACK : WHITE;
          if (after === expected) {
            let childIndex = current.children.findIndex(child => child.move === index && child.stone === after);
            if (childIndex < 0) {
              const child = makeNode(index, after, "", current);
              current.children.push(child);
              childIndex = current.children.length - 1;
            }
            current.selectedChild = childIndex;
            current = current.children[childIndex];
          } else {
            exact = false;
          }
        } else if (before && !after && current?.parent && current.move === index && current.stone === before) {
          const parentBoard = replay(historyForNode(current.parent));
          if (parentBoard && boardsEqual(parentBoard, board)) current = current.parent;
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
      queueMicrotask(() => {
        root = makeNode();
        current = root;
        exact = true;
        lastBoard = readBoard();
        persist();
        notify();
      });
    });
    document.getElementById("btn-import-apply")?.addEventListener("click", () => {
      queueMicrotask(() => {
        root = makeNode();
        current = root;
        exact = false;
        lastBoard = readBoard();
        persist();
        notify();
      });
    });

    global.VCFWorkbenchRecord = {
      snapshot() {
        return {
          history: currentHistory().map(item => ({ ...item })),
          exact,
          board: Array.from(lastBoard),
          rootRecordText: String(root.recordText || ""),
        };
      },
      currentRecordText,
      setCurrentRecordText(text) {
        current.recordText = String(text || "");
        persist();
        notify();
      },
      setHistory(nextHistory, nextExact = true, nextRootRecordText = root.recordText || "") {
        resetToHistory(nextHistory, nextExact, nextRootRecordText);
      },
      navigateStep(direction) {
        if (!exact) return false;
        if (direction < 0) {
          if (!current.parent) return false;
          current = current.parent;
          return applyCurrentBoard();
        }
        const next = selectedNextNode();
        if (!next) return false;
        current = next;
        return applyCurrentBoard();
      },
      navigateBranch(direction) {
        if (!exact) return false;
        const siblings = current?.parent?.children || [];
        if (siblings.length > 1) {
          const index = siblings.indexOf(current);
          const nextIndex = (index + Number(direction || 1) + siblings.length) % siblings.length;
          current.parent.selectedChild = nextIndex;
          current = siblings[nextIndex];
          return applyCurrentBoard();
        }
        if (current.children.length > 1) {
          const count = current.children.length;
          current.selectedChild = (Number(current.selectedChild || 0) + Number(direction || 1) + count) % count;
          persist();
          notify();
          return true;
        }
        return false;
      },
      invalidate() {
        exact = false;
        lastBoard = readBoard();
        persist();
        notify();
      },
    };
    persist();
    notify();
  }
'''
s = s[:start] + new_block + s[end:]
write(path, s)


# ------------------------------------------------------------------
# makevcf.html cache bust changed UI scripts
# ------------------------------------------------------------------
path = "makevcf.html"
s = read(path)
s = replace_once(s, '<script src="makevcf-layout.js"></script>', '<script src="makevcf-layout.js?v=20260826-record-v3"></script>', "layout cache bust")
s = replace_once(s, '<script src="rapfi/rapfi-workbench-header.js"></script>', '<script src="rapfi/rapfi-workbench-header.js?v=20260826-record-v3"></script>', "header cache bust")
write(path, s)


# ------------------------------------------------------------------
# architecture tests
# ------------------------------------------------------------------
path = "tests/workbench-architecture.test.js"
s = read(path)
append = r'''

// Manual record-tree navigation and visible annotation contract.
for (const token of [
  'boardCard.appendChild(annotationCard)',
  'recordCommentInput.id = "vcf-record-comment-input"',
  'renderNextMoveMarker',
  'vcf-record-next-move-layer',
  'VCFWorkbenchRecord?.navigateStep?.(-1)',
  'VCFWorkbenchRecord?.navigateStep?.(1)',
  'VCFWorkbenchRecord?.navigateBranch?.(-1)',
  'VCFWorkbenchRecord?.navigateBranch?.(1)',
]) if (!layout.includes(token)) throw new Error(`manual record navigation contract missing: ${token}`);
for (const token of [
  'vcf_board_record_tree_v3',
  'navigateStep(direction)',
  'navigateBranch(direction)',
  'selectedNextMove',
  'children: []',
]) if (!header.includes(token)) throw new Error(`record tree state contract missing: ${token}`);
const entry = read("makevcf.html");
if (!entry.includes('makevcf-layout.js?v=20260826-record-v3') || !entry.includes('rapfi/rapfi-workbench-header.js?v=20260826-record-v3')) {
  throw new Error("record UI scripts must be cache-busted after navigation model change");
}
'''
if 'Manual record-tree navigation and visible annotation contract.' not in s:
    s += append
write(path, s)


# ------------------------------------------------------------------
# spec
# ------------------------------------------------------------------
path = "規格書.MD"
s = read(path)
old = '- 工作台可直接讀取 Rapfi YXDB `.db`（含 Rapfi 預設 LZ4 frame）與 RenLib `.lib`；棋盤下方固定顯示「棋譜導覽」，提供「上一步、下一步、前一分支、後一分支」四個按鈕。沒有可瀏覽內容時按鈕仍保留固定位置，不得因無棋譜而隱藏。\n'
new = old + '- 手動打譜也使用可分支的棋譜樹保存目前節點、父節點、子節點與選定子分支；退回既有局面後改下其他落點時建立新分支，不覆蓋原分支。「上一步、下一步、前一分支、後一分支」同時適用於手動棋譜與已讀取的 DB／LIB。\n- 棋盤卡片內固定顯示「注釋」編輯區；每個盤面各自保存 `DBRecord.text`，切換手數或分支時同步顯示，修改後自動保存並隨 YXDB 匯出。\n- 目前棋譜節點若存在下一手，棋盤必須在選定分支的下一手落點顯示圓圈提示；同一節點有多個子分支時，前一／後一分支可切換選定子分支，圓圈同步移動。\n'
s = replace_once(s, old, new, "record navigation spec")
write(path, s)

print("record navigation v3 patch applied")
