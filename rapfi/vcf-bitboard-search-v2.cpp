#include <algorithm>
#include <array>
#include <chrono>
#include <cstdint>
#include <cstring>
#include <limits>
#include <string>
#include <unordered_map>
#include <utility>
#include <vector>

#ifdef __EMSCRIPTEN__
#include <emscripten/emscripten.h>
#define VCF_BB_V2_KEEPALIVE EMSCRIPTEN_KEEPALIVE
static double v2NowMs() { return emscripten_get_now(); }
#else
#define VCF_BB_V2_KEEPALIVE
static double v2NowMs()
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
constexpr int RENJU = 2;
constexpr uint8_t EMPTY = 0;
constexpr uint8_t BLACK = 1;
constexpr uint8_t WHITE = 2;
constexpr uint8_t B4 = 11;
constexpr uint8_t F4 = 12;
constexpr uint8_t F5 = 13;
constexpr uint8_t A_FIVE = 13;
constexpr int MODE_SINGLE = 0;
constexpr int MODE_MULTI = 1;
constexpr int MODE_SHORTEST = 2;

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

struct SingleTTEntry {
    uint32_t signature;
    uint8_t bestMove;
    uint8_t result;       // 0=empty, 1=win, 2=loss
    uint8_t depth;
    uint8_t mateLen;
    uint16_t generation;
    uint16_t reserved;
};

struct SingleTTBucket {
    SingleTTEntry entries[5];
    uint8_t padding[4];
};
#pragma pack(pop)

static_assert(sizeof(PatternExportResult) == 16, "pattern ABI mismatch");
static_assert(sizeof(SearchStats) == 16, "stats ABI mismatch");
static_assert(sizeof(SingleTTEntry) == 12, "single TT entry must be 12 bytes");
static_assert(sizeof(SingleTTBucket) == 64, "single TT bucket must fit one cache line");

extern "C" int vcfAnalyzePoint(const uint8_t *board,
                                int idx,
                                int side,
                                int rule,
                                int method,
                                PatternExportResult *out);
extern "C" int vcfBbValidateRoute(const uint8_t *board,
                                   int attacker,
                                   int rule,
                                   const uint8_t *route,
                                   int routeLen,
                                   uint32_t maxNodes,
                                   SearchStats *stats);
extern "C" int vcfPatternSelfTest();

uint64_t splitmix64(uint64_t &state)
{
    uint64_t z = (state += 0x9e3779b97f4a7c15ULL);
    z = (z ^ (z >> 30)) * 0xbf58476d1ce4e5b9ULL;
    z = (z ^ (z >> 27)) * 0x94d049bb133111ebULL;
    return z ^ (z >> 31);
}

uint64_t mix64(uint64_t x)
{
    x ^= x >> 30;
    x *= 0xbf58476d1ce4e5b9ULL;
    x ^= x >> 27;
    x *= 0x94d049bb133111ebULL;
    return x ^ (x >> 31);
}

struct ZobristData {
    std::array<std::array<uint64_t, BOARD_CELLS>, 3> stone1 {};
    std::array<std::array<uint64_t, BOARD_CELLS>, 3> stone2 {};
    std::array<uint64_t, 3> attacker1 {};
    std::array<uint64_t, 3> attacker2 {};
    std::array<uint64_t, 3> rule1 {};
    std::array<uint64_t, 3> rule2 {};

    ZobristData()
    {
        uint64_t seed1 = 0x5643462d42495431ULL;
        uint64_t seed2 = 0x5643462d42495432ULL;
        for (int side = 0; side < 3; side++) {
            for (int idx = 0; idx < BOARD_CELLS; idx++) {
                stone1[side][idx] = splitmix64(seed1);
                stone2[side][idx] = splitmix64(seed2);
            }
            attacker1[side] = splitmix64(seed1);
            attacker2[side] = splitmix64(seed2);
            rule1[side] = splitmix64(seed1);
            rule2[side] = splitmix64(seed2);
        }
    }
};

const ZobristData ZOBRIST;

struct BitBoardStateV2 {
    std::array<uint8_t, BOARD_CELLS> cells {};
    std::array<uint64_t, BIT_WORDS> black {};
    std::array<uint64_t, BIT_WORDS> white {};
    uint64_t hash1 = 0;
    uint64_t hash2 = 0;

    void clear()
    {
        cells.fill(EMPTY);
        black.fill(0);
        white.fill(0);
        hash1 = hash2 = 0;
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
        hash1 ^= ZOBRIST.stone1[side][idx];
        hash2 ^= ZOBRIST.stone2[side][idx];
    }

    void undo(int idx)
    {
        const uint8_t side = cells[idx];
        if (side != BLACK && side != WHITE)
            return;
        const int word = idx >> 6;
        const uint64_t bit = uint64_t(1) << (idx & 63);
        if (side == BLACK)
            black[word] &= ~bit;
        else
            white[word] &= ~bit;
        hash1 ^= ZOBRIST.stone1[side][idx];
        hash2 ^= ZOBRIST.stone2[side][idx];
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
                fn(word * 64 + bit);
                empty &= empty - 1;
            }
        }
    }

    uint64_t key1(int attacker, int rule) const
    {
        return hash1 ^ ZOBRIST.attacker1[attacker] ^ ZOBRIST.rule1[std::clamp(rule, 0, 2)];
    }

    uint64_t key2(int attacker, int rule) const
    {
        return hash2 ^ ZOBRIST.attacker2[attacker] ^ ZOBRIST.rule2[std::clamp(rule, 0, 2)];
    }
};

struct MoveAnalysisV2 {
    PatternExportResult value {};
    bool valid = false;
};

MoveAnalysisV2 analyzePointV2(const BitBoardStateV2 &board, int idx, int side, int rule)
{
    MoveAnalysisV2 result;
    if (!board.isEmpty(idx))
        return result;
    result.valid = vcfAnalyzePoint(board.cells.data(), idx, side, rule, 0, &result.value) != 0;
    return result;
}

bool legalMoveV2(const MoveAnalysisV2 &analysis, int side, int rule)
{
    return analysis.valid && !(rule == RENJU && side == BLACK && analysis.value.forbidden);
}

bool createsFiveV2(const MoveAnalysisV2 &analysis)
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

int forcingRankV2(const MoveAnalysisV2 &analysis)
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

struct CandidateMoveV2 {
    uint8_t idx = 0;
    uint8_t rank = 99;
};

std::vector<CandidateMoveV2> forcingMovesV2(const BitBoardStateV2 &board, int attacker, int rule)
{
    std::vector<CandidateMoveV2> moves;
    board.forEachEmpty([&](int idx) {
        const MoveAnalysisV2 analysis = analyzePointV2(board, idx, attacker, rule);
        if (!legalMoveV2(analysis, attacker, rule))
            return;
        const int rank = forcingRankV2(analysis);
        if (rank < 99)
            moves.push_back({uint8_t(idx), uint8_t(rank)});
    });
    std::stable_sort(moves.begin(), moves.end(), [](const CandidateMoveV2 &a, const CandidateMoveV2 &b) {
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

std::vector<uint8_t> immediateWinningPointsV2(const BitBoardStateV2 &board,
                                               int side,
                                               int rule,
                                               int stopAfter = BOARD_CELLS)
{
    std::vector<uint8_t> wins;
    board.forEachEmpty([&](int idx) {
        if (int(wins.size()) >= stopAfter)
            return;
        const MoveAnalysisV2 analysis = analyzePointV2(board, idx, side, rule);
        if (legalMoveV2(analysis, side, rule) && createsFiveV2(analysis))
            wins.push_back(uint8_t(idx));
    });
    return wins;
}

struct SearchContextV2 {
    uint32_t maxNodes = 5000000;
    int maxDepth = 200;
    uint32_t nodes = 0;
    int maxPlySeen = 0;
    bool aborted = false;

    bool touch(int ply)
    {
        maxPlySeen = std::max(maxPlySeen, ply);
        if (nodes >= maxNodes || ply > maxDepth) {
            aborted = true;
            return false;
        }
        nodes++;
        return true;
    }

    uint32_t remainingNodes() const
    {
        return maxNodes > nodes ? maxNodes - nodes : 0;
    }
};

constexpr size_t SINGLE_TT_BUCKET_COUNT = size_t(1) << 17; // 8 MiB
std::vector<SingleTTBucket> SINGLE_TT(SINGLE_TT_BUCKET_COUNT);
uint16_t SINGLE_TT_GENERATION = 0;

uint32_t signatureOf(uint64_t key)
{
    return uint32_t(key) ^ uint32_t(key >> 32);
}

SingleTTEntry *singleTTFind(uint64_t key)
{
    SingleTTBucket &bucket = SINGLE_TT[key & (SINGLE_TT_BUCKET_COUNT - 1)];
    const uint32_t signature = signatureOf(key);
    for (SingleTTEntry &entry : bucket.entries)
        if (entry.result && entry.signature == signature)
            return &entry;
    return nullptr;
}

void singleTTStore(uint64_t key, uint8_t result, uint8_t bestMove, int depth, int mateLen)
{
    SingleTTBucket &bucket = SINGLE_TT[key & (SINGLE_TT_BUCKET_COUNT - 1)];
    const uint32_t signature = signatureOf(key);
    SingleTTEntry *replace = &bucket.entries[0];
    int replaceScore = std::numeric_limits<int>::max();
    for (SingleTTEntry &entry : bucket.entries) {
        if (!entry.result || entry.signature == signature) {
            replace = &entry;
            break;
        }
        const uint16_t age = uint16_t(SINGLE_TT_GENERATION - entry.generation);
        const int score = int(entry.depth) - int(age);
        if (score < replaceScore) {
            replaceScore = score;
            replace = &entry;
        }
    }
    if (replace->result && replace->signature == signature
        && replace->depth > std::clamp(depth, 0, 255)
        && result != 1)
        return;
    *replace = SingleTTEntry {};
    replace->signature = signature;
    replace->bestMove = bestMove;
    replace->result = result;
    replace->depth = uint8_t(std::clamp(depth, 0, 255));
    replace->mateLen = uint8_t(std::clamp(mateLen, 0, 255));
    replace->generation = SINGLE_TT_GENERATION;
}

bool searchSingleV2(BitBoardStateV2 &board,
                    int attacker,
                    int rule,
                    int ply,
                    SearchContextV2 &ctx,
                    std::vector<uint8_t> &route);

bool trySingleAttackV2(BitBoardStateV2 &board,
                       int attacker,
                       int rule,
                       int ply,
                       uint8_t move,
                       SearchContextV2 &ctx,
                       std::vector<uint8_t> &route)
{
    if (!ctx.touch(ply + 1))
        return false;
    const MoveAnalysisV2 attack = analyzePointV2(board, move, attacker, rule);
    if (!legalMoveV2(attack, attacker, rule) || forcingRankV2(attack) >= 99)
        return false;

    board.play(move, attacker);
    route.push_back(move);
    if (createsFiveV2(attack)) {
        board.undo(move);
        return true;
    }

    const int defender = 3 - attacker;
    if (!immediateWinningPointsV2(board, defender, rule, 1).empty()) {
        route.pop_back();
        board.undo(move);
        return false;
    }

    const std::vector<uint8_t> wins = immediateWinningPointsV2(board, attacker, rule, 2);
    if (wins.size() >= 2) {
        board.undo(move);
        return true;
    }
    if (wins.empty()) {
        route.pop_back();
        board.undo(move);
        return false;
    }

    const uint8_t defense = wins.front();
    const MoveAnalysisV2 defenseAnalysis = analyzePointV2(board, defense, defender, rule);
    if (!legalMoveV2(defenseAnalysis, defender, rule)) {
        board.undo(move);
        return true;
    }
    if (ply + 2 > ctx.maxDepth) {
        route.pop_back();
        board.undo(move);
        return false;
    }

    board.play(defense, defender);
    route.push_back(defense);
    const bool won = searchSingleV2(board, attacker, rule, ply + 2, ctx, route);
    if (!won) {
        route.pop_back();
        route.pop_back();
    }
    board.undo(defense);
    board.undo(move);
    return won;
}

bool searchSingleV2(BitBoardStateV2 &board,
                    int attacker,
                    int rule,
                    int ply,
                    SearchContextV2 &ctx,
                    std::vector<uint8_t> &route)
{
    if (ctx.aborted || ply >= ctx.maxDepth)
        return false;

    const int remainingDepth = ctx.maxDepth - ply;
    const uint64_t key = board.key1(attacker, rule);
    if (SingleTTEntry *entry = singleTTFind(key)) {
        entry->generation = SINGLE_TT_GENERATION;
        if (entry->result == 2 && entry->depth >= remainingDepth)
            return false;
        if (entry->result == 1 && entry->mateLen <= remainingDepth && entry->bestMove < BOARD_CELLS) {
            const size_t oldSize = route.size();
            if (trySingleAttackV2(board, attacker, rule, ply, entry->bestMove, ctx, route))
                return true;
            route.resize(oldSize);
            if (ctx.aborted)
                return false;
        }
    }

    const std::vector<CandidateMoveV2> moves = forcingMovesV2(board, attacker, rule);
    for (const CandidateMoveV2 &candidate : moves) {
        const size_t oldSize = route.size();
        if (trySingleAttackV2(board, attacker, rule, ply, candidate.idx, ctx, route)) {
            singleTTStore(key,
                          1,
                          candidate.idx,
                          remainingDepth,
                          int(route.size() - oldSize));
            return true;
        }
        route.resize(oldSize);
        if (ctx.aborted)
            return false;
    }

    if (!ctx.aborted)
        singleTTStore(key, 2, 255, remainingDepth, 0);
    return false;
}

std::vector<uint8_t> simplifyRouteV2(const uint8_t *initialBoard,
                                     int attacker,
                                     int rule,
                                     const std::vector<uint8_t> &source,
                                     SearchContextV2 &ctx)
{
    std::vector<uint8_t> route = source;
    if (!initialBoard || route.size() < 3)
        return route;

    for (int pairStart = int(route.size()) - 3; pairStart >= 0; pairStart -= 2) {
        if (pairStart + 1 >= int(route.size()))
            continue;
        std::vector<uint8_t> candidate;
        candidate.reserve(route.size() - 2);
        candidate.insert(candidate.end(), route.begin(), route.begin() + pairStart);
        candidate.insert(candidate.end(), route.begin() + pairStart + 2, route.end());
        if (candidate.empty())
            continue;

        SearchStats local {};
        const uint32_t budget = std::max<uint32_t>(1, ctx.remainingNodes());
        const bool valid = vcfBbValidateRoute(initialBoard,
                                               attacker,
                                               rule,
                                               candidate.data(),
                                               int(candidate.size()),
                                               budget,
                                               &local) != 0;
        ctx.nodes = std::min<uint64_t>(uint64_t(ctx.maxNodes), uint64_t(ctx.nodes) + local.nodes);
        ctx.maxPlySeen = std::max(ctx.maxPlySeen, int(local.maxPly));
        if (local.aborted) {
            ctx.aborted = true;
            break;
        }
        if (valid)
            route.swap(candidate);
    }
    return route;
}

bool routeSubsetByColor(const std::vector<uint8_t> &small,
                        const std::vector<uint8_t> &large)
{
    if (small.size() > large.size())
        return false;
    std::array<uint8_t, BOARD_CELLS> position {};
    for (size_t i = 0; i < large.size(); i++)
        position[large[i]] = uint8_t((i & 1) ? 2 : 1);
    for (size_t i = 0; i < small.size(); i++)
        if (position[small[i]] != uint8_t((i & 1) ? 2 : 1))
            return false;
    return true;
}

struct EnumKey {
    uint64_t a;
    uint64_t b;
    bool operator==(const EnumKey &other) const { return a == other.a && b == other.b; }
};

struct EnumKeyHasher {
    size_t operator()(const EnumKey &key) const
    {
        return size_t(mix64(key.a ^ (key.b + 0x9e3779b97f4a7c15ULL)));
    }
};

struct MultiSearchV2 {
    const uint8_t *initialBoard = nullptr;
    int attacker = BLACK;
    int rule = RENJU;
    int maxRoutes = 20;
    bool simplify = true;
    SearchContextV2 *ctx = nullptr;
    std::vector<std::vector<uint8_t>> routes;
    std::unordered_map<EnumKey, uint8_t, EnumKeyHasher> states; // 1=expanding, 2=complete

    bool full() const { return int(routes.size()) >= maxRoutes; }

    void addRoute(const std::vector<uint8_t> &raw)
    {
        if (full() || ctx->aborted)
            return;
        std::vector<uint8_t> route = simplify ? simplifyRouteV2(initialBoard, attacker, rule, raw, *ctx) : raw;
        if (route.empty() || ctx->aborted)
            return;

        for (size_t i = routes.size(); i-- > 0;) {
            if (route.size() < routes[i].size() && routeSubsetByColor(route, routes[i]))
                routes.erase(routes.begin() + i);
            else if (routeSubsetByColor(routes[i], route))
                return;
        }
        auto pos = std::lower_bound(routes.begin(), routes.end(), route.size(), [](const auto &moves, size_t len) {
            return moves.size() < len;
        });
        routes.insert(pos, std::move(route));
    }
};

bool enumerateAttackV2(BitBoardStateV2 &board,
                       int ply,
                       std::vector<uint8_t> &route,
                       MultiSearchV2 &search);

bool enumerateMoveV2(BitBoardStateV2 &board,
                     int ply,
                     uint8_t move,
                     std::vector<uint8_t> &route,
                     MultiSearchV2 &search)
{
    SearchContextV2 &ctx = *search.ctx;
    if (search.full() || ctx.aborted || !ctx.touch(ply + 1))
        return false;

    const MoveAnalysisV2 attack = analyzePointV2(board, move, search.attacker, search.rule);
    if (!legalMoveV2(attack, search.attacker, search.rule) || forcingRankV2(attack) >= 99)
        return true;

    board.play(move, search.attacker);
    route.push_back(move);
    bool complete = true;

    if (createsFiveV2(attack)) {
        search.addRoute(route);
    }
    else {
        const int defender = 3 - search.attacker;
        if (immediateWinningPointsV2(board, defender, search.rule, 1).empty()) {
            const std::vector<uint8_t> wins = immediateWinningPointsV2(board, search.attacker, search.rule, 2);
            if (wins.size() >= 2) {
                search.addRoute(route);
            }
            else if (wins.size() == 1) {
                const uint8_t defense = wins.front();
                const MoveAnalysisV2 defenseAnalysis = analyzePointV2(board, defense, defender, search.rule);
                if (!legalMoveV2(defenseAnalysis, defender, search.rule)) {
                    search.addRoute(route);
                }
                else if (ply + 2 <= ctx.maxDepth && !search.full()) {
                    board.play(defense, defender);
                    route.push_back(defense);
                    complete = enumerateAttackV2(board, ply + 2, route, search);
                    route.pop_back();
                    board.undo(defense);
                }
            }
        }
    }

    route.pop_back();
    board.undo(move);
    return complete && !ctx.aborted && !search.full();
}

bool enumerateAttackV2(BitBoardStateV2 &board,
                       int ply,
                       std::vector<uint8_t> &route,
                       MultiSearchV2 &search)
{
    SearchContextV2 &ctx = *search.ctx;
    if (ctx.aborted || search.full() || ply >= ctx.maxDepth)
        return false;

    const EnumKey key {board.key1(search.attacker, search.rule), board.key2(search.attacker, search.rule)};
    const auto found = search.states.find(key);
    if (found != search.states.end())
        return true; // same exact attack-turn position is already expanding or complete
    search.states.emplace(key, 1);

    bool complete = true;
    const std::vector<CandidateMoveV2> moves = forcingMovesV2(board, search.attacker, search.rule);
    for (const CandidateMoveV2 &candidate : moves) {
        if (!enumerateMoveV2(board, ply, candidate.idx, route, search))
            complete = false;
        if (ctx.aborted || search.full()) {
            complete = false;
            break;
        }
    }

    auto it = search.states.find(key);
    if (complete && it != search.states.end())
        it->second = 2;
    else if (it != search.states.end())
        search.states.erase(it);
    return complete;
}

std::vector<std::vector<uint8_t>> runSingleV2(BitBoardStateV2 board,
                                               const uint8_t *initialBoard,
                                               int attacker,
                                               int rule,
                                               bool simplify,
                                               int maxDepth,
                                               uint32_t maxNodes,
                                               SearchContextV2 &ctx,
                                               int &rootCandidates)
{
    ctx.maxDepth = std::clamp(maxDepth, 1, MAX_ROUTE_PLY);
    ctx.maxNodes = std::max<uint32_t>(1, maxNodes);
    rootCandidates = int(forcingMovesV2(board, attacker, rule).size());
    ++SINGLE_TT_GENERATION;
    if (!SINGLE_TT_GENERATION)
        ++SINGLE_TT_GENERATION;

    std::vector<uint8_t> route;
    if (!searchSingleV2(board, attacker, rule, 0, ctx, route))
        return {};
    if (simplify)
        route = simplifyRouteV2(initialBoard, attacker, rule, route, ctx);
    return route.empty() ? std::vector<std::vector<uint8_t>> {} : std::vector<std::vector<uint8_t>> {route};
}

std::vector<std::vector<uint8_t>> runMultiAtDepthV2(BitBoardStateV2 board,
                                                     const uint8_t *initialBoard,
                                                     int attacker,
                                                     int rule,
                                                     int maxRoutes,
                                                     bool simplify,
                                                     int maxDepth,
                                                     SearchContextV2 &ctx,
                                                     int &rootCandidates)
{
    rootCandidates = int(forcingMovesV2(board, attacker, rule).size());
    MultiSearchV2 search;
    search.initialBoard = initialBoard;
    search.attacker = attacker;
    search.rule = rule;
    search.maxRoutes = std::max(1, maxRoutes);
    search.simplify = simplify;
    search.ctx = &ctx;
    std::vector<uint8_t> route;
    enumerateAttackV2(board, 0, route, search);
    return search.routes;
}

std::vector<std::vector<uint8_t>> runSearchV2(BitBoardStateV2 board,
                                               const uint8_t *initialBoard,
                                               int attacker,
                                               int rule,
                                               int mode,
                                               bool simplify,
                                               int maxRoutes,
                                               int maxDepth,
                                               uint32_t maxNodes,
                                               SearchContextV2 &ctx,
                                               int &rootCandidates)
{
    mode = std::clamp(mode, MODE_SINGLE, MODE_SHORTEST);
    maxRoutes = std::clamp(maxRoutes, 1, 64);
    maxDepth = std::clamp(maxDepth, 1, MAX_ROUTE_PLY);
    maxNodes = std::max<uint32_t>(1, maxNodes);
    if (mode == MODE_SINGLE)
        return runSingleV2(board, initialBoard, attacker, rule, simplify, maxDepth, maxNodes, ctx, rootCandidates);

    if (mode == MODE_MULTI) {
        ctx.maxDepth = maxDepth;
        ctx.maxNodes = maxNodes;
        return runMultiAtDepthV2(board,
                                 initialBoard,
                                 attacker,
                                 rule,
                                 maxRoutes,
                                 true,
                                 maxDepth,
                                 ctx,
                                 rootCandidates);
    }

    SearchContextV2 total;
    total.maxDepth = maxDepth;
    total.maxNodes = maxNodes;
    std::vector<std::vector<uint8_t>> routes;
    int lastCandidates = 0;
    for (int depth = 1; depth <= maxDepth; depth += 2) {
        SearchContextV2 iteration;
        iteration.maxDepth = depth;
        iteration.maxNodes = std::max<uint32_t>(1, total.remainingNodes());
        auto found = runMultiAtDepthV2(board,
                                       initialBoard,
                                       attacker,
                                       rule,
                                       maxRoutes,
                                       true,
                                       depth,
                                       iteration,
                                       lastCandidates);
        total.nodes = std::min<uint64_t>(uint64_t(total.maxNodes), uint64_t(total.nodes) + iteration.nodes);
        total.maxPlySeen = std::max(total.maxPlySeen, iteration.maxPlySeen);
        if (!found.empty()) {
            routes = std::move(found);
            break;
        }
        if (iteration.aborted || total.nodes >= total.maxNodes) {
            total.aborted = true;
            break;
        }
    }
    ctx = total;
    rootCandidates = lastCandidates;
    return routes;
}

void writeStatsV2(SearchStats *out,
                  const SearchContextV2 &ctx,
                  double startMs,
                  int routes,
                  int candidates,
                  bool abortedOverride = false)
{
    if (!out)
        return;
    *out = SearchStats {};
    out->nodes = ctx.nodes;
    out->elapsedMicros = uint32_t(std::max(0.0, (v2NowMs() - startMs) * 1000.0));
    out->routeCount = uint16_t(std::clamp(routes, 0, 65535));
    out->candidateCount = uint16_t(std::clamp(candidates, 0, 65535));
    out->maxPly = uint16_t(std::clamp(ctx.maxPlySeen, 0, 65535));
    out->aborted = (ctx.aborted || abortedOverride) ? 1 : 0;
}

} // namespace

extern "C" VCF_BB_V2_KEEPALIVE int vcfBbFindMode(const uint8_t *board,
                                                    int attacker,
                                                    int rule,
                                                    int mode,
                                                    int simplify,
                                                    int maxRoutes,
                                                    int maxDepth,
                                                    uint32_t maxNodes,
                                                    uint8_t *outMoves,
                                                    uint16_t *outLengths,
                                                    int maxMovesPerRoute,
                                                    SearchStats *stats)
{
    const double start = v2NowMs();
    SearchContextV2 ctx;
    int rootCandidates = 0;
    if (!board || !outMoves || !outLengths || (attacker != BLACK && attacker != WHITE)
        || rule < 0 || rule > 2 || maxRoutes <= 0 || maxMovesPerRoute <= 0) {
        writeStatsV2(stats, ctx, start, 0, 0, true);
        return 0;
    }

    BitBoardStateV2 position;
    position.load(board);
    const auto routes = runSearchV2(position,
                                    board,
                                    attacker,
                                    rule,
                                    mode,
                                    simplify != 0,
                                    maxRoutes,
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
    writeStatsV2(stats, ctx, start, written, rootCandidates);
    return written;
}

extern "C" VCF_BB_V2_KEEPALIVE int vcfBbScanPointsMode(const uint8_t *board,
                                                          int attacker,
                                                          int placeColor,
                                                          int rule,
                                                          int mode,
                                                          int simplify,
                                                          const uint16_t *indices,
                                                          int indexCount,
                                                          int maxDepth,
                                                          uint32_t maxNodes,
                                                          uint16_t *outIndices,
                                                          uint16_t *outLabels,
                                                          int maxResults,
                                                          SearchStats *stats)
{
    const double start = v2NowMs();
    SearchContextV2 total;
    total.maxNodes = std::numeric_limits<uint32_t>::max();
    total.maxDepth = std::clamp(maxDepth, 1, MAX_ROUTE_PLY);
    if (!board || !outIndices || !outLabels || maxResults <= 0
        || (attacker != BLACK && attacker != WHITE)
        || (placeColor != BLACK && placeColor != WHITE)) {
        writeStatsV2(stats, total, start, 0, 0, true);
        return 0;
    }

    BitBoardStateV2 original;
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
        const MoveAnalysisV2 placement = analyzePointV2(original, idx, placeColor, rule);
        if (!legalMoveV2(placement, placeColor, rule))
            continue;

        uint16_t label = 0;
        if (placeColor == attacker) {
            if (createsFiveV2(placement))
                label = 5;
            else if (forcingRankV2(placement) <= 2)
                label = 4;
        }

        if (!label) {
            BitBoardStateV2 tested = original;
            tested.play(idx, placeColor);
            SearchContextV2 local;
            int rootCandidates = 0;
            const auto routes = runSearchV2(tested,
                                            tested.cells.data(),
                                            attacker,
                                            rule,
                                            mode,
                                            simplify != 0,
                                            mode == MODE_SINGLE ? 1 : 64,
                                            maxDepth,
                                            maxNodes,
                                            local,
                                            rootCandidates);
            total.nodes = uint32_t(std::min<uint64_t>(std::numeric_limits<uint32_t>::max(),
                                                       uint64_t(total.nodes) + local.nodes));
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
    writeStatsV2(stats, total, start, resultCount, int(scan.size()));
    return resultCount;
}

extern "C" VCF_BB_V2_KEEPALIVE int vcfBbSearchV2SelfTest()
{
    if (sizeof(SingleTTEntry) != 12 || sizeof(SingleTTBucket) != 64)
        return 1;
    if (SINGLE_TT.size() != SINGLE_TT_BUCKET_COUNT)
        return 2;
    return vcfPatternSelfTest();
}
