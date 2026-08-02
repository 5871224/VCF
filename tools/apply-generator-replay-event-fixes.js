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

function replaceOneOf(content, variants, label) {
  for (const { from, to, name } of variants) {
    const first = content.indexOf(from);
    if (first < 0) continue;
    if (content.indexOf(from, first + from.length) >= 0) {
      fail(`${label}（${name}）：預期程式區塊出現超過一次`);
    }
    return content.replace(from, to);
  }
  fail(`${label}：找不到舊版或新版的預期程式區塊`);
}

function replaceOnce(content, oldText, newText, label) {
  return replaceOneOf(content, [{ from: oldText, to: newText, name: "標準" }], label);
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

for (const requiredPath of [defensePath, finalBalancePath, progressPath, replayPath]) {
  if (!fs.existsSync(requiredPath)) fail(`缺少必要檔案：${requiredPath}`);
}

function layerBranch(functionName, hasFailedPoint, withReplay) {
  const failedLine = hasFailedPoint
    ? "\n          failedPoints.add(failedKey);"
    : "";
  const oldFailedLine = hasFailedPoint
    ? "\n        if (!genCancelled) failedPoints.add(failedKey);"
    : "";

  if (!withReplay) {
    return `        const next = addLayerDefender(candidate, idx);
        if (!next) continue;
        const result = await ${functionName}(
          next,
          expectedSteps,
          previousResult,
          policy,
          budget,
        );
        if (result) return result;${oldFailedLine}`;
  }

  return `        const next = addLayerDefender(candidate, idx);
        if (!next) continue;
        const replayAttempt = window.genReplayBeginDefenderAttempt?.({
          phase: "mid",
          board: next.board,
          nMask: next.nMask,
          attacker: next.attacker,
          defender: next.defender,
          idx,
        });
        const result = await ${functionName}(
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
          window.genReplayEndDefenderAttempt?.(replayAttempt, false);${failedLine}
        }`;
}

function finalBranch(hasFailedPoint, withReplay) {
  const failedLine = hasFailedPoint
    ? "\n          failedPoints.add(failedKey);"
    : "";
  const oldFailedLine = hasFailedPoint
    ? "\n        if (!genCancelled) failedPoints.add(failedKey);"
    : "";

  if (!withReplay) {
    return `        const added = addFinalDefender(
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
        if (result) return result;${oldFailedLine}`;
  }

  return `        const added = addFinalDefender(
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
          window.genReplayEndDefenderAttempt?.(replayAttempt, false);${failedLine}
        }`;
}

let defense = fs.readFileSync(defensePath, "utf8");
if (!defense.includes('phase: "mid"')) {
  defense = replaceOneOf(
    defense,
    [
      {
        name: "新版多組排序補守",
        from: layerBranch("validateWithRankedDefense", false, false),
        to: layerBranch("validateWithRankedDefense", false, true),
      },
      {
        name: "舊版串流補守",
        from: layerBranch("validateWithStreamingDefense", true, false),
        to: layerBranch("validateWithStreamingDefense", true, true),
      },
    ],
    "中途補守明確事件",
  );
}

if (!defense.includes('phase: "final"')) {
  defense = replaceOneOf(
    defense,
    [
      {
        name: "新版多組最終補守",
        from: finalBranch(false, false),
        to: finalBranch(false, true),
      },
      {
        name: "舊版最終補守",
        from: finalBranch(true, false),
        to: finalBranch(true, true),
      },
    ],
    "最終唯一化明確事件",
  );
}

for (const token of [
  'phase: "mid"',
  'phase: "final"',
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
for (const forbidden of [
  "const defender = genOther(state.attacker);\n      const replayBoard",
  "findTargetAfterFill(\n      board,\n      color,",
]) {
  if (finalBalance.includes(forbidden)) {
    fail(`最終補色仍把補入色當成守方或搜尋方：${forbidden}`);
  }
}
syntaxCheck(finalBalancePath, finalBalance);

let progress = fs.readFileSync(progressPath, "utf8");
if (!progress.includes("stageTitleForAddedStone(color, idx, attacker)")) {
  const inferredTitleFunction = `    function stageTitleForAddedStone(color, idx) {
      const status = currentStageText();
      if (status.includes("封鎖其他完成盤面") || status.includes("只保留目標")) {
        return \`封鎖其他 VCF：補上\${colorName(color)} \${pointName(idx)}\`;
      }
      if (status.includes("補齊黑白子數") || status.includes("補齊子數")) {
        return \`補齊子數：補上\${colorName(color)} \${pointName(idx)}\`;
      }
      return \`補守：補上\${colorName(color)} \${pointName(idx)}\`;
    }`;
  const explicitSideTitleFunction = `    function stageTitleForAddedStone(color, idx, attacker) {
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
  progress = replaceOnce(
    progress,
    inferredTitleFunction,
    explicitSideTitleFunction,
    "取消依狀態文字猜補守名稱",
  );
  progress = replaceOnce(
    progress,
    "title = stageTitleForAddedStone(board[idx], idx);",
    "title = stageTitleForAddedStone(board[idx], idx, attacker);",
    "一般回放傳入明確攻方",
  );
  progress = replaceOnce(
    progress,
    "title = `補上 ${parent.additions.length} 顆棋子後驗證`;",
    "title = `盤面增加 ${parent.additions.length} 顆棋子後驗證`;",
    "多棋差異使用中性名稱",
  );
}
for (const required of [
  "stageTitleForAddedStone(color, idx, attacker)",
  "color === normalizedAttacker",
  "color === genOther(normalizedAttacker)",
]) {
  if (!progress.includes(required)) fail(`一般回放攻守標示缺少：${required}`);
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
  if (replay.includes(forbidden)) {
    fail(`事件式回放仍殘留推測或強制守方邏輯：${forbidden}`);
  }
}
for (const required of [
  "genReplayBeginDefenderAttempt",
  "genReplayEndDefenderAttempt",
  "payload.color ?? payload.defender",
  'phase === "balance"',
  'role === "attacker"',
  "board[idx] !== placedColor",
]) {
  if (!replay.includes(required)) fail(`事件式回放缺少：${required}`);
}
syntaxCheck(replayPath, replay);

console.log("補守與補齊子數回放建置完成：支援新版多組排序補守與舊版串流補守。\n");
