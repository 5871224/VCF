"use strict";

(function installQuestionBank() {
  const BOARD_CELLS = 225;
  const SUPABASE_URL = "https://jblrnncqnrqtzwayxtnw.supabase.co";
  const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_wDnYw-EuDUZ4h2jfLC_6jw__k3P19gz";
  const TABLE_URL = `${SUPABASE_URL}/rest/v1/vcf_boards`;

  const normalizeBoard = value => {
    if (!Array.isArray(value) && !(value && typeof value.length === "number")) return null;
    const board = new Array(BOARD_CELLS);
    for (let i = 0; i < BOARD_CELLS; i++) {
      const stone = Number(value[i]);
      board[i] = stone === 1 || stone === 2 ? stone : 0;
    }
    return board;
  };

  const boardToText = board => normalizeBoard(board)?.join("") || null;

  const textToBoard = value => {
    if (typeof value !== "string" || !/^[012]{225}$/.test(value)) return null;
    return Array.from(value, Number);
  };

  const sameBoard = (left, right) => {
    if (!left || !right || left.length < BOARD_CELLS || right.length < BOARD_CELLS) return false;
    for (let i = 0; i < BOARD_CELLS; i++) {
      if (left[i] !== right[i]) return false;
    }
    return true;
  };

  const sameQuestion = (entry, board, attacker) => (
    entry?.attacker === attacker && sameBoard(entry.board, board)
  );

  const inferAttacker = board => {
    let black = 0;
    let white = 0;
    for (const stone of board) {
      if (stone === 1) black++;
      else if (stone === 2) white++;
    }
    return black > white ? 2 : 1;
  };

  const supabaseRequest = async (query = "", options = {}) => {
    const response = await fetch(`${TABLE_URL}${query}`, {
      ...options,
      headers: {
        apikey: SUPABASE_PUBLISHABLE_KEY,
        Accept: "application/json",
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...(options.headers || {}),
      },
    });

    if (!response.ok) {
      let detail = "";
      try {
        const payload = await response.json();
        detail = payload?.message || payload?.details || payload?.hint || "";
      } catch (_) {
        detail = await response.text().catch(() => "");
      }
      const error = new Error(detail || `HTTP ${response.status}`);
      error.status = response.status;
      throw error;
    }

    if (response.status === 204) return null;
    const text = await response.text();
    return text ? JSON.parse(text) : null;
  };

  const loadBank = async () => {
    const rows = await supabaseRequest("?select=board,attacker&order=board.asc,attacker.asc");
    if (!Array.isArray(rows)) return [];
    return rows.map(row => {
      const board = textToBoard(row?.board);
      const attacker = Number(row?.attacker);
      if (!board || (attacker !== 1 && attacker !== 2)) return null;
      return { board, attacker };
    }).filter(Boolean);
  };

  const addQuestion = async entry => {
    await supabaseRequest("", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({
        board: boardToText(entry.board),
        attacker: entry.attacker,
      }),
    });
  };

  const deleteQuestion = async entry => {
    const boardText = boardToText(entry.board);
    await supabaseRequest(`?board=eq.${encodeURIComponent(boardText)}&attacker=eq.${entry.attacker}`, {
      method: "DELETE",
      headers: { Prefer: "return=minimal" },
    });
  };

  const install = () => {
    if (document.getElementById("vcf-question-bank")) return;
    if (typeof window._getArr !== "function" || typeof window._setBoardArr !== "function") return;

    const anchor = document.getElementById("bitboard-architecture-panel");
    if (!anchor) return;

    const section = document.createElement("section");
    section.id = "vcf-question-bank";
    section.innerHTML = `
      <div class="qb-heading">題庫</div>
      <div class="qb-actions">
        <button id="qb-add" type="button">加入題庫</button>
        <button id="qb-prev" type="button">上一題</button>
        <span id="qb-position" aria-live="polite">正在載入題庫…</span>
        <button id="qb-next" type="button">下一題</button>
        <button id="qb-delete" class="qb-delete" type="button">刪除</button>
      </div>
    `;
    anchor.insertAdjacentElement("afterend", section);

    const style = document.createElement("style");
    style.textContent = `
      #vcf-question-bank {
        width: min(100%, 1120px);
        display: flex;
        align-items: center;
        gap: 10px;
        flex-wrap: wrap;
        padding: 9px 11px;
        border: 1px solid #c9b978;
        border-radius: 7px;
        background: #fffbe9;
        box-shadow: 0 2px 8px #0001;
      }
      #vcf-question-bank .qb-heading {
        color: #594715;
        font-weight: 700;
        white-space: nowrap;
      }
      #vcf-question-bank .qb-actions {
        display: flex;
        align-items: center;
        gap: 7px;
        flex-wrap: wrap;
      }
      #vcf-question-bank button {
        min-height: 36px;
        padding: 7px 11px;
        border: 1px solid #a58d45;
        border-radius: 6px;
        background: #fff;
        color: #493c17;
        font: inherit;
        font-size: 13px;
        cursor: pointer;
      }
      #vcf-question-bank button.qb-delete {
        border-color: #cf9a92;
        color: #942d24;
      }
      #vcf-question-bank button:disabled {
        opacity: .45;
        cursor: default;
      }
      #vcf-question-bank #qb-position {
        min-width: 112px;
        padding: 7px 9px;
        border-radius: 6px;
        background: #f3ead0;
        color: #58481a;
        font-size: 13px;
        font-weight: 700;
        text-align: center;
        font-variant-numeric: tabular-nums;
      }
      @media (max-width: 520px) {
        #vcf-question-bank {
          align-items: stretch;
          flex-direction: column;
          gap: 7px;
        }
        #vcf-question-bank .qb-actions {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }
        #vcf-question-bank #qb-position {
          grid-column: 1 / -1;
          grid-row: 1;
        }
      }
    `;
    document.head.appendChild(style);

    const addButton = section.querySelector("#qb-add");
    const prevButton = section.querySelector("#qb-prev");
    const nextButton = section.querySelector("#qb-next");
    const deleteButton = section.querySelector("#qb-delete");
    const positionText = section.querySelector("#qb-position");

    let bank = [];
    let currentIndex = -1;
    let searchBusy = false;
    let storageBusy = true;
    let loadFailed = false;

    const isBusy = () => searchBusy || storageBusy;
    const currentBoard = () => normalizeBoard(window._getArr()) || new Array(BOARD_CELLS).fill(0);
    let trackedAttacker = inferAttacker(currentBoard());
    const currentAttacker = () => trackedAttacker;

    const findCurrentQuestion = () => {
      const board = currentBoard();
      return bank.findIndex(entry => sameQuestion(entry, board, currentAttacker()));
    };

    const updateControls = () => {
      const total = bank.length;
      if (loadFailed) positionText.textContent = "題庫載入失敗";
      else if (storageBusy && !total) positionText.textContent = "正在載入題庫…";
      else if (!total) positionText.textContent = "題庫 0 題";
      else if (currentIndex >= 0) positionText.textContent = `第 ${currentIndex + 1} / ${total} 題`;
      else positionText.textContent = `未選題／共 ${total} 題`;

      const disabled = isBusy() || loadFailed;
      addButton.disabled = disabled;
      prevButton.disabled = disabled || currentIndex <= 0;
      nextButton.disabled = disabled || total === 0 || currentIndex >= total - 1;
      deleteButton.disabled = disabled || currentIndex < 0 || currentIndex >= total;
    };

    const syncIndexToBoard = () => {
      currentIndex = findCurrentQuestion();
      updateControls();
    };

    const clearResultLayers = () => {
      if (typeof window._clearVCF === "function") window._clearVCF();
      if (typeof window._clearAnalysis === "function") window._clearAnalysis();
      if (typeof resetVcfGroups === "function") resetVcfGroups();
      if (typeof hideGeneratedOverlays === "function") hideGeneratedOverlays();
      if (typeof invalidateGeneratedResult === "function") invalidateGeneratedResult();
    };

    const loadQuestion = index => {
      if (index < 0 || index >= bank.length || isBusy()) return;
      currentIndex = index;
      clearResultLayers();
      window._setBoardArr(bank[index].board, bank[index].attacker);
      updateControls();
      if (typeof setStatus === "function") setStatus(`已載入題庫第 ${index + 1} 題，共 ${bank.length} 題`);
    };

    addButton.addEventListener("click", async () => {
      if (isBusy() || loadFailed) return;
      const board = currentBoard();
      if (!board.some(stone => stone !== 0)) {
        if (typeof setStatus === "function") setStatus("空白盤面不加入題庫");
        return;
      }

      const attacker = currentAttacker();
      const existing = bank.findIndex(entry => sameQuestion(entry, board, attacker));
      if (existing >= 0) {
        currentIndex = existing;
        updateControls();
        if (typeof setStatus === "function") setStatus(`此盤面與攻方已在題庫第 ${existing + 1} 題`);
        return;
      }

      storageBusy = true;
      updateControls();
      try {
        await addQuestion({ board, attacker });
        bank.push({ board, attacker });
        bank.sort((a, b) => {
          const boardOrder = boardToText(a.board).localeCompare(boardToText(b.board));
          return boardOrder || a.attacker - b.attacker;
        });
        currentIndex = bank.findIndex(entry => sameQuestion(entry, board, attacker));
        if (typeof setStatus === "function") {
          setStatus(`已加入 Supabase 題庫，目前是第 ${currentIndex + 1} 題，共 ${bank.length} 題`);
        }
      } catch (error) {
        console.error("題庫新增失敗", error);
        if (error.status === 409) {
          try {
            bank = await loadBank();
            currentIndex = bank.findIndex(entry => sameQuestion(entry, board, attacker));
            if (typeof setStatus === "function") setStatus("此盤面與攻方已存在 Supabase 題庫");
          } catch (reloadError) {
            console.error("題庫重新載入失敗", reloadError);
          }
        } else if (typeof setStatus === "function") {
          setStatus(`題庫新增失敗：${error.message}`);
        }
      } finally {
        storageBusy = false;
        updateControls();
      }
    });

    prevButton.addEventListener("click", () => {
      if (currentIndex > 0) loadQuestion(currentIndex - 1);
    });

    nextButton.addEventListener("click", () => {
      if (!bank.length) return;
      loadQuestion(currentIndex < 0 ? 0 : currentIndex + 1);
    });

    deleteButton.addEventListener("click", async () => {
      if (isBusy() || currentIndex < 0 || currentIndex >= bank.length) return;
      if (!window.confirm(`確定刪除題庫第 ${currentIndex + 1} 題？`)) return;

      const deletingIndex = currentIndex;
      const deleting = bank[deletingIndex];
      storageBusy = true;
      updateControls();
      try {
        await deleteQuestion(deleting);
        bank.splice(deletingIndex, 1);
        if (!bank.length) {
          currentIndex = -1;
          if (typeof setStatus === "function") setStatus("Supabase 題庫已清空；目前棋盤不變");
        } else {
          currentIndex = Math.min(deletingIndex, bank.length - 1);
          storageBusy = false;
          loadQuestion(currentIndex);
          storageBusy = true;
          if (typeof setStatus === "function") {
            setStatus(`已刪除題目，目前是第 ${currentIndex + 1} 題，共 ${bank.length} 題`);
          }
        }
      } catch (error) {
        console.error("題庫刪除失敗", error);
        if (typeof setStatus === "function") setStatus(`題庫刪除失敗：${error.message}`);
      } finally {
        storageBusy = false;
        updateControls();
      }
    });

    const boardSvg = document.getElementById("board-svg");
    if (boardSvg) {
      boardSvg.addEventListener("click", () => queueMicrotask(() => {
        trackedAttacker = inferAttacker(currentBoard());
        syncIndexToBoard();
      }));
    }

    const originalSetBoardArr = window._setBoardArr;
    window._setBoardArr = function(...args) {
      trackedAttacker = args[1] === 2 ? 2 : 1;
      const result = originalSetBoardArr.apply(this, args);
      queueMicrotask(syncIndexToBoard);
      return result;
    };

    if (typeof window._clearBoard === "function") {
      const originalClearBoard = window._clearBoard;
      window._clearBoard = function(...args) {
        const result = originalClearBoard.apply(this, args);
        trackedAttacker = 1;
        currentIndex = -1;
        updateControls();
        return result;
      };
    }

    if (typeof setBusy === "function") {
      const originalSetBusy = setBusy;
      setBusy = function(value) {
        originalSetBusy(value);
        searchBusy = Boolean(value);
        updateControls();
      };
    }

    const initialize = async () => {
      storageBusy = true;
      loadFailed = false;
      updateControls();
      try {
        bank = await loadBank();
        currentIndex = findCurrentQuestion();
      } catch (error) {
        console.error("Supabase 題庫載入失敗", error);
        loadFailed = true;
        if (typeof setStatus === "function") setStatus(`Supabase 題庫載入失敗：${error.message}`);
      } finally {
        storageBusy = false;
        updateControls();
      }
    };

    initialize();
  };

  if (document.readyState === "complete") install();
  else window.addEventListener("load", install, { once: true });
})();
