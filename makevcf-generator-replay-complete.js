"use strict";

// Extend the generator replay with the initial material boards and direct first/last navigation.
(function scheduleCompleteGeneratorReplay() {
  function installCompleteGeneratorReplay() {
    if (window.__generatorCompleteReplayInstalled) return;
    if (!window.__generatorValidationReplayInstalled) {
      window.setTimeout(installCompleteGeneratorReplay, 0);
      return;
    }
    window.__generatorCompleteReplayInstalled = true;

    const originalSetBusy = genSetBusy;
    const originalPickInitialPlacement = genPickInitialPlacement;
    const originalBuildLayerCandidates = genBuildLayerCandidates;
    const originalValidateCandidate = genValidateCandidate;
    const originalValidateExtensionCandidate = genValidateExtensionCandidate;
    const originalShowResult = genShowResult;

    let timeline = [];
    let forbiddenKeys = new Set();
    let combinedSteps = [];
    let combinedIndex = -1;
    let combinedElements = null;
    let lastRenderedBoard = null;
    let lastRenderedAttacker = GEN_BLACK;
    let finalNMask = new Uint8Array(225);
    let finalSignature = "";

    function cloneBoard(board) {
      const copy = Array.from(board || []).slice(0, 226);
      while (copy.length < 225) copy.push(GEN_EMPTY);
      copy.length = 226;
      copy[225] = -1;
      return copy;
    }

    function cloneNMask(nMask) {
      const copy = new Uint8Array(225);
      const source = nMask instanceof Uint8Array ? nMask : Uint8Array.from(nMask || []);
      copy.set(source.subarray(0, 225));
      return copy;
    }

    function boardSignature(board) {
      let signature = "";
      for (let idx = 0; idx < 225; idx++) {
        signature += board?.[idx] === GEN_BLACK
          ? "1"
          : board?.[idx] === GEN_WHITE
            ? "2"
            : "0";
      }
      return signature;
    }

    function pointName(idx) {
      if (typeof genName === "function") return genName(idx);
      if (idx < 0 || idx >= 225) return "盤外";
      return "ABCDEFGHJKLMNOP"[idx % 15] + (15 - Math.floor(idx / 15));
    }

    function renderNPoints(nMask) {
      const layer = document.getElementById("generator-n-layer");
      if (!layer) return;
      while (layer.firstChild) layer.firstChild.remove();

      const ns = "http://www.w3.org/2000/svg";
      const bothMask = GEN_NO_BLACK | GEN_NO_WHITE;
      const maskArray = cloneNMask(nMask);
      const markSize = 13;

      for (let idx = 0; idx < 225; idx++) {
        const mask = maskArray[idx] & bothMask;
        if (!mask) continue;
        const both = mask === bothMask;
        const cx = 22 + (idx % 15) * 34;
        const cy = 22 + Math.floor(idx / 15) * 34;
        const rect = document.createElementNS(ns, "rect");
        rect.setAttribute("x", cx - markSize / 2);
        rect.setAttribute("y", cy - markSize / 2);
        rect.setAttribute("width", markSize);
        rect.setAttribute("height", markSize);
        rect.setAttribute("rx", 2);
        rect.setAttribute("fill", both ? "#2e9f45" : (mask & GEN_NO_BLACK) ? "#222" : "#f8f8f8");
        rect.setAttribute("stroke", both ? "#176729" : "#d02020");
        rect.setAttribute("stroke-width", 2);
        rect.setAttribute("opacity", .92);
        const title = document.createElementNS(ns, "title");
        title.textContent = both ? "雙方 N 點" : (mask & GEN_NO_BLACK) ? "黑方 N 點" : "白方 N 點";
        rect.appendChild(title);
        layer.appendChild(rect);
      }
    }

    function installBoardCapture() {
      const current = window._setBoardArr;
      if (typeof current !== "function" || current.__completeReplayCapture) return;

      function capturedSetBoardArr(board, attacker) {
        lastRenderedBoard = cloneBoard(board);
        lastRenderedAttacker = attacker || GEN_BLACK;
        return current.apply(this, arguments);
      }
      capturedSetBoardArr.__completeReplayCapture = true;
      window._setBoardArr = capturedSetBoardArr;
    }

    function addInitialEvent(record) {
      if (!record?.board) return;
      timeline.push({
        type: "initial",
        step: {
          board: cloneBoard(record.board),
          nMask: cloneNMask(record.nMask),
          attacker: record.attacker || GEN_BLACK,
          status: "info",
          title: record.title || "建立初始盤面",
          reason: record.reason || "初始盤面已建立，接著產生死四候選並驗證",
          detail: record.detail || "",
          signature: boardSignature(record.board),
        },
      });
    }

    function addCandidateEvent(candidate) {
      if (!candidate?.board) return;
      timeline.push({
        type: "candidate",
        signature: boardSignature(candidate.board),
        nMask: cloneNMask(candidate.nMask),
      });
    }

    function recordForbiddenBase(candidate) {
      if (!candidate?.captureForbidden && candidate?.materialType !== "forbiddenCapture") return;
      const source = candidate.base || candidate.rootBase || candidate;
      const board = cloneBoard(source.board || candidate.board);
      const anchor = Number(candidate.anchor ?? source.anchorCandidates?.[0]);
      if (anchor >= 0 && anchor < 225 && board[anchor] === GEN_WHITE) {
        board[anchor] = GEN_EMPTY;
      }

      const kind = candidate.forbiddenKind || source.forbiddenKind || "forbidden";
      const label = candidate.forbiddenLabel || source.forbiddenLabel || "禁手";
      const forbiddenPoint = Number(candidate.forbiddenPoint ?? source.forbiddenPoint);
      const patternText = candidate.forbiddenPatternText || source.patternText || "";
      const key = `${kind}|${forbiddenPoint}|${patternText}|${boardSignature(board)}`;
      if (forbiddenKeys.has(key)) return;
      forbiddenKeys.add(key);

      addInitialEvent({
        board,
        nMask: source.nMask || candidate.nMask,
        attacker: GEN_WHITE,
        title: `建立禁手骨架（${label}）`,
        reason: "黑棋禁手骨架已建立，接著套入白棋死四",
        detail: [
          Number.isInteger(forbiddenPoint) ? `A=${pointName(forbiddenPoint)}` : "",
          patternText,
        ].filter(Boolean).join("；"),
      });
    }

    genPickInitialPlacement = function pickInitialPlacementWithReplay(placements) {
      const base = originalPickInitialPlacement(placements);
      if (genBusy && base?.board) {
        const label = base.materialType === "deadFour" ? "死四" : "活三";
        addInitialEvent({
          board: base.board,
          nMask: base.nMask,
          attacker: base.attacker || genGetAttacker(),
          title: `建立初始${label}`,
          reason: `已選中${label}材料，接著嘗試加入第一層死四`,
          detail: [base.patternName, base.patternText].filter(Boolean).join("；"),
        });
      }
      return base;
    };

    genBuildLayerCandidates = function buildLayerCandidatesWithForbiddenReplay(...args) {
      const base = args[0];
      if (genBusy && base?.materialType === "forbiddenCapture") {
        recordForbiddenBase(base);
      }
      return originalBuildLayerCandidates(...args);
    };

    genValidateCandidate = async function validateCandidateWithCompleteReplay(candidate, expectedSteps) {
      if (genBusy) {
        recordForbiddenBase(candidate);
        addCandidateEvent(candidate);
      }
      return originalValidateCandidate(candidate, expectedSteps);
    };

    genValidateExtensionCandidate = async function validateExtensionWithCompleteReplay(
      candidate,
      previousResult,
      targetSteps,
    ) {
      if (genBusy) addCandidateEvent(candidate);
      return originalValidateExtensionCandidate(candidate, previousResult, targetSteps);
    };

    genShowResult = function showResultWithCompleteReplayNPoints(
      result,
      targetSteps,
      attacker,
      counters,
      options,
    ) {
      finalNMask = cloneNMask(result?.nMask);
      finalSignature = result?.board ? boardSignature(result.board) : "";
      return originalShowResult(result, targetSteps, attacker, counters, options);
    };

    function ensureCombinedUI() {
      if (combinedElements) return combinedElements;
      const oldPanel = document.getElementById("gen-replay-panel");
      const status = genEl("status");
      const parent = oldPanel?.parentNode || status?.parentNode;
      if (!parent) return null;

      const style = document.createElement("style");
      style.dataset.generatorCompleteReplayStyle = "true";
      style.textContent = `
        #gen-replay-combined-panel .gen-replay-toolbar button {
          min-width: 68px;
        }
        @media (max-width: 560px) {
          #gen-replay-combined-panel .gen-replay-toolbar button {
            min-width: 62px;
            padding-left: 9px;
            padding-right: 9px;
          }
        }
      `;
      document.head.appendChild(style);

      const panel = document.createElement("section");
      panel.id = "gen-replay-combined-panel";
      panel.className = "gen-replay-panel";
      panel.hidden = true;
      panel.innerHTML = `
        <div class="gen-replay-toolbar">
          <button id="gen-replay-combined-first" type="button">最前</button>
          <button id="gen-replay-combined-prev" type="button">上一步</button>
          <span id="gen-replay-combined-count" class="gen-replay-count">0 / 0</span>
          <button id="gen-replay-combined-next" type="button">下一步</button>
          <button id="gen-replay-combined-last" type="button">最後</button>
        </div>
        <div class="gen-replay-summary">
          <span id="gen-replay-combined-badge" class="gen-replay-badge" data-status="info">紀錄</span>
          <span id="gen-replay-combined-title" class="gen-replay-title"></span>
        </div>
        <div id="gen-replay-combined-reason" class="gen-replay-reason"></div>
      `;
      if (oldPanel?.nextSibling) parent.insertBefore(panel, oldPanel.nextSibling);
      else if (oldPanel) parent.appendChild(panel);
      else if (status?.nextSibling) parent.insertBefore(panel, status.nextSibling);
      else parent.appendChild(panel);

      combinedElements = {
        panel,
        first: panel.querySelector("#gen-replay-combined-first"),
        prev: panel.querySelector("#gen-replay-combined-prev"),
        next: panel.querySelector("#gen-replay-combined-next"),
        last: panel.querySelector("#gen-replay-combined-last"),
        count: panel.querySelector("#gen-replay-combined-count"),
        badge: panel.querySelector("#gen-replay-combined-badge"),
        title: panel.querySelector("#gen-replay-combined-title"),
        reason: panel.querySelector("#gen-replay-combined-reason"),
      };
      combinedElements.first.addEventListener("click", () => showCombinedStep(0));
      combinedElements.prev.addEventListener("click", () => showCombinedStep(combinedIndex - 1));
      combinedElements.next.addEventListener("click", () => showCombinedStep(combinedIndex + 1));
      combinedElements.last.addEventListener("click", () => showCombinedStep(combinedSteps.length - 1));
      return combinedElements;
    }

    function statusLabel(status) {
      if (status === "passed") return "通過";
      if (status === "failed") return "未通過";
      if (status === "pending") return "驗證中";
      return "紀錄";
    }

    function showCombinedStep(index) {
      const elements = ensureCombinedUI();
      if (!elements || !combinedSteps.length || genBusy) return;
      combinedIndex = Math.max(0, Math.min(combinedSteps.length - 1, index));
      const step = combinedSteps[combinedIndex];
      const atFirst = combinedIndex <= 0;
      const atLast = combinedIndex >= combinedSteps.length - 1;

      elements.panel.hidden = false;
      elements.count.textContent = `${combinedIndex + 1} / ${combinedSteps.length}`;
      elements.first.disabled = atFirst;
      elements.prev.disabled = atFirst;
      elements.next.disabled = atLast;
      elements.last.disabled = atLast;
      elements.badge.dataset.status = step.status || "info";
      elements.badge.textContent = statusLabel(step.status);
      elements.title.textContent = step.title || "盤面紀錄";
      elements.reason.textContent = [step.reason, step.detail].filter(Boolean).join("；");

      installBoardCapture();
      if (typeof window._setBoardArr === "function") {
        window._setBoardArr(cloneBoard(step.board), step.attacker || GEN_BLACK);
      }
      renderNPoints(step.nMask);
    }

    function captureOldStep(oldPanel) {
      let board = lastRenderedBoard;
      if (!board && typeof window._getArr === "function") board = window._getArr();
      if (!board) return null;

      const badge = oldPanel.querySelector("#gen-replay-badge");
      const title = oldPanel.querySelector("#gen-replay-title")?.textContent || "盤面紀錄";
      const reason = oldPanel.querySelector("#gen-replay-reason")?.textContent || "";
      return {
        board: cloneBoard(board),
        attacker: lastRenderedAttacker || genGetAttacker(),
        status: badge?.dataset?.status || "info",
        title,
        reason,
        detail: "",
        signature: boardSignature(board),
      };
    }

    function harvestOldReplay() {
      installBoardCapture();
      const oldPanel = document.getElementById("gen-replay-panel");
      if (!oldPanel) return [];
      const prev = oldPanel.querySelector("#gen-replay-prev");
      const next = oldPanel.querySelector("#gen-replay-next");
      if (!prev || !next) return [];

      let guard = 0;
      while (!prev.disabled && guard++ < 100000) prev.click();

      const records = [];
      guard = 0;
      while (guard++ < 100000) {
        const record = captureOldStep(oldPanel);
        if (record) records.push(record);
        if (next.disabled) break;
        next.click();
      }
      oldPanel.hidden = true;
      return records;
    }

    function candidateStartIndexes(records, candidateEvents) {
      const indexes = [];
      let cursor = 0;
      for (const event of candidateEvents) {
        let found = -1;
        for (let index = cursor; index < records.length; index++) {
          const record = records[index];
          if (
            record.signature === event.signature &&
            record.title.includes("死四") &&
            (record.title.includes("建立") || record.title.includes("新增"))
          ) {
            found = index;
            cursor = index + 1;
            break;
          }
        }
        indexes.push(found);
      }
      return indexes;
    }

    function withNMask(records, nMask) {
      return records.map(record => ({ ...record, nMask: cloneNMask(nMask) }));
    }

    function mergeTimelineWithReplay(records) {
      const candidateEvents = timeline.filter(event => event.type === "candidate");
      const starts = candidateStartIndexes(records, candidateEvents);
      const firstStart = starts.find(index => index >= 0);
      const output = firstStart == null ? [] : records.slice(0, firstStart);
      let candidateNumber = 0;

      for (const event of timeline) {
        if (event.type === "initial") {
          output.push(event.step);
          continue;
        }

        const start = starts[candidateNumber];
        if (start >= 0) {
          let end = records.length;
          for (let next = candidateNumber + 1; next < starts.length; next++) {
            if (starts[next] >= 0) {
              end = starts[next];
              break;
            }
          }
          output.push(...withNMask(records.slice(start, end), event.nMask));
        }
        candidateNumber++;
      }

      if (!candidateEvents.length || starts.every(index => index < 0)) {
        output.push(...records);
      }

      if (finalSignature) {
        for (let index = output.length - 1; index >= 0; index--) {
          if (output[index].signature !== finalSignature) continue;
          output[index] = { ...output[index], nMask: cloneNMask(finalNMask) };
          break;
        }
      }
      return output;
    }

    function rebuildCombinedReplay() {
      if (genBusy) return;
      const records = harvestOldReplay();
      combinedSteps = mergeTimelineWithReplay(records);
      const elements = ensureCombinedUI();
      if (!elements || !combinedSteps.length) {
        if (elements) elements.panel.hidden = true;
        return;
      }
      combinedIndex = combinedSteps.length - 1;
      showCombinedStep(combinedIndex);
    }

    genSetBusy = function generatorSetBusyWithCompleteReplay(value) {
      originalSetBusy(value);
      const elements = ensureCombinedUI();
      if (value) {
        timeline = [];
        forbiddenKeys = new Set();
        combinedSteps = [];
        combinedIndex = -1;
        lastRenderedBoard = null;
        lastRenderedAttacker = genGetAttacker();
        finalNMask = new Uint8Array(225);
        finalSignature = "";
        if (elements) elements.panel.hidden = true;
        return;
      }
      window.setTimeout(rebuildCombinedReplay, 0);
    };

    installBoardCapture();
    ensureCombinedUI();
  }

  installCompleteGeneratorReplay();
})();
