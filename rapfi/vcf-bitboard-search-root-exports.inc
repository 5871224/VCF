extern "C" VCF_LEGACY_SEARCH_KEEPALIVE int vcfBbRootCandidatesV4(const uint8_t *board,
                                                                    int attacker,
                                                                    int rule,
                                                                    uint8_t *outMoves,
                                                                    int maxResults,
                                                                    SearchStats *stats)
{
    const double start = legacyNowMs();
    SearchContext ctx;
    if (!board || !outMoves || maxResults <= 0
        || (attacker != BLACK && attacker != WHITE)
        || rule < FREESTYLE || rule > RENJU) {
        writeStats(stats, ctx, start, 0, 0, true);
        return 0;
    }

    Position position;
    position.load(board);
    RootCandidateSet root;
    collectRootCandidates(position, attacker, rule, maxResults, root);

    int count = 0;
    if (!root.immediate.empty()) {
        count = std::min<int>(root.immediate.size(), maxResults);
        std::copy_n(root.immediate.begin(), count, outMoves);
    }
    else if (!root.blocked) {
        count = std::min(root.candidates.count, maxResults);
        for (int i = 0; i < count; i++)
            outMoves[i] = root.candidates.items[i].idx;
    }
    writeStats(stats, ctx, start, 0, count);
    return count;
}

extern "C" VCF_LEGACY_SEARCH_KEEPALIVE int vcfBbFindForcedRootV4(const uint8_t *board,
                                                                   int attacker,
                                                                   int rule,
                                                                   int rootMove,
                                                                   int simplify,
                                                                   int maxDepth,
                                                                   uint32_t maxNodes,
                                                                   uint8_t *outMoves,
                                                                   uint16_t *outLength,
                                                                   int maxMovesPerRoute,
                                                                   SearchStats *stats)
{
    const double start = legacyNowMs();
    SearchContext ctx;
    if (!board || !outMoves || !outLength || maxMovesPerRoute <= 0
        || rootMove < 0 || rootMove >= BOARD_CELLS
        || (attacker != BLACK && attacker != WHITE)
        || rule < FREESTYLE || rule > RENJU) {
        writeStats(stats, ctx, start, 0, 0, true);
        return 0;
    }

    *outLength = 0;
    Position position;
    position.load(board);
    RootCandidateSet root;
    collectRootCandidates(position, attacker, rule, 64, root);

    for (uint8_t move : root.immediate) {
        if (move != rootMove)
            continue;
        outMoves[0] = move;
        *outLength = 1;
        ctx.nodes = 1;
        ctx.maxPlySeen = 1;
        writeStats(stats, ctx, start, 1, int(root.immediate.size()));
        return 1;
    }

    const Candidate *selected = nullptr;
    for (int i = 0; i < root.candidates.count; i++) {
        if (root.candidates.items[i].idx == rootMove) {
            selected = &root.candidates.items[i];
            break;
        }
    }
    if (!selected) {
        writeStats(stats, ctx, start, 0, root.candidates.count);
        return 0;
    }

    auto routes = runForcedRootCandidate(position, board, attacker, rule, *selected,
                                         simplify != 0, maxDepth, maxNodes, ctx);
    if (routes.empty()) {
        writeStats(stats, ctx, start, 0, root.candidates.count);
        return 0;
    }

    const int length = std::min<int>(routes.front().size(), maxMovesPerRoute);
    std::copy_n(routes.front().begin(), length, outMoves);
    *outLength = uint16_t(length);
    writeStats(stats, ctx, start, 1, root.candidates.count);
    return 1;
}
