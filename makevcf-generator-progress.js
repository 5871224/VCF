"use strict";

// Show the currently validated board and keep the status moving while a worker search is running.
(function installGeneratorValidationProgress() {
  if (window.__generatorValidationProgressInstalled) return;
  window.__generatorValidationProgressInstalled = true;

  let generationStartedAt = 0;
  let phaseStartedAt = 0;
  let phaseText = "";
  let phaseDetail = "";
  let currentContext = null;
  let defenseRequestCount = 0;
  let progressTimer = 0;

  const originalSetBusy = genSetBusy;
  const originalValidateCandidate = genValidateCandidate;
  const originalValidateExtensionCandidate = genValidateExtensionCandidate;
  const originalFindVCF = genEngine.findVCF.bind(genEngine);
  const originalTrimGroups = genEngine.trimGroups.bind(genEngine);
  const originalGetBlockVCF = genEngine.getBlockVCF.bind(genEngine);

  function elapsedSeconds(startedAt) {
    if (!startedAt) return "0.0";
    return ((performance.now() - startedAt) / 1000).toFixed(1);
  }

  function boardDifferenceCount(board, baseBoard, color) {
    if (!board || !baseBoard) return 0;
    let count = 0;
    for (let idx = 0; idx < 225; idx++) {
      if (board[idx] === color && baseBoard[idx] !== color) count++;
    }
    return count;
  }

  function renderValidationBoard(board, attacker) {
    if (!genBusy || genCancelled || !board || typeof window._setBoardArr !== "function") return;
    window._setBoardArr(genCloneBoard(board), attacker);
  }

  function updateProgressText() {
    if (!genBusy || genCancelled || !phaseText) return;
    const phaseElapsed = elapsedSeconds(phaseStartedAt);
    const totalElapsed = elapsedSeconds(generationStartedAt);
    const detail = phaseDetail ? `；${phaseDetail}` : "";
    genSetStatus(`${phaseText}……本步 ${phaseElapsed} 秒／總計 ${totalElapsed} 秒${detail}`);
  }

  function setProgressPhase(text, board, attacker, detail = "") {
    phaseText = text;
    phaseDetail = detail;
    phaseStartedAt = performance.now();
    renderValidationBoard(board, attacker);
    updateProgressText();
  }

  function ensureProgressTimer() {
    if (progressTimer) return;
    progressTimer = window.setInterval(updateProgressText, 1000);
  }

  function stopProgressTimer() {
    if (progressTimer) window.clearInterval(progressTimer);
    progressTimer = 0;
    phaseText = "";
    phaseDetail = "";
    currentContext = null;
    defenseRequestCount = 0;
  }

  function validationLabel(expectedSteps, previousResult) {
    return previousResult
      ? `驗證第 ${expectedSteps} 步死四`
      : `驗證 ${expectedSteps} 步初始基礎`;
  }

  function displayedStageLabel() {
    const text = genEl("status")?.textContent || "";
    if (text.includes("補齊黑白子數") || text.includes("補齊子數")) {
      return "最終處理：補齊黑白子數";
    }
    if (text.includes("封鎖其他完成盤面")) {
      return "最終處理：封鎖其他完成盤面";
    }
    return currentContext?.label || "驗證目前候選";
  }

  function searchLimitDetail(options) {
    const pruning = options?.pruning === "strict" ? "嚴格剪枝" : "高速剪枝";
    const settings = currentContext?.settings;
    if (!settings) return pruning;
    const timeText = settings.timeSeconds > 0 ? `${settings.timeSeconds} 秒` : "不限時間";
    const nodeText = settings.nodeMillions > 0 ? `${settings.nodeMillions} 百萬節點` : "不限節點";
    return `${pruning}；限制 ${timeText}／${nodeText}`;
  }

  genSetBusy = function generatorSetBusyWithProgress(value) {
    originalSetBusy(value);
    if (value) {
      generationStartedAt = performance.now();
      ensureProgressTimer();
    } else {
      stopProgressTimer();
    }
  };

  genValidateCandidate = async function validateCandidateWithProgress(candidate, expectedSteps) {
    const label = validationLabel(expectedSteps, null);
    currentContext = {
      label,
      expectedSteps,
      attacker: candidate.attacker,
      baseBoard: genCloneBoard(candidate.board),
      settings: genOptions().uniqueSearchSettings || null,
    };
    defenseRequestCount = 0;
    setProgressPhase(`${label}：準備搜尋`, candidate.board, candidate.attacker);
    return originalValidateCandidate(candidate, expectedSteps);
  };

  genValidateExtensionCandidate = async function validateExtensionWithProgress(
    candidate,
    previousResult,
    targetSteps,
  ) {
    const label = validationLabel(targetSteps, previousResult);
    currentContext = {
      label,
      expectedSteps: targetSteps,
      attacker: candidate.attacker,
      baseBoard: genCloneBoard(candidate.board),
      settings: genOptions().uniqueSearchSettings || null,
    };
    defenseRequestCount = 0;
    setProgressPhase(`${label}：準備搜尋`, candidate.board, candidate.attacker);
    return originalValidateExtensionCandidate(candidate, previousResult, targetSteps);
  };

  genEngine.findVCF = async function findVCFWithGeneratorProgress(
    board,
    attacker,
    maxVCF = 64,
    options = {},
  ) {
    const label = displayedStageLabel();
    const defender = genOther(attacker);
    const addedDefenders = boardDifferenceCount(board, currentContext?.baseBoard, defender);
    const addedAttackers = boardDifferenceCount(board, currentContext?.baseBoard, attacker);
    let action;

    if (options.mode === "multi") {
      action = addedDefenders > 0
        ? `補守 ${addedDefenders} 顆後重新搜尋多組 VCF`
        : "搜尋多組 VCF";
    } else if (options.mode === "shortest") {
      action = addedDefenders > 0
        ? `補守 ${addedDefenders} 顆後重新搜尋最短 VCF`
        : "搜尋最短 VCF";
    } else {
      action = "搜尋單組 VCF";
    }

    if (addedAttackers > 0) action += `；目前另補攻方 ${addedAttackers} 顆`;
    setProgressPhase(`${label}：${action}`, board, attacker, searchLimitDetail(options));

    const info = await originalFindVCF(board, attacker, maxVCF, options);
    if (!genCancelled) {
      const foundCount = (info?.winMoves || []).filter(moves => moves?.length).length;
      const incomplete = info?.aborted || foundCount >= maxVCF;
      const note = incomplete ? "搜尋達限制，將使用目前結果" : "搜尋完成";
      setProgressPhase(
        `${label}：分析搜尋結果`,
        board,
        attacker,
        `找到 ${foundCount} 組；${note}`,
      );
    }
    return info;
  };

  genEngine.trimGroups = async function trimGroupsWithGeneratorProgress(board, groups, attacker) {
    const label = displayedStageLabel();
    setProgressPhase(
      `${label}：修剪活四尾步並去重`,
      board,
      attacker,
      `處理 ${groups?.length || 0} 組路線`,
    );
    const result = await originalTrimGroups(board, groups, attacker);
    if (!genCancelled) {
      setProgressPhase(
        `${label}：分類標準完成盤面`,
        board,
        attacker,
        `修剪後 ${result?.length || 0} 組`,
      );
    }
    return result;
  };

  genEngine.getBlockVCF = async function getBlockVCFWithGeneratorProgress(
    board,
    attacker,
    moves,
    includeFour = true,
  ) {
    defenseRequestCount++;
    const label = displayedStageLabel();
    setProgressPhase(
      `${label}：計算目標／其他 VCF 防守點`,
      board,
      attacker,
      `目前第 ${defenseRequestCount} 條路線；手順 ${moves?.length || 0} 手`,
    );
    return originalGetBlockVCF(board, attacker, moves, includeFour);
  };
})();
