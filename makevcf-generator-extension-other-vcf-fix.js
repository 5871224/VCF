"use strict";

// 分離題目產生器的兩種補守階段：
// 1. 每次增加死四後，延伸驗證自行封鎖較短／別組 VCF。
// 2. 「補齊黑白子數」不得參與中途驗證，只在達到指定步數後由既有最終流程執行。
(function installGeneratorValidationStageSeparation(global) {
  const INSTALL_FLAG = "__generatorValidationStageSeparationInstalled";

  function callWithTemporaryChecks(
    callback,
    balanceInput,
    temporaryBalance,
    blockOtherInput,
    temporaryBlockOther,
  ) {
    const originalBalance = balanceInput?.checked;
    const originalBlockOther = blockOtherInput?.checked;

    if (balanceInput && typeof temporaryBalance === "boolean") {
      balanceInput.checked = temporaryBalance;
    }
    if (blockOtherInput && typeof temporaryBlockOther === "boolean") {
      blockOtherInput.checked = temporaryBlockOther;
    }

    try {
      // 現行驗證函式會在第一個 await 前同步讀取兩個選項，
      // 因此呼叫完成建立 Promise 後即可立即恢復介面狀態。
      return callback();
    } finally {
      if (balanceInput) balanceInput.checked = originalBalance;
      if (blockOtherInput) blockOtherInput.checked = originalBlockOther;
    }
  }

  function install() {
    if (global[INSTALL_FLAG]) return;
    if (
      !global.__generatorDefensePointPolicyInstalled ||
      typeof global.genValidateCandidate !== "function" ||
      typeof global.genValidateExtensionCandidate !== "function" ||
      typeof global.genEl !== "function"
    ) {
      global.setTimeout(install, 0);
      return;
    }

    const previousValidateCandidate = global.genValidateCandidate;
    const previousValidateExtensionCandidate =
      global.genValidateExtensionCandidate;
    global[INSTALL_FLAG] = true;

    global.genValidateCandidate = function validateBaseWithoutEarlyBalance(
      ...args
    ) {
      const balanceInput = global.genEl("balance-stones");
      if (!balanceInput?.checked) {
        return previousValidateCandidate.apply(this, args);
      }

      // 初始材料驗證不補齊棋子；只保留目標 VCF 若由使用者勾選，仍照常生效。
      return callWithTemporaryChecks(
        () => previousValidateCandidate.apply(this, args),
        balanceInput,
        false,
        null,
        null,
      );
    };

    global.genValidateExtensionCandidate =
      function validateExtensionWithoutEarlyBalance(...args) {
        const balanceInput = global.genEl("balance-stones");
        const blockOtherInput = global.genEl("block-other-vcf");

        // 每次新增死四後都必須處理較短／別組 VCF；這是延伸驗證，
        // 與最後才執行的黑白子數補齊無關。
        return callWithTemporaryChecks(
          () => previousValidateExtensionCandidate.apply(this, args),
          balanceInput,
          false,
          blockOtherInput,
          true,
        );
      };
  }

  install();
})(window);
