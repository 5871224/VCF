"use strict";

// Defender replay receives explicit events from the actual placement branches.
// It never intercepts Worker requests or guesses parent boards, attacker colors,
// defender colors, or added coordinates from unrelated search states.
(function installGeneratorStoneAttemptReplay() {
  if (window.__generatorStoneAttemptReplayInstalled) return;
  window.__generatorStoneAttemptReplayInstalled = true;

  const BOARD_CELLS = 225;
  const originalSetBusy = genSetBusy;

  let session = 0;
  let running = false;
  let attempts = [];
  let attemptIndex = -1;
  let nextAttemptId = 1;
  let pendingAttempts = new Map();

  let compositeInstalled = false;
  let allowBaseControl = false;
  let replayMode = "base";
  let baseCount = 0;
  let baseIndex = 0;

  function normalizeColor(color) {
    return Number(color) === GEN_WHITE ? GEN_WHITE : GEN_BLACK;
  }

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

  function cloneNMask(source) {
    const nMask = new Uint8Array(BOARD_CELLS);
    if (source) nMask.set(Uint8Array.from(source).subarray(0, BOARD_CELLS));
    return nMask;
  }

  function pointName(idx) {
    if (typeof genName === "function") return genName(idx);
    return "ABCDEFGHJKLMNOP"[idx % 15] + (15 - Math.floor(idx / 15));
  }

  function sideName(color) {
    return color === GEN_BLACK ? "黑方" : "白方";
  }

  function colorName(color) {
    return color === GEN_BLACK ? "黑子" : "白子";
  }

  function phaseLabel(phase) {
    if (phase === "final") return "封鎖其他 VCF";
    if (phase === "balance") return "補齊子數";
    return "補守";
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
    button.disabled = false;
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
    document.getElementById("gen-stone-attempt-panel")?.remove();
    const ui = combinedUI();
    if (!ui) return;

    const parsed = parseCount(ui.count?.textContent);
    baseCount = parsed.count;
    baseIndex = parsed.index || baseCount;
    replayMode = "base";
    attemptIndex = -1;
    installCompositeControls();

    if (baseCount <= 0 && attempts.length) {
      showAttempt(attempts.length - 1);
      return;
    }
    syncBaseView();
  }

  function beginDefenderAttempt(payload) {
    if (!running || !payload?.board) return null;

    const attacker = normalizeColor(payload.attacker);
    const defender = normalizeColor(payload.defender);
    const expectedDefender = genOther(attacker);
    const idx = Number(payload.idx);
    const board = compactBoard(payload.board);

    if (
      !Number.isInteger(idx) ||
      idx < 0 ||
      idx >= BOARD_CELLS ||
      defender !== expectedDefender ||
      board[idx] !== defender
    ) {
      console.error("補守回放事件的攻守色或落子盤面不一致", {
        attacker,
        defender,
        expectedDefender,
        idx,
        boardValue: Number.isInteger(idx) ? board[idx] : null,
        phase: payload.phase,
      });
      return null;
    }

    const id = nextAttemptId++;
    const label = phaseLabel(payload.phase);
    const attempt = {
      id,
      session,
      board,
      nMask: cloneNMask(payload.nMask),
      attacker,
      defender,
      idx,
      phase: payload.phase || "mid",
      status: "pending",
      title: `${label}：補上${colorName(defender)} ${pointName(idx)}`,
      reason: "已由實際補子分支放下這一顆，正在重新驗證",
      detail: `攻方 ${sideName(attacker)}；守方 ${sideName(defender)}`,
    };
    attempts.push(attempt);
    pendingAttempts.set(id, attempt);
    return id;
  }

  function endDefenderAttempt(id, passed, reason = "") {
    if (id == null) return;
    const attempt = pendingAttempts.get(id);
    if (!attempt || attempt.session !== session) return;

    attempt.status = passed ? "passed" : "failed";
    attempt.reason = reason || (passed
      ? "此補子分支驗證通過，保留在採用路徑"
      : "此補子分支驗證失敗，已撤銷並回溯");
    pendingAttempts.delete(id);
  }

  window.genReplayBeginDefenderAttempt = beginDefenderAttempt;
  window.genReplayEndDefenderAttempt = endDefenderAttempt;

  genSetBusy = function setBusyWithExplicitDefenderReplay(value) {
    if (value) {
      session++;
      running = true;
      attempts = [];
      attemptIndex = -1;
      nextAttemptId = 1;
      pendingAttempts = new Map();
      replayMode = "base";
      baseCount = 0;
      baseIndex = 0;
      document.getElementById("gen-stone-attempt-panel")?.remove();
    }

    const result = originalSetBusy(value);
    if (!value) {
      const stopped = genCancelled || currentStatus().includes("停止");
      for (const attempt of pendingAttempts.values()) {
        attempt.status = "failed";
        attempt.reason = stopped
          ? "產生已停止，此補子分支未完成"
          : "此補子分支沒有完成驗證，已視為失敗";
      }
      pendingAttempts.clear();
      running = false;
      window.setTimeout(mergeIntoCombinedReplay, 0);
    }
    return result;
  };

  document.getElementById("gen-stone-attempt-panel")?.remove();
})();
