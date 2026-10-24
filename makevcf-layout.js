"use strict";

// The final workbench is native HTML; this module owns record import and calculation playback.
(function initVCFWorkbenchControls() {
  const BLACK = 1;
  const board = document.getElementById("board-svg");
  const recordCommentInput = document.getElementById("vcf-record-comment-input");
  const recordCommentMeta = document.getElementById("vcf-record-comment-meta");
  const calculationNavigation = document.getElementById("vcf-calculation-navigation");
  const prevStepButton = document.getElementById("btn-vcf-step-prev");
  const nextStepButton = document.getElementById("btn-vcf-step-next");
  const previousBranchButton = document.getElementById("btn-vcf-branch-prev");
  const nextBranchButton = document.getElementById("btn-vcf-branch-next");
  const calcPrevGroupButton = document.getElementById("btn-vcf-calc-group-prev");
  const calcNextGroupButton = document.getElementById("btn-vcf-calc-group-next");
  const calcPrevStepButton = document.getElementById("btn-vcf-calc-step-prev");
  const calcNextStepButton = document.getElementById("btn-vcf-calc-step-next");
  const calcGroupSelect = document.getElementById("vcf-calculation-group-select");

  let calculationDisplay = {
    groups: [],
    groupIndex: 0,
    color: BLACK,
    ply: 0,
  };

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

  function renderCalculationDisplay({ updateStatus = true } = {}) {
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
    if (updateStatus && typeof setStatus === "function") {
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

  function setCommentEditorValue(value) {
    const next = String(value || "");
    if (recordCommentInput.value !== next) recordCommentInput.value = next;
  }

  function syncCommentEditorFromRecordText(recordText) {
    setCommentEditorValue(recordText || "");
    const workspace = window.VCFWorkbenchRecord?.workspace?.() || {};
    const puzzleSetup = workspace.mode === "puzzle" && workspace.puzzlePhase === "setup";
    recordCommentInput.disabled = !workspace.mode || puzzleSetup;
    recordCommentMeta.textContent = !workspace.mode
      ? "請先選擇打譜模式或題目模式。"
      : puzzleSetup
        ? "完成題目初始盤面後即可加入注釋與盤面標記。"
        : workspace.mode === "puzzle"
          ? "目前盤面注釋；保存於 5DB 棋譜樹。"
          : "目前盤面注釋；保存於 5DB 棋譜樹。";
  }

  function saveCommentEditorValue() {
    if (recordCommentInput.disabled) return;
    const comment = recordCommentInput.value;
    window.VCFWorkbenchRecord?.setCurrentRecordText?.(comment);
    recordCommentMeta.textContent = window.VCFWorkbenchRecord?.workspace?.()?.mode === "puzzle"
      ? "已保存於目前題目盤面。"
      : "已保存於目前 5DB 棋譜節點。";
  }

  recordCommentInput.addEventListener("input", saveCommentEditorValue);
  window.addEventListener("vcf-record-state-changed", event => {
    if (document.activeElement !== recordCommentInput) {
      syncCommentEditorFromRecordText(event.detail?.recordText || "");
    }
    renderRecordNextMoveMarkers(event.detail?.nextMoves || []);
  });
  window.addEventListener("vcf-workspace-mode-changed", () => syncCommentEditorFromRecordText(window.VCFWorkbenchRecord?.currentRecordText?.() || ""));

  function reportRecordImport(format, fileName, nodeCount, currentPly) {
    const text = `${format} ${fileName || "棋譜"}：已載入原始方向的棋譜樹，目前第 ${currentPly} 手，共 ${nodeCount} 個節點`;
    if (typeof setStatus === "function") setStatus(text);
    const quickStatus = document.getElementById("bb-export-status");
    if (quickStatus) quickStatus.textContent = text;
  }

  async function loadRecordBytes(rawBytes, fileName = "棋譜.5db") {
    if (!/\.5db$/i.test(String(fileName || ""))) {
      throw new Error("只接受 5DB 1.0（.5db），不支援舊版棋譜格式");
    }
    const doc = window.FiveDB.decode(rawBytes);
    const loaded = await window.VCFWorkbenchRecord?.import5DBDocument?.(doc);
    if (!loaded) throw new Error("5DB 棋譜無法載入工作台");
    const info = window.FiveDB.validate(doc);
    reportRecordImport("5DB", fileName, info.nodeCount, doc.currentPath.length);
    return { format: "5DB", nodeCount: info.nodeCount, currentPly: doc.currentPath.length };
  }

  async function loadRecordFile(file) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    return loadRecordBytes(bytes, file.name || "棋譜.5db");
  }

  window.VCFRecordImportAPI = {
    loadBytes(bytes, fileName = "雲端棋譜.5db") {
      return loadRecordBytes(bytes, fileName);
    },
  };

  function installRecordImportControls() {
    const input = document.getElementById("bb-import-record-input");
    const button = document.getElementById("bb-import-record");
    button.addEventListener("click", () => input.click());
    input.addEventListener("change", async () => {
      const file = input.files?.[0];
      input.value = "";
      if (!file) return;
      button.disabled = true;
      const quickStatus = document.getElementById("bb-export-status");
      if (quickStatus) quickStatus.textContent = "正在讀取分支棋譜……";
      try {
        await loadRecordFile(file);
      } catch (error) {
        console.error("讀取分支棋譜失敗", error);
        const message = `讀取棋譜失敗：${error?.message || error}`;
        if (typeof setStatus === "function") setStatus(message);
        if (quickStatus) quickStatus.textContent = message;
      } finally {
        button.disabled = false;
      }
    });
  }

  prevStepButton.addEventListener("click", () => {
    if (window.VCFWorkbenchRecord?.navigateStep?.(-1)) return;
    if (typeof setStatus === "function") setStatus("目前已是棋譜起點");
  });
  nextStepButton.addEventListener("click", () => {
    if (window.VCFWorkbenchRecord?.navigateStep?.(1)) return;
    if (typeof setStatus === "function") setStatus("目前沒有下一手");
  });

  previousBranchButton.addEventListener("click", () => {
    if (window.VCFWorkbenchRecord?.navigateBranch?.(-1)) return;
    if (typeof setStatus === "function") setStatus("已停在棋譜起點");
  });
  nextBranchButton.addEventListener("click", () => {
    if (window.VCFWorkbenchRecord?.navigateBranch?.(1)) return;
    if (typeof setStatus === "function") setStatus("已停在棋譜末端");
  });

  calcPrevGroupButton.addEventListener("click", () => switchCalculationGroup(calculationDisplay.groupIndex - 1));
  calcNextGroupButton.addEventListener("click", () => switchCalculationGroup(calculationDisplay.groupIndex + 1));
  calcGroupSelect.addEventListener("change", () => switchCalculationGroup(Number(calcGroupSelect.value)));
  calcPrevStepButton.addEventListener("click", () => moveCalculationStep(-1));
  calcNextStepButton.addEventListener("click", () => moveCalculationStep(1));
  window.addEventListener("vcf-result-changed", event => {
    if (event.detail?.hasResult && captureCalculationResult()) {
      // 搜尋完成後只同步展示面板；保留搜尋本身的耗時、節點與速度完成提示。
      renderCalculationDisplay({ updateStatus: false });
    } else {
      resetCalculationDisplay({ clearOverlay: false });
    }
  });
  syncCalculationNavigation();

  // 棋盤改動後，注釋編輯器只從唯一的 Rapfi workbench record state 重新同步。
  window.addEventListener("vcf-board-changed", () => {
    queueMicrotask(() => syncCommentEditorFromRecordText(window.VCFWorkbenchRecord?.currentRecordText?.() || ""));
  });

  document.getElementById("btn-clear-vcf")?.addEventListener("click", () => {
    resetCalculationDisplay({ clearOverlay: false });
  });
  document.getElementById("btn-clear")?.addEventListener("click", () => {
    resetCalculationDisplay({ clearOverlay: false });
  });

  installRecordImportControls();
})();

(function bindWorkbenchPresentation() {
  const view = document.documentElement.dataset;
  const tabs = Array.from(document.querySelectorAll(".vcf-tab"));
  function activate(key) {
    view.vcfTab = key;
    for (const tab of tabs) {
      const selected = tab.dataset.tab === key;
      tab.setAttribute("aria-selected", String(selected));
      tab.tabIndex = selected ? 0 : -1;
    }
    try { localStorage.setItem("vcf_workspace_tab", key); } catch (_) {}
  }
  for (const tab of tabs) {
    tab.addEventListener("click", () => activate(tab.dataset.tab));
    tab.addEventListener("keydown", event => {
      const index = tabs.indexOf(tab);
      let next;
      if (event.key === "ArrowRight") next = (index + 1) % tabs.length;
      if (event.key === "ArrowLeft") next = (index + tabs.length - 1) % tabs.length;
      if (event.key === "Home") next = 0;
      if (event.key === "End") next = tabs.length - 1;
      if (next === undefined) return;
      event.preventDefault();
      activate(tabs[next].dataset.tab);
      tabs[next].focus();
    });
  }
  activate(view.vcfTab || "calculation");

  for (const kind of ["calculation", "multi"]) {
    const input = document.getElementById(`vcf-show-${kind}-settings`);
    const attribute = kind === "calculation" ? "vcfCalculationSettings" : "vcfMultiSettings";
    input.checked = view[attribute] === "1";
    input.addEventListener("change", () => {
      view[attribute] = input.checked ? "1" : "0";
      try { localStorage.setItem(`vcf_show_${kind}_settings`, view[attribute]); } catch (_) {}
    });
  }

  const ruleBox = document.getElementById("rule-box");
  const ruleSelect = document.getElementById("vcf-rule-select");
  const radios = Array.from(ruleBox.querySelectorAll('input[name="rules"]'));
  ruleSelect.value = radios.find(radio => radio.checked)?.value || "2";
  ruleSelect.addEventListener("change", () => {
    const previous = radios.find(radio => radio.checked)?.value || "2";
    const selected = radios.find(radio => radio.value === ruleSelect.value);
    if (!selected || (typeof searching !== "undefined" && searching)) {
      ruleSelect.value = previous;
      return;
    }
    selected.checked = true;
    selected.dispatchEvent(new Event("change", { bubbles: true }));
  });
  ruleBox.addEventListener("change", () => {
    ruleSelect.value = radios.find(radio => radio.checked)?.value || "2";
  });
  window.addEventListener("vcf-rules-changed", () => {
    ruleSelect.value = radios.find(radio => radio.checked)?.value || "2";
  });

  const fast = document.getElementById("btn-fast-vcf");
  const selectedButton = () => document.getElementById(
    Number(document.querySelector('input[name="acolor"]:checked')?.value) === 2 ? "btn-white" : "btn-black"
  );
  fast.addEventListener("click", () => { if (!selectedButton().disabled) selectedButton().click(); });
  document.querySelectorAll('input[name="acolor"]').forEach(radio => {
    radio.addEventListener("change", () => { fast.disabled = selectedButton().disabled; });
  });
  fast.disabled = selectedButton().disabled;
  window.vcfRegisterBusyHook?.("workbench-presentation", value => {
    for (const id of ["vcf-show-calculation-settings", "vcf-show-multi-settings", "vcf-rule-select", "btn-fast-vcf"]) {
      document.getElementById(id).disabled = Boolean(value);
    }
  });
})();
