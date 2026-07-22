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

原始碼：

```text
rapfi/vcf-bitboard-engine.cpp
```

它和 `vcf-pattern-engine.cpp` 連結成另一個完全獨立的模組：

```text
vcf-bitboard-engine.js
vcf-bitboard-engine.wasm
```

主要架構：

- 黑白各使用四個 `uint64_t`，表示完整 225 位棋盤。
- 落子與回復同步更新 Bitboard 及 225 格相容陣列。
- 空點以位元掃描產生，不由 JavaScript 逐格遞迴。
- 純 VCF 攻擊節點只展開合法的 `B4`、`F4`、`F5`。
- 防守節點驗證唯一成五點、雙成五點、守方立即成五及連珠禁手。
- VCF 路線、單一路線防守、全部防守候選、VCT／加子逐點掃描及節點統計都在 C++ Wasm 內執行。
- 多點掃描可使用多個彼此獨立的單執行緒 Wasm Worker，不需要 SharedArrayBuffer。

JavaScript 只負責：

- 棋盤介面與路線繪製。
- 按鈕、暫停／重新啟動及結果顯示。
- 圖片／拍照匯入與校正介面。
- 題目產生器的候選組合流程。

題目產生器需要的 `getLevelPoint`、`isFoul`、`testLineFour`、`getBlockFourPoint` 由 Bitboard 模組提供相容介面；候選的 VCF 驗證與去重透過 `window.engineAPI` 呼叫 C++ Wasm，不回退到舊 `eval/worker.js`。

## Pages 路由

GitHub Actions 部署時：

- 將原本 `rapfi/index.html` 保存為 `/rapfi/lab.html`。
- 以原主頁 `makevcf.html` 生成新的 `/rapfi/index.html`，保留原主頁的全部操作、圖片匯入及題目產生器。
- 在原主頁 JavaScript 建立舊引擎前，先載入 `vcf-bitboard-engine.js` 與 `vcf-bitboard-main.js`。
- `/rapfi/` 不載入 `eval/EvaluatorCore.js`、`eval/Evaluator.js` 或舊搜尋 Worker。
