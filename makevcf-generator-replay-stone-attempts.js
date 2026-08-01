"use strict";

// Record every one-stone defender attempt and integrate it into the same replay card.
// The complete replay keeps owning its normal records; after generation finishes this
// layer harvests those records, inserts every actual one-stone attempt, and takes over
// the existing first/previous/next/last controls without creating a second card.
(function installGeneratorStoneAttemptReplay() {
  if (window.__generatorStoneAttemptReplayInstalled) return;
  window.__generatorStoneAttemptReplayInstalled = true;

  const BOARD_CELLS = 225;
  const MAX_KNOWN_BOARDS = 2048;
  const originalWorkerPostMessage = Worker.prototype.postMessage;
  const originalFindVCF = genEngine.findVCF.bind(genEngine);
  const originalSetBusy = genSetBusy;
  const originalShowResult = genShowResult;

  let session = 0;
  let running = false;
  let attempts = [];
  let knownBoards = [];
  let pointAttempts = new Map();
  let exactAttempts = new Map();
  let lastResultBoard = null;

  let capturedBoard = null;
  let capturedAttacker = GEN_BLACK;
  let replaySteps = [];
  let replayIndex = -1;
  let unifiedActive = false;
  let allowBaseControl = false;
  let controlsInstalled = false;
  let rebuildToken = 0;

  function compactBoard(source) {
    const board = new Uint8Array(BOARD_CELLS);
    for (let idx = 0; idx < BOARD_CELLS; idx++) {
      const value = Number(source?.[idx]);
      board[idx] = value === GEN_BLACK
        ? GEN_BLACK
        : value === GEN_WHITE
          ? GEN_WHITE
          : GEN_EMPTY;
    }
    return board;
  }

  function expandedBoard(source) {
    const board = Array.from(source || []);
    while (board.length < BOARD_CELLS) board.push(GEN_EMPTY);
    board.length = BOARD_CELLS + 1;
    board[BOARD_CELLS] = -1;
    return board;
  }

  function boardSignature(board) {
    let result = "";
    for (let idx = 0; idx < BOARD_CELLS; idx++) {
      result += board[idx] === GEN_BLACK
        ? "1"
        : board[idx] === GEN_WHITE
          ? "2"
          : "0";
    }
    return result;
  }

  function boardIsSubset(subset, superset) {
    if (!subset || !superset) return false;
    for (let idx = 0; idx < BOARD_CELLS; idx++) {
      if (subset[idx] !== GEN_EMPTY && subset[idx] !== superset[idx]) return false;
    }
    return true;
  }

  function addedPoints(parent, child) {
    const result = [];
    if (!parent || !child) return result;
    for (let idx = 0; idx < BOARD_CELLS; idx++) {
      if (parent[idx] === GEN_EMPTY && child[idx] !== GEN_EMPTY) result.push(idx);
    }
    return result;
  }

  function pointName(idx) {
    if (typeof genName === "function") return genName(idx);
    return "ABCDEFGHJKLMNOP"[idx % 15] + (15 - Math.floor(idx / 15));
  }

  function colorName(color) {
    return color === GEN_BLACK ? "黑子" : "白子";
  }

  function currentStatus() {
    return genEl("status")?.textContent || "";
  }

  function combinedUI() {
    const element = document.getElementById("gen-replay-combined-panel");
    if (!element) return null;
    return {
      element,
      first: element.querySelector("#gen-replay-combined-first"),
      prev: element.querySelector("#gen-replay-combined-prev"),
      next: element.querySelector("#gen-replay-combined-next"),
      last: element.querySelector("#gen-replay-combined-last"),
      count: element.querySelector("#gen-replay-combined-count"),
      badge: element.querySelector("#gen-replay-combined-badge"),
      title: element.querySelector("#gen-replay-combined-title"),
      reason: element.querySelector("#gen-replay-combined-reason"),
    };
  }

  function nLayerHTML() {
    return document.getElementById("generator-n-layer")?.innerHTML || "";
  }

  function restoreNLayer(html) {
    const layer = document.getElementById("generator-n-layer");
    if (layer) layer.innerHTML = html || "";
  }

  function installBoardCapture() {
    const current = window._setBoardArr;
    if (typeof current !== "function" || current.__stoneAttemptReplayCapture) return;

    function capturedSetBoardArr(board, attacker) {
      capturedBoard = compactBoard(board);
      capturedAttacker = attacker || GEN_BLACK;
      return current.apply(this, arguments);
    }
    capturedSetBoardArr.__stoneAttemptReplayCapture = true;
    window._setBoardArr = capturedSetBoardArr;
  }

  function statusLabel(status) {
    if (status === "passed") return "通過";
    if (status === "failed") return "未通過";
    if (status === "pending") return "驗證中";
    return "紀錄";
  }

  function stopOriginalControl(event) {
    event.preventDefault();
    event.stopImmediatePropagation();
  }

  function showReplayStep(index) {
    const ui = combinedUI();
    if (!ui || running || !replaySteps.length) return;
    replayIndex = Math.max(0, Math.min(replaySteps.length - 1, index));
    const step = replaySteps[replayIndex];
    const atFirst = replayIndex <= 0;
    const atLast = replayIndex >= replaySteps.length - 1;

    ui.element.hidden = false;
    ui.count.textContent = `${replayIndex + 1} / ${replaySteps.length}`;
    ui.first.disabled = atFirst;
    ui.prev.disabled = atFirst;
    ui.next.disabled = atLast;
    ui.last.disabled = atLast;
    ui.badge.dataset.status = step.status || "info";
    ui.badge.textContent = statusLabel(step.status);
    ui.title.textContent = step.title || "盤面紀錄";
    ui.reason.textContent = [step.reason, step.detail].filter(Boolean).join("；");

    installBoardCapture();
    if (typeof window._setBoardArr === "function") {
      window._setBoardArr(expandedBoard(step.board), step.attacker || GEN_BLACK);
    }
    restoreNLayer(step.nLayerHTML);
  }

  function installUnifiedControls() {
    if (controlsInstalled) return true;
    const ui = combinedUI();
    if (!ui?.first || !ui.prev || !ui.next || !ui.last) return false;
    controlsInstalled = true;

    ui.first.addEventListener("click", event => {
      if (allowBaseControl || !unifiedActive) return;
      stopOriginalControl(event);
      showReplayStep(0);
    }, true);
    ui.prev.addEventListener("click", event => {
      if (allowBaseControl || !unifiedActive) return;
      stopOriginalControl(event);
      showReplayStep(replayIndex - 1);
    }, true);
    ui.next.addEventListener("click", event => {
      if (allowBaseControl || !unifiedActive) return;
      stopOriginalControl(event);
      showReplayStep(replayIndex + 1);
    }, true);
    ui.last.addEventListener("click", event => {
      if (allowBaseControl || !unifiedActive) return;
      stopOriginalControl(event);
      showReplayStep(replaySteps.length - 1);
    }, true);
    return true;
  }

  function captureCombinedStep(ui) {
    if (!capturedBoard) return null;
    return {
      board: compactBoard(capturedBoard),
      attacker: capturedAttacker || GEN_BLACK,
      status: ui.badge?.dataset?.status || "info",
      title: ui.title?.textContent || "盤面紀錄",
      reason: ui.reason?.textContent || "",
      detail: "",
      nLayerHTML: nLayerHTML(),
      signature: boardSignature(capturedBoard),
      source: "base",
    };
  }

  function harvestBaseReplay() {
    const ui = combinedUI();
    if (!ui?.first || !ui.next) return [];
    installBoardCapture();

    allowBaseControl = true;
    try {
      ui.first.disabled = false;
      ui.first.click();
      const records = [];
      let guard = 0;
      while (guard++ < 100000) {
        const record = captureCombinedStep(ui);
        if (record) records.push(record);
        if (ui.next.disabled) break;
        ui.next.click();
      }
      return records;
    } finally {
      allowBaseControl = false;
    }
  }

  function makeAttemptStep(attempt) {
    return {
      board: compactBoard(attempt.board),
      attacker: attempt.attacker,
      status: attempt.status,
      title: attempt.title,
      reason: attempt.reason,
      detail: attempt.detail,
      nLayerHTML: "",
      signature: boardSignature(attempt.board),
      source: "attempt",
    };
  }

  function makeSingleStoneStep(parentBoard, targetBoard, idx, baseStep, ordinal, total) {
    const board = compactBoard(parentBoard);
    board[idx] = targetBoard[idx];
    return {
      board,
      attacker: baseStep.attacker,
      status: "pending",
      title: `補守：補上${colorName(board[idx])} ${pointName(idx)}`,
      reason: total > 1
        ? `原回放一次加入 ${total} 顆，已拆成第 ${ordinal} 顆逐步顯示`
        : "已放下這一顆，正在重新驗證",
      detail: "",
      nLayerHTML: "",
      signature: boardSignature(board),
      source: "synthetic-attempt",
    };
  }

  function isAggregatedBaseStep(step) {
    return /補上\s*\d+\s*顆棋子後驗證/.test(step?.title || "");
  }

  function mergeReplaySteps(baseRecords) {
    const output = [];
    const usedAttempts = new Set();
    let previousBoard = null;

    for (const base of baseRecords) {
      const inserted = [];
      for (let index = 0; index < attempts.length; index++) {
        if (usedAttempts.has(index)) continue;
        const attempt = attempts[index];
        if (!boardIsSubset(attempt.board, base.board)) continue;
        if (previousBoard && !boardIsSubset(previousBoard, attempt.board)) continue;
        inserted.push({ index, step: makeAttemptStep(attempt) });
      }

      for (const item of inserted) {
        usedAttempts.add(item.index);
        output.push(item.step);
        previousBoard = item.step.board;
      }

      if (previousBoard && boardIsSubset(previousBoard, base.board)) {
        const additions = addedPoints(previousBoard, base.board);
        if (additions.length > 1 && isAggregatedBaseStep(base)) {
          let bridge = compactBoard(previousBoard);
          additions.forEach((idx, index) => {
            const step = makeSingleStoneStep(
              bridge,
              base.board,
              idx,
              base,
              index + 1,
              additions.length,
            );
            output.push(step);
            bridge = compactBoard(step.board);
          });
          previousBoard = bridge;
        }
      }

      const duplicateAttemptBoard =
        output.length &&
        output[output.length - 1].signature === base.signature &&
        isAggregatedBaseStep(base);
      if (!duplicateAttemptBoard) {
        output.push(base);
        previousBoard = base.board;
      }
    }

    for (let index = 0; index < attempts.length; index++) {
      if (usedAttempts.has(index)) continue;
      output.push(makeAttemptStep(attempts[index]));
    }

    return output;
  }

  function rebuildUnifiedReplay(token, retries = 0) {
    if (token !== rebuildToken || running) return;
    const ui = combinedUI();
    if (!ui) {
      if (retries < 20) window.setTimeout(() => rebuildUnifiedReplay(token, retries + 1), 0);
      return;
    }

    installUnifiedControls();
    const baseRecords = harvestBaseReplay();
    if (!baseRecords.length && !attempts.length) {
      if (retries < 20) window.setTimeout(() => rebuildUnifiedReplay(token, retries + 1), 0);
      else ui.element.hidden = true;
      return;
    }

    replaySteps = mergeReplaySteps(baseRecords);
    unifiedActive = replaySteps.length > 0;
    replayIndex = replaySteps.length - 1;
    if (unifiedActive) showReplayStep(replayIndex);
    else ui.element.hidden = true;
  }

  function rememberBoard(board, attacker, source) {
    knownBoards.push({
      session,
      board,
      signature: boardSignature(board),
      attacker,
      source,
    });
    if (knownBoards.length > MAX_KNOWN_BOARDS) {
      knownBoards.splice(0, knownBoards.length - MAX_KNOWN_BOARDS);
    }
  }

  function findOneStoneParent(board, attacker) {
    const defender = genOther(attacker);
    for (let i = knownBoards.length - 1; i >= 0; i--) {
      const parent = knownBoards[i];
      if (parent.session !== session || parent.attacker !== attacker) continue;
      if (!boardIsSubset(parent.board, board)) continue;
      let added = -1;
      let count = 0;
      for (let idx = 0; idx < BOARD_CELLS; idx++) {
        if (parent.board[idx] === GEN_EMPTY && board[idx] !== GEN_EMPTY) {
          added = idx;
          count++;
          if (count > 1) break;
        }
      }
      if (count === 1 && board[added] === defender) return { parent, idx: added };
    }
    return null;
  }

  function recordBoard(boardSource, attacker, kind, phase, source) {
    if (!running) return;
    const board = compactBoard(boardSource);
    const parentInfo = findOneStoneParent(board, attacker);
    rememberBoard(board, attacker, source);
    if (!parentInfo) return;

    const idx = parentInfo.idx;
    const pointKey = `${kind}:${idx}`;
    const exactKey = `${kind}:${parentInfo.parent.signature}:${idx}`;
    const pointCount = (pointAttempts.get(pointKey) || 0) + 1;
    const exactCount = (exactAttempts.get(exactKey) || 0) + 1;
    pointAttempts.set(pointKey, pointCount);
    exactAttempts.set(exactKey, exactCount);

    const label = kind === "balance"
      ? "補齊子數"
      : phase === "final"
        ? "封鎖其他 VCF"
        : "補守";
    const detail = [];
    if (pointCount > 1) detail.push(`此座標第 ${pointCount} 次嘗試`);
    if (exactCount > 1) {
      detail.push(`相同盤面第 ${exactCount} 次重複嘗試`);
    } else if (pointCount > 1) {
      detail.push("前置盤面不同，因此仍可能成為有效防點");
    }

    attempts.push({
      session,
      board,
      attacker,
      idx,
      kind,
      phase,
      status: "pending",
      title: `${label}：補上${colorName(board[idx])} ${pointName(idx)}`,
      reason: "已放下這一顆，正在重新驗證",
      detail: detail.join("；"),
    });
  }

  function finalizeAttempts(resultBoard, stopped = false) {
    const finalBoard = resultBoard ? compactBoard(resultBoard) : null;
    for (const attempt of attempts) {
      if (attempt.status !== "pending") continue;
      if (finalBoard && boardIsSubset(attempt.board, finalBoard)) {
        attempt.status = "passed";
        attempt.reason = "此補子位於最後採用的路徑";
      } else {
        attempt.status = "failed";
        attempt.reason = stopped
          ? "產生已停止，此補子分支未完成"
          : "此補子分支驗證失敗，已撤銷並回溯";
      }
    }
  }

  Worker.prototype.postMessage = function postMessageWithStoneReplay(message) {
    try {
      if (message?.type === "findFirstNonTarget" && message?.data?.arr) {
        const status = currentStatus();
        const phase = status.includes("逐條驗證並封鎖其他 VCF")
          || status.includes("封鎖其他完成盤面")
          ? "final"
          : "mid";
        recordBoard(
          message.data.arr,
          Number(message.data.color) === GEN_WHITE ? GEN_WHITE : GEN_BLACK,
          "defense",
          phase,
          "first-non-target",
        );
      }
    } catch (error) {
      console.warn("逐顆補子回放記錄失敗", error);
    }
    return originalWorkerPostMessage.apply(this, arguments);
  };

  genEngine.findVCF = async function findVCFWithBalanceAttemptReplay(
    board,
    attacker,
    maxVCF,
    options,
  ) {
    const status = currentStatus();
    if (status.includes("補齊黑白子數") || status.includes("補齊子數")) {
      recordBoard(board, attacker, "balance", "balance", "balance-find-vcf");
    } else if (running) {
      rememberBoard(compactBoard(board), attacker, "normal-find-vcf");
    }
    return originalFindVCF(board, attacker, maxVCF, options);
  };

  genSetBusy = function setBusyWithUnifiedStoneReplay(value) {
    if (value) {
      session++;
      running = true;
      attempts = [];
      knownBoards = [];
      pointAttempts = new Map();
      exactAttempts = new Map();
      lastResultBoard = null;
      replaySteps = [];
      replayIndex = -1;
      unifiedActive = false;
      rebuildToken++;
      document.getElementById("gen-stone-attempt-panel")?.remove();
    }

    const result = originalSetBusy(value);
    if (!value) {
      const stopped = genCancelled || currentStatus().includes("停止");
      finalizeAttempts(lastResultBoard, stopped);
      running = false;
      const token = ++rebuildToken;
      window.setTimeout(() => rebuildUnifiedReplay(token), 0);
    }
    return result;
  };

  genShowResult = function showResultWithUnifiedStoneReplay(
    result,
    targetSteps,
    attacker,
    counters,
    options,
  ) {
    lastResultBoard = result?.board ? compactBoard(result.board) : null;
    finalizeAttempts(lastResultBoard, false);
    return originalShowResult(result, targetSteps, attacker, counters, options);
  };

  installBoardCapture();
  installUnifiedControls();
  document.getElementById("gen-stone-attempt-panel")?.remove();
})();
