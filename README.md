# VCF Analyzer

15×15 連珠／五子棋 VCF 局面分析與題目產生工具。

目前主頁已整合：

- 黑方／白方 VCF 搜尋
- 單一路線與多組 VCF
- VCF 防守點與全部 VCF 防守點
- VCT／候選點分析
- 補黑、補白後逐點找 VCF
- 棋盤圖片匯入、透視校正與黑白棋辨識
- 指定攻方與 2～10 步的 VCF 題目產生
- 題目答案與黑方／白方／雙方 N 點顯示
- Web、WebAssembly、Electron、WebView2、Node 橋接與 C++ 搜尋版本

網站：<https://5871224.github.io/VCF/makevcf.html>

規格文件：

- [分析工具規格書](規格書.MD)
- [VCF 題目產生器規格](題目產生器規格.MD)

---

## 1. 文件範圍

本 README 以目前 `main` 分支的正式執行路徑為準。

函式整理原則：

1. 所有具名 JavaScript 函式、類別方法與公開的箭頭函式，依檔案列出中文用途。
2. 按鈕使用的匿名事件函式不虛構函式名稱，統一整理在「按鈕與函式對照」章節。
3. `app/engine_node.js` 與 `cpp/engine_node.js` 目前內容相同，只完整說明一次。
4. `Evaluator.wasm` 是編譯後二進位檔，不包含可直接閱讀的 JavaScript 函式；其 JavaScript 包裝函式列在 `EvaluatorWebassembly.js`。
5. `emoji/emoji.js` 只有符號常數，沒有函式。

---

## 2. 主要檔案與執行版本

| 路徑 | 版本／用途 |
|---|---|
| `makevcf.html` | 主分析頁；包含棋盤、分析按鈕、圖片匯入及 Web／桌面引擎介面 |
| `makevcf-generator-*.js` | VCF 題目產生器；主頁與獨立產生器頁共用 |
| `makevcf-generator.html` | 獨立測試用題目產生器頁 |
| `eval/Evaluator.js` | 共用棋型、VCF、VCT、雜湊與高階 API |
| `eval/EvaluatorJScript.js` | 純 JavaScript 棋型與 VCF 後端 |
| `eval/EvaluatorWebassembly.js` | WebAssembly 包裝器與 Wasm 版 VCF 搜尋控制 |
| `eval/Evaluator.wasm` | 編譯後的 Wasm 棋型核心 |
| `eval/worker.js` | Web Worker 指令分派層 |
| `app/main.js` | Electron 主程序；管理 `engine.exe` 與多程序池 |
| `app/preload.js` | Electron 安全橋接層，向頁面公開 `engineAPI` |
| `app/engine_node.js` | Node 指令列引擎橋接；載入 JS 棋力核心 |
| `cpp/` | C++ 棋盤、棋型、搜尋器、命令列引擎與 WebView2 主機 |
| `.github/workflows/pages.yml` | GitHub Pages 建置與產生器整合注入 |

### 2.1 Web 版

瀏覽器直接使用 `eval/worker.js`。Worker 優先載入 WebAssembly，沒有 WebAssembly 時才使用純 JavaScript 後端。

### 2.2 Electron 版

`app/main.js` 啟動一個主 `engine.exe` 與多個工作程序，透過 IPC 對頁面提供與 Web Worker 相同的命令介面。

### 2.3 WebView2 版

`cpp/host.cpp` 建立原生 Windows 視窗、WebView2 與 `engine.exe` 程序池，頁面透過 `window.chrome.webview` 傳送 JSON 訊息。

### 2.4 C++ 搜尋版

`cpp/Evaluator.*` 與 `cpp/Searcher.*` 提供原生棋型判斷、禁手與 VCF 搜尋。`cpp/Main.cpp` 目前主要負責啟動 Node 橋接程式；`cpp/host.cpp` 則是完整 WebView2 主機。

---

# 3. 按鈕與函式對照

## 3.1 主搜尋按鈕

### 黑子 VCF：`#btn-black`

呼叫流程：

```text
window._getArr
→ doSearch(arr, 1)
→ setBusy(true)
→ window._clearVCF
→ window._clearAnalysis
→ resetVcfGroups
→ engine.findVCF
→ window._showVCF
→ setStatus / elapsed / fmtNodes / fmtRate
→ setBusy(false)
```

用途：搜尋黑方第一組 VCF。

### 白子 VCF：`#btn-white`

與黑子 VCF 相同，但呼叫 `doSearch(arr, 2)`，搜尋白方第一組 VCF。

### 暫停：`#btn-stop`

```text
setBusy(false)
→ engine.cancel
→ pool.cancel
→ setStatus
```

用途：中止目前分析並重新建立單 Worker 與 Worker Pool。

### 繼續：`#btn-continue`

```text
lastParam
→ doSearch(lastParam.arr, lastParam.color)
```

用途：使用上一次棋盤與顏色重新搜尋。

### 清除路線／分析：`#btn-clear-vcf`

```text
window._clearVCF
→ window._clearAnalysis
→ resetVcfGroups
→ hideGeneratedOverlays（整合產生器）
```

用途：只清除顯示層，不清除棋子；同時隱藏題目答案與 N 點。

### 清空棋盤：`#btn-clear`

```text
window._clearBoard
→ resetVcfGroups
→ invalidateGeneratedResult（整合產生器）
```

用途：清空棋子、路線、分析與題目狀態。

## 3.2 VCF／VCT 分析按鈕

### VCF 防守：`#btn-block-vcf`

```text
window._getArr
→ getAColor
→ engine.getBlockVCF
→ window._showAnalysisTriangles
→ setStatus
```

用途：針對目前 `lastVCFMoves` 顯示直接防守點。

### 全部 VCF 防守：`#btn-block-vcf-all`

```text
window._getArr
→ getAColor
→ engine.findVCF
→ engine.getBlockVCF
→ pool.getLevelPoints
→ window._showAnalysisTriangles
```

用途：先取得候選防點，再以多 Worker 試下守方棋，排除仍然有 VCF 的點。

### 多組 VCF：`#btn-multi-vcf`

```text
window._getArr
→ getAColor
→ engine.findVCF(maxVCF = 20)
→ engine.trimVCFGroups
→ setVcfGroup(0)
```

用途：搜尋多組 VCF，依完成棋型去重並提供上一組／下一組導覽。

### 上一組：`#btn-vcf-prev`

```text
setVcfGroup(vcfGroupIdx - 1)
```

### 下一組：`#btn-vcf-next`

```text
setVcfGroup(vcfGroupIdx + 1)
```

### VCT 點：`#btn-level3`

```text
window._getArr
→ getAColor
→ engine.findVCF
→ 若已有 VCF：window._showVCF
→ 若沒有 VCF：engine.getLevelPoints
→ window._showAnalysisLabels
```

用途：優先顯示現成 VCF；沒有 VCF 時，逐點計算連五、四與可形成 VCF 的候選點。

### 補黑找 VCF：`#btn-add-black`

```text
window._getArr
→ doAddVCF(arr, 1)
→ pool.getLevelPoints
→ lerpColor
→ window._showAnalysisLabels
→ window._showAnalysisRing
```

### 補白找 VCF：`#btn-add-white`

與補黑相同，但呼叫 `doAddVCF(arr, 2)`。

## 3.3 規則與分析顏色

### 有禁手／無禁手：`input[name="rules"]`

```text
engine.setRules
+ pool.setRules
+ GeneratorVCFEngine.setRules（產生題目時）
```

### 分析色：`input[name="acolor"]`

由 `getAColor()` 讀取，影響 VCF 防守、全部 VCF 防守、VCT 點、補黑與補白分析。

## 3.4 圖片匯入按鈕

### 匯入圖片：`#btn-import-image`

```text
imageFileInput.click
→ loadFromFileList
→ loadImageFromBlob
→ normalizeImage
→ drawSource
→ autoDetectBoard
```

### 手機拍照：`#btn-import-camera`

與匯入圖片相同，但開啟有 `capture="environment"` 的相機檔案欄位。

### 重新偵測棋盤：`#btn-import-redetect`

```text
autoDetectBoard
→ ensureCvReady
→ orderCorners / projectImagePointToSourceCanvas
→ drawSource
```

### 確認棋盤區域：`#btn-import-confirm`

```text
confirmBoardArea
→ ensureCvReady
→ sourceCanvasPointToImage
→ orderCorners
→ OpenCV getPerspectiveTransform / warpPerspective
→ computeWarpedIntersections
→ recognizeBoard
→ renderRecognitionPreview
```

### 套用到棋盤：`#btn-import-apply`

```text
applyRecognizedBoard
→ detectNextColor
→ window._setBoardArr
→ invalidateGeneratedResult
```

### 重設匯入：`#btn-import-reset`

```text
resetImportState(true)
→ resetWarpedView
→ setImportButtons
```

### 貼上圖片

文件的 `paste` 事件會呼叫：

```text
loadImageFromBlob
```

### 拖曳棋盤四角

```text
beginCornerDrag
→ pickCorner
→ getCanvasPoint

moveCornerDrag
→ getCanvasPoint
→ clamp
→ drawSource

endCornerDrag
→ drawSource
```

## 3.5 題目產生器按鈕

### 產生 N 步 VCF：`#gen-btn-generate`

```text
genGenerate
→ genGetAttacker / genGetRules / genGetTargetSteps / genOptions
→ genSetBusy
→ genEngine.setRules
→ genFindTwoStep
   → genBuildBasePlacements
   → genPickInitialPlacement
   → genEnumerateLayerCandidates
   → genValidateCandidate
→ 目標大於 2 時：genExtendToTarget（遞迴回溯）
   → genMakeExtensionBase
   → genEnumerateLayerCandidates
   → genValidateExtensionCandidate
→ genShowResult
→ window.genDraw
```

### 停止產生：`#gen-btn-stop`

```text
genCancelled = true
→ genEngine.cancel
```

### 顯示／隱藏答案：`#gen-btn-answer`

```text
genShowAnswer 切換
→ window.genDraw
→ window._showVCF（整合頁）
```

### 顯示／隱藏 N 點：`#gen-btn-npoints`

```text
genShowNPoints 切換
→ window.genDraw
→ showNPoints（整合頁）
```

### 生成步數：`#gen-target-steps`

```text
input → genRefreshGenerateLabel
change → genCommitTargetSteps
開始生成 → genGetTargetSteps
```

### 沿用攻子加成／朝天元加成

由 `genOptions()` 讀取，分別影響 `genBuildLayerCandidates()` 的沿用棋子權重與 `genCenterDirectionBonus()`。

---

# 4. JavaScript 函式索引

## 4.1 `makevcf.html`：WebView、引擎、棋盤與主分析

### WebView2 橋接

| 函式 | 中文用途 |
|---|---|
| `wv2call(type, cmd, param)` | 將頁面命令包成 JSON，傳給 WebView2 原生主機，並依訊息 ID 等待回覆 |

### `VCFEngine` 類別

| 方法 | 中文用途 |
|---|---|
| `constructor()` | 初始化規則、Worker 與啟動 Promise |
| `_start()` | 依環境連接 `engineAPI` 或建立 `eval/worker.js` |
| `_post(cmd, param)` | 將單一命令包成 Promise 傳給 Worker／桌面橋接 |
| `findVCF(...)` | 搜尋一組或多組 VCF |
| `getBlockVCF(...)` | 取得指定 VCF 路線的防守候選點 |
| `getLevelPoints(...)` | 逐點試下並取得連五、四或 VCF 標籤 |
| `trimVCFGroups(...)` | 修剪與去重多組 VCF |
| `setRules(rules)` | 切換有禁／無禁並重啟後端 |
| `cancel()` | 中止目前命令並重建後端 |

### `WorkerPool` 類別

| 方法 | 中文用途 |
|---|---|
| `constructor()` | 決定工作數量並開始初始化 |
| `_init()` | 建立最多 8 個 Worker，或連接桌面程序池 |
| `workerCount` | 回傳目前並行工作數 |
| `setRules(rules)` | 對所有 Worker 設定規則 |
| `cancel()` | 中止並重建全部 Worker |
| `getLevelPoints(...)` | 將空點分塊給多個 Worker，最後合併結果與節點數 |

### 棋盤 SVG IIFE

| 函式 | 中文用途 |
|---|---|
| `el(tag, attrs, parent)` | 建立 SVG 元素並設定屬性 |
| `pos(idx)` | 將 0～224 棋盤索引轉為 SVG 座標 |
| `drawStone(idx)` | 重畫指定交點的黑棋、白棋或空點 |
| `svgXY(event)` | 將滑鼠／觸控位置換算為棋盤索引 |
| `saveBoard()` | 將棋盤與下一手顏色存入 `localStorage` |
| `window._getArr()` | 取得 226 格引擎格式棋盤，最後一格為盤外值 `-1` |
| `window._setBoardArr(arr, next)` | 將外部棋盤套入主棋盤並儲存 |
| `window._clearBoard()` | 清空棋盤、VCF 路線與分析層 |
| `window._clearAnalysis()` | 清空分析標記層 |
| `window._showAnalysisLabels(items, bgColor, textColor)` | 顯示有文字的圓形分析標籤 |
| `window._showAnalysisRing(idxList, strokeColor)` | 在指定分析點外加圓環 |
| `window._showAnalysisTriangles(idxList, fillColor)` | 顯示防守點三角形 |
| `window._showAnalysisMarkers(idxList, markerColor)` | 顯示叉號標記 |
| `window._clearVCF()` | 清空 VCF 手順圖層 |
| `window._showVCF(moves, firstColor)` | 以橘框棋子與序號顯示 VCF 手順 |

### 主分析共用函式

| 函式 | 中文用途 |
|---|---|
| `setStatus(text)` | 更新主狀態文字 |
| `elapsed(t0)` | 格式化執行秒數 |
| `fmtNodes(n)` | 將節點數格式化為 K／M |
| `fmtRate(nodes, t0)` | 計算並格式化每秒節點數 |
| `setVcfGroup(idx)` | 切換目前多組 VCF 並更新導覽按鈕 |
| `resetVcfGroups()` | 清除多組 VCF 狀態 |
| `getAColor()` | 讀取分析色 |
| `setBusy(value)` | 鎖定或解鎖分析按鈕與規則欄位 |
| `doSearch(arr, color)` | 執行單一路線 VCF 搜尋與顯示 |
| `lerpColor(hex1, hex2, t)` | 依步數在兩個顏色間插值 |
| `doAddVCF(arr, placeColor)` | 逐點補指定顏色，並找分析色的 VCF |

### 圖片匯入與辨識 IIFE

| 函式 | 中文用途 |
|---|---|
| `setImportStatus(text, danger)` | 更新匯入區狀態與警告樣式 |
| `setImportButtons()` | 依匯入階段啟用／停用按鈕 |
| `resetWarpedView()` | 清空校正預覽畫布 |
| `resetImportState(keepCv)` | 重設圖片、四角、辨識結果與 UI |
| `loadScript(src)` | 動態載入外部 JavaScript；目前用於 OpenCV.js |
| `ensureCvReady()` | 確認 OpenCV.js 可用，並處理逾時或失敗 |
| `getCanvasPoint(event, canvas)` | 將滑鼠／觸控座標轉為 Canvas 內座標 |
| `clamp(value, min, max)` | 將數值限制在指定範圍 |
| `lerpPoint(a, b, t)` | 計算兩點間的線性插值 |
| `dist2(a, b)` | 計算兩點距離平方 |
| `orderCorners(points)` | 將四角排序為左上、右上、右下、左下 |
| `drawSource()` | 繪製來源圖片、棋盤框、格線與拖曳控制點 |
| `normalizeImage(img)` | 將過大圖片縮小到辨識上限 |
| `projectImagePointToSourceCanvas(point)` | 將原圖座標轉為來源 Canvas 座標 |
| `sourceCanvasPointToImage(point)` | 將來源 Canvas 座標轉回原圖座標 |
| `setDefaultCorners()` | 自動偵測失敗時建立預設四角框 |
| `loadImageFromBlob(blob)` | 載入圖片 Blob、正規化並啟動自動偵測 |
| `autoDetectBoard()` | 用 OpenCV 輪廓搜尋棋盤四邊形 |
| `pickCorner(point)` | 找出距離游標最近的棋盤角點 |
| `beginCornerDrag(event)` | 開始拖曳棋盤角點 |
| `moveCornerDrag(event)` | 移動目前角點並重畫來源圖 |
| `endCornerDrag()` | 結束拖曳角點 |
| `computeWarpedIntersections()` | 建立校正後 15×15 交點座標 |
| `samplePatch(...)` | 取樣圓環區域亮度、對比與梯度 |
| `sampleLineVisibility(...)` | 估算棋盤橫線與直線的可見程度 |
| `renderRecognitionPreview()` | 顯示辨識棋子、交點與低信心紅框 |
| `recognizeBoard()` | 根據中心、圓環、背景與棋線特徵判斷空／黑／白 |
| `confirmBoardArea()` | 做透視校正，計算交點並執行辨識 |
| `detectNextColor(board)` | 依黑白棋數推測下一手顏色 |
| `applyRecognizedBoard()` | 將辨識棋盤套用到主棋盤 |
| `loadFromFileList(files)` | 從檔案欄位取得第一張圖片並載入 |

## 4.2 `makevcf-generator-core.js`：產生器核心與引擎

### DOM 與設定

| 函式 | 中文用途 |
|---|---|
| `genEl(id)` | 同時支援整合頁 `gen-*` ID 與獨立頁原 ID |
| `genChecked(name)` | 取得整合頁或獨立頁目前選取的 radio |
| `genInputs(name)` | 取得整合頁或獨立頁的同組輸入欄位 |

### `GeneratorVCFEngine` 類別

| 方法 | 中文用途 |
|---|---|
| `constructor()` | 建立題目產生器專用後端狀態 |
| `start()` | 連接桌面 `engineAPI` 或建立產生器 Worker |
| `post(cmd, param)` | 傳送題目驗證命令 |
| `setRules(rules)` | 設定題目驗證規則 |
| `findVCF(arr, color, maxVCF)` | 搜尋題目盤面的多組 VCF |
| `trimGroups(arr, groups, color)` | 呼叫多組 VCF 去重與剪尾 |
| `cancel()` | 中止產生器搜尋並重建後端 |

### 棋盤、N 點與 UI 工具

| 函式 | 中文用途 |
|---|---|
| `genOther(color)` | 取得另一方顏色 |
| `genNoMask(color)` | 取得指定顏色的 N 點位元 |
| `genIsNFor(nMask, idx, color)` | 判斷指定點是否為某方 N 點 |
| `genX(idx)` | 取得索引的 X 座標 |
| `genY(idx)` | 取得索引的 Y 座標 |
| `genIdx(x, y)` | 將座標轉為索引，盤外回傳 `GEN_OUT` |
| `genBoard()` | 建立空的 226 格引擎棋盤 |
| `genCloneBoard(arr)` | 複製棋盤並補正盤外格 |
| `genTick()` | 暫停到下一個事件循環，讓畫面可更新 |
| `genRand(max)` | 產生 0 到 `max-1` 的隨機整數 |
| `genPointFrom(anchor, delta, direction, sign)` | 依錨點、方向與距離取得棋盤點 |
| `genSetStatus(text)` | 更新產生器狀態 |
| `genSetDetails(text)` | 更新產生結果詳細資訊 |
| `genGetAttacker()` | 取得題目攻方 |
| `genGetRules()` | 取得目前規則 |
| `genGetTargetSteps()` | 讀取並限制生成步數為 2～10 |
| `genSetBusy(value)` | 鎖定產生器及主分析頁的相關控制項 |

## 4.3 `makevcf-generator-board.js`：獨立產生器棋盤

| 函式 | 中文用途 |
|---|---|
| `initGeneratorBoard()` | 初始化獨立產生器的 SVG 棋盤、棋子、N 點與答案圖層 |
| `element(tag, attrs, parent)` | 建立 SVG 元素 |
| `position(idx)` | 將棋盤索引轉為 SVG 座標 |
| `window.genDraw(result)`／`draw(result)` | 重畫題目棋子、N 點與答案手順 |

整合到 `makevcf.html` 時不載入此檔，而改用 `makevcf-generator-integrated.js` 的 `window.genDraw`。

## 4.4 `makevcf-generator-base.js`：初始材料

| 函式 | 中文用途 |
|---|---|
| `genBaseWeight(points)` | 依材料中心離天元的距離計算基礎權重 |
| `genBuildLiveThreePlacements(attacker)` | 枚舉兩種初始活三的所有位置、方向與鏡射 |
| `genBuildDeadFourPlacements(attacker, rules)` | 枚舉三種初始死四並套用 A 禁止位置與禁手限制 |
| `genBuildBasePlacements(attacker, rules)` | 合併可用的活三與死四材料 |
| `genWeightedPick(items)` | 按權重隨機選一項 |
| `genWeightedOrder(items)` | 產生加權隨機候選順序 |

## 4.5 `makevcf-generator-layer.js`：新增死四層

| 函式 | 中文用途 |
|---|---|
| `genCreatesLegalFreeFour(...)` | 試下攻方棋並判斷是否為合法活四 |
| `genCenterDirectionBonus(anchor, points)` | 計算新材料朝向天元的加分 |
| `genGetNewLiveThreeExtensions(...)` | 掃描新死四範圍內可形成活四的點，以判斷是否留下活三 |
| `genBuildRepairVariants(...)` | 枚舉在左右 X 補守方棋的方案，保留用棋最少且能封住活三者 |
| `genBuildLayerCandidates(...)` | 套用單一模板、處理 A／五／X、N 點、禁手與權重，建立候選盤面 |
| `genEnumerateLayerCandidates(...)` | 枚舉所有 A、方向、鏡射、模板與 A 槽位，並去除重複盤面 |

## 4.6 `makevcf-generator-validate.js`：題目驗證

| 函式 | 中文用途 |
|---|---|
| `genAnalyzeVCFGroup(initialBoard, moves, attacker)` | 重播 VCF，計算步數、四四、活四與標準完成盤面 |
| `genMatchesLiveThreeContinuation(candidate, moves)` | 驗證 2 步目標是否正確接回初始活三 |
| `genMatchesDeadFourContinuation(candidate, moves, analysis)` | 驗證 A 是否同時完成原死四與新死四 |
| `genMatchesBaseContinuation(...)` | 依初始材料類型分派驗證 |
| `genBoardsEqual(a, b)` | 逐點比較兩個棋盤的黑白棋位置 |
| `genBuildExpectedExtendedBoard(previous, candidate)` | 依前一層標準完成盤面推算本層應有完成盤面 |
| `genApplyRouteNPoints(candidate, moves)` | 將目標手順與必要 X 點加入 N 點遮罩 |
| `genLayerRecord(candidate, step)` | 建立單層生成紀錄 |
| `genFinalizeValidatedResult(...)` | 組合盤面、答案、完成盤面、N 點、層數與統計 |
| `genFindAnalyzedGroups(candidate)` | 搜尋並剪尾去重候選盤面的多組 VCF |
| `genValidateCandidate(candidate)` | 驗證初始 2 步題目與較短替代 VCF |
| `genValidateExtensionCandidate(candidate, previous, targetSteps)` | 驗證多步延伸、完成盤面差異與較短替代 VCF |
| `genMakeExtensionBase(result)` | 從目前題目建立下一層可用的 A 候選集合 |

## 4.7 `makevcf-generator-main.js`：生成流程

| 函式 | 中文用途 |
|---|---|
| `genPickInitialPlacement(placements)` | 先等機率選活三／死四類，再按權重選材料 |
| `genOptions()` | 讀取沿用攻子與朝天元加成選項 |
| `genFindTwoStep(...)` | 不設固定次數上限地尋找合格 2 步基礎題 |
| `genExtendToTarget(...)` | 遞迴回溯新增死四層，直到指定步數 |
| `genShowResult(...)` | 套用成功盤面並顯示統計 |
| `genGenerate()` | 題目產生主程序 |
| `genName(idx)` | 將索引轉為棋盤座標名稱 |
| `genPreviewTargetSteps()` | 預覽步數欄位並限制在 2～10 |
| `genRefreshGenerateLabel()` | 輸入步數時更新產生按鈕文字 |
| `genCommitTargetSteps()` | 確認步數後修正欄位與按鈕文字 |

## 4.8 `makevcf-generator-integrated.js`：整合主頁

| 函式 | 中文用途 |
|---|---|
| `initIntegratedGenerator()` | 建立產生器面板並插入主頁 |
| `clearNPoints()` | 清除主棋盤的產生器 N 點圖層 |
| `showNPoints(nMask)` | 在主棋盤顯示黑方、白方或雙方 N 點 |
| `updateGeneratorButtons()` | 同步答案與 N 點按鈕狀態及文字 |
| `invalidateGeneratedResult(message)` | 棋盤被修改時作廢舊答案與 N 點 |
| `hideGeneratedOverlays()` | 隱藏答案與 N 點，但保留棋盤 |
| `resetMainAnalysisState(result)` | 將產生題目的攻方與答案同步到主分析狀態 |
| `window.genDraw(result)`／`drawGeneratedResult(result)` | 將題目套入主棋盤並顯示答案／N 點 |
| `window.genIntegrationSetBusy(value)`／`setGeneratorBusy(value)` | 產生中鎖定主分析功能 |
| `wrappedMainSetBusy(value)` | 主分析執行時反向鎖定產生器控制項 |

## 4.9 `eval/Evaluator.js`：共用高階引擎

### 棋型線段與資料轉換

| 函式 | 中文用途 |
|---|---|
| `getLines(arr, color)` | 將活三、死四、活四、五連整理成線段資料 |
| `getKey(arr)` | 將二維棋盤壓縮為字串鍵值 |
| `getMoveKey(move)` | 計算手順中攻方索引總和鍵值 |
| `getArr2D(arr, setnum, x, y)` | 建立指定大小的二維陣列 |
| `TypedArray2Array(moves)` | 將 TypedArray 複製成一般陣列 |
| `copyArr2D(arr, arr2)` | 複製 15×15 二維棋盤 |
| `getX(idx)` | 取得棋盤 X 座標 |
| `getY(idx)` | 取得棋盤 Y 座標 |
| `idxToName(idx)` | 將索引轉成字母數字座標 |
| `movesToName(moves, maxLength)` | 將手順轉成人類可讀的座標字串 |

### xxHash32 工具

| 函式 | 中文用途 |
|---|---|
| `readU32(bytes, index)` | 讀取小端序 32 位整數 |
| `imul(a, b)` | 模擬 32 位整數乘法 |
| `rotl32(x, r)` | 32 位循環左移 |
| `rotmul32(h, r, m)` | 循環位移後乘法 |
| `shiftxor32(h, s)` | 右移後 XOR |
| `xxhapply(...)` | 執行 xxHash 混合步驟 |
| `xxh1(...)` | 處理 1 位元組資料 |
| `xxh4(...)` | 處理 4 位元組資料 |
| `xxh16(...)` | 處理 16 位元組資料 |
| `xxh32(seed, src, index, len)` | 計算 xxHash32 |

### 手順去重與轉置表

| 函式／方法 | 中文用途 |
|---|---|
| `isChildMove(left, right, position)` | 判斷手順是否相同或是否為另一手順的子集合 |
| `isRepeatMove(oldMove, newMove, position)` | 判斷新手順是否重複 |
| `pushWinMoves(winMoves, move)` | 插入勝利手順並移除被較短手順涵蓋的項目 |
| `getSpliceStart(move, moves)` | `pushWinMoves` 內部函式，尋找依長度插入位置 |
| `resetHashTable(hashTable)` | 清空舊式 VCF 雜湊表並更新碰撞統計 |
| `sortMoves(moves, position)` | 依棋盤位置重建攻守交替手順 |
| `sortList(list)` | 排序手順清單 |
| `compareMoves(left, right)` | 逐點比較兩個手順 |
| `push(list, moves, position)` | 向小型／大型清單插入去重後手順 |
| `has(list, moves, position)` | 查詢清單是否已有手順 |
| `xxhashKey(keyLen, keySum, keySum1)` | 產生轉置表鍵值 |
| `movesPush(...)` | 將手順寫入雜湊表 |
| `movesHas(...)` | 查詢雜湊表中的手順 |
| `transTablePush(...)` | 轉置表寫入包裝函式 |
| `transTableHas(...)` | 轉置表查詢包裝函式 |
| `hashTable.clear()` | 清空分頁式雜湊表 |
| `hashTable.addPage()` | 增加一頁雜湊緩衝區 |
| `hashTable.getBuffer(bytes)` | 配置指定大小緩衝區 |
| `hashTable.has(...)` | 預留的分頁雜湊查詢方法，目前未實作 |
| `hashTable.set(...)` | 預留的分頁雜湊寫入方法，目前未實作 |

### VCF／VCT 高階函式

| 函式 | 中文用途 |
|---|---|
| `resetVCF(arr, color, maxVCF, maxDepth, maxNode)` | 重設 VCF 搜尋參數、統計、路線與轉置表 |
| `continueFour(...)` | 執行 VCF 並回傳各方向延續資訊 |
| `aroundPoint(arr, color, radius, continueInfo)` | 找出指定棋子或延續路線周圍的空點 |
| `selectPoints(...)` | 以 VCF 延續資訊與半徑篩選候選點 |
| `selectPointsLevel(...)` | 依對方威脅等級決定候選點策略 |
| `resetLevelBInfo()` | 清除 B 級別分析結果 |
| `getLevelB(...)` | 綜合立即威脅、VCF 與啟發式 VCT 級別 |
| `excludeBlockVCF(...)` | 試下守方棋並排除無法真正防住 VCF 的點 |
| `getBlockPoints(...)` | 依盤面威脅取得建議防守點 |
| `getScore(idx, color, arr)` | 依附近五、四、三棋型計算候選點分數 |
| `getGameOver(arr, side, idx)` | 判斷勝、敗、禁手、和棋或未結束 |

## 4.10 `eval/EvaluatorJScript.js`：純 JavaScript 後端

### 初始化與索引表

| 函式 | 中文用途 |
|---|---|
| `loadEvaluatorJScript()` | 安裝純 JS 後端並將公開函式掛到全域 |
| `createEmptyLists()` | 建立四方向線索引的空白陣列 |
| `createIdxLists()` | 建立棋盤所有橫、直、兩斜線的索引清單 |
| `createIdxTable()` | 建立由點、位移、方向快速取得索引的查表 |
| `moveIdx(idx, move, direction)` | 依方向與位移取得另一交點 |
| `getArrValue(idx, move, direction, arr)` | 取得相對位置棋盤值 |
| `createAroundIdxTable()` | 建立各點由內向外的周邊索引表 |
| `aroundIdx(centerIdx, index)` | 取得周邊表第 N 個點 |
| `getAroundIdxCount(centerIdx, radius)` | 取得指定半徑內點數 |

### 單線棋型

| 函式 | 中文用途 |
|---|---|
| `testLine(...)` | 暫時落子後分析單一方向完整棋型 |
| `_testLine(...)` | 不負責還原棋盤的單線核心 |
| `testLineFoul(...)` | 暫時落黑後分析單線禁手相關棋型 |
| `_testLineFoul(...)` | 禁手單線核心 |
| `testLineFour(...)` | 暫時落子後只分析四以上棋型 |
| `_testLineFour(...)` | 四棋型單線核心 |
| `testLineThree(...)` | 暫時落子後分析三以上棋型 |
| `_testLineThree(...)` | 三棋型單線核心 |
| `testLinePoint(...)` | 一次分析線上每個空點的完整棋型資訊 |
| `testLinePointFour(...)` | 一次分析線上每個空點的四以上資訊 |
| `testLinePointThree(...)` | 一次分析線上每個空點的三以上資訊 |
| `getBlockFourPoint(...)` | 取得死四唯一防點 |
| `getBlockThreePoints(...)` | 取得活三相關防點 |
| `getFreeFourPoint(...)` | 取得活三可轉成活四的點 |

### 禁手、全盤棋型與級別

| 函式 | 中文用途 |
|---|---|
| `isFoul(idx, arr)` | 判斷黑棋落點是否為三三、四四或長連禁手 |
| `testPointFour(idx, color, arr)` | 取得某點最強四棋型與禁手旗標 |
| `toArr(source, arr)` | 將一維 225 格陣列轉為二維棋盤 |
| `movesSort(moves, comparator)` | 依自訂條件排序手順清單 |
| `testFive(arr, color, infoArr)` | 掃描全盤可形成五連的點 |
| `testFour(arr, color, infoArr)` | 掃描全盤四以上棋型 |
| `testThree(arr, color, infoArr)` | 掃描全盤三以上棋型 |
| `isGameOver(arr, color)` | 判斷指定色是否已有五連 |
| `getLevel(arr, color)` | 取得目前盤面的最高威脅等級 |
| `getLevelPoint(idx, color, arr)` | 取得某落點的五、活四、死四或四四等級 |

### VCF

| 函式 | 中文用途 |
|---|---|
| `isVCF(color, arr, moves)` | 驗證指定手順是否為合法 VCF |
| `simpleVCF(color, arr, moves)` | 簡化 VCF 手順，移除不必要分支／尾步 |
| `findVCF(arr, color, maxVCF, maxDepth, maxNode)` | 純 JS 深度搜尋 VCF，包含連五預掃與轉置表 |
| `getBlockVCF(arr, color, vcfMoves, includeFour)` | 取得直接防、反防、抓禁與四棋型防守點 |

### 公開 API

純 JS 後端最後公開：

```text
setGameRules
moveIdx
getArrValue
aroundIdx
getAroundIdxCount
testLine
testLineFoul
testLineFour
testLineThree
testLinePoint
testLinePointFour
testLinePointThree
getBlockFourPoint
getBlockThreePoints
getFreeFourPoint
isFoul
testPointFour
testFive
testFour
testThree
getLevel
getLevelPoint
isVCF
simpleVCF
findVCF
isGameOver
getLevelB
getBlockVCF
```

## 4.11 `eval/EvaluatorWebassembly.js`：WebAssembly 包裝器

| 函式 | 中文用途 |
|---|---|
| `loadEvaluatorWebassembly()` | 載入 Wasm、建立記憶體介面並公開引擎函式 |
| `grow(pages)` | 增加 Wasm 記憶體頁數 |
| `memcpy(...)` | 提供 Wasm 匯入的記憶體複製函式 |
| `memset(...)` | 提供 Wasm 匯入的記憶體填值函式 |
| `_Z3logPhj(...)` | Wasm 除錯：輸出手順 |
| `_Z3logd(...)` | Wasm 除錯：輸出數字 |
| `putArr(arr)` | 將目前棋盤寫入 Wasm 記憶體 |
| `putInitArr(arr)` | 將初始棋盤寫入 Wasm 記憶體 |
| `putMoves(moves)` | 將手順寫入 Wasm 記憶體 |
| `getInfoList(infoList)` | 從 Wasm 讀回 9 格單線資訊 |
| `getInfoArr(infoArr)` | 從 Wasm 讀回 225 格棋型資訊 |
| `getVcfInfo(vcfInfo)` | 舊版 VCF 結果讀取函式，目前保留在註解中 |
| `getArrValue(...)` | 呼叫 Wasm 取得相對位置棋盤值 |
| `testLine(...)` | Wasm 單線完整棋型包裝 |
| `testLineFoul(...)` | Wasm 單線禁手棋型包裝 |
| `testLineFour(...)` | Wasm 單線四棋型包裝 |
| `testLineThree(...)` | Wasm 單線三棋型包裝 |
| `testLinePoint(...)` | Wasm 每空點完整棋型包裝 |
| `testLinePointFour(...)` | Wasm 每空點四棋型包裝 |
| `testLinePointThree(...)` | Wasm 每空點三棋型包裝 |
| `getBlockFourPoint(...)` | Wasm 死四防點包裝 |
| `getBlockThreePoints(...)` | Wasm 活三防點包裝 |
| `getFreeFourPoint(...)` | Wasm 活四形成點包裝 |
| `isFoul(...)` | Wasm 禁手判斷包裝 |
| `testPointFour(...)` | Wasm 單點四棋型包裝 |
| `testFive(...)` | Wasm 全盤五連點包裝 |
| `testFour(...)` | Wasm 全盤四棋型包裝 |
| `testThree(...)` | Wasm 全盤三棋型包裝 |
| `isGameOver(...)` | Wasm 終局判斷包裝 |
| `getLevel(...)` | Wasm 盤面級別包裝 |
| `getLevelPoint(...)` | Wasm 單點級別包裝 |
| `isVCF(...)` | Wasm VCF 手順驗證包裝 |
| `simpleVCF(...)` | Wasm VCF 簡化包裝 |
| `findVCF(...)` | 由 JavaScript 控制搜尋堆疊，棋型判斷使用 Wasm |
| `getBlockVCF(...)` | 計算 VCF 防守點 |

公開 API 與純 JavaScript 後端保持相同，讓上層不需要判斷目前使用哪個後端。

## 4.12 `eval/worker.js`：Worker 命令

`COMMAND` 物件中的每個鍵都是一個命令處理函式：

| 命令函式 | 中文用途 |
|---|---|
| `setGameRules` | 設定有禁／無禁規則 |
| `getLevelB` | 計算綜合威脅級別 |
| `isVCF` | 驗證手順是否為 VCF |
| `findVCF` | 搜尋 VCF |
| `getBlockVCF` | 取得 VCF 防守點 |
| `selectPoints` | 依延續路線與半徑選點 |
| `selectPointsLevel` | 依對方級別選點 |
| `excludeBlockVCF` | 排除無效防守點 |
| `getBlockPoints` | 取得防守候選點 |
| `trimVCFGroups` | 修剪活四尾步、按完成盤面去重並排序 |
| `getLevelPoints` | 逐點試下並回傳連五、四或 VCF 標籤 |
| `onmessage(event)` | 接收 Worker 訊息並分派 `COMMAND` |
| `post({cmd, param})` | 封裝 `postMessage` 回傳結果 |

## 4.13 `emoji/emoji.js`

此檔只宣告 `EMOJI_*` 常數，沒有函式。

## 4.14 `app/main.js`：Electron 主程序

### `EngineProcess` 類別

| 方法 | 中文用途 |
|---|---|
| `constructor()` | 建立子程序、目前要求與佇列狀態 |
| `start()` | 啟動 `engine.exe` 並監聽標準輸出 |
| `_onLine(line)` | 收集輸出行，符合完成條件時解決 Promise |
| `_next()` | 將下一個命令送入子程序 |
| `send(cmd, done)` | 將命令加入佇列並回傳 Promise |
| `kill()` | 終止程序並結束所有等待中的要求 |
| `restart()` | 終止後重新啟動 |

### Electron 協定函式

| 函式 | 中文用途 |
|---|---|
| `boardCmd(arr)` | 將棋盤轉成 `SETBOARD` 文字命令 |
| `parseFindVCF(lines)` | 解析 `VCFCOUNT`、`VCFPATH`、`NODECOUNT` |
| `parseGetLevelPoints(lines)` | 解析 `ITEM` 與節點數 |
| `trimVCFGroupsImpl(engine, param)` | 在桌面後端執行活四剪尾與多組去重 |
| `engineCmd(cmd, param)` | 將頁面 API 命令轉成 `engine.exe` 文字協定 |
| `poolGetLevelPoints(param)` | 將候選點分配到多個 `engine.exe` 並合併結果 |

底部的 Electron 生命週期與 IPC 匿名函式負責建立視窗、關閉程序，以及處理 `engine:cmd`、`engine:cancel`、`pool:*` 頻道。

## 4.15 `app/preload.js`：Electron 安全橋接

`contextBridge.exposeInMainWorld` 公開下列箭頭函式：

| 函式 | 中文用途 |
|---|---|
| `engineAPI.send(cmd, param)` | 呼叫主程序單引擎命令 |
| `engineAPI.cancel()` | 中止並重啟單引擎 |
| `engineAPI.poolGetLevelPoints(param)` | 呼叫多程序逐點分析 |
| `engineAPI.poolCancel()` | 中止並重啟程序池 |
| `engineAPI.poolSetRules(rules)` | 對程序池設定規則 |

## 4.16 `app/engine_node.js` 與 `cpp/engine_node.js`

兩份檔案目前內容相同，提供 Node 標準輸入／輸出的文字命令引擎。

| 函式 | 中文用途 |
|---|---|
| `findProjectRoot(startDir)` | 向上尋找包含 `eval` 與 `emoji` 的專案根目錄 |
| `loadScript(relativePath)` | 用 `vm.runInThisContext` 載入棋力 JS |
| `clearBoard()` | 清空 226 格棋盤 |
| `toIdx(x, y)` | 座標轉索引 |
| `getX(idx)` | 索引轉 X |
| `getY(idx)` | 索引轉 Y |
| `fallbackMove()` | 沒有 VCF 時選最接近天元的空點 |
| `parseTurnToken(token)` | 解析 `row,col` 格式 |
| `print(line)` | 向標準輸出寫一行 |
| `runFindVCF(color, maxVCF, maxDepth, maxNode)` | 執行 VCF 並整理回傳物件 |
| `handleBoardLine(line)` | 處理 `BOARD` 模式的逐行棋譜 |
| `handleCommand(line)` | 分派所有文字命令 |

支援命令：

```text
START
BOARD / YXBOARD
PUT
PLAY
CLEAR
BEGIN
TURN
SETRULES
YXVCF
DUMPBOARD
FINDVCF
LEVELPOINT
ISVCF
BLOCKVCF
SETBOARD
GETLEVELPOINTS
```

---

# 5. C++ 版本

## 5.1 `cpp/Board.h`

| 方法 | 中文用途 |
|---|---|
| `Board()` | 建立空棋盤與 Zobrist 鍵值 |
| `clear()` | 清空棋盤及手順 |
| `putStone(idx, color)` | 落子、記錄歷史並更新雜湊 |
| `takeStone()` | 撤銷最後一手並還原雜湊 |
| `getCell(idx)` | 取得棋盤值 |
| `setCell(idx, color)` | 直接設定棋盤格並更新雜湊 |
| `getHashKey()` | 取得目前 Zobrist 鍵值 |
| `toIdx(x, y)` | 座標轉索引 |
| `getX(idx)` | 索引轉 X |
| `getY(idx)` | 索引轉 Y |
| `getHistory()` | 取得落子歷史 |

## 5.2 `cpp/Zobrist.h`

| 方法 | 中文用途 |
|---|---|
| `Zobrist::getInstance()` | 取得單例雜湊表 |
| `Zobrist::getKey(idx, color)` | 取得指定點與顏色的隨機鍵 |
| `Zobrist()` | 使用固定種子建立可重現的雜湊表 |

## 5.3 `cpp/Evaluator.h`／`cpp/Evaluator.cpp`

| 方法 | 中文用途 |
|---|---|
| `Evaluator::Evaluator()` | 初始化方向索引與周邊索引表 |
| `initIdxTable()` | 建立點、位移、方向查表 |
| `initAroundIdxTable()` | 建立各點周圍索引表 |
| `testLine(...)` | 試下後分析單一方向棋型 |
| `checkLine(...)` | 分析棋盤上已存在棋子的單線棋型 |
| `isFoul(...)` | 判斷黑方禁手 |
| `getLevelPoint(...)` | 取得指定落點威脅級別 |
| `getLevel(...)` | 取得整個盤面的最高級別 |
| `getThreats(...)` | 計算全盤所有候選點的棋型資訊 |

## 5.4 `cpp/Searcher.h`／`cpp/Searcher.cpp`

| 方法 | 中文用途 |
|---|---|
| `Searcher::Searcher(Evaluator&)` | 注入棋型評估器 |
| `findVCF(...)` | 連五預掃後，以多個非同步工作搜尋 VCF |
| `vcfDFS(...)` | 深度優先 VCF 搜尋與轉置表剪枝 |
| `isVCF(...)` | 重播並驗證指定手順 |
| `getBlockVCF(...)` | 取得指定 VCF 路線中的攻防關鍵點 |
| `getCandidateMoves(...)` | 依攻方／守方角色取得四、五等候選點 |

## 5.5 `cpp/Main.cpp`

| 函式 | 中文用途 |
|---|---|
| `quote(string)` | 為 Windows 命令列路徑加引號 |
| `findScriptPath(exeDir)` | 尋找 `engine_node.js` |
| `main()` | 建立管線、啟動 Node 橋接並轉送標準輸入／輸出 |

## 5.6 `cpp/host.cpp`：WebView2 主機

### `EngineProcess` 類別

| 方法 | 中文用途 |
|---|---|
| `start(enginePath)` | 啟動隱藏的 `engine.exe` 子程序 |
| `send(cmd, done)` | 將命令加入佇列並回傳 `future` |
| `kill()` | 終止子程序與清空要求 |
| `restart()` | 重啟引擎 |
| `dispatchNext()` | 派發佇列下一個命令 |
| `readLoop()` | 持續讀取子程序標準輸出 |
| `onLine(line)` | 判斷命令是否完成並回傳累積行 |

### 協定、程序池與視窗

| 函式 | 中文用途 |
|---|---|
| `boardCmd(arr)` | JSON 棋盤轉 `SETBOARD` 命令 |
| `parseFindVCF(lines)` | 解析 VCF 搜尋結果 |
| `parseGetLevelPoints(lines)` | 解析逐點分析結果 |
| `engineCmdImpl(cmd, param)` | 將 WebView JSON 命令轉成引擎文字命令 |
| `poolGetLevelPointsImpl(param)` | 多程序並行逐點分析 |
| `handleMessage(json)` | 分派 WebView2 的 `engine`／`pool` 訊息 |
| `WndProc(...)` | 處理 Windows 視窗、尺寸、回覆與結束事件 |
| `WinMain(...)` | 啟動引擎池、建立 WebView2、注入 Worker 數並載入主頁 |

## 5.7 `cpp/Constants.h`

包含：

- 15×15 棋盤大小
- 黑、白、空、盤外顏色列舉
- 有禁／無禁規則列舉
- VCT、VCF、活三、死四、活四、五連級別
- 棋型與旗標常數
- `invertColor(color)`：反轉黑白顏色

## 5.8 CMake 目標

`cpp/CMakeLists.txt` 定義：

- `engine.exe`：命令列引擎入口
- `host.exe`：可選的 WebView2 Windows GUI
- C++17
- Release 優化
- `Threads` 多執行緒連結

---

# 6. Worker／桌面共用命令協定

頁面層維持同一組命令，不論底層是 Web Worker、Electron 或 WebView2：

| 命令 | 主要參數 | 回傳 |
|---|---|---|
| `setGameRules` | `rules` | 無 |
| `findVCF` | `arr, color, maxVCF, maxDepth, maxNode` | `vcfInfo` |
| `isVCF` | `arr, color, moves` | `boolean` |
| `getBlockVCF` | `arr, color, vcfMoves, includeFour` | 防點索引陣列 |
| `getLevelPoints` | `arr, color, placeColor, indices` | `{items, nodeCount}` |
| `trimVCFGroups` | `arr, groups, color` | 去重後路線 |
| `getLevelB` | `arr, color, ...` | 級別資訊 |
| `selectPoints` | `arr, color, radius, ...` | 候選點陣列 |
| `selectPointsLevel` | `arr, color, radius, ...` | 候選點陣列 |
| `excludeBlockVCF` | `points, arr, color, ...` | 有效防點 |
| `getBlockPoints` | `arr, color, radius, ...` | 防守候選點 |

---

# 7. 執行與建置

## 7.1 本機 Web

不要直接使用 `file://`，請啟動 HTTP 伺服器：

```powershell
python -m http.server 8000
```

開啟：

```text
http://127.0.0.1:8000/makevcf.html
```

## 7.2 Electron

```powershell
cd app
npm install
npm start
```

建立 Windows 可攜版：

```powershell
npm run build
```

## 7.3 C++

```powershell
cmake -S cpp -B cpp/build -DCMAKE_BUILD_TYPE=Release
cmake --build cpp/build --config Release
```

若要建置 `host.exe`，還要提供 WebView2 SDK：

```powershell
cmake -S cpp -B cpp/build -DWV2_SDK="C:/wv2sdk/Microsoft.Web.WebView2.x.y.z"
cmake --build cpp/build --config Release
```

---

# 8. 維護注意事項

1. 新增按鈕時，請同步更新本 README 的「按鈕與函式對照」。
2. 新增或刪除具名 JavaScript 函式時，請同步更新對應檔案章節。
3. Web Worker、Electron 與 WebView2 應維持相同命令名稱與回傳格式。
4. `EvaluatorJScript.js` 與 `EvaluatorWebassembly.js` 的公開 API 應保持一致。
5. 題目產生器的 N 點目前是生成流程使用的遮罩；完整 N 點重算規則仍可在後續替換。
6. `makevcf-generator.html` 保留作獨立測試；正式入口是整合後的 `makevcf.html`。
