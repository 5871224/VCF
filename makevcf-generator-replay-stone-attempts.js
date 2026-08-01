"use strict";

// Record every one-stone defender attempt without changing generator search logic.
// The normal replay can miss private recursive blocker states because those searches
// bypass genEngine.findVCF. This supplemental replay listens at the two actual search
// boundaries and records the board immediately after each defender stone is placed.
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
  let panel = null;
  let lastResultBoard = null;

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

  function ensurePanel() {
    if (panel) return panel;
    const anchor = document.getElementById("gen-replay-combined-panel")
      || document.getElementById("gen-replay-panel")
      || genEl("status");
    const parent = anchor?.parentNode;
    if (!parent) return null;

    if (!document.querySelector('style[data-stone-attempt-replay="true"]')) {
      const style = document.createElement("style");
      style.dataset.stoneAttemptReplay = "true";
      style.textContent = `
        .gen-stone-attempt-panel {
          width: min(100%, 760px);
          margin: 8px auto 0;
          padding: 10px 12px;
          border: 1px solid #b9c9dc;
          border-radius: 8px;
          background: #f8fbff;
          box-shadow: 0 1px 5px rgba(0, 0, 0, 0.07);
          font-size: 13px;
        }
        .gen-stone-attempt-panel[hidden] { display: none !important; }
        .gen-stone-attempt-toolbar,
        .gen-stone-attempt-summary {
          display: flex;
          justify-content: center;
          align-items: center;
          gap: 8px;
          flex-wrap: wrap;
        }
        .gen-stone-attempt-summary { margin-top: 8px; text-align: center; }
        .gen-stone-attempt-toolbar button { min-width: 68px; }
        .gen-stone-attempt-count { min-width: 104px; text-align: center; font-weight: 700; }
        .gen-stone-attempt-badge {
          display: inline-flex;
          justify-content: center;
          align-items: center;
          min-width: 52px;
          padding: 2px 8px;
          border-radius: 999px;
          font-weight: 700;
        }
        .gen-stone-attempt-badge[data-status="passed"] { color: #126b2c; background: #dff4e5; }
        .gen-stone-attempt-badge[data-status="failed"] { color: #9a2f24; background: #fbe2df; }
        .gen-stone-attempt-badge[data-status="pending"] { color: #6b5a19; background: #fff2bf; }
        .gen-stone-attempt-title { font-weight: 700; }
        .gen-stone-attempt-reason { margin-top: 6px; line-height: 1.55; text-align: center; }
      `;
      document.head.appendChild(style);
    }

    const element = document.createElement("section");
    element.id = "gen-stone-attempt-panel";
    element.className = "gen-stone-attempt-panel";
    element.hidden = true;
    element.innerHTML = `
      <div class="gen-stone-attempt-toolbar">
        <button data-action="first" type="button">最前</button>
        <button data-action="prev" type="button">上一步</button>
        <span class="gen-stone-attempt-count">0 / 0</span>
        <button data-action="next" type="button">下一步</button>
        <button data-action="last" type="button">最後</button>
      </div>
      <div class="gen-stone-attempt-summary">
        <span class="gen-stone-attempt-badge" data-status="pending">驗證中</span>
        <span class="gen-stone-attempt-title">逐顆補子回放</span>
      </div>
      <div class="gen-stone-attempt-reason"></div>
    `;
    if (anchor.nextSibling) parent.insertBefore(element, anchor.nextSibling);
    else parent.appendChild(element);

    panel = {
      element,
      first: element.querySelector('[data-action="first"]'),
      prev: element.querySelector('[data-action="prev"]'),
      next: element.querySelector('[data-action="next"]'),
      last: element.querySelector('[data-action="last"]'),
      count: element.querySelector(".gen-stone-attempt-count"),
      badge: element.querySelector(".gen-stone-attempt-badge"),
      title: element.querySelector(".gen-stone-attempt-title"),
      reason: element.querySelector(".gen-stone-attempt-reason"),
    };
    panel.first.addEventListener("click", () => showAttempt(0));
    panel.prev.addEventListener("click", () => showAttempt(attemptIndex - 1));
    panel.next.addEventListener("click", () => showAttempt(attemptIndex + 1));
    panel.last.addEventListener("click", () => showAttempt(attempts.length - 1));
    return panel;
  }

  function showAttempt(index) {
    const ui = ensurePanel();
    if (!ui || running || !attempts.length) return;
    attemptIndex = Math.max(0, Math.min(attempts.length - 1, index));
    const attempt = attempts[attemptIndex];
    const first = attemptIndex === 0;
    const last = attemptIndex === attempts.length - 1;
    ui.element.hidden = false;
    ui.count.textContent = `${attemptIndex + 1} / ${attempts.length}`;
    ui.first.disabled = first;
    ui.prev.disabled = first;
    ui.next.disabled = last;
    ui.last.disabled = last;
    ui.badge.dataset.status = attempt.status;
    ui.badge.textContent = attempt.status === "passed"
      ? "通過"
      : attempt.status === "failed"
        ? "未通過"
        : "驗證中";
    ui.title.textContent = attempt.title;
    ui.reason.textContent = [attempt.reason, attempt.detail]
      .filter(Boolean)
      .join("；");
    if (typeof window._setBoardArr === "function") {
      window._setBoardArr(expandedBoard(attempt.board), attempt.attacker);
    }
    clearNLayer();
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

  genSetBusy = function setBusyWithStoneAttemptReplay(value) {
    if (value) {
      session++;
      running = true;
      attempts = [];
      attemptIndex = -1;
      knownBoards = [];
      pointAttempts = new Map();
      exactAttempts = new Map();
      lastResultBoard = null;
      const ui = ensurePanel();
      if (ui) ui.element.hidden = true;
    }

    const result = originalSetBusy(value);
    if (!value) {
      const stopped = genCancelled || currentStatus().includes("停止");
      finalizeAttempts(lastResultBoard, stopped);
      running = false;
      const ui = ensurePanel();
      if (ui && attempts.length) {
        attemptIndex = attempts.length - 1;
        showAttempt(attemptIndex);
      } else if (ui) {
        ui.element.hidden = true;
      }
    }
    return result;
  };

  genShowResult = function showResultWithStoneAttemptReplay(
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

  ensurePanel();
})();
