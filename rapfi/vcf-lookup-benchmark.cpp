#include <array>
#include <cstdint>

#include <emscripten/emscripten.h>

namespace {

constexpr int KEY_SAMPLE_COUNT = 4096;
constexpr int KEY_SAMPLE_MASK = KEY_SAMPLE_COUNT - 1;
constexpr int TERNARY_KEY_COUNT = 59049;
constexpr int BINARY_KEY_COUNT = 1 << 20;
volatile uint64_t benchmarkSink = 0;

struct LookupData
{
    std::array<uint32_t, 1024> ownToTernary {};
    std::array<uint32_t, 1024> blockToTernary {};
    std::array<uint8_t, TERNARY_KEY_COUNT> ternaryTable {};
    std::array<uint8_t, BINARY_KEY_COUNT> binaryTable {};
    std::array<uint32_t, KEY_SAMPLE_COUNT> ternaryKeys {};
    std::array<uint16_t, KEY_SAMPLE_COUNT> ownMasks {};
    std::array<uint16_t, KEY_SAMPLE_COUNT> blockMasks {};
    std::array<uint32_t, KEY_SAMPLE_COUNT> binaryKeys {};

    LookupData()
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

LookupData &lookupData()
{
    static LookupData data;
    return data;
}

double benchmarkLookup(int mode, int iterations)
{
    if (iterations <= 0)
        return 0.0;

    LookupData &data = lookupData();
    uint64_t checksum = benchmarkSink;

    for (int i = 0; i < KEY_SAMPLE_COUNT; i++) {
        const int sample = i & KEY_SAMPLE_MASK;
        if (mode == 0)
            checksum += data.ternaryTable[data.ternaryKeys[sample]];
        else if (mode == 1) {
            const uint32_t key = data.ownToTernary[data.ownMasks[sample]]
                                 + data.blockToTernary[data.blockMasks[sample]];
            checksum += data.ternaryTable[key];
        }
        else
            checksum += data.binaryTable[data.binaryKeys[sample]];
    }

    const double startMs = emscripten_get_now();

    if (mode == 0) {
        for (int i = 0; i < iterations; i++)
            checksum += data.ternaryTable[data.ternaryKeys[i & KEY_SAMPLE_MASK]];
    }
    else if (mode == 1) {
        for (int i = 0; i < iterations; i++) {
            const int sample = i & KEY_SAMPLE_MASK;
            const uint32_t key = data.ownToTernary[data.ownMasks[sample]]
                                 + data.blockToTernary[data.blockMasks[sample]];
            checksum += data.ternaryTable[key];
        }
    }
    else {
        for (int i = 0; i < iterations; i++)
            checksum += data.binaryTable[data.binaryKeys[i & KEY_SAMPLE_MASK]];
    }

    const double elapsedMs = emscripten_get_now() - startMs;
    benchmarkSink = checksum;
    return elapsedMs * 1000000.0 / double(iterations);
}

}  // namespace

extern "C" EMSCRIPTEN_KEEPALIVE double vcfLookupBenchmark(int mode, int iterations)
{
    return benchmarkLookup(mode, iterations);
}
