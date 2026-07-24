# VCF 專案現行開發規則

## 文件維護

- 每次修改功能、介面、搜尋邏輯、參數、預設值、資料格式或部署方式，必須在同一批變更中更新相關 Markdown 文件。
- Markdown 文件只描述目前正式狀態。
- 新規格取代舊規格時，直接改寫或刪除舊內容。
- 不保留修改歷程、版本沿革、已淘汰方案、過時預設值、過渡作法或「未來將改成」的內容。
- 不以新增附註的方式保留相互衝突的新舊規則。
- 完成程式修改前，必須確認相關 Markdown 與實際程式一致。

## 新版 Bitboard 工作台

修改 `/rapfi/` 前，必須先閱讀：

- [`新版Bitboard VCF規格.MD`](新版Bitboard%20VCF規格.MD)

主要執行路徑：

```text
/rapfi/
  → rapfi/rapfi-bitboard-dashboard.js
  → rapfi/vcf-bitboard-main.js
  → rapfi/vcf-bitboard-worker.js
  → C++ Bitboard WebAssembly
```

不可破壞的規則：

- 單組 VCF 找到第一組立即返回。
- 單組使用專用 256K 四路精確同型表。
- 多組與最少步固定先做原始路線子集去重，再精簡保留路線。
- 嚴格剪枝只以完整黑白棋盤完全相同判定同型。
- 高速剪枝在完整同盤無解剪枝之外，才使用已完整證明的勝型子集剪枝。
- 多組固定最多回傳 64 組；介面只設定時間與節點限制。
- 時間每 524,288 節點檢查一次。
- 因限制中止時保留已找到結果，但不得描述為完整列舉。

## 題目產生器

題目產生器目前使用獨立路徑：

```text
makevcf-generator-core.js
  → eval/worker.js
```

不得因 `/rapfi/` 存在 `window.engineAPI` 就自動改變題目產生器的 Worker 或驗證語意。

## 驗收

搜尋核心變更至少必須通過：

- Native C++ 編譯與自我測試。
- LTO SIMD Wasm 編譯。
- Wasm ABI 測試。
- JavaScript 語法檢查。
- 相同盤面與相同限制下的結果、節點數及耗時比較。

介面或資料儲存變更至少必須確認：

- 手機版操作正常。
- `localStorage` 資料格式與讀取相容。
- 搜尋執行中不能切換會改變盤面的控制項。
- 相關 Markdown 已同步更新且沒有殘留舊規格。
