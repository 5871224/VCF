# VCF Analyzer

15×15 連珠／五子棋 VCF 局面分析工具，支援 VCF 路線、防守點、候選點、多組 VCF、棋盤圖片匯入，以及 2 步 VCF 題目試作產生器。

- 分析工具：<https://5871224.github.io/VCF/makevcf.html>
- 2 步題目產生器：<https://5871224.github.io/VCF/makevcf-generator.html>

## Web 執行

請透過 HTTP/HTTPS 提供本目錄，不要直接以 `file://` 開啟：

```powershell
python -m http.server 8000
```

然後開啟：

- <http://127.0.0.1:8000/makevcf.html>
- <http://127.0.0.1:8000/makevcf-generator.html>

文件：

- [分析工具規格書](規格書.MD)
- [VCF 題目產生器規格](題目產生器規格.MD)
