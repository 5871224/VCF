## VCF Web UI（本機棋盤）

這是一個**本機網頁棋盤**：用滑鼠在棋盤上直接擺題，按「Solve (yxvcf)」就會呼叫 `cpp/build/Release/engine.exe` 並把解答座標顯示在畫面與 log。

### 前置需求

- **引擎**：`cpp/build/Release/engine.exe`（本專案已提供）
- **後端擇一**：
  - **Node.js（建議）**：安裝後可用 `server.js`
  - **Python 3（備用）**：不需要額外套件，可用 `server.py`

### 啟動（Node.js）

1. 安裝 Node.js（Windows 可用 `winget`）：

```powershell
winget install OpenJS.NodeJS.LTS
```

2. 進入資料夾並啟動：

```powershell
cd "g:\我的雲端硬碟\VCF\cpp\web-ui"
node server.js
```

瀏覽器打開 `http://127.0.0.1:5173`

### 啟動（Python 3）

```powershell
cd "g:\我的雲端硬碟\VCF\cpp\web-ui"
python server.py
```

瀏覽器打開 `http://127.0.0.1:5173`

### 引擎路徑

預設會找：

- `..\build\Release\engine.exe`

你也可以在啟動時指定：

- Node：`$env:VCF_ENGINE="C:\path\to\engine.exe"; node server.js`
- Python：`$env:VCF_ENGINE="C:\path\to\engine.exe"; python server.py`

