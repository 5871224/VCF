"use strict";

// Replace the old center-direction preference with a board-stone concentration preference.
(function initGeneratorConcentrationBonus() {
  if (window.__generatorConcentrationBonusLoaded) return;
  window.__generatorConcentrationBonusLoaded = true;

  function renameConcentrationControl() {
    const input = genEl("bonus-center");
    const label = input?.closest("label");
    if (!label) return;

    for (const node of label.childNodes) {
      if (node === input) break;
      if (node.nodeType === Node.TEXT_NODE) {
        node.nodeValue = "棋子集中加成 ";
        break;
      }
    }
    label.title = "以目前盤面全部黑白棋的座標平均值作為分布中心；死四模板正中間那一點越接近分布中心，加成越高";
  }

  function stoneCentroid(board) {
    let sumX = 0;
    let sumY = 0;
    let count = 0;

    for (let idx = 0; idx < 225; idx++) {
      if (board[idx] !== GEN_BLACK && board[idx] !== GEN_WHITE) continue;
      sumX += genX(idx);
      sumY += genY(idx);
      count++;
    }

    return count
      ? { x: sumX / count, y: sumY / count }
      : { x: GEN_CENTER.x, y: GEN_CENTER.y };
  }

  function farthestCornerDistance(center) {
    return Math.max(
      Math.hypot(center.x, center.y),
      Math.hypot(14 - center.x, center.y),
      Math.hypot(center.x, 14 - center.y),
      Math.hypot(14 - center.x, 14 - center.y)
    );
  }

  function concentrationPreference(board, templateCenterPoint) {
    if (templateCenterPoint < 0 || templateCenterPoint >= 225) return 0;

    const center = stoneCentroid(board);
    const distance = Math.hypot(
      genX(templateCenterPoint) - center.x,
      genY(templateCenterPoint) - center.y
    );
    const maximum = farthestCornerDistance(center);
    return maximum > 0
      ? Math.max(0, Math.min(1, 1 - distance / maximum))
      : 1;
  }

  renameConcentrationControl();

  const originalBuildLayerCandidates = genBuildLayerCandidates;
  genBuildLayerCandidates = function buildLayerCandidatesWithConcentration(
    base,
    anchor,
    direction,
    sign,
    template,
    anchorSlot,
    attacker,
    rules,
    options
  ) {
    const candidates = originalBuildLayerCandidates(
      base,
      anchor,
      direction,
      sign,
      template,
      anchorSlot,
      attacker,
      rules,
      options
    );

    const middleSlot = Math.floor(template.cells.length / 2);
    const middlePoint = genPointFrom(anchor, middleSlot - anchorSlot, direction, sign);
    const preference = concentrationPreference(base.board, middlePoint);
    const bonus = Math.max(0, Number(options?.centerBonus) || 0);

    for (const candidate of candidates) {
      const oldPreference = Math.max(0, Number(candidate.centerPreference) || 0);
      candidate.weight += (preference - oldPreference) * bonus;
      candidate.weight = Math.max(0.0001, candidate.weight);
      candidate.concentrationPreference = preference;
      candidate.templateCenterPoint = middlePoint;
      delete candidate.centerPreference;
    }

    return candidates;
  };

  const originalLayerRecord = genLayerRecord;
  genLayerRecord = function layerRecordWithConcentration(candidate, step) {
    const record = originalLayerRecord(candidate, step);
    record.concentrationPreference = Number(candidate.concentrationPreference || 0);
    record.templateCenterPoint = candidate.templateCenterPoint;
    return record;
  };
})();

// Install after order-mode / balance / unique / summary have finished their synchronous setup
// and after order-mode's deferred flexible-fill override has run.
(function scheduleTargetBoardUniquePolicy() {
  setTimeout(() => setTimeout(() => {
    if (window.__generatorTargetBoardUniquePolicyInstalled) return;
    window.__generatorTargetBoardUniquePolicyInstalled = true;

    const SHAPE_MASK = 0x0f;
    const MAX_GROUPS = 64;
    const MAX_DEPTH = 200;
    const MAX_NODE = 5000000;
    const BRANCH_LIMIT = 8;
    const STATE_LIMIT = 96;

    const previousValidateCandidate = genValidateCandidate;
    const previousValidateExtensionCandidate = genValidateExtensionCandidate;
    const previousExtendToTarget = genExtendToTarget;

    function cloneCandidate(candidate) {
      return {
        ...candidate,
        board: genCloneBoard(candidate.board),
        nMask: candidate.nMask?.slice() || new Uint8Array(225),
        addedAttackers: Array.from(candidate.addedAttackers || []),
        reusedAttackers: Array.from(candidate.reusedAttackers || []),
        removedDefenders: Array.from(candidate.removedDefenders || []),
        addedDefenders: Array.from(candidate.addedDefenders || []),
        autoBlockDefenders: Array.from(candidate.autoBlockDefenders || []),
        xPoints: Array.from(candidate.xPoints || []),
        lineFivePoints: Array.from(candidate.lineFivePoints || []),
      };
    }

    function expectedBoardFor(candidate, previousResult) {
      return previousResult
        ? genBuildExpectedExtendedBoard(previousResult, candidate)
        : genBuildExpectedBaseBoard(candidate);
    }

    function isSameTargetBoard(analysis, expectedBoard) {
      return Boolean(analysis?.valid) && genBoardsEqual(analysis.standardBoard, expectedBoard);
    }

    async function findAllGroups(candidate) {
      const info = await genEngine.findVCF(candidate.board, candidate.attacker, MAX_GROUPS, {
        mode: "multi",
        simplify: true,
        maxDepth: MAX_DEPTH,
        maxNode: MAX_NODE,
      });
      if (genCancelled || !info?.winMoves?.length) return null;

      const raw = info.winMoves.filter(moves => moves?.length);
      if (!raw.length) return null;
      const groups = await genEngine.trimGroups(candidate.board, raw, candidate.attacker);
      if (genCancelled || !groups.length) return null;

      return {
        info,
        groups,
        saturated: Boolean(info.aborted) ||
          raw.length >= MAX_GROUPS ||
          Number(info.nodeCount || 0) >= MAX_NODE,
      };
    }

    function analyzeAllGroups(candidate, groups, expectedBoard, expectedSteps) {
      const analyzed = [];
      for (const moves of groups) {
        const analysis = genAnalyzeVCFGroup(candidate.board, moves, candidate.attacker);
        if (!analysis.valid) continue;
        analyzed.push({ moves: Array.from(moves), analysis });
      }

      const targets = analyzed.filter(item => isSameTargetBoard(item.analysis, expectedBoard));
      const exactTargets = targets.filter(item => item.analysis.steps === expectedSteps);
      const unwanted = analyzed.filter(item => !isSameTargetBoard(item.analysis, expectedBoard));
      return { analyzed, targets, exactTargets, unwanted };
    }

    function addDefender(candidate, idx) {
      const next = cloneCandidate(candidate);
      next.defender = next.defender || genOther(next.attacker);
      if (idx < 0 || idx >= 225 || next.board[idx] !== GEN_EMPTY) return null;
      next.board[idx] = next.defender;
      if (!next.addedDefenders.includes(idx)) next.addedDefenders.push(idx);
      if (!next.autoBlockDefenders.includes(idx)) next.autoBlockDefenders.push(idx);
      return next;
    }

    function isIllegalDefenderPoint(candidate, idx, protectedPoints) {
      const defender = candidate.defender || genOther(candidate.attacker);
      if (idx < 0 || idx >= 225 || candidate.board[idx] !== GEN_EMPTY) return true;
      if (protectedPoints.has(idx)) return true;
      if (genIsNFor(candidate.nMask, idx, defender)) return true;

      const level = getLevelPoint(idx, defender, candidate.board) & SHAPE_MASK;
      if (level === GEN_FOUR_NOFREE || level === GEN_FOUR_FREE || level >= GEN_FIVE) return true;
      return candidate.rules === 2 && defender === GEN_BLACK && isFoul(idx, candidate.board);
    }

    async function collectTargetDefensePoints(candidate, targets) {
      const protectedPoints = new Set();
      for (const target of targets) {
        const points = await genEngine.getBlockVCF(
          candidate.board,
          candidate.attacker,
          target.moves,
          true,
        );
        for (const idx of points) protectedPoints.add(idx);
      }
      return protectedPoints;
    }

    async function rankUnwantedDefensePoints(candidate, unwanted, targets) {
      const protectedPoints = await collectTargetDefensePoints(candidate, targets);
      const frequency = new Map();

      for (const item of unwanted) {
        if (genCancelled) return null;
        const rawPoints = await genEngine.getBlockVCF(
          candidate.board,
          candidate.attacker,
          item.moves,
          true,
        );
        const legalPoints = Array.from(new Set(rawPoints))
          .filter(idx => !isIllegalDefenderPoint(candidate, idx, protectedPoints));

        // 任一非目標 VCF 扣除目標防點後已無可用防點，這次死四或補子分支無法成立。
        if (!legalPoints.length) return null;
        for (const idx of legalPoints) {
          frequency.set(idx, (frequency.get(idx) || 0) + 1);
        }
      }

      return Array.from(frequency, ([idx, count]) => ({ idx, count }))
        .sort((left, right) => right.count - left.count || Math.random() - 0.5);
    }

    async function validateTargetBoardUnique(candidate, expectedSteps, previousResult, budget) {
      if (genCancelled || budget.nodes++ >= STATE_LIMIT) return null;

      const expectedBoard = expectedBoardFor(candidate, previousResult);
      if (!expectedBoard) return null;
      const found = await findAllGroups(candidate);
      if (!found) return null;

      const { targets, exactTargets, unwanted } = analyzeAllGroups(
        candidate,
        found.groups,
        expectedBoard,
        expectedSteps,
      );

      // 同完成盤面的不同手順或不同長度都視為同一目標 VCF；
      // 但原本這一層所要求的指定步數路線仍須存在，才能證明死四層建立成功。
      if (!targets.length || !exactTargets.length) return null;

      if (!unwanted.length) {
        if (found.saturated) return null;
        const result = genFinalizeValidatedResult(
          candidate,
          exactTargets[0],
          found.info,
          found.groups,
          previousResult,
        );
        return { ...result, uniqueVCFVerified: true };
      }

      const ranked = await rankUnwantedDefensePoints(candidate, unwanted, targets);
      if (!ranked?.length) return null;

      for (const { idx } of ranked.slice(0, BRANCH_LIMIT)) {
        if (genCancelled) return null;
        const next = addDefender(candidate, idx);
        if (!next) continue;
        const result = await validateTargetBoardUnique(
          next,
          expectedSteps,
          previousResult,
          budget,
        );
        if (result) return result;
      }
      return null;
    }

    genValidateCandidate = async function validateCandidateByTargetBoard(candidate, expectedSteps) {
      if (!genEl("block-other-vcf")?.checked) {
        return previousValidateCandidate(candidate, expectedSteps);
      }
      return validateTargetBoardUnique(cloneCandidate(candidate), expectedSteps, null, { nodes: 0 });
    };

    genValidateExtensionCandidate = async function validateExtensionByTargetBoard(
      candidate,
      previousResult,
      targetSteps,
    ) {
      if (!genEl("block-other-vcf")?.checked) {
        return previousValidateExtensionCandidate(candidate, previousResult, targetSteps);
      }
      if (targetSteps !== previousResult.steps + 1) return null;
      return validateTargetBoardUnique(
        cloneCandidate(candidate),
        targetSteps,
        previousResult,
        { nodes: 0 },
      );
    };

    async function verifyFinalTargetBoardResult(result, targetSteps) {
      const found = await findAllGroups(result);
      if (!found || found.saturated) return false;
      const { targets, exactTargets, unwanted } = analyzeAllGroups(
        result,
        found.groups,
        result.standardBoard,
        targetSteps,
      );
      return Boolean(targets.length && exactTargets.length && !unwanted.length);
    }

    genExtendToTarget = async function extendWithTargetBoardFinalCheck(
      current,
      targetSteps,
      attacker,
      rules,
      options,
      counters,
    ) {
      const result = await previousExtendToTarget(
        current,
        targetSteps,
        attacker,
        rules,
        options,
        counters,
      );
      if (!result || !options?.blockOtherVCF || result.steps !== targetSteps) return result;

      genSetStatus(`正在依完成盤面確認只保留目標 VCF……已驗證 ${counters.attempts} 個候選`);
      const valid = await verifyFinalTargetBoardResult(result, targetSteps);
      return valid ? { ...result, uniqueVCFVerified: true } : null;
    };

    const uniqueInput = genEl("block-other-vcf");
    const uniqueLabel = uniqueInput?.closest("label");
    if (uniqueLabel) {
      uniqueLabel.title = "開啟後，以多組 VCF 搜尋所有長短路線；標準完成盤面相同視為同一目標 VCF，其餘路線依防點統計逐顆補守並遞迴重搜";
    }
  }, 0), 0);
})();
