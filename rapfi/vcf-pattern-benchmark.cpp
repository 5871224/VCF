#include "game/pattern.h"

#include <array>
#include <cstdint>

#include <emscripten/emscripten.h>

namespace {

constexpr int KEY_SAMPLE_COUNT = 4096;
volatile uint64_t benchmarkSink = 0;

std::array<uint64_t, KEY_SAMPLE_COUNT> makeKeys()
{
    std::array<uint64_t, KEY_SAMPLE_COUNT> keys {};
    uint64_t state = 0x9e3779b97f4a7c15ULL;
    for (uint64_t &key : keys) {
        state ^= state << 7;
        state ^= state >> 9;
        state ^= state << 8;
        key = state;
    }
    return keys;
}

template <Rule R>
inline Pattern2x lookupFusedKey(uint64_t fusedKey)
{
    fusedKey &= PatternConfig::KeyCnt<R> - 1;
    if constexpr (R == FREESTYLE)
        return PatternConfig::PATTERN2x[fusedKey];
    else if constexpr (R == STANDARD)
        return PatternConfig::PATTERN2xStandard[fusedKey];
    else
        return PatternConfig::PATTERN2xRenju[fusedKey];
}

template <Rule R>
double benchmarkPattern(int mode, int iterations)
{
    if (iterations <= 0)
        return 0.0;

    static const std::array<uint64_t, KEY_SAMPLE_COUNT> keys = makeKeys();
    uint64_t checksum = benchmarkSink;

    // Warm up the Wasm JIT and lookup tables before measuring.
    for (int i = 0; i < KEY_SAMPLE_COUNT; i++) {
        Pattern2x p = PatternConfig::lookupPattern<R>(keys[i]);
        checksum += uint64_t(p.patBlack) + uint64_t(p.patWhite);
    }

    const double startMs = emscripten_get_now();

    if (mode == 0) {
        // Raw 2-bit line key: fuse the center-less key, then read Pattern2x.
        for (int i = 0; i < iterations; i++) {
            Pattern2x p = PatternConfig::lookupPattern<R>(keys[i & (KEY_SAMPLE_COUNT - 1)]);
            checksum += uint64_t(p.patBlack) + (uint64_t(p.patWhite) << 4);
        }
    }
    else if (mode == 1) {
        // One candidate point: four directional lookups plus Rapfi's PCODE combination.
        for (int i = 0; i < iterations; i++) {
            const int base = (i * 4) & (KEY_SAMPLE_COUNT - 1);
            Pattern2x p0 = PatternConfig::lookupPattern<R>(keys[base]);
            Pattern2x p1 = PatternConfig::lookupPattern<R>(keys[(base + 1) & (KEY_SAMPLE_COUNT - 1)]);
            Pattern2x p2 = PatternConfig::lookupPattern<R>(keys[(base + 2) & (KEY_SAMPLE_COUNT - 1)]);
            Pattern2x p3 = PatternConfig::lookupPattern<R>(keys[(base + 3) & (KEY_SAMPLE_COUNT - 1)]);
            checksum += PatternConfig::PCODE[p0.patBlack][p1.patBlack][p2.patBlack][p3.patBlack];
        }
    }
    else {
        // Fused key is already maintained: direct Pattern2x table lookup only.
        for (int i = 0; i < iterations; i++) {
            Pattern2x p = lookupFusedKey<R>(keys[i & (KEY_SAMPLE_COUNT - 1)]);
            checksum += uint64_t(p.patBlack) + (uint64_t(p.patWhite) << 4);
        }
    }

    const double elapsedMs = emscripten_get_now() - startMs;
    benchmarkSink = checksum;
    return elapsedMs * 1000000.0 / double(iterations);  // nanoseconds per operation
}

}  // namespace

extern "C" EMSCRIPTEN_KEEPALIVE double vcfPatternBenchmark(int rule, int mode, int iterations)
{
    switch (rule) {
    case FREESTYLE: return benchmarkPattern<FREESTYLE>(mode, iterations);
    case STANDARD: return benchmarkPattern<STANDARD>(mode, iterations);
    case RENJU: return benchmarkPattern<RENJU>(mode, iterations);
    default: return 0.0;
    }
}
