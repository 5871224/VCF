"use strict";

// VCF 補守棋子是為了封鎖已知的較短／其他 VCF；後續反向增加死四時，
// 不得再把這些棋子當成模板五點的對方棋而暫時移除，否則已封鎖的 VCF 會重新出現。
(function installProtectedGeneratorDefenders(global) {
  const INSTALL_FLAG = "__generatorProtectedDefendersInstalled";
  const BOTH_N = GEN_NO_BLACK | GEN_NO_WHITE;

  function install() {
    if (global[INSTALL_FLAG]) return;
    if (
      !global.__generatorDefensePointPolicyInstalled ||
      typeof global.genBuildLayerCandidates !== "function" ||
      typeof global.genValidateCandidate !== "function" ||
      typeof global.genValidateExtensionCandidate !== "function" ||
      typeof global.genExtendToTarget !== "function"
    ) {
      global.setTimeout(install, 0);
      return;
    }

    global[INSTALL_FLAG] = true;

    function protectedPointsOf(state) {
      return new Set([
        ...Array.from(state?.protectedDefenders || []),
        ...Array.from(state?.autoBlockDefenders || []),
        ...Array.from(state?.uniqueBlockDefenders || []),
      ].filter(idx => Number.isInteger(idx) && idx >= 0 && idx < 225));
    }

    function protectState(state) {
      if (!state) return state;
      if (!state.nMask) state.nMask = new Uint8Array(225);

      const points = protectedPointsOf(state);
      for (const idx of points) state.nMask[idx] |= BOTH_N;
      state.protectedDefenders = Array.from(points);
      return state;
    }

    // 先把既有補守棋標成雙方 N；即使原始模板仍允許五點使用對方棋，
    // 也在候選建好後明確淘汰任何會移除受保護守子的候選，避免只依賴 N 點檢查順序。
    const previousBuildLayerCandidates = global.genBuildLayerCandidates;
    global.genBuildLayerCandidates = function buildLayerCandidatesWithoutRemovingProtectedDefenders(
      ...args
    ) {
      const base = protectState(args[0]);
      const protectedPoints = protectedPointsOf(base);
      const candidates = previousBuildLayerCandidates.apply(this, args) || [];

      return candidates.filter(candidate => {
        protectState(candidate);
        return !(candidate.removedDefenders || []).some(idx => protectedPoints.has(idx));
      });
    };

    const previousValidateCandidate = global.genValidateCandidate;
    global.genValidateCandidate = async function validateCandidateWithProtectedDefenders(
      candidate,
      ...args
    ) {
      const result = await previousValidateCandidate.call(this, protectState(candidate), ...args);
      return protectState(result);
    };

    const previousValidateExtensionCandidate = global.genValidateExtensionCandidate;
    global.genValidateExtensionCandidate = async function validateExtensionWithProtectedDefenders(
      candidate,
      previousResult,
      ...args
    ) {
      const result = await previousValidateExtensionCandidate.call(
        this,
        protectState(candidate),
        protectState(previousResult),
        ...args
      );
      return protectState(result);
    };

    const previousExtendToTarget = global.genExtendToTarget;
    global.genExtendToTarget = async function extendToTargetWithProtectedDefenders(
      current,
      ...args
    ) {
      const result = await previousExtendToTarget.call(this, protectState(current), ...args);
      return protectState(result);
    };
  }

  install();
})(window);
