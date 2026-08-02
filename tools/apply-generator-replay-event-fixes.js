const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const defensePath = "makevcf-generator-defense-points.js";
const finalBalancePath = "makevcf-generator-extension-other-vcf-fix.js";
const progressPath = "makevcf-generator-progress.js";
const replayPath = "makevcf-generator-replay-stone-attempts.js";

function fail(message) {
  throw new Error(`[補子回放事件建置] ${message}`);
}

function replaceOnce(content, oldText, newText, label) {
  const first = content.indexOf(oldText);
  if (first < 0) fail(`${label}：找不到目前多組補守的預期程式區塊`);
  if (content.indexOf(oldText, first + oldText.length) >= 0) {
    fail(`${label}：預期程式區塊出現超過一次`);
  }
  return content.replace(oldText, newText);
}

function syntaxCheck(filename, content) {
  const safeName = String(filename).replace(/[\\/]/g, "_");
  const temporaryPath = path.join(os.tmpdir(), safeName);
  fs.writeFileSync(temporaryPath, content, "utf8");
  const result = spawnSync(process.execPath, ["--check", temporaryPath], {
    encoding: "utf8",
    stdio: "pipe",
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.status !== 0) fail(`${filename} JavaScript 語法檢查失敗`);
}

for (const requiredPath of [defensePath, finalBalancePath, progressPath, replayPath]) {
  if (!fs.existsSync(requiredPath)) fail(`缺少必要檔案：${requiredPath}`);
}

let defense = fs.readFileSync(defensePath, "utf8");

if (!defense.includes('phase: "mid"')) {
  const before = `        const next = addLayerDefender(candidate, idx);
        if (!next) continue;
        const result = await validateWithRankedDefense(
          next,
          expectedSteps,
          previousResult,
          policy,
          budget,
        );
        if (result) return result;`;
  const after = `        const next = addLayerDefender(candidate, idx);
        if (!next) continue;
        const replayAttempt = window.genReplayBeginDefenderAttempt?.({
          phase: "mid",
          board: next.board,
          nMask: next.nMask,
          attacker: next.attacker,
          defender: next.defender,
          idx,
        });
        const result = await validateWithRankedDefense(
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
        }`;
  defense = replaceOnce(defense, before, after, "中途補守明確事件");
}

if (!defense.includes('phase: "final"')) {
  const before = `        const added = addFinalDefender(state, expectedBoard, idx);
        if (!added) continue;
        const result = await cleanFinalTargetBoard(
          added.state,
          added.expectedBoard,
          targetSteps,
          budget,
        );
        if (result) return result;`;
  const after = `        const added = addFinalDefender(state, expectedBoard, idx);
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
        }`;
  defense = replaceOnce(defense, before, after, "最終唯一化明確事件");
}

for (const token of [
  'phase: "mid"',
  'phase: "final"',
  "validateWithRankedDefense(",
  "genReplayBeginDefenderAttempt",
  "genReplayEndDefenderAttempt",
]) {
  if (!defense.includes(token)) fail(`補守事件缺少：${token}`);
}
syntaxCheck(defensePath, defense);
fs.writeFileSync(defensePath, defense, "utf8");

const finalBalance = fs.readFileSync(finalBalancePath, "utf8");
for (const token of [
  'phase: "balance"',
  "replayBoard[idx] = color",
  "attacker: state.attacker",
  "color,",
  "findTargetAfterFill(",
  "filledAttackerStone",
  "新增其他攻方 VCF",
]) {
  if (!finalBalance.includes(token)) fail(`最終補色驗證缺少：${token}`);
}
syntaxCheck(finalBalancePath, finalBalance);

let progress = fs.readFileSync(progressPath, "utf8");
if (!progress.includes("stageTitleForAddedStone(color, idx, attacker)")) {
  const oldFunction = `    function stageTitleForAddedStone(color, idx) {
      const status = currentStageText();
      if (status.includes("封鎖其他完成盤面") || status.includes("只保留目標")) {
        return \`封鎖其他 VCF：補上\${colorName(color)} \${pointName(idx)}\`;
      }
      if (status.includes("補齊黑白子數") || status.includes("補齊子數")) {
        return \`補齊子數：補上\${colorName(color)} \${pointName(idx)}\`;
      }
      return \`補守：補上\${colorName(color)} \${pointName(idx)}\`;
    }`;
  const newFunction = `    function stageTitleForAddedStone(color, idx, attacker) {
      const normalizedAttacker = Number(attacker) === GEN_WHITE
        ? GEN_WHITE
        : GEN_BLACK;
      if (color === normalizedAttacker) {
        return \`攻方\${colorName(color)} \${pointName(idx)} 加入後驗證\`;
      }
      if (color === genOther(normalizedAttacker)) {
        return \`守方\${colorName(color)} \${pointName(idx)} 加入後驗證\`;
      }
      return \`棋子 \${pointName(idx)} 加入後驗證\`;
    }`;
  progress = replaceOnce(progress, oldFunction, newFunction, "明確攻守方標題");
  progress = replaceOnce(
    progress,
    "title = stageTitleForAddedStone(board[idx], idx);",
    "title = stageTitleForAddedStone(board[idx], idx, attacker);",
    "一般回放傳入攻方",
  );
  progress = progress.replace(
    "title = `補上 ${parent.additions.length} 顆棋子後驗證`;",
    "title = `盤面增加 ${parent.additions.length} 顆棋子後驗證`;",
  );
}
for (const token of [
  "stageTitleForAddedStone(color, idx, attacker)",
  "color === normalizedAttacker",
  "color === genOther(normalizedAttacker)",
]) {
  if (!progress.includes(token)) fail(`一般回放攻守標示缺少：${token}`);
}
syntaxCheck(progressPath, progress);
fs.writeFileSync(progressPath, progress, "utf8");

const replay = fs.readFileSync(replayPath, "utf8");
for (const forbidden of [
  "Worker.prototype.postMessage",
  "genEngine.findVCF =",
  "MAX_KNOWN_BOARDS",
  "findOneStoneParent",
  "defender !== expectedDefender",
]) {
  if (replay.includes(forbidden)) fail(`事件式回放仍殘留推測邏輯：${forbidden}`);
}
for (const token of [
  "genReplayBeginDefenderAttempt",
  "genReplayEndDefenderAttempt",
  "payload.color ?? payload.defender",
  'phase === "balance"',
  'role === "attacker"',
  "board[idx] !== placedColor",
]) {
  if (!replay.includes(token)) fail(`事件式回放缺少：${token}`);
}
syntaxCheck(replayPath, replay);

console.log("補守與補齊子數回放建置完成：已對齊目前多組排序補守。\n");
