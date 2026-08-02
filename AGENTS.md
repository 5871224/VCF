# VCF 專案開發規則

## 1. 文件

- [`規格書.MD`](規格書.MD) 是工作台、搜尋核心、題庫與題目產生器的唯一正式產品規格。
- [`禁手判斷規格.MD`](禁手判斷規格.MD) 只保存棋型、長連與禁手遞迴的實作規格。
- [`檔案用途總覽.MD`](檔案用途總覽.MD) 保存所有追蹤檔案、載入關係與使用狀態，不複製產品行為規格。
- 本檔只保存開發流程與不可跨越的專案邊界，不複製產品功能規格。
- 每次修改功能、介面、搜尋邏輯、參數、預設值、資料格式或部署方式，必須在同一批變更更新 `規格書.MD`。
- 新增、刪除、重新命名檔案，或改變載入／建置關係時，必須在同一批變更更新 `檔案用途總覽.MD`。
- Markdown 只描述目前正式狀態；新規格取代舊規格時直接改寫或刪除舊內容，不保留版本沿革、淘汰方案或互相衝突的附註。
- 修改完成前，搜尋根目錄及相關子目錄的 Markdown 與 workflow，確認沒有殘留已刪除文件的連結或舊數值。

## 2. 正式入口

唯一正式網址：

```text
https://5871224.github.io/VCF/
```

正式路徑：

```text
/VCF/（部署產物 index.html，由 makevcf.html 建置）
  → rapfi/engine/vcf-bitboard-engine.js / .wasm
  → rapfi/vcf-bitboard-main.js
  → rapfi/vcf-bitboard-worker.js
```

題目產生器使用獨立 Worker：

```text
makevcf-generator-core.js
  → rapfi/vcf-bitboard-worker.js
  → rapfi/engine/vcf-bitboard-engine.js / .wasm
```

- Pages 只部署根 `index.html` 作為工作台入口；直接開啟 `/VCF/index.html` 時應將顯示網址正規化為 `/VCF/`。
- `makevcf.html` 是根頁建置來源，不得複製為公開 `/VCF/makevcf.html`。
- `/rapfi/` 只作為引擎、Worker、UI 模組及明確命名的實驗室資源，不得建立另一份工作台 `index.html`。
- 題目產生器不得共用或中止主分析 Worker。

## 3. 規則值

規則值固定為：

- `0 = 自由`
- `1 = 無禁`
- `2 = 有禁`

不得使用會把 `0` 當成預設值的真假值回退。每個 Worker 搜尋、防守與棋型請求都要明確附帶規則值。

## 4. 變更原則

- 優先修改正式來源，不以額外修補層長期保留兩套互相覆蓋的邏輯。
- 題目產生器一次執行共用單一 `GenerationContext`；新增設定或控制項鎖定行為應使用具名提供者／Hook，不得覆寫 `genOptions` 或核心 `genSetBusy`。
- 題目產生器回放只可訂閱核心具名事件；不得覆寫驗證、搜尋、結果或忙碌函式，也不得操作舊回放按鈕、讀取已渲染盤面或用延遲排程合併時間軸。
- 題目產生器的搜尋驗證只有 `makevcf-generator-search-policy.js` 一套正式政策，最終唯一化與補齊只有 `makevcf-generator-finalize.js` 一套流程；不得再新增平行版本或包裝舊函式。
- 候選加成、設定、材料來源、狀態文字與結果摘要必須使用核心 Registry；功能模組不得重新指派全域 `gen*` 函式。
- 固定載入的介面模組必須一次初始化；除等待 OpenCV 等外部非同步資源外，不得用全頁 `MutationObserver`、輪詢或延遲重試拼裝介面。
- 建置腳本不得注入已淘汰的舊流程；程式重構後同步更新建置驗證。
- `makevcf.html` 必須明確列出正式腳本順序；`makevcf-mobile.js`、加成、相容、狀態或回放模組不得動態載入其他正式功能檔。
- Pages 與 CI 建置驗證不得使用 `writeFileSync`、字串替換或其他方式改寫 Git 追蹤來源。
- 搜尋限制、中止與部分結果必須可區分；不得把未完整結果描述為已證明。
- C++、Wasm、Worker、主執行緒與題目產生器若共用資料格式或 ABI，必須在同一批變更更新並驗證。
- 介面名稱、按鈕文字、選單值與文件用語必須一致。

## 5. 驗證

搜尋核心變更至少執行：

- Native C++ 編譯與自我測試。
- LTO SIMD Wasm 編譯。
- Wasm ABI 測試。
- JavaScript 語法檢查。
- 相同盤面與相同限制下的結果、節點與耗時比較。

題目產生器變更至少執行：

- 所有 `makevcf-generator-*.js` 語法檢查。
- 專用 Worker、規則傳遞、搜尋限制與剪枝選擇測試。
- 一般題、白方抓禁題、較短／其他 VCF 補守、最終補齊與回放測試。
- 桌機與手機版面檢查。
- `規格書.MD` 同步更新。

部署變更後：

- 確認 Pages artifact 只有根工作台入口，沒有 `makevcf.html`、`rapfi/index.html` 或已刪除的獨立工具頁。
- 確認 GitHub Pages `build` 與 `deploy` 都成功。
- 若由 `GITHUB_TOKEN` 產生的提交不會再次觸發 workflow，使用一般 `main` 提交或 `workflow_dispatch` 觸發。
