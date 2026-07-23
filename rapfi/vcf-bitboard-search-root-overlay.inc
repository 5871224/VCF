// 單路 VCF 的每個根候選使用獨立置換表。
// 這讓根候選可以在不同 Worker 中獨立計算，並可依原順序累加節點，
// 同時保留舊版的根候選排序與每個子樹內的 DFS 順序。

struct RootCandidateSet {
    CandidateBuildScratch scratch;
    CandidateList candidates;
    std::vector<uint8_t> immediate;
    bool blocked = false;
};

void collectRootCandidates(Position &position,
                           int attacker,
                           int rule,
                           int maxImmediate,
                           RootCandidateSet &root)
{
    root.immediate = scanWinningMovesAll(position, attacker, rule, maxImmediate);
    root.candidates.count = 0;
    root.blocked = false;
    if (!root.immediate.empty())
        return;

    const int defender = 3 - attacker;
    const Threat counter = scanThreatAll(position, defender, rule);
    if (counter.hasFive || counter.count >= 2) {
        root.blocked = true;
        return;
    }
    const int forcedPoint = counter.count == 1 ? counter.points[0] : NIL;
    scanCandidates(position, attacker, rule, forcedPoint, CENTER, root.scratch, root.candidates);
}

std::vector<std::vector<uint8_t>> runForcedRootCandidate(Position &position,
                                                         const uint8_t *initialBoard,
                                                         int attacker,
                                                         int rule,
                                                         const Candidate &candidate,
                                                         bool simplify,
                                                         int maxDepth,
                                                         uint32_t maxNodes,
                                                         SearchContext &ctx)
{
    ctx.maxDepth = std::clamp(maxDepth, 1, MAX_ROUTE_PLY);
    ctx.maxNodes = std::max<uint32_t>(1, maxNodes);

    LegacyTransTable transTable(ctx.maxDepth);
    SearchRunner runner;
    runner.initialBoard = initialBoard;
    runner.attacker = attacker;
    runner.rule = rule;
    runner.maxRoutes = 1;
    runner.simplify = simplify;
    runner.ctx = &ctx;
    runner.transTable = &transTable;
    runner.routes.reserve(1);
    runner.candidatesByDepth.resize(size_t(ctx.maxDepth / 2 + 2));

    std::vector<uint8_t> route;
    route.reserve(size_t(ctx.maxDepth) + 1);
    if (!ctx.touch(1))
        return {};

    const int defender = 3 - attacker;
    position.play(candidate.idx, attacker);
    route.push_back(candidate.idx);

    bool terminalWin = candidate.immediate || candidate.defenseCount >= 2;
    bool childWin = false;
    if (!terminalWin && candidate.defenseCount == 1) {
        const int defense = candidate.defenses[0];
        if (!fullLegal(position.board, defense, defender, rule)) {
            terminalWin = true;
        }
        else if (2 <= ctx.maxDepth) {
            position.play(defense, defender);
            route.push_back(uint8_t(defense));
            childWin = runner.dfs(position, 2, defense, candidate.idx, route);
            position.undo(defense);
        }
    }

    if (terminalWin)
        runner.addRoute(route);
    else if (!childWin)
        runner.routes.clear();

    position.undo(candidate.idx);
    return runner.routes;
}

std::vector<std::vector<uint8_t>> runAtDepth(Position &position,
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
    // 多路搜尋仍使用共享根置換表；只有單路搜尋拆成獨立根工作。
    if (maxRoutes != 1)
        return runAtDepthShared(position, initialBoard, attacker, rule, maxRoutes,
                                simplify, maxDepth, maxNodes, ctx, rootCandidates);

    ctx.maxDepth = std::clamp(maxDepth, 1, MAX_ROUTE_PLY);
    ctx.maxNodes = std::max<uint32_t>(1, maxNodes);

    RootCandidateSet root;
    collectRootCandidates(position, attacker, rule, 64, root);
    if (!root.immediate.empty()) {
        rootCandidates = int(root.immediate.size());
        ctx.nodes = 1;
        ctx.maxPlySeen = 1;
        return {{root.immediate.front()}};
    }
    if (root.blocked) {
        rootCandidates = 0;
        return {};
    }

    rootCandidates = root.candidates.count;
    for (int i = 0; i < root.candidates.count; i++) {
        const uint32_t remaining = ctx.remaining();
        if (remaining == 0) {
            ctx.aborted = true;
            break;
        }

        SearchContext local;
        auto routes = runForcedRootCandidate(position, initialBoard, attacker, rule,
                                             root.candidates.items[i], simplify,
                                             ctx.maxDepth, remaining, local);
        ctx.nodes = uint32_t(std::min<uint64_t>(ctx.maxNodes,
                                                uint64_t(ctx.nodes) + local.nodes));
        ctx.maxPlySeen = std::max(ctx.maxPlySeen, local.maxPlySeen);
        if (!routes.empty())
            return routes;
        if (local.aborted) {
            ctx.aborted = true;
            break;
        }
    }
    return {};
}
