"use strict";

const fs = require("fs");
const vm = require("vm");
const board = new Array(226).fill(0); board[0] = 1; board[225] = -1;
const expected = board.slice(); expected[2] = 1;
let searches = 0;
const registrations = {};
const context = {
  console, Array, Set, Map, Uint8Array, Number, Boolean, Math,
  localStorage: { getItem() { return null; } },
  document: { getElementById() { return null; } },
  window: {},
  GEN_NO_BLACK: 1, GEN_NO_WHITE: 2, GEN_EMPTY: 0, GEN_BLACK: 1, GEN_WHITE: 2,
  GEN_LINE_MASK: 31, GEN_FOUR_NOFREE: 8, GEN_FOUR_FREE: 9, GEN_FIVE: 10, GEN_LINE_DOUBLE_FOUR: 24,
  genRegisterOptionProvider: (name, fn) => { registrations[name] = fn; },
  genRegisterBusyHook() {}, genRegisterFindRequestProvider() {},
  genSelectedPruning: () => "fast", genGetActiveOptions: () => ({ blockOtherVCF: false, uniqueSearchSettings: { pruning: "fast", maxNode: 1 } }),
  genCloneBoard: source => source.slice(), genOther: color => 3 - color,
  genCancelled: false, genTargetSearchPly: steps => steps * 2 + 1,
  genBuildExpectedBaseBoard: () => expected.slice(), genBuildExpectedExtendedBoard: () => null,
  genBoardsEqual: (a, b) => a.every((value, index) => value === b[index]),
  genAnalyzeVCFGroup: (_source, moves) => moves[0] === 1
    ? { valid: true, steps: 1, standardBoard: board.slice(), completedBoard: board.slice() }
    : { valid: true, steps: 2, standardBoard: expected.slice(), completedBoard: expected.slice() },
  genEngine: {
    async findVCF(source) {
      searches++;
      return source[10] === 2
        ? { winMoves: [[2]], nodeCount: 2, aborted: false }
        : { winMoves: [[2], [1]], nodeCount: 1, aborted: false };
    },
    async getBlockVCF() { return [10]; },
  },
  genFinalizeValidatedResult: candidate => ({ ...candidate, ok: true, standardBoard: expected.slice(), completedBoard: expected.slice() }),
  genApplyBlockerNPoints: value => value,
  genApplyRouteNPoints: state => state.nMask,
  genIsNFor: () => false, testLineFour: () => 0,
  genBeginStoneAttempt: () => ({}), genEndStoneAttempt() {},
};
context.window = context;
context.globalThis = context;
vm.createContext(context);
vm.runInContext(fs.readFileSync("makevcf-generator-search-policy.js", "utf8"), context);

(async () => {
  const candidate = {
    board: board.slice(), expectedBoard: expected.slice(), nMask: new Uint8Array(225),
    attacker: 1, defender: 2, rules: 2,
    addedAttackers: [], reusedAttackers: [], reusedDefenders: [], removedDefenders: [],
    addedDefenders: [], autoBlockDefenders: [], uniqueBlockDefenders: [], xPoints: [], lineFivePoints: [],
  };
  const result = await context.genValidateBySearchPolicy(candidate, 2, null);
  if (!result?.ok) throw new Error("target candidate was not preserved");
  if (result.board[10] !== 2) throw new Error("shorter route was not blocked");
  if (result.nMask[10] !== 3) throw new Error("blocker was not protected for both sides");
  if (searches !== 2) throw new Error(`expected two validation searches, got ${searches}`);
  console.log("Generator canonical search policy tests passed");
})().catch(error => { console.error(error); process.exit(1); });
