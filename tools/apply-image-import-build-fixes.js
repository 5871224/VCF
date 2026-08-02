"use strict";

const fs = require("fs");
const path = require("path");
const root = path.resolve(__dirname, "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");

const html = read("makevcf.html");
const image = read("makevcf-generator-image-import-fix.js");
const runtime = read("rapfi/vcf-bitboard-generator-compat.js");
const bank = read("rapfi/rapfi-question-bank.js");

for (const token of [
  "makevcf-generator-image-import-fix.js",
  "rapfi/vcf-bitboard-generator-compat.js",
  "rapfi/rapfi-question-bank.js",
]) if (!html.includes(token)) throw new Error(`missing fixed runtime source: ${token}`);

for (const token of [
  "vcfRegisterImageDataProcessor",
  "vcfRegisterHoughLineProvider",
  '"numbered-stone-centers"',
  '"permissive-internal-lattice"',
  '"missing-edge-lattice"',
  "installWhenCvReady",
]) if (!image.includes(token)) throw new Error(`image import registry contract missing: ${token}`);

for (const forbidden of ["new Error().stack", "warpCallSequence", "setInterval("]) {
  if (image.includes(forbidden)) throw new Error(`fragile image patch remains: ${forbidden}`);
}
if ((image.match(/prototype\.getImageData\s*=/g) || []).length !== 1) {
  throw new Error("image data adapter must be installed exactly once");
}
if ((image.match(/cv\.HoughLinesP\s*=/g) || []).length !== 1) {
  throw new Error("Hough adapter must be installed exactly once");
}

for (const token of [
  "vcf-board-changed",
  "vcfRegisterSearchHandler",
  "vcfSetRules",
]) if (!runtime.includes(token)) throw new Error(`workbench runtime contract missing: ${token}`);
if (!html.includes("vcfRegisterBusyHook")) throw new Error("main busy hook registry is unavailable");

for (const forbidden of ["window._setBoardArr =", "window._clearBoard =", "setBusy = function"]) {
  if (bank.includes(forbidden)) throw new Error(`question bank override remains: ${forbidden}`);
}

console.log("Image import and workbench runtime checks passed");
