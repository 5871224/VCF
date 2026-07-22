"use strict";

const BLACK = 1;
const WHITE = 2;
const SIZE = 15;

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
    <p id="vcfToolsSummary" class="vcf-tools-summary">「計算 VCF」使用 Rapfi 深度 1 主搜尋進入官方 QVCF；「算防守」使用官方 YXSEARCHDEFEND，逐一檢查目前輪到方的防守點。</p>
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
  let occupied = new Map();
  let active = null;
  let currentPv = null;
  let sequence = 0;

  function readOccupied() {
    const map = new Map();
    [...board.children].forEach((point, index) => {
      if (point.querySelector(".stone.black")) map.set(index, BLACK);
      else if (point.querySelector(".stone.white")) map.set(index, WHITE);
    });
    return map;
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

  board.addEventListener("click", () => queueMicrotask(syncTrackedHistory));
  document.querySelector("#acceptButton")?.addEventListener("click", () => queueMicrotask(syncTrackedHistory));
  document.querySelector("#undoButton")?.addEventListener("click", () => queueMicrotask(syncTrackedHistory));
  document.querySelector("#clearButton")?.addEventListener("click", () => queueMicrotask(syncTrackedHistory));

  function currentSide() {
    const text = document.querySelector("#result")?.textContent || "";
    return text.includes("白棋") ? WHITE : BLACK;
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

  function submitCommand(command) {
    commandInput.value = command;
    commandForm.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  }

  function engineIsReady() {
    return document.querySelector("#statusDot")?.classList.contains("ready");
  }

  function updateAvailability() {
    const ready = engineIsReady();
    vcfSearchButton.disabled = !ready || Boolean(active);
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
      ? "Rapfi 正在以深度 1 主搜尋進入官方 QVCF，尋找連續四衝勝。"
      : "Rapfi 正在用官方 YXSEARCHDEFEND 檢查所有根節點防守；空點很多時可能只來得及完成部分候選。";
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

  function start(mode) {
    if (active || !engineIsReady()) return;
    syncTrackedHistory();
    if (trackedHistory.length !== occupied.size) {
      summary.className = "vcf-tools-summary warning";
      summary.textContent = "無法取得完整落子順序，請清空棋盤後重新擺盤。";
      return;
    }
    active = {
      id: ++sequence,
      mode,
      startedAt: performance.now(),
      lines: new Map(),
      lastMetrics: {},
    };
    currentPv = null;
    resetDisplay(mode);
    setLocked(true);
    waitForInspectionThen(() => {
      if (!active || active.mode !== mode) return;
      const common = [
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
      ];
      for (const command of common) submitCommand(command);
      submitCommand(mode === "vcf" ? "YXNBEST 1" : "YXSEARCHDEFEND");
    });
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

  function renderLines(final = false) {
    if (!active) return;
    const lines = [...active.lines.values()].sort((a, b) => Number(a.index) - Number(b.index));
    resultBody.replaceChildren();
    if (!lines.length) {
      resultBody.innerHTML = '<tr><td colspan="6">尚未收到完整路線</td></tr>';
    } else {
      for (const line of lines.slice(0, 120)) {
        const row = document.createElement("tr");
        const failed = active.mode === "defend" && isNegativeMate(line.EVAL);
        const success = active.mode === "vcf" ? isPositiveMate(line.EVAL) : !failed;
        const verdict = active.mode === "vcf"
          ? success ? "找到 VCF" : "未證明 VCF"
          : failed ? "仍被 VCF" : "候選防守";
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

    const primary = lines[0] || active.lastMetrics;
    const metrics = { ...active.lastMetrics, ...primary };
    fields.time.textContent = metrics.TOTALTIME ? `${formatNumber(metrics.TOTALTIME)} ms` : "—";
    fields.nodes.textContent = formatNumber(metrics.TOTALNODES ?? metrics.NODES);
    fields.speed.textContent = metrics.SPEED ? `${formatNumber(metrics.SPEED)} nodes/s` : "—";
    fields.depth.textContent = `${metrics.DEPTH ?? "—"}／${metrics.SELDEPTH ?? "—"}`;
    fields.lineCount.textContent = String(lines.length);
    fields.wallTime.textContent = `${(performance.now() - active.startedAt).toFixed(1)} ms`;

    if (active.mode === "vcf") {
      const found = isPositiveMate(primary.EVAL);
      fields.verdict.textContent = found ? "找到 VCF" : final ? "未證明 VCF" : "搜尋中";
      if (final) {
        summary.className = `vcf-tools-summary ${found ? "success" : "warning"}`;
        summary.textContent = found
          ? `Rapfi 找到 VCF：${primary.BESTLINE || "已取得將死分數"}。`
          : "Rapfi 在目前時間與 QVCF 範圍內未取得正將死分數；這不是嚴格證明盤面不存在更深的 VCF。";
      }
    } else {
      const candidateCount = lines.filter((line) => !isNegativeMate(line.EVAL)).length;
      fields.verdict.textContent = final ? `${candidateCount} 個候選防守` : "搜尋中";
      if (final) {
        summary.className = `vcf-tools-summary ${candidateCount ? "success" : "warning"}`;
        summary.textContent = candidateCount
          ? `已取得 ${lines.length} 條防守路線，其中 ${candidateCount} 條在本次 QVCF 搜尋中未被證明仍遭 VCF。`
          : `已取得 ${lines.length} 條路線，目前全部仍顯示負將死分數。`;
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
    summary.className = "vcf-tools-summary warning";
    summary.textContent = "計算已透過重啟引擎中止。";
    fields.verdict.textContent = "已中止";
    setLocked(false);
  });

  occupied = readOccupied();
  updateAvailability();
}

whenReady();
