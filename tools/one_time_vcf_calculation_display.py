from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if old not in text:
        raise SystemExit(f"{label} not found")
    return text.replace(old, new, 1)


# 1. Separate record navigation and VCF calculation playback.
p = Path("makevcf-layout.js")
text = p.read_text(encoding="utf-8")

text = replace_once(text, '''  recordNavigation.innerHTML = `
    <div class="vcf-record-navigation-heading">
      <strong>棋譜導覽</strong>
      <span>逐手瀏覽目前 VCF 或已讀取的 Rapfi DB／RenLib 分支棋譜。</span>
    </div>
    <div id="vcf-record-navigation-actions" class="vcf-record-navigation-actions"></div>
  `;
  boardCard.appendChild(recordNavigation);
''', '''  recordNavigation.innerHTML = `
    <div class="vcf-record-navigation-heading">
      <strong>棋譜導覽</strong>
      <span>只控制棋譜本身；VCF 計算結果由下方「展示計算」另外控制。</span>
    </div>
    <div id="vcf-record-navigation-actions" class="vcf-record-navigation-actions"></div>
  `;
  boardCard.appendChild(recordNavigation);

  const calculationNavigation = document.createElement("section");
  calculationNavigation.id = "vcf-calculation-navigation";
  calculationNavigation.className = "vcf-calculation-navigation";
  calculationNavigation.innerHTML = `
    <div class="vcf-calculation-navigation-heading">
      <div class="vcf-calculation-title-row">
        <strong>展示計算</strong>
        <span id="vcf-calculation-badge" class="vcf-calculation-badge">尚無結果</span>
      </div>
      <span id="vcf-calculation-navigation-state">VCF 計算完成後，可在這裡獨立逐手展示計算結果。</span>
    </div>
    <div id="vcf-calculation-navigation-actions" class="vcf-calculation-navigation-actions"></div>
  `;
  boardCard.appendChild(calculationNavigation);
''', "record navigation block")

text = replace_once(text, '''  const recordNavigationActions = document.getElementById("vcf-record-navigation-actions");
  recordNavigationActions?.append(prevStepButton, nextStepButton, previousBranchButton, nextBranchButton);

  let replaySignature = "";
''', '''  const recordNavigationActions = document.getElementById("vcf-record-navigation-actions");
  recordNavigationActions?.append(prevStepButton, nextStepButton, previousBranchButton, nextBranchButton);

  const calcPrevStepButton = document.createElement("button");
  calcPrevStepButton.id = "btn-vcf-calc-step-prev";
  calcPrevStepButton.type = "button";
  calcPrevStepButton.textContent = "計算上一步";
  const calcNextStepButton = document.createElement("button");
  calcNextStepButton.id = "btn-vcf-calc-step-next";
  calcNextStepButton.type = "button";
  calcNextStepButton.textContent = "計算下一步";
  const calcPreviousBranchButton = document.createElement("button");
  calcPreviousBranchButton.id = "btn-vcf-calc-branch-prev";
  calcPreviousBranchButton.type = "button";
  calcPreviousBranchButton.textContent = "前一分岔";
  const calcNextBranchButton = document.createElement("button");
  calcNextBranchButton.id = "btn-vcf-calc-branch-next";
  calcNextBranchButton.type = "button";
  calcNextBranchButton.textContent = "後一分岔";
  const calculationNavigationActions = document.getElementById("vcf-calculation-navigation-actions");
  calculationNavigationActions?.append(calcPrevStepButton, calcNextStepButton, calcPreviousBranchButton, calcNextBranchButton);

  let replaySignature = "";
''', "calculation button block")

text = replace_once(text, '''  function replayStatus(route) {
    const color = typeof lastVCFColor !== "undefined" && Number(lastVCFColor) === 2 ? "白" : "黑";
    const groups = typeof vcfGroups !== "undefined" && Array.isArray(vcfGroups) ? vcfGroups : null;
    const branchText = groups && groups.length
      ? `分支 ${Math.min(groups.length, Number(vcfGroupIdx || 0) + 1)}/${groups.length}`
      : "單一分支";
    const stepText = replayPly === 0 ? "起始盤面" : `第 ${replayPly}/${route.length} 手`;
    if (typeof setStatus === "function") setStatus(`${color}方 ${branchText}，${stepText}`);
  }
''', '''  function syncCalculationNavigation() {
    const route = currentReplayRoute();
    const hasResult = route.length > 0;
    const badge = document.getElementById("vcf-calculation-badge");
    const state = document.getElementById("vcf-calculation-navigation-state");
    const color = typeof lastVCFColor !== "undefined" && Number(lastVCFColor) === 2 ? "白" : "黑";
    const groups = typeof vcfGroups !== "undefined" && Array.isArray(vcfGroups) ? vcfGroups : null;
    const branchText = groups && groups.length
      ? `分支 ${Math.min(groups.length, Number(vcfGroupIdx || 0) + 1)}/${groups.length}`
      : "單一分支";
    calculationNavigation.classList.toggle("is-active", hasResult);
    if (badge) badge.textContent = hasResult ? "展示計算中" : "尚無結果";
    if (state) {
      state.textContent = hasResult
        ? `${color}方 VCF｜${branchText}｜第 ${replayPly}/${route.length} 手；此處只展示計算，不改變棋譜節點。`
        : "VCF 計算完成後，可在這裡獨立逐手展示計算結果。";
    }
    for (const button of [calcPrevStepButton, calcNextStepButton, calcPreviousBranchButton, calcNextBranchButton]) {
      button.disabled = !hasResult;
    }
  }

  function replayStatus(route) {
    const color = typeof lastVCFColor !== "undefined" && Number(lastVCFColor) === 2 ? "白" : "黑";
    const groups = typeof vcfGroups !== "undefined" && Array.isArray(vcfGroups) ? vcfGroups : null;
    const branchText = groups && groups.length
      ? `分支 ${Math.min(groups.length, Number(vcfGroupIdx || 0) + 1)}/${groups.length}`
      : "單一分支";
    const stepText = replayPly === 0 ? "起始盤面" : `第 ${replayPly}/${route.length} 手`;
    syncCalculationNavigation();
    if (typeof setStatus === "function") setStatus(`展示計算：${color}方 ${branchText}，${stepText}`);
  }
''', "calculation status block")

text = replace_once(text, '''  prevStepButton.addEventListener("click", () => {
    if (moveImportedStep(-1)) return;
    if (currentReplayRoute().length) {
      moveVcfReplay(-1);
      return;
    }
    if (window.VCFWorkbenchRecord?.navigateStep?.(-1)) return;
    if (typeof setStatus === "function") setStatus("目前已是棋譜起點");
  });
  nextStepButton.addEventListener("click", () => {
    if (moveImportedStep(1)) return;
    if (currentReplayRoute().length) {
      moveVcfReplay(1);
      return;
    }
    if (window.VCFWorkbenchRecord?.navigateStep?.(1)) return;
    if (typeof setStatus === "function") setStatus("目前沒有下一手");
  });

  previousBranchButton.addEventListener("click", () => {
    if (moveImportedBranch(-1)) return;
    if (currentReplayRoute().length && moveVcfBranch(-1)) return;
    if (window.VCFWorkbenchRecord?.navigateBranch?.(-1)) return;
    if (typeof setStatus === "function") setStatus("已停在棋譜起點");
  });
  nextBranchButton.addEventListener("click", () => {
    if (moveImportedBranch(1)) return;
    if (currentReplayRoute().length && moveVcfBranch(1)) return;
    if (window.VCFWorkbenchRecord?.navigateBranch?.(1)) return;
    if (typeof setStatus === "function") setStatus("已停在棋譜末端");
  });
''', '''  prevStepButton.addEventListener("click", () => {
    if (moveImportedStep(-1)) return;
    if (window.VCFWorkbenchRecord?.navigateStep?.(-1)) return;
    if (typeof setStatus === "function") setStatus("目前已是棋譜起點");
  });
  nextStepButton.addEventListener("click", () => {
    if (moveImportedStep(1)) return;
    if (window.VCFWorkbenchRecord?.navigateStep?.(1)) return;
    if (typeof setStatus === "function") setStatus("目前沒有下一手");
  });

  previousBranchButton.addEventListener("click", () => {
    if (moveImportedBranch(-1)) return;
    if (window.VCFWorkbenchRecord?.navigateBranch?.(-1)) return;
    if (typeof setStatus === "function") setStatus("已停在棋譜起點");
  });
  nextBranchButton.addEventListener("click", () => {
    if (moveImportedBranch(1)) return;
    if (window.VCFWorkbenchRecord?.navigateBranch?.(1)) return;
    if (typeof setStatus === "function") setStatus("已停在棋譜末端");
  });

  calcPrevStepButton.addEventListener("click", () => moveVcfReplay(-1));
  calcNextStepButton.addEventListener("click", () => moveVcfReplay(1));
  calcPreviousBranchButton.addEventListener("click", () => moveVcfBranch(-1));
  calcNextBranchButton.addEventListener("click", () => moveVcfBranch(1));
  window.addEventListener("vcf-result-changed", () => {
    const route = ensureReplayState();
    if (route.length) replayPly = route.length;
    syncCalculationNavigation();
  });
''', "navigation handler block")

text = replace_once(text, '''  for (const container of [mainActions, analysisActions]) {
    container.addEventListener("click", event => {
      const id = event.target?.id || "";
      if (!importedTree || ["btn-vcf-step-prev", "btn-vcf-step-next", "btn-vcf-branch-prev", "btn-vcf-branch-next"].includes(id)) return;
      importedTree = null;
    });
  }

''', '', "imported tree clearing handler")

text = replace_once(text, '''    .vcf-record-navigation {
      width: 100%;
      margin-top: 12px;
      padding: 10px;
      border: 1px solid #d8caa8;
      border-radius: 9px;
      background: #faf6e9;
    }

    .vcf-record-navigation-heading {
''', '''    .vcf-record-navigation,
    .vcf-calculation-navigation {
      width: 100%;
      margin-top: 12px;
      padding: 10px;
      border: 1px solid #d8caa8;
      border-radius: 9px;
      background: #faf6e9;
    }

    .vcf-calculation-navigation {
      border-color: #c8c0ad;
      background: #f5f3ed;
      opacity: .72;
      transition: background .18s ease, border-color .18s ease, box-shadow .18s ease, opacity .18s ease;
    }

    .vcf-calculation-navigation.is-active {
      border-color: #d29a2e;
      background: #fff7df;
      box-shadow: inset 4px 0 0 #d29a2e;
      opacity: 1;
    }

    .vcf-record-navigation-heading,
    .vcf-calculation-navigation-heading {
''', "navigation css")

text = replace_once(text, '''    .vcf-record-navigation-heading span {
      color: var(--vcf-muted);
      font-size: 12px;
      text-align: right;
    }

    .vcf-record-navigation-actions {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 6px;
      width: 100%;
    }
''', '''    .vcf-record-navigation-heading span,
    .vcf-calculation-navigation-heading > span {
      color: var(--vcf-muted);
      font-size: 12px;
      text-align: right;
    }

    .vcf-calculation-title-row {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .vcf-calculation-badge {
      display: inline-flex;
      align-items: center;
      min-height: 24px;
      padding: 2px 8px;
      border-radius: 999px;
      background: #dedad0;
      color: #6f685a;
      font-size: 11px;
      font-weight: 700;
    }

    .vcf-calculation-navigation.is-active .vcf-calculation-badge {
      background: #d29a2e;
      color: #fff;
    }

    .vcf-record-navigation-actions,
    .vcf-calculation-navigation-actions {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 6px;
      width: 100%;
    }
''', "calculation navigation css")

text = replace_once(text, '''    #vcf-record-navigation-actions button {
      min-height: 38px;
      padding: 7px 5px;
      font-size: 13px;
    }
''', '''    #vcf-record-navigation-actions button,
    #vcf-calculation-navigation-actions button {
      min-height: 38px;
      padding: 7px 5px;
      font-size: 13px;
    }

    #vcf-calculation-navigation.is-active #vcf-calculation-navigation-actions button:not(:disabled) {
      border-color: #c99028;
      background: #fffdf6;
    }
''', "calculation button css")

mobile_old = '''      .vcf-record-navigation-heading { align-items: flex-start; flex-direction: column; }
      .vcf-record-navigation-heading span { text-align: left; }
      .vcf-record-navigation-actions { grid-template-columns: repeat(2, minmax(0, 1fr)); }'''
mobile_new = '''      .vcf-record-navigation-heading, .vcf-calculation-navigation-heading { align-items: flex-start; flex-direction: column; }
      .vcf-record-navigation-heading span, .vcf-calculation-navigation-heading > span { text-align: left; }
      .vcf-record-navigation-actions, .vcf-calculation-navigation-actions { grid-template-columns: repeat(2, minmax(0, 1fr)); }'''
text = replace_once(text, mobile_old, mobile_new, "mobile navigation css")

text = replace_once(text, '''  document.addEventListener("DOMContentLoaded", () => {
    document.title = "五子棋工作台";
    installRecordImportControls();
  }, { once: true });
''', '''  syncCalculationNavigation();
  document.addEventListener("DOMContentLoaded", () => {
    document.title = "五子棋工作台";
    installRecordImportControls();
    syncCalculationNavigation();
  }, { once: true });
''', "DOMContentLoaded block")

p.write_text(text, encoding="utf-8")


# 2. Explicit lifecycle event when a VCF result is reset/created.
p = Path("rapfi/rapfi-bitboard-dashboard.js")
text = p.read_text(encoding="utf-8")
anchor = '''  const limitSummary = (timeSeconds, nodeMillions) => {
    const timeText = timeSeconds > 0 ? `${timeSeconds} 秒` : "不限時間";
    const nodeText = nodeMillions > 0 ? `${nodeMillions} 百萬節點` : "不限節點";
    return `${timeText}／${nodeText}`;
  };
'''
text = replace_once(text, anchor, anchor + '''
  const notifyVcfResultChanged = () => {
    const routeLength = lastVCFMoves && typeof lastVCFMoves.length === "number" ? lastVCFMoves.length : 0;
    const groupCount = Array.isArray(vcfGroups) ? vcfGroups.length : 0;
    window.dispatchEvent(new CustomEvent("vcf-result-changed", {
      detail: { hasResult: routeLength > 0, routeLength, groupCount },
    }));
  };
''', "dashboard lifecycle helper")

text = replace_once(text, '''      resetVcfGroups();
      const simplify = Boolean(simplifyCheck.checked);''', '''      resetVcfGroups();
      notifyVcfResultChanged();
      const simplify = Boolean(simplifyCheck.checked);''', "single reset lifecycle")
text = replace_once(text, '''      setBusy(false);
  }

  window.vcfRegisterSearchHandler?.("single"''', '''      setBusy(false);
      notifyVcfResultChanged();
  }

  window.vcfRegisterSearchHandler?.("single"''', "single completion lifecycle")
text = replace_once(text, '''  resetVcfGroups();

  const updateProgress = () => {''', '''  resetVcfGroups();
  notifyVcfResultChanged();

  const updateProgress = () => {''', "multi reset lifecycle")
text = replace_once(text, '''    if (progressTimer) window.clearInterval(progressTimer);
    setBusy(false);
  }
  }
''', '''    if (progressTimer) window.clearInterval(progressTimer);
    setBusy(false);
    notifyVcfResultChanged();
  }
  }
''', "multi completion lifecycle")
p.write_text(text, encoding="utf-8")


# 3. Cache bust changed browser files.
p = Path("makevcf.html")
text = p.read_text(encoding="utf-8")
text = replace_once(text, "makevcf-layout.js?v=20260913-cloud-load-board", "makevcf-layout.js?v=20260913-calc-display", "layout cache tag")
text = replace_once(text, 'rapfi/rapfi-bitboard-dashboard.js"></script>', 'rapfi/rapfi-bitboard-dashboard.js?v=20260913-calc-display"></script>', "dashboard cache tag")
p.write_text(text, encoding="utf-8")


# 4. Product spec.
p = Path("規格書.MD")
text = p.read_text(encoding="utf-8")
anchor = '- 「後一分支」不是切換同層 sibling：操作時至少往下一步，再沿目前選定的下一手一路往後尋找下一個「具有多個次一手」的盤面並停在該盤面；若後續都沒有分岔則停在最後一手。\n'
addition = anchor + '- 「棋譜導覽」與 VCF 計算結果回放必須完全分離：棋譜導覽的上一步、下一步、前一分支、後一分支只控制手動／DB／LIB 棋譜樹，不得因存在 VCF 搜尋結果而改成控制計算路線。\n- VCF 找到結果後，棋盤下方另顯示固定的「展示計算」介面，使用獨立的計算上一步、計算下一步、前一分岔、後一分岔按鈕控制 VCF overlay；介面必須明確標示「展示計算中」，沒有結果時則顯示「尚無結果」並停用按鈕。\n- 執行 VCF 搜尋不得清除、退出或重建目前棋譜樹；VCF 是目前棋譜節點上的分析展示，不是棋譜導覽狀態。\n'
text = replace_once(text, anchor, addition, "spec calculation display")
p.write_text(text, encoding="utf-8")


# 5. Architecture regression contract.
p = Path("tests/workbench-architecture.test.js")
text = p.read_text(encoding="utf-8")
text = replace_once(text, "makevcf-layout.js?v=20260913-cloud-load-board", "makevcf-layout.js?v=20260913-calc-display", "test layout cache tag")
anchor = '''for (const token of [
  'boardCard.appendChild(annotationCard)',
'''
insert = '''for (const token of [
  'calculationNavigation.id = "vcf-calculation-navigation"',
  '<strong>展示計算</strong>',
  'calcPrevStepButton.id = "btn-vcf-calc-step-prev"',
  'calcNextStepButton.id = "btn-vcf-calc-step-next"',
  'calcPreviousBranchButton.id = "btn-vcf-calc-branch-prev"',
  'calcNextBranchButton.id = "btn-vcf-calc-branch-next"',
  'window.addEventListener("vcf-result-changed"',
  'calculationNavigation.classList.toggle("is-active", hasResult)',
]) if (!layout.includes(token)) throw new Error(`calculation display contract missing: ${token}`);
if (layout.includes('if (currentReplayRoute().length) {\\n      moveVcfReplay(-1)')) {
  throw new Error("record previous-step button still delegates to VCF calculation replay");
}
if (layout.includes('if (currentReplayRoute().length && moveVcfBranch(-1)) return;')) {
  throw new Error("record branch button still delegates to VCF calculation replay");
}
if (layout.includes('if (!importedTree || ["btn-vcf-step-prev"')) {
  throw new Error("VCF analysis actions still clear imported record state");
}
const dashboardResultLifecycle = read("rapfi/rapfi-bitboard-dashboard.js");
for (const token of [
  'const notifyVcfResultChanged = () =>',
  'new CustomEvent("vcf-result-changed"',
  'notifyVcfResultChanged();',
]) if (!dashboardResultLifecycle.includes(token)) throw new Error(`VCF result lifecycle contract missing: ${token}`);
const calculationEntry = read("makevcf.html");
if (!calculationEntry.includes('makevcf-layout.js?v=20260913-calc-display')
    || !calculationEntry.includes('rapfi/rapfi-bitboard-dashboard.js?v=20260913-calc-display')) {
  throw new Error("calculation display scripts must be cache-busted");
}

for (const token of [
  'boardCard.appendChild(annotationCard)',
'''
text = replace_once(text, anchor, insert, "test calculation contract")
p.write_text(text, encoding="utf-8")
