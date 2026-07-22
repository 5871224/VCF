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

inline int popcount64(uint64_t value)
{
#if defined(_MSC_VER)
    return int(__popcnt64(value));
#else
    return __builtin_popcountll(value);
#endif
}

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

    const std::array<uint64_t, BIT_WORDS> &bits(int side) const
    {
        return side == BLACK ? black : white;
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
    std::array<uint64_t, BIT_WORDS> mask {};
    std::array<uint8_t, 5> points {};
    uint8_t before = NIL;
    uint8_t after = NIL;
    uint8_t direction = 0;
};

struct WindowTable {
    std::vector<Window> windows;
    std::array<std::vector<uint16_t>, BOARD_CELLS> byPoint;

    WindowTable()
    {
        windows.reserve(572);
        for (int direction = 0; direction < 4; direction++) {
            for (int y = 0; y < BOARD_SIZE; y++) {
                for (int x = 0; x < BOARD_SIZE; x++) {
                    const int endX = x + DX[direction] * 4;
                    const int endY = y + DY[direction] * 4;
                    if (endX < 0 || endX >= BOARD_SIZE || endY < 0 || endY >= BOARD_SIZE)
                        continue;
                    Window window;
                    window.direction = uint8_t(direction);
                    for (int i = 0; i < 5; i++) {
                        const int idx = (y + DY[direction] * i) * BOARD_SIZE + x + DX[direction] * i;
                        window.points[i] = uint8_t(idx);
                        window.mask[idx >> 6] |= uint64_t(1) << (idx & 63);
                    }
                    const int bx = x - DX[direction];
                    const int by = y - DY[direction];
                    const int ax = endX + DX[direction];
                    const int ay = endY + DY[direction];
                    if (bx >= 0 && bx < BOARD_SIZE && by >= 0 && by < BOARD_SIZE)
                        window.before = uint8_t(by * BOARD_SIZE + bx);
                    if (ax >= 0 && ax < BOARD_SIZE && ay >= 0 && ay < BOARD_SIZE)
                        window.after = uint8_t(ay * BOARD_SIZE + ax);
                    const uint16_t id = uint16_t(windows.size());
                    windows.push_back(window);
                    for (uint8_t idx : window.points)
                        byPoint[idx].push_back(id);
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

int countMask(const std::array<uint64_t, BIT_WORDS> &bits,
              const std::array<uint64_t, BIT_WORDS> &mask)
{
    int count = 0;
    for (int word = 0; word < BIT_WORDS; word++)
        count += popcount64(bits[word] & mask[word]);
    return count;
}

void extractEmptyPoints(const Board &board, const Window &window, std::array<uint8_t, 5> &out, int &count)
{
    count = 0;
    for (uint8_t idx : window.points)
        if (board.cells[idx] == EMPTY)
            out[count++] = idx;
}

bool fullLegal(const Board &board, int idx, int side, int rule)
{
    if (!board.empty(idx))
        return false;
    if (rule != RENJU || side != BLACK)
        return true;
    PatternExportResult result {};
    return vcfAnalyzePoint(board.cells.data(), idx, side, rule, 0, &result) != 0 && !result.forbidden;
}

struct Threat {
    bool hasFive = false;
    uint8_t count = 0;
    std::array<uint8_t, 2> points {NIL, NIL};

    void add(int idx)
    {
        for (int i = 0; i < count; i++)
            if (points[i] == idx)
                return;
        if (count < 2)
            points[count++] = uint8_t(idx);
    }
};

void scanThreatWindow(const Board &board, const Window &window, int side, int rule, Threat &threat)
{
    const auto &own = board.bits(side);
    const auto &opponent = board.bits(3 - side);
    if (countMask(opponent, window.mask) != 0)
        return;
    const int stones = countMask(own, window.mask);
    if (!exactWindowAllowed(board, window, side, rule))
        return;
    if (stones == 5) {
        threat.hasFive = true;
        return;
    }
    if (stones != 4 || threat.count >= 2)
        return;
    for (uint8_t idx : window.points) {
        if (board.cells[idx] == EMPTY) {
            if (fullLegal(board, idx, side, rule))
                threat.add(idx);
            return;
        }
    }
}

Threat scanThreatAll(const Board &board, int side, int rule)
{
    Threat threat;
    for (const Window &window : WINDOW_TABLE.windows) {
        scanThreatWindow(board, window, side, rule, threat);
        if (threat.hasFive || threat.count >= 2)
            break;
    }
    return threat;
}

Threat scanThreatThrough(const Board &board, int lastMove, int side, int rule)
{
    Threat threat;
    if (lastMove < 0 || lastMove >= BOARD_CELLS || board.cells[lastMove] != side)
        return threat;
    for (uint16_t id : WINDOW_TABLE.byPoint[lastMove]) {
        scanThreatWindow(board, WINDOW_TABLE.windows[id], side, rule, threat);
        if (threat.hasFive || threat.count >= 2)
            break;
    }
    return threat;
}

std::vector<uint8_t> scanWinningMovesAll(const Board &board, int side, int rule, int limit)
{
    std::array<uint8_t, BOARD_CELLS> seen {};
    std::vector<uint8_t> moves;
    moves.reserve(std::min(limit, BOARD_CELLS));
    const auto &own = board.bits(side);
    const auto &opponent = board.bits(3 - side);
    for (const Window &window : WINDOW_TABLE.windows) {
        if (int(moves.size()) >= limit)
            break;
        if (countMask(opponent, window.mask) != 0
            || countMask(own, window.mask) != 4
            || !exactWindowAllowed(board, window, side, rule))
            continue;
        for (uint8_t idx : window.points) {
            if (board.cells[idx] == EMPTY && !seen[idx] && fullLegal(board, idx, side, rule)) {
                seen[idx] = 1;
                moves.push_back(idx);
                break;
            }
        }
    }
    return moves;
}

struct CandidateAcc {
    bool used = false;
    bool immediate = false;
    uint8_t defenseCount = 0;
    std::array<uint8_t, 2> defenses {NIL, NIL};

    void addDefense(int idx)
    {
        for (int i = 0; i < defenseCount; i++)
            if (defenses[i] == idx)
                return;
        if (defenseCount < 2)
            defenses[defenseCount++] = uint8_t(idx);
    }
};

struct Candidate {
    uint8_t idx = NIL;
    uint8_t defenseCount = 0;
    std::array<uint8_t, 2> defenses {NIL, NIL};
    uint8_t chainRank = 3;
    bool immediate = false;
};

int distanceKey(int idx, int center)
{
    const int dx = idx % BOARD_SIZE - center % BOARD_SIZE;
    const int dy = idx / BOARD_SIZE - center / BOARD_SIZE;
    return dx * dx + dy * dy;
}

uint8_t candidateChainRank(const Board &augmented, int idx, int attacker, int rule)
{
    int best = 0;
    const auto &own = augmented.bits(attacker);
    const auto &opponent = augmented.bits(3 - attacker);
    for (uint16_t id : WINDOW_TABLE.byPoint[idx]) {
        const Window &window = WINDOW_TABLE.windows[id];
        if (countMask(opponent, window.mask) != 0 || !exactWindowAllowed(augmented, window, attacker, rule))
            continue;
        best = std::max(best, countMask(own, window.mask));
    }
    if (best >= 3)
        return 0;
    if (best == 2)
        return 1;
    return 2;
}

std::vector<Candidate> scanCandidates(Board &board,
                                      int attacker,
                                      int rule,
                                      int forcedPoint,
                                      int center)
{
    std::array<CandidateAcc, BOARD_CELLS> acc {};
    const auto &own = board.bits(attacker);
    const auto &opponent = board.bits(3 - attacker);

    for (const Window &window : WINDOW_TABLE.windows) {
        if (countMask(opponent, window.mask) != 0 || !exactWindowAllowed(board, window, attacker, rule))
            continue;
        const int stones = countMask(own, window.mask);
        if (stones != 3 && stones != 4)
            continue;
        std::array<uint8_t, 5> empties {};
        int emptyCount = 0;
        extractEmptyPoints(board, window, empties, emptyCount);
        if (stones == 4 && emptyCount == 1) {
            const int attack = empties[0];
            if (forcedPoint < BOARD_CELLS && attack != forcedPoint)
                continue;
            acc[attack].used = true;
            acc[attack].immediate = true;
        }
        else if (stones == 3 && emptyCount == 2) {
            for (int e = 0; e < 2; e++) {
                const int attack = empties[e];
                if (forcedPoint < BOARD_CELLS && attack != forcedPoint)
                    continue;
                acc[attack].used = true;
                acc[attack].addDefense(empties[1 - e]);
            }
        }
    }

    std::vector<Candidate> candidates;
    candidates.reserve(32);
    for (int idx = 0; idx < BOARD_CELLS; idx++) {
        if (!acc[idx].used || !board.empty(idx) || !fullLegal(board, idx, attacker, rule))
            continue;
        Candidate candidate;
        candidate.idx = uint8_t(idx);
        candidate.immediate = acc[idx].immediate;
        candidate.defenseCount = acc[idx].defenseCount;
        candidate.defenses = acc[idx].defenses;
        if (candidate.immediate || candidate.defenseCount)
            candidates.push_back(candidate);
    }

    // 舊版會先把所有衝四候選暫時放到盤上，再依它們互相連結後的
    // 三／二／其他強度分組。這裡用 Bitboard 一次建立同樣的增強盤面。
    Board augmented = board;
    for (const Candidate &candidate : candidates)
        if (!candidate.immediate)
            augmented.play(candidate.idx, attacker);
    for (Candidate &candidate : candidates)
        candidate.chainRank = candidate.immediate ? 0 : candidateChainRank(augmented, candidate.idx, attacker, rule);

    std::stable_sort(candidates.begin(), candidates.end(), [&](const Candidate &a, const Candidate &b) {
        if (a.immediate != b.immediate)
            return a.immediate > b.immediate;
        const bool aFree = a.defenseCount >= 2;
        const bool bFree = b.defenseCount >= 2;
        if (aFree != bFree)
            return aFree > bFree;
        if (a.chainRank != b.chainRank)
            return a.chainRank < b.chainRank;
        return distanceKey(a.idx, center) < distanceKey(b.idx, center);
    });
    return candidates;
}
