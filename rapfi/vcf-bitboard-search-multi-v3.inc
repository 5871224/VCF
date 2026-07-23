// 多組 VCF V3：
// - 單組搜尋繼續使用目前最快的舊版相容核心。
// - 嚴格模式只剪除相同 ply 的完整同盤無解狀態。
// - 高速模式另外記錄已完整證明有解的盤面；若其黑白棋集合都是目前盤面的子集，
//   則目前分支最後只會形成會被子集去重刪除的延伸路線，可直接略過。
// - 多組路線依規格先以原始手順做子集去重，再對保留下來的路線做精簡。

namespace {

constexpr int MULTI_PRUNING_STRICT = 0;
constexpr int MULTI_PRUNING_FAST = 1;

struct WinningSubsetV3 {
    std::array<uint64_t, BIT_WORDS> black {};
    std::array<uint64_t, BIT_WORDS> white {};
};

bool bitboardSubsetV3(const std::array<uint64_t, BIT_WORDS> &small,
                      const std::array<uint64_t, BIT_WORDS> &large)
{
    for (int word = 0; word < BIT_WORDS; word++)
        if ((small[word] & large[word]) != small[word])
            return false;
    return true;
}

struct StoredRouteV3 {
    std::vector<uint8_t> raw;
    std::vector<uint8_t> output;
};

struct MultiSearchRunnerV3 {
    const uint8_t *initialBoard = nullptr;
    int attacker = BLACK;
    int rule = RENJU;
    int pruning = MULTI_PRUNING_STRICT;
    int maxRoutes = 64;
    SearchContext *ctx = nullptr;
    LegacyTransTable *transTable = nullptr;
    std::vector<StoredRouteV3> storedRoutes;
    std::vector<std::vector<uint8_t>> routes;
    std::vector<CandidateList> candidatesByDepth;
    std::vector<std::vector<WinningSubsetV3>> winningSubsetsByPly;
    CandidateBuildScratch buildScratch;
    int rootCandidates = 0;

    bool full() const { return int(storedRoutes.size()) >= maxRoutes; }

    bool fastDominated(const Position &position, int ply) const
    {
        if (pruning != MULTI_PRUNING_FAST || winningSubsetsByPly.empty())
            return false;
        const int maxBucket = std::min<int>(ply / 2, int(winningSubsetsByPly.size()) - 1);
        for (int bucket = maxBucket; bucket >= 0; bucket--) {
            const auto &list = winningSubsetsByPly[bucket];
            for (auto it = list.rbegin(); it != list.rend(); ++it) {
                if (bitboardSubsetV3(it->black, position.board.black)
                    && bitboardSubsetV3(it->white, position.board.white))
                    return true;
            }
        }
        return false;
    }

    void rememberWinningSubset(const Position &position, int ply)
    {
        if (pruning != MULTI_PRUNING_FAST)
            return;
        const int bucket = std::max(0, ply / 2);
        if (bucket >= int(winningSubsetsByPly.size()))
            winningSubsetsByPly.resize(size_t(bucket + 1));
        winningSubsetsByPly[bucket].push_back({position.board.black, position.board.white});
    }

    void rebuildOutputRoutes()
    {
        routes.clear();
        routes.reserve(storedRoutes.size());
        for (const StoredRouteV3 &entry : storedRoutes)
            routes.push_back(entry.output);
        std::stable_sort(routes.begin(), routes.end(), [](const auto &left, const auto &right) {
            return left.size() < right.size();
        });
    }

    void addRoute(const std::vector<uint8_t> &raw)
    {
        if (raw.empty() || ctx->aborted)
            return;

        // 規格：先以尚未精簡的原始手順做子集去重，避免先對必定會被淘汰的路線
        // 反覆執行 isVCF 精簡驗證。
        for (size_t i = storedRoutes.size(); i-- > 0;) {
            const std::vector<uint8_t> &oldRaw = storedRoutes[i].raw;
            if (raw.size() < oldRaw.size() && routeSubsetByColor(raw, oldRaw))
                storedRoutes.erase(storedRoutes.begin() + i);
            else if (routeSubsetByColor(oldRaw, raw))
                return;
        }

        std::vector<uint8_t> output = simplifyOld(initialBoard, attacker, rule, raw);
        if (output.empty())
            return;

        // 不再做第二次「子集」淘汰；僅避免精簡後完全相同的重複輸出。
        for (const StoredRouteV3 &entry : storedRoutes)
            if (entry.output == output)
                return;

        storedRoutes.push_back({raw, std::move(output)});
        rebuildOutputRoutes();
    }

    bool dfs(Position &position, int ply, int lastDefense, int center, std::vector<uint8_t> &route)
    {
        if (ctx->aborted || full() || ply >= ctx->maxDepth)
            return false;
        if (transTable->has(position, ply))
            return false;
        if (fastDominated(position, ply))
            return true;

        const int defender = 3 - attacker;
        const Threat counter = ply == 0
            ? scanThreatAll(position, defender, rule)
            : scanThreatThrough(position, lastDefense, defender, rule);
        if (counter.hasFive || counter.count >= 2) {
            transTable->store(position, ply);
            return false;
        }
        const int forcedPoint = counter.count == 1 ? counter.points[0] : NIL;

        CandidateList &candidates = candidatesByDepth[
            std::min<size_t>(size_t(ply / 2), candidatesByDepth.size() - 1)
        ];
        scanCandidates(position, attacker, rule, forcedPoint, center, buildScratch, candidates);
        if (ply == 0)
            rootCandidates = candidates.count;

        bool foundAny = false;
        bool complete = true;
        for (int i = 0; i < candidates.count; i++) {
            const Candidate candidate = candidates.items[i];
            if (full() || ctx->aborted || !ctx->touch(ply + 1)) {
                complete = false;
                break;
            }

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
                else if (ply + 2 <= ctx->maxDepth) {
                    position.play(defense, defender);
                    route.push_back(uint8_t(defense));
                    childWin = dfs(position, ply + 2, defense, candidate.idx, route);
                    position.undo(defense);
                }
            }

            if (terminalWin) {
                foundAny = true;
                addRoute(route);
            }
            else if (childWin) {
                foundAny = true;
            }

            route.resize(oldSize);
            position.undo(candidate.idx);
            if (full() || ctx->aborted) {
                complete = false;
                break;
            }
        }

        if (complete) {
            if (foundAny)
                rememberWinningSubset(position, ply);
            else
                transTable->store(position, ply);
        }
        return foundAny;
    }
};

std::vector<std::vector<uint8_t>> runMultiAtDepthV3(Position position,
                                                     const uint8_t *initialBoard,
                                                     int attacker,
                                                     int rule,
                                                     int pruning,
                                                     int maxRoutes,
                                                     int maxDepth,
                                                     uint32_t maxNodes,
                                                     SearchContext &ctx,
                                                     int &rootCandidates)
{
    ctx = SearchContext {};
    ctx.maxDepth = std::clamp(maxDepth, 1, MAX_ROUTE_PLY);
    ctx.maxNodes = std::max<uint32_t>(1, maxNodes);

    const std::vector<uint8_t> immediate = scanWinningMovesAll(
        position, attacker, rule, std::clamp(maxRoutes, 1, 64)
    );
    if (!immediate.empty()) {
        std::vector<std::vector<uint8_t>> routes;
        routes.reserve(immediate.size());
        for (uint8_t move : immediate)
            routes.push_back({move});
        rootCandidates = int(immediate.size());
        ctx.nodes = uint32_t(immediate.size());
        ctx.maxPlySeen = 1;
        return routes;
    }

    LegacyTransTable transTable(ctx.maxDepth);
    MultiSearchRunnerV3 runner;
    runner.initialBoard = initialBoard;
    runner.attacker = attacker;
    runner.rule = rule;
    runner.pruning = std::clamp(pruning, MULTI_PRUNING_STRICT, MULTI_PRUNING_FAST);
    runner.maxRoutes = std::clamp(maxRoutes, 1, 64);
    runner.ctx = &ctx;
    runner.transTable = &transTable;
    runner.candidatesByDepth.resize(size_t(ctx.maxDepth / 2 + 2));
    runner.winningSubsetsByPly.resize(size_t(ctx.maxDepth / 2 + 2));

    std::vector<uint8_t> route;
    route.reserve(size_t(ctx.maxDepth) + 1);
    runner.dfs(position, 0, -1, CENTER, route);
    rootCandidates = runner.rootCandidates;
    return runner.routes;
}

std::vector<std::vector<uint8_t>> runMultiModeV3(Position position,
                                                 const uint8_t *initialBoard,
                                                 int attacker,
                                                 int rule,
                                                 int mode,
                                                 int pruning,
                                                 int maxRoutes,
                                                 int maxDepth,
                                                 uint32_t maxNodes,
                                                 SearchContext &ctx,
                                                 int &rootCandidates)
{
    mode = std::clamp(mode, MODE_MULTI, MODE_SHORTEST);
    if (mode == MODE_MULTI)
        return runMultiAtDepthV3(position, initialBoard, attacker, rule, pruning,
                                 maxRoutes, maxDepth, maxNodes, ctx, rootCandidates);

    SearchContext total;
    total.maxDepth = std::clamp(maxDepth, 1, MAX_ROUTE_PLY);
    total.maxNodes = std::max<uint32_t>(1, maxNodes);
    int candidates = 0;
    for (int depth = 1; depth <= total.maxDepth; depth += 2) {
        SearchContext iteration;
        auto routes = runMultiAtDepthV3(position, initialBoard, attacker, rule, pruning,
                                        maxRoutes, depth, total.remaining(), iteration, candidates);
        total.nodes = uint32_t(std::min<uint64_t>(
            total.maxNodes, uint64_t(total.nodes) + iteration.nodes
        ));
        total.maxPlySeen = std::max(total.maxPlySeen, iteration.maxPlySeen);
        if (!routes.empty()) {
            ctx = total;
            rootCandidates = candidates;
            return routes;
        }
        if (iteration.aborted || total.nodes >= total.maxNodes) {
            total.aborted = true;
            break;
        }
    }
    ctx = total;
    rootCandidates = candidates;
    return {};
}

int findModeImplMultiV3(const uint8_t *board,
                        int attacker,
                        int rule,
                        int mode,
                        int simplify,
                        int pruning,
                        int maxRoutes,
                        int maxDepth,
                        uint32_t maxNodes,
                        uint8_t *outMoves,
                        uint16_t *outLengths,
                        int maxMovesPerRoute,
                        SearchStats *stats)
{
    if (mode == MODE_SINGLE)
        return findModeImpl(board, attacker, rule, mode, simplify, maxRoutes, maxDepth,
                            maxNodes, outMoves, outLengths, maxMovesPerRoute, stats);

    const double start = legacyNowMs();
    SearchContext ctx;
    int rootCandidates = 0;
    if (!board || !outMoves || !outLengths || (attacker != BLACK && attacker != WHITE)
        || rule < FREESTYLE || rule > RENJU || maxRoutes <= 0 || maxMovesPerRoute <= 0) {
        writeStats(stats, ctx, start, 0, 0, true);
        return 0;
    }

    Position position;
    position.load(board);
    // 多組與最短模式依規格固定精簡；simplify 參數只保留 ABI 相容。
    (void)simplify;
    const auto routes = runMultiModeV3(position, board, attacker, rule, mode, pruning,
                                       maxRoutes, maxDepth, maxNodes, ctx, rootCandidates);
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

int scanPointsImplMultiV3(const uint8_t *board,
                          int attacker,
                          int placeColor,
                          int rule,
                          int mode,
                          int simplify,
                          int pruning,
                          const uint16_t *indices,
                          int indexCount,
                          int maxDepth,
                          uint32_t maxNodes,
                          uint16_t *outIndices,
                          uint16_t *outLabels,
                          int maxResults,
                          SearchStats *stats)
{
    if (mode == MODE_SINGLE)
        return scanPointsImpl(board, attacker, placeColor, rule, mode, simplify, indices,
                              indexCount, maxDepth, maxNodes, outIndices, outLabels,
                              maxResults, stats);

    const double start = legacyNowMs();
    SearchContext total;
    total.maxNodes = std::numeric_limits<uint32_t>::max();
    if (!board || !outIndices || !outLabels || maxResults <= 0
        || (attacker != BLACK && attacker != WHITE)
        || (placeColor != BLACK && placeColor != WHITE)) {
        writeStats(stats, total, start, 0, 0, true);
        return 0;
    }

    Position original;
    original.load(board);
    std::vector<int> scan;
    if (indices && indexCount > 0) {
        scan.reserve(indexCount);
        for (int i = 0; i < indexCount; i++)
            if (indices[i] < BOARD_CELLS)
                scan.push_back(indices[i]);
    }
    else {
        for (int idx = 0; idx < BOARD_CELLS; idx++)
            if (original.empty(idx))
                scan.push_back(idx);
    }

    (void)simplify;
    int count = 0;
    for (int idx : scan) {
        if (count >= maxResults || !original.empty(idx)
            || !fullLegal(original.board, idx, placeColor, rule))
            continue;
        original.play(idx, placeColor);
        const std::array<uint8_t, BOARD_CELLS> initialBoard = original.board.cells;
        uint16_t label = 0;
        if (placeColor == attacker) {
            const Threat after = scanThreatThrough(original, idx, attacker, rule);
            if (after.hasFive)
                label = 5;
            else if (after.count)
                label = 4;
        }
        if (!label) {
            SearchContext local;
            int rootCandidates = 0;
            const auto routes = runMultiModeV3(original, initialBoard.data(), attacker, rule,
                                               mode, pruning, 64, maxDepth, maxNodes,
                                               local, rootCandidates);
            total.nodes = uint32_t(std::min<uint64_t>(
                std::numeric_limits<uint32_t>::max(), uint64_t(total.nodes) + local.nodes
            ));
            total.maxPlySeen = std::max(total.maxPlySeen, local.maxPlySeen);
            total.aborted = total.aborted || local.aborted;
            if (!routes.empty())
                label = uint16_t(std::min<size_t>(routes.front().size(), 65535));
        }
        original.undo(idx);
        if (label) {
            outIndices[count] = uint16_t(idx);
            outLabels[count] = label;
            count++;
        }
    }
    writeStats(stats, total, start, count, int(scan.size()));
    return count;
}

} // namespace

extern "C" VCF_LEGACY_SEARCH_KEEPALIVE int vcfBbFindModeV3(const uint8_t *board,
                                                               int attacker,
                                                               int rule,
                                                               int mode,
                                                               int simplify,
                                                               int pruning,
                                                               int maxRoutes,
                                                               int maxDepth,
                                                               uint32_t maxNodes,
                                                               uint8_t *outMoves,
                                                               uint16_t *outLengths,
                                                               int maxMovesPerRoute,
                                                               SearchStats *stats)
{
    return findModeImplMultiV3(board, attacker, rule, mode, simplify, pruning, maxRoutes,
                               maxDepth, maxNodes, outMoves, outLengths, maxMovesPerRoute,
                               stats);
}

extern "C" VCF_LEGACY_SEARCH_KEEPALIVE int vcfBbScanPointsModeV3(const uint8_t *board,
                                                                     int attacker,
                                                                     int placeColor,
                                                                     int rule,
                                                                     int mode,
                                                                     int simplify,
                                                                     int pruning,
                                                                     const uint16_t *indices,
                                                                     int indexCount,
                                                                     int maxDepth,
                                                                     uint32_t maxNodes,
                                                                     uint16_t *outIndices,
                                                                     uint16_t *outLabels,
                                                                     int maxResults,
                                                                     SearchStats *stats)
{
    return scanPointsImplMultiV3(board, attacker, placeColor, rule, mode, simplify, pruning,
                                 indices, indexCount, maxDepth, maxNodes, outIndices,
                                 outLabels, maxResults, stats);
}

extern "C" VCF_LEGACY_SEARCH_KEEPALIVE int vcfBbSearchV2SelfTest()
{
    const int legacy = vcfBbSearchV2SelfTestLegacy();
    if (legacy != 0)
        return legacy;

    std::array<uint8_t, BOARD_CELLS> source {};
    Position subset;
    subset.load(source.data());
    subset.play(CENTER, BLACK);

    SearchContext ctx;
    LegacyTransTable table(15);
    MultiSearchRunnerV3 fast;
    fast.pruning = MULTI_PRUNING_FAST;
    fast.ctx = &ctx;
    fast.transTable = &table;
    fast.winningSubsetsByPly.resize(8);
    fast.rememberWinningSubset(subset, 0);

    Position superset = subset;
    superset.play(CENTER + 1, WHITE);
    if (!fast.fastDominated(superset, 2))
        return 101;

    MultiSearchRunnerV3 strict;
    strict.pruning = MULTI_PRUNING_STRICT;
    strict.winningSubsetsByPly.resize(8);
    if (strict.fastDominated(superset, 2))
        return 102;

    return 0;
}
