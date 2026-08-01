"use strict";

// 題目產生器的較短／其他 VCF 採單次串流式搜尋：
// 搜尋核心每找到一條路線就與目標標準盤面比較；目標路線略過並繼續，
// 第一條較短或其他完成盤面立即返回、補守並重搜。
// 最終唯一題清理也使用同一流程，不再先列舉固定組數。
(function scheduleGeneratorDefensePointPolicy() {
  function installMobileDoubleTapGuard() {
    const viewport = document.querySelector('meta[name="viewport"]');
    if (viewport) {
      viewport.setAttribute(
        "content",
        "width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no",
      );
    }

    if (!document.querySelector('style[data-mobile-double-tap-guard="true"]')) {
      const style = document.createElement("style");
      style.dataset.mobileDoubleTapGuard = "true";
      style.textContent = `
        html, body, button, input, select, textarea, label, a {
          touch-action: manipulation;
        }
      `;
      document.head.appendChild(style);
    }

    if (!window.__mobileDoubleTapGuardInstalled) {
      window.__mobileDoubleTapGuardInstalled = true;
      document.addEventListener(
        "dblclick",
        event => event.preventDefault(),
        { passive: false },
      );
    }
  }

  function installGeneratorDefensePointPolicy() {
    if (window.__generatorDefensePointPolicyInstalled) return;
    if (!window.__generatorTargetBoardUniquePolicyV3Installed) {
      window.setTimeout(installGeneratorDefensePointPolicy, 0);
      return;
    }
    window.__generatorDefensePointPolicyInstalled = true;
    installMobileDoubleTapGuard();

    const MAX_DEPTH = 200;
    const STATE_LIMIT = 96;
    const BALANCE_UNIQUE_ROUND_LIMIT = 8;
    const LINE_OVERLINE = 28;
    const DEFAULT_TIME_SECONDS = 30;
    const DEFAULT_NODE_MILLIONS = 20;
    const PACKED_LIMIT_FLAG = 0x80000000;
    const FIRST_NON_TARGET_CACHE_VERSION = "first-nontarget-v2";

    const previousValidateCandidate = genValidateCandidate;
    const previousValidateExtensionCandidate = genValidateExtensionCandidate;
    const previousExtendToTarget = genExtendToTarget;
    const previousShowResult = genShowResult;

    class FirstNonTargetEngine {
      constructor() {
        this.worker = null;
        this.nextId = 1;
        this.pending = new Map();
        this.generation = 0;
        this.ready = this.restart();
      }

      workerURL() {
        const url = new URL(
          "rapfi/vcf-first-nontarget-worker.js",
          document.baseURI,
        );
        url.searchParams.set(
          "_worker",
          FIRST_NON_TARGET_CACHE_VERSION,
        );
        return url.href;
      }

      moduleURL() {
        return new URL(
          "rapfi/engine/vcf-bitboard-engine.js",
          document.baseURI,
        ).href;
      }

      createWorker(generation) {
        const worker = new Worker(this.workerURL());
        worker.onmessage = event => {
          if (generation !== this.generation) return;
          const { id, ok, result, error } = event.data || {};
          const pending = this.pending.get(id);
          if (!pending) return;
          this.pending.delete(id);
          if (ok) pending.resolve(result);
          else pending.reject(new Error(error || "第一非目標 VCF Worker 失敗"));
        };
        worker.onerror = event => {
          if (generation !== this.generation) return;
          const error = new Error(
            event?.message || "第一非目標 VCF Worker 發生錯誤",
          );
          for (const pending of this.pending.values()) {
            pending.reject(error);
          }
          this.pending.clear();
        };
        return worker;
      }

      callRaw(type, data) {
        return new Promise((resolve, reject) => {
          const id = this.nextId++;
          this.pending.set(id, { resolve, reject });
          this.worker.postMessage({ id, type, data });
        });
      }

      async restart() {
        this.generation++;
        const generation = this.generation;
        this.worker?.terminate();
        for (const pending of this.pending.values()) pending.resolve(null);
        this.pending.clear();
        this.worker = this.createWorker(generation);
        return this.callRaw("init", { moduleURL: this.moduleURL() });
      }

      async find(data) {
        await this.ready;
        return this.callRaw("findFirstNonTarget", data);
      }

      async cancel() {
        this.ready = this.restart();
        try {
          await this.ready;
        } catch (error) {
          console.warn("重新啟動第一非目標 VCF Worker 失敗", error);
        }
      }
    }

    const firstNonTargetEngine = new FirstNonTargetEngine();

    if (!window.__generatorFirstNonTargetStopHookInstalled) {
      window.__generatorFirstNonTargetStopHookInstalled = true;
      genEl("btn-stop")?.addEventListener(
        "click",
        () => firstNonTargetEngine.cancel(),
        true,
      );
    }

    function cloneState(state) {
      return {
        ...state,
        board: genCloneBoard(state.board),
        nMask: state.nMask?.slice() || new Uint8Array(225),
        addedAttackers: Array.from(state.addedAttackers || []),
        reusedAttackers: Array.from(state.reusedAttackers || []),
        removedDefenders: Array.from(state.removedDefenders || []),
        addedDefenders: Array.from(state.addedDefenders || []),
        autoBlockDefenders: Array.from(state.autoBlockDefenders || []),
        uniqueBlockDefenders: Array.from(state.uniqueBlockDefenders || []),
        xPoints: Array.from(state.xPoints || []),
        lineFivePoints: Array.from(state.lineFivePoints || []),
        vcfSearchLimitReasons: Array.from(
          state.vcfSearchLimitReasons || [],
        ),
      };
    }

    function expectedBoardFor(candidate, previousResult) {
      return previousResult
        ? genBuildExpectedExtendedBoard(previousResult, candidate)
        : genBuildExpectedBaseBoard(candidate);
    }

    function selectedInteger(id, fallback, max) {
      const parsed = Math.trunc(Number(genEl(id)?.value));
      return Number.isFinite(parsed)
        ? Math.max(0, Math.min(max, parsed))
        : fallback;
    }

    function selectedPackedLimits() {
      const seconds = selectedInteger(
        "vcf-multi-time-seconds",
        DEFAULT_TIME_SECONDS,
        0x000fffff,
      );
      const millions = selectedInteger(
        "vcf-multi-node-millions",
        DEFAULT_NODE_MILLIONS,
        1023,
      );
      return (
        PACKED_LIMIT_FLAG +
        seconds * 1024 +
        millions
      ) >>> 0;
    }

    function selectedPruning() {
      return typeof genSelectedPruning === "function"
        ? genSelectedPruning()
        : "strict";
    }

    function limitReason(info) {
      if (Number(info?.stopReason) === 2) return "時間上限";
      if (Number(info?.stopReason) === 3) return "節點上限";
      return "搜尋限制";
    }

    function markLimitWarning(state, info, phase) {
      const reason = limitReason(info);
      if (!Array.isArray(state.vcfSearchLimitReasons)) {
        state.vcfSearchLimitReasons = [];
      }
      state.vcfSearchLimitWarnings =
        Number(state.vcfSearchLimitWarnings || 0) + 1;
      if (!state.vcfSearchLimitReasons.includes(reason)) {
        state.vcfSearchLimitReasons.push(reason);
      }
      state.vcfSearchLimitAssumedClean = true;
      const location = phase === "final" ? "最終" : "中途";
      const text =
        `⚠ ${location}較短／其他 VCF 搜尋已達${reason}，` +
        "依設定暫按「沒有其他 VCF」繼續。";
      console.warn(text, info);
      genSetStatus(text);
    }

    function defenderCreatesFourFiveOrBlackOverline(state, idx, defender) {
      for (let direction = 0; direction < 4; direction++) {
        const lineType =
          testLineFour(idx, direction, defender, state.board) &
          GEN_LINE_MASK;
        if (
          lineType === GEN_FOUR_NOFREE ||
          lineType === GEN_FOUR_FREE ||
          lineType === GEN_FIVE ||
          lineType === GEN_LINE_DOUBLE_FOUR
        ) {
          return true;
        }
        if (defender === GEN_BLACK && lineType === LINE_OVERLINE) {
          return true;
        }
      }
      return false;
    }

    function isIllegalDefenderPoint(state, idx, targetDefensePoints) {
      const defender = state.defender || genOther(state.attacker);
      if (
        idx < 0 ||
        idx >= 225 ||
        state.board[idx] !== GEN_EMPTY
      ) {
        return true;
      }
      if (targetDefensePoints.has(idx)) return true;
      if (genIsNFor(state.nMask, idx, defender)) return true;
      return defenderCreatesFourFiveOrBlackOverline(
        state,
        idx,
        defender,
      );
    }

    async function findFirstUnwanted(
      state,
      expectedBoard,
      expectedSteps,
      blockOtherVCF,
    ) {
      const info = await firstNonTargetEngine.find({
        arr: Array.from(state.board),
        targetBoard: Array.from(expectedBoard),
        color: state.attacker,
        rules: Number(state.rules ?? genGetRules()),
        expectedSteps,
        blockOtherVCF,
        pruning: selectedPruning(),
        maxDepth: blockOtherVCF
          ? MAX_DEPTH
          : genTargetSearchPly(expectedSteps),
        maxNode: selectedPackedLimits(),
      });
      if (genCancelled || !info) return null;

      const targetMoves = Array.from(info.targetMoves || []);
      if (!targetMoves.length) return null;
      const targetAnalysis = genAnalyzeVCFGroup(
        state.board,
        targetMoves,
        state.attacker,
      );
      if (
        !targetAnalysis?.valid ||
        targetAnalysis.steps !== expectedSteps ||
        !genBoardsEqual(targetAnalysis.standardBoard, expectedBoard)
      ) {
        console.warn(
          "C++ 與 JavaScript 的目標 VCF 分類不一致",
          info,
          targetAnalysis,
        );
        return null;
      }

      let unwanted = null;
      const unwantedMoves = Array.from(info.unwantedMoves || []);
      if (unwantedMoves.length) {
        const analysis = genAnalyzeVCFGroup(
          state.board,
          unwantedMoves,
          state.attacker,
        );
        if (!analysis?.valid) return null;
        const isUnwanted =
          analysis.steps < expectedSteps ||
          (
            blockOtherVCF &&
            !genBoardsEqual(analysis.standardBoard, expectedBoard)
          );
        if (!isUnwanted) {
          console.warn(
            "C++ 與 JavaScript 的非目標 VCF 分類不一致",
            info,
            analysis,
          );
          return null;
        }
        unwanted = { moves: unwantedMoves, analysis };
      }

      const target = { moves: targetMoves, analysis: targetAnalysis };
      const groups = unwanted
        ? [targetMoves, unwantedMoves]
        : [targetMoves];
      return {
        info: {
          ...info,
          winMoves: groups,
          vcfCount: groups.length,
        },
        groups,
        target,
        unwanted,
        limitStopped: Boolean(info.aborted) && !unwanted,
        complete: !info.aborted && !unwanted,
      };
    }

    async function immediateDefensePoints(state, unwanted, target) {
      const [targetPoints, unwantedPoints] = await Promise.all([
        genEngine.getBlockVCF(
          state.board,
          state.attacker,
          target.moves,
          true,
        ),
        genEngine.getBlockVCF(
          state.board,
          state.attacker,
          unwanted.moves,
          true,
        ),
      ]);
      if (genCancelled) return null;

      const targetDefensePoints = new Set(targetPoints || []);
      const seen = new Set();
      const legal = [];
      for (const idx of unwantedPoints || []) {
        if (seen.has(idx)) continue;
        seen.add(idx);
        if (
          isIllegalDefenderPoint(
            state,
            idx,
            targetDefensePoints,
          )
        ) {
          continue;
        }
        legal.push(idx);
      }
      return legal;
    }

    function addLayerDefender(candidate, idx) {
      const next = cloneState(candidate);
      next.defender = next.defender || genOther(next.attacker);
      if (
        idx < 0 ||
        idx >= 225 ||
        next.board[idx] !== GEN_EMPTY
      ) {
        return null;
      }
      next.board[idx] = next.defender;
      if (!next.addedDefenders.includes(idx)) {
        next.addedDefenders.push(idx);
      }
      if (!next.autoBlockDefenders.includes(idx)) {
        next.autoBlockDefenders.push(idx);
      }
      return next;
    }

    function addFinalDefender(result, expectedBoard, idx) {
      const next = cloneState(result);
      next.defender = next.defender || genOther(next.attacker);
      if (
        idx < 0 ||
        idx >= 225 ||
        next.board[idx] !== GEN_EMPTY ||
        expectedBoard[idx] !== GEN_EMPTY
      ) {
        return null;
      }

      next.board[idx] = next.defender;
      if (!next.addedDefenders.includes(idx)) {
        next.addedDefenders.push(idx);
      }
      if (!next.autoBlockDefenders.includes(idx)) {
        next.autoBlockDefenders.push(idx);
      }
      if (!next.uniqueBlockDefenders.includes(idx)) {
        next.uniqueBlockDefenders.push(idx);
      }
      next.totalAddedDefenders =
        Number(next.totalAddedDefenders || 0) + 1;
      next.balanceComplete = false;

      const nextExpectedBoard = genCloneBoard(expectedBoard);
      nextExpectedBoard[idx] = next.defender;
      return { state: next, expectedBoard: nextExpectedBoard };
    }

    async function validateWithStreamingDefense(
      candidate,
      expectedSteps,
      previousResult,
      policy,
      budget,
    ) {
      if (
        genCancelled ||
        budget.nodes++ >= STATE_LIMIT
      ) {
        return null;
      }

      const expectedBoard = expectedBoardFor(
        candidate,
        previousResult,
      );
      if (!expectedBoard) return null;

      const found = await findFirstUnwanted(
        candidate,
        expectedBoard,
        expectedSteps,
        policy.blockOtherVCF,
      );
      if (!found?.target) return null;

      if (!found.unwanted) {
        if (found.limitStopped) {
          markLimitWarning(candidate, found.info, "mid");
        }
        const result = genFinalizeValidatedResult(
          candidate,
          found.target,
          found.info,
          found.groups,
          previousResult,
        );
        if (policy.blockOtherVCF) {
          result.uniqueVCFVerified = true;
          result.uniqueVCFSearchLimited =
            Boolean(found.limitStopped);
        }
        return result;
      }

      const points = await immediateDefensePoints(
        candidate,
        found.unwanted,
        found.target,
      );
      if (!points?.length) return null;

      for (const idx of points) {
        if (genCancelled) return null;
        const next = addLayerDefender(candidate, idx);
        if (!next) continue;
        const result = await validateWithStreamingDefense(
          next,
          expectedSteps,
          previousResult,
          policy,
          budget,
        );
        if (result) return result;
      }
      return null;
    }

    async function cleanFinalTargetBoard(
      state,
      expectedBoard,
      targetSteps,
      budget,
    ) {
      if (
        genCancelled ||
        budget.nodes++ >= STATE_LIMIT
      ) {
        return null;
      }

      const found = await findFirstUnwanted(
        state,
        expectedBoard,
        targetSteps,
        true,
      );
      if (!found?.target) return null;

      if (!found.unwanted) {
        if (found.limitStopped) {
          markLimitWarning(state, found.info, "final");
        }
        return {
          ...state,
          moves: found.target.moves,
          completedBoard: found.target.analysis.completedBoard,
          standardBoard: found.target.analysis.standardBoard,
          nMask: genApplyRouteNPoints(
            state,
            found.target.moves,
          ),
          nodeCount: found.info.nodeCount || 0,
          groupCount: found.groups.length,
          uniqueVCFVerified: true,
          uniqueVCFSearchLimited:
            Boolean(found.limitStopped),
        };
      }

      const points = await immediateDefensePoints(
        state,
        found.unwanted,
        found.target,
      );
      if (!points?.length) return null;

      for (const idx of points) {
        if (genCancelled) return null;
        const added = addFinalDefender(
          state,
          expectedBoard,
          idx,
        );
        if (!added) continue;
        const result = await cleanFinalTargetBoard(
          added.state,
          added.expectedBoard,
          targetSteps,
          budget,
        );
        if (result) return result;
      }
      return null;
    }

    genValidateCandidate =
      async function validateCandidateWithStreamingDefense(
        candidate,
        expectedSteps,
      ) {
        const blockOtherVCF = Boolean(
          genEl("block-other-vcf")?.checked,
        );
        const balanceStones = Boolean(
          genEl("balance-stones")?.checked,
        );
        if (!blockOtherVCF && !balanceStones) {
          return previousValidateCandidate(
            candidate,
            expectedSteps,
          );
        }

        return validateWithStreamingDefense(
          cloneState(candidate),
          expectedSteps,
          null,
          { blockOtherVCF, balanceStones },
          { nodes: 0 },
        );
      };

    genValidateExtensionCandidate =
      async function validateExtensionWithStreamingDefense(
        candidate,
        previousResult,
        targetSteps,
      ) {
        const blockOtherVCF = Boolean(
          genEl("block-other-vcf")?.checked,
        );
        const balanceStones = Boolean(
          genEl("balance-stones")?.checked,
        );
        if (!blockOtherVCF && !balanceStones) {
          return previousValidateExtensionCandidate(
            candidate,
            previousResult,
            targetSteps,
          );
        }
        if (targetSteps !== previousResult.steps + 1) {
          return null;
        }

        return validateWithStreamingDefense(
          cloneState(candidate),
          targetSteps,
          previousResult,
          { blockOtherVCF, balanceStones },
          { nodes: 0 },
        );
      };

    genExtendToTarget =
      async function extendWithStreamingDefense(
        current,
        targetSteps,
        attacker,
        rules,
        options,
        counters,
      ) {
        if (!options?.blockOtherVCF) {
          return previousExtendToTarget(
            current,
            targetSteps,
            attacker,
            rules,
            options,
            counters,
          );
        }

        let result = await previousExtendToTarget(
          current,
          targetSteps,
          attacker,
          rules,
          {
            ...options,
            blockOtherVCF: false,
            balanceStones: false,
          },
          counters,
        );
        if (!result || result.steps !== targetSteps) {
          return result;
        }

        genSetStatus(
          `正在逐條驗證並封鎖其他 VCF……` +
          `已驗證 ${counters.attempts} 個候選`,
        );
        result = await cleanFinalTargetBoard(
          result,
          result.standardBoard,
          targetSteps,
          { nodes: 0 },
        );
        if (!result || !options.balanceStones) {
          return result;
        }

        for (
          let round = 0;
          round < BALANCE_UNIQUE_ROUND_LIMIT;
          round++
        ) {
          const beforeBalanceBoard = genCloneBoard(result.board);
          result = await previousExtendToTarget(
            { ...result, balanceComplete: false },
            targetSteps,
            attacker,
            rules,
            {
              ...options,
              blockOtherVCF: false,
              balanceStones: true,
            },
            counters,
          );
          if (!result) return null;

          const afterBalanceBoard = genCloneBoard(result.board);
          const uniqueBlockCount =
            (result.uniqueBlockDefenders || []).length;
          const cleaned = await cleanFinalTargetBoard(
            result,
            result.standardBoard,
            targetSteps,
            { nodes: 0 },
          );
          if (!cleaned) return null;

          const addedUniqueDefense =
            (cleaned.uniqueBlockDefenders || []).length >
            uniqueBlockCount;
          result = cleaned;
          if (
            !addedUniqueDefense &&
            genBoardsEqual(
              beforeBalanceBoard,
              afterBalanceBoard,
            )
          ) {
            return { ...result, balanceComplete: true };
          }
          if (!addedUniqueDefense) {
            return { ...result, balanceComplete: true };
          }
        }
        return null;
      };

    genShowResult = function showResultWithSearchLimitWarning(
      result,
      targetSteps,
      attacker,
      counters,
      options,
    ) {
      previousShowResult(
        result,
        targetSteps,
        attacker,
        counters,
        options,
      );
      const warningCount =
        Number(result?.vcfSearchLimitWarnings || 0);
      if (!warningCount) return;

      const reasons = Array.from(
        result.vcfSearchLimitReasons || ["搜尋限制"],
      ).join("、");
      genSetStatus(
        `產生成功：${attacker === GEN_BLACK ? "黑" : "白"}` +
        `方 ${targetSteps} 步 VCF（共驗證 ` +
        `${counters.attempts} 個候選）；⚠ 較短／其他 VCF ` +
        `搜尋有 ${warningCount} 次達${reasons}，均依設定按` +
        "「沒有其他 VCF」處理。",
      );
    };
  }

  installGeneratorDefensePointPolicy();
})();
