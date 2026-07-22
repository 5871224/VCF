# Rapfi WebAssembly 來源、隔離與授權

本頁使用 Rapfi 官方 C++ 原始碼編譯成 WebAssembly。

- Rapfi 原始碼：https://github.com/dhbloo/rapfi
- Rapfi Networks：https://github.com/dhbloo/rapfi-networks
- Rapfi 授權：GNU General Public License v3.0 或後續版本
- VCF 建置設定：`.github/workflows/pages.yml`
- VCF 獨立查表基準：`rapfi/vcf-lookup-benchmark.cpp`

目前部署固定使用以下版本：

- Rapfi commit：`3aedf3a2ab0ab710a9f3d00e57d5287ceb864894`
- Networks commit：`918b757a129258e9e765f77fe17d507c2bb1a60b`
- Emscripten SDK：`3.1.74`

Rapfi 建置選項：

```text
-DNO_COMMAND_MODULES=ON
-DNO_MULTI_THREADING=ON
-DUSE_WASM_SIMD=ON
-DUSE_WASM_SIMD_RELAXED=OFF
-DCMAKE_BUILD_TYPE=Release
```

## 嚴格隔離原則

官方 Rapfi 的 checkout 只會以指定 commit 進行原生 CMake 建置：

- 不修改任何 Rapfi `.cpp`、`.h` 或其他原始碼。
- 不修改 Rapfi 的 `CMakeLists.txt`。
- 不把 VCF 測試函式連結進 Rapfi 的 `.wasm`。
- 不修改 `rapfi-networks` 的設定或權重檔。

VCF 的三進位、輔助表與二進位大表測試會另外編譯成：

```text
vcf-lookup-benchmark.js
vcf-lookup-benchmark.wasm
```

Rapfi 則維持官方建置輸出的：

```text
rapfi-single-simd128.js
rapfi-single-simd128.wasm
rapfi-single-simd128.data
```

兩個 Wasm 模組各自擁有獨立記憶體與匯出函式，只由同一個 Web Worker 負責載入與顯示結果。VCF 的測試不會呼叫或改寫 Rapfi 內部棋型資料。
