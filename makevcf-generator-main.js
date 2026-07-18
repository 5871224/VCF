"use strict";

async function genGenerateTwoStep() {
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
  const options = {
    reuseBonus: document.getElementById("opt-reuse").checked,
    centerBonus: document.getElementById("opt-center").checked,
  };

  try {
    setGameRules(rules);
    await genEngine.setRules(rules);
    const basePlacements = genBuildBasePlacements(attacker);
    let attempts = 0;
    let baseRounds = 0;

    while (!genCancelled) {
      baseRounds++;
      const base = genWeightedPick(basePlacements);
      const candidates = genWeightedOrder(genEnumerateLayerCandidates(base, attacker, rules, options));
      if (!candidates.length) {
        if (baseRounds % 20 === 0) await genTick();
        continue;
      }

      for (const candidate of candidates) {
        if (genCancelled) break;
        attempts++;
        genSetStatus(`正在產生 ${attacker === GEN_BLACK ? "黑" : "白"}方 2 步 VCF……已驗證 ${attempts} 個候選`);
        const result = await genValidateCandidate(candidate);
        if (result) {
          genCurrent = result;
          window.genDraw(genCurrent);
          const addedAttack = result.addedAttackers.length;
          const reused = result.reusedAttackers.length + 1; // 包含 A
          const addedDefense = result.addedDefenders.length;
          genSetStatus(`產生成功：${attacker === GEN_BLACK ? "黑" : "白"}方 2 步 VCF（驗證 ${attempts} 個候選）`);
          genSetDetails(
            `A=${genName(result.anchor)}，五點=${genName(result.fivePoint)}，模板 ${result.templateId}，` +
            `${result.direction.name}${result.sign < 0 ? "反向" : "正向"}；沿用攻子 ${reused} 顆、新增攻子 ${addedAttack} 顆、` +
            `補守子 ${addedDefense} 顆；多組 VCF 搜尋取得 ${result.groupCount} 組。`
          );
          return;
        }
        if (attempts % 8 === 0) await genTick();
      }
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

document.getElementById("btn-generate").addEventListener("click", genGenerateTwoStep);
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

genEngine.ready
  .then(() => genSetStatus("就緒，按「產生 2 步 VCF」開始"))
  .catch(error => genSetStatus(`引擎初始化失敗：${error.message}`));
