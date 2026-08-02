"use strict";

// 封鎖較短／其他 VCF 所補入的守子，後續反向增加死四時不得再作為模板「五」點移除。
// 不另建保護清單，只把既有 autoBlockDefenders／uniqueBlockDefenders 對應位置設成雙方 N。
(function installGeneratorBlockerNPoints(global) {
  const INSTALL_FLAG = "__generatorProtectedDefendersInstalled";

  function install() {
    if (global[INSTALL_FLAG]) return;
    if (
      typeof GEN_NO_BLACK !== "number" ||
      typeof GEN_NO_WHITE !== "number" ||
      !global.__generatorDefensePointPolicyInstalled ||
      typeof global.genValidateCandidate !== "function" ||
      typeof global.genValidateExtensionCandidate !== "function" ||
      typeof global.genExtendToTarget !== "function"
    ) {
      global.setTimeout(install, 0);
      return;
    }

    global[INSTALL_FLAG] = true;
    const BOTH_N = GEN_NO_BLACK | GEN_NO_WHITE;

    function applyBlockerNPoints(state) {
      if (!state) return state;
      if (!state.nMask) state.nMask = new Uint8Array(225);

      const points = new Set([
        ...Array.from(state.autoBlockDefenders || []),
        ...Array.from(state.uniqueBlockDefenders || []),
      ]);
      for (const idx of points) {
        if (Number.isInteger(idx) && idx >= 0 && idx < 225) {
          state.nMask[idx] |= BOTH_N;
        }
      }
      return state;
    }

    const previousValidateCandidate = global.genValidateCandidate;
    global.genValidateCandidate = async function validateCandidateWithBlockerNPoints(
      candidate,
      ...args
    ) {
      const result = await previousValidateCandidate.call(
        this,
        applyBlockerNPoints(candidate),
        ...args
      );
      return applyBlockerNPoints(result);
    };

    const previousValidateExtensionCandidate = global.genValidateExtensionCandidate;
    global.genValidateExtensionCandidate = async function validateExtensionWithBlockerNPoints(
      candidate,
      previousResult,
      ...args
    ) {
      const result = await previousValidateExtensionCandidate.call(
        this,
        applyBlockerNPoints(candidate),
        applyBlockerNPoints(previousResult),
        ...args
      );
      return applyBlockerNPoints(result);
    };

    const previousExtendToTarget = global.genExtendToTarget;
    global.genExtendToTarget = async function extendWithBlockerNPoints(
      current,
      ...args
    ) {
      const result = await previousExtendToTarget.call(
        this,
        applyBlockerNPoints(current),
        ...args
      );
      return applyBlockerNPoints(result);
    };
  }

  install();
})(window);
