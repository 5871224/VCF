"use strict";

// Record every one-stone defender attempt and merge it into the existing replay
// toolbar. No second replay card is created: the original replay count is extended
// with the defender attempts, and the same first/previous/next/last controls browse
// the complete sequence.
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
  let attemptIndex = -1;
  let knownBoards = [];
  let pointAttempts = new Map();
  let exactAttempts = new Map();
  let lastResultBoard = null;

  let compositeInstalled = false;
  let allowBaseControl = false;
  let replayMode = "base";
  let baseCount = 0;
  let baseIndex = 0;

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
    for (let idx = 0; idx < BOARD_CELLS; idx++) {
      if (subset[idx] !== GEN_EMPTY && subset[idx] !== superset[idx]) {
        return false;
      }
    }
    return true;
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

  function clearNLayer() {
    const layer = document.getElementById("generator-n-layer");
    if (!layer) return;
    while (layer.firstChild) layer.firstChild.remove();
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

  function parseCount(text) {
    const match = String(text || "").match(/(\d+)\s*\/\s*(\d+)/);
    return match
      ? { index: Number(match[1]), count: Number(match[2]) }
      : { index: 0, count: 0 };
  }

  function stopBaseControl(event) {
    event.preventDefault();
    event.stopImmediatePropagation();
  }

  function totalCount() {
    return baseCount + attempts.length;
  }

  function syncBaseView() {
    const ui = combinedUI();
    if (!ui || replayMode !== "base") return;
    const parsed = parseCount(ui.count?.textContent);
    if (parsed.index > 0 && parsed.index <= baseCount) {
      baseIndex = parsed.index;
    }
    if (!baseIndex && baseCount) baseIndex = baseCount;

    ui.element.hidden = baseCount <= 0;
    if (ui.count) ui.count.textContent = `${baseIndex} / ${totalCount()}`;
    if (ui.first) ui.first.disabled = baseIndex <= 1;
    if (ui.prev) ui.prev.disabled = baseIndex <= 1;
    if (ui.next) {
      ui.next.disabled = baseIndex >= baseCount && attempts.length === 0;
    }
    if (ui.last) {
      ui.last.disabled = baseIndex >= baseCount && attempts.length === 0;
    }
  }

  function runBaseControl(button) {
    if (!button) return;
    allowBaseControl = true;
    try {
      button.click();
    } finally {
      allowBaseControl = false;
    }
    replayMode = "base";
    queueMicrotask(syncBaseView);
  }

  function statusLabel(status) {
    if (status === "passed") return "通過";
    if (status === "failed") return "未通過";
    return "驗證中";
  }

  function showAttempt(index) {
    const ui = combinedUI();
    if (!ui || running || !attempts.length) return;
    replayMode = "attempt";
    attemptIndex = Math.max(0, Math.min(attempts.length - 1, index));
    const attempt = attempts[attemptIndex];
    const overallIndex = baseCount + attemptIndex + 1;
    const atLast = attemptIndex >= attempts.length - 1;

    ui.element.hidden = false;
    ui.count.textContent = `${overallIndex} / ${totalCount()}`;
    ui.first.disabled = false;
    ui.prev.disabled = false;
    ui.next.disabled = atLast;
    ui.last.disabled = atLast;
    ui.badge.dataset.status = attempt.status;
    ui.badge.textContent = statusLabel(attempt.status);
    ui.title.textContent = attempt.title;
    ui.reason.textContent = [attempt.reason, attempt.detail]
      .filter(Boolean)
      .join("；");

    if (typeof window._setBoardArr === "function") {
      window._setBoardArr(expandedBoard(attempt.board), attempt.attacker);
    }
    clearNLayer();
  }

  function installCompositeControls() {
    if (compositeInstalled) return true;
    const ui = combinedUI();
    if (!ui?.first || !ui.prev || !ui.next || !ui.last) return false;
    compositeInstalled = true;

    ui.first.addEventListener("click", event => {
      if (allowBaseControl) return;
      if (replayMode === "attempt") {
        stopBaseControl(event);
        runBaseControl(ui.first);
        return;
      }
      queueMicrotask(syncBaseView);
    }, true);

    ui.prev.addEventListener("click", event => {
      if (allowBaseControl) return;
      if (replayMode === "attempt") {
        stopBaseControl(event);
        if (attemptIndex > 0) showAttempt(attemptIndex - 1);
        else runBaseControl(ui.last);
        return;
      }
      queueMicrotask(syncBaseView);
    }, true);

    ui.next.addEventListener("click", event => {
      if (allowBaseControl) return;
      if (replayMode === "attempt") {
        stopBaseControl(event);
        if (attemptIndex < attempts.length - 1) showAttempt(attemptIndex + 1);
        return;
      }
      if (attempts.length && baseIndex >= baseCount) {
        stopBaseControl(event);
        showAttempt(0);
        return;
      }
      queueMicrotask(syncBaseView);
    }, true);

    ui.last.addEventListener("click", event => {
      if (allowBaseControl) return;
      if (attempts.length) {
        stopBaseControl(event);
        showAttempt(attempts.length - 1);
        return;
      }
      queueMicrotask(syncBaseView);
    }, true);
    return true;
  }

  function mergeIntoCombinedReplay() {
    const obsoletePanel = document.getElementById("gen-stone-attempt-panel");
    obsoletePanel?.remove();

    const ui = combinedUI();
    if (!ui) return;
    const parsed = parseCount(ui.count?.textContent);
    baseCount = parsed.count;
    baseIndex = parsed.index || baseCount;
    replayMode = "base";
    attemptIndex = -1;
    installCompositeControls();
    syncBaseView();
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
      if (count === 1 && board[added] === defender) {
        return { parent, idx: added };
      }
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

  genSetBusy = function setBusyWithMergedStoneReplay(value) {
    if (value) {
      session++;
      running = true;
      attempts = [];
      attemptIndex = -1;
      knownBoards = [];
      pointAttempts = new Map();
      exactAttempts = new Map();
      lastResultBoard = null;
      replayMode = "base";
      baseCount = 0;
      baseIndex = 0;
      document.getElementById("gen-stone-attempt-panel")?.remove();
    }

    const result = originalSetBusy(value);
    if (!value) {
      const stopped = genCancelled || currentStatus().includes("停止");
      finalizeAttempts(lastResultBoard, stopped);
      running = false;
      // Complete replay schedules its rebuild from originalSetBusy(false). Queue
      // this after it, then extend that same panel with the defender attempts.
      window.setTimeout(mergeIntoCombinedReplay, 0);
    }
    return result;
  };

  genShowResult = function showResultWithMergedStoneReplay(
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

  document.getElementById("gen-stone-attempt-panel")?.remove();
})();
