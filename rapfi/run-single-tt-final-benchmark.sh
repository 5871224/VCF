#!/usr/bin/env bash
set -euxo pipefail

OUT=/tmp/vcf-tt-bench-final
rm -rf "$OUT"
mkdir -p "$OUT/native" "$OUT/wasm/common"

NATIVE_FLAGS=(-O3 -flto -DNDEBUG -std=c++17)

g++ "${NATIVE_FLAGS[@]}" -c rapfi/vcf-pattern-engine.cpp -o "$OUT/native/pattern.o"
g++ "${NATIVE_FLAGS[@]}" -c rapfi/vcf-bitboard-engine.cpp -o "$OUT/native/engine.o"
g++ "${NATIVE_FLAGS[@]}" -c rapfi/vcf-bitboard-legacy-extra.cpp -o "$OUT/native/legacy-extra.o"
g++ "${NATIVE_FLAGS[@]}" -c rapfi/vcf-single-tt-tactical-benchmark.cpp -o "$OUT/native/benchmark.o"

build_run_native() {
  local label="$1"
  shift
  g++ "${NATIVE_FLAGS[@]}" "$@" -c rapfi/vcf-bitboard-search-v2.cpp -o "$OUT/native/search-${label}.o"
  g++ "${NATIVE_FLAGS[@]}" \
    "$OUT/native/pattern.o" \
    "$OUT/native/engine.o" \
    "$OUT/native/legacy-extra.o" \
    "$OUT/native/search-${label}.o" \
    "$OUT/native/benchmark.o" \
    -o "$OUT/native/${label}"
  "$OUT/native/${label}" "$label" 1500000 7 | tee -a "$OUT/native-results.txt"
}

: > "$OUT/native-results.txt"
build_run_native legacy
build_run_native direct_mixed_32k -DVCF_SINGLE_TT_BENCHMARK -DVCF_SINGLE_TT_VARIANT=1 -DVCF_SINGLE_TT_BITS=15
build_run_native direct_mixed_64k -DVCF_SINGLE_TT_BENCHMARK -DVCF_SINGLE_TT_VARIANT=1 -DVCF_SINGLE_TT_BITS=16
build_run_native direct_mixed_128k -DVCF_SINGLE_TT_BENCHMARK -DVCF_SINGLE_TT_VARIANT=1 -DVCF_SINGLE_TT_BITS=17
build_run_native direct_mixed_256k -DVCF_SINGLE_TT_BENCHMARK -DVCF_SINGLE_TT_VARIANT=1 -DVCF_SINGLE_TT_BITS=18
build_run_native direct_mixed_512k -DVCF_SINGLE_TT_BENCHMARK -DVCF_SINGLE_TT_VARIANT=1 -DVCF_SINGLE_TT_BITS=19
build_run_native direct_raw_128k -DVCF_SINGLE_TT_BENCHMARK -DVCF_SINGLE_TT_VARIANT=2 -DVCF_SINGLE_TT_BITS=17
build_run_native two_way_recent_128k -DVCF_SINGLE_TT_BENCHMARK -DVCF_SINGLE_TT_VARIANT=3 -DVCF_SINGLE_TT_BITS=16
build_run_native two_way_shallow_recent_128k -DVCF_SINGLE_TT_BENCHMARK -DVCF_SINGLE_TT_VARIANT=4 -DVCF_SINGLE_TT_BITS=16
build_run_native two_way_recent_256k -DVCF_SINGLE_TT_BENCHMARK -DVCF_SINGLE_TT_VARIANT=3 -DVCF_SINGLE_TT_BITS=17
build_run_native two_way_shallow_recent_256k -DVCF_SINGLE_TT_BENCHMARK -DVCF_SINGLE_TT_VARIANT=4 -DVCF_SINGLE_TT_BITS=17
build_run_native two_way_recent_512k -DVCF_SINGLE_TT_BENCHMARK -DVCF_SINGLE_TT_VARIANT=3 -DVCF_SINGLE_TT_BITS=18
build_run_native four_way_recent_128k -DVCF_SINGLE_TT_BENCHMARK -DVCF_SINGLE_TT_VARIANT=5 -DVCF_SINGLE_TT_BITS=15
build_run_native four_way_shallow_recent_128k -DVCF_SINGLE_TT_BENCHMARK -DVCF_SINGLE_TT_VARIANT=6 -DVCF_SINGLE_TT_BITS=15
build_run_native four_way_recent_256k -DVCF_SINGLE_TT_BENCHMARK -DVCF_SINGLE_TT_VARIANT=5 -DVCF_SINGLE_TT_BITS=16
build_run_native four_way_shallow_recent_256k -DVCF_SINGLE_TT_BENCHMARK -DVCF_SINGLE_TT_VARIANT=6 -DVCF_SINGLE_TT_BITS=16

grep '^SUMMARY ' "$OUT/native-results.txt"

source .build/emsdk/emsdk_env.sh
WASM_FLAGS=(-O3 -flto -DNDEBUG -std=c++17 -msimd128)

em++ "${WASM_FLAGS[@]}" -c rapfi/vcf-pattern-engine.cpp -o "$OUT/wasm/common/pattern.o"
em++ "${WASM_FLAGS[@]}" -c rapfi/vcf-bitboard-engine.cpp -o "$OUT/wasm/common/engine.o"
em++ "${WASM_FLAGS[@]}" -c rapfi/vcf-bitboard-legacy-extra.cpp -o "$OUT/wasm/common/legacy-extra.o"

build_run_wasm() {
  local label="$1"
  shift
  mkdir -p "$OUT/wasm/${label}"
  em++ "${WASM_FLAGS[@]}" "$@" -c rapfi/vcf-bitboard-search-v2.cpp -o "$OUT/wasm/${label}/search.o"
  em++ "${WASM_FLAGS[@]}" \
    "$OUT/wasm/common/pattern.o" \
    "$OUT/wasm/common/engine.o" \
    "$OUT/wasm/common/legacy-extra.o" \
    "$OUT/wasm/${label}/search.o" \
    --no-entry \
    -s WASM=1 \
    -s MODULARIZE=1 \
    -s EXPORT_NAME=VCFBitboardModule \
    -s ENVIRONMENT=node \
    -s FILESYSTEM=0 \
    -s ALLOW_MEMORY_GROWTH=1 \
    -s "EXPORTED_FUNCTIONS=['_vcfBbFindMode','_malloc','_free']" \
    -s "EXPORTED_RUNTIME_METHODS=['cwrap']" \
    -o "$OUT/wasm/${label}/engine.js"
  node rapfi/vcf-single-tt-wasm-benchmark.js \
    "$OUT/wasm/${label}/engine.js" "$label" 1500000 7 \
    | tee -a "$OUT/wasm-results.txt"
}

: > "$OUT/wasm-results.txt"
build_run_wasm legacy
build_run_wasm direct_mixed_256k -DVCF_SINGLE_TT_BENCHMARK -DVCF_SINGLE_TT_VARIANT=1 -DVCF_SINGLE_TT_BITS=18
build_run_wasm direct_mixed_512k -DVCF_SINGLE_TT_BENCHMARK -DVCF_SINGLE_TT_VARIANT=1 -DVCF_SINGLE_TT_BITS=19
build_run_wasm two_way_shallow_recent_128k -DVCF_SINGLE_TT_BENCHMARK -DVCF_SINGLE_TT_VARIANT=4 -DVCF_SINGLE_TT_BITS=16
build_run_wasm two_way_recent_256k -DVCF_SINGLE_TT_BENCHMARK -DVCF_SINGLE_TT_VARIANT=3 -DVCF_SINGLE_TT_BITS=17
build_run_wasm two_way_shallow_recent_256k -DVCF_SINGLE_TT_BENCHMARK -DVCF_SINGLE_TT_VARIANT=4 -DVCF_SINGLE_TT_BITS=17
build_run_wasm two_way_recent_512k -DVCF_SINGLE_TT_BENCHMARK -DVCF_SINGLE_TT_VARIANT=3 -DVCF_SINGLE_TT_BITS=18
build_run_wasm four_way_recent_256k -DVCF_SINGLE_TT_BENCHMARK -DVCF_SINGLE_TT_VARIANT=5 -DVCF_SINGLE_TT_BITS=16
build_run_wasm four_way_shallow_recent_256k -DVCF_SINGLE_TT_BENCHMARK -DVCF_SINGLE_TT_VARIANT=6 -DVCF_SINGLE_TT_BITS=16

grep '^WASM_SUMMARY ' "$OUT/wasm-results.txt"
