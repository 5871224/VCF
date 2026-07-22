# Rapfi WebAssembly 來源、隔離與授權

本頁同時載入兩個彼此獨立的 WebAssembly 模組：

1. 官方 Rapfi C++ 引擎。
2. VCF 自行實作的 C++ Wasm 14 種棋型引擎。

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

頁面只透過 Rapfi 已存在的文字協定取得結果：

- `TRACEBOARD`：取得每個空點的官方 Pattern4。
- `YXSHOWFORBID`：取得官方禁手點清單。
- `YXBLOCK`／`YXBLOCKRESET`：計算純 VCF 前，封鎖不屬於眠四（死四）、活四或成五的根候選。
- `YXNBEST N`：只對 C++ Wasm 篩出的 `N` 個合法衝四以上根候選進入 Rapfi 官方 QVCF。
- `YXSEARCHDEFEND`：把根節點剩餘合法點列為 MultiPV，逐一計算防守結果。

VCF 工具只解析 Rapfi 原本就會輸出的 `EVAL`、`NODES`、`TOTALNODES`、`TOTALTIME`、`SPEED` 與 `BESTLINE`，沒有新增 Rapfi 匯出函式。

Rapfi 官方協定沒有逐方向輸出 Pattern2x，因此頁面不會用 VCF 的方向棋型冒充 Rapfi 結果。

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

三種方法使用相同的棋型分類規格與不同索引方式。模組載入時會窮舉所有有效線型，確認三張表完全一致；GitHub Actions 另外會執行原生 C++ 測試，包括 2,000 組隨機盤面、長連與正五案例。

純 VCF 根候選由 `rapfi/vcf-candidate-worker.js` 在獨立 Worker 中呼叫此 C++ Wasm：只接受至少一個方向為 `B4`、`F4` 或 `F5`，並排除連珠禁手。官方 Rapfi 和 VCF 棋型模組各自擁有獨立記憶體與匯出函式，網頁只負責協調與顯示結果。
