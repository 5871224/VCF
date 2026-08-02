"use strict";

const fs = require("fs");
const vm = require("vm");
const context = {
  console, Array, Set, Map, Number, Boolean, Math,
  window: {}, performance: { now: () => 0 },
  GEN_EMPTY: 0, GEN_BLACK: 1, GEN_WHITE: 2, GEN_OUT: 225,
  GEN_FOUR_FREE: 9, GEN_FOUR_NOFREE: 8,
  genOther: color => 3 - color, genX: idx => idx % 15, genY: idx => Math.floor(idx / 15),
  genIdx: (x, y) => x >= 0 && x < 15 && y >= 0 && y < 15 ? y * 15 + x : 225,
  genCancelled: false, genApplyBlockerNPoints: value => value,
  genSetStatus() {}, genCleanFinalTargetBoard: async value => value,
  testLineThree: () => 0, testLineFour: () => 0, isFoul: () => false,
};
context.window = context; context.globalThis = context;
vm.createContext(context);
vm.runInContext(fs.readFileSync("makevcf-generator-finalize.js", "utf8"), context);
(async () => {
  const board = new Array(226).fill(0); board[0] = 1; board[1] = 2; board[225] = -1;
  const result = await context.genFinalizeGeneratedResult(
    { board, attacker: 1, nMask: new Uint8Array(225) }, 2,
    { blockOtherVCF: false, balanceStones: true, threeMultiplier: 1 }, { attempts: 1 },
  );
  if (!result?.balanceComplete) throw new Error("balanced result was not finalized directly");
  console.log("Generator finalizer no-op balance tests passed");
})().catch(error => { console.error(error); process.exit(1); });
