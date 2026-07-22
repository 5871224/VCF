# VCF Bitboard、Rapfi WebAssembly 來源與隔離

`/VCF/rapfi/` 現在是完整的 VCF Bitboard C++ WebAssembly 工作台；原本的 Rapfi／棋型比較頁保留在 `/VCF/rapfi/lab.html`。

本專案使用三個彼此獨立的 WebAssembly 輸出：

1. 官方 Rapfi C++ 引擎，只供實驗室對照。
2. VCF 自行實作的 14 種棋型／禁手模組。
3. VCF 自行實作的 Bitboard VCF 搜尋模組。

## 官方 Rapfi

- Rapfi 原始碼：https://github.com/dhbloo/rapfi
- Rapfi Networks：https://github.com/dhbloo/rapfi-networks
- Rapfi 授權：GNU General Public License v3.0 或後續版本
- Rapfi commit：`3aedf3a2ab0ab710a9f3d00e57d5287ceb864894`
- Networks commit：`918b757a129258e9e765f77fe17d507c2bb1a60b`
- Emscripten SDK：`3.1.74`

Rapfi 建置選項：

```text
-DNO_COMMAND_MODULES=ON
-DNO_MULTI_THREADING=ON
-DUSE_WASM_SIMD=ON
-DUSE_WASM_SIMD_RELAXED=OFF
-DCMAKE_BUILD_TYPE=Release
```

### 嚴格隔離原則

官方 Rapfi checkout 只以指定 commit 進行原生 CMake 建置：

- 不修改任何 Rapfi `.cpp`、`.h` 或其他原始碼。
- 不修改 Rapfi 的 `CMakeLists.txt`。
- 不把 VCF 函式連結進 Rapfi 的 `.wasm`。
- 不修改 `rapfi-networks` 的設定或權重檔。

Rapfi 維持官方建置輸出：

```text
rapfi-single-simd128.js
rapfi-single-simd128.wasm
rapfi-single-simd128.data
```

實驗室只透過 Rapfi 已存在的文字協定取得結果，包括 `TRACEBOARD`、`YXSHOWFORBID`、`YXBLOCK`、`YXNBEST` 與 `YXSEARCHDEFEND`。沒有新增 Rapfi 匯出函式。

## VCF 獨立 C++ Wasm 棋型引擎

原始碼：

```text
rapfi/vcf-pattern-engine.cpp
```

建置輸出：

```text
vcf-pattern-engine.js
vcf-pattern-engine.wasm
```

此模組完全不包含或連結 Rapfi 原始碼，獨立實作：

- 14 種單方向棋型：`DEAD`、`OL`、`B1`、`F1`、`B2`、`F2`、`F2A`、`F2B`、`B3`、`F3`、`F3S`、`B4`、`F4`、`F5`。
- 四方向 Pattern4 合併。
- 連珠黑棋長連、四四、真正三三與假禁手判斷。
- 三進位 key 已維護查表。
- 兩張 1024 輔助表加三進位表。
- 二進位 `2^20` 大表。

三種方法使用相同棋型分類規格與不同索引方式。載入時會窮舉有效線型確認三張表完全一致；GitHub Actions 另執行原生 C++ 隨機盤面、長連與正五測試。

## VCF Bitboard C++ Wasm 搜尋引擎

主要原始碼：

```text
rapfi/vcf-bitboard-engine.cpp
rapfi/vcf-bitboard-search-v2.cpp
```

題目產生器舊編碼相容層：

```text
rapfi/vcf-bitboard-legacy-extra.cpp
rapfi/vcf-bitboard-generator-compat.js
```

它們和 `vcf-pattern-engine.cpp` 連結成另一個完全獨立的模組：

```text
vcf-bitboard-engine.js
vcf-bitboard-engine.wasm
```

主要架構：

- 黑白各使用四個 `uint64_t`，表示完整 225 位棋盤。
- 落子與回復同步更新 Bitboard、雙 64-bit Zobrist key 及 225 格相容陣列。
- 空點以位元掃描產生，不由 JavaScript 逐格遞迴。
- 純 VCF 攻擊節點只展開合法的 `B4`、`F4`、`F5`。
- 每個攻方回合只統一掃描一次守方立即成五點；攻擊候選建立時，依該攻擊形成四的方向，直接保存一個或兩個強制防點，遞迴時不再為每個候選重掃整盤兩次。
- VCF 路線、單一路線防守、全部防守候選、VCT／加子逐點掃描及節點統計都在 C++ Wasm 內執行。
- 多點掃描可使用多個彼此獨立的單執行緒 Wasm Worker，不需要 SharedArrayBuffer。
- 同線雙四相容層由 C++ 重新確認同方向兩個成五點，用來維持既有題目產生器的 `24` 編碼。

### 單組與多組使用不同同型表

單組 VCF 使用 Rapfi 式固定大小 transposition table：

- 每個 entry 為 12 bytes，保存 32-bit signature、勝負、最佳手、可用深度、勝路長度及世代。
- 每個 64-byte bucket 保存 5 個 entry。
- 使用完整 Bitboard Zobrist key，並包含攻方及規則，因為單組 TT 會跨搜尋保留。
- 已證明勝利時可先走保存的最佳手；已完整證明失敗且深度足夠時可直接跳過。
- 找到第一組 VCF 就立即回傳，適合「找黑 VCF」「找白 VCF」及速度優先的補子搜尋。

多組 VCF 使用本次搜尋內的列舉同型表：

- 精確 key 只包含兩組獨立 64-bit 棋盤 Zobrist，不重複保存本次搜尋固定不變的攻方與規則。
- 同盤面由不同落子順序抵達時，不重複展開相同後續。
- 不使用單組 TT 的勝負 cutoff，因此不會只因某局面已知可勝便停止列舉其他分支。
- 同一個第一手找到一條路線後仍會繼續搜尋其他後續分支，直到達到結果數、節點限制或搜尋完成。
- 結果依攻守棋子集合做包含關係去重，較短的有效路線可取代包含它的較長路線。

多組剪枝有兩種模式：

- `嚴格多組 VCF（完全同盤）`：只剪除黑白 Bitboard 完全相同的攻方回合盤面，優先避免漏掉特殊超集合棋形。
- `高速多組 VCF（集合子集）`：除精確同盤外，若先前已完整證明可勝的黑白棋集合均為目前盤面的子集合，則依舊版語意剪除目前超集合分支，追求速度。

### 最短模式

最短模式以奇數 ply 逐層加深。不同深度共用精確盤面的無解表，entry 保存「已完整證明無解的最大剩餘深度」；後續搜尋遇到相同盤面且所需深度不超過已證明範圍時，可直接跳過。此表不跨不同盤面、攻方或規則的獨立搜尋共用。

### 精簡手順

「精簡手順」不是刪除初始盤面棋子，而是精簡已找到的 VCF 路線：

1. 從最後一組完整攻防層往第 1 層檢查。
2. 先把該層以前的攻防手放到暫存盤面。
3. 暫時略過該層攻方棋及下一顆守方棋。
4. 只把該層之後的尾段交給 `vcfBbValidateRoute`（`isVCF`）驗證。
5. 成立就永久刪除該層，否則保留。

「找黑 VCF」「找白 VCF」只有勾選時才執行；「多組 VCF」及補子搜尋的「多組 VCF（最少步）」模式永遠執行。

補子搜尋模式：

- `單組 VCF（速度）`：每個補子位置找到第一組 VCF 就回傳。
- `多組 VCF（最少步）`：使用選定的嚴格／高速多組剪枝配合逐層加深，先證明較短深度沒有解，再回傳最少步數 VCF。

JavaScript 只負責：

- 棋盤介面與路線繪製。
- 按鈕、暫停／重新啟動及結果顯示。
- 圖片／拍照匯入與校正介面。
- 題目產生器的候選組合流程。
- 完整搜尋與漸進加深的速度比較流程；兩邊實際搜尋都呼叫相同的 Bitboard C++ Wasm 核心。

題目產生器需要的 `getLevelPoint`、`isFoul`、`testLineFour`、`getBlockFourPoint` 由 Bitboard 模組提供相容介面；候選的 VCF 驗證與去重透過 `window.engineAPI` 呼叫 C++ Wasm，不回退到舊 `eval/worker.js`。

## Pages 路由

GitHub Actions 部署時：

- 將原本 `rapfi/index.html` 保存為 `/rapfi/lab.html`。
- 以原主頁 `makevcf.html` 生成新的 `/rapfi/index.html`，保留原主頁的全部操作、圖片匯入及題目產生器。
- 在原主頁 JavaScript 建立舊引擎前，先載入 `vcf-bitboard-engine.js` 與 `vcf-bitboard-main.js`。
- 載入 `vcf-bitboard-generator-compat.js`，再載入原題目產生器腳本。
- 先載入 `rapfi-bitboard-dashboard.js` 安裝搜尋模式及介面，再載入 `vcf-bitboard-speed.js` 包裝同一搜尋入口。
- `/rapfi/` 不載入 `eval/EvaluatorCore.js`、`eval/Evaluator.js`、`makevcf-optimized-search-v2.js` 或舊搜尋 Worker。
