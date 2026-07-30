"use strict";

// Record generator validation boards and replay them after generation finishes.
(function scheduleGeneratorValidationReplay() {
  function installGeneratorValidationReplay() {
    if (window.__generatorValidationReplayInstalled) return;
    if (!window.__generatorTargetBoardUniquePolicyV3Installed) {
      window.setTimeout(installGeneratorValidationReplay, 0);
      return;
    }
    window.__generatorValidationReplayInstalled = true;

    const originalSetBusy = genSetBusy;
    const originalValidateCandidate = genValidateCandidate;
    const originalValidateExtensionCandidate = genValidateExtensionCandidate;
    const originalFindVCF = genEngine.findVCF.bind(genEngine);
    const originalTrimGroups = genEngine.trimGroups.bind(genEngine);
    const originalShowResult = genShowResult;

    let replaySteps = [];
    let replayIndex = -1;
    let replayRunning = false;
    let replaySession = 0;
    let replayScope = 0;
    let currentContext = null;
    let finalScopeId = 0;
    let lastSearchByBoard = new Map();
    let replayElements = null;

    function compactBoard(board) {
      const compact = new Uint8Array(225);
      for (let idx = 0; idx < 225; idx++) {
        compact[idx] = board?.[idx] === GEN_BLACK
          ? GEN_BLACK
          : board?.[idx] === GEN_WHITE
            ? GEN_WHITE
            : GEN_EMPTY;
      }
      return compact;
    }

    function expandedBoard(compact) {
      const board = Array.from(compact || []);
      while (board.length < 225) board.push(GEN_EMPTY);
      board.length = 226;
      board[225] = -1;
      return board;
    }

    function boardSignature(board) {
      let signature = "";
      for (let idx = 0; idx < 225; idx++) {
        signature += board?.[idx] === GEN_BLACK
          ? "1"
          : board?.[idx] === GEN_WHITE
            ? "2"
            : "0";
      }
      return signature;
    }

    function boardsEqualCompact(left, right) {
      if (!left || !right || left.length !== right.length) return false;
      for (let idx = 0; idx < left.length; idx++) {
        if (left[idx] !== right[idx]) return false;
      }
      return true;
    }

    function boardIsSubset(subset, superset) {
      if (!subset || !superset) return false;
      for (let idx = 0; idx < 225; idx++) {
        if (subset[idx] !== GEN_EMPTY && subset[idx] !== superset[idx]) return false;
      }
      return true;
    }

    function colorName(color) {
      return color === GEN_BLACK ? "黑子" : color === GEN_WHITE ? "白子" : "棋子";
    }

    function pointName(idx) {
      if (typeof genName === "function") return genName(idx);
      if (idx < 0 || idx >= 225) return "盤外";
      return "ABCDEFGHJKLMNOP"[idx % 15] + (15 - Math.floor(idx / 15));
    }

    function currentStageText() {
      return genEl("status")?.textContent || "";
    }

    function stageTitleForAddedStone(color, idx) {
      const status = currentStageText();
      if (status.includes("封鎖其他完成盤面") || status.includes("只保留目標")) {
        return `封鎖其他 VCF：補上${colorName(color)} ${pointName(idx)}`;
      }
      if (status.includes("補齊黑白子數") || status.includes("補齊子數")) {
        return `補齊子數：補上${colorName(color)} ${pointName(idx)}`;
      }
      return `補守：補上${colorName(color)} ${pointName(idx)}`;
    }

    function ensureReplayUI() {
      if (replayElements) return replayElements;

      const status = genEl("status");
      if (!status?.parentNode) return null;

      const style = document.createElement("style");
      style.dataset.generatorReplayStyle = "true";
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
        .gen-replay-toolbar button { min-width: 82px; }
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
          .gen-replay-toolbar button { min-width: 74px; padding-left: 10px; padding-right: 10px; }
          .gen-replay-count { min-width: 92px; }
        }
      `;
      document.head.appendChild(style);

      const panel = document.createElement("section");
      panel.className = "gen-replay-panel";
      panel.id = "gen-replay-panel";
      panel.hidden = true;
      panel.innerHTML = `
        <div class="gen-replay-toolbar">
          <button id="gen-replay-prev" type="button">上一步</button>
          <span id="gen-replay-count" class="gen-replay-count">0 / 0</span>
          <button id="gen-replay-next" type="button">下一步</button>
        </div>
        <div class="gen-replay-summary">
          <span id="gen-replay-badge" class="gen-replay-badge" data-status="info">紀錄</span>
          <span id="gen-replay-title" class="gen-replay-title"></span>
        </div>
        <div id="gen-replay-reason" class="gen-replay-reason"></div>
      `;
      status.parentNode.insertBefore(panel, status.nextSibling);

      replayElements = {
        panel,
        prev: panel.querySelector("#gen-replay-prev"),
        next: panel.querySelector("#gen-replay-next"),
        count: panel.querySelector("#gen-replay-count"),
        badge: panel.querySelector("#gen-replay-badge"),
        title: panel.querySelector("#gen-replay-title"),
        reason: panel.querySelector("#gen-replay-reason"),
      };
      replayElements.prev.addEventListener("click", () => showReplayStep(replayIndex - 1));
      replayElements.next.addEventListener("click", () => showReplayStep(replayIndex + 1));
      return replayElements;
    }

    function statusLabel(status) {
      if (status === "passed") return "通過";
      if (status === "failed") return "未通過";
      if (status === "pending") return "驗證中";
      return "紀錄";
    }

    function showReplayStep(index) {
      const elements = ensureReplayUI();
      if (!elements || !replaySteps.length || replayRunning) return;

      replayIndex = Math.max(0, Math.min(replaySteps.length - 1, index));
      const step = replaySteps[replayIndex];
      elements.panel.hidden = false;
      elements.count.textContent = `${replayIndex + 1} / ${replaySteps.length}`;
      elements.prev.disabled = replayIndex <= 0;
      elements.next.disabled = replayIndex >= replaySteps.length - 1;
      elements.badge.dataset.status = step.status;
      elements.badge.textContent = statusLabel(step.status);
      elements.title.textContent = step.title;
      elements.reason.textContent = [step.reason, step.detail].filter(Boolean).join("；");

      if (typeof window._setBoardArr === "function") {
        window._setBoardArr(expandedBoard(step.board), step.attacker);
      }
    }

    function refreshReplayCounter() {
      const elements = ensureReplayUI();
      if (!elements || replayRunning) return;
      if (!replaySteps.length) {
        elements.panel.hidden = true;
        return;
      }
      elements.panel.hidden = false;
      showReplayStep(replayIndex >= 0 ? replayIndex : replaySteps.length - 1);
    }

    function addReplayStep({
      board,
      attacker,
      scopeId,
      kind,
      title,
      status = "pending",
      reason = "",
      detail = "",
      forceNew = false,
    }) {
      if (!board) return -1;
      const signature = boardSignature(board);
      if (!forceNew) {
        for (let index = replaySteps.length - 1; index >= 0; index--) {
          const step = replaySteps[index];
          if (step.session !== replaySession) break;
          if (step.scopeId === scopeId && step.signature === signature && step.kind === kind) {
            if (title) step.title = title;
            if (status) step.status = status;
            if (reason) step.reason = reason;
            if (detail) step.detail = detail;
            return index;
          }
        }
      }

      replaySteps.push({
        session: replaySession,
        scopeId,
        kind,
        signature,
        board: compactBoard(board),
        attacker,
        title,
        status,
        reason,
        detail,
      });
      return replaySteps.length - 1;
    }

    function updateReplayStep(index, updates) {
      const step = replaySteps[index];
      if (!step) return;
      Object.assign(step, updates);
    }

    function findStepByBoard(scopeId, signature) {
      for (let index = replaySteps.length - 1; index >= 0; index--) {
        const step = replaySteps[index];
        if (step.session !== replaySession) break;
        if (step.scopeId === scopeId && step.signature === signature) return index;
      }
      return -1;
    }

    function findParentAddition(scopeId, board) {
      const child = compactBoard(board);
      let best = null;
      for (let index = replaySteps.length - 1; index >= 0; index--) {
        const step = replaySteps[index];
        if (step.session !== replaySession) break;
        if (step.scopeId !== scopeId || !boardIsSubset(step.board, child)) continue;

        const additions = [];
        for (let idx = 0; idx < 225; idx++) {
          if (step.board[idx] === GEN_EMPTY && child[idx] !== GEN_EMPTY) additions.push(idx);
        }
        if (!additions.length) continue;
        if (!best || additions.length < best.additions.length) {
          best = { index, additions };
          if (additions.length === 1) break;
        }
      }
      return best;
    }

    function searchScope() {
      if (currentContext) return currentContext.scopeId;
      return finalScopeId || ++replayScope;
    }

    function ensureSearchBoardStep(board, attacker) {
      const scopeId = searchScope();
      const signature = boardSignature(board);
      const existing = findStepByBoard(scopeId, signature);
      if (existing >= 0) return existing;

      const parent = findParentAddition(scopeId, board);
      let title = "驗證目前盤面";
      let detail = "";
      if (parent?.additions?.length === 1) {
        const idx = parent.additions[0];
        title = stageTitleForAddedStone(board[idx], idx);
      } else if (parent?.additions?.length > 1) {
        title = `補上 ${parent.additions.length} 顆棋子後驗證`;
        detail = parent.additions
          .map(idx => `${colorName(board[idx])} ${pointName(idx)}`)
          .join("、");
      } else if (!currentContext) {
        const status = currentStageText();
        title = status.includes("封鎖其他完成盤面")
          ? "封鎖其他 VCF 後重新驗證"
          : status.includes("補齊")
            ? "補齊子數後重新驗證"
            : "最終盤面重新驗證";
      }

      return addReplayStep({
        board,
        attacker,
        scopeId,
        kind: "board",
        title,
        status: "pending",
        reason: "等待 VCF 驗證結果",
        detail,
      });
    }

    function searchSummary(info, maxVCF) {
      const foundCount = (info?.winMoves || []).filter(moves => moves?.length).length;
      const parts = [`找到 ${foundCount} 組 VCF`];
      if (Number.isFinite(Number(info?.nodeCount))) parts.push(`節點 ${Number(info.nodeCount).toLocaleString()}`);
      if (info?.aborted || foundCount >= maxVCF) parts.push("搜尋未完整");
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

    function diagnoseGroups(context, board, groups, info) {
      if (!context || !groups?.length) {
        return {
          failed: true,
          reason: info?.aborted ? "搜尋達限制，未取得可完成驗證的 VCF" : "沒有找到可驗證的 VCF",
        };
      }

      const analyzed = [];
      for (const moves of groups) {
        try {
          const analysis = genAnalyzeVCFGroup(board, moves, context.attacker);
          if (analysis?.valid) analyzed.push(analysis);
        } catch (_) {
          // Ignore an individual route that cannot be replayed.
        }
      }
      if (!analyzed.length) {
        return { failed: true, reason: "搜尋到的路線都無法重播為合法 VCF" };
      }

      const expectedSteps = context.expectedSteps;
      const shortest = Math.min(...analyzed.map(item => item.steps));
      if (shortest < expectedSteps) {
        return { failed: true, reason: `仍存在 ${shortest} 步較短 VCF，需要再補守` };
      }
      if (shortest > expectedSteps) {
        return { failed: true, reason: `最短 VCF 為 ${shortest} 步，不是目標 ${expectedSteps} 步` };
      }

      const exact = analyzed.filter(item => item.steps === expectedSteps);
      const expectedBoard = buildExpectedBoard(context, board);
      if (expectedBoard) {
        const targets = exact.filter(item => genBoardsEqual(item.standardBoard, expectedBoard));
        if (!targets.length) {
          return { failed: true, reason: "步數正確，但標準完成盤面不符合本層預期" };
        }
        if (genEl("block-other-vcf")?.checked) {
          const unwanted = analyzed.filter(item => !genBoardsEqual(item.standardBoard, expectedBoard));
          if (unwanted.length) {
            return {
              failed: false,
              reason: `已找到目標 VCF，但仍有 ${unwanted.length} 組其他完成盤面，繼續補守`,
            };
          }
        }
      }

      if (info?.aborted) {
        return { failed: false, reason: "已找到符合目標的 VCF，但搜尋達限制，等待整體流程判定" };
      }
      return { failed: false, reason: "已找到符合目標步數與完成盤面的 VCF，等待本層確認" };
    }

    function finalizeContextFailure(context, fallbackReason) {
      let candidateReason = fallbackReason || "此死四候選未通過驗證";
      for (const index of context.stepIndexes) {
        const step = replaySteps[index];
        if (!step) continue;
        if (step.status === "pending") {
          step.status = "failed";
          step.reason = step.reason && step.reason !== "等待 VCF 驗證結果"
            ? step.reason
            : "此補子分支未能保留目標 VCF";
        }
        if (step.reason) candidateReason = step.reason;
      }
      updateReplayStep(context.candidateStep, {
        status: "failed",
        reason: candidateReason,
      });
    }

    function finalizeContextSuccess(context, result) {
      const resultCompact = compactBoard(result.board);
      let usedSupplement = false;

      for (const index of context.stepIndexes) {
        const step = replaySteps[index];
        if (!step) continue;
        if (boardIsSubset(step.board, resultCompact)) {
          if (!boardsEqualCompact(step.board, compactBoard(context.candidate.board))) usedSupplement = true;
          if (step.status === "pending") {
            step.status = "passed";
            step.reason = "此盤面位於最後採用的補子路徑，驗證通過";
          }
        } else if (step.status === "pending") {
          step.status = "failed";
          step.reason = "此補子分支未被採用";
        }
      }

      updateReplayStep(context.candidateStep, {
        status: "passed",
        reason: usedSupplement
          ? `第 ${context.expectedSteps} 步死四加入補守後通過驗證`
          : `第 ${context.expectedSteps} 步死四通過驗證`,
      });

      const resultSignature = boardSignature(result.board);
      let resultStep = findStepByBoard(context.scopeId, resultSignature);
      if (resultStep < 0) {
        resultStep = addReplayStep({
          board: result.board,
          attacker: result.attacker || context.attacker,
          scopeId: context.scopeId,
          kind: "board",
          title: `第 ${context.expectedSteps} 步死四驗證完成`,
          status: "passed",
          reason: "目標步數與標準完成盤面均符合預期",
        });
      } else {
        updateReplayStep(resultStep, {
          status: "passed",
          reason: "目標步數與標準完成盤面均符合預期",
        });
      }
    }

    function beginValidation(candidate, expectedSteps, previousResult) {
      const scopeId = ++replayScope;
      const latestLayer = candidate.layers?.[candidate.layers.length - 1];
      const layerNumber = candidate.layers?.length || expectedSteps;
      const detailParts = [];
      if (latestLayer?.anchor != null) detailParts.push(`A=${pointName(latestLayer.anchor)}`);
      if (latestLayer?.fivePoint != null) detailParts.push(`五點=${pointName(latestLayer.fivePoint)}`);
      if (latestLayer?.templateId != null) detailParts.push(`模板 ${latestLayer.templateId}`);

      const context = {
        scopeId,
        candidate,
        expectedSteps,
        previousResult,
        attacker: candidate.attacker,
        stepIndexes: [],
        candidateStep: -1,
      };
      const title = previousResult
        ? `新增第 ${layerNumber} 層死四，驗證 ${expectedSteps} 步 VCF`
        : `建立第 ${layerNumber} 層死四基礎，驗證 ${expectedSteps} 步 VCF`;
      context.candidateStep = addReplayStep({
        board: candidate.board,
        attacker: candidate.attacker,
        scopeId,
        kind: "dead-four",
        title,
        status: "pending",
        reason: "等待驗證",
        detail: detailParts.join("；"),
        forceNew: true,
      });
      context.stepIndexes.push(context.candidateStep);
      return context;
    }

    genSetBusy = function generatorSetBusyWithReplay(value) {
      originalSetBusy(value);
      const elements = ensureReplayUI();

      if (value) {
        replaySession++;
        replaySteps = [];
        replayIndex = -1;
        replayRunning = true;
        currentContext = null;
        lastSearchByBoard = new Map();
        finalScopeId = ++replayScope;
        if (elements) elements.panel.hidden = true;
        return;
      }

      replayRunning = false;
      const finalStatus = currentStageText();
      const stopped = genCancelled || finalStatus.includes("停止");
      for (const step of replaySteps) {
        if (step.status !== "pending") continue;
        step.status = "failed";
        step.reason = stopped ? "產生已停止，這一步未完成驗證" : "這個分支未成為最後結果";
      }
      replayIndex = Math.max(0, replaySteps.length - 1);
      refreshReplayCounter();
    };

    genValidateCandidate = async function validateCandidateWithReplay(candidate, expectedSteps) {
      const previousContext = currentContext;
      const context = beginValidation(candidate, expectedSteps, null);
      currentContext = context;
      try {
        const result = await originalValidateCandidate(candidate, expectedSteps);
        if (result) finalizeContextSuccess(context, result);
        else finalizeContextFailure(context);
        return result;
      } catch (error) {
        finalizeContextFailure(context, error?.message || "驗證時發生錯誤");
        throw error;
      } finally {
        currentContext = previousContext;
      }
    };

    genValidateExtensionCandidate = async function validateExtensionWithReplay(
      candidate,
      previousResult,
      targetSteps,
    ) {
      const previousContext = currentContext;
      const context = beginValidation(candidate, targetSteps, previousResult);
      currentContext = context;
      try {
        const result = await originalValidateExtensionCandidate(candidate, previousResult, targetSteps);
        if (result) finalizeContextSuccess(context, result);
        else finalizeContextFailure(context);
        return result;
      } catch (error) {
        finalizeContextFailure(context, error?.message || "驗證時發生錯誤");
        throw error;
      } finally {
        currentContext = previousContext;
      }
    };

    genEngine.findVCF = async function findVCFWithReplay(
      board,
      attacker,
      maxVCF = 64,
      options = {},
    ) {
      const stepIndex = ensureSearchBoardStep(board, attacker);
      if (currentContext && !currentContext.stepIndexes.includes(stepIndex)) {
        currentContext.stepIndexes.push(stepIndex);
      }
      const signature = boardSignature(board);
      const searchKey = `${searchScope()}:${signature}`;
      const info = await originalFindVCF(board, attacker, maxVCF, options);
      const detail = searchSummary(info, maxVCF);
      lastSearchByBoard.set(searchKey, {
        board: genCloneBoard(board),
        attacker,
        info,
        maxVCF,
        options,
        stepIndex,
        context: currentContext,
      });

      const foundCount = (info?.winMoves || []).filter(moves => moves?.length).length;
      if (!foundCount) {
        updateReplayStep(stepIndex, {
          status: "failed",
          reason: info?.aborted ? "搜尋達限制且未找到 VCF" : "未找到 VCF",
          detail,
        });
      } else {
        updateReplayStep(stepIndex, {
          detail,
          reason: "已取得搜尋結果，正在重播與比對完成盤面",
        });
      }
      return info;
    };

    genEngine.trimGroups = async function trimGroupsWithReplay(board, groups, attacker) {
      const result = await originalTrimGroups(board, groups, attacker);
      const scopeId = searchScope();
      const signature = boardSignature(board);
      const searchKey = `${scopeId}:${signature}`;
      const search = lastSearchByBoard.get(searchKey);
      if (search) {
        const diagnosis = diagnoseGroups(search.context, board, result, search.info);
        const update = {
          reason: diagnosis.reason,
          detail: [searchSummary(search.info, search.maxVCF), `精簡後 ${result?.length || 0} 組`].join("；"),
        };
        if (diagnosis.failed) update.status = "failed";
        updateReplayStep(search.stepIndex, update);
      }
      return result;
    };

    genShowResult = function showResultWithReplay(result, targetSteps, attacker, counters, options) {
      originalShowResult(result, targetSteps, attacker, counters, options);

      const finalBoard = compactBoard(result.board);
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
        board: result.board,
        attacker,
        scopeId: finalScopeId,
        kind: "final",
        title: `最終題目：${targetSteps} 步 VCF`,
        status: "passed",
        reason: `產生成功，共驗證 ${counters.attempts} 個死四候選`,
        detail: `最後驗證取得 ${result.groupCount || 0} 組 VCF`,
        forceNew: true,
      });
      replayIndex = replaySteps.length - 1;
    };

    ensureReplayUI();
  }

  installGeneratorValidationReplay();
})();
