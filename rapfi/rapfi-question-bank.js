"use strict";

(function installQuestionBank() {
  const STORAGE_KEY = "vcf_question_bank_v1";
  const INDEX_KEY = "vcf_question_bank_index_v1";
  const BOARD_CELLS = 225;

  const normalizeBoard = value => {
    if (!Array.isArray(value) && !(value && typeof value.length === "number")) return null;
    const board = new Array(BOARD_CELLS);
    for (let i = 0; i < BOARD_CELLS; i++) {
      const stone = Number(value[i]);
      board[i] = stone === 1 || stone === 2 ? stone : 0;
    }
    return board;
  };

  const sameBoard = (left, right) => {
    if (!left || !right || left.length < BOARD_CELLS || right.length < BOARD_CELLS) return false;
    for (let i = 0; i < BOARD_CELLS; i++) {
      if (left[i] !== right[i]) return false;
    }
    return true;
  };

  const readNextColor = board => {
    try {
      const saved = JSON.parse(localStorage.getItem("vcf_board") || "null");
      if (saved && (saved.nc === 1 || saved.nc === 2)) return saved.nc;
    } catch (_) {}

    let black = 0;
    let white = 0;
    for (const stone of board) {
      if (stone === 1) black++;
      else if (stone === 2) white++;
    }
    return black > white ? 2 : 1;
  };

  const loadBank = () => {
    try {
      const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
      if (!Array.isArray(raw)) return [];
      return raw.map((entry, index) => {
        const source = Array.isArray(entry) ? entry : entry?.board;
        const board = normalizeBoard(source);
        if (!board) return null;
        return {
          board,
          nextColor: entry?.nextColor === 2 ? 2 : 1,
          addedAt: Number(entry?.addedAt) || index + 1,
        };
      }).filter(Boolean);
    } catch (_) {
      return [];
    }
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
        <span id="qb-position" aria-live="polite">題庫 0 題</span>
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
        min-width: 94px;
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

    let bank = loadBank();
    let currentIndex = -1;
    let busy = false;

    const persist = () => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(bank));
        if (currentIndex >= 0) localStorage.setItem(INDEX_KEY, String(currentIndex));
        else localStorage.removeItem(INDEX_KEY);
        return true;
      } catch (error) {
        console.error("題庫儲存失敗", error);
        if (typeof setStatus === "function") setStatus("題庫儲存失敗：瀏覽器儲存空間可能已滿");
        return false;
      }
    };

    const currentBoard = () => normalizeBoard(window._getArr()) || new Array(BOARD_CELLS).fill(0);

    const findCurrentBoard = () => {
      const board = currentBoard();
      return bank.findIndex(entry => sameBoard(entry.board, board));
    };

    const updateControls = () => {
      const total = bank.length;
      if (!total) positionText.textContent = "題庫 0 題";
      else if (currentIndex >= 0) positionText.textContent = `第 ${currentIndex + 1} / ${total} 題`;
      else positionText.textContent = `未選題／共 ${total} 題`;

      addButton.disabled = busy;
      prevButton.disabled = busy || currentIndex <= 0;
      nextButton.disabled = busy || total === 0 || currentIndex >= total - 1;
      deleteButton.disabled = busy || currentIndex < 0 || currentIndex >= total;
    };

    const syncIndexToBoard = () => {
      currentIndex = findCurrentBoard();
      try {
        if (currentIndex >= 0) localStorage.setItem(INDEX_KEY, String(currentIndex));
        else localStorage.removeItem(INDEX_KEY);
      } catch (_) {}
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
      if (index < 0 || index >= bank.length) return;
      currentIndex = index;
      clearResultLayers();
      window._setBoardArr(bank[index].board, bank[index].nextColor);
      persist();
      updateControls();
      if (typeof setStatus === "function") setStatus(`已載入題庫第 ${index + 1} 題，共 ${bank.length} 題`);
    };

    addButton.addEventListener("click", () => {
      const board = currentBoard();
      if (!board.some(stone => stone !== 0)) {
        if (typeof setStatus === "function") setStatus("空白盤面不加入題庫");
        return;
      }

      const existing = bank.findIndex(entry => sameBoard(entry.board, board));
      if (existing >= 0) {
        currentIndex = existing;
        persist();
        updateControls();
        if (typeof setStatus === "function") setStatus(`此盤面已在題庫第 ${existing + 1} 題`);
        return;
      }

      bank.push({
        board,
        nextColor: readNextColor(board),
        addedAt: Date.now(),
      });
      currentIndex = bank.length - 1;
      if (!persist()) {
        bank.pop();
        currentIndex = findCurrentBoard();
        updateControls();
        return;
      }
      updateControls();
      if (typeof setStatus === "function") setStatus(`已加入題庫，目前是第 ${currentIndex + 1} 題，共 ${bank.length} 題`);
    });

    prevButton.addEventListener("click", () => {
      if (currentIndex > 0) loadQuestion(currentIndex - 1);
    });

    nextButton.addEventListener("click", () => {
      if (!bank.length) return;
      loadQuestion(currentIndex < 0 ? 0 : currentIndex + 1);
    });

    deleteButton.addEventListener("click", () => {
      if (currentIndex < 0 || currentIndex >= bank.length) return;
      if (!window.confirm(`確定刪除題庫第 ${currentIndex + 1} 題？`)) return;

      bank.splice(currentIndex, 1);
      if (!bank.length) {
        currentIndex = -1;
        persist();
        updateControls();
        if (typeof setStatus === "function") setStatus("題庫已清空；目前棋盤不變");
        return;
      }

      currentIndex = Math.min(currentIndex, bank.length - 1);
      persist();
      loadQuestion(currentIndex);
      if (typeof setStatus === "function") setStatus(`已刪除題目，目前是第 ${currentIndex + 1} 題，共 ${bank.length} 題`);
    });

    const boardSvg = document.getElementById("board-svg");
    if (boardSvg) boardSvg.addEventListener("click", () => queueMicrotask(syncIndexToBoard));

    const originalSetBoardArr = window._setBoardArr;
    window._setBoardArr = function(...args) {
      const result = originalSetBoardArr.apply(this, args);
      queueMicrotask(syncIndexToBoard);
      return result;
    };

    if (typeof window._clearBoard === "function") {
      const originalClearBoard = window._clearBoard;
      window._clearBoard = function(...args) {
        const result = originalClearBoard.apply(this, args);
        currentIndex = -1;
        updateControls();
        return result;
      };
    }

    if (typeof setBusy === "function") {
      const originalSetBusy = setBusy;
      setBusy = function(value) {
        originalSetBusy(value);
        busy = Boolean(value);
        updateControls();
      };
    }

    currentIndex = findCurrentBoard();
    try {
      if (currentIndex >= 0) localStorage.setItem(INDEX_KEY, String(currentIndex));
      else localStorage.removeItem(INDEX_KEY);
    } catch (_) {}
    updateControls();
  };

  if (document.readyState === "complete") install();
  else window.addEventListener("load", install, { once: true });
})();
