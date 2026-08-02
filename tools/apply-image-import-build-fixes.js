"use strict";

const fs = require("fs");
function fail(message) { throw new Error(`[正式來源一致性驗證] ${message}`); }
const html = fs.readFileSync("makevcf.html", "utf8");
for (const token of [
  "rapfi/engine/vcf-bitboard-engine.js", "rapfi/vcf-bitboard-main.js",
  "makevcf-generator-search-policy.js", "makevcf-generator-finalize.js",
  "makevcf-generator-image-import-fix.js",
]) if (!html.includes(token)) fail(`makevcf.html 缺少 ${token}`);
for (const obsolete of [
  "makevcf-generator-target-board-v3.js", "makevcf-generator-defense-points.js",
  "makevcf-generator-extension-other-vcf-fix.js", "makevcf-generator-protected-defenders.js",
  "makevcf-generator-board.js", "makevcf-generator-reuse-bonus.js",
]) if (html.includes(obsolete) || fs.existsSync(obsolete)) fail(`仍殘留舊模組 ${obsolete}`);
for (const file of [
  "makevcf-generator-layout-fix.js", "makevcf-generator-ui-compact.js",
  "makevcf-generator-open-four-stop.js", "makevcf-generator-settings-persistence.js",
  "rapfi/vcf-bitboard-main.js",
]) {
  const text = fs.readFileSync(file, "utf8");
  for (const forbidden of ["setInterval(", "new MutationObserver", "script.src =", 'document.createElement("script")']) {
    if (text.includes(forbidden)) fail(`${file} 仍使用 ${forbidden}`);
  }
}
console.log("正式來源、固定載入與一次性 UI 驗證通過。");
