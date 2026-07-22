#include <algorithm>
#include <array>
#include <chrono>
#include <cstdint>
#include <cstdio>
#include <limits>
#include <unordered_set>
#include <utility>
#include <vector>

#if defined(_MSC_VER)
#include <intrin.h>
#endif

#ifdef __EMSCRIPTEN__
#include <emscripten/emscripten.h>
#define VCF_LEGACY_SEARCH_KEEPALIVE EMSCRIPTEN_KEEPALIVE
static double legacyNowMs() { return emscripten_get_now(); }
#else
#define VCF_LEGACY_SEARCH_KEEPALIVE
static double legacyNowMs()
{
    using clock = std::chrono::steady_clock;
    return std::chrono::duration<double, std::milli>(clock::now().time_since_epoch()).count();
}
#endif

namespace {

constexpr int BOARD_SIZE = 15;
constexpr int BOARD_CELLS = 225;
constexpr int BIT_WORDS = 4;
constexpr int WINDOW_COUNT = 572;
constexpr int WINDOW_BIT_WORDS = (WINDOW_COUNT + 63) / 64;
constexpr int MAX_WINDOWS_PER_POINT = 20;
constexpr int MAX_ROUTE_PLY = 224;
constexpr int FREESTYLE = 0;
constexpr int STANDARD = 1;
constexpr int RENJU = 2;
constexpr int EMPTY = 0;
constexpr int BLACK = 1;
constexpr int WHITE = 2;
constexpr int MODE_SINGLE = 0;
constexpr int MODE_MULTI = 1;
constexpr int MODE_SHORTEST = 2;
constexpr int CENTER = 7 * BOARD_SIZE + 7;
constexpr uint8_t A_FIVE = 13;
constexpr uint8_t F5 = 13;
constexpr uint8_t NIL = 255;
constexpr int DX[4] = {1, 0, 1, 1};
constexpr int DY[4] = {0, 1, 1, -1};

enum WindowCategory : uint8_t {
    BLACK3 = 0,
    BLACK4 = 1,
    BLACK5 = 2,
    WHITE3 = 3,
    WHITE4 = 4,
    WHITE5 = 5,
    NO_CATEGORY = 255,
};

#pragma pack(push, 1)
struct PatternExportResult {
    uint8_t directions[4];
    uint8_t pattern4;
    uint8_t forbidden;
    uint8_t forbiddenType;
    uint8_t actualOverlineMask;
    uint8_t sameLineDoubleFourMask;
    uint8_t realThreeDirections;
    uint8_t reserved[6];
};

struct SearchStats {
    uint32_t nodes;
    uint32_t elapsedMicros;
    uint16_t routeCount;
    uint16_t candidateCount;
    uint16_t maxPly;
    uint8_t aborted;
    uint8_t reserved;
};
#pragma pack(pop)

static_assert(sizeof(PatternExportResult) == 16, "pattern ABI mismatch");
static_assert(sizeof(SearchStats) == 16, "stats ABI mismatch");

extern "C" int vcfAnalyzePoint(const uint8_t *board,
                                int idx,
                                int side,
                                int rule,
                                int method,
                                PatternExportResult *out);
extern "C" int vcfPatternSelfTest();

inline int ctz64(uint64_t value)
{
#if defined(_MSC_VER)
    unsigned long bit = 0;
    _BitScanForward64(&bit, value);
    return int(bit);
#else
    return __builtin_ctzll(value);
#endif
}

uint64_t splitmix64(uint64_t &state)
{
    uint64_t z = (state += 0x9e3779b97f4a7c15ULL);
    z = (z ^ (z >> 30)) * 0xbf58476d1ce4e5b9ULL;
    z = (z ^ (z >> 27)) * 0x94d049bb133111ebULL;
    return z ^ (z >> 31);
}

struct ZobristData {
    std::array<std::array<uint64_t, BOARD_CELLS>, 3> stones {};

    ZobristData()
    {
        uint64_t seed = 0x5643462d4f4c4431ULL;
        for (int side = 0; side < 3; side++)
            for (int idx = 0; idx < BOARD_CELLS; idx++)
                stones[side][idx] = splitmix64(seed);
    }
};

const ZobristData ZOBRIST;

struct Board {
    std::array<uint8_t, BOARD_CELLS> cells {};
    std::array<uint64_t, BIT_WORDS> black {};
    std::array<uint64_t, BIT_WORDS> white {};
    uint64_t hash = 0;

    void clear()
    {
        cells.fill(EMPTY);
        black.fill(0);
        white.fill(0);
        hash = 0;
    }

    void load(const uint8_t *source)
    {
        clear();
        if (!source)
            return;
        for (int idx = 0; idx < BOARD_CELLS; idx++) {
            const int side = source[idx];
            if (side == BLACK || side == WHITE)
                play(idx, side);
        }
    }

    bool empty(int idx) const
    {
        return idx >= 0 && idx < BOARD_CELLS && cells[idx] == EMPTY;
    }

    void play(int idx, int side)
    {
        cells[idx] = uint8_t(side);
        const uint64_t bit = uint64_t(1) << (idx & 63);
        if (side == BLACK)
            black[idx >> 6] |= bit;
        else
            white[idx >> 6] |= bit;
        hash ^= ZOBRIST.stones[side][idx];
    }

    void undo(int idx)
    {
        const int side = cells[idx];
        if (side != BLACK && side != WHITE)
            return;
        const uint64_t bit = uint64_t(1) << (idx & 63);
        if (side == BLACK)
            black[idx >> 6] &= ~bit;
        else
            white[idx >> 6] &= ~bit;
        hash ^= ZOBRIST.stones[side][idx];
        cells[idx] = EMPTY;
    }
};

struct Window {
    std::array<uint8_t, 5> points {};
    uint8_t before = NIL;
    uint8_t after = NIL;
    uint8_t direction = 0;
};

struct WindowTable {
    std::array<Window, WINDOW_COUNT> windows {};
    std::array<std::array<uint16_t, MAX_WINDOWS_PER_POINT>, BOARD_CELLS> byPoint {};
    std::array<uint8_t, BOARD_CELLS> byPointCount {};
    int count = 0;

    WindowTable()
    {
        for (int direction = 0; direction < 4; direction++) {
            for (int y = 0; y < BOARD_SIZE; y++) {
                for (int x = 0; x < BOARD_SIZE; x++) {
                    const int endX = x + DX[direction] * 4;
                    const int endY = y + DY[direction] * 4;
                    if (endX < 0 || endX >= BOARD_SIZE || endY < 0 || endY >= BOARD_SIZE)
                        continue;
                    Window &window = windows[count];
                    window.direction = uint8_t(direction);
                    for (int i = 0; i < 5; i++) {
                        const int idx = (y + DY[direction] * i) * BOARD_SIZE + x + DX[direction] * i;
                        window.points[i] = uint8_t(idx);
                    }
                    const int bx = x - DX[direction];
                    const int by = y - DY[direction];
                    const int ax = endX + DX[direction];
                    const int ay = endY + DY[direction];
                    if (bx >= 0 && bx < BOARD_SIZE && by >= 0 && by < BOARD_SIZE)
                        window.before = uint8_t(by * BOARD_SIZE + bx);
                    if (ax >= 0 && ax < BOARD_SIZE && ay >= 0 && ay < BOARD_SIZE)
                        window.after = uint8_t(ay * BOARD_SIZE + ax);
                    for (uint8_t idx : window.points) {
                        const int slot = byPointCount[idx]++;
                        if (slot < MAX_WINDOWS_PER_POINT)
                            byPoint[idx][slot] = uint16_t(count);
                    }
                    count++;
                }
            }
        }
    }
};

const WindowTable WINDOW_TABLE;

bool checksOverline(int side, int rule)
{
    return rule == STANDARD || (rule == RENJU && side == BLACK);
}

bool exactWindowAllowed(const Board &board, const Window &window, int side, int rule)
{
    if (!checksOverline(side, rule))
        return true;
    return (window.before == NIL || board.cells[window.before] != side)
        && (window.after == NIL || board.cells[window.after] != side);
}

uint8_t classifyWindow(uint8_t blackCount, uint8_t whiteCount)
{
    if (whiteCount == 0) {
        if (blackCount == 3) return BLACK3;
        if (blackCount == 4) return BLACK4;
        if (blackCount == 5) return BLACK5;
    }
    else if (blackCount == 0) {
        if (whiteCount == 3) return WHITE3;
        if (whiteCount == 4) return WHITE4;
        if (whiteCount == 5) return WHITE5;
    }
    return NO_CATEGORY;
}

struct Position {
    Board board;
    std::array<uint8_t, WINDOW_COUNT> blackCount {};
    std::array<uint8_t, WINDOW_COUNT> whiteCount {};
    std::array<uint8_t, WINDOW_COUNT> category {};
    std::array<std::array<uint64_t, WINDOW_BIT_WORDS>, 6> active {};

    void clearActive()
    {
        blackCount.fill(0);
        whiteCount.fill(0);
        category.fill(NO_CATEGORY);
        for (auto &bits : active)
            bits.fill(0);
    }

    void setCategory(int id, uint8_t next)
    {
        const int word = id >> 6;
        const uint64_t bit = uint64_t(1) << (id & 63);
        const uint8_t previous = category[id];
        if (previous == next)
            return;
        if (previous < 6)
            active[previous][word] &= ~bit;
        category[id] = next;
        if (next < 6)
            active[next][word] |= bit;
    }

    void refresh(int id)
    {
        setCategory(id, classifyWindow(blackCount[id], whiteCount[id]));
    }

    void load(const uint8_t *source)
    {
        board.load(source);
        clearActive();
        for (int id = 0; id < WINDOW_TABLE.count; id++) {
            const Window &window = WINDOW_TABLE.windows[id];
            uint8_t black = 0;
            uint8_t white = 0;
            for (uint8_t idx : window.points) {
                black += board.cells[idx] == BLACK;
                white += board.cells[idx] == WHITE;
