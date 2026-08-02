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

    function stageTitleForAddedStone(color, idx, attacker) {
      const normalizedAttacker = Number(attacker) === GEN_WHITE
        ? GEN_WHITE
        : GEN_BLACK;
      if (color === normalizedAttacker) {
        return `攻方${colorName(color)} ${pointName(idx)} 加入後驗證`;
      }
      if (color === genOther(normalizedAttacker)) {
        return `守方${colorName(color)} ${pointName(idx)} 加入後驗證`;
      }
      return `棋子 ${pointName(idx)} 加入後驗證`;
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
        title = stageTitleForAddedStone(board[idx], idx, attacker);
      } else if (parent?.additions?.length > 1) {
        title = `盤面增加 ${parent.additions.length} 顆棋子後驗證`;
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

// 完整材料與候選回放；必須接在驗證回放安裝之後。
"use strict";

// Extend the generator replay with the initial material boards and direct first/last navigation.
(function scheduleCompleteGeneratorReplay() {
  function installCompleteGeneratorReplay() {
    if (window.__generatorCompleteReplayInstalled) return;
    if (!window.__generatorValidationReplayInstalled) {
      window.setTimeout(installCompleteGeneratorReplay, 0);
      return;
    }
    window.__generatorCompleteReplayInstalled = true;

    const originalSetBusy = genSetBusy;
    const originalPickInitialPlacement = genPickInitialPlacement;
    const originalBuildLayerCandidates = genBuildLayerCandidates;
    const originalValidateCandidate = genValidateCandidate;
    const originalValidateExtensionCandidate = genValidateExtensionCandidate;
    const originalShowResult = genShowResult;

    let timeline = [];
    let forbiddenKeys = new Set();
    let combinedSteps = [];
    let combinedIndex = -1;
    let combinedElements = null;
    let lastRenderedBoard = null;
    let lastRenderedAttacker = GEN_BLACK;
    let finalNMask = new Uint8Array(225);
    let finalSignature = "";

    function cloneBoard(board) {
      const copy = Array.from(board || []).slice(0, 226);
      while (copy.length < 225) copy.push(GEN_EMPTY);
      copy.length = 226;
      copy[225] = -1;
      return copy;
    }

    function cloneNMask(nMask) {
      const copy = new Uint8Array(225);
      const source = nMask instanceof Uint8Array ? nMask : Uint8Array.from(nMask || []);
      copy.set(source.subarray(0, 225));
      return copy;
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

    function pointName(idx) {
      if (typeof genName === "function") return genName(idx);
      if (idx < 0 || idx >= 225) return "盤外";
      return "ABCDEFGHJKLMNOP"[idx % 15] + (15 - Math.floor(idx / 15));
    }

    function renderNPoints(nMask) {
      const layer = document.getElementById("generator-n-layer");
      if (!layer) return;
      while (layer.firstChild) layer.firstChild.remove();

      const ns = "http://www.w3.org/2000/svg";
      const bothMask = GEN_NO_BLACK | GEN_NO_WHITE;
      const maskArray = cloneNMask(nMask);
      const markSize = 13;

      for (let idx = 0; idx < 225; idx++) {
        const mask = maskArray[idx] & bothMask;
        if (!mask) continue;
        const both = mask === bothMask;
        const cx = 22 + (idx % 15) * 34;
        const cy = 22 + Math.floor(idx / 15) * 34;
        const rect = document.createElementNS(ns, "rect");
        rect.setAttribute("x", cx - markSize / 2);
        rect.setAttribute("y", cy - markSize / 2);
        rect.setAttribute("width", markSize);
        rect.setAttribute("height", markSize);
        rect.setAttribute("rx", 2);
        rect.setAttribute("fill", both ? "#2e9f45" : (mask & GEN_NO_BLACK) ? "#222" : "#f8f8f8");
        rect.setAttribute("stroke", both ? "#176729" : "#d02020");
        rect.setAttribute("stroke-width", 2);
        rect.setAttribute("opacity", .92);
        const title = document.createElementNS(ns, "title");
        title.textContent = both ? "雙方 N 點" : (mask & GEN_NO_BLACK) ? "黑方 N 點" : "白方 N 點";
        rect.appendChild(title);
        layer.appendChild(rect);
      }
    }

    function installBoardCapture() {
      const current = window._setBoardArr;
      if (typeof current !== "function" || current.__completeReplayCapture) return;

      function capturedSetBoardArr(board, attacker) {
        lastRenderedBoard = cloneBoard(board);
        lastRenderedAttacker = attacker || GEN_BLACK;
        return current.apply(this, arguments);
      }
      capturedSetBoardArr.__completeReplayCapture = true;
      window._setBoardArr = capturedSetBoardArr;
    }

    function addInitialEvent(record) {
      if (!record?.board) return;
      timeline.push({
        type: "initial",
        step: {
          board: cloneBoard(record.board),
          nMask: cloneNMask(record.nMask),
          attacker: record.attacker || GEN_BLACK,
          status: "info",
          title: record.title || "建立初始盤面",
          reason: record.reason || "初始盤面已建立，接著產生死四候選並驗證",
          detail: record.detail || "",
          signature: boardSignature(record.board),
        },
      });
    }

    function addCandidateEvent(candidate) {
      if (!candidate?.board) return;
      timeline.push({
        type: "candidate",
        signature: boardSignature(candidate.board),
        nMask: cloneNMask(candidate.nMask),
      });
    }

    function recordForbiddenBase(candidate) {
      if (!candidate?.captureForbidden && candidate?.materialType !== "forbiddenCapture") return;
      const source = candidate.base || candidate.rootBase || candidate;
      const board = cloneBoard(source.board || candidate.board);
      const anchor = Number(candidate.anchor ?? source.anchorCandidates?.[0]);
      if (anchor >= 0 && anchor < 225 && board[anchor] === GEN_WHITE) {
        board[anchor] = GEN_EMPTY;
      }

      const kind = candidate.forbiddenKind || source.forbiddenKind || "forbidden";
      const label = candidate.forbiddenLabel || source.forbiddenLabel || "禁手";
      const forbiddenPoint = Number(candidate.forbiddenPoint ?? source.forbiddenPoint);
      const patternText = candidate.forbiddenPatternText || source.patternText || "";
      const key = `${kind}|${forbiddenPoint}|${patternText}|${boardSignature(board)}`;
      if (forbiddenKeys.has(key)) return;
      forbiddenKeys.add(key);

      addInitialEvent({
        board,
        nMask: source.nMask || candidate.nMask,
        attacker: GEN_WHITE,
        title: `建立禁手骨架（${label}）`,
        reason: "黑棋禁手骨架已建立，接著套入白棋死四",
        detail: [
          Number.isInteger(forbiddenPoint) ? `A=${pointName(forbiddenPoint)}` : "",
          patternText,
        ].filter(Boolean).join("；"),
      });
    }

    genPickInitialPlacement = function pickInitialPlacementWithReplay(placements) {
      const base = originalPickInitialPlacement(placements);
      if (genBusy && base?.board) {
        const label = base.materialType === "deadFour" ? "死四" : "活三";
        addInitialEvent({
          board: base.board,
          nMask: base.nMask,
          attacker: base.attacker || genGetAttacker(),
          title: `建立初始${label}`,
          reason: `已選中${label}材料，接著嘗試加入第一層死四`,
          detail: [base.patternName, base.patternText].filter(Boolean).join("；"),
        });
      }
      return base;
    };

    genBuildLayerCandidates = function buildLayerCandidatesWithForbiddenReplay(...args) {
      const base = args[0];
      if (genBusy && base?.materialType === "forbiddenCapture") {
        recordForbiddenBase(base);
      }
      return originalBuildLayerCandidates(...args);
    };

    genValidateCandidate = async function validateCandidateWithCompleteReplay(candidate, expectedSteps) {
      if (genBusy) {
        recordForbiddenBase(candidate);
        addCandidateEvent(candidate);
      }
      return originalValidateCandidate(candidate, expectedSteps);
    };

    genValidateExtensionCandidate = async function validateExtensionWithCompleteReplay(
      candidate,
      previousResult,
      targetSteps,
    ) {
      if (genBusy) addCandidateEvent(candidate);
      return originalValidateExtensionCandidate(candidate, previousResult, targetSteps);
    };

    genShowResult = function showResultWithCompleteReplayNPoints(
      result,
      targetSteps,
      attacker,
      counters,
      options,
    ) {
      finalNMask = cloneNMask(result?.nMask);
      finalSignature = result?.board ? boardSignature(result.board) : "";
      return originalShowResult(result, targetSteps, attacker, counters, options);
    };

    function ensureCombinedUI() {
      if (combinedElements) return combinedElements;
      const oldPanel = document.getElementById("gen-replay-panel");
      const status = genEl("status");
      const parent = oldPanel?.parentNode || status?.parentNode;
      if (!parent) return null;

      const style = document.createElement("style");
      style.dataset.generatorCompleteReplayStyle = "true";
      style.textContent = `
        #gen-replay-combined-panel .gen-replay-toolbar button {
          min-width: 68px;
        }
        @media (max-width: 560px) {
          #gen-replay-combined-panel .gen-replay-toolbar button {
            min-width: 62px;
            padding-left: 9px;
            padding-right: 9px;
          }
        }
      `;
      document.head.appendChild(style);

      const panel = document.createElement("section");
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
      if (oldPanel?.nextSibling) parent.insertBefore(panel, oldPanel.nextSibling);
      else if (oldPanel) parent.appendChild(panel);
      else if (status?.nextSibling) parent.insertBefore(panel, status.nextSibling);
      else parent.appendChild(panel);

      combinedElements = {
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
      combinedElements.first.addEventListener("click", () => showCombinedStep(0));
      combinedElements.prev.addEventListener("click", () => showCombinedStep(combinedIndex - 1));
      combinedElements.next.addEventListener("click", () => showCombinedStep(combinedIndex + 1));
      combinedElements.last.addEventListener("click", () => showCombinedStep(combinedSteps.length - 1));
      return combinedElements;
    }

    function statusLabel(status) {
      if (status === "passed") return "通過";
      if (status === "failed") return "未通過";
      if (status === "pending") return "驗證中";
      return "紀錄";
    }

    function showCombinedStep(index) {
      const elements = ensureCombinedUI();
      if (!elements || !combinedSteps.length || genBusy) return;
      combinedIndex = Math.max(0, Math.min(combinedSteps.length - 1, index));
      const step = combinedSteps[combinedIndex];
      const atFirst = combinedIndex <= 0;
      const atLast = combinedIndex >= combinedSteps.length - 1;

      elements.panel.hidden = false;
      elements.count.textContent = `${combinedIndex + 1} / ${combinedSteps.length}`;
      elements.first.disabled = atFirst;
      elements.prev.disabled = atFirst;
      elements.next.disabled = atLast;
      elements.last.disabled = atLast;
      elements.badge.dataset.status = step.status || "info";
      elements.badge.textContent = statusLabel(step.status);
      elements.title.textContent = step.title || "盤面紀錄";
      elements.reason.textContent = [step.reason, step.detail].filter(Boolean).join("；");

      installBoardCapture();
      if (typeof window._setBoardArr === "function") {
        window._setBoardArr(cloneBoard(step.board), step.attacker || GEN_BLACK);
      }
      renderNPoints(step.nMask);
    }

    function captureOldStep(oldPanel) {
      let board = lastRenderedBoard;
      if (!board && typeof window._getArr === "function") board = window._getArr();
      if (!board) return null;

      const badge = oldPanel.querySelector("#gen-replay-badge");
      const title = oldPanel.querySelector("#gen-replay-title")?.textContent || "盤面紀錄";
      const reason = oldPanel.querySelector("#gen-replay-reason")?.textContent || "";
      return {
        board: cloneBoard(board),
        attacker: lastRenderedAttacker || genGetAttacker(),
        status: badge?.dataset?.status || "info",
        title,
        reason,
        detail: "",
        signature: boardSignature(board),
      };
    }

    function harvestOldReplay() {
      installBoardCapture();
      const oldPanel = document.getElementById("gen-replay-panel");
      if (!oldPanel) return [];
      const prev = oldPanel.querySelector("#gen-replay-prev");
      const next = oldPanel.querySelector("#gen-replay-next");
      if (!prev || !next) return [];

      let guard = 0;
      while (!prev.disabled && guard++ < 100000) prev.click();

      const records = [];
      guard = 0;
      while (guard++ < 100000) {
        const record = captureOldStep(oldPanel);
        if (record) records.push(record);
        if (next.disabled) break;
        next.click();
      }
      oldPanel.hidden = true;
      return records;
    }

    function candidateStartIndexes(records, candidateEvents) {
      const indexes = [];
      let cursor = 0;
      for (const event of candidateEvents) {
        let found = -1;
        for (let index = cursor; index < records.length; index++) {
          const record = records[index];
          if (
            record.signature === event.signature &&
            record.title.includes("死四") &&
            (record.title.includes("建立") || record.title.includes("新增"))
          ) {
            found = index;
            cursor = index + 1;
            break;
          }
        }
        indexes.push(found);
      }
      return indexes;
    }

    function withNMask(records, nMask) {
      return records.map(record => ({ ...record, nMask: cloneNMask(nMask) }));
    }

    function mergeTimelineWithReplay(records) {
      const candidateEvents = timeline.filter(event => event.type === "candidate");
      const starts = candidateStartIndexes(records, candidateEvents);
      const firstStart = starts.find(index => index >= 0);
      const output = firstStart == null ? [] : records.slice(0, firstStart);
      let candidateNumber = 0;

      for (const event of timeline) {
        if (event.type === "initial") {
          output.push(event.step);
          continue;
        }

        const start = starts[candidateNumber];
        if (start >= 0) {
          let end = records.length;
          for (let next = candidateNumber + 1; next < starts.length; next++) {
            if (starts[next] >= 0) {
              end = starts[next];
              break;
            }
          }
          output.push(...withNMask(records.slice(start, end), event.nMask));
        }
        candidateNumber++;
      }

      if (!candidateEvents.length || starts.every(index => index < 0)) {
        output.push(...records);
      }

      if (finalSignature) {
        for (let index = output.length - 1; index >= 0; index--) {
          if (output[index].signature !== finalSignature) continue;
          output[index] = { ...output[index], nMask: cloneNMask(finalNMask) };
          break;
        }
      }
      return output;
    }

    function rebuildCombinedReplay() {
      if (genBusy) return;
      const records = harvestOldReplay();
      combinedSteps = mergeTimelineWithReplay(records);
      const elements = ensureCombinedUI();
      if (!elements || !combinedSteps.length) {
        if (elements) elements.panel.hidden = true;
        return;
      }
      combinedIndex = combinedSteps.length - 1;
      showCombinedStep(combinedIndex);
    }

    genSetBusy = function generatorSetBusyWithCompleteReplay(value) {
      originalSetBusy(value);
      const elements = ensureCombinedUI();
      if (value) {
        timeline = [];
        forbiddenKeys = new Set();
        combinedSteps = [];
        combinedIndex = -1;
        lastRenderedBoard = null;
        lastRenderedAttacker = genGetAttacker();
        finalNMask = new Uint8Array(225);
        finalSignature = "";
        if (elements) elements.panel.hidden = true;
        return;
      }
      window.setTimeout(rebuildCombinedReplay, 0);
    };

    installBoardCapture();
    ensureCombinedUI();
  }

  installCompleteGeneratorReplay();
})();


// 逐顆補子事件與完整回放共用同一時間軸；必須最後安裝。
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
