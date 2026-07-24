# 新版 Bitboard VCF 規格

適用入口：`/rapfi/`  
適用引擎：C++ Bitboard WebAssembly

> 本文件只描述目前正式運作的 Bitboard 工作台與共用題目產生器搜尋後端。修改程式時必須同步改寫本文件，並刪除被取代的舊規格。

## 1. 開發入口

處理本專案前依序閱讀：

1. [`AGENTS.md`](AGENTS.md)
2. 本文件
3. [`題目產生器規格.MD`](題目產生器規格.MD)（修改題目產生器時）
4. 與功能直接相關的程式與測試

文件必須與正式程式一致，不得同時保留互相衝突的新舊規則。

## 2. 現行架構

### 2.1 主分析

```text
/rapfi/
  → rapfi/rapfi-bitboard-dashboard.js
  → rapfi/vcf-bitboard-main.js
  → rapfi/vcf-bitboard-worker.js
  → rapfi/engine/vcf-bitboard-engine.js / .wasm
```

主要檔案：

| 路徑 | 用途 |
|---|---|
| `rapfi/vcf-bitboard-search-v2.cpp` | 搜尋核心組裝、匯出與自我測試 |
| `rapfi/vcf-bitboard-search-fast-part1.inc` ～ `part4.inc` | 單組 DFS、棋型掃描與候選處理 |
| `rapfi/vcf-bitboard-search-single-tt-v5.inc` | 單組四路精確同型表 |
| `rapfi/vcf-bitboard-search-exact-tt-v3.inc` | 多組完整盤面無解表 |
| `rapfi/vcf-bitboard-search-time-limit-v4.inc` | 多組時間、節點限制與停止狀態 |
| `rapfi/vcf-bitboard-search-multi-v3.inc` | 多組與最少步搜尋、嚴格／高速剪枝 |
| `rapfi/vcf-bitboard-worker.js` | Worker RPC、Wasm ABI 與統計資料 |
| `rapfi/vcf-bitboard-main.js` | 主執行緒與 Worker 管理 |
| `rapfi/rapfi-bitboard-dashboard.js` | 棋盤、搜尋選項、結果與進度 |
| `rapfi/rapfi-workbench-header.js` | Rapfi 連結與強制重新整理 |
| `rapfi/rapfi-question-bank.js` | 瀏覽器本機題庫 |

### 2.2 題目產生器搜尋

題目產生器使用自己的 Bitboard Worker，不共用主分析 Worker：

```text
makevcf-generator-core.js
  → rapfi/vcf-bitboard-worker.js
  → rapfi/engine/vcf-bitboard-engine.js / .wasm
```

規則：

- 題目產生器取消或重啟時，只處理自己的 Worker。
- 一般候選驗證使用 `shortest`。
- 「只保留目標 VCF」使用 `multi`。
- 兩種模式都依「多組剪枝」下拉選單使用 `fast` 或 `strict`。
- 頁面沒有下拉選單時，讀取 `vcf_multi_pruning`；沒有已儲存設定時預設 `fast`。
- 題目產生期間停用剪枝下拉選單，避免同一候選中途改變搜尋語意。
- 棋型與禁手同步函式由 `rapfi/vcf-bitboard-generator-compat.js` 提供。

## 3. 搜尋模式

### 3.1 `single`

用途：最快找到一組 VCF。

- 找到第一組立即返回。
- 使用單組專用四路精確同型表。
- 不列舉全部路線。
- 預設最大深度 200 ply。
- 工作台節點上限為 5,000,000。
- `pruning` 選項不改變單組流程。

### 3.2 `multi`

用途：在指定最大深度內列舉多組 VCF。

- 直接使用指定 `maxDepth`，不逐層加深。
- 固定精簡。
- 先用原始攻守手順做子集去重，再精簡保留路線。
- 最多回傳 64 組。
- 達到路線、時間或節點限制時保留部分結果。

### 3.3 `shortest`

用途：取得最少手數的一批 VCF。

- 逐奇數 ply 深度加深。
- 第一個找到結果的深度即為最短層。
- 回傳該最短層內保留下來的多組路線。
- 固定精簡。
- 使用與 `multi` 相同的同型表與剪枝規則。

## 4. 多組路線處理

正式順序：

```text
找到原始路線
  → 以原始攻守手順做子集去重
  → 淘汰被較短路線支配的延伸路線
  → 精簡保留下來的路線
  → 排除精簡後完全相同的輸出
  → 依手數排序
```

搜尋剪枝與輸出去重是不同功能：

- 搜尋剪枝決定 DFS 是否展開目前盤面。
- 輸出去重決定已找到的路線是否保留。
- 嚴格剪枝不使用勝型子集搜尋剪枝，但輸出仍做原始路線子集去重。

搜尋未完整時：

- 保留已找到路線。
- 不把未完整搜尋的盤面寫入無解表。
- 不得將部分結果描述為全部 VCF。

## 5. 單組精確同型表

結構：

```text
65,536 buckets × 4 ways
= 262,144 個表項
```

查表規則：

- Zobrist hash 先經 SplitMix64 finalizer。
- 使用混合後 hash 的低 16 位定位 bucket。
- 每個 bucket 最多檢查四項。
- tag 相同後仍完整比較黑、白 bitboard。
- `ply`、攻擊層與落子順序不屬於 key。
- 四路全滿時循環覆蓋其中一項。
- 覆蓋只可降低命中率，不得造成錯誤剪枝。

所有舊 ply 容器共用同一張表：

- 每次搜尋切換 generation。
- 不反覆配置或完整清空表格。
- generation 回繞時才清理 generation 標記。
- 相同完整盤面由不同 ply 容器查詢時仍必須命中。

## 6. 多組剪枝與同型表

### 6.1 嚴格剪枝 `strict`

只剪除完整黑白盤面完全相同，且先前已完整證明無解的狀態。

- `ply`、攻擊層與落子順序不屬於 key。
- 不使用已知勝型子集判斷。
- 中止或未完整搜尋的盤面不得寫入無解表。

### 6.2 多組完整盤面無解表

- 131,072 個直接對映表項。
- 每項保存完整黑 bitboard、完整白 bitboard 與非零 hash tag。
- 固定記憶體約 9 MiB。
- 不依 ply 分桶。
- 不使用 `unordered_set`、節點配置或執行中的 rehash。
- tag 通過後仍完整比較黑白 bitboard。
- 索引碰撞可覆蓋舊項目，但不得只因 hash 相同就剪枝。

### 6.3 高速剪枝 `fast`

高速模式包含：

1. 完整同盤無解剪枝。
2. 已完整證明有解的黑白棋集合子集剪枝。

只有完整搜尋完成的勝型才能加入子集資料。工作台與題目產生器都可依下拉選單使用高速剪枝。

## 7. 多組限制

### 7.1 路線上限

```text
MAX_ROUTES = 64
```

Wasm 輸出緩衝區最多容納 64 組。未同步修改 Worker、Wasm ABI、路線緩衝區與記憶體配置前，不得提高此上限。

### 7.2 工作台時間與節點

| 欄位 | 單位 | 預設 | `0` |
|---|---:|---:|---|
| 時間限制 | 秒 | 30 | 不限制時間 |
| 節點限制 | 百萬節點 | 20 | 不限制節點 |

`localStorage` 鍵：

```text
vcf_multi_time_seconds
vcf_multi_node_millions
vcf_multi_pruning
```

時間每 524,288 節點檢查一次；節點限制使用整數比較。

### 7.3 `maxNode` 封裝

多組可把兩種限制封裝在 32-bit `maxNode`：

```text
bit 31      ：封裝標記
bit 0..9    ：節點上限，單位百萬；0 = 不限制
bit 10..30  ：時間上限，單位秒；0 = 不限制
```

未設封裝標記時，數值直接作為節點上限。題目產生器傳入 `5,000,000`，代表五百萬節點且不設時間限制。

## 8. 題目產生器的 Bitboard 驗證

### 8.1 剪枝來源

每次題目搜尋送出前都重新讀取「多組剪枝」下拉選單：

```text
高速多組 VCF（集合子集） → pruning = fast
嚴格多組 VCF（完全同盤） → pruning = strict
```

呼叫端傳入的舊 `pruning` 值不得覆蓋目前下拉選單。題目產生期間下拉選單停用。

### 8.2 一般候選

一般候選呼叫：

```text
mode = shortest
pruning = 目前下拉選單
maxVCF = 64
maxDepth = 2 × 目標步數 + 1 ply
maxNode = 5,000,000
```

流程：

1. 搜尋目前最短的一批 VCF。
2. 重播每條路線，依題目步數規則計算攻方步數與標準完成盤面。
3. 若最短步數小於目標：
   - 未啟用補守子時淘汰候選。
   - 啟用補守子時，統計較短路線防守點，補一顆守方棋後重新搜尋。
4. 當目前最短步數等於目標時，必須至少有一條路線的標準完成盤面等於預期盤面。
5. 最短層高於目標、沒有 VCF 或沒有符合預期盤面的路線時淘汰。

自動補守：

- 每層最多嘗試六個防守點。
- 每個候選最多展開 42 個補守狀態。
- 已存在目標路線時，不可選擇會封鎖目標路線的防守點。
- 目標尚未出現在最短層時可先封鎖較短路線；每個分支最終仍必須重新證明目標存在。

### 8.3 只保留目標 VCF

勾選「只保留目標 VCF」時呼叫：

```text
mode = multi
pruning = 目前下拉選單
maxVCF = 64
maxDepth = 2 × 目標步數 + 1 ply
maxNode = 5,000,000
```

- 目標是步數相同且標準完成盤面相同的路線。
- 其他路線以守方棋逐步封鎖。
- 搜尋 `aborted`、回傳 64 組或達 5,000,000 節點時，沒有看到其他路線不能視為已證明唯一。
- 最終驗證必須至少保留一條目標路線，且不得存在其他路線。

## 9. Worker API

### 9.1 RPC

主執行緒送出：

```js
{ id, type, data }
```

Worker 回傳：

```js
{ id, ok, result, error }
```

主要指令：

- `init`
- `setGameRules`
- `findVCF`
- `isVCF`
- `getBlockVCF`
- `getLevelPoints`
- `trimVCFGroups`

### 9.2 `findVCF` 主要參數

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

主要回傳：

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

## 10. 工作台介面

搜尋選項：

- 精簡手順：主要影響單組；多組與最少步固定精簡。
- 多組剪枝：高速或嚴格；主分析與題目產生器共用目前選擇。
- 時間限制：秒。
- 節點限制：百萬節點。
- 補子搜尋：單組速度或多組最少步。

搜尋期間停用會改變搜尋語意或盤面的控制項。題目產生期間至少停用規則、攻方、步數、權重、補守選項、唯一題選項及多組剪枝。

頁首只保留：

- `Rapfi 官方對照／棋型實驗室`
- `強制重新整理`

強制重新整理會清除 Cache Storage、重新要求同網域資源並用時間戳重載，不清除 `localStorage`。

## 11. 本機題庫

儲存於目前瀏覽器的 `localStorage`：

```text
vcf_question_bank_v1
vcf_question_bank_index_v1
```

每題保存 225 格盤面、下一手顏色及加入時間。

操作：

- 加入題庫
- 上一題
- 下一題
- 刪除
- 顯示 `第 N / 總數 題`

規則：

- 空白盤面不能加入。
- 完整盤面相同時不重複新增。
- 切換題目時載入盤面與下一手，並清除舊路線、分析及答案圖層。
- 搜尋期間停用題庫按鈕。
- 題庫不跨瀏覽器或裝置同步。

## 12. 驗收

搜尋核心變更至少驗證：

1. Native C++ 編譯與自我測試。
2. LTO SIMD Wasm 編譯。
3. Wasm ABI 與匯出函式。
4. 單組四路表的完整盤面、跨 ply 與 generation 規則。
5. 嚴格與高速剪枝行為分離。
6. 多組中止不寫入未完成無解狀態。

題目產生器變更至少驗證：

1. 所有產生器 JavaScript 語法。
2. 獨立 Worker 與正確 Bitboard module URL。
3. 一般驗證使用 `shortest`。
4. 唯一題驗證使用 `multi` 並在飽和時拒絕唯一判定。
5. 下拉選單選 `fast` 時送出高速剪枝，選 `strict` 時送出嚴格剪枝。
6. 題目產生期間剪枝下拉選單停用。
7. `getBlockVCF` 回傳格式正規化。
8. 取消題目產生器不影響主分析 Worker。
9. 相關 Markdown 與正式程式一致。
