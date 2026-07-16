# VCF Analyzer

15×15 連珠／五子棋 VCF 局面分析工具，支援 VCF 路線、防守點、候選點、多組 VCF 與棋盤圖片匯入。

網站：<https://5871224.github.io/VCF/>

## Web 執行

請透過 HTTP/HTTPS 提供本目錄，不要直接以 `file://` 開啟：

```powershell
python -m http.server 8000
```

然後開啟 <http://127.0.0.1:8000/makevcf.html>。

完整功能與架構請參考 [規格書.MD](規格書.MD)。
