std::vector<std::vector<uint8_t>> runAtDepth(Board board,
                                             const uint8_t *initialBoard,
                                             int attacker,
                                             int rule,
                                             int maxRoutes,
                                             bool simplify,
                                             int maxDepth,
                                             uint32_t maxNodes,
                                             SearchContext &ctx,
                                             int &rootCandidates)
{
    ctx.maxDepth = std::clamp(maxDepth, 1, MAX_ROUTE_PLY);
    ctx.maxNodes = std::max<uint32_t>(1, maxNodes);

    // 舊版 findVCF 在進入 DFS 前先獨立掃描攻方可直接連五的點。
    // 直接勝不需要理會守方的反四，且可避免建立整棵搜尋樹。
    const std::vector<uint8_t> immediate = scanWinningMovesAll(board, attacker, rule,
                                                               std::clamp(maxRoutes, 1, 64));
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
    SearchRunner runner;
    runner.initialBoard = initialBoard;
    runner.attacker = attacker;
    runner.rule = rule;
    runner.maxRoutes = std::clamp(maxRoutes, 1, 64);
    runner.simplify = simplify;
    runner.ctx = &ctx;
    runner.transTable = &transTable;
    std::vector<uint8_t> route;
    runner.dfs(board, 0, -1, CENTER, route);
    rootCandidates = runner.rootCandidates;
    return runner.routes;
}

std::vector<std::vector<uint8_t>> runMode(Board board,
                                         const uint8_t *initialBoard,
                                         int attacker,
                                         int rule,
                                         int mode,
                                         bool simplify,
                                         int maxRoutes,
                                         int maxDepth,
                                         uint32_t maxNodes,
                                         SearchContext &ctx,
                                         int &rootCandidates)
{
    mode = std::clamp(mode, MODE_SINGLE, MODE_SHORTEST);
    if (mode != MODE_SHORTEST)
        return runAtDepth(board, initialBoard, attacker, rule,
                          mode == MODE_SINGLE ? 1 : maxRoutes,
                          simplify, maxDepth, maxNodes, ctx, rootCandidates);

    SearchContext total;
    total.maxDepth = std::clamp(maxDepth, 1, MAX_ROUTE_PLY);
    total.maxNodes = std::max<uint32_t>(1, maxNodes);
    int candidates = 0;
    for (int depth = 1; depth <= total.maxDepth; depth += 2) {
        SearchContext iteration;
        auto routes = runAtDepth(board, initialBoard, attacker, rule, maxRoutes,
                                 simplify, depth, total.remaining(), iteration, candidates);
        total.nodes = uint32_t(std::min<uint64_t>(total.maxNodes, uint64_t(total.nodes) + iteration.nodes));
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

void writeStats(SearchStats *out,
                const SearchContext &ctx,
                double start,
                int routes,
                int candidates,
                bool forcedAbort = false)
{
    if (!out)
        return;
    *out = SearchStats {};
    out->nodes = ctx.nodes;
    out->elapsedMicros = uint32_t(std::max(0.0, (legacyNowMs() - start) * 1000.0));
    out->routeCount = uint16_t(std::clamp(routes, 0, 65535));
    out->candidateCount = uint16_t(std::clamp(candidates, 0, 65535));
    out->maxPly = uint16_t(std::clamp(ctx.maxPlySeen, 0, 65535));
    out->aborted = (ctx.aborted || forcedAbort) ? 1 : 0;
}

int findModeImpl(const uint8_t *board,
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
    const double start = legacyNowMs();
    SearchContext ctx;
    int rootCandidates = 0;
    if (!board || !outMoves || !outLengths || (attacker != BLACK && attacker != WHITE)
        || rule < FREESTYLE || rule > RENJU || maxRoutes <= 0 || maxMovesPerRoute <= 0) {
        writeStats(stats, ctx, start, 0, 0, true);
        return 0;
    }
    Board position;
    position.load(board);
    const auto routes = runMode(position, board, attacker, rule, mode, simplify != 0,
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

int scanPointsImpl(const uint8_t *board,
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
    const double start = legacyNowMs();
    SearchContext total;
    total.maxNodes = std::numeric_limits<uint32_t>::max();
    if (!board || !outIndices || !outLabels || maxResults <= 0
        || (attacker != BLACK && attacker != WHITE)
        || (placeColor != BLACK && placeColor != WHITE)) {
        writeStats(stats, total, start, 0, 0, true);
        return 0;
    }

    Board original;
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

    int count = 0;
    for (int idx : scan) {
        if (count >= maxResults || !original.empty(idx) || !fullLegal(original, idx, placeColor, rule))
            continue;
        Board tested = original;
        tested.play(idx, placeColor);
        uint16_t label = 0;
        if (placeColor == attacker) {
            const Threat after = scanThreatThrough(tested, idx, attacker, rule);
            if (after.hasFive)
                label = 5;
            else if (after.count)
                label = 4;
        }
        if (!label) {
            SearchContext local;
            int rootCandidates = 0;
            const auto routes = runMode(tested, tested.cells.data(), attacker, rule, mode,
                                        simplify != 0, mode == MODE_SINGLE ? 1 : 64,
                                        maxDepth, maxNodes, local, rootCandidates);
            total.nodes = uint32_t(std::min<uint64_t>(std::numeric_limits<uint32_t>::max(),
                                                       uint64_t(total.nodes) + local.nodes));
            total.maxPlySeen = std::max(total.maxPlySeen, local.maxPlySeen);
            total.aborted = total.aborted || local.aborted;
            if (!routes.empty())
                label = uint16_t(std::min<size_t>(routes.front().size(), 65535));
        }
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
    (void)pruning; // 舊版 VCF 本身的置換剪枝固定啟用，不採 Rapfi 的泛用剪枝模式。
    return findModeImpl(board, attacker, rule, mode, simplify, maxRoutes, maxDepth,
                        maxNodes, outMoves, outLengths, maxMovesPerRoute, stats);
}

extern "C" VCF_LEGACY_SEARCH_KEEPALIVE int vcfBbFindMode(const uint8_t *board,
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
    return findModeImpl(board, attacker, rule, mode, simplify, maxRoutes, maxDepth,
                        maxNodes, outMoves, outLengths, maxMovesPerRoute, stats);
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
    (void)pruning;
    return scanPointsImpl(board, attacker, placeColor, rule, mode, simplify, indices,
                          indexCount, maxDepth, maxNodes, outIndices, outLabels, maxResults, stats);
}

extern "C" VCF_LEGACY_SEARCH_KEEPALIVE int vcfBbScanPointsMode(const uint8_t *board,
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
    return scanPointsImpl(board, attacker, placeColor, rule, mode, simplify, indices,
                          indexCount, maxDepth, maxNodes, outIndices, outLabels, maxResults, stats);
}

extern "C" VCF_LEGACY_SEARCH_KEEPALIVE int vcfBbSearchV2SelfTest()
{
    if (WINDOW_TABLE.windows.size() != 572)
        return 1;
    if (vcfPatternSelfTest() != 0)
        return 2;

    Board board;
    board.clear();
    board.play(7 * BOARD_SIZE + 3, BLACK);
    board.play(7 * BOARD_SIZE + 4, BLACK);
    board.play(7 * BOARD_SIZE + 5, BLACK);
    board.play(7 * BOARD_SIZE + 6, BLACK);
    SearchContext ctx;
    int candidates = 0;
    const auto routes = runMode(board, board.cells.data(), BLACK, RENJU, MODE_SINGLE,
                                false, 1, 15, 100000, ctx, candidates);
    if (routes.empty() || routes.front().size() != 1)
        return 3;
    if (candidates < 1)
        return 4;

    const auto before = board.black;
    const uint64_t hash = board.hash;
    board.play(0, WHITE);
    board.undo(0);
    if (before != board.black || board.hash != hash || board.cells[0] != EMPTY)
        return 5;
    return 0;
}
