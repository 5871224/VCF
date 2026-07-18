"use strict";

function genPickInitialPlacement(placements) {
  const liveThree = placements.filter(item => item.materialType === "liveThree");
  const deadFour = placements.filter(item => item.materialType === "deadFour");
  const availableGroups = [liveThree, deadFour].filter(group => group.length);
  const selectedGroup = availableGroups[genRand(availableGroups.length)];
  return genWeightedPick(selectedGroup);
}

function genOptions() {
  return {
    reuseBonus: document.getElementById("opt-reuse").checked,
    centerBonus: document.getElementById("opt-center").checked,
  };
}

async function genFindTwoStep(attacker, rules, options, counters, targetSteps) {
  const basePlacements = genBuildBasePlacements(attacker, rules);

  while (!genCancelled) {
    counters.baseRounds++;
    const base = genPickInitialPlacement(basePlacements);
    const candidates = genWeightedOrder(genEnumerateLayerCandidates(base, attacker, rules, options));
    if (!candidates.length) {
      if (counters.baseRounds % 20 === 0) await genTick();
      continue;
    }

    for (const candidate of candidates) {
      if (genCancelled) return null;
      counters.attempts++;
      genSetStatus(
        `正在建立 2/${targetSteps} 步基礎……已驗證 ${counters.attempts} 個候選`
      );
      const result = await genValidateCandidate(candidate);
      if (result) return result;
      if (counters.attempts % 8 === 0) await genTick();
    }
  }
  return null;
}

async function genExtendToTarget(current, targetSteps, attacker, rules, options, counters) {
  if (genCancelled) return null;
  if (current.steps >= targetSteps) return current;

  const nextStep = current.steps + 1;
  const extensionBase = genMakeExtensionBase(current);
  if (!extensionBase.anchorCandidates.length) return null;

  const candidates = genWeightedOrder(
    genEnumerateLayerCandidates(extensionBase, attacker, rules, options)
  );
  if (!candidates.length) return null;

  for (const candidate of candidates) {
    if (genCancelled) return null;
    counters.attempts++;
    genSetStatus(
      `正在延伸到 ${nextStep}/${targetSteps} 步……已驗證 ${counters.attempts} 個候選，重建 ${counters.restarts} 次`
    );

    const next = await genValidateExtensionCandidate(candidate, current, nextStep);
    if (next) {
      const completed = await genExtendToTarget(
        next,
        targetSteps,
        attacker,
        rules,
        options,
        counters
      );
      if (completed) return completed;
    }

    if (counters.attempts % 8 === 0) await genTick();
  }

  return null;
}

function genShowResult(result, targetSteps, attacker, counters) {
  genCurrent = result;
  window.genDraw(genCurrent);

  const root = result.rootBase || result.base;
  const repairedLayers = result.layers.filter(layer => layer.addedDefenders.length > 0).length;
  const latest = result.layers[result.layers.length - 1];
  const latestFive = latest ? genName(latest.fivePoint) : "—";

  genSetStatus(
    `產生成功：${attacker === GEN_BLACK ? "黑" : "白"}方 ${targetSteps} 步 VCF（共驗證 ${counters.attempts} 個候選）`
  );
  genSetDetails(
    `初始${root.patternName}（${root.patternText}）；共反向新增 ${result.layers.length} 層死四，` +
    `永久新增攻子 ${result.totalAddedAttackers} 顆、補守子 ${result.totalAddedDefenders} 顆，` +
    `${repairedLayers} 層曾產生活三並在 X 封閉；最外層 A=${genName(latest.anchor)}，五點=${latestFive}；` +
    `最終多組 VCF 搜尋取得 ${result.groupCount} 組。`
  );
}

async function genGenerate() {
  if (genBusy) return;
  genCancelled = false;
  genCurrent = null;
  genShowAnswer = false;
  genShowNPoints = false;
  document.getElementById("btn-answer").textContent = "顯示答案";
  document.getElementById("btn-npoints").textContent = "顯示 N 點";
  window.genDraw(null);
  genSetDetails("");
  genSetBusy(true);

  const attacker = genGetAttacker();
  const rules = genGetRules();
  const targetSteps = genGetTargetSteps();
  const options = genOptions();
  const counters = { attempts: 0, baseRounds: 0, restarts: 0 };

  try {
    setGameRules(rules);
    await genEngine.setRules(rules);

    while (!genCancelled) {
      counters.restarts++;
      const seed = await genFindTwoStep(attacker, rules, options, counters, targetSteps);
      if (!seed || genCancelled) break;

      const result = targetSteps === 2
        ? seed
        : await genExtendToTarget(seed, targetSteps, attacker, rules, options, counters);

      if (result) {
        genShowResult(result, targetSteps, attacker, counters);
        return;
      }

      genSetStatus(
        `目前基礎無法延伸到 ${targetSteps} 步，正在重新建立……已驗證 ${counters.attempts} 個候選`
      );
      await genTick();
    }

    genSetStatus("已停止產生");
  } catch (error) {
    console.error(error);
    genSetStatus(`產生失敗：${error && error.message ? error.message : String(error)}`);
  } finally {
    genSetBusy(false);
  }
}

function genName(idx) {
  if (idx < 0 || idx >= 225) return "盤外";
  return "ABCDEFGHJKLMNOP"[genX(idx)] + (15 - genY(idx));
}

function genRefreshGenerateLabel() {
  const steps = genGetTargetSteps();
  document.getElementById("btn-generate").textContent = `產生 ${steps} 步 VCF`;
}

document.getElementById("btn-generate").addEventListener("click", genGenerate);
document.getElementById("target-steps").addEventListener("change", genRefreshGenerateLabel);
document.getElementById("target-steps").addEventListener("input", genRefreshGenerateLabel);
document.getElementById("btn-stop").addEventListener("click", async () => {
  if (!genBusy) return;
  genCancelled = true;
  genSetStatus("正在停止……");
  await genEngine.cancel();
});
document.getElementById("btn-answer").addEventListener("click", () => {
  if (!genCurrent) return;
  genShowAnswer = !genShowAnswer;
  document.getElementById("btn-answer").textContent = genShowAnswer ? "隱藏答案" : "顯示答案";
  window.genDraw(genCurrent);
});
document.getElementById("btn-npoints").addEventListener("click", () => {
  if (!genCurrent) return;
  genShowNPoints = !genShowNPoints;
  document.getElementById("btn-npoints").textContent = genShowNPoints ? "隱藏 N 點" : "顯示 N 點";
  window.genDraw(genCurrent);
});

genRefreshGenerateLabel();
genEngine.ready
  .then(() => genSetStatus("就緒，設定步數後按「產生 VCF」開始"))
  .catch(error => genSetStatus(`引擎初始化失敗：${error.message}`));
