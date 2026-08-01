"use strict";

// 每次反向增加一層死四後，只要「補齊黑白子數」開啟，
// 延伸驗證也必須把同一步數、不同完成盤面的別組 VCF 補守封鎖。
(function installExtensionOtherVCFBlocking(global) {
  const INSTALL_FLAG = "__generatorExtensionOtherVCFBlockingInstalled";

  function install() {
    if (global[INSTALL_FLAG]) return;
    if (
      !global.__generatorDefensePointPolicyInstalled ||
      typeof global.genValidateExtensionCandidate !== "function" ||
      typeof global.genEl !== "function"
    ) {
      global.setTimeout(install, 0);
      return;
    }

    const previousValidateExtensionCandidate =
      global.genValidateExtensionCandidate;
    global[INSTALL_FLAG] = true;

    global.genValidateExtensionCandidate = function validateExtensionWithOtherVCFBlocking(
      ...args
    ) {
      const balanceInput = global.genEl("balance-stones");
      const blockOtherInput = global.genEl("block-other-vcf");
      if (
        !balanceInput?.checked ||
        !blockOtherInput ||
        blockOtherInput.checked
      ) {
        return previousValidateExtensionCandidate.apply(this, args);
      }

      // 現行延伸驗證會在函式開頭同步讀取此選項；只在該次呼叫暫時開啟，
      // 讓「補齊黑白子數」同時處理延伸層的別組 VCF，介面狀態立即復原。
      blockOtherInput.checked = true;
      try {
        return previousValidateExtensionCandidate.apply(this, args);
      } finally {
        blockOtherInput.checked = false;
      }
    };
  }

  install();
})(window);
