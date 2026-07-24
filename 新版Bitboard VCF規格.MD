# 新版 Bitboard VCF 規格

適用入口：`/rapfi/`  
適用引擎：C++ Bitboard WebAssembly

> [!IMPORTANT]
> 本文件只描述目前正式運作的 `/rapfi/` Bitboard 工作台。
> 修改程式時必須同步更新本文件，並直接刪除被取代的舊規格、過時預設值與修改歷程。

---

## 1. 文件與開發入口

處理本專案前先閱讀：

1. [`AGENTS.md`](AGENTS.md)
2. 本文件
3. 與該功能直接相關的程式與測試

文件必須與正式程式一致；不得在同一份文件中保留互相衝突的新舊規則。

---

## 2. 現行架構

### 2.1 `/rapfi/` 主分析

```text
/rapfi/
  → rapfi/rapfi-bitboard-dashboard.js
  → rapfi/vcf-bitboard-main.js
  → rapfi/vcf-bitboard-worker.js
  → C++ Bitboard WebAssembly
```

頁面工具由相容層載入：

```text
rapfi/vcf-bitboard-generator-compat.js
  → rapfi/rapfi-workbench-header.js
  → rapfi/rapfi-question-bank.js
```

主要檔案：

| 路徑 | 用途 |
|---|---|
| `rapfi/vcf-bitboard-search-v2.cpp` | 搜尋核心組裝、正式匯出與自我測試入口 |
| `rapfi/vcf-bitboard-search-fast-part1.inc` ～ `part4.inc` | 單組搜尋 DFS、棋型掃描與候選處理 |
| `rapfi/vcf-bitboard-search-single-tt-v5.inc` | 單組專用四路精確同型表 |
| `rapfi/vcf-bitboard-search-exact-tt-v3.inc` | 多組完整盤面無解精確同型表 |
| `rapfi/vcf-bitboard-search-time-limit-v4.inc` | 多組時間、節點限制與停止狀態 |
| `rapfi/vcf-bitboard-search-multi-v3.inc` | 多組與最少步搜尋、嚴格／高速剪枝 |
| `rapfi/vcf-bitboard-worker.js` | Worker、Wasm ABI、路線與統計資料包裝 |
| `rapfi/vcf-bitboard-main.js` | 主執行緒引擎介面與 Worker 管理 |
| `rapfi/rapfi-bitboard-dashboard.js` | 棋盤、搜尋操作、結果與進度介面 |
| `rapfi/rapfi-workbench-header.js` | Rapfi 連結與強制重新整理 |
| `rapfi/rapfi-question-bank.js` | 瀏覽器本機題庫 |

### 2.2 題目產生器

題目產生器使用獨立路徑：

```text
makevcf-generator-core.js
  → eval/worker.js
```

不得因 `/rapfi/` 存在 `window.engineAPI` 就自動改變題目產生器的 Worker 或驗證語意。

---

## 3. 核心搜尋規則

### 3.1 單組與多組分離

- 單組使用專用搜尋路徑，找到第一組 VCF 立即返回。
- 多組與最少步使用多組列舉核心。
- 多組剪枝設定不得影響單組搜尋結果或熱路徑。
- 多組功能不得把時間檢查、路線列舉或輸出整理成本加入單組熱路徑。

### 3.2 多組固定精簡

`multi` 與 `shortest` 固定精簡路線；即使呼叫端傳入 `simplify: false` 也不取消精簡。

### 3.3 多組路線處理順序

```text
找到原始路線
  → 以原始攻守手順做子集去重
  → 淘汰被既有較短路線支配的延伸路線
  → 精簡保留下來的路線
  → 排除精簡後完全相同的輸出
  → 依手數排序
```

不得改成先精簡每一條新路線再做原始子集去重。

### 3.4 搜尋剪枝與輸出去重分離

- 搜尋剪枝決定 DFS 是否展開盤面。
- 輸出子集去重決定已找到的路線是否保留。

嚴格剪枝不使用勝型子集搜尋剪枝，但多組輸出仍執行原始路線子集去重。

### 3.5 部分結果

搜尋因 64 組、時間、節點或人工中止而停止時：

- 保留已找到的路線。
- 不把未完整搜尋的盤面寫入無解同型表。
- UI 必須提示結果可能不完整。
- 不得把部分結果描述為全部 VCF。

---

## 4. 搜尋模式

### 4.1 `single`

用途：最快找到一組 VCF。

- 找到第一組立即返回。
- 使用單組專用四路精確同型表。
- 不列舉所有路線。
- 預設最大深度 200 ply。
- 工作台節點上限為 5,000,000。
- `pruning` 的嚴格／高速選項不改變單組流程。

### 4.2 `multi`

用途：在指定最大深度內列舉多組 VCF。

- 直接使用指定的 `maxDepth`，不逐層加深。
- 固定精簡。
- 先原始子集去重，再精簡。
- 最多回傳 64 組。
- 達到任一限制時保留部分結果。

### 4.3 `shortest`

用途：尋找最少手數的多組 VCF。

- 逐奇數深度加深。
- 第一個找到結果的深度為最短層。
- 固定精簡。
- 使用與 `multi` 相同的多組限制與剪枝規則。

---

## 5. 單組精確同型表

單組使用 `rapfi/vcf-bitboard-search-single-tt-v5.inc`：

```text
65,536 buckets × 4 ways
= 262,144 個表項
```

查表規則：

- Zobrist hash 先經 SplitMix64 finalizer。
- 使用混合後 hash 的低 16 位定位 bucket。
- 每個 bucket 最多檢查 4 個表項。
- tag 相同後仍完整比較黑、白 bitboard。
- `ply`、攻擊層與落子順序不屬於命中 key。
- 四路全滿時，以循環 victim 覆蓋其中一格。
- 碰撞覆蓋只會降低後續命中率，不得造成錯誤剪枝。

所有舊 ply 容器共用同一張表：

- 每次新搜尋只切換 generation。
- 不反覆配置或完整清空表格。
- generation 回繞時才清理 generation 標記。
- 相同完整盤面由不同 ply 容器查詢時仍必須命中。

真正命中必須同時符合：

```text
完整黑棋 bitboard 相同
且
完整白棋 bitboard 相同
```

不得只比較 bucket、tag、單一 64-bit hash 或 ply。

---

## 6. 多組剪枝與同型表

### 6.1 嚴格剪枝 `strict`

嚴格模式只剪除完整黑白盤面完全相同、且先前已完整證明無解的狀態。

- `ply`、攻擊層與落子順序不屬於 key。
- 不檢查已知勝型是否為目前盤面的子集。
- 中止或未完整搜尋的盤面不得寫入無解表。

### 6.2 多組完整盤面無解表

多組使用 `rapfi/vcf-bitboard-search-exact-tt-v3.inc` 的固定容量直接對映表：

- 131,072 個表項。
- 每項保存完整黑 bitboard、完整白 bitboard 與非零 hash tag。
- 固定記憶體約 9 MiB。
- 不依 ply 分桶。
- 不使用 `unordered_set`、節點配置或 rehash。
- 每次查詢只定位一個表項。
- tag 通過後仍完整比較黑白 bitboard。
- 索引碰撞可覆蓋舊項目，但不得只因 hash 相同就剪枝。

### 6.3 高速剪枝 `fast`

高速模式包含：

1. 完整同盤無解剪枝。
2. 已完整證明有解的黑白棋集合子集剪枝。

只有完整搜尋完成的勝型才能加入高速剪枝資料。若已證明勝型的黑棋集合與白棋集合都分別包含於目前盤面，該分支只會形成被輸出子集去重淘汰的延伸路線，可停止展開。

---

## 7. 多組搜尋限制

### 7.1 組數

Wasm 路線輸出緩衝區固定最多容納 64 組：

```text
MAX_ROUTES = 64
```

介面不提供組數設定欄位。未改變 Worker、Wasm ABI、路線緩衝區與記憶體配置前，不得取消此上限。

### 7.2 時間與節點

工作台提供：

| 欄位 | 單位 | 預設 | `0` 的意義 |
|---|---:|---:|---|
| 時間限制 | 秒 | 30 | 不限制時間 |
| 節點限制 | 百萬節點 | 20 | 不限制節點 |

`localStorage` 鍵：

```text
vcf_multi_time_seconds
vcf_multi_node_millions
```

介面範圍：

- 時間：0～2,097,151 秒。
- 節點：0～1,023 百萬節點。

### 7.3 ABI 封裝

多組把時間與節點封裝在既有 32-bit `maxNode` 參數：

```text
bit 31      ：封裝標記
bit 0..9    ：節點上限，單位百萬；0 = 不限制
bit 10..30  ：時間上限，單位秒；0 = 不限制
```

單組的 `maxNode` 仍是一般節點整數。

### 7.4 時間檢查

時間每 524,288 節點檢查一次：

```cpp
(nodes & ((1u << 19) - 1)) == 0
```

- 不得每個節點讀取系統時間。
- 時間停止可能略晚於設定值。
- 節點限制使用每節點的便宜整數比較。

### 7.5 停止狀態

任一限制先到即停止並保留結果：

- 64 組上限。
- 時間限制。
- 節點限制。
- 人工取消或其他中止條件。

C++ 統計會在保留欄位記錄時間或節點停止原因；Worker 對外回傳 `aborted`，UI 依組數、設定值與統計顯示停止提示。

---

## 8. 結果與進度

搜尋進行中顯示：

- 分析色。
- 多組的嚴格或高速剪枝。
- 已執行秒數。
- 固定最多 64 組。
- 時間與節點限制。

搜尋完成後顯示：

- 唯一起點數。
- 最短手數。
- 最終組數。
- 節點數。
- nodes/s。
- 是否因組數、時間或節點限制停止。
- 搜尋是否完整。

UI 計時器只負責畫面更新；正式時間停止由 C++ 搜尋核心判斷。

---

## 9. `/rapfi/` 介面

### 9.1 搜尋設定

目前設定包含：

- 精簡手順：主要影響單組；多組與最少步固定精簡。
- 多組剪枝：`fast` 或 `strict`。
- 時間限制：秒。
- 節點限制：百萬節點。
- 補子搜尋：單組速度或多組最少步。

搜尋執行中必須停用會改變搜尋語意或盤面的設定與題庫操作。

### 9.2 頁首

頁首只包含：

1. `Rapfi 官方對照／棋型實驗室`。
2. `強制重新整理`。

### 9.3 強制重新整理

按鈕流程：

1. 清除同網域 Cache Storage。
2. 蒐集目前已載入的同網域資源。
3. 以 `fetch(..., { cache: "reload" })` 重新取得資源。
4. 在目前網址加入 `_refresh=<時間戳>`。
5. 使用 `location.replace()` 重新載入。

不得清除 `localStorage`，因此目前盤面、搜尋設定與題庫會保留。

### 9.4 本機題庫

題庫資料保存在目前瀏覽器的 `localStorage`：

```text
vcf_question_bank_v1
vcf_question_bank_index_v1
```

每題格式：

```js
{
  board: [225 格盤面],
  nextColor: 1 | 2,
  addedAt: 時間戳
}
```

題庫區塊包含：

- `加入題庫`。
- `上一題`。
- `下一題`。
- `刪除`。
- 題號顯示。

題號顯示格式：

```text
題庫 0 題
第 N / 總數 題
未選題／共 N 題
```

操作規則：

- 空白盤面不得加入。
- 完整 225 格盤面相同時視為同一題，不重複新增。
- 重複加入時定位到既有題號。
- 切換題目時載入完整盤面與下一手顏色。
- 切換前清除舊 VCF 路線、分析標記、多組索引與題目答案圖層。
- 手動修改、匯入或清空盤面後重新比對題號。
- 刪除前顯示確認視窗。
- 刪除後載入原位置的新題目；刪除最後一題時載入上一題。
- 題庫清空後保留目前棋盤。
- 搜尋執行中停用題庫按鈕。
- 手機版按鈕排成兩欄，題號占一整列。

題庫只存在目前瀏覽器，不自動同步到其他裝置、瀏覽器或無痕模式。

---

## 10. API 與回傳資料

`findVCF` 主要參數：

```js
{
  arr,
  color,
  rules,
  mode: "single" | "multi" | "shortest",
  pruning: "strict" | "fast",
  simplify,
  maxVCF,
  maxDepth,
  maxNode
}
```

主要回傳欄位：

```js
{
  winMoves,
  vcfCount,
  nodeCount,
  elapsedMs,
  nodesPerSecond,
  routeCount,
  candidateCount,
  maxPly,
  aborted,
  searchMode,
  pruning,
  simplified
}
```

---

## 11. 驗收規則

搜尋核心變更至少驗證：

1. Native C++ 編譯與自我測試成功。
2. LTO SIMD Wasm 編譯成功。
3. Wasm ABI 測試成功。
4. JavaScript 語法檢查成功。
5. 單組找到第一組立即返回。
6. 單組相同盤面可跨 ply 容器命中。
7. 新 generation 不命中上一輪資料。
8. hash 相同但完整盤面不同時不得命中。
9. 嚴格與高速剪枝走不同邏輯。
10. 多組先原始子集去重，再精簡。
11. 中止時保留已找到結果，不寫入未證明無解盤面。
12. 題目產生器仍使用獨立 `eval/worker.js`。

效能變更必須在相同盤面、模式、深度與限制下比較：

- 總耗時。
- 節點總數。
- nodes/s。
- 找到的路線。
- Native 與正式 LTO SIMD Wasm。

不得只以 nodes/s 判斷整體搜尋速度。

介面與資料儲存變更至少驗證：

- 手機版操作。
- `localStorage` 讀寫與相容性。
- 搜尋中控制項停用。
- 題庫切換後盤面與顯示一致。
- 相關 Markdown 已同步更新，且沒有殘留舊規格或修改歷程。
