// 保證最短的單組 VCF 搜尋。
//
// 流程：
// 1. 先在指定上限內找到任一組 VCF。
// 2. 以目前最佳路線 bestPly - 2 作為下一個合法奇數深度上限。
// 3. 找到更短路線就更新 best，直到較短範圍完整證明無解。
//
// 搜尋全程使用同一張有限容量、無覆蓋的完整盤面無解集合。
// 只有完整搜尋完成的失敗節點會寫入；容量滿後停止新增，不會錯誤剪枝。
#pragma once

namespace {

class ShortestOneExactNoWinTableV1 {
public:
    static constexpr size_t MAX_ENTRIES = 524288;

    ShortestOneExactNoWinTableV1()
    {
        table.reserve(MAX_ENTRIES);
        table.max_load_factor(0.82f);
    }

    bool has(const Position &position) const
    {
        const CompactPosition key {position.board.black, position.board.white, position.board.hash};
        return table.find(key) != table.end();
    }

    void store(const Position &position)
    {
        if (table.size() >= MAX_ENTRIES)
            return;
        table.insert({position.board.black, position.board.white, position.board.hash});
    }

private:
    std::unordered_set<CompactPosition, CompactPositionHasher> table;
};

struct ShortestOneRunnerV1 {
    int attacker = BLACK;
    int rule = RENJU;
    int maxDepth = 1;
    TimedSearchContextV4 *ctx = nullptr;
    ShortestOneExactNoWinTableV1 *transTable = nullptr;
    std::vector<CandidateList> candidatesByDepth;
    CandidateBuildScratch buildScratch;
    std::vector<uint8_t> route;
    std::vector<uint8_t> foundRoute;
    int rootCandidates = 0;

    bool dfs(Position &position, int ply, int lastDefense, int center)
    {
        if (ctx->aborted || ply >= maxDepth)
            return false;
        if (transTable->has(position))
            return false;

        const int defender = 3 - attacker;
        const Threat counter = ply == 0
            ? scanThreatAll(position, defender, rule)
            : scanThreatThrough(position, lastDefense, defender, rule);
        if (counter.hasFive || counter.count >= 2) {
            transTable->store(position);
            return false;
        }
        const int forcedPoint = counter.count == 1 ? counter.points[0] : NIL;

        CandidateList &candidates = candidatesByDepth[
            std::min<size_t>(size_t(ply / 2), candidatesByDepth.size() - 1)
        ];
        scanCandidates(position, attacker, rule, forcedPoint, center, buildScratch, candidates);
        if (ply == 0)
            rootCandidates = candidates.count;

        for (int i = 0; i < candidates.count; i++) {
            const Candidate candidate = candidates.items[i];
            if (ctx->aborted || !ctx->touch(ply + 1))
                break;

            const size_t oldSize = route.size();
            position.play(candidate.idx, attacker);
            route.push_back(candidate.idx);

            bool terminalWin = candidate.immediate || candidate.defenseCount >= 2;
            bool childWin = false;
            if (!terminalWin && candidate.defenseCount == 1) {
                const int defense = candidate.defenses[0];
                if (!fullLegal(position.board, defense, defender, rule)) {
                    terminalWin = true;
                }
                else if (ply + 2 <= maxDepth) {
                    position.play(defense, defender);
                    route.push_back(uint8_t(defense));
                    childWin = dfs(position, ply + 2, defense, candidate.idx);
                    position.undo(defense);
                }
            }

            if (terminalWin)
                foundRoute = route;

            route.resize(oldSize);
            position.undo(candidate.idx);

            if (terminalWin || childWin)
                return true;
        }

        if (!ctx->aborted)
            transTable->store(position);
        return false;
    }

    bool search(Position &position, int depth, std::vector<uint8_t> &output)
    {
        maxDepth = std::max(1, depth);
        ctx->maxDepth = maxDepth;
        route.clear();
        foundRoute.clear();
        const bool found = dfs(position, 0, -1, CENTER);
        output = foundRoute;
        return found;
    }
};

int normalizeShortestOneDepthV1(int maxDepth)
{
    int depth = std::clamp(maxDepth, 1, MAX_ROUTE_PLY);
    if ((depth & 1) == 0)
        depth--;
    return std::max(1, depth);
}

int shortestOneFindImplV1(const uint8_t *board,
                          int attacker,
                          int rule,
                          int maxDepth,
                          uint32_t encodedLimits,
                          uint8_t *outMoves,
                          uint16_t *outLength,
                          int maxMoves,
                          SearchStats *stats)
{
    const double start = legacyNowMs();
    TimedSearchContextV4 ctx;
    ctx.maxNodes = configureMultiLimitsV4(encodedLimits);
    int rootCandidates = 0;

    if (!board || !outMoves || !outLength || maxMoves <= 0
        || (attacker != BLACK && attacker != WHITE)
        || rule < FREESTYLE || rule > RENJU) {
        writeStatsMultiV4(stats, ctx, start, 0, 0, true);
        return 0;
    }

    Position position;
    position.load(board);
    ShortestOneExactNoWinTableV1 transTable;
    ShortestOneRunnerV1 runner;
    runner.attacker = attacker;
    runner.rule = rule;
    runner.ctx = &ctx;
    runner.transTable = &transTable;
    runner.candidatesByDepth.resize(size_t(MAX_ROUTE_PLY / 2 + 2));
    runner.route.reserve(MAX_ROUTE_PLY);
    runner.foundRoute.reserve(MAX_ROUTE_PLY);

    std::vector<uint8_t> bestRoute;
    const int initialDepth = normalizeShortestOneDepthV1(maxDepth);
    const bool initialFound = runner.search(position, initialDepth, bestRoute);
    rootCandidates = runner.rootCandidates;

    int status = 0;
    if (initialFound && !bestRoute.empty()) {
        status = ctx.aborted ? 1 : 2;
        while (!ctx.aborted && bestRoute.size() > 1) {
            const int shorterDepth = int(bestRoute.size()) - 2;
            std::vector<uint8_t> shorterRoute;
            const bool shorterFound = runner.search(position, shorterDepth, shorterRoute);
            if (ctx.aborted) {
                status = 1;
                break;
            }
            if (!shorterFound) {
                status = 2;
                break;
            }
            if (shorterRoute.empty() || shorterRoute.size() >= bestRoute.size()) {
                ctx.aborted = true;
                status = 1;
                break;
            }
            bestRoute.swap(shorterRoute);
        }
    }

    const int length = std::min<int>(bestRoute.size(), maxMoves);
    *outLength = uint16_t(length);
    if (length > 0)
        std::copy_n(bestRoute.begin(), length, outMoves);
    writeStatsMultiV4(stats, ctx, start, length > 0 ? 1 : 0, rootCandidates);
    return status;
}

int shortestOneV1SelfTest()
{
    std::array<uint8_t, BOARD_CELLS> board {};
    for (int x = 3; x <= 6; x++)
        board[7 * BOARD_SIZE + x] = BLACK;
    std::array<uint8_t, MAX_ROUTE_PLY> moves {};
    uint16_t length = 0;
    SearchStats stats {};
    const int status = shortestOneFindImplV1(board.data(), BLACK, RENJU, 15, 100000,
                                             moves.data(), &length, MAX_ROUTE_PLY, &stats);
    if (status != 2 || length != 1 || stats.aborted)
        return 401;
    return 0;
}

} // namespace

extern "C" VCF_LEGACY_SEARCH_KEEPALIVE int vcfBbFindShortestOne(const uint8_t *board,
                                                                   int attacker,
                                                                   int rule,
                                                                   int maxDepth,
                                                                   uint32_t encodedLimits,
                                                                   uint8_t *outMoves,
                                                                   uint16_t *outLength,
                                                                   int maxMoves,
                                                                   SearchStats *stats)
{
    return shortestOneFindImplV1(board, attacker, rule, maxDepth, encodedLimits,
                                 outMoves, outLength, maxMoves, stats);
}
