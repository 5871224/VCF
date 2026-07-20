#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
SOURCE="$SCRIPT_DIR/eval/Evaluator.cpp"
OUTPUT_DIR="${1:-$SCRIPT_DIR/build}"
OUTPUT_WASM="$OUTPUT_DIR/Evaluator.wasm"
OUTPUT_WAT="$OUTPUT_DIR/Evaluator.wat"

if ! command -v em++ >/dev/null 2>&1; then
  echo "error: em++ not found. Activate Emscripten SDK 3.1.74 or use build-with-docker.ps1." >&2
  exit 1
fi

mkdir -p "$OUTPUT_DIR"

# The upstream repository contains the source and generated wasm/wat but no build
# command. These flags reproduce the module shape expected by
# eval/EvaluatorWebassembly.js: standalone memory, no main entry point, C++ mangled
# exports, and unresolved host functions left as WebAssembly imports.
em++ "$SOURCE" \
  -O3 \
  -std=c++17 \
  -fno-exceptions \
  -fno-rtti \
  -sSTANDALONE_WASM=1 \
  -sERROR_ON_UNDEFINED_SYMBOLS=0 \
  -Wl,--no-entry \
  -Wl,--export-all \
  -o "$OUTPUT_WASM"

if command -v wasm-dis >/dev/null 2>&1; then
  wasm-dis "$OUTPUT_WASM" -o "$OUTPUT_WAT"
elif command -v wasm2wat >/dev/null 2>&1; then
  wasm2wat "$OUTPUT_WASM" -o "$OUTPUT_WAT"
fi

printf 'Built %s\n' "$OUTPUT_WASM"
