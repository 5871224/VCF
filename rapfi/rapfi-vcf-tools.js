"use strict";

const BLACK = 1;
const WHITE = 2;
const EMPTY = 0;
const SIZE = 15;
const BOARD_CELLS = SIZE * SIZE;

function whenReady() {
  const board = document.querySelector("#board");
  const commandForm = document.querySelector("#commandForm");
  const commandInput = document.querySelector("#commandInput");
  const consoleElement = document.querySelector("#console");
  const benchmarkSection = document.querySelector(".benchmark-section");
  if (!board || !commandForm || !commandInput || !consoleElement || !benchmarkSection) {
    requestAnimationFrame(whenReady);
    return;
  }
  initialize({ board, commandForm, commandInput, consoleElement, benchmarkSection });
}

function initialize({ board, commandForm, commandInput, consoleElement, benchmarkSection }) {
  const ruleSelect = document.querySelector("#ruleSelect");
  const timeSelect = document.querySelector("#timeSelect");
  const restartButton = document.querySelector("#restartButton");
  const compareStatus = document.querySelector("#compareStatus");

  const style = document.createElement("style");
  style.textContent = `
    .vcf-tools-section { margin-top: 18px; padding-top: 16px; border-top: 1px solid var(--line); }
    .vcf-tools-actions { display: flex; gap: 8px; flex-wrap: wrap; align-items: end; }
    .vcf-tools-summary { margin: 10px 0 0; padding: 10px 12px; border-radius: 8px; background: #f5f2eb; line-height: 1.55; }
    .vcf-tools-summary.running { background: #fff6df; color: #6f4a00; }
    .vcf-tools-summary.success { background: #eaf7ef; color: #145f3c; }
    .vcf-tools-summary.warning { background: #ffe9e6; color: #8c211c; }
    .vcf-result-table { min-width: 840px; }
    .vcf-result-table td:nth-child(1), .vcf-result-table td:nth-child(2) { white-space: nowrap; }
    .vcf-result-table .success { background: #edf8f1; color: #145f3c; font-weight: 700; }
    .vcf-result-table .failed { background: #ffe8e6; color: #8c211c; font-weight: 700; }
    .vcf-result-table .unknown { background: #fff6df; color: #6f4a00; }
    .vcf-defense-legend { display: flex; gap: 12px; flex-wrap: wrap; margin-top: 9px; color: #69645a; font-size: .84rem; }
    .vcf-defense-legend span::before { content: ""; display: inline-block; width: 12px; height: 12px; margin-right: 5px; border-radius: 50%; vertical-align: -1px; }
    .vcf-defense-legend .candidate::before { background: #148552; }
    .vcf-defense-legend .failed::before { background: #c73731; }
    .vcf-defense-legend .unknown::before { background: #d49622; }
    .point.vcf-defense-candidate { box-shadow: inset 0 0 0 4px #148552, 0 0 0 1px rgb(255 255 255 / 85%); background-color: rgb(20 133 82 / 18%); }
    .point.vcf-defense-failed { box-shadow: inset 0 0 0 4px #c73731, 0 0 0 1px rgb(255 255 255 / 85%); background-color: rgb(199 55 49 / 18%); }
    .point.vcf-defense-unknown { box-shadow: inset 0 0 0 4px #d49622, 0 0 0 1px rgb(255 255 255 / 85%); background-color: rgb(212 150 34 / 18%); }
    body.rapfi-vcf-searching #board { pointer-events: none; opacity: .92; }
  `;
  document.head.append(style);

  const section = document.createElement("div");
  section.className = "vcf-tools-section";
  section.innerHTML = `
    <h2>Rapfi VCF 計算</h2>
    <div class="vcf-tools-actions">
      <button id="vcfSearchButton" class="primary" type="button" disabled>計算 VCF</button>
      <button id="vcfDefendButton" type="button" disabled>對單一 VCF 算防守</button>
    </div>
    <p id="vcfToolsSummary" class="vcf-tools-summary">「計算 VCF」會先由獨立 C++ Wasm 篩選合法的眠四（死四）、活四或成五根手，再只讓 Rapfi 搜尋這些候選；「算防守」使用官方 YXSEARCHDEFEND。</p>
    <div class="stats" id="vcfToolsStats">
      <div><strong>模式</strong><span id="vcfMode">—</span></div>
      <div><strong>判定</strong><span id="vcfVerdict">—</span></div>
      <div><strong>Rapfi 耗時</strong><span id="vcfTime">—</span></div>
      <div><strong>實際經過</strong><span id="vcfWallTime">—</span></div>
      <div><strong>總節點</strong><span id="vcfNodes">—</span></div>
      <div><strong>計算速度</strong><span id="vcfSpeed">—</span></div>
      <div><strong>深度／選擇深度</strong><span id="vcfDepth">—</span></div>
      <div><strong>已取得路線</strong><span id="vcfLineCount">—</span></div>
    </div>
    <div class="table-wrap">
      <table class="vcf-result-table">
        <thead><tr><th>排名</th><th>第一手</th><th>判定</th><th>評分</th><th>節點</th><th>路線</th></tr></thead>
        <tbody id="vcfResultBody"><tr><td colspan="6">尚未計算</td></tr></tbody>
      </table>
    </div>
    <div class="vcf-defense-legend">
      <span class="candidate">綠色：候選防守</span>
      <span class="failed">紅色：仍被 VCF</span>
      <span class="unknown">黃色：結果不完整</span>
    </div>
    <p class="note">「未證明被殺」只表示在目前時間限制與 Rapfi QVCF 搜尋範圍內沒有得到負將死分數，不等於一般完整搜尋下必然安全。Rapfi 官方程式碼與 Wasm 檔案維持原樣。</p>
  `;
  benchmarkSection.parentElement.insertBefore(section, benchmarkSection);

  const vcfSearchButton = section.querySelector("#vcfSearchButton");
  const vcfDefendButton = section.querySelector("#vcfDefendButton");
  const summary = section.querySelector("#vcfToolsSummary");
  const resultBody = section.querySelector("#vcfResultBody");
  const fields = {
    mode: section.querySelector("#vcfMode"),
    verdict: section.querySelector("#vcfVerdict"),
    time: section.querySelector("#vcfTime"),
    wallTime: section.querySelector("#vcfWallTime"),
    nodes: section.querySelector("#vcfNodes"),
    speed: section.querySelector("#vcfSpeed"),
    depth: section.querySelector("#vcfDepth"),
    lineCount: section.querySelector("#vcfLineCount"),
  };

  const trackedHistory = [];
  const pendingCandidateRequests = new Map();
  let occupied = new Map();
  let active = null;
  let currentPv = null;
  let sequence = 0;
  let candidateSequence = 0;
  let candidateReady = false;

  const candidateWorker = new Worker("./vcf-candidate-worker.js");
  candidateWorker.onmessage = (event) => {
    const { type, data } = event.data || {};
    if (type === "ready") {
      candidateReady = true;
      updateAvailability();
      return;
    }
    if (type === "candidates" || type === "candidateError") {
      const pending = pendingCandidateRequests.get(data?.requestId);
      if (!pending) return;
      pendingCandidateRequests.delete(data.requestId);
      clearTimeout(pending.timer);
      if (type === "candidates") pending.resolve(data);
      else pending.reject(new Error(data.message || "C++ Wasm 根候選判斷失敗"));
      return;
    }
    if (type === "error") {
      candidateReady = false;
      const error = new Error(String(data || "C++ Wasm 根候選模組載入失敗"));
      for (const pending of pendingCandidateRequests.values()) pending.reject(error);
      pendingCandidateRequests.clear();
      summary.className = "vcf-tools-summary warning";
      summary.textContent = error.message;
      updateAvailability();
    }
  };
  candidateWorker.onerror = (event) => {
    candidateReady = false;
    summary.className = "vcf-tools-summary warning";
    summary.textContent = `C++ Wasm 根候選 Worker 錯誤：${event.message || "未知錯誤"}`;
    updateAvailability();
  };
  candidateWorker.postMessage({
    type: "init",
    data: { patternURL: new URL("./engine/vcf-pattern-engine.js", location.href).href },
  });

  function readOccupied() {
    const map = new Map();
    [...board.children].forEach((point, index) => {
      if (point.querySelector(".stone.black")) map.set(index, BLACK);
      else if (point.querySelector(".stone.white")) map.set(index, WHITE);
    });
    return map;
  }

  function clearBoardMarks() {
    for (const point of board.children) {
      point.classList.remove("vcf-defense-candidate", "vcf-defense-failed", "vcf-defense-unknown");
      if (point.dataset.vcfDefenseMark === "1") {
        delete point.dataset.vcfDefenseMark;
        point.removeAttribute("title");
      }
    }
  }

  function syncTrackedHistory() {
    const next = readOccupied();
    if (next.size === 0) {
      trackedHistory.length = 0;
      occupied = next;
      return;
    }
    if (next.size === occupied.size + 1) {
      for (const [index, stone] of next) {
        if (!occupied.has(index)) {
          trackedHistory.push({ index, stone });
          break;
        }
      }
    } else if (next.size === occupied.size - 1) {
      while (trackedHistory.length > next.size) trackedHistory.pop();
    } else if (next.size !== occupied.size) {
      trackedHistory.length = 0;
      summary.className = "vcf-tools-summary warning";
      summary.textContent = "盤面落子順序無法同步，請按「清空」後重新擺盤再使用 VCF 工具。";
    }
    occupied = next;
  }

  function onBoardChanged() {
    clearBoardMarks();
    queueMicrotask(syncTrackedHistory);
  }

  board.addEventListener("click", onBoardChanged);
  document.querySelector("#acceptButton")?.addEventListener("click", onBoardChanged);
  document.querySelector("#undoButton")?.addEventListener("click", onBoardChanged);
  document.querySelector("#clearButton")?.addEventListener("click", onBoardChanged);
  ruleSelect?.addEventListener("change", clearBoardMarks);

  function currentSide() {
    const text = document.querySelector("#result")?.textContent || "";
    return text.includes("白棋") ? WHITE : BLACK;
  }

  function boardArray() {
    const values = new Uint8Array(BOARD_CELLS);
    for (const [index, stone] of occupied) values[index] = stone;
    return Array.from(values);
  }

  function buildBoardCommand() {
    const self = currentSide();
    const parts = ["YXBOARD"];
    for (const move of trackedHistory) {
      const x = move.index % SIZE;
      const y = Math.floor(move.index / SIZE);
      parts.push(`${x},${y},${move.stone === self ? 1 : 2}`);
    }
    parts.push("DONE");
    return parts.join(" ");
  }

  function indexToCoord(index) {
    return `${index % SIZE},${Math.floor(index / SIZE)}`;
  }

  function coordToIndex(coord) {
    const match = String(coord || "").match(/^(\d+),(\d+)$/);
    if (!match) return -1;
    const x = Number(match[1]);
    const y = Number(match[2]);
    return x >= 0 && x < SIZE && y >= 0 && y < SIZE ? y * SIZE + x : -1;
  }

  function submitCommand(command) {
    commandInput.value = command;
    commandForm.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  }

  function engineIsReady() {
    return document.querySelector("#statusDot")?.classList.contains("ready");
  }

  function updateAvailability() {
    const ready = engineIsReady();
    vcfSearchButton.disabled = !ready || !candidateReady || Boolean(active);
    vcfDefendButton.disabled = !ready || Boolean(active);
  }
  setInterval(updateAvailability, 300);

  function setLocked(locked) {
    document.body.classList.toggle("rapfi-vcf-searching", locked);
    const ids = ["undoButton", "clearButton", "acceptButton", "analyzeButton", "benchmarkButton"];
    for (const id of ids) {
      const element = document.getElementById(id);
      if (!element) continue;
      if (locked) {
        element.dataset.vcfPreviousDisabled = element.disabled ? "1" : "0";
        element.disabled = true;
      } else {
        element.disabled = element.dataset.vcfPreviousDisabled === "1";
        delete element.dataset.vcfPreviousDisabled;
      }
    }
    if (locked) {
      ruleSelect.dataset.vcfPreviousDisabled = ruleSelect.disabled ? "1" : "0";
      timeSelect.dataset.vcfPreviousDisabled = timeSelect.disabled ? "1" : "0";
      ruleSelect.disabled = true;
      timeSelect.disabled = true;
    } else {
      ruleSelect.disabled = ruleSelect.dataset.vcfPreviousDisabled === "1";
      timeSelect.disabled = timeSelect.dataset.vcfPreviousDisabled === "1";
      delete ruleSelect.dataset.vcfPreviousDisabled;
      delete timeSelect.dataset.vcfPreviousDisabled;
    }
    updateAvailability();
  }

  function resetDisplay(mode) {
    fields.mode.textContent = mode === "vcf" ? "計算 VCF" : "單一 VCF 防守";
    fields.verdict.textContent = "計算中…";
    fields.time.textContent = "—";
    fields.wallTime.textContent = "—";
    fields.nodes.textContent = "—";
    fields.speed.textContent = "—";
    fields.depth.textContent = "—";
    fields.lineCount.textContent = "0";
    resultBody.innerHTML = '<tr><td colspan="6">Rapfi 計算中…</td></tr>';
    summary.className = "vcf-tools-summary running";
    summary.textContent = mode === "vcf"
      ? "C++ Wasm 正在篩選合法的眠四（死四）、活四與成五根候選。"
      : "Rapfi 正在用官方 YXSEARCHDEFEND 檢查根節點防守，結果會直接標在棋盤上。";
  }

  function waitForInspectionThen(callback, attempts = 80) {
    if (!compareStatus?.classList.contains("loading") || attempts <= 0) {
      callback();
      return;
    }
    summary.className = "vcf-tools-summary running";
    summary.textContent = "等待目前的 Rapfi 空點棋型檢查完成後開始…";
    setTimeout(() => waitForInspectionThen(callback, attempts - 1), 50);
  }

  function requestVcfCandidates(job) {
    return new Promise((resolve, reject) => {
      if (!candidateReady) {
        reject(new Error("C++ Wasm 根候選模組尚未就緒"));
        return;
      }
      const requestId = ++candidateSequence;
      const timer = setTimeout(() => {
        pendingCandidateRequests.delete(requestId);
        reject(new Error("C++ Wasm 根候選判斷逾時"));
      }, 10000);
      pendingCandidateRequests.set(requestId, { resolve, reject, timer });
      candidateWorker.postMessage({
        type: "findCandidates",
        data: {
          requestId,
          board: boardArray(),
          side: currentSide(),
          rule: Number(ruleSelect.value),
          jobId: job.id,
        },
      });
    });
  }

  function commonCommands() {
    return [
      `INFO RULE ${ruleSelect.value}`,
      "INFO THREAD_NUM 1",
      "INFO SHOW_DETAIL 3",
      "INFO START_DEPTH 1",
      "INFO MAX_DEPTH 1",
      "INFO MAX_NODE 0",
      `INFO TIMEOUT_TURN ${timeSelect.value}`,
      "INFO TIMEOUT_MATCH 100000000",
      "INFO TIME_LEFT 2147483647",
      buildBoardCommand(),
      "YXBLOCKRESET",
    ];
  }

  function completeWithoutCandidate(job, elapsedMs) {
    if (!active || active.id !== job.id) return;
    fields.verdict.textContent = "沒有純 VCF 根候選";
    fields.time.textContent = "0 ms";
    fields.wallTime.textContent = `${(performance.now() - job.startedAt).toFixed(1)} ms`;
    fields.nodes.textContent = "0";
    fields.speed.textContent = "—";
    fields.depth.textContent = "—";
    fields.lineCount.textContent = "0";
    resultBody.innerHTML = '<tr><td colspan="6">C++ Wasm 未找到合法的眠四（死四）、活四或成五根手</td></tr>';
    summary.className = "vcf-tools-summary warning";
    summary.textContent = `根候選篩選完成（${elapsedMs.toFixed(2)} ms），盤面目前沒有符合純 VCF 定義的第一手。`;
    active = null;
    currentPv = null;
    setLocked(false);
  }

  async function prepareAndRun(job) {
    if (!active || active.id !== job.id) return;
    try {
      let candidateResult = null;
      if (job.mode === "vcf") {
        candidateResult = await requestVcfCandidates(job);
        if (!active || active.id !== job.id) return;
        job.candidateCount = candidateResult.candidates.length;
        job.filterMs = candidateResult.elapsedMs;
        if (!job.candidateCount) {
          completeWithoutCandidate(job, candidateResult.elapsedMs);
          return;
        }
      }

      for (const command of commonCommands()) submitCommand(command);

      if (job.mode === "vcf") {
        const allowed = new Set(candidateResult.candidates.map((item) => item.idx));
        const blocked = [];
        for (let idx = 0; idx < BOARD_CELLS; idx++) {
          if (!occupied.has(idx) && !allowed.has(idx)) blocked.push(indexToCoord(idx));
        }
        if (blocked.length) submitCommand(`YXBLOCK ${blocked.join(" ")} DONE`);
        summary.textContent = `C++ Wasm 找到 ${allowed.size} 個合法衝四以上根候選（${candidateResult.elapsedMs.toFixed(2)} ms）；Rapfi 只搜尋這些位置。`;
        submitCommand(`YXNBEST ${allowed.size}`);
      } else {
        submitCommand("YXSEARCHDEFEND");
      }
    } catch (error) {
      if (!active || active.id !== job.id) return;
      summary.className = "vcf-tools-summary warning";
      summary.textContent = `VCF 計算啟動失敗：${error.message}`;
      fields.verdict.textContent = "啟動失敗";
      active = null;
      currentPv = null;
      setLocked(false);
    }
  }

  function start(mode) {
    if (active || !engineIsReady()) return;
    syncTrackedHistory();
    if (trackedHistory.length !== occupied.size) {
      summary.className = "vcf-tools-summary warning";
      summary.textContent = "無法取得完整落子順序，請清空棋盤後重新擺盤。";
      return;
    }
    clearBoardMarks();
    active = {
      id: ++sequence,
      mode,
      startedAt: performance.now(),
      lines: new Map(),
      lastMetrics: {},
      candidateCount: 0,
      filterMs: 0,
    };
    const job = active;
    currentPv = null;
    resetDisplay(mode);
    setLocked(true);
    waitForInspectionThen(() => prepareAndRun(job));
  }

  function isPositiveMate(value) {
    return /^\+M(?:\d+|\*)?$/.test(String(value || ""));
  }

  function isNegativeMate(value) {
    return /^-M(?:\d+|\*)?$/.test(String(value || ""));
  }

  function firstMove(line) {
    const token = String(line || "").trim().split(/\s+/)[0];
    return /^\d+,\d+$/.test(token) ? token : "—";
  }

  function formatNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number.toLocaleString("zh-TW") : "—";
  }

  function markDefensePoints(lines) {
    clearBoardMarks();
    for (const line of lines) {
      const coord = firstMove(line.BESTLINE);
      const index = coordToIndex(coord);
      if (index < 0 || occupied.has(index)) continue;
      const point = board.children[index];
      const failed = isNegativeMate(line.EVAL);
      const unknown = !line.EVAL;
      point.classList.add(unknown
        ? "vcf-defense-unknown"
        : failed ? "vcf-defense-failed" : "vcf-defense-candidate");
      point.dataset.vcfDefenseMark = "1";
      point.title = `${coord}：${unknown ? "結果不完整" : failed ? "仍被 VCF" : "候選防守"}${line.EVAL ? `（${line.EVAL}）` : ""}`;
    }
  }

  function renderLines(final = false) {
    if (!active) return;
    const lines = [...active.lines.values()].sort((a, b) => Number(a.index) - Number(b.index));
    resultBody.replaceChildren();
    if (!lines.length) {
      resultBody.innerHTML = '<tr><td colspan="6">尚未收到完整路線</td></tr>';
    } else {
      for (const line of lines.slice(0, 225)) {
        const row = document.createElement("tr");
        const failed = active.mode === "defend" && isNegativeMate(line.EVAL);
        const success = active.mode === "vcf" ? isPositiveMate(line.EVAL) : Boolean(line.EVAL) && !failed;
        const verdict = active.mode === "vcf"
          ? success ? "找到 VCF" : "未證明 VCF"
          : !line.EVAL ? "結果不完整" : failed ? "仍被 VCF" : "候選防守";
        const values = [
          Number(line.index) + 1,
          firstMove(line.BESTLINE),
          verdict,
          line.EVAL || "—",
          formatNumber(line.NODES),
          line.BESTLINE || "—",
        ];
        values.forEach((value, index) => {
          const cell = document.createElement("td");
          cell.textContent = String(value);
          if (index === 2) cell.className = success ? "success" : failed ? "failed" : "unknown";
          row.append(cell);
        });
        resultBody.append(row);
      }
    }

    if (active.mode === "defend") markDefensePoints(lines);

    const primary = lines[0] || {};
    const metrics = { ...primary, ...active.lastMetrics };
    fields.time.textContent = metrics.TOTALTIME ? `${formatNumber(metrics.TOTALTIME)} ms` : "—";
    fields.nodes.textContent = formatNumber(metrics.TOTALNODES ?? metrics.NODES);
    fields.speed.textContent = metrics.SPEED ? `${formatNumber(metrics.SPEED)} nodes/s` : "—";
    fields.depth.textContent = `${metrics.DEPTH ?? "—"}／${metrics.SELDEPTH ?? "—"}`;
    fields.lineCount.textContent = String(lines.length);
    fields.wallTime.textContent = `${(performance.now() - active.startedAt).toFixed(1)} ms`;

    if (active.mode === "vcf") {
      const wins = lines.filter((line) => isPositiveMate(line.EVAL));
      fields.verdict.textContent = wins.length ? `找到 ${wins.length} 個 VCF` : final ? "未證明 VCF" : "搜尋中";
      if (final) {
        summary.className = `vcf-tools-summary ${wins.length ? "success" : "warning"}`;
        summary.textContent = wins.length
          ? `Rapfi 在 ${active.candidateCount} 個合法衝四以上根候選中找到 ${wins.length} 個 VCF；最快路線：${wins[0].BESTLINE || "已取得將死分數"}。`
          : `已檢查 ${active.candidateCount} 個合法衝四以上根候選，Rapfi 在目前限制內未取得正將死分數。`;
      }
    } else {
      const candidates = lines.filter((line) => line.EVAL && !isNegativeMate(line.EVAL));
      const failed = lines.filter((line) => isNegativeMate(line.EVAL));
      fields.verdict.textContent = final ? `${candidates.length} 個候選防守` : "搜尋中";
      if (final) {
        summary.className = `vcf-tools-summary ${candidates.length ? "success" : "warning"}`;
        summary.textContent = candidates.length
          ? `棋盤已用綠色標出 ${candidates.length} 個候選防守；另有 ${failed.length} 個紅色位置仍被 VCF。`
          : `沒有取得候選防守；棋盤上的 ${failed.length} 個紅色位置仍顯示被 VCF。`;
      }
    }
  }

  function handleInfo(key, value) {
    if (!active) return;
    if (key === "PV") {
      if (value === "DONE") {
        if (currentPv) {
          active.lines.set(currentPv.index, currentPv);
          currentPv = null;
          renderLines(false);
        }
      } else if (/^\d+$/.test(value)) {
        currentPv = { index: Number(value) };
      }
      return;
    }
    if (currentPv) currentPv[key] = value;
    active.lastMetrics[key] = value;
  }

  function finishSearch() {
    if (!active) return;
    if (currentPv) {
      active.lines.set(currentPv.index, currentPv);
      currentPv = null;
    }
    renderLines(true);
    submitCommand("YXBLOCKRESET");
    active = null;
    setLocked(false);
    updateAvailability();
  }

  function parseConsoleLine(text) {
    if (!active) return;
    const clean = String(text).replace(/^[<!#>]\s*/, "");
    const info = clean.match(/^INFO\s+(\S+)(?:\s+(.+))?$/);
    if (info) {
      handleInfo(info[1], info[2] ?? "");
      return;
    }
    if (/^\d+,\d+(?:\s|$)/.test(clean)) finishSearch();
  }

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.nodeType === Node.ELEMENT_NODE) parseConsoleLine(node.textContent || "");
      }
    }
  });
  observer.observe(consoleElement, { childList: true });

  vcfSearchButton.addEventListener("click", () => start("vcf"));
  vcfDefendButton.addEventListener("click", () => start("defend"));
  restartButton?.addEventListener("click", () => {
    if (!active) return;
    active = null;
    currentPv = null;
    submitCommand("YXBLOCKRESET");
    summary.className = "vcf-tools-summary warning";
    summary.textContent = "計算已透過重啟引擎中止。";
    fields.verdict.textContent = "已中止";
    setLocked(false);
  });

  occupied = readOccupied();
  updateAvailability();
}

whenReady();
