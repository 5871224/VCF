"use strict";

// 題目產生器的狀態列只負責說明目前動作，不改變任何產生或驗證結果。
(function installGeneratorDetailedStatus(global) {
  const INSTALL_FLAG = "__generatorDetailedStatusInstalled";

  function install() {
    if (global[INSTALL_FLAG]) return;
    if (
      !global.__generatorValidationAndBalanceFixInstalled ||
      typeof global.genSetStatus !== "function" ||
      typeof global.genValidateCandidate !== "function" ||
      typeof global.genValidateExtensionCandidate !== "function" ||
      typeof genEngine === "undefined" ||
      typeof genEngine.findVCF !== "function" ||
      typeof genEngine.getBlockVCF !== "function"
    ) {
      global.setTimeout(install, 0);
      return;
    }

    global[INSTALL_FLAG] = true;

    const style = document.createElement("style");
    style.dataset.generatorDetailedStatus = "true";
    style.textContent = `
      #gen-status,
      #status {
        white-space: pre-line;
        line-height: 1.55;
        overflow-wrap: anywhere;
      }
    `;
    document.head.appendChild(style);

    const state = {
      phase: "idle",
      validationKind: "",
      expectedSteps: 0,
      blockOtherVCF: false,
      lastLegacyText: "",
      balanceBaseBoard: null,
    };
    global.__generatorDetailedStatusState = state;

    const previousSetStatus = global.genSetStatus;

    function isCancelled() {
      return typeof genCancelled !== "undefined" && genCancelled;
    }

    function selectedBlockOtherVCF() {
      return Boolean(global.genEl?.("block-other-vcf")?.checked);
    }

    function selectedBalanceStones() {
      return Boolean(global.genEl?.("balance-stones")?.checked);
    }

    function formatNumber(value) {
      const number = Number(value);
      return Number.isFinite(number)
        ? Math.max(0, Math.round(number)).toLocaleString("zh-TW")
        : "0";
    }

    function show(stage, action, details = []) {
      const detailText = details.filter(Boolean).join("｜");
      return previousSetStatus(
        detailText
          ? `【${stage}】${action}\n${detailText}`
          : `【${stage}】${action}`,
      );
    }

    function otherVCFDescription() {
      return selectedBlockOtherVCF()
        ? "同步數但完成盤面不同的其他 VCF 也會補守封鎖"
        : "未開啟「只保留目標 VCF」，同步數其他路線不會補守";
    }

    function mapLegacyStatus(text) {
      let match = text.match(
        /^正在建立 (\d+)\/(\d+) 步(.+)基礎……已驗證 (\d+) 個候選$/,
      );
      if (match) {
        state.phase = "construct-base";
        return show(
          "建立基礎",
          `正在從${match[3]}模板建立 ${match[1]}/${match[2]} 步起始盤面`,
          [
            "接著驗證指定步數的目標 VCF 是否存在",
            "若發現更短 VCF，會計算守點、補入守方棋後重新驗證",
            otherVCFDescription(),
            `累計已驗證 ${formatNumber(match[4])} 個候選`,
          ],
        );
      }

      match = text.match(
        /^正在延伸到 (\d+)\/(\d+) 步……已驗證 (\d+) 個候選，重建 (\d+) 次$/,
      );
      if (match) {
        state.phase = "extend";
        return show(
          "增加死四",
          `正在反向增加第 ${match[1]}/${match[2]} 步死四`,
          [
            "檢查新增攻守棋是否合法，且前一層目標答案仍完整保留",
            "驗證新增後的 VCF 步數必須正好增加 1 步",
            "若發現更短 VCF，會嘗試補守後重新驗證",
            otherVCFDescription(),
            `累計候選 ${formatNumber(match[3])} 個`,
            `已重新建立基礎 ${formatNumber(match[4])} 次`,
          ],
        );
      }

      match = text.match(
        /^目前基礎無法延伸到 (\d+) 步，正在重新建立……已驗證 (\d+) 個候選$/,
      );
      if (match) {
        state.phase = "restart";
        return show(
          "重新建立基礎",
          `上一組盤面所有延伸候選都無法通過 ${match[1]} 步驗證`,
          [
            "上一組盤面將被丟棄，不會保留失敗補子",
            "現在重新選擇活三／死四模板與方向，再從基礎驗證開始",
            `累計已驗證 ${formatNumber(match[2])} 個候選`,
          ],
        );
      }

      match = text.match(
        /^VCF 已完成，最後補齊(黑|白)子 (\d+) 顆……已驗證 (\d+) 個候選$/,
      );
      if (match) {
        state.phase = "balance";
        return show(
          "補齊黑白子數",
          `指定步數的死四與 VCF 驗證已完成，現在需要補 ${match[1]}子 ${match[2]} 顆`,
          [
            "補子顏色由目前黑白差額與下一手應由哪一方下棋直接決定",
            "每個候選點都會先避開目標 VCF 的關鍵防守點",
            "補入後重新確認沒有較短 VCF，且指定完成盤面仍存在",
            `累計已驗證 ${formatNumber(match[3])} 個產生候選`,
          ],
        );
      }

      if (text.startsWith("正在逐條驗證並封鎖其他 VCF")) {
        state.phase = "unique";
        return show(
          "封鎖其他 VCF",
          "目標步數已完成，正在逐條搜尋完成盤面不同的其他 VCF",
          [
            "找到其他 VCF 時，會比較目標路線與該路線的防守點",
            "只加入能封鎖其他路線、又不會封鎖目標答案的守方棋",
            "每補一顆都會從新盤面重新搜尋，直到沒有其他 VCF",
          ],
        );
      }

      if (text === "正在停止……") {
        state.phase = "stopping";
        return show(
          "停止產生",
          "已收到停止要求，正在立即終止目前的搜尋與驗證 Worker",
          ["尚未完成的候選與補子分支會直接丟棄", "Worker 重新初始化不會阻塞停止按鈕"],
        );
      }

      if (text === "已停止產生") {
        state.phase = "stopped";
        return show("已停止", "題目產生與所有尚未完成的驗證已停止");
      }

      match = text.match(
        /^產生成功：(黑|白)方 (\d+) 步 VCF（共驗證 (\d+) 個候選）$/,
      );
      if (match) {
        state.phase = "done";
        return show(
          "產生完成",
          `${match[1]}方 ${match[2]} 步 VCF 已通過全部驗證`,
          [
            "指定完成盤面存在，且沒有未處理的較短 VCF",
            selectedBlockOtherVCF()
              ? "已依設定完成其他 VCF 封鎖"
              : "未要求唯一題，因此保留可能存在的同步數其他路線",
            selectedBalanceStones()
              ? "已依輪次補齊黑白子數"
              : "未啟用黑白子數補齊",
            `總共驗證 ${formatNumber(match[3])} 個候選`,
          ],
        );
      }

      if (text.startsWith("⚠ ")) {
        return show("搜尋限制警告", text.slice(2), ["目前會依介面設定繼續處理，結果明細將保留警告"]);
      }

      return previousSetStatus(text);
    }

    global.genSetStatus = function setDetailedGeneratorStatus(text) {
      const message = String(text ?? "");
      state.lastLegacyText = message;
      return mapLegacyStatus(message);
    };

    const previousValidateCandidate = global.genValidateCandidate;
    global.genValidateCandidate = async function validateBaseWithDetailedStatus(
      candidate,
      expectedSteps,
    ) {
      state.phase = "validate";
      state.validationKind = "base";
      state.expectedSteps = Number(expectedSteps) || 0;
      state.blockOtherVCF = selectedBlockOtherVCF();
      show(
        "驗證基礎",
        `正在搜尋是否存在符合模板完成盤面的 ${expectedSteps} 步目標 VCF`,
        [
          "同一次搜尋也會檢查是否存在步數更短的 VCF",
          "發現較短 VCF 時，先計算可用守點，再補守並從新盤面重新搜尋",
          otherVCFDescription(),
          "只有目標 VCF 保留且不希望的路線已處理，這個基礎候選才會通過",
        ],
      );

      const result = await previousValidateCandidate.apply(this, arguments);
      if (!isCancelled()) {
        show(
          result ? "基礎驗證通過" : "基礎候選未通過",
          result
            ? `已找到符合模板的 ${expectedSteps} 步目標 VCF，準備進入增加死四階段`
            : "此基礎找不到指定完成盤面、存在無法封鎖的較短 VCF，或已達搜尋限制",
          [result ? "目標盤面與路線已保存" : "接著會換下一個基礎候選，不保留本次補子"],
        );
      }
      return result;
    };

    const previousValidateExtensionCandidate =
      global.genValidateExtensionCandidate;
    global.genValidateExtensionCandidate =
      async function validateExtensionWithDetailedStatus(
        candidate,
        previousResult,
        targetSteps,
      ) {
        state.phase = "validate";
        state.validationKind = "extension";
        state.expectedSteps = Number(targetSteps) || 0;
        state.blockOtherVCF = selectedBlockOtherVCF();
        const previousSteps = Number(previousResult?.steps) || targetSteps - 1;
        show(
          "驗證新增死四",
          `正在確認這一層能把答案由 ${previousSteps} 步延長為 ${targetSteps} 步`,
          [
            "先確認新增攻守棋、A 點、五點與禁手規則都合法",
            "再搜尋目標完成盤面，並確認原本各層答案沒有被破壞",
            "發現較短 VCF 時，會計算守點補守後重新驗證",
            otherVCFDescription(),
          ],
        );

        const result = await previousValidateExtensionCandidate.apply(
          this,
          arguments,
        );
        if (!isCancelled()) {
          show(
            result ? "新增死四通過" : "新增死四未通過",
            result
              ? `這一層已確認為 ${targetSteps} 步目標 VCF，準備處理下一層或最終驗證`
              : "此方向無法正好增加一層、目標盤面被破壞，或較短 VCF 無法合法封鎖",
            [result ? "已保存本層盤面與 VCF 路線" : "接著嘗試同一層的下一個方向或模板"],
          );
        }
        return result;
      };

    const previousGetBlockVCF = genEngine.getBlockVCF.bind(genEngine);
    genEngine.getBlockVCF = async function getBlockVCFWithDetailedStatus(
      arr,
      color,
      moves,
      includeFour = true,
    ) {
      const moveCount = Array.from(moves || []).length;
      if (state.phase === "validate") {
        show(
          "計算補守點",
          "已找到不希望的 VCF，正在取得目標路線與該路線的防守點資料",
          [
            `目前分析路線長度 ${moveCount} 手`,
            "會排除目標 VCF 本身必須保留的防守點",
            "也會排除 N 點、形成守方四／五或黑方禁手的位置",
          ],
        );
      } else if (state.phase === "unique") {
        show(
          "封鎖其他 VCF",
          "已找到另一組完成盤面，正在計算可封鎖它的守點",
          [
            `目前分析路線長度 ${moveCount} 手`,
            "守點不能同時封鎖指定目標路線",
            "取得候選後會逐點補入並重新搜尋其他 VCF",
          ],
        );
      } else if (state.phase === "balance") {
        state.balanceBaseBoard = Array.from(arr || []).slice(0, 225);
        show(
          "補齊黑白子數",
          "正在取得目標 VCF 的關鍵防守點，建立最後補子的禁用位置",
          [
            `目標路線長度 ${moveCount} 手`,
            "最後補子不會放在會改變或封鎖目標答案的位置",
          ],
        );
      }

      const result = await previousGetBlockVCF(arr, color, moves, includeFour);
      const pointCount = Array.from(result || []).length;
      if (state.phase === "validate") {
        show(
          "嘗試補守",
          "防守點資料已取得，正在排除會破壞目標答案的位置並逐點重新驗證",
          [
            `本次取得 ${pointCount} 個防守點資料`,
            "補入守方棋後會重新搜尋目標、較短 VCF 與依設定需要封鎖的其他 VCF",
          ],
        );
      } else if (state.phase === "unique") {
        show(
          "嘗試封鎖其他 VCF",
          "防守點資料已取得，正在逐一補入守方棋並從新盤面重新搜尋",
          [`本次取得 ${pointCount} 個防守點資料`, "不通過的補守分支會丟棄，不會留在最後盤面"],
        );
      } else if (state.phase === "balance") {
        show(
          "補齊黑白子數",
          "目標 VCF 的禁用位置已取得，正在依合法性與棋型權重排列最後補子候選",
          [`已取得 ${pointCount} 個目標關鍵防守點`, "下一步會逐點試補，並重新驗證 VCF"],
        );
      }
      return result;
    };

    const previousFindVCF = genEngine.findVCF.bind(genEngine);
    genEngine.findVCF = async function findVCFWithDetailedStatus(
      arr,
      color,
      maxVCF = 64,
      options = {},
    ) {
      if (state.phase === "balance") {
        const baseBoard = state.balanceBaseBoard;
        const added = baseBoard
          ? Array.from(arr || []).slice(0, 225)
              .map((stone, idx) => ({ stone, idx }))
              .filter(item => !baseBoard[item.idx] && item.stone)
          : [];
        const addedText = added.length
          ? `目前試補 ${added.length} 顆：` + added
              .slice(-4)
              .map(item =>
                `${item.stone === GEN_BLACK ? "黑" : "白"}${
                  typeof genName === "function" ? genName(item.idx) : item.idx
                }`,
              )
              .join("、")
          : "正在驗證第一個最後補子候選";
        if (options?.mode === "shortest") {
          show(
            "驗證最後補子",
            "正在先搜尋最短 VCF，確認剛補入的棋沒有讓答案步數變短",
            [
              addedText,
              `最多搜尋 ${formatNumber(options.maxNode)} 個節點`,
              `目標仍必須是 ${state.expectedSteps || "指定"} 步`,
              "發現較短 VCF 會立即淘汰這個補子位置",
            ],
          );
        } else {
          show(
            "驗證最後補子",
            "最短路線不是指定完成盤面，正在搜尋多組 VCF 確認目標答案仍存在",
            [
              addedText,
              `最多取得 ${formatNumber(maxVCF)} 組路線`,
              `最多搜尋 ${formatNumber(options.maxNode)} 個節點`,
              "只要出現較短 VCF，或找不到指定完成盤面，就淘汰此補子位置",
            ],
          );
        }
      }
      return previousFindVCF(arr, color, maxVCF, options);
    };
  }

  install();
})(window);
