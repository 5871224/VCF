"use strict";

(function installGeneratorCompatibility(global) {
  const service = global.VCFBitboard;
  if (!service) return;

  const normalizeRules = rules => {
    const value = Number(rules);
    return value === 0 || value === 1 || value === 2 ? value : 2;
  };

  // 原本使用 Number(rules) || 2，會把自由五子棋的規則值 0 誤判成有禁。
  // 在相容層覆寫規則廣播，完整保留 0／1／2 三種規則。
  service.broadcastRules = async function broadcastRulesCompat(rules) {
    this.rules = normalizeRules(rules);
    await Promise.all([
      this.main.call("setGameRules", { rules: this.rules }),
      ...this.pool.map(worker => worker.call("setGameRules", { rules: this.rules })),
    ]);
    await this.syncReady;
    return true;
  };

  const originalReady = service.syncReady;
  const compatReady = originalReady.then(() => {
    const levelPoint = service.syncModule.cwrap(
      "vcfBbLegacyGetLevelPointCompat",
      "number",
      ["number", "number", "number", "number"],
    );
    const lineFour = service.syncModule.cwrap(
      "vcfBbLegacyTestLineFourCompat",
      "number",
      ["number", "number", "number", "number", "number"],
    );
    global.setGameRules = rules => {
      service.rules = normalizeRules(rules);
    };
    global.getLevelPoint = (idx, color, arr) => {
      service.writeSyncBoard(arr);
      return levelPoint(service.syncBoardPtr, idx, color, service.rules);
    };
    global.testLineFour = (idx, direction, color, arr) => {
      service.writeSyncBoard(arr);
      return lineFour(service.syncBoardPtr, idx, direction, color, service.rules);
    };
    global.testLine = global.testLineFour;
    global.testLineThree = global.testLineFour;
    return true;
  });
  service.syncReady = compatReady;
  service.compatReady = compatReady;
})(window);

(function prepareRapfiWorkbenchTools() {
  // Dashboard 建立快速操作列前先隱藏舊說明面板，避免版面閃動。
  if (document.getElementById("bb-compact-header-style")) return;
  const style = document.createElement("style");
  style.id = "bb-compact-header-style";
  style.textContent = `
    #bitboard-architecture-panel:not(.bb-quick-actions) {
      display: none !important;
    }
  `;
  document.head.appendChild(style);
})();
