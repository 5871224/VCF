"use strict";

// 補子回放與完整回放共用同一條時間軸。
// 不再攔截後切換「基礎回放／補子回放」兩套索引；產生結束後先收集完整回放，
// 再把每一顆實際補入的棋子依盤面插入同一份步驟陣列。
(function installUnifiedGeneratorStoneReplay(global) {
  if (global.__generatorStoneAttemptReplayInstalled) return;
  global.__generatorStoneAttemptReplayInstalled = true;

  const BOARD_CELLS = 225;
  const originalSetBusy = genSetBusy;

  let session = 0;
  let running = false;
  let attempts = [];
  let pendingAttempts = new Map();
  let nextAttemptId = 1;

  let unifiedSteps = [];
  let unifiedIndex = -1;
  let unifiedActive = false;
  let allowBaseControl = false;

  function parseColor(color) {
    const value = Number(color);
    return value === GEN_BLACK || value === GEN_WHITE ? value : null;
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

  function boardSignature(board) {
    let signature = "";
    for (let idx = 0; idx < BOARD_CELLS; idx++) {
      signature += board?.[idx] === GEN_BLACK
        ? "1"
        : board?.[idx] === GEN_WHITE
          ? "2"
          : "0";
    }
    return signature;
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

  function combinedUI() {
    const panel = document.getElementById("gen-replay-combined-panel");
    if (!panel) return null;
    return {
      panel,
      first: panel.querySelector("#gen-replay-combined-first"),
      prev: panel.querySelector("#gen-replay-combined-prev"),
      next: panel.querySelector("#gen-replay-combined-next"),
      last: panel.querySelector("#gen-replay-combined-last"),
      count: panel.querySelector("#gen-replay-combined-count"),
      badge: panel.querySelector("#gen-replay-combined-badge"),
      title: panel.querySelector("#gen-replay-combined-title"),
      reason: panel.querySelector("#gen-replay-combined-reason"),
    };
  }

  function statusLabel(status) {
    if (status === "passed") return "通過";
    if (status === "failed") return "未通過";
    if (status === "pending") return "驗證中";
    return "紀錄";
  }

  function clearNLayer() {
    const layer = document.getElementById("generator-n-layer");
    if (!layer) return;
    while (layer.firstChild) layer.firstChild.remove();
  }

  function renderNPoints(source) {
    clearNLayer();
    const layer = document.getElementById("generator-n-layer");
    if (!layer) return;

    const ns = "http://www.w3.org/2000/svg";
    const bothMask = GEN_NO_BLACK | GEN_NO_WHITE;
    const nMask = cloneNMask(source);
    const size = 13;

    for (let idx = 0; idx < BOARD_CELLS; idx++) {
      const mask = nMask[idx] & bothMask;
      if (!mask) continue;

      const both = mask === bothMask;
      const cx = 22 + (idx % 15) * 34;
      const cy = 22 + Math.floor(idx / 15) * 34;
      const rect = document.createElementNS(ns, "rect");
      rect.setAttribute("x", cx - size / 2);
      rect.setAttribute("y", cy - size / 2);
      rect.setAttribute("width", size);
      rect.setAttribute("height", size);
      rect.setAttribute("rx", 2);
      rect.setAttribute("fill", both ? "#2e9f45" : (mask & GEN_NO_BLACK) ? "#222" : "#f8f8f8");
      rect.setAttribute("stroke", both ? "#176729" : "#d02020");
      rect.setAttribute("stroke-width", 2);
      rect.setAttribute("opacity", .92);

      const title = document.createElementNS(ns, "title");
      title.textContent = both
        ? "雙方 N 點"
        : (mask & GEN_NO_BLACK)
          ? "黑方 N 點"
          : "白方 N 點";
      rect.appendChild(title);
      layer.appendChild(rect);
    }
  }

  function captureRenderedNMask() {
    const nMask = new Uint8Array(BOARD_CELLS);
    const layer = document.getElementById("generator-n-layer");
    if (!layer) return nMask;

    const bothMask = GEN_NO_BLACK | GEN_NO_WHITE;
    layer.querySelectorAll("rect").forEach(rect => {
      const width = Number(rect.getAttribute("width")) || 13;
      const height = Number(rect.getAttribute("height")) || 13;
      const cx = Number(rect.getAttribute("x")) + width / 2;
      const cy = Number(rect.getAttribute("y")) + height / 2;
      const col = Math.round((cx - 22) / 34);
      const row = Math.round((cy - 22) / 34);
      if (col < 0 || col >= 15 || row < 0 || row >= 15) return;

      const text = rect.querySelector("title")?.textContent || "";
      const idx = row * 15 + col;
      if (text.includes("雙方")) nMask[idx] = bothMask;
      else if (text.includes("黑方")) nMask[idx] = GEN_NO_BLACK;
      else if (text.includes("白方")) nMask[idx] = GEN_NO_WHITE;
    });
    return nMask;
  }

  function stopBaseControl(event) {
    event.preventDefault();
    event.stopImmediatePropagation();
  }

  function showUnifiedStep(index) {
    const ui = combinedUI();
    if (!ui || running || !unifiedSteps.length) return;

    unifiedIndex = Math.max(0, Math.min(unifiedSteps.length - 1, index));
    const step = unifiedSteps[unifiedIndex];
    const atFirst = unifiedIndex <= 0;
    const atLast = unifiedIndex >= unifiedSteps.length - 1;

    ui.panel.hidden = false;
    ui.count.textContent = `${unifiedIndex + 1} / ${unifiedSteps.length}`;
    ui.first.disabled = atFirst;
    ui.prev.disabled = atFirst;
    ui.next.disabled = atLast;
    ui.last.disabled = atLast;
    ui.badge.dataset.status = step.status || "info";
    ui.badge.textContent = statusLabel(step.status);
    ui.title.textContent = step.title || "盤面紀錄";
    ui.reason.textContent = [step.reason, step.detail].filter(Boolean).join("；");

    if (typeof global._setBoardArr === "function") {
      global._setBoardArr(expandedBoard(step.board), step.attacker || genGetAttacker());
    }
    renderNPoints(step.nMask);
  }

  function installUnifiedControls() {
    const ui = combinedUI();
    if (!ui?.first || !ui.prev || !ui.next || !ui.last) return false;
    if (ui.panel.dataset.unifiedStoneReplayControls === "1") return true;
    ui.panel.dataset.unifiedStoneReplayControls = "1";

    ui.first.addEventListener("click", event => {
      if (!unifiedActive || allowBaseControl || running) return;
      stopBaseControl(event);
      showUnifiedStep(0);
    }, true);

    ui.prev.addEventListener("click", event => {
      if (!unifiedActive || allowBaseControl || running) return;
      stopBaseControl(event);
      showUnifiedStep(unifiedIndex - 1);
    }, true);

    ui.next.addEventListener("click", event => {
      if (!unifiedActive || allowBaseControl || running) return;
      stopBaseControl(event);
      showUnifiedStep(unifiedIndex + 1);
    }, true);

    ui.last.addEventListener("click", event => {
      if (!unifiedActive || allowBaseControl || running) return;
      stopBaseControl(event);
      showUnifiedStep(unifiedSteps.length - 1);
    }, true);

    return true;
  }

  function runBaseClick(button) {
    if (!button || button.disabled) return false;
    allowBaseControl = true;
    try {
      button.click();
    } finally {
      allowBaseControl = false;
    }
    return true;
  }

  function captureBaseStep(ui) {
    const board = typeof global._getArr === "function"
      ? compactBoard(global._getArr())
      : null;
    if (!board) return null;

    return {
      board,
      signature: boardSignature(board),
      nMask: captureRenderedNMask(),
      attacker: genGetAttacker(),
      status: ui.badge?.dataset?.status || "info",
      title: ui.title?.textContent || "盤面紀錄",
      reason: ui.reason?.textContent || "",
      detail: "",
    };
  }

  function harvestBaseReplay() {
    const ui = combinedUI();
    if (!ui?.prev || !ui.next || ui.panel.hidden) return [];

    unifiedActive = false;
    let guard = 0;
    while (!ui.prev.disabled && guard++ < 100000) {
      if (!runBaseClick(ui.prev)) break;
    }

    const records = [];
    guard = 0;
    while (guard++ < 100000) {
      const step = captureBaseStep(ui);
      if (step) records.push(step);
      if (ui.next.disabled || !runBaseClick(ui.next)) break;
    }
    return records;
  }

  function mergeReplay(baseSteps) {
    const remaining = new Set(attempts.map(attempt => attempt.id));
    const output = [];

    for (const base of baseSteps) {
      const matching = attempts.filter(attempt =>
        remaining.has(attempt.id) && attempt.signature === base.signature
      );
      if (matching.length) {
        for (const attempt of matching) {
          output.push({ ...attempt, nMask: cloneNMask(attempt.nMask) });
          remaining.delete(attempt.id);
        }
      } else {
        output.push(base);
      }
    }

    for (const attempt of attempts) {
      if (!remaining.has(attempt.id)) continue;
      output.push({ ...attempt, nMask: cloneNMask(attempt.nMask) });
      remaining.delete(attempt.id);
    }

    return output;
  }

  function rebuildUnifiedReplay() {
    if (running) return;
    const ui = combinedUI();
    if (!ui) return;

    installUnifiedControls();
    const baseSteps = harvestBaseReplay();
    unifiedSteps = mergeReplay(baseSteps);
    unifiedActive = unifiedSteps.length > 0;
    unifiedIndex = unifiedSteps.length - 1;

    document.getElementById("gen-replay-panel")?.setAttribute("hidden", "");
    document.getElementById("gen-stone-attempt-panel")?.remove();

    if (!unifiedActive) {
      ui.panel.hidden = true;
      return;
    }
    showUnifiedStep(unifiedIndex);
  }

  function beginDefenderAttempt(payload) {
    if (!running || !payload?.board) return null;

    const attacker = parseColor(payload.attacker);
    const placedColor = parseColor(payload.color ?? payload.defender);
    const phase = payload.phase || "mid";
    const expectedDefender = attacker == null ? null : genOther(attacker);
    const idx = Number(payload.idx);
    const board = compactBoard(payload.board);
    const isBalance = phase === "balance";
    const role = placedColor === attacker
      ? "attacker"
      : placedColor === expectedDefender
        ? "defender"
        : "invalid";

    if (
      attacker == null ||
      placedColor == null ||
      !Number.isInteger(idx) ||
      idx < 0 ||
      idx >= BOARD_CELLS ||
      role === "invalid" ||
      (!isBalance && role !== "defender") ||
      board[idx] !== placedColor
    ) {
      console.error("補子回放事件的攻守色或落子盤面不一致", {
        attacker,
        placedColor,
        expectedDefender,
        role,
        idx,
        boardValue: Number.isInteger(idx) ? board[idx] : null,
        phase,
      });
      return null;
    }

    const id = nextAttemptId++;
    const label = phaseLabel(phase);
    const roleText = role === "attacker" ? "攻方" : "守方";
    const attempt = {
      id,
      session,
      board,
      signature: boardSignature(board),
      nMask: cloneNMask(payload.nMask),
      attacker,
      color: placedColor,
      role,
      idx,
      phase,
      status: "pending",
      title: `${label}：補上${colorName(placedColor)} ${pointName(idx)}`,
      reason: "已放下這一顆棋，正在重新驗證",
      detail: isBalance
        ? `本次補入${roleText}；攻方 ${sideName(attacker)}；守方 ${sideName(expectedDefender)}`
        : `攻方 ${sideName(attacker)}；守方 ${sideName(expectedDefender)}`,
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

  global.genReplayBeginDefenderAttempt = beginDefenderAttempt;
  global.genReplayEndDefenderAttempt = endDefenderAttempt;

  genSetBusy = function setBusyWithUnifiedStoneReplay(value) {
    if (value) {
      session++;
      running = true;
      attempts = [];
      pendingAttempts = new Map();
      nextAttemptId = 1;
      unifiedSteps = [];
      unifiedIndex = -1;
      unifiedActive = false;
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

      // 完整回放會在自己的 setTimeout(0) 中重建；再延後一輪收集它，
      // 最後只由這一條統一時間軸控制畫面與步驟數。
      global.setTimeout(() => {
        global.setTimeout(rebuildUnifiedReplay, 0);
      }, 0);
    }
    return result;
  };

  document.getElementById("gen-stone-attempt-panel")?.remove();
})(window);
