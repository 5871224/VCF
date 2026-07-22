#include <algorithm>
#include <array>
#include <chrono>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <string>
#include <unordered_set>
#include <utility>
#include <vector>

#ifdef __EMSCRIPTEN__
#include <emscripten/emscripten.h>
#define VCF_BB_KEEPALIVE EMSCRIPTEN_KEEPALIVE
static double bbNowMs() { return emscripten_get_now(); }
#else
#define VCF_BB_KEEPALIVE
static double bbNowMs()
{
    using clock = std::chrono::steady_clock;
    return std::chrono::duration<double, std::milli>(clock::now().time_since_epoch()).count();
}
#endif

namespace {

constexpr int BOARD_SIZE = 15;
constexpr int BOARD_CELLS = 225;
constexpr int BIT_WORDS = 4;
constexpr uint8_t EMPTY = 0;
constexpr uint8_t BLACK = 1;
constexpr uint8_t WHITE = 2;
constexpr uint8_t B4 = 11;
constexpr uint8_t F4 = 12;
constexpr uint8_t F5 = 13;
constexpr uint8_t A_FIVE = 13;
constexpr int RENJU = 2;
constexpr int MAX_ROUTE_PLY = 224;

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

struct BitBoardState {
    std::array<uint8_t, BOARD_CELLS> cells {};
    std::array<uint64_t, BIT_WORDS> black {};
    std::array<uint64_t, BIT_WORDS> white {};

    void clear()
    {
        cells.fill(EMPTY);
        black.fill(0);
        white.fill(0);
    }

    void load(const uint8_t *source)
    {
        clear();
        if (!source)
            return;
        for (int idx = 0; idx < BOARD_CELLS; idx++) {
            const uint8_t side = source[idx];
            if (side == BLACK || side == WHITE)
                play(idx, side);
        }
    }

    bool isEmpty(int idx) const
    {
        return idx >= 0 && idx < BOARD_CELLS && cells[idx] == EMPTY;
    }

    void play(int idx, int side)
    {
        cells[idx] = uint8_t(side);
        const int word = idx >> 6;
        const uint64_t bit = uint64_t(1) << (idx & 63);
        if (side == BLACK)
            black[word] |= bit;
        else
            white[word] |= bit;
    }

    void undo(int idx)
    {
        const uint8_t side = cells[idx];
        const int word = idx >> 6;
        const uint64_t bit = uint64_t(1) << (idx & 63);
        if (side == BLACK)
            black[word] &= ~bit;
        else if (side == WHITE)
            white[word] &= ~bit;
        cells[idx] = EMPTY;
    }

    template <typename Fn>
    void forEachEmpty(Fn &&fn) const
    {
        for (int word = 0; word < BIT_WORDS; word++) {
            uint64_t valid = ~uint64_t(0);
            if (word == BIT_WORDS - 1)
                valid = (uint64_t(1) << (BOARD_CELLS - 64 * (BIT_WORDS - 1))) - 1;
            uint64_t empty = ~(black[word] | white[word]) & valid;
            while (empty) {
#if defined(_MSC_VER)
                unsigned long bitIndex = 0;
                _BitScanForward64(&bitIndex, empty);
                const int bit = int(bitIndex);
#else
                const int bit = __builtin_ctzll(empty);
#endif
                const int idx = word * 64 + bit;
                fn(idx);
                empty &= empty - 1;
            }
        }
    }
};

struct MoveAnalysis {
    PatternExportResult value {};
    bool valid = false;
};

MoveAnalysis analyzePoint(const BitBoardState &board, int idx, int side, int rule)
{
    MoveAnalysis result;
    if (!board.isEmpty(idx))
        return result;
    result.valid = vcfAnalyzePoint(board.cells.data(), idx, side, rule, 0, &result.value) != 0;
    return result;
}

bool legalMove(const MoveAnalysis &analysis, int side, int rule)
{
    return analysis.valid && !(rule == RENJU && side == BLACK && analysis.value.forbidden);
}

bool createsFive(const MoveAnalysis &analysis)
{
    if (!analysis.valid)
        return false;
    if (analysis.value.pattern4 == A_FIVE)
        return true;
    for (uint8_t pattern : analysis.value.directions)
        if (pattern == F5)
            return true;
    return false;
}

int forcingRank(const MoveAnalysis &analysis)
{
    if (!analysis.valid)
        return 99;
    bool blockFour = false;
    bool flexFour = false;
    for (uint8_t pattern : analysis.value.directions) {
        if (pattern == F5)
            return 0;
        if (pattern == F4)
            flexFour = true;
        else if (pattern == B4)
            blockFour = true;
    }
    return flexFour ? 1 : blockFour ? 2 : 99;
}

struct CandidateMove {
    uint8_t idx = 0;
    uint8_t rank = 99;
};

std::vector<CandidateMove> forcingMoves(const BitBoardState &board, int attacker, int rule)
{
    std::vector<CandidateMove> moves;
    board.forEachEmpty([&](int idx) {
        const MoveAnalysis analysis = analyzePoint(board, idx, attacker, rule);
        if (!legalMove(analysis, attacker, rule))
            return;
        const int rank = forcingRank(analysis);
        if (rank < 99)
            moves.push_back({uint8_t(idx), uint8_t(rank)});
    });
    std::stable_sort(moves.begin(), moves.end(), [](const CandidateMove &a, const CandidateMove &b) {
        if (a.rank != b.rank)
            return a.rank < b.rank;
        const int ax = int(a.idx) % BOARD_SIZE - 7;
        const int ay = int(a.idx) / BOARD_SIZE - 7;
        const int bx = int(b.idx) % BOARD_SIZE - 7;
        const int by = int(b.idx) / BOARD_SIZE - 7;
        return ax * ax + ay * ay < bx * bx + by * by;
    });
    return moves;
}

std::vector<uint8_t> immediateWinningPoints(const BitBoardState &board, int side, int rule, int stopAfter = 225)
{
    std::vector<uint8_t> wins;
    board.forEachEmpty([&](int idx) {
        if (int(wins.size()) >= stopAfter)
            return;
        const MoveAnalysis analysis = analyzePoint(board, idx, side, rule);
        if (legalMove(analysis, side, rule) && createsFive(analysis))
            wins.push_back(uint8_t(idx));
    });
    return wins;
}

struct SearchContext {
    uint32_t maxNodes = 5000000;
    int maxDepth = 200;
    uint32_t nodes = 0;
    int maxPlySeen = 0;
    bool aborted = false;

    bool touch(int ply)
    {
        maxPlySeen = std::max(maxPlySeen, ply);
        if (nodes >= maxNodes) {
            aborted = true;
            return false;
        }
        nodes++;
        if (ply > maxDepth) {
            aborted = true;
            return false;
        }
        return true;
    }
};

bool searchOne(BitBoardState &board,
               int attacker,
               int rule,
               int ply,
               SearchContext &ctx,
               std::vector<uint8_t> &route);

bool tryAttackMove(BitBoardState &board,
                   int attacker,
                   int rule,
                   int ply,
                   uint8_t move,
                   SearchContext &ctx,
                   std::vector<uint8_t> &route)
{
    if (!ctx.touch(ply + 1))
        return false;

    const MoveAnalysis attackAnalysis = analyzePoint(board, move, attacker, rule);
    if (!legalMove(attackAnalysis, attacker, rule) || forcingRank(attackAnalysis) >= 99)
        return false;

    board.play(move, attacker);
    route.push_back(move);

    if (createsFive(attackAnalysis)) {
        board.undo(move);
        return true;
    }

    const int defender = 3 - attacker;
    if (!immediateWinningPoints(board, defender, rule, 1).empty()) {
        route.pop_back();
        board.undo(move);
        return false;
    }

    const std::vector<uint8_t> winningPoints = immediateWinningPoints(board, attacker, rule, 2);
    if (winningPoints.size() >= 2) {
        board.undo(move);
        return true;
    }
    if (winningPoints.empty()) {
        route.pop_back();
        board.undo(move);
        return false;
    }

    const uint8_t defense = winningPoints.front();
    const MoveAnalysis defenseAnalysis = analyzePoint(board, defense, defender, rule);
    if (!legalMove(defenseAnalysis, defender, rule)) {
        board.undo(move);
        return true;
    }

    board.play(defense, defender);
    route.push_back(defense);
    const bool won = searchOne(board, attacker, rule, ply + 2, ctx, route);
    if (!won) {
        route.pop_back();
        route.pop_back();
    }
    board.undo(defense);
    board.undo(move);
    return won;
}

bool searchOne(BitBoardState &board,
               int attacker,
               int rule,
               int ply,
               SearchContext &ctx,
               std::vector<uint8_t> &route)
{
    if (ctx.aborted || ply >= ctx.maxDepth)
        return false;
    const std::vector<CandidateMove> moves = forcingMoves(board, attacker, rule);
    for (const CandidateMove &candidate : moves) {
        const size_t oldSize = route.size();
        if (tryAttackMove(board, attacker, rule, ply, candidate.idx, ctx, route))
            return true;
        route.resize(oldSize);
        if (ctx.aborted)
            break;
    }
    return false;
}

std::vector<std::vector<uint8_t>> findRoutes(BitBoardState board,
                                             int attacker,
                                             int rule,
                                             int maxRoutes,
                                             int maxDepth,
                                             uint32_t maxNodes,
                                             SearchContext &ctx,
                                             int &rootCandidates)
{
    ctx.maxNodes = std::max<uint32_t>(1, maxNodes);
    ctx.maxDepth = std::max(1, std::min(maxDepth, MAX_ROUTE_PLY));
    std::vector<std::vector<uint8_t>> routes;
    const std::vector<CandidateMove> moves = forcingMoves(board, attacker, rule);
    rootCandidates = int(moves.size());
    std::unordered_set<std::string> seen;

    for (const CandidateMove &candidate : moves) {
        std::vector<uint8_t> route;
        if (tryAttackMove(board, attacker, rule, 0, candidate.idx, ctx, route)) {
            const std::string key(reinterpret_cast<const char *>(route.data()), route.size());
            if (seen.insert(key).second)
                routes.push_back(route);
            if (int(routes.size()) >= maxRoutes)
                break;
        }
        if (ctx.aborted)
            break;
    }
    std::stable_sort(routes.begin(), routes.end(), [](const auto &a, const auto &b) {
        return a.size() < b.size();
    });
    return routes;
}

bool routeStillWins(BitBoardState board,
                    int attacker,
                    int rule,
                    const uint8_t *route,
                    int routeLen,
                    SearchContext &ctx)
{
    const int defender = 3 - attacker;
    for (int ply = 0; ply < routeLen; ply++) {
        if (!ctx.touch(ply + 1))
            return false;
        const int side = (ply & 1) ? defender : attacker;
        const uint8_t move = route[ply];
        const MoveAnalysis analysis = analyzePoint(board, move, side, rule);
        if (!legalMove(analysis, side, rule))
            return false;

        if ((ply & 1) == 0) {
            if (forcingRank(analysis) >= 99)
                return false;
            board.play(move, side);
            if (createsFive(analysis))
                return true;
            if (!immediateWinningPoints(board, defender, rule, 1).empty())
                return false;
            const std::vector<uint8_t> wins = immediateWinningPoints(board, attacker, rule, 2);
            if (wins.size() >= 2)
                return true;
            if (wins.size() != 1)
                return false;
            if (ply + 1 >= routeLen || route[ply + 1] != wins.front())
                return false;
        }
        else {
            board.play(move, side);
        }
    }
    return false;
}

int legacyLineValue(uint8_t pattern)
{
    switch (pattern) {
    case F5: return 10;
    case F4: return 9;
    case B4: return 8;
    case 10:
    case 9: return 7;
    case 8: return 6;
    case 7:
    case 6:
    case 5: return 5;
    case 4: return 4;
    case 3: return 3;
    case 2: return 2;
    default: return 0;
    }
}

int lineFivePoint(const BitBoardState &board, int idx, int direction, int side, int rule)
{
    if (idx < 0 || idx >= BOARD_CELLS || direction < 0 || direction > 3 || !board.isEmpty(idx))
        return 255;
    static constexpr int dx[4] = {1, 0, 1, 1};
    static constexpr int dy[4] = {0, 1, 1, -1};
    BitBoardState after = board;
    after.play(idx, side);
    const int x0 = idx % BOARD_SIZE;
    const int y0 = idx / BOARD_SIZE;
    for (int delta = -5; delta <= 5; delta++) {
        const int x = x0 + dx[direction] * delta;
        const int y = y0 + dy[direction] * delta;
        if (x < 0 || x >= BOARD_SIZE || y < 0 || y >= BOARD_SIZE)
            continue;
        const int p = y * BOARD_SIZE + x;
        if (!after.isEmpty(p))
            continue;
        const MoveAnalysis analysis = analyzePoint(after, p, side, rule);
        if (legalMove(analysis, side, rule) && analysis.value.directions[direction] == F5)
            return p;
    }
    return 255;
}

void writeStats(SearchStats *out,
                const SearchContext &ctx,
                double startMs,
                int routes,
                int candidates,
                bool abortedOverride = false)
{
    if (!out)
        return;
    *out = SearchStats {};
    out->nodes = ctx.nodes;
    out->elapsedMicros = uint32_t(std::max(0.0, (bbNowMs() - startMs) * 1000.0));
    out->routeCount = uint16_t(std::max(0, std::min(routes, 65535)));
    out->candidateCount = uint16_t(std::max(0, std::min(candidates, 65535)));
    out->maxPly = uint16_t(std::max(0, std::min(ctx.maxPlySeen, 65535)));
    out->aborted = (ctx.aborted || abortedOverride) ? 1 : 0;
}

} // namespace

extern "C" VCF_BB_KEEPALIVE int vcfBbFind(const uint8_t *board,
                                            int attacker,
                                            int rule,
                                            int maxRoutes,
                                            int maxDepth,
                                            uint32_t maxNodes,
                                            uint8_t *outMoves,
                                            uint16_t *outLengths,
                                            int maxMovesPerRoute,
                                            SearchStats *stats)
{
    const double start = bbNowMs();
    SearchContext ctx;
    int rootCandidates = 0;
    if (!board || !outMoves || !outLengths || (attacker != BLACK && attacker != WHITE)
        || rule < 0 || rule > 2 || maxRoutes <= 0 || maxMovesPerRoute <= 0) {
        writeStats(stats, ctx, start, 0, 0, true);
        return 0;
    }

    BitBoardState position;
    position.load(board);
    const auto routes = findRoutes(position,
                                   attacker,
                                   rule,
                                   std::min(maxRoutes, 64),
                                   maxDepth,
                                   maxNodes,
                                   ctx,
                                   rootCandidates);
    int written = 0;
    for (const auto &route : routes) {
        if (written >= maxRoutes)
            break;
        const int length = std::min<int>(route.size(), maxMovesPerRoute);
        outLengths[written] = uint16_t(length);
        std::copy_n(route.begin(), length, outMoves + written * maxMovesPerRoute);
        written++;
    }
    writeStats(stats, ctx, start, written, rootCandidates);
    return written;
}

extern "C" VCF_BB_KEEPALIVE int vcfBbValidateRoute(const uint8_t *board,
                                                     int attacker,
                                                     int rule,
                                                     const uint8_t *route,
                                                     int routeLen,
                                                     uint32_t maxNodes,
                                                     SearchStats *stats)
{
    const double start = bbNowMs();
    SearchContext ctx;
    ctx.maxNodes = std::max<uint32_t>(1, maxNodes);
    ctx.maxDepth = std::max(1, std::min(routeLen + 2, MAX_ROUTE_PLY));
    if (!board || !route || routeLen <= 0 || (attacker != BLACK && attacker != WHITE)) {
        writeStats(stats, ctx, start, 0, 0, true);
        return 0;
    }
    BitBoardState position;
    position.load(board);
    const bool valid = routeStillWins(position, attacker, rule, route, routeLen, ctx);
    writeStats(stats, ctx, start, valid ? 1 : 0, 0);
    return valid ? 1 : 0;
}

extern "C" VCF_BB_KEEPALIVE int vcfBbRouteDefense(const uint8_t *board,
                                                    int attacker,
                                                    int rule,
                                                    const uint8_t *route,
                                                    int routeLen,
                                                    uint32_t maxNodes,
                                                    uint8_t *outPoints,
                                                    int maxPoints,
                                                    SearchStats *stats)
{
    const double start = bbNowMs();
    SearchContext total;
    total.maxNodes = std::max<uint32_t>(1, maxNodes);
    total.maxDepth = std::max(1, std::min(routeLen + 2, MAX_ROUTE_PLY));
    if (!board || !route || !outPoints || routeLen <= 0 || maxPoints <= 0) {
        writeStats(stats, total, start, 0, 0, true);
        return 0;
    }

    BitBoardState original;
    original.load(board);
    const int defender = 3 - attacker;
    int count = 0;
    int candidates = 0;
    original.forEachEmpty([&](int idx) {
        if (count >= maxPoints)
            return;
        const MoveAnalysis analysis = analyzePoint(original, idx, defender, rule);
        if (!legalMove(analysis, defender, rule))
            return;
        candidates++;
        BitBoardState tested = original;
        tested.play(idx, defender);
        SearchContext local;
        local.maxNodes = std::max<uint32_t>(1, maxNodes);
        local.maxDepth = total.maxDepth;
        const bool stillWins = routeStillWins(tested, attacker, rule, route, routeLen, local);
        total.nodes += local.nodes;
        total.maxPlySeen = std::max(total.maxPlySeen, local.maxPlySeen);
        total.aborted = total.aborted || local.aborted;
        if (!stillWins && !local.aborted)
            outPoints[count++] = uint8_t(idx);
    });
    writeStats(stats, total, start, count, candidates);
    return count;
}

extern "C" VCF_BB_KEEPALIVE int vcfBbScanPoints(const uint8_t *board,
                                                  int attacker,
                                                  int placeColor,
                                                  int rule,
                                                  const uint16_t *indices,
                                                  int indexCount,
                                                  int maxDepth,
                                                  uint32_t maxNodes,
                                                  uint16_t *outIndices,
                                                  uint16_t *outLabels,
                                                  int maxResults,
                                                  SearchStats *stats)
{
    const double start = bbNowMs();
    SearchContext total;
    if (!board || !outIndices || !outLabels || maxResults <= 0
        || (attacker != BLACK && attacker != WHITE)
        || (placeColor != BLACK && placeColor != WHITE)) {
        writeStats(stats, total, start, 0, 0, true);
        return 0;
    }

    BitBoardState original;
    original.load(board);
    std::vector<int> scan;
    if (indices && indexCount > 0) {
        scan.reserve(indexCount);
        for (int i = 0; i < indexCount; i++)
            if (indices[i] < BOARD_CELLS)
                scan.push_back(indices[i]);
    }
    else {
        original.forEachEmpty([&](int idx) { scan.push_back(idx); });
    }

    int resultCount = 0;
    for (int idx : scan) {
        if (resultCount >= maxResults || !original.isEmpty(idx))
            continue;
        const MoveAnalysis placement = analyzePoint(original, idx, placeColor, rule);
        if (!legalMove(placement, placeColor, rule))
            continue;

        uint16_t label = 0;
        if (placeColor == attacker) {
            if (createsFive(placement))
                label = 5;
            else if (forcingRank(placement) <= 2)
                label = 4;
        }

        BitBoardState tested = original;
        tested.play(idx, placeColor);
        if (!label) {
            SearchContext local;
            int rootCandidates = 0;
            const auto routes = findRoutes(tested,
                                           attacker,
                                           rule,
                                           1,
                                           maxDepth,
                                           maxNodes,
                                           local,
                                           rootCandidates);
            total.nodes += local.nodes;
            total.maxPlySeen = std::max(total.maxPlySeen, local.maxPlySeen);
            total.aborted = total.aborted || local.aborted;
            if (!routes.empty())
                label = uint16_t(std::min<size_t>(routes.front().size(), 65535));
        }

        if (label) {
            outIndices[resultCount] = uint16_t(idx);
            outLabels[resultCount] = label;
            resultCount++;
        }
    }
    writeStats(stats, total, start, resultCount, int(scan.size()));
    return resultCount;
}

extern "C" VCF_BB_KEEPALIVE int vcfBbLegacyGetLevelPoint(const uint8_t *board,
                                                           int idx,
                                                           int side,
                                                           int rule)
{
    if (!board || idx < 0 || idx >= BOARD_CELLS)
        return 0;
    BitBoardState position;
    position.load(board);
    if (!position.isEmpty(idx)) {
        if (position.cells[idx] != side)
            return 0;
        position.undo(idx);
    }
    const MoveAnalysis analysis = analyzePoint(position, idx, side, rule);
    if (!analysis.valid)
        return 0;
    if (rule == RENJU && side == BLACK && analysis.value.forbidden)
        return 30;

    int best = 0;
    int fourDirections = 0;
    for (uint8_t pattern : analysis.value.directions) {
        best = std::max(best, legacyLineValue(pattern));
        if (pattern == B4 || pattern == F4)
            fourDirections++;
    }
    int flags = 0;
    if (analysis.value.sameLineDoubleFourMask)
        flags |= 0x40;
    else if (fourDirections >= 2)
        flags |= 0x20;
    return best | flags;
}

extern "C" VCF_BB_KEEPALIVE int vcfBbLegacyTestLineFour(const uint8_t *board,
                                                          int idx,
                                                          int direction,
                                                          int side,
                                                          int rule)
{
    if (!board || idx < 0 || idx >= BOARD_CELLS || direction < 0 || direction > 3)
        return 0;
    BitBoardState position;
    position.load(board);
    if (!position.isEmpty(idx)) {
        if (position.cells[idx] != side)
            return 0;
        position.undo(idx);
    }
    const MoveAnalysis analysis = analyzePoint(position, idx, side, rule);
    if (!analysis.valid)
        return 0;
    int value = legacyLineValue(analysis.value.directions[direction]);
    if (analysis.value.sameLineDoubleFourMask & (1U << direction))
        value = 24;
    const int point = lineFivePoint(position, idx, direction, side, rule);
    return value | ((point & 0xff) << 8);
}

extern "C" VCF_BB_KEEPALIVE int vcfBbLegacyGetBlockFourPoint(const uint8_t *board,
                                                               int idx,
                                                               int direction,
                                                               int side,
                                                               int rule)
{
    if (!board)
        return 255;
    BitBoardState position;
    position.load(board);
    if (!position.isEmpty(idx)) {
        if (position.cells[idx] != side)
            return 255;
        position.undo(idx);
    }
    return lineFivePoint(position, idx, direction, side, rule);
}

extern "C" VCF_BB_KEEPALIVE int vcfBbLegacyIsFoul(const uint8_t *board, int idx, int rule)
{
    if (!board || rule != RENJU || idx < 0 || idx >= BOARD_CELLS)
        return 0;
    BitBoardState position;
    position.load(board);
    const MoveAnalysis analysis = analyzePoint(position, idx, BLACK, rule);
    return analysis.valid && analysis.value.forbidden ? 1 : 0;
}

extern "C" VCF_BB_KEEPALIVE int vcfBbSelfTest()
{
    if (vcfPatternSelfTest() != 0)
        return 1;

    BitBoardState board;
    board.clear();
    board.play(7 * BOARD_SIZE + 3, BLACK);
    board.play(7 * BOARD_SIZE + 4, BLACK);
    board.play(7 * BOARD_SIZE + 5, BLACK);
    SearchContext ctx;
    int candidates = 0;
    const auto routes = findRoutes(board, BLACK, RENJU, 4, 20, 100000, ctx, candidates);
    if (routes.empty())
        return 2;
    if (routes.front().empty())
        return 3;

    const auto before = board.black;
    board.play(0, WHITE);
    board.undo(0);
    if (before != board.black || board.cells[0] != EMPTY)
        return 4;

    return 0;
}

#ifdef VCF_BITBOARD_TEST_MAIN
int main()
{
    const int result = vcfBbSelfTest();
    std::printf("bitboard self-test: %d\n", result);
    return result;
}
#endif
