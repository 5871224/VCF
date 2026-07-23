# ⚠️ 版本分流：先確認正在修改哪一版

- 修改新版 `/rapfi/` C++ Bitboard 工作台前，必須先閱讀 [`新版Bitboard VCF規格.MD`](新版Bitboard%20VCF規格.MD)。
- 本文件下方內容主要記錄舊版 `makevcf.html → eval/worker.js → Evaluator` 架構。
- 不得把本文件中的舊版 Worker、`maxVCF=20`、搜尋參數或流程直接套用到新版 `/rapfi/`。
- 題目產生器目前仍刻意使用舊版獨立 Worker；不要因新版頁面存在 `window.engineAPI` 就自動切換。

---

# VCF 專案筆記

連珠/五子棋 VCF 分析工具。計算完全在用戶端跑（WebAssembly），不需伺服器。

---

## 檔案結構

| 路徑 | 說明 |
|------|------|
| `makevcf.html` | 主頁，所有 UI 與引擎封裝都在此 |
| `eval/worker.js` | Web Worker，接收 cmd/param 指令，調用引擎函式 |
| `eval/Evaluator.js` | JS 引擎層，定義所有公開函式與常數 |
| `eval/EvaluatorWebassembly.js` | Wasm 後端（主要路徑） |
| `eval/EvaluatorJScript.js` | 純 JS 後備後端 |
| `eval/Evaluator.wasm` | 編譯好的 C++ Wasm |

---

## 引擎常數（Evaluator.js）

```
GOMOKU_RULES = 1   無禁手
RENJU_RULES  = 2   有禁手（黑棋三三/四四/長連禁手）

level ≥ 10          連五（已五連，立即贏）
LEVEL_FREEFOUR   = 9   活四
LEVEL_NOFREEFOUR = 8   沖四
LEVEL_FREETHREE  = 7   活三
LEVEL_VCF        = 6
LEVEL_VCT        = 4
LEVEL_NONE       = 0
```

`getLevelPoint(idx, color, arr)` 回傳值用 `& 0x0f` 取低 4 位得 level。

---

## Worker 通訊協議

主頁 → Worker：`{ cmd: "指令名", param: {...} }`
Worker → 主頁：`{ cmd: "resolve", param: 結果 }`

### 已支援的 cmd

| cmd | 參數 | 回傳 |
|-----|------|------|
| `setGameRules` | `{rules}` | — |
| `findVCF` | `{arr, color, maxVCF, maxDepth, maxNode}` | vcfInfo |
| `isVCF` | `{color, arr, moves}` | boolean |
| `getBlockVCF` | `{arr, color, vcfMoves, includeFour}` | idx[] |
| `getBlockPoints` | `{arr, color, radius, maxVCF, maxDepth, maxNode}` | idx[] |
| `selectPoints` | `{arr, color, radius, ...}` | arr225 |
| `selectPointsLevel` | `{arr, color, radius, ...}` | arr225 |
| `getLevelB` | `{arr, color, maxVCF, maxDepth, maxNode}` | levelBInfo |
| `getLevelPoints` | `{arr, color, placeColor, indices, maxDepth, maxNode}` | `{items:[{idx,label}], nodeCount}` |
| `trimVCFGroups` | `{arr, groups, color}` | groups（修剪後） |

---

## getLevelPoints 邏輯

對每個空格（或 `indices` 指定的格子）試落 `placeColor`，判斷威脅等級：

```
for i in scan:
  arr[i] = placeColor

  if placeColor === color:
    level = getLevelPoint(i, color, arr) & 0x0f
    if level >= 10 → label "5"（連五）
    if level = 8 or 9 → label "4"（沖四/活四）

  findVCF(arr, color, 1, maxDepth, maxNode)
  if VCF 找到 → label = winMoves[0].length（步數）

  arr[i] = 0
```

### 三種使用場景

| 按鈕 | placeColor | color | 意義 |
|------|------|------|------|
| VCT點 | = color（同色） | 分析色 | 我方每格落子後，自己能否得 VCF |
| 補黑找VCF | 1（黑） | 分析色 | 補黑子後，分析色能否得 VCF |
| 補白找VCF | 2（白） | 分析色 | 補白子後，分析色能否得 VCF |

---

## findVCF 引擎修改（連五預掃）

`EvaluatorWebassembly.js` 與 `EvaluatorJScript.js` 的 `findVCF`，在正常搜索前先掃描連五。
**關鍵**：預掃放在 wasm `int8Arr / putArr / putInitArr` 初始化之前，避免 wasm 記憶體被污染。

```javascript
const fives = [];
for (let i = 0; i < 225; i++) {
    if (arr[i] === 0) {
        arr[i] = color;
        if ((getLevelPoint(i, color, arr) & 0x0f) >= 10) fives.push([i]);
        arr[i] = 0;
        if (fives.length >= maxVCF) break;
    }
}
if (fives.length) {
    resetVCF(arr, color, maxVCF, maxDepth, maxNode);
    for (const m of fives) vcfWinMoves.push(m);
    vcfInfo.vcfCount = fives.length;
    vcfInfo.nodeCount = fives.length;
    return vcfWinMoves;
}
```

---

## makevcf.html 架構

### VCFEngine class（單一 Worker）
- `this._rules`：當前規則（預設 2 有禁手）
- `_post(cmd, param)`：Promise 封裝 Worker 通訊（單次一個指令）
- `setRules(rules)`：重啟 Worker 並重設規則
- `cancel()`：中止搜尋並重啟 Worker

### WorkerPool class（多核並行）
- 開 `min(hardwareConcurrency, 8)` 個 Worker
- `getLevelPoints`：將空格依核心數分塊，同時派發給各 Worker，最後合併結果
- 補黑/補白找VCF 使用此 pool 並行

### SVG 圖層（由下到上）
1. `stoneLayer`：已擺棋子
2. `vcfLayer`：VCF 路線（橙色邊框棋子 + 序號）
3. `analysisLayer`：分析標記（圓點/標籤/三角/環/叉）

---

## 按鈕功能

### 主列（#btns）
| 按鈕 | 功能 |
|------|------|
| 黑子VCF / 白子VCF | 搜尋指定色的 VCF（maxVCF=1） |
| 暫停 | 中止搜索，重啟 engine + pool |
| 繼續 | 用上次 lastParam 重新搜索 |
| 清除路線/分析 | 清除 vcfLayer + analysisLayer |
| 清空棋盤 | 清空棋子＋路線＋分析 |

### 規則選擇（#rule-box）
有禁手（value=2，預設） / 無禁手（value=1）；切換時同時重啟 VCFEngine + WorkerPool。

### 分析色（#analysis-box）
黑（value=1，預設） / 白（value=2）；決定 VCF防守、VCT點、補黑/補白找VCF 的搜尋目標色。

### 分析列（#btns2）
| 按鈕 | 功能 |
|------|------|
| VCF防守 | 對 lastVCFMoves 找防守點（綠三角） |
| 全部VCF防守 | findVCF → getBlockVCF → pool 驗證 → 有效防守點（藍三角） |
| 多組VCF | findVCF maxVCF=20 → trimVCFGroups 去重修剪 → 導航顯示 |
| 上一組 / 下一組 | 在 vcfGroups 間切換顯示 |
| VCT點 | 先查是否已有 VCF；有則顯示路線。否則 getLevelPoints 標記各格 |
| 補黑找VCF | pool.getLevelPoints（placeColor=1，color=分析色） |
| 補白找VCF | pool.getLevelPoints（placeColor=2，color=分析色） |

---

## 分析點顏色規則

| label | 意義 | 顏色 |
|-------|------|------|
| `"5"`（字串） | 連五（立即贏） | `#ff66aa`（粉紅） |
| `"4"`（字串） | 沖四 or 活四 | `#c05000`（橘褐） |
| 數字（如 5、7） | VCF 步數 | `#7799ee`（短步）→ `#001188`（長步），lerpColor 插值 |

最長步數的 VCF 點額外加藍色外環（`#00ccff`）。
VCF防守點：綠三角 `#00cc44`；全部VCF防守點：藍三角 `#4488ff`。

---

## trimVCFGroups 邏輯

對多組 VCF 路線後處理：
1. 重建棋盤，若最後一步是活四（level=9）則移除（剪尾）
2. 用修剪後的正規化 key 去重（保留原始手順顯示）
3. 按長度排序（短的優先）

---

## 重要設計決策

- **label 用字串 "5"/"4" 區分**：避免與 VCF 步數數字混淆，顏色函式以 `=== "5"` / `=== "4"` 判斷。
- **localStorage 自動儲存盤面**：key = `"vcf_board"`，格式 `{b: arr225, nc: nextColor}`。
- **VCT 判斷是啟發式**：`getLevelB` 只用 findVCF nodeCount > 2 近似，非真正 VCT 搜尋。
