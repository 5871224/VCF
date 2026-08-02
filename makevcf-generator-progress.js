"use strict";

// 題目產生器回放只訂閱正式事件，不再包裝搜尋、驗證、結果或忙碌函式。
(function installGeneratorEventReplay(global) {
  if (global.__generatorEventReplayInstalled) return;
  global.__generatorEventReplayInstalled = true;

  const BOARD_CELLS = 225;
  const BOTH_N = GEN_NO_BLACK | GEN_NO_WHITE;

  let running = false;
  let generationContext = null;
  let replaySteps = [];
  let replayIndex = -1;
  let replayUI = null;
  let validationContexts = new Map();
  let stoneSteps = new Map();
  let searchRecords = new Map();
  let boardSteps = new Map();

  function compactBoard(source) {
    const board = new Uint8Array(BOARD_CELLS);
    for (let idx = 0; idx < BOARD_CELLS; idx++) {
      board[idx] = source?.[idx] === GEN_BLACK
        ? GEN_BLACK
        : source?.[idx] === GEN_WHITE
          ? GEN_WHITE
          : GEN_EMPTY;
    }
    return board;
  }

  function expandedBoard(source) {
    const board = Array.from(source || []).slice(0, BOARD_CELLS);
    while (board.length < BOARD_CELLS) board.push(GEN_EMPTY);
    board.length = BOARD_CELLS + 1;
    board[BOARD_CELLS] = -1;
    return board;
  }

  function cloneNMask(source) {
    const copy = new Uint8Array(BOARD_CELLS);
    const values = source instanceof Uint8Array
      ? source
      : Uint8Array.from(source || []);
    copy.set(values.subarray(0, BOARD_CELLS));
    return copy;
  }

  function boardSignature(source) {
    let signature = "";
    for (let idx = 0; idx < BOARD_CELLS; idx++) {
      signature += source?.[idx] === GEN_BLACK
        ? "1"
        : source?.[idx] === GEN_WHITE
          ? "2"
          : "0";
    }
    return signature;
  }

  function boardsEqual(left, right) {
    if (!left || !right) return false;
    for (let idx = 0; idx < BOARD_CELLS; idx++) {
      if (left[idx] !== right[idx]) return false;
    }
    return true;
  }

  function boardIsSubset(subset, superset) {
    if (!subset || !superset) return false;
    for (let idx = 0; idx < BOARD_CELLS; idx++) {
      if (subset[idx] !== GEN_EMPTY && subset[idx] !== superset[idx]) return false;
    }
    return true;
  }

  function pointName(idx) {
    if (typeof genName === "function") return genName(idx);
    if (!Number.isInteger(idx) || idx < 0 || idx >= BOARD_CELLS) return "盤外";
    return "ABCDEFGHJKLMNOP"[idx % 15] + (15 - Math.floor(idx / 15));
  }

  function sideName(color) {
    return color === GEN_BLACK ? "黑方" : color === GEN_WHITE ? "白方" : "未知方";
  }

  function colorName(color) {
    return color === GEN_BLACK ? "黑子" : color === GEN_WHITE ? "白子" : "棋子";
  }

  function statusLabel(status) {
    if (status === "passed") return "通過";
    if (status === "failed") return "未通過";
    if (status === "pending") return "驗證中";
    return "紀錄";
  }

  function phaseLabel(phase) {
    if (phase === "final") return "最終補守";
    if (phase === "balance") return "補齊子數";
    return "補守";
  }

  function ensureReplayStyle() {
    if (document.querySelector?.('style[data-generator-event-replay-style="true"]')) return;
    const style = document.createElement("style");
    style.dataset.generatorEventReplayStyle = "true";
    style.textContent = `
      .gen-replay-panel {
        width: min(100%, 760px);
        margin: 8px auto 0;
        padding: 10px 12px;
        border: 1px solid #c9c9c9;
        border-radius: 8px;
        background: #fff;
        box-shadow: 0 1px 5px rgba(0, 0, 0, 0.08);
        font-size: 13px;
      }
      .gen-replay-panel[hidden] { display: none !important; }
      .gen-replay-toolbar {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        flex-wrap: wrap;
      }
      .gen-replay-toolbar button { min-width: 68px; }
      .gen-replay-count { min-width: 110px; text-align: center; font-weight: 700; }
      .gen-replay-summary {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        margin-top: 8px;
        text-align: center;
        flex-wrap: wrap;
      }
      .gen-replay-badge {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-width: 52px;
        padding: 2px 8px;
        border-radius: 999px;
        font-weight: 700;
      }
      .gen-replay-badge[data-status="passed"] { color: #126b2c; background: #dff4e5; }
      .gen-replay-badge[data-status="failed"] { color: #9a2f24; background: #fbe2df; }
      .gen-replay-badge[data-status="pending"] { color: #6b5a19; background: #fff2bf; }
      .gen-replay-badge[data-status="info"] { color: #285a8e; background: #e2effc; }
      .gen-replay-title { font-weight: 700; }
      .gen-replay-reason {
        margin-top: 6px;
        line-height: 1.55;
        text-align: center;
        color: #444;
        overflow-wrap: anywhere;
      }
      @media (max-width: 560px) {
        .gen-replay-panel { padding: 9px; }
        .gen-replay-toolbar button {
          min-width: 62px;
          padding-left: 9px;
          padding-right: 9px;
        }
        .gen-replay-count { min-width: 92px; }
      }
    `;
    document.head.appendChild(style);
  }

  function bindReplayPanel(panel) {
    if (!panel) return null;
    const ui = {
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
    if (!ui.first || !ui.prev || !ui.next || !ui.last) return null;
    if (panel.dataset.generatorEventReplayControls !== "1") {
      panel.dataset.generatorEventReplayControls = "1";
      ui.first.addEventListener("click", () => showReplayStep(0));
      ui.prev.addEventListener("click", () => showReplayStep(replayIndex - 1));
      ui.next.addEventListener("click", () => showReplayStep(replayIndex + 1));
      ui.last.addEventListener("click", () => showReplayStep(replaySteps.length - 1));
    }
    return ui;
  }

  function ensureReplayUI() {
    if (replayUI) return replayUI;
    ensureReplayStyle();

    let panel = document.getElementById("gen-replay-combined-panel");
    if (!panel) {
      const status = genEl("status");
      if (!status?.parentNode) return null;
      panel = document.createElement("section");
      panel.id = "gen-replay-combined-panel";
      panel.className = "gen-replay-panel";
      panel.hidden = true;
      panel.innerHTML = `
        <div class="gen-replay-toolbar">
          <button id="gen-replay-combined-first" type="button">最前</button>
          <button id="gen-replay-combined-prev" type="button">上一步</button>
          <span id="gen-replay-combined-count" class="gen-replay-count">0 / 0</span>
          <button id="gen-replay-combined-next" type="button">下一步</button>
          <button id="gen-replay-combined-last" type="button">最後</button>
        </div>
        <div class="gen-replay-summary">
          <span id="gen-replay-combined-badge" class="gen-replay-badge" data-status="info">紀錄</span>
          <span id="gen-replay-combined-title" class="gen-replay-title"></span>
        </div>
        <div id="gen-replay-combined-reason" class="gen-replay-reason"></div>
      `;
      if (status.nextSibling) status.parentNode.insertBefore(panel, status.nextSibling);
      else status.parentNode.appendChild(panel);
    }
    replayUI = bindReplayPanel(panel);
    return replayUI;
  }

  function clearNPoints() {
    const layer = document.getElementById("generator-n-layer");
    if (!layer) return;
    while (layer.firstChild) layer.firstChild.remove();
  }

  function renderNPoints(source) {
    const layer = document.getElementById("generator-n-layer");
    if (!layer) return;
    clearNPoints();

    const ns = "http://www.w3.org/2000/svg";
    const nMask = cloneNMask(source);
    const size = 13;
    for (let idx = 0; idx < BOARD_CELLS; idx++) {
      const mask = nMask[idx] & BOTH_N;
      if (!mask) continue;
      const both = mask === BOTH_N;
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

  function showReplayStep(index) {
    const ui = ensureReplayUI();
    if (!ui || running || !replaySteps.length) return;
    replayIndex = Math.max(0, Math.min(replaySteps.length - 1, index));
    const step = replaySteps[replayIndex];
    const atFirst = replayIndex === 0;
    const atLast = replayIndex === replaySteps.length - 1;

    ui.panel.hidden = false;
    ui.count.textContent = `${replayIndex + 1} / ${replaySteps.length}`;
    ui.first.disabled = atFirst;
    ui.prev.disabled = atFirst;
    ui.next.disabled = atLast;
    ui.last.disabled = atLast;
    ui.badge.dataset.status = step.status || "info";
    ui.badge.textContent = statusLabel(step.status);
    ui.title.textContent = step.title || "盤面紀錄";
    ui.reason.textContent = [step.reason, step.detail].filter(Boolean).join("；");

    if (typeof global._setBoardArr === "function") {
      global._setBoardArr(expandedBoard(step.board), step.attacker || GEN_BLACK);
    }
    renderNPoints(step.nMask);
  }

  function addReplayStep({
    board,
    nMask,
    attacker,
    kind,
    operationId = null,
    title,
    status = "pending",
    reason = "",
    detail = "",
  }) {
    if (!board) return -1;
    const compact = compactBoard(board);
    replaySteps.push({
      board: compact,
      signature: boardSignature(compact),
      nMask: cloneNMask(nMask),
      attacker: attacker === GEN_WHITE ? GEN_WHITE : GEN_BLACK,
      kind,
      operationId,
      title,
      status,
      reason,
      detail,
    });
    return replaySteps.length - 1;
  }

  function updateReplayStep(index, updates) {
    if (!replaySteps[index]) return;
    Object.assign(replaySteps[index], updates);
  }

  function scopeKey(validationOperationId, stoneOperationId) {
    if (stoneOperationId) return `stone:${stoneOperationId}`;
    if (validationOperationId) return `validation:${validationOperationId}`;
    return `generation:${generationContext?.id || 0}`;
  }

  function searchKey(event) {
    return `${scopeKey(event.validationOperationId, event.stoneOperationId)}:${boardSignature(event.board)}`;
  }

  function nMaskForEvent(event) {
    if (event.stoneOperationId) {
      const stoneIndex = stoneSteps.get(event.stoneOperationId);
      if (stoneIndex != null) return replaySteps[stoneIndex]?.nMask;
    }
    if (event.validationOperationId) {
      return validationContexts.get(event.validationOperationId)?.nMask;
    }
    return null;
  }

  function ensureSearchStep(event) {
    const key = searchKey(event);
    const existing = boardSteps.get(key);
    if (existing != null) return existing;

    if (event.stoneOperationId) {
      const stoneIndex = stoneSteps.get(event.stoneOperationId);
      if (stoneIndex != null && replaySteps[stoneIndex]?.signature === boardSignature(event.board)) {
        boardSteps.set(key, stoneIndex);
        return stoneIndex;
      }
    }

    const context = validationContexts.get(event.validationOperationId);
    const stepIndex = addReplayStep({
      board: event.board,
      nMask: nMaskForEvent(event),
      attacker: event.attacker || context?.attacker || generationContext?.attacker,
      kind: "search",
      operationId: event.operation?.id || null,
      title: context ? "驗證目前盤面" : "最終盤面重新驗證",
      status: "pending",
      reason: "等待 VCF 搜尋結果",
    });
    boardSteps.set(key, stepIndex);
    if (context && !context.stepIndexes.includes(stepIndex)) context.stepIndexes.push(stepIndex);
    return stepIndex;
  }

  function searchSummary(result, maxVCF) {
    const foundCount = (result?.winMoves || []).filter(moves => moves?.length).length;
    const parts = [`找到 ${foundCount} 組 VCF`];
    if (Number.isFinite(Number(result?.nodeCount))) {
      parts.push(`節點 ${Number(result.nodeCount).toLocaleString()}`);
    }
    if (result?.aborted || foundCount >= maxVCF) parts.push("搜尋未完整");
    return parts.join("；");
  }

  function buildExpectedBoard(context, board) {
    if (!context?.candidate) return null;
    const state = {
      ...context.candidate,
      board: genCloneBoard(board),
      addedAttackers: Array.from(context.candidate.addedAttackers || []),
      addedDefenders: Array.from(context.candidate.addedDefenders || []),
      autoBlockDefenders: Array.from(context.candidate.autoBlockDefenders || []),
    };
    try {
      return context.previousResult
        ? genBuildExpectedExtendedBoard(context.previousResult, state)
        : genBuildExpectedBaseBoard(state);
    } catch (_) {
      return null;
    }
  }

  function diagnoseGroups(context, board, groups, searchResult) {
    if (!groups?.length) {
      return {
        failed: true,
        reason: searchResult?.aborted
          ? "搜尋達限制，未取得可完成驗證的 VCF"
          : "沒有找到可驗證的 VCF",
      };
    }
    if (!context) {
      return {
        failed: false,
        reason: `精簡後保留 ${groups.length} 組 VCF`,
      };
    }

    const analyzed = [];
    for (const moves of groups) {
      try {
        const analysis = genAnalyzeVCFGroup(board, moves, context.attacker);
        if (analysis?.valid) analyzed.push(analysis);
      } catch (_) {
        // 單一路線無法重播時，由其他路線繼續判定。
      }
    }
    if (!analyzed.length) {
      return { failed: true, reason: "搜尋到的路線都無法重播為合法 VCF" };
    }

    const shortest = Math.min(...analyzed.map(item => item.steps));
    if (shortest < context.expectedSteps) {
      return { failed: true, reason: `仍存在 ${shortest} 步較短 VCF，需要再補守` };
    }
    if (shortest > context.expectedSteps) {
      return {
        failed: true,
        reason: `最短 VCF 為 ${shortest} 步，不是目標 ${context.expectedSteps} 步`,
      };
    }

    const exact = analyzed.filter(item => item.steps === context.expectedSteps);
    const expectedBoard = buildExpectedBoard(context, board);
    if (expectedBoard) {
      const targets = exact.filter(item => genBoardsEqual(item.standardBoard, expectedBoard));
      if (!targets.length) {
        return { failed: true, reason: "步數正確，但標準完成盤面不符合本層預期" };
      }
      if (generationContext?.options?.blockOtherVCF) {
        const unwanted = analyzed.filter(item => !genBoardsEqual(item.standardBoard, expectedBoard));
        if (unwanted.length) {
          return {
            failed: false,
            reason: `已找到目標 VCF，但仍有 ${unwanted.length} 組其他完成盤面，繼續補守`,
          };
        }
      }
    }

    if (searchResult?.aborted) {
      return {
        failed: false,
        reason: "已找到符合目標的 VCF，但搜尋達限制，等待整體流程判定",
      };
    }
    return {
      failed: false,
      reason: "已找到符合目標步數與完成盤面的 VCF，等待本層確認",
    };
  }

  function beginGeneration(event) {
    generationContext = event.context || null;
    running = true;
    replaySteps = [];
    replayIndex = -1;
    validationContexts = new Map();
    stoneSteps = new Map();
    searchRecords = new Map();
    boardSteps = new Map();
    const ui = ensureReplayUI();
    if (ui) ui.panel.hidden = true;
    clearNPoints();
  }

  function recordMaterial(event) {
    if (!running || !event.board) return;
    addReplayStep({
      board: event.board,
      nMask: event.nMask,
      attacker: event.attacker || generationContext?.attacker,
      kind: "material",
      title: event.title || "建立初始盤面",
      status: "info",
      reason: event.reason || "初始材料已建立",
      detail: event.detail || "",
    });
  }

  function beginValidation(event) {
    if (!running || !event.operation || !event.candidate?.board) return;
    const candidate = event.candidate;
    const expectedSteps = Number(event.expectedSteps) || 1;
    const latestLayer = candidate.layers?.[candidate.layers.length - 1];
    const layerNumber = candidate.layers?.length || expectedSteps;
    const detail = [];
    if (latestLayer?.anchor != null) detail.push(`A=${pointName(latestLayer.anchor)}`);
    if (latestLayer?.fivePoint != null) detail.push(`五點=${pointName(latestLayer.fivePoint)}`);
    if (latestLayer?.templateId != null) detail.push(`模板 ${latestLayer.templateId}`);
    if (candidate.forbiddenLabel) detail.push(candidate.forbiddenLabel);

    const title = event.phase === "forbidden-base"
      ? `建立白方抓禁手死四，驗證 ${expectedSteps} 步 VCF`
      : event.previousResult
        ? `新增第 ${layerNumber} 層死四，驗證 ${expectedSteps} 步 VCF`
        : `建立第 ${layerNumber} 層死四基礎，驗證 ${expectedSteps} 步 VCF`;
    const candidateStep = addReplayStep({
      board: candidate.board,
      nMask: candidate.nMask,
      attacker: candidate.attacker,
      kind: "dead-four",
      operationId: event.operation.id,
      title,
      status: "pending",
      reason: "等待驗證",
      detail: detail.join("；"),
    });
    validationContexts.set(event.operation.id, {
      candidate,
      expectedSteps,
      previousResult: event.previousResult || null,
      attacker: candidate.attacker,
      nMask: cloneNMask(candidate.nMask),
      candidateStep,
      stepIndexes: [candidateStep],
    });
  }

  function beginStone(event) {
    if (!running || !event.operation || !event.board) return;
    const attacker = event.attacker === GEN_WHITE ? GEN_WHITE : GEN_BLACK;
    const color = event.color === GEN_BLACK || event.color === GEN_WHITE
      ? event.color
      : event.defender;
    const idx = Number(event.idx);
    if (
      (color !== GEN_BLACK && color !== GEN_WHITE) ||
      !Number.isInteger(idx) ||
      idx < 0 ||
      idx >= BOARD_CELLS
    ) return;

    const expectedDefender = genOther(attacker);
    const role = color === attacker ? "攻方" : color === expectedDefender ? "守方" : "未知方";
    const stepIndex = addReplayStep({
      board: event.board,
      nMask: event.nMask,
      attacker,
      kind: "stone",
      operationId: event.operation.id,
      title: `${phaseLabel(event.phase)}：補上${colorName(color)} ${pointName(idx)}`,
      status: "pending",
      reason: "已放下這一顆棋，正在重新驗證",
      detail: `本次補入${role}；攻方 ${sideName(attacker)}；守方 ${sideName(expectedDefender)}`,
    });
    stoneSteps.set(event.operation.id, stepIndex);
    const context = validationContexts.get(event.validationOperationId);
    if (context && !context.stepIndexes.includes(stepIndex)) context.stepIndexes.push(stepIndex);
  }

  function finishStone(event) {
    const stepIndex = stoneSteps.get(event.operation?.id);
    if (stepIndex == null) return;
    updateReplayStep(stepIndex, {
      status: event.passed ? "passed" : "failed",
      reason: event.reason || (event.passed
        ? "此補子分支驗證通過，保留在採用路徑"
        : "此補子分支驗證失敗，已撤銷並回溯"),
    });
  }

  function finishSearch(event) {
    if (!running || !event.board) return;
    const stepIndex = ensureSearchStep(event);
    const result = event.result;
    const foundCount = (result?.winMoves || []).filter(moves => moves?.length).length;
    const detail = event.error
      ? String(event.error?.message || event.error)
      : searchSummary(result, event.maxVCF || 64);
    if (event.error) {
      updateReplayStep(stepIndex, {
        status: "failed",
        reason: "VCF 搜尋發生錯誤",
        detail,
      });
      return;
    }
    if (!foundCount) {
      updateReplayStep(stepIndex, {
        status: "failed",
        reason: result?.aborted ? "搜尋達限制且未找到 VCF" : "未找到 VCF",
        detail,
      });
    } else {
      updateReplayStep(stepIndex, {
        reason: "已取得搜尋結果，正在重播與比對完成盤面",
        detail,
      });
    }
    searchRecords.set(searchKey(event), {
      event,
      stepIndex,
      result,
    });
  }

  function finishTrim(event) {
    if (!running || !event.board) return;
    const key = searchKey(event);
    const record = searchRecords.get(key);
    if (!record) return;
    const context = validationContexts.get(event.validationOperationId);
    const diagnosis = diagnoseGroups(context, event.board, event.result, record.result);
    const updates = {
      reason: diagnosis.reason,
      detail: [
        searchSummary(record.result, record.event.maxVCF || 64),
        `精簡後 ${event.result?.length || 0} 組`,
      ].join("；"),
    };
    if (diagnosis.failed) updates.status = "failed";
    updateReplayStep(record.stepIndex, updates);
  }

  function finishValidation(event) {
    const context = validationContexts.get(event.operation?.id);
    if (!context) return;
    const candidateStep = replaySteps[context.candidateStep];

    if (!event.passed || !event.result?.board) {
      let reason = event.error?.message || "此死四候選未通過驗證";
      for (const index of context.stepIndexes) {
        const step = replaySteps[index];
        if (!step) continue;
        if (step.status === "pending") {
          step.status = "failed";
          step.reason = "此分支未能保留目標 VCF";
        }
        if (step.reason && step.reason !== "等待驗證") reason = step.reason;
      }
      if (candidateStep) {
        candidateStep.status = "failed";
        candidateStep.reason = reason;
      }
      validationContexts.delete(event.operation.id);
      return;
    }

    const resultBoard = compactBoard(event.result.board);
    const candidateBoard = compactBoard(context.candidate.board);
    let usedSupplement = false;
    for (const index of context.stepIndexes) {
      const step = replaySteps[index];
      if (!step) continue;
      if (boardIsSubset(step.board, resultBoard)) {
        if (!boardsEqual(step.board, candidateBoard)) usedSupplement = true;
        if (step.status === "pending") {
          step.status = "passed";
          step.reason = "此盤面位於最後採用的補子路徑，驗證通過";
        }
      } else if (step.status === "pending") {
        step.status = "failed";
        step.reason = "此分支未被採用";
      }
    }
    if (candidateStep) {
      candidateStep.status = "passed";
      candidateStep.reason = usedSupplement
        ? `第 ${context.expectedSteps} 步死四加入補守後通過驗證`
        : `第 ${context.expectedSteps} 步死四通過驗證`;
    }

    const finalKey = `${scopeKey(event.operation.id, null)}:${boardSignature(resultBoard)}`;
    if (!boardSteps.has(finalKey)) {
      const stepIndex = addReplayStep({
        board: event.result.board,
        nMask: event.result.nMask || context.nMask,
        attacker: event.result.attacker || context.attacker,
        kind: "validation-result",
        operationId: event.operation.id,
        title: `第 ${context.expectedSteps} 步死四驗證完成`,
        status: "passed",
        reason: "目標步數與標準完成盤面均符合預期",
      });
      boardSteps.set(finalKey, stepIndex);
    }
    validationContexts.delete(event.operation.id);
  }

  function recordResult(event) {
    if (!event.result?.board) return;
    const finalBoard = compactBoard(event.result.board);
    for (const step of replaySteps) {
      if (step.status !== "pending") continue;
      if (boardIsSubset(step.board, finalBoard)) {
        step.status = "passed";
        step.reason = "此盤面位於最後採用的產生路徑";
      } else {
        step.status = "failed";
        step.reason = "此分支未被採用";
      }
    }
    addReplayStep({
      board: event.result.board,
      nMask: event.result.nMask,
      attacker: event.attacker,
      kind: "final",
      title: `最終題目：${event.targetSteps} 步 VCF`,
      status: "passed",
      reason: `產生成功，共驗證 ${event.counters?.attempts || 0} 個死四候選`,
      detail: `最後驗證取得 ${event.result.groupCount || 0} 組 VCF`,
    });
  }

  function finishGeneration(event) {
    const stopped = Boolean(event.stopped || event.outcome === "stopped");
    for (const step of replaySteps) {
      if (step.status !== "pending") continue;
      step.status = "failed";
      step.reason = stopped
        ? "產生已停止，這一步未完成驗證"
        : "這個分支未成為最後結果";
    }
    running = false;
    replayIndex = replaySteps.length - 1;
    const ui = ensureReplayUI();
    if (!ui || !replaySteps.length) {
      if (ui) ui.panel.hidden = true;
      return;
    }
    showReplayStep(replayIndex);
  }

  genOnGeneratorEvent("generation:start", "event-replay", beginGeneration);
  genOnGeneratorEvent("material:selected", "event-replay", recordMaterial);
  genOnGeneratorEvent("validation:start", "event-replay", beginValidation);
  genOnGeneratorEvent("stone:start", "event-replay", beginStone);
  genOnGeneratorEvent("stone:end", "event-replay", finishStone);
  genOnGeneratorEvent("search:end", "event-replay", finishSearch);
  genOnGeneratorEvent("search:trimmed", "event-replay", finishTrim);
  genOnGeneratorEvent("validation:end", "event-replay", finishValidation);
  genOnGeneratorEvent("generation:result", "event-replay", recordResult);
  genOnGeneratorEvent("generation:end", "event-replay", finishGeneration);

  ensureReplayUI();
})(window);
