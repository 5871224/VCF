"use strict";

// Detailed status is a pure presentation subscriber. It neither replaces search/
// validation functions nor changes generator results.
(function installGeneratorDetailedStatus() {
  if (window.__generatorDetailedStatusInstalled) return;
  window.__generatorDetailedStatusInstalled = true;

  const style = document.createElement("style");
  style.dataset.generatorDetailedStatus = "true";
  style.textContent = `
    #gen-status, #status {
      white-space: pre-line;
      line-height: 1.55;
      overflow-wrap: anywhere;
    }
  `;
  document.head.appendChild(style);

  const state = {
    phase: "idle",
    expectedSteps: 0,
    validationKind: "",
    lastSearch: null,
    lastBlock: null,
  };
  window.__generatorDetailedStatusState = state;

  function formatNumber(value) {
    const number = Number(value);
    return Number.isFinite(number)
      ? Math.max(0, Math.round(number)).toLocaleString("zh-TW")
      : "0";
  }

  function format(stage, action, details = []) {
    const detailText = details.filter(Boolean).join("｜");
    return detailText ? `【${stage}】${action}\n${detailText}` : `【${stage}】${action}`;
  }

  function render(stage, action, details = []) {
    const text = format(stage, action, details);
    const element = genEl("status");
    if (element) element.textContent = text;
    return text;
  }

  function activeOptions() {
    return genGetActiveOptions() || {};
  }

  function otherVCFDescription() {
    return activeOptions().blockOtherVCF
      ? "同步數但完成盤面不同的其他 VCF 也會補守封鎖"
      : "未開啟「只保留目標 VCF」，同步數其他路線不會補守";
  }

  genRegisterStatusFormatter("detailed-status", text => {
    let match = text.match(/^正在建立 (\d+)\/(\d+) 步(.+)基礎……已驗證 (\d+) 個候選$/);
    if (match) {
      state.phase = "construct-base";
      return format("建立基礎", `正在從${match[3]}模板建立 ${match[1]}/${match[2]} 步起始盤面`, [
        "接著驗證指定步數的目標 VCF 是否存在",
        "若發現更短 VCF，會計算守點、補入守方棋後重新驗證",
        otherVCFDescription(),
        `累計已驗證 ${formatNumber(match[4])} 個候選`,
      ]);
    }

    match = text.match(/^正在延伸到 (\d+)\/(\d+) 步……已驗證 (\d+) 個候選，重建 (\d+) 次$/);
    if (match) {
      state.phase = "extend";
      return format("增加死四", `正在反向增加第 ${match[1]}/${match[2]} 步死四`, [
        "檢查新增攻守棋是否合法，且前一層目標答案仍完整保留",
        "驗證新增後的 VCF 步數必須正好增加 1 步",
        "若發現更短 VCF，會依防守點覆蓋數補守後重新驗證",
        otherVCFDescription(),
        `累計候選 ${formatNumber(match[3])} 個`,
        `已重新建立基礎 ${formatNumber(match[4])} 次`,
      ]);
    }

    match = text.match(/^目前基礎無法延伸到 (\d+) 步，正在重新建立……已驗證 (\d+) 個候選$/);
    if (match) {
      state.phase = "restart";
      return format("重新建立基礎", `上一組盤面無法通過 ${match[1]} 步驗證`, [
        "失敗盤面與補子分支不會保留",
        `累計已驗證 ${formatNumber(match[2])} 個候選`,
      ]);
    }

    match = text.match(/^VCF 已完成，最後補齊(攻方|守方)(黑|白)子 (\d+) 顆……已驗證 (\d+) 個候選$/);
    if (match) {
      state.phase = "balance";
      return format("補齊黑白子數", `正在補 ${match[1]}${match[2]}子 ${match[3]} 顆`, [
        "每一顆都避開目標 VCF 關鍵防點與 N 點",
        "補入後重新確認沒有較短 VCF，且指定完成盤面仍存在",
        `累計已驗證 ${formatNumber(match[4])} 個候選`,
      ]);
    }

    if (text.startsWith("正在以多組 VCF 封鎖") || text.startsWith("正在逐條驗證並封鎖其他 VCF")) {
      state.phase = "unique";
      return format("封鎖其他 VCF", "正在搜尋並封鎖完成盤面不同的其他 VCF", [
        "守點依可同時封鎖的路線數排序",
        "每補一顆都會從新盤面重新搜尋",
      ]);
    }

    if (text === "正在停止……") {
      state.phase = "stopping";
      return format("停止產生", "正在終止目前搜尋與驗證", ["未完成的候選與補子分支會直接丟棄"]);
    }
    if (text === "已停止產生") {
      state.phase = "stopped";
      return format("已停止", "題目產生與尚未完成的驗證已停止");
    }

    match = text.match(/^產生成功：(黑|白)方 (\d+) 步 VCF（共驗證 (\d+) 個候選）$/);
    if (match) {
      state.phase = "done";
      return format("產生完成", `${match[1]}方 ${match[2]} 步 VCF 已通過全部驗證`, [
        activeOptions().blockOtherVCF ? "已完成其他 VCF 封鎖" : "未要求唯一完成盤面",
        activeOptions().balanceStones ? "已依正常輪次補齊黑白子數" : "未啟用黑白子數補齊",
        `總共驗證 ${formatNumber(match[3])} 個候選`,
      ]);
    }

    if (text.startsWith("⚠ ")) {
      return format("搜尋限制警告", text.slice(2), ["結果會保留搜尋上限標記"]);
    }
    return text;
  }, 20);

  genOnGeneratorEvent("generation:start", "detailed-status", event => {
    state.phase = "starting";
    state.expectedSteps = Number(event.context?.targetSteps || 0);
  });

  genOnGeneratorEvent("material:selected", "detailed-status", event => {
    render("選擇初始材料", event.title || "已建立初始棋型", [event.reason, event.detail]);
  });

  genOnGeneratorEvent("validation:start", "detailed-status", event => {
    state.phase = "validate";
    state.validationKind = event.phase || "candidate";
    state.expectedSteps = Number(event.expectedSteps || state.expectedSteps || 0);
    render(
      event.phase === "extension" ? "驗證新增死四" : "驗證基礎",
      `正在確認 ${state.expectedSteps} 步目標完成盤面`,
      ["較短 VCF 會先計算守點並補守", otherVCFDescription()],
    );
  });

  genOnGeneratorEvent("search:start", "detailed-status", event => {
    state.lastSearch = event;
    const options = event.options || {};
    const mode = options.mode === "shortest" ? "最短 VCF" : options.mode === "single" ? "單一路線 VCF" : "多組 VCF";
    render("搜尋 VCF", `正在執行${mode}`, [
      `深度上限 ${formatNumber(options.maxDepth)}`,
      `節點／時間設定 ${formatNumber(options.maxNode)}`,
    ]);
  });

  genOnGeneratorEvent("search:end", "detailed-status", event => {
    const count = Array.from(event.result?.winMoves || []).length;
    render("搜尋完成", `本次取得 ${count} 組 VCF`, [
      `搜尋節點 ${formatNumber(event.result?.nodeCount)}`,
      event.result?.aborted ? "已達搜尋限制" : "搜尋正常完成",
    ]);
  });

  genOnGeneratorEvent("block:start", "detailed-status", event => {
    state.lastBlock = event;
    render("計算防守點", `正在分析長度 ${Array.from(event.moves || []).length} 手的 VCF 路線`, [
      "會排除 N 點、守方四／五及黑方禁手位置",
    ]);
  });

  genOnGeneratorEvent("block:end", "detailed-status", event => {
    render("防守點完成", `取得 ${Array.from(event.points || []).length} 個防守點`, [
      "接著依路線覆蓋數排序並逐點重新驗證",
    ]);
  });

  genOnGeneratorEvent("stone:start", "detailed-status", event => {
    const phase = event.phase === "balance" ? "補齊子數" : event.phase === "final" ? "最終封鎖" : "補守";
    const color = event.color || event.defender;
    render(phase, `試補${color === GEN_BLACK ? "黑" : "白"}子 ${genName(event.idx)}`, ["補入後會從新盤面重新驗證"]);
  });

  genOnGeneratorEvent("stone:end", "detailed-status", event => {
    render(
      event.passed ? "補子通過" : "補子未通過",
      event.reason || (event.passed ? "此補子分支已保留" : "此補子分支已撤銷"),
    );
  });

  genOnGeneratorEvent("validation:end", "detailed-status", event => {
    render(
      event.passed ? "候選驗證通過" : "候選驗證未通過",
      event.passed
        ? `已確認 ${event.expectedSteps} 步目標 VCF`
        : "此候選找不到目標完成盤面，或不希望的 VCF 無法封鎖",
    );
  });
})();
