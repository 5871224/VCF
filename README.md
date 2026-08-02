# VCF Analyzer

15×15 連珠／五子棋 VCF 局面分析、題庫與題目產生工具。

唯一正式網站：<https://5871224.github.io/VCF/>

根網址直接載入新版 Bitboard 工作台；`/rapfi/` 只作為引擎、Worker、介面模組與實驗室資源目錄。

## 主要功能

- 黑方／白方單組、多組與最短 VCF。
- 單一路線及全部 VCF 防守。
- VCT 候選點與補黑／補白搜尋。
- 有禁、無禁、自由三種規則及黑棋禁手顯示。
- 圖片、截圖與手機相機棋盤匯入。
- Supabase 題庫。
- 指定 1～10 步的 VCF 題目產生器。
- 題目答案、N 點與逐顆補子回放。

## 正式架構

```text
/VCF/index.html（由 makevcf.html 建置）
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

## 文件

- [VCF 分析工具正式規格](規格書.MD)：工作台、搜尋、題庫與題目產生器的唯一產品規格。
- [專案開發規則](AGENTS.md)：開發、文件維護、驗證與部署規則。
- [禁手判斷規格](禁手判斷規格.MD)：棋型、長連與禁手遞迴的專門實作規格。

Markdown 只保留目前正式狀態。功能、參數、介面、資料格式或部署方式變更時，必須同步更新 `規格書.MD`，不得另建重複規格文件。
