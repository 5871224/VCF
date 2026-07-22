#include "game/pattern.h"

#include <array>
#include <cstdint>

#include <emscripten/emscripten.h>

namespace {

constexpr int KEY_SAMPLE_COUNT = 4096;
constexpr int KEY_SAMPLE_MASK = KEY_SAMPLE_COUNT - 1;
constexpr int TERNARY_KEY_COUNT = 59049;
constexpr int BINARY_KEY_COUNT = 1 << 20;
volatile uint64_t benchmarkSink = 0;

std::array<uint64_t, KEY_SAMPLE_COUNT> makeRapfiKeys()
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

struct AlternativeLookupData
{
    std::array<uint32_t, 1024> ownToTernary {};
    std::array<uint32_t, 1024> blockToTernary {};
    std::array<uint8_t, TERNARY_KEY_COUNT> ternaryTable {};
    std::array<uint8_t, BINARY_KEY_COUNT> binaryTable {};
    std::array<uint32_t, KEY_SAMPLE_COUNT> ternaryKeys {};
    std::array<uint16_t, KEY_SAMPLE_COUNT> ownMasks {};
    std::array<uint16_t, KEY_SAMPLE_COUNT> blockMasks {};
    std::array<uint32_t, KEY_SAMPLE_COUNT> binaryKeys {};

    AlternativeLookupData()
    {
        std::array<uint32_t, 10> powers {};
        powers[0] = 1;
        for (int i = 1; i < 10; i++)
            powers[i] = powers[i - 1] * 3;

        for (int mask = 0; mask < 1024; mask++) {
            uint32_t ownKey = 0;
            uint32_t blockKey = 0;
            for (int bit = 0; bit < 10; bit++) {
                if ((mask >> bit) & 1) {
                    ownKey += powers[bit];
                    blockKey += powers[bit] * 2;
                }
            }
            ownToTernary[mask] = ownKey;
            blockToTernary[mask] = blockKey;
        }

        for (int i = 0; i < TERNARY_KEY_COUNT; i++)
            ternaryTable[i] = uint8_t(((i * 13) ^ (i >> 3)) & 15);
        for (int i = 0; i < BINARY_KEY_COUNT; i++)
            binaryTable[i] = uint8_t(((i * 7) ^ (i >> 5)) & 15);

        uint32_t state = 0x9e3779b9U;
        for (int sample = 0; sample < KEY_SAMPLE_COUNT; sample++) {
            uint16_t ownMask = 0;
            uint16_t blockMask = 0;
            uint32_t ternaryKey = 0;
            for (int bit = 0; bit < 10; bit++) {
                state ^= state << 13;
                state ^= state >> 17;
                state ^= state << 5;
                const uint32_t cell = state % 3;
                if (cell == 1) {
                    ownMask |= uint16_t(1U << bit);
                    ternaryKey += powers[bit];
                }
                else if (cell == 2) {
                    blockMask |= uint16_t(1U << bit);
                    ternaryKey += powers[bit] * 2;
                }
            }
            ownMasks[sample] = ownMask;
            blockMasks[sample] = blockMask;
            ternaryKeys[sample] = ternaryKey;
            binaryKeys[sample] = uint32_t(ownMask) | (uint32_t(blockMask) << 10);
        }
    }
};

AlternativeLookupData &alternativeData()
{
    static AlternativeLookupData data;
    return data;
}

template <Rule R>
inline Pattern2x lookupFusedKey(uint64_t fusedKey)
{
    fusedKey &= uint64_t(PatternConfig::KeyCnt<R> - 1);
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

    static const std::array<uint64_t, KEY_SAMPLE_COUNT> rapfiKeys = makeRapfiKeys();
    AlternativeLookupData &alt = alternativeData();
    uint64_t checksum = benchmarkSink;

    // Warm up the Wasm JIT and the exact tables used by the selected mode.
    for (int i = 0; i < KEY_SAMPLE_COUNT; i++) {
        const int sample = i & KEY_SAMPLE_MASK;
        if (mode <= 2) {
            Pattern2x p = mode == 2 ? lookupFusedKey<R>(rapfiKeys[sample])
                                     : PatternConfig::lookupPattern<R>(rapfiKeys[sample]);
            checksum += uint64_t(p.patBlack) + uint64_t(p.patWhite);
        }
        else if (mode == 3)
            checksum += alt.ternaryTable[alt.ternaryKeys[sample]];
        else if (mode == 4) {
            const uint32_t key = alt.ownToTernary[alt.ownMasks[sample]]
                                 + alt.blockToTernary[alt.blockMasks[sample]];
            checksum += alt.ternaryTable[key];
        }
        else
            checksum += alt.binaryTable[alt.binaryKeys[sample]];
    }

    const double startMs = emscripten_get_now();

    if (mode == 0) {
        // Raw 2-bit line key: fuse the center-less key, then read Pattern2x.
        for (int i = 0; i < iterations; i++) {
            Pattern2x p = PatternConfig::lookupPattern<R>(rapfiKeys[i & KEY_SAMPLE_MASK]);
            checksum += uint64_t(p.patBlack) + (uint64_t(p.patWhite) << 4);
        }
    }
    else if (mode == 1) {
        // One candidate point: four directional lookups plus Rapfi's PCODE combination.
        for (int i = 0; i < iterations; i++) {
            const int base = (i * 4) & KEY_SAMPLE_MASK;
            Pattern2x p0 = PatternConfig::lookupPattern<R>(rapfiKeys[base]);
            Pattern2x p1 = PatternConfig::lookupPattern<R>(rapfiKeys[(base + 1) & KEY_SAMPLE_MASK]);
            Pattern2x p2 = PatternConfig::lookupPattern<R>(rapfiKeys[(base + 2) & KEY_SAMPLE_MASK]);
            Pattern2x p3 = PatternConfig::lookupPattern<R>(rapfiKeys[(base + 3) & KEY_SAMPLE_MASK]);
            checksum += PatternConfig::PCODE[p0.patBlack][p1.patBlack][p2.patBlack][p3.patBlack];
        }
    }
    else if (mode == 2) {
        // Fused key is already maintained: direct Pattern2x table lookup only.
        for (int i = 0; i < iterations; i++) {
            Pattern2x p = lookupFusedKey<R>(rapfiKeys[i & KEY_SAMPLE_MASK]);
            checksum += uint64_t(p.patBlack) + (uint64_t(p.patWhite) << 4);
        }
    }
    else if (mode == 3) {
        // Ternary key is already maintained: one 59,049-entry table lookup.
        for (int i = 0; i < iterations; i++)
            checksum += alt.ternaryTable[alt.ternaryKeys[i & KEY_SAMPLE_MASK]];
    }
    else if (mode == 4) {
        // Two 1,024-entry helper lookups, one addition and one ternary lookup.
        for (int i = 0; i < iterations; i++) {
            const int sample = i & KEY_SAMPLE_MASK;
            const uint32_t key = alt.ownToTernary[alt.ownMasks[sample]]
                                 + alt.blockToTernary[alt.blockMasks[sample]];
            checksum += alt.ternaryTable[key];
        }
    }
    else {
        // Maintained 20-bit key: one lookup in a 2^20-entry table.
        for (int i = 0; i < iterations; i++)
            checksum += alt.binaryTable[alt.binaryKeys[i & KEY_SAMPLE_MASK]];
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
