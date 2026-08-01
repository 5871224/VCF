const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const defensePath = "makevcf-generator-defense-points.js";
const balancePath = "makevcf-generator-balance.js";
const replayPath = "makevcf-generator-replay-stone-attempts.js";

function fail(message) {
  throw new Error(`[補守回放事件建置] ${message}`);
}

function replaceOnce(content, oldText, newText, label) {
  const first = content.indexOf(oldText);
  if (first < 0) fail(`${label}：找不到預期程式區塊`);
  if (content.indexOf(oldText, first + oldText.length) >= 0) {
    fail(`${label}：預期程式區塊出現超過一次`);
  }
  return content.replace(oldText, newText);
}

function syntaxCheck(filename, content) {
  const temporaryPath = path.join(os.tmpdir(), filename);
  fs.writeFileSync(temporaryPath, content, "utf8");
  const result = spawnSync(process.execPath, ["--check", temporaryPath], {
    encoding: "utf8",
    stdio: "pipe",
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.status !== 0) fail(`${filename} JavaScript 語法檢查失敗`);
}

for (const requiredPath of [defensePath, balancePath, replayPath]) {
  if (!fs.existsSync(requiredPath)) fail(`缺少必要檔案：${requiredPath}`);
}

let defense = fs.readFileSync(defensePath, "utf8");
const layerBranch = `        const next = addLayerDefender(candidate, idx);
        if (!next) continue;
        const result = await validateWithStreamingDefense(
          next,
          expectedSteps,
          previousResult,
          policy,
          budget,
        );
        if (result) return result;
        if (!genCancelled) failedPoints.add(idx);`;
const layerBranchWithReplay = `        const next = addLayerDefender(candidate, idx);
        if (!next) continue;
        const replayAttempt = window.genReplayBeginDefenderAttempt?.({
          phase: "mid",
          board: next.board,
          nMask: next.nMask,
          attacker: next.attacker,
          defender: next.defender,
          idx,
        });
        const result = await validateWithStreamingDefense(
          next,
          expectedSteps,
          previousResult,
          policy,
          budget,
        );
        if (result) {
          window.genReplayEndDefenderAttempt?.(replayAttempt, true);
          return result;
        }
        if (!genCancelled) {
          window.genReplayEndDefenderAttempt?.(replayAttempt, false);
          failedPoints.add(idx);
        }`;
defense = replaceOnce(
  defense,
  layerBranch,
  layerBranchWithReplay,
  "中途補守明確事件",
);

const finalBranch = `        const added = addFinalDefender(
          state,
          expectedBoard,
          idx,
        );
        if (!added) continue;
        const result = await cleanFinalTargetBoard(
          added.state,
          added.expectedBoard,
          targetSteps,
          budget,
        );
        if (result) return result;
        if (!genCancelled) failedPoints.add(idx);`;
const finalBranchWithReplay = `        const added = addFinalDefender(
          state,
          expectedBoard,
          idx,
        );
        if (!added) continue;
        const replayAttempt = window.genReplayBeginDefenderAttempt?.({
          phase: "final",
          board: added.state.board,
          nMask: added.state.nMask,
          attacker: added.state.attacker,
          defender: added.state.defender,
          idx,
        });
        const result = await cleanFinalTargetBoard(
          added.state,
          added.expectedBoard,
          targetSteps,
          budget,
        );
        if (result) {
          window.genReplayEndDefenderAttempt?.(replayAttempt, true);
          return result;
        }
        if (!genCancelled) {
          window.genReplayEndDefenderAttempt?.(replayAttempt, false);
          failedPoints.add(idx);
        }`;
defense = replaceOnce(
  defense,
  finalBranch,
  finalBranchWithReplay,
  "最終唯一化明確事件",
);

for (const token of [
  'phase: "mid"',
  'phase: "final"',
  "genReplayBeginDefenderAttempt",
  "genReplayEndDefenderAttempt",
]) {
  if (!defense.includes(token)) fail(`補守事件缺少：${token}`);
}
syntaxCheck("makevcf-generator-defense-points.js", defense);
fs.writeFileSync(defensePath, defense, "utf8");

let balance = fs.readFileSync(balancePath, "utf8");
const autoBlockBranch = `      const next = addDefenderToCandidate(candidate, idx);
      if (!next) continue;
      const result = await validateWithAutoBlock(next, expectedSteps, previousResult, options, budget);
      if (result) return result;
      if (!genCancelled) failedPoints.add(idx);`;
const autoBlockBranchWithReplay = `      const next = addDefenderToCandidate(candidate, idx);
      if (!next) continue;
      const replayAttempt = window.genReplayBeginDefenderAttempt?.({
        phase: "mid",
        board: next.board,
        nMask: next.nMask,
        attacker: next.attacker,
        defender: next.defender,
        idx,
      });
      const result = await validateWithAutoBlock(next, expectedSteps, previousResult, options, budget);
      if (result) {
        window.genReplayEndDefenderAttempt?.(replayAttempt, true);
        return result;
      }
      if (!genCancelled) {
        window.genReplayEndDefenderAttempt?.(replayAttempt, false);
        failedPoints.add(idx);
      }`;
balance = replaceOnce(
  balance,
  autoBlockBranch,
  autoBlockBranchWithReplay,
  "舊較短 VCF 補守明確事件",
);

const fillBranch = `      const next = await validateFilledState(state, item.idx, targetSteps);
      if (!next) {
        failedPoints.add(item.idx);
        continue;
      }
      const completed = await fillDefendersRecursive(next, pool, targetSteps, remaining - 1, budget);
      if (completed) return completed;
      if (!genCancelled) failedPoints.add(item.idx);`;
const fillBranchWithReplay = `      const defender = genOther(state.attacker);
      const replayBoard = genCloneBoard(state.board);
      replayBoard[item.idx] = defender;
      const replayAttempt = window.genReplayBeginDefenderAttempt?.({
        phase: "balance",
        board: replayBoard,
        nMask: state.nMask,
        attacker: state.attacker,
        defender,
        idx: item.idx,
      });
      const next = await validateFilledState(state, item.idx, targetSteps);
      if (!next) {
        window.genReplayEndDefenderAttempt?.(replayAttempt, false);
        failedPoints.add(item.idx);
        continue;
      }
      const completed = await fillDefendersRecursive(next, pool, targetSteps, remaining - 1, budget);
      if (completed) {
        window.genReplayEndDefenderAttempt?.(replayAttempt, true);
        return completed;
      }
      if (!genCancelled) {
        window.genReplayEndDefenderAttempt?.(replayAttempt, false);
        failedPoints.add(item.idx);
      }`;
balance = replaceOnce(
  balance,
  fillBranch,
  fillBranchWithReplay,
  "補齊黑白子數明確事件",
);

for (const token of [
  'phase: "balance"',
  "replayBoard[item.idx] = defender",
  "genReplayBeginDefenderAttempt",
  "genReplayEndDefenderAttempt",
]) {
  if (!balance.includes(token)) fail(`補齊事件缺少：${token}`);
}
syntaxCheck("makevcf-generator-balance.js", balance);
fs.writeFileSync(balancePath, balance, "utf8");

const replay = fs.readFileSync(replayPath, "utf8");
for (const forbidden of [
  "Worker.prototype.postMessage",
  "genEngine.findVCF =",
  "MAX_KNOWN_BOARDS",
  "findOneStoneParent",
]) {
  if (replay.includes(forbidden)) {
    fail(`事件式回放仍殘留推測邏輯：${forbidden}`);
  }
}
for (const required of [
  "genReplayBeginDefenderAttempt",
  "genReplayEndDefenderAttempt",
  "defender !== expectedDefender",
  "board[idx] !== defender",
]) {
  if (!replay.includes(required)) fail(`事件式回放缺少：${required}`);
}
syntaxCheck("makevcf-generator-replay-stone-attempts.js", replay);

console.log("補守回放已改為由實際補子分支送出明確攻守事件。\n");
