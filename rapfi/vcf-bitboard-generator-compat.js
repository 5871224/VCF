"use strict";

(function installGeneratorCompatibility(global) {
  const service = global.VCFBitboard;
  if (!service) return;
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

(function loadRapfiWorkbenchTools() {
  for (const source of [
    "rapfi/rapfi-workbench-header.js",
    "rapfi/rapfi-question-bank.js",
  ]) {
    const script = document.createElement("script");
    script.src = source;
    document.head.appendChild(script);
  }
})();
