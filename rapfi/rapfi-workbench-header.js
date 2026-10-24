"use strict";

(function installCompactWorkbenchHeader(global) {
  const ruleNames = { 0: "自由", 1: "無禁", 2: "有禁" };
  const BOARD_SIZE = 15;
  const BOARD_CELLS = BOARD_SIZE * BOARD_SIZE;
  const BLACK = 1;
  const WHITE = 2;
  const EMPTY = 0;
  const PASS = -1;

  function normalizeBoard(value) {
    if (!value || typeof value.length !== "number") throw new TypeError("找不到目前盤面資料");
    const board = new Uint8Array(BOARD_CELLS);
    for (let i = 0; i < BOARD_CELLS; i++) {
      const stone = Number(value[i]);
      board[i] = stone === BLACK || stone === WHITE ? stone : EMPTY;
    }
    return board;
  }

  function countStones(board) {
    let black = 0;
    let white = 0;
    for (let i = 0; i < BOARD_CELLS; i++) {
      if (board[i] === BLACK) black++;
      else if (board[i] === WHITE) white++;
    }
    return { black, white };
  }

  function normalSideToMove(board) {
    const { black, white } = countStones(board);
    if (black === white) return BLACK;
    if (black === white + 1) return WHITE;
    return 0;
  }

  function transformXY(x, y, transform) {
    const m = BOARD_SIZE - 1;
    switch (transform) {
      case 0: return [x, y];
      case 1: return [m - y, x];
      case 2: return [m - x, m - y];
      case 3: return [y, m - x];
      case 4: return [m - x, y];
      case 5: return [m - y, m - x];
      case 6: return [x, m - y];
      case 7: return [y, x];
      default: return [x, y];
    }
  }

  if (typeof document === "undefined") return;

  function installRuleOptions() {
    const ruleBox = document.getElementById("rule-box");
    if (!ruleBox || ruleBox.dataset.threeRulesReady === "1") return Boolean(ruleBox);

    ruleBox.addEventListener("change", async event => {
      const radio = event.target;
      if (!(radio instanceof HTMLInputElement) || radio.name !== "rules" || !radio.checked) return;
      event.stopPropagation();
      const rules = Number(radio.value);
      if (!(rules in ruleNames)) return;
      const previous = Number(ruleBox.dataset.activeRules ?? 2);
      const success = await global.vcfSetRules?.(rules);
      if (success === false) {
        const fallback = ruleBox.querySelector(`input[name="rules"][value="${previous}"]`);
        if (fallback) fallback.checked = true;
      } else {
        ruleBox.dataset.activeRules = String(rules);
        global.dispatchEvent(new CustomEvent("vcf-rules-changed", { detail: { rules } }));
      }
    }, true);

    const selected = ruleBox.querySelector('input[name="rules"]:checked');
    ruleBox.dataset.activeRules = selected?.value || "2";
    ruleBox.dataset.threeRulesReady = "1";
    return true;
  }

  function installWorkbenchRecordState() {
    const STORAGE_KEY = "vcf_rapfi_workbench_v1";
    const CURSOR_KEY = "vcf_5db_current_path_v1";
    const WORKSPACE_RECORD = "record";
    const WORKSPACE_PUZZLE = "puzzle";
    const PUZZLE_SETUP = "setup";
    const PUZZLE_TREE = "tree";
    const activeRule = () => Number(document.querySelector('input[name="rules"]:checked')?.value ?? 2);
    const normalizeRule = rule => [0, 1, 2].includes(Number(rule)) ? Number(rule) : 2;
    const ruleBox = document.getElementById("rule-box");

    let rapfiDbActive = false;
    let exact = false;
    let currentRule = normalizeRule(activeRule());
    let restoringRule = false;
    let basePly = 0;
    let lastBoard = new Uint8Array(BOARD_CELLS);
    let workspaceMode = null;
    let puzzlePhase = PUZZLE_SETUP;
    let puzzleAttacker = BLACK;
    let puzzleSetupTool = BLACK;
    let puzzleRootBoard = new Uint8Array(BOARD_CELLS);
    let suspendPersistence = false;
    const selectedNextByRoute = new Map();
    const selected5DBBranches = new Map();
    const fiveDBBranchKey = path => "5db:" + path.join(",");
    // 5DB owns the original-coordinate tree. Rapfi only supplies the active board.
    let fiveDBDoc = null;
    let fiveDBPath = [];
    let fiveDBSavedBase64 = "";
    const blank5DBNode = (move = -1, stone = 0) => ({ move, stone, text: "", marks: [], children: [] });
    const fiveDBNode = path => {
      let node = fiveDBDoc?.root;
      for (const index of path) node = node?.children?.[index];
      return node || null;
    };
    const initialize5DB = (board = new Uint8Array(BOARD_CELLS), nextSide = BLACK) => {
      fiveDBDoc = {
        width: BOARD_SIZE, height: BOARD_SIZE, mode: workspaceMode || WORKSPACE_RECORD,
        nextSide, board: Array.from(board), title: "",
        currentPath: [], root: blank5DBNode(),
      };
      fiveDBPath = [];
      fiveDBSavedBase64 = "";
      selected5DBBranches.clear();
    };
    const capture5DBMarks = () => {
      const node = fiveDBNode(fiveDBPath);
      if (node) node.marks = global.VCFStaticAnnotations?.list?.() || [];
    };
    const replay5DBPath = path => {
      const service = db();
      if (!fiveDBDoc || !service?.isReady || !fiveDBNode(path)) return false;
      service.resetBoard(currentRule);
      const setup = setupMovesForBoard(fiveDBDoc.board, fiveDBDoc.nextSide);
      for (const move of setup) if (!service.replayMove(move, false)) return false;
      basePly = service.ply();
      let node = fiveDBDoc.root;
      for (const childIndex of path) {
        node = node.children[childIndex];
        if (service.sideToMove() !== node.stone && !service.replayMove(PASS, false)) return false;
        if (!service.replayMove(node.move, false)) return false;
      }
      fiveDBPath = path.slice();
      fiveDBDoc.currentPath = path.slice();
      return true;
    };
    const import5DBMarks = () => {
      const service = db(), routes = Object.create(null);
      if (!fiveDBDoc || !service?.isReady) return;
      const sourcePath = fiveDBPath.slice();
      if (!replay5DBPath([])) throw new Error("5DB 初始盤面無法載入");
      const scan = node => {
        if (node.marks?.length) {
          routes[currentRule + ":" + workspaceMode + ":" + service.history().join(",")] = node.marks;
        }
        for (const child of node.children) {
          const skipped = service.sideToMove() !== child.stone;
          if (skipped && !service.replayMove(PASS, false)) throw new Error("5DB 棋色無法還原");
          if (!service.replayMove(child.move, false)) throw new Error("5DB 分支無法還原");
          scan(child);
          if (!service.undo()) throw new Error("5DB 分支無法返回");
          if (skipped && !service.undo()) throw new Error("5DB 內部棋色切換無法返回");
        }
      };
      scan(fiveDBDoc.root);
      if (!replay5DBPath(sourcePath)) throw new Error("5DB 目前節點無法還原");
      global.VCFStaticAnnotations?.importData?.(routes);
    };

    const bytesToBase64 = bytes => {
      const value = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || 0);
      let binary = "";
      for (let offset = 0; offset < value.length; offset += 0x8000) {
        binary += String.fromCharCode(...value.subarray(offset, Math.min(value.length, offset + 0x8000)));
      }
      return btoa(binary);
    };
    const base64ToBytes = value => {
      const binary = atob(String(value || ""));
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i) & 0xff;
      return bytes;
    };
    const db = () => global.VCFRapfiDB;
    const documentTitle = () => document.getElementById("vcf-record-title");
    const emitWorkspaceChanged = () => {
      global.dispatchEvent(new CustomEvent("vcf-workspace-mode-changed", {
        detail: {
          mode: workspaceMode,
          puzzlePhase,
          attacker: puzzleAttacker,
          setupTool: puzzleSetupTool,
        },
      }));
    };
    const routeKey = () => {
      const service = db();
      return rapfiDbActive && service?.isReady
        ? String(currentRule) + ":" + service.history().join(",")
        : String(currentRule) + ":";
    };
    const oppositeStone = stone => stone === BLACK ? WHITE : BLACK;
    const replayBoard = history => {
      const board = new Uint8Array(BOARD_CELLS);
      let stone = BLACK;
      for (const raw of history || []) {
        const index = Number(raw?.index ?? raw?.move ?? raw);
        if (!Number.isInteger(index) || (index !== PASS && (index < 0 || index >= BOARD_CELLS))) return null;
        if (index !== PASS) {
          if (board[index] !== EMPTY) return null;
          board[index] = stone;
        }
        stone = oppositeStone(stone);
      }
      return board;
    };
    const setupMovesForBoard = (value, desiredSide = 0) => {
      const board = normalizeBoard(value);
      const black = [];
      const white = [];
      for (let index = 0; index < BOARD_CELLS; index++) {
        if (board[index] === BLACK) black.push(index);
        else if (board[index] === WHITE) white.push(index);
      }
      const moves = [];
      let blackIndex = 0;
      let whiteIndex = 0;
      let side = BLACK;
      while (blackIndex < black.length || whiteIndex < white.length) {
        if (side === BLACK && blackIndex < black.length) moves.push(black[blackIndex++]);
        else if (side === WHITE && whiteIndex < white.length) moves.push(white[whiteIndex++]);
        else moves.push(PASS);
        side = oppositeStone(side);
      }
      const targetSide = desiredSide === WHITE || desiredSide === BLACK
        ? desiredSide
        : (normalSideToMove(board) || side);
      if (side !== targetSide) moves.push(PASS);
      return moves;
    };
    const setMainBoard = (board, sideToMove) => {
      const render = global._renderBoardArr || global._setBoardArr;
      render?.(Array.from(board), sideToMove);
    };
    const emitBoardChanged = source => {
      global.vcfNotifyBoardChanged?.(source || "record", {
        attacker: rapfiDbActive && db()?.isReady ? db().sideToMove() : undefined,
      });
    };
    const saveState = (documentChanged = false) => {
      const service = db();
      if (suspendPersistence || !fiveDBDoc || !workspaceMode || !rapfiDbActive || !service?.isReady) return false;
      try {
        capture5DBMarks();
        fiveDBDoc.currentPath = fiveDBPath.slice();
        if (documentChanged || !fiveDBSavedBase64) {
          const doc = { ...fiveDBDoc, title: String(documentTitle()?.value || fiveDBDoc.title || "") };
          fiveDBSavedBase64 = bytesToBase64(global.FiveDB.encode(doc));
          localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 3, data: fiveDBSavedBase64 }));
        }
        localStorage.setItem(CURSOR_KEY, JSON.stringify(fiveDBPath));
        return true;
      } catch (error) {
        console.warn("保存 5DB 工作台狀態失敗", error);
        return false;
      }
    };
    const queryChildren = () => {
      if (fiveDBDoc) return (fiveDBNode(fiveDBPath)?.children || []).map(child => child.move);
      const service = db();
      if (!rapfiDbActive || !exact || !service?.isReady) return [];
      try { return service.children().map(Number).filter(Number.isInteger).sort((a, b) => a - b); }
      catch (error) { console.warn("Rapfi queryChildren 失敗", error); return []; }
    };
    const selectedNextMove = knownMoves => {
      const moves = Array.isArray(knownMoves) ? knownMoves : queryChildren();
      if (!moves.length) return null;
      const selected = fiveDBDoc
        ? selected5DBBranches.get(fiveDBBranchKey(fiveDBPath))
        : selectedNextByRoute.get(routeKey());
      return moves.includes(selected) ? selected : moves[0];
    };
    const rememberSelectedNext = move => {
      if (Number.isInteger(Number(move))) selectedNextByRoute.set(routeKey(), Number(move));
    };
    const currentRecordText = () => {
      if (fiveDBDoc) return String(fiveDBNode(fiveDBPath)?.text || "");
      const service = db();
      if (!rapfiDbActive || !exact || !service?.isReady) return "";
      try { return String(service.getDisplayText() || ""); } catch (_) { return ""; }
    };
    const notify = () => {
      const service = db();
      const nextMoves = queryChildren();
      const nextMove = selectedNextMove(nextMoves);
      const absolutePly = rapfiDbActive && service?.isReady ? service.ply() : 0;
      const ply = fiveDBDoc ? fiveDBPath.length : Math.max(0, absolutePly - basePly);
      global.dispatchEvent(new CustomEvent("vcf-record-state-changed", {
        detail: {
          recordText: currentRecordText(),
          exact: Boolean(rapfiDbActive && exact),
          ply,
          canPrev: Boolean(rapfiDbActive && exact && (fiveDBDoc ? fiveDBPath.length : absolutePly - basePly) > 0),
          canNext: Boolean(rapfiDbActive && exact && nextMove != null),
          selectedNextMove: nextMove,
          nextMoves,
          nextBranchCount: nextMoves.length,
          siblingCount: 0,
          siblingIndex: -1,
          workspaceMode,
          puzzlePhase,
          puzzleAttacker,
          positionBackend: rapfiDbActive ? "rapfi-db" : "initializing",
        },
      }));
    };
    const applyCurrentBoard = (databaseChanged = false, source = "record-navigation", persist = true) => {
      const service = db();
      if (!rapfiDbActive || !exact || !service?.isReady) return false;
      const board = new Uint8Array(service.board());
      lastBoard = board;
      setMainBoard(board, service.sideToMove());
      if (persist) saveState(databaseChanged);
      notify();
      emitBoardChanged(source);
      return true;
    };
    const restoreDbHistory = moves => {
      const service = db();
      if (!service?.isReady) return false;
      service.resetBoard(currentRule);
      for (const raw of moves || []) {
        if (!service.replayMove(Number(raw?.index ?? raw?.move ?? raw), false)) return false;
      }
      return true;
    };
    const replacePositionInternal = (boardValue, options = {}) => {
      const service = db();
      if (!rapfiDbActive || !service?.isReady) return false;
      const board = normalizeBoard(boardValue || []);
      const setup = setupMovesForBoard(board, Number(options.sideToMove));
      global.VCFStaticAnnotations?.reset?.();
      service.clear(currentRule);
      for (const move of setup) if (!service.replayMove(move, false)) return false;
      service.ensureCurrent();
      basePly = service.ply();
      workspaceMode = WORKSPACE_PUZZLE;
      puzzlePhase = options.phase === PUZZLE_SETUP ? PUZZLE_SETUP : PUZZLE_TREE;
      puzzleAttacker = service.sideToMove();
      puzzleRootBoard = new Uint8Array(board);
      initialize5DB(board, service.sideToMove());
      exact = true;
      selectedNextByRoute.clear();
      emitWorkspaceChanged();
      return applyCurrentBoard(true, options.source || "replace-position");
    };
    const replaceHistoryInternal = (nextHistory, options = {}) => {
      const service = db();
      if (!rapfiDbActive || !service?.isReady) return false;
      const normalized = Array.isArray(nextHistory) ? nextHistory.map((item, index) => ({
        index: Number(item?.index ?? item?.move ?? item),
        stone: Number(item?.stone ?? item?.color ?? (index % 2 === 0 ? BLACK : WHITE)),
        recordText: typeof item?.recordText === "string" ? item.recordText : "",
      })) : [];
      if (!replayBoard(normalized)) return false;
      for (let i = 0; i < normalized.length; i++) if (normalized[i].stone !== (i % 2 === 0 ? BLACK : WHITE)) return false;
      global.VCFStaticAnnotations?.reset?.();
      service.clear(currentRule);
      service.ensureCurrent();
      fiveDBDoc = null;
      if (options.rootRecordText) service.setDisplayText(String(options.rootRecordText));
      for (const item of normalized) {
        if (!service.replayMove(item.index, true)) return false;
        if (item.recordText) service.setDisplayText(item.recordText);
      }
      basePly = Math.max(0, Math.min(service.ply(), Number(options.basePly || 0)));
      workspaceMode = WORKSPACE_RECORD;
      const setupHistory = normalized.slice(0, basePly);
      const setupBoard = replayBoard(setupHistory) || new Uint8Array(BOARD_CELLS);
      initialize5DB(setupBoard, basePly % 2 === 0 ? BLACK : WHITE);
      fiveDBDoc.root.text = String(options.rootRecordText || "");
      for (const item of normalized.slice(basePly)) {
        const parent = fiveDBNode(fiveDBPath);
        parent.children.push({ move: item.index, stone: item.stone, text: item.recordText, marks: [], children: [] });
        fiveDBPath.push(parent.children.length - 1);
      }
      fiveDBDoc.currentPath = fiveDBPath.slice();
      puzzlePhase = PUZZLE_SETUP;
      puzzleRootBoard = new Uint8Array(BOARD_CELLS);
      exact = true;
      selectedNextByRoute.clear();
      service.ensureCurrent();
      emitWorkspaceChanged();
      return applyCurrentBoard(true, options.source || "replace-history");
    };
    const resetToEmptyBoard = () => {
      currentRule = normalizeRule(activeRule());
      const service = db();
      service.clear(currentRule);
      service.ensureCurrent();
      fiveDBDoc = null;
      fiveDBPath = [];
      rapfiDbActive = true;
      exact = true;
      basePly = 0;
      workspaceMode = null;
      puzzlePhase = PUZZLE_SETUP;
      puzzleRootBoard = new Uint8Array(BOARD_CELLS);
      selectedNextByRoute.clear();
      return applyCurrentBoard(false, "init", false);
    };
    const restoreSavedState = async () => {
      const service = db();
      if (!service?.isReady) return false;
      let saved = null;
      try { saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null"); }
      catch (error) {
        console.warn("Rapfi 工作台狀態格式損壞，已改用空白棋盤", error);
        try { localStorage.removeItem(STORAGE_KEY); } catch (_) {}
      }
      if (saved?.version === 3 && typeof saved.data === "string") {
        try {
          const restored = global.FiveDB.decode(base64ToBytes(saved.data));
          let storedPath = null;
          try { storedPath = JSON.parse(localStorage.getItem(CURSOR_KEY) || "null"); } catch (_) {}
          if (Array.isArray(storedPath)) {
            let cursor = restored.root, valid = true;
            for (const branch of storedPath) {
              if (!Number.isInteger(branch) || branch < 0 || branch >= cursor.children.length) { valid = false; break; }
              cursor = cursor.children[branch];
            }
            if (valid) restored.currentPath = storedPath;
          }
          return await global.VCFWorkbenchRecord.import5DBDocument(restored);
        } catch (error) {
          console.warn("5DB 工作區無法還原，改用空白棋盤", error);
          localStorage.removeItem(STORAGE_KEY);
        }
      }
      return resetToEmptyBoard();
    };
    let activationPromise = null;
    const activateRapfiDatabase = () => {
      if (rapfiDbActive) return Promise.resolve(true);
      if (!global.VCFRapfiDB?.isReady) return Promise.resolve(false);
      if (activationPromise) return activationPromise;
      activationPromise = restoreSavedState().then(ok => {
        if (!ok) throw new Error("Rapfi 棋盤狀態無法啟用");
        global.dispatchEvent(new CustomEvent("vcf-rapfi-db-active"));
        return true;
      }).finally(() => { activationPromise = null; });
      return activationPromise;
    };
    global.addEventListener("vcf-rapfi-db-ready", () => {
      queueMicrotask(() => activateRapfiDatabase().catch(error => console.error("Rapfi DB 啟用失敗", error)));
    });
    if (global.VCFRapfiDB?.isReady) {
      queueMicrotask(() => activateRapfiDatabase().catch(error => console.error("Rapfi DB 啟用失敗", error)));
    } else {
      global.VCFRapfiDB?.ready?.then(() => activateRapfiDatabase()).catch(error => console.error("Rapfi DB bridge 初始化失敗", error));
    }

    const transformMove = (move, transform) => {
      if (!Number.isInteger(Number(move)) || Number(move) === PASS) return Number(move);
      const index = Number(move);
      const xy = transformXY(index % BOARD_SIZE, Math.floor(index / BOARD_SIZE), transform);
      return xy[1] * BOARD_SIZE + xy[0];
    };

    global.VCFWorkbenchRecord = {
      snapshot() {
        if (fiveDBDoc) {
          const treeHistory = [];
          const setup = setupMovesForBoard(fiveDBDoc.board, fiveDBDoc.nextSide);
          for (const move of setup) treeHistory.push({ index: move });
          let node = fiveDBDoc.root;
          for (const index of fiveDBPath) {
            node = node.children[index];
            treeHistory.push({ index: node.move, stone: node.stone, recordText: node.text });
          }
          return {
            history: treeHistory, exact: true, board: this.currentBoard(),
            rootRecordText: fiveDBDoc.root.text, basePly: setup.length,
            workspaceMode, puzzlePhase, puzzleAttacker,
          };
        }
        return { history: [], exact: false, board: this.currentBoard(),
          rootRecordText: "", basePly: 0, workspaceMode, puzzlePhase, puzzleAttacker };
      },
      workspace() {
        return { mode: workspaceMode, puzzlePhase, attacker: puzzleAttacker, setupTool: puzzleSetupTool };
      },
      annotationRoute() {
        const service = db();
        if (!workspaceMode || !rapfiDbActive || !exact || !service?.isReady) return "";
        return currentRule + ":" + workspaceMode + ":" + service.history().join(",");
      },
      startWorkspace(mode) {
        const service = db();
        if (!rapfiDbActive || !service?.isReady || (mode !== WORKSPACE_RECORD && mode !== WORKSPACE_PUZZLE)) return false;
        service.clear(currentRule);
        service.ensureCurrent();
        workspaceMode = mode;
        puzzlePhase = PUZZLE_SETUP;
        puzzleAttacker = BLACK;
        puzzleSetupTool = BLACK;
        puzzleRootBoard = new Uint8Array(BOARD_CELLS);
        basePly = 0;
        exact = true;
        selectedNextByRoute.clear();
        global.VCFStaticAnnotations?.reset?.();
        initialize5DB();
        emitWorkspaceChanged();
        return applyCurrentBoard(true, mode === WORKSPACE_RECORD ? "new-record" : "new-puzzle");
      },
      setPuzzleSetupTool(stone) {
        const normalized = Number(stone);
        if (normalized !== EMPTY && normalized !== BLACK && normalized !== WHITE) return false;
        puzzleSetupTool = normalized;
        emitWorkspaceChanged();
        return true;
      },
      setPuzzleAttacker(attacker) {
        const normalized = Number(attacker);
        if (workspaceMode !== WORKSPACE_PUZZLE || puzzlePhase !== PUZZLE_SETUP || (normalized !== BLACK && normalized !== WHITE)) return false;
        return replacePositionInternal(this.currentBoard(), {
          sideToMove: normalized,
          source: "puzzle-attacker",
          phase: PUZZLE_SETUP,
        });
      },
      placePuzzleSetupStone(index, stone = puzzleSetupTool) {
        const move = Number(index);
        const normalized = Number(stone);
        if (workspaceMode !== WORKSPACE_PUZZLE || puzzlePhase !== PUZZLE_SETUP
          || !Number.isInteger(move) || move < 0 || move >= BOARD_CELLS
          || (normalized !== EMPTY && normalized !== BLACK && normalized !== WHITE)) return false;
        const board = this.currentBoard();
        board[move] = normalized;
        return replacePositionInternal(board, {
          sideToMove: puzzleAttacker,
          source: "puzzle-setup",
          phase: PUZZLE_SETUP,
        });
      },
      commitPuzzleSetup() {
        if (workspaceMode !== WORKSPACE_PUZZLE || puzzlePhase !== PUZZLE_SETUP
          || !this.currentBoard().some(stone => Number(stone) !== EMPTY)) return false;
        puzzleRootBoard = Uint8Array.from(this.currentBoard());
        initialize5DB(puzzleRootBoard, puzzleAttacker);
        puzzlePhase = PUZZLE_TREE;
        emitWorkspaceChanged();
        saveState(true);
        notify();
        return true;
      },
      editPuzzleSetup() {
        if (workspaceMode !== WORKSPACE_PUZZLE || puzzlePhase !== PUZZLE_TREE) return false;
        return replacePositionInternal(puzzleRootBoard, {
          sideToMove: puzzleAttacker,
          source: "puzzle-setup-edit",
          phase: PUZZLE_SETUP,
        });
      },
      currentBoard() {
        const service = db();
        return rapfiDbActive && service?.isReady ? Array.from(service.board()) : Array.from(lastBoard);
      },
      currentSideToMove() {
        const service = db();
        return rapfiDbActive && service?.isReady ? service.sideToMove() : BLACK;
      },
      currentRecordText,
      setCurrentRecordText(text) {
        const service = db();
        if (!workspaceMode || (workspaceMode === WORKSPACE_PUZZLE && puzzlePhase === PUZZLE_SETUP)
          || !rapfiDbActive || !exact || !service?.isReady) return false;
        if (fiveDBDoc) {
          const node = fiveDBNode(fiveDBPath);
          if (!node) return false;
          node.text = String(text || "");
          saveState(true); notify();
          return true;
        }
        return false;
      },
      replacePosition(board, options = {}) { return replacePositionInternal(board, options); },
      replaceHistory(history, options = {}) { return replaceHistoryInternal(history, options); },
      clearPosition(source = "clear") {
        const service = db();
        if (!rapfiDbActive || !service?.isReady) return false;
        service.clear(currentRule);
        service.ensureCurrent();
        global.VCFStaticAnnotations?.reset?.();
        if (workspaceMode) initialize5DB();
        basePly = 0;
        if (workspaceMode === WORKSPACE_PUZZLE) {
          puzzlePhase = PUZZLE_SETUP;
          puzzleRootBoard = new Uint8Array(BOARD_CELLS);
        }
        exact = true;
        selectedNextByRoute.clear();
        emitWorkspaceChanged();
        return applyCurrentBoard(true, source, Boolean(workspaceMode));
      },
      setHistory(nextHistory, nextExact = true, nextRootRecordText = "") {
        if (nextExact === false) return false;
        return replaceHistoryInternal(nextHistory, { source: "set-history", rootRecordText: nextRootRecordText, basePly: 0 });
      },
      export5DBDocument(title = "") {
        if (!fiveDBDoc) throw new Error("請先建立棋譜");
        capture5DBMarks();
        fiveDBDoc.currentPath = fiveDBPath.slice();
        const copy = JSON.parse(JSON.stringify(fiveDBDoc));
        copy.title = String(title || documentTitle()?.value || "");
        return copy;
      },
      async import5DBDocument(source) {
        const service = db();
        if (!service?.isReady || !global.FiveDB) return false;
        global.FiveDB.validate(source);
        if (source.width !== BOARD_SIZE || source.height !== BOARD_SIZE)
          throw new Error("目前工作台固定 15×15，這份 5DB 棋譜為 " + source.width + "×" + source.height);
        suspendPersistence = true;
        try {
          fiveDBDoc = JSON.parse(JSON.stringify(source));
          fiveDBPath = [];
          fiveDBSavedBase64 = "";
          selected5DBBranches.clear();
          let nodeOnSavedRoute = fiveDBDoc.root;
          const savedPrefix = [];
          for (const index of source.currentPath) {
            selected5DBBranches.set(fiveDBBranchKey(savedPrefix), nodeOnSavedRoute.children[index].move);
            nodeOnSavedRoute = nodeOnSavedRoute.children[index];
            savedPrefix.push(index);
          }
          workspaceMode = source.mode;
          puzzlePhase = source.mode === WORKSPACE_PUZZLE ? PUZZLE_TREE : PUZZLE_SETUP;
          puzzleRootBoard = Uint8Array.from(source.board);
          puzzleAttacker = source.nextSide;
          exact = true;
          rapfiDbActive = true;
          selectedNextByRoute.clear();
          service.clear(currentRule);
          if (!replay5DBPath(source.currentPath)) throw new Error("5DB 原始路線無法還原");
          import5DBMarks();
          const title = documentTitle();
          if (title) {
            title.value = String(source.title || "").slice(0, 250);
            title.dispatchEvent(new Event("input", { bubbles: true }));
          }
          emitWorkspaceChanged();
          suspendPersistence = false;
          return applyCurrentBoard(true, "5db-import");
        } finally {
          suspendPersistence = false;
        }
      },
      ensureActive() { return activateRapfiDatabase(); },
      isActive() { return Boolean(rapfiDbActive && exact && db()?.isReady); },
      playAt(move, source = "manual") {
        const service = db();
        const index = Number(move);
        if (!workspaceMode || (workspaceMode === WORKSPACE_PUZZLE && puzzlePhase !== PUZZLE_TREE)
          || !rapfiDbActive || !exact || !service?.isReady || !Number.isInteger(index)
          || index < 0 || index >= BOARD_CELLS || Number(service.board()[index])) return false;
        const parentKey = routeKey();
        if (fiveDBDoc) capture5DBMarks();
        if (!service.play(index, true)) return false;
        if (fiveDBDoc) {
          const parent = fiveDBNode(fiveDBPath);
          selected5DBBranches.set(fiveDBBranchKey(fiveDBPath), index);
          const side = service.sideToMove() === BLACK ? WHITE : BLACK;
          let selected = parent.children.findIndex(child => child.move === index);
          if (selected < 0) {
            parent.children.push(blank5DBNode(index, side));
            selected = parent.children.length - 1;
          }
          fiveDBPath.push(selected);
          fiveDBDoc.currentPath = fiveDBPath.slice();
        }
        selectedNextByRoute.set(parentKey, index);
        return applyCurrentBoard(true, source);
      },
      navigateStep(direction) {
        if (fiveDBDoc) {
          capture5DBMarks();
          if (direction < 0) {
            if (!fiveDBPath.length) return false;
            const previous = fiveDBNode(fiveDBPath);
            fiveDBPath.pop();
            selected5DBBranches.set(fiveDBBranchKey(fiveDBPath), previous.move);
          } else {
            const node = fiveDBNode(fiveDBPath);
            const moves = node?.children || [];
            if (!moves.length) return false;
            const preferred = selected5DBBranches.get(fiveDBBranchKey(fiveDBPath));
            const selected = Math.max(0, moves.findIndex(child => child.move === preferred));
            fiveDBPath.push(selected);
          }
          if (!replay5DBPath(fiveDBPath)) return false;
          return applyCurrentBoard(false, "record-navigation");
        }
        const service = db();
        if (!rapfiDbActive || !exact || !service?.isReady) return false;
        if (direction < 0) {
          const history = service.history();
          if (service.ply() <= basePly || !history.length) return false;
          const move = history[history.length - 1];
          if (!service.undo()) return false;
          rememberSelectedNext(move);
          return applyCurrentBoard(false, "record-navigation");
        }
        const moves = queryChildren();
        const move = selectedNextMove(moves);
        if (move == null) return false;
        rememberSelectedNext(move);
        if (!service.play(move, false)) return false;
        return applyCurrentBoard(false, "record-navigation");
      },
      navigateBranch(direction) {
        if (fiveDBDoc) {
          capture5DBMarks();
          if (direction < 0) {
            if (!fiveDBPath.length) return false;
            do {
              const previous = fiveDBNode(fiveDBPath);
              fiveDBPath.pop();
              selected5DBBranches.set(fiveDBBranchKey(fiveDBPath), previous.move);
              const node = fiveDBNode(fiveDBPath);
              if (!fiveDBPath.length || node.children.length > 1) break;
            } while (fiveDBPath.length);
          } else {
            let node = fiveDBNode(fiveDBPath);
            if (!node?.children?.length) return false;
            do {
              const preferred = selected5DBBranches.get(fiveDBBranchKey(fiveDBPath));
              const selected = Math.max(0, node.children.findIndex(child => child.move === preferred));
              fiveDBPath.push(selected);
              node = node.children[selected];
            } while (node.children.length === 1);
          }
          if (!replay5DBPath(fiveDBPath)) return false;
          return applyCurrentBoard(false, "record-navigation");
        }
        const service = db();
        if (!rapfiDbActive || !exact || !service?.isReady) return false;
        if (direction < 0) {
          if (service.ply() <= basePly) return false;
          do {
            const history = service.history();
            const move = history[history.length - 1];
            if (!service.undo()) break;
            rememberSelectedNext(move);
            if (queryChildren().length > 1 || service.ply() <= basePly) break;
          } while (service.ply() > basePly);
          return applyCurrentBoard(false, "record-navigation");
        }
        let moves = queryChildren();
        if (!moves.length) return false;
        do {
          const move = selectedNextMove(moves);
          if (move == null) break;
          rememberSelectedNext(move);
          if (!service.play(move, false)) break;
          moves = queryChildren();
        } while (moves.length === 1);
        return applyCurrentBoard(false, "record-navigation");
      },
      appendPass() {
        const service = db();
        if (workspaceMode !== WORKSPACE_PUZZLE || puzzlePhase !== PUZZLE_TREE || !rapfiDbActive || !exact || !service?.isReady) return false;
        const parentKey = routeKey();
        if (fiveDBDoc) capture5DBMarks();
        if (!service.play(PASS, true)) return false;
        if (fiveDBDoc) {
          const parent = fiveDBNode(fiveDBPath);
          selected5DBBranches.set(fiveDBBranchKey(fiveDBPath), PASS);
          let selected = parent.children.findIndex(child => child.move === PASS);
          if (selected < 0) { parent.children.push(blank5DBNode(PASS, service.sideToMove() === BLACK ? WHITE : BLACK)); selected = parent.children.length - 1; }
          fiveDBPath.push(selected);
          fiveDBDoc.currentPath = fiveDBPath.slice();
        }
        selectedNextByRoute.set(parentKey, PASS);
        return applyCurrentBoard(true, "manual");
      },
      deleteCurrentAndFollowing() {
        if (fiveDBDoc) {
          if (!fiveDBPath.length) return false;
          capture5DBMarks();
          const removedIndex = fiveDBPath.pop();
          const parent = fiveDBNode(fiveDBPath);
          parent.children.splice(removedIndex, 1);
          if (!replay5DBPath(fiveDBPath)) return false;
          selectedNextByRoute.delete(routeKey());
          return applyCurrentBoard(true, "record-edit");
        }
        const service = db();
        if (!rapfiDbActive || !exact || !service?.isReady || service.ply() <= basePly) return false;
        if (!service.deleteCurrentAndChildren() || !service.undo()) return false;
        selectedNextByRoute.delete(routeKey());
        return applyCurrentBoard(true, "record-edit");
      },
      transform(transform) {
        if (fiveDBDoc) {
          const t = Number(transform);
          if (!Number.isInteger(t) || t < 0 || t > 7) return false;
          capture5DBMarks();
          const transformedBoard = new Array(BOARD_CELLS).fill(0);
          const change = index => transformMove(index, t);
          for (let i = 0; i < BOARD_CELLS; i++) {
            if (fiveDBDoc.board[i]) transformedBoard[change(i)] = fiveDBDoc.board[i];
          }
          fiveDBDoc.board = transformedBoard;
          const stack = [fiveDBDoc.root];
          while (stack.length) {
            const node = stack.pop();
            if (node.move >= 0) node.move = change(node.move);
            node.marks = (node.marks || []).map(mark => {
              const xy = transformXY(mark.x, mark.y, t);
              const next = { ...mark, x: xy[0], y: xy[1] };
              if (mark.type === "line" || mark.type === "arrow") {
                const end = transformXY(mark.tx, mark.ty, t);
                next.tx = end[0]; next.ty = end[1];
              }
              return next;
            });
            stack.push(...node.children);
          }
          if (!replay5DBPath(fiveDBPath)) return false;
          import5DBMarks();
          return applyCurrentBoard(true, "record-transform");
        }
        const service = db();
        const normalized = Number(transform);
        if (!rapfiDbActive || !exact || !service?.isReady || !Number.isInteger(normalized) || normalized < 0 || normalized > 7) return false;
        const original = service.history();
        const transformed = original.map(move => transformMove(move, normalized));
        if (!restoreDbHistory(transformed)) { restoreDbHistory(original); return false; }
        if (workspaceMode === WORKSPACE_PUZZLE) {
          const nextRoot = new Uint8Array(BOARD_CELLS);
          for (let index = 0; index < BOARD_CELLS; index++) {
            if (puzzleRootBoard[index]) nextRoot[transformMove(index, normalized)] = puzzleRootBoard[index];
          }
          puzzleRootBoard = nextRoot;
        }
        selectedNextByRoute.clear();
        global.VCFStaticAnnotations?.transform?.(normalized);
        return applyCurrentBoard(false, "record-transform");
      },
      invalidate() { notify(); return true; },
    };

    global.addEventListener("vcf-static-annotations-changed", () => {
      if (fiveDBDoc && !suspendPersistence) saveState(true);
    });
    documentTitle()?.addEventListener("input", () => {
      if (fiveDBDoc && !suspendPersistence) saveState(true);
    });

    global.addEventListener("vcf-rules-changed", () => {
      if (restoringRule || !rapfiDbActive || !db()?.isReady) return;
      const service = db();
      const nextRule = normalizeRule(activeRule());
      if (nextRule === currentRule) { notify(); return; }
      if (fiveDBDoc) {
        capture5DBMarks();
        currentRule = nextRule;
        service.clear(currentRule);
        if (!replay5DBPath(fiveDBPath)) return;
        import5DBMarks();
        selectedNextByRoute.clear();
        applyCurrentBoard(true, "rule-change");
        return;
      }
      const moves = service.history();
      service.cloneRule(currentRule, nextRule);
      currentRule = nextRule;
      if (!restoreDbHistory(moves)) return;
      selectedNextByRoute.clear();
      exact = true;
      applyCurrentBoard(true, "rule-change");
    });

    notify();
  }

  installWorkbenchRecordState();

  function installWorkspaceModeUI() {
    const panel = document.getElementById("vcf-workspace-mode");
    if (!panel) return false;

    const badge = panel.querySelector("[data-mode-badge]");
    const format = panel.querySelector("[data-format]");
    const puzzleControls = panel.querySelector("[data-puzzle-controls]");
    const setupTools = panel.querySelector("[data-setup-tools]");
    const attacker = panel.querySelector("[data-puzzle-attacker]");
    const commit = panel.querySelector("[data-commit-puzzle]");
    const edit = panel.querySelector("[data-edit-puzzle]");
    const status = message => {
      if (typeof global.setStatus === "function") global.setStatus(message);
      else {
        const node = document.getElementById("status");
        if (node) node.textContent = message;
      }
    };
    const sync = () => {
      const state = global.VCFWorkbenchRecord?.workspace?.() || {};
      const isPuzzle = state.mode === "puzzle";
      const isSetup = isPuzzle && state.puzzlePhase === "setup";
      badge.textContent = state.mode === "record" ? "打譜模式" : isPuzzle ? (isSetup ? "題目模式・擺題" : "題目模式・解答") : "尚未選擇";
      format.textContent = state.mode ? "使用 5DB 1.0 儲存棋盤、分支與標記" : "請先選擇模式";
      puzzleControls.hidden = !isPuzzle;
      setupTools.hidden = !isSetup;
      attacker.disabled = !isSetup;
      attacker.value = String(state.attacker === WHITE ? WHITE : BLACK);
      commit.hidden = !isSetup;
      edit.hidden = !isPuzzle || isSetup;
      for (const button of panel.querySelectorAll("[data-new-mode]")) {
        button.classList.toggle("is-active", button.dataset.newMode === state.mode);
      }
      for (const button of panel.querySelectorAll("[data-setup-tool]")) {
        button.classList.toggle("is-active", Number(button.dataset.setupTool) === Number(state.setupTool));
      }
    };

    panel.addEventListener("click", event => {
      const modeButton = event.target.closest("[data-new-mode]");
      if (modeButton) {
        const nextMode = modeButton.dataset.newMode;
        const current = global.VCFWorkbenchRecord?.workspace?.()?.mode;
        const hasContent = global.VCFWorkbenchRecord?.currentBoard?.().some(stone => Number(stone) !== EMPTY);
        if ((current || hasContent) && !global.confirm("建立新工作區會清除目前盤面、注釋與分支，確定繼續？")) return;
        if (!global.VCFWorkbenchRecord?.startWorkspace?.(nextMode)) {
          status("Rapfi 棋盤尚未就緒，請稍候再選擇模式");
          return;
        }
        status(nextMode === "record" ? "打譜模式：從空盤依序落子，可儲存為 5DB" : "題目模式：先自由擺放黑白棋，再選擇攻方並開始編輯解答");
        return;
      }
      const toolButton = event.target.closest("[data-setup-tool]");
      if (toolButton) global.VCFWorkbenchRecord?.setPuzzleSetupTool?.(Number(toolButton.dataset.setupTool));
      if (event.target.closest("[data-commit-puzzle]")) {
        if (global.VCFWorkbenchRecord?.commitPuzzleSetup?.()) status("題目根盤面已建立；後續落子會記錄為解答分支");
        else status("請先在題目盤面放入至少一顆棋子");
      }
      if (event.target.closest("[data-edit-puzzle]")) {
        if (!global.confirm("重新編輯初始盤面會清除目前解答分支，確定繼續？")) return;
        if (global.VCFWorkbenchRecord?.editPuzzleSetup?.()) status("已返回題目擺盤；原解答分支已清除");
      }
    });
    attacker.addEventListener("change", () => {
      if (global.VCFWorkbenchRecord?.setPuzzleAttacker?.(Number(attacker.value))) {
        status(attacker.value === "2" ? "題目攻方已設為白方" : "題目攻方已設為黑方");
      }
    });
    global.addEventListener("vcf-workspace-mode-changed", sync);
    global.addEventListener("vcf-rapfi-db-active", sync);
    sync();
    return true;
  }

  installWorkspaceModeUI();

  function timestampName() {
    const d = new Date();
    const two = value => String(value).padStart(2, "0");
    return `${d.getFullYear()}${two(d.getMonth() + 1)}${two(d.getDate())}-${two(d.getHours())}${two(d.getMinutes())}${two(d.getSeconds())}`;
  }

  function downloadBytes(bytes, filename, type = "application/octet-stream") {
    const blob = new Blob([bytes], { type });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  function installHeader() {
    const panel = document.getElementById("bitboard-architecture-panel");
    if (!panel) return false;
    const exportButton = panel.querySelector("#bb-export-file");
    const exportStatus = panel.querySelector("#bb-export-status");
    const syncExportMode = () => {
      const workspace = global.VCFWorkbenchRecord?.workspace?.() || {};
      exportButton.textContent = "匯出 5DB";
      exportButton.disabled = !workspace.mode;
    };
    exportButton.addEventListener("click", () => {
      exportButton.disabled = true;
      exportStatus.textContent = "正在建立 5DB……";
      try {
        const title = document.getElementById("vcf-record-title")?.value || "";
        const documentData = global.VCFWorkbenchRecord.export5DBDocument(title);
        const bytes = global.FiveDB.encode(documentData);
        downloadBytes(bytes, "5db-" + timestampName() + ".5db");
        exportStatus.textContent = "已匯出 5DB 1.0（" + bytes.length.toLocaleString() + " bytes）";
      } catch (error) {
        console.error("匯出 5DB 失敗", error);
        exportStatus.textContent = error?.message || String(error);
      } finally {
        syncExportMode();
      }
    });
    global.addEventListener("vcf-workspace-mode-changed", syncExportMode);
    syncExportMode();

    const refreshButton = panel.querySelector("#bb-hard-refresh");
    refreshButton.addEventListener("click", async () => {
      refreshButton.disabled = true;
      refreshButton.textContent = "強制更新中……";
      try {
        if ("caches" in global) {
          const cacheNames = await caches.keys();
          await Promise.all(cacheNames.map(name => caches.delete(name)));
        }
        const urls = new Set();
        for (const entry of performance.getEntriesByType("resource")) {
          try {
            const url = new URL(entry.name, location.href);
            if (url.origin === location.origin) urls.add(url.href);
          } catch (_) {}
        }
        document.querySelectorAll("script[src], link[rel='stylesheet'][href]").forEach(element => {
          try {
            const url = new URL(element.src || element.href, location.href);
            if (url.origin === location.origin) urls.add(url.href);
          } catch (_) {}
        });
        await Promise.allSettled(Array.from(urls, url => fetch(url, {
          cache: "reload",
          credentials: "same-origin",
        })));
      } catch (error) {
        console.warn("強制重新整理前的快取更新失敗，仍繼續重新載入。", error);
      }
      const url = new URL(location.href);
      url.searchParams.set("_refresh", String(Date.now()));
      location.replace(url.href);
    });
    return true;
  }

  installRuleOptions();
  installHeader();
})(typeof window !== "undefined" ? window : globalThis);
