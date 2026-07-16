# Renju VCF Engine (C++ High-Performance Port)

這是一個專為五子棋（連珠）設計的高性能 **VCF (Victory of Continuous Four)** 搜尋引擎。本專案將原有的 JavaScript 邏輯完整移植至 C++ 17，並透過多項現代遊戲 AI 技術進行了深度優化。

## 📖 專案背景
在本案中，我們將原有的連珠規則評估器與 VCF 搜尋邏輯從單執行緒的 JavaScript 環境移植到編譯型語言 C++。這項變革的核心目標是解決複雜 VCF 題目（超過 30 步）在瀏覽器端運算過慢的問題，預計效能提升達 10-50 倍。

## 🚀 核心技術優化細節

### 1. Zobrist Hashing 與 換位表 (Transposition Table)
*   **原理**: 為了避免在搜尋樹中重複計算相同的局面（例如不同落子順序導致的相同盤面），我們實作了 **Zobrist Hashing**。
*   **實作**: 預先為每個位置的每個棋色生成 64 位隨機數。盤面 Hash 值透過 `XOR` 運算即時更新。
*   **優勢**: 將雜湊表查詢時間從 `O(N)` 降至 `O(1)`，顯著減少了重複節點的搜尋開銷。

### 2. 位元棋盤 (Bitboard) 數據結構
*   **架構**: 針對 15x15 棋盤（225 格），我們使用了 4 個 `uint64_t` 整數組成的連續位元組。
*   **優勢**: 
    *   **存儲極簡**: 整個盤面狀態僅需 32 字節。
    *   **快速複製**: 在多執行緒環境下，複製棋盤的成本極低。
    *   **位元運算**: 未來可進一步透過位元移位 (Bit-shifting) 實現瞬時的五連模式匹配。

### 3. 多執行緒並行搜尋 (Parallel Root Search)
*   **策略**: 採用「根節點分裂」策略。在搜尋第一層候選步時，系統會自動偵測 CPU 核心數，並利用 `std::async` 與 `std::future` 為每個分支開啟獨立的搜尋任務。
*   **優勢**: 在多核心 CPU 上，搜尋速度幾乎能與核心數成線性增長。

### 4. 奕心通訊協議 (YX/GGEP Protocol)
*   **相容性**: 引擎嚴格遵守 **Gomoku Engine Protocol**，並特別支援奕心界面專有的 `yxvcf` 指令。
*   **流程**: 
    1.  GUI 發送盤面。
    2.  GUI 發送 `yxvcf` 要求。
    3.  引擎並行計算勝路。
    4.  回傳座標序列 `x1,y1 x2,y2 ...` 或 `UNKNOWN`。

## 🛠 開發環境需求
*   **作業系統**: Windows 10/11
*   **編譯器**: MSVC v143 (Visual Studio 2022) 或更新版本。
*   **標準**: C++ 17 (或更高)
*   **CMake**: 3.10+

## ⚙️ 建置與配置
### 編譯指令
```powershell
mkdir build
cd build
cmake ..
cmake --build . --config Release
```

### 奕心介面對接步驟
1.  下載 **Yixin-Board**。
2.  進入 **Engine -> Settings -> Add**。
3.  選擇 `build/Release/engine.exe`。
4.  將引擎類別設定為 **Gomoku**。

## 🎯 路線圖 (Roadmap)
- [x] JS 核心邏輯 C++ 遷移
- [x] Zobrist Hashing 實作
- [x] 多執行緒並行化
- [x] Yixin-Board 通訊穩定化
- [ ] **PVS / Alpha-Beta 剪枝擴展** (未來計畫)
- [ ] **完整位元級棋型掃描 (Fast BitScan)** (未來計畫)

---
**維護者**: Antigravity (Advanced AI Coding Assistant)  
**版權所有**: © 2026 
