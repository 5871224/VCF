# Bitboard 棋盤基礎

這個目錄是新版棋力核心的第一階段，只包含：

- 15×15 對外座標與 16×16 Bitboard 內部座標映射。
- 黑棋、白棋各 4 個 64-bit word，共 256 bits。
- 查詢、落子、移除棋子與清空棋盤。
- 獨立瀏覽器落子頁面。
- JavaScript 與 C++ 的基本對照測試。

目前**沒有**棋型、勝負、禁手、VCF 或 AI 搜尋。

## 座標映射

對外格式維持現有專案的 15×15 索引：

```text
externalIndex = y * 15 + x      // 0..224
```

Bitboard 內部使用 16×16：

```text
bitIndex = y * 16 + x           // 合法棋盤位置最大為 238
wordIndex = bitIndex >> 6       // 0..3
bitOffset = bitIndex & 63       // 0..63
```

每列第 16 位（x=15）與最後一列（y=15）是補位，任何公開落子函式都會拒絕這些位置。

## 瀏覽器測試

開啟：

```text
bitboard/index.html
```

可執行：

- 點擊棋盤落子。
- 手動選擇下一手黑棋或白棋。
- 黑白自動輪流。
- 悔棋。
- 清空棋盤。
- 查看外部索引、Bit 索引、word/offset 與四個 64-bit word。

瀏覽器版使用 `BigUint64Array(4)`，API 與 `BitBoard256.h` 保持一致。之後接入 C++／WebAssembly 時，頁面操作方式不需要改變。

## 測試

JavaScript：

```bash
node bitboard/tests/bitboard.test.mjs
```

C++：

```bash
c++ -std=c++17 -O2 bitboard/tests/bitboard_test.cpp -o bitboard_test
./bitboard_test
```
