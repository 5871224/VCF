from pathlib import Path

layout_path = Path('makevcf-layout.js')
text = layout_path.read_text(encoding='utf-8')

# 1. Replace calculation controls: restore real group switching and keep step playback separate.
start = text.index('  const calcPrevStepButton = document.createElement("button");')
end = text.index('\n\n  let replaySignature = "";', start)
controls = '''  const calcPrevGroupButton = document.createElement("button");
  calcPrevGroupButton.id = "btn-vcf-calc-group-prev";
  calcPrevGroupButton.type = "button";
  calcPrevGroupButton.textContent = "上一組";
  const calcNextGroupButton = document.createElement("button");
  calcNextGroupButton.id = "btn-vcf-calc-group-next";
  calcNextGroupButton.type = "button";
  calcNextGroupButton.textContent = "下一組";
  const calcPrevStepButton = document.createElement("button");
  calcPrevStepButton.id = "btn-vcf-calc-step-prev";
  calcPrevStepButton.type = "button";
  calcPrevStepButton.textContent = "計算上一步";
  const calcNextStepButton = document.createElement("button");
  calcNextStepButton.id = "btn-vcf-calc-step-next";
  calcNextStepButton.type = "button";
  calcNextStepButton.textContent = "計算下一步";
  const calcGroupSelect = document.createElement("select");
  calcGroupSelect.id = "vcf-calculation-group-select";
  calcGroupSelect.setAttribute("aria-label", "VCF 計算組別");
  const calculationGroupRow = document.createElement("div");
  calculationGroupRow.className = "vcf-calculation-group-row";
  const calculationGroupLabel = document.createElement("span");
  calculationGroupLabel.textContent = "計算路線";
  calculationGroupRow.append(calculationGroupLabel, calcGroupSelect);
  const calculationNavigationActions = document.getElementById("vcf-calculation-navigation-actions");
  calculationNavigation.insertBefore(calculationGroupRow, calculationNavigationActions || null);
  calculationNavigationActions?.append(calcPrevGroupButton, calcNextGroupButton, calcPrevStepButton, calcNextStepButton);'''
text = text[:start] + controls + text[end:]

# 2. Replace replay state and shared marker layer with isolated record/calculation state + layers.
start = text.index('  let replaySignature = "";')
end = text.index('  class BinaryReader {', start)
state_block = '''  let calculationDisplay = {
    groups: [],
    groupIndex: 0,
    color: BLACK,
    ply: 0,
  };
  let importedTree = null;

  function renderMarkerLayer(layerId, moves, { stroke, dash = "" } = {}) {
    let layer = board.querySelector(`#${layerId}`);
    if (!layer) {
      layer = document.createElementNS("http://www.w3.org/2000/svg", "g");
      layer.id = layerId;
      layer.setAttribute("pointer-events", "none");
      board.appendChild(layer);
    }
    while (layer.firstChild) layer.firstChild.remove();
    const uniqueMoves = Array.from(new Set(Array.from(moves || [], move => Number(move))))
      .filter(index => Number.isInteger(index) && index >= 0 && index < BOARD_CELLS);
    for (const index of uniqueMoves) {
      const x = index % BOARD_SIZE;
      const y = Math.floor(index / BOARD_SIZE);
      const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      circle.setAttribute("cx", 22 + x * 34);
      circle.setAttribute("cy", 22 + y * 34);
      circle.setAttribute("r", 13);
      circle.setAttribute("fill", "none");
      circle.setAttribute("stroke", stroke);
      circle.setAttribute("stroke-width", "3");
      if (dash) circle.setAttribute("stroke-dasharray", dash);
      circle.setAttribute("vector-effect", "non-scaling-stroke");
      layer.appendChild(circle);
    }
  }

  function renderRecordNextMoveMarkers(moves) {
    renderMarkerLayer("vcf-record-next-move-layer", moves, { stroke: "#1976c9" });
  }

  function renderCalculationNextMoveMarkers(moves) {
    renderMarkerLayer("vcf-calculation-next-move-layer", moves, { stroke: "#d28b00", dash: "5 3" });
  }

  function clearCalculationNextMoveMarkers() {
    renderCalculationNextMoveMarkers([]);
  }

  function currentCalculationRoute() {
    return calculationDisplay.groups[calculationDisplay.groupIndex] || [];
  }

  function calculationGroupsFromEngine() {
    const multi = typeof vcfGroups !== "undefined" && Array.isArray(vcfGroups) && vcfGroups.length
      ? vcfGroups
      : null;
    if (multi) {
      return multi
        .filter(route => route && typeof route.length === "number" && route.length)
        .map(route => Array.from(route, move => Number(move)));
    }
    if (typeof lastVCFMoves !== "undefined" && lastVCFMoves && typeof lastVCFMoves.length === "number" && lastVCFMoves.length) {
      return [Array.from(lastVCFMoves, move => Number(move))];
    }
    return [];
  }

  function resetCalculationDisplay({ clearOverlay = true } = {}) {
    calculationDisplay = { groups: [], groupIndex: 0, color: BLACK, ply: 0 };
    if (clearOverlay) window._clearVCF?.();
    clearCalculationNextMoveMarkers();
    syncCalculationNavigation();
  }

  function captureCalculationResult() {
    const groups = calculationGroupsFromEngine();
    if (!groups.length) {
      resetCalculationDisplay({ clearOverlay: false });
      return false;
    }
    const color = typeof lastVCFColor !== "undefined" ? Number(lastVCFColor) || BLACK : BLACK;
    const engineGroup = typeof vcfGroupIdx !== "undefined" ? Number(vcfGroupIdx) : 0;
    const groupIndex = Math.max(0, Math.min(groups.length - 1, Number.isInteger(engineGroup) ? engineGroup : 0));
    calculationDisplay = {
      groups,
      groupIndex,
      color,
      ply: groups[groupIndex].length,
    };
    syncCalculationNavigation();
    return true;
  }

  function syncCalculationNavigation() {
    const groups = calculationDisplay.groups;
    const route = currentCalculationRoute();
    const hasResult = route.length > 0;
    const badge = document.getElementById("vcf-calculation-badge");
    const state = document.getElementById("vcf-calculation-navigation-state");
    const color = calculationDisplay.color === WHITE ? "白" : "黑";
    calculationNavigation.classList.toggle("is-active", hasResult);
    if (badge) badge.textContent = hasResult ? "展示計算中" : "尚無結果";

    const expectedOptions = groups.length;
    if (calcGroupSelect.options.length !== expectedOptions) {
      calcGroupSelect.replaceChildren();
      groups.forEach((candidate, index) => {
        const option = document.createElement("option");
        option.value = String(index);
        option.textContent = `第 ${index + 1} 組（${candidate.length} 手）`;
        calcGroupSelect.appendChild(option);
      });
    }
    if (hasResult) calcGroupSelect.value = String(calculationDisplay.groupIndex);
    calcGroupSelect.disabled = groups.length <= 1;
    calcPrevGroupButton.disabled = !hasResult || calculationDisplay.groupIndex <= 0;
    calcNextGroupButton.disabled = !hasResult || calculationDisplay.groupIndex >= groups.length - 1;
    calcPrevStepButton.disabled = !hasResult || calculationDisplay.ply <= 0;
    calcNextStepButton.disabled = !hasResult || calculationDisplay.ply >= route.length;

    if (state) {
      state.textContent = hasResult
        ? `${color}方 VCF｜第 ${calculationDisplay.groupIndex + 1}/${groups.length} 組｜第 ${calculationDisplay.ply}/${route.length} 手。橘框棋子只是計算覆蓋層，不會寫入原棋譜。`
        : "VCF 計算完成後，可在這裡獨立逐組、逐手展示；不會改動原棋譜。";
    }
  }

  function renderCalculationDisplay() {
    const route = currentCalculationRoute();
    if (!route.length) {
      window._clearVCF?.();
      clearCalculationNextMoveMarkers();
      syncCalculationNavigation();
      return false;
    }
    const ply = Math.max(0, Math.min(route.length, calculationDisplay.ply));
    calculationDisplay.ply = ply;
    // VCF 計算展示只使用 SVG overlay，不呼叫 _setBoardArr，也不寫入 VCFWorkbenchRecord。
    window._showVCF?.(route.slice(0, ply), calculationDisplay.color);
    renderCalculationNextMoveMarkers(ply < route.length ? [route[ply]] : []);
    syncCalculationNavigation();
    if (typeof setStatus === "function") {
      const color = calculationDisplay.color === WHITE ? "白" : "黑";
      setStatus(`展示計算：${color}方第 ${calculationDisplay.groupIndex + 1}/${calculationDisplay.groups.length} 組，第 ${ply}/${route.length} 手`);
    }
    return true;
  }

  function moveCalculationStep(delta) {
    const route = currentCalculationRoute();
    if (!route.length) return false;
    calculationDisplay.ply = Math.max(0, Math.min(route.length, calculationDisplay.ply + delta));
    return renderCalculationDisplay();
  }

  function switchCalculationGroup(index) {
    const groups = calculationDisplay.groups;
    if (!groups.length) return false;
    const nextIndex = Math.max(0, Math.min(groups.length - 1, Number(index) || 0));
    calculationDisplay.groupIndex = nextIndex;
    calculationDisplay.ply = groups[nextIndex].length;
    // 同步引擎目前組別，讓「單一路線防守」等後續分析仍針對使用者正在看的那一組；
    // setVcfGroup 只改 VCF 計算狀態與 SVG overlay，不會寫入棋譜。
    if (typeof setVcfGroup === "function" && typeof vcfGroups !== "undefined" && Array.isArray(vcfGroups) && vcfGroups.length === groups.length) {
      setVcfGroup(nextIndex);
    }
    return renderCalculationDisplay();
  }

'''
text = text[:start] + state_block + text[end:]

# 3. Record next-move hints always use their own blue layer.
text = text.replace('renderNextMoveMarkers(', 'renderRecordNextMoveMarkers(')

# 4. Remove stale replay resets when loading a record.
text = text.replace('''    replaySignature = "";\n    replayPly = 0;\n''', '', 1)

# 5. Replace calculation handlers with group + step controls using isolated display state.
start = text.index('  calcPrevStepButton.addEventListener("click"')
end = text.index('\n\n  // 原始盤面被手動或其他功能改動時', start)
handlers = '''  calcPrevGroupButton.addEventListener("click", () => switchCalculationGroup(calculationDisplay.groupIndex - 1));
  calcNextGroupButton.addEventListener("click", () => switchCalculationGroup(calculationDisplay.groupIndex + 1));
  calcGroupSelect.addEventListener("change", () => switchCalculationGroup(Number(calcGroupSelect.value)));
  calcPrevStepButton.addEventListener("click", () => moveCalculationStep(-1));
  calcNextStepButton.addEventListener("click", () => moveCalculationStep(1));
  window.addEventListener("vcf-result-changed", event => {
    if (event.detail?.hasResult && captureCalculationResult()) {
      renderCalculationDisplay();
    } else {
      resetCalculationDisplay({ clearOverlay: false });
    }
  });
  syncCalculationNavigation();'''
text = text[:start] + handlers + text[end:]

# 6. Clearing VCF must never discard the record tree. Clearing the whole board may.
old = '''  for (const id of ["btn-clear-vcf", "btn-clear"]) {
    document.getElementById(id)?.addEventListener("click", () => {
      replaySignature = "";
      replayPly = 0;
      importedTree = null;
    });
  }
'''
new = '''  document.getElementById("btn-clear-vcf")?.addEventListener("click", () => {
    resetCalculationDisplay({ clearOverlay: false });
  });
  document.getElementById("btn-clear")?.addEventListener("click", () => {
    resetCalculationDisplay({ clearOverlay: false });
    importedTree = null;
  });
'''
if old not in text:
    raise SystemExit('clear-button replay block not found')
text = text.replace(old, new, 1)

# 7. Correct legacy labels (the hidden legacy controls still represent VCF groups, not branches).
text = text.replace('"btn-vcf-prev": "前一分支"', '"btn-vcf-prev": "上一組"')
text = text.replace('"btn-vcf-next": "後一分支"', '"btn-vcf-next": "下一組"')

# 8. Calculation UI styling: explicit group selector + orange isolated overlay semantics.
css_anchor = '''    .vcf-calculation-title-row {
      display: flex;
      align-items: center;
      gap: 8px;
    }
'''
css_add = css_anchor + '''
    .vcf-calculation-group-row {
      display: flex;
      align-items: center;
      gap: 8px;
      margin: 8px 0;
      color: #6f592c;
      font-size: 12px;
      font-weight: 700;
    }

    .vcf-calculation-group-row select {
      flex: 1;
      min-width: 0;
      min-height: 36px;
      padding: 6px 9px;
      border: 1px solid #c99028;
      border-radius: 7px;
      background: #fffdf6;
      color: #4f3b17;
      font: inherit;
      font-weight: 600;
    }
'''
if css_anchor not in text:
    raise SystemExit('calculation title css anchor not found')
text = text.replace(css_anchor, css_add, 1)

layout_path.write_text(text, encoding='utf-8')

# 9. Bump browser cache versions for both layout and dashboard event producer.
html_path = Path('makevcf.html')
html = html_path.read_text(encoding='utf-8')
html = html.replace('makevcf-layout.js?v=20260913-calc-display', 'makevcf-layout.js?v=20260913-calc-display-v2')
html = html.replace('rapfi/rapfi-bitboard-dashboard.js?v=20260913-calc-display', 'rapfi/rapfi-bitboard-dashboard.js?v=20260913-calc-display-v2')
html_path.write_text(html, encoding='utf-8')

# 10. Update architecture contract for the separated calculation display.
test_path = Path('tests/workbench-architecture.test.js')
test = test_path.read_text(encoding='utf-8')
test = test.replace('''  '\"btn-vcf-prev\": \"前一分支\"',\n  '\"btn-vcf-next\": \"後一分支\"',\n  "route.slice(0, replayPly)",''', '''  '\"btn-vcf-prev\": \"上一組\"',\n  '\"btn-vcf-next\": \"下一組\"',\n  'calcGroupSelect.id = "vcf-calculation-group-select"',\n  "calculationDisplay",\n  "renderRecordNextMoveMarkers",\n  "renderCalculationNextMoveMarkers",\n  "route.slice(0, ply)",''')
insert_after = '''if (layout.includes("MutationObserver") || layout.includes("setInterval(")) {\n  throw new Error("branch replay must not poll or observe the whole page");\n}\n'''
extra = insert_after + '''if (layout.includes("if (currentReplayRoute().length)")) {\n  throw new Error("record navigation must never fall through to VCF calculation playback");\n}\nif (!layout.includes("VCF 計算展示只使用 SVG overlay，不呼叫 _setBoardArr，也不寫入 VCFWorkbenchRecord")) {\n  throw new Error("calculation display isolation contract missing");\n}\n'''
if insert_after not in test:
    raise SystemExit('architecture insertion anchor not found')
test = test.replace(insert_after, extra, 1)
test_path.write_text(test, encoding='utf-8')

print('VCF calculation display isolation patch applied')
