# Rapfi WebAssembly 來源與授權

本頁使用 Rapfi 官方 C++ 原始碼編譯成 WebAssembly。

- Rapfi 原始碼：https://github.com/dhbloo/rapfi
- Rapfi Networks：https://github.com/dhbloo/rapfi-networks
- Rapfi 授權：GNU General Public License v3.0 或後續版本
- VCF 建置設定：`.github/workflows/pages.yml`

目前部署固定使用以下版本：

- Rapfi commit：`3aedf3a2ab0ab710a9f3d00e57d5287ceb864894`
- Networks commit：`918b757a129258e9e765f77fe17d507c2bb1a60b`
- Emscripten SDK：`3.1.74`

建置選項：

```text
-DNO_COMMAND_MODULES=ON
-DNO_MULTI_THREADING=ON
-DUSE_WASM_SIMD=ON
-DUSE_WASM_SIMD_RELAXED=OFF
-DCMAKE_BUILD_TYPE=Release
```

為了讓網頁棋盤直接使用左上角 `(0,0)` 座標，建置時會把 Gomocalc 設定中的：

```text
coord_conversion_mode = "X_flipY"
```

改為：

```text
coord_conversion_mode = "none"
```

除此之外，Rapfi 搜尋、棋型、禁手與 NNUE 原始碼保持官方版本。
