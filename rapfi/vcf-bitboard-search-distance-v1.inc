// Opt-in distance-pruned single VCF probe.
// This is deliberately separate from SearchRunner::dfs and runAtDepth: the
// exhaustive single-VCF engine is never changed. Failed probes are not proofs
// of no VCF. The Worker must fall back to the original full search.
namespace {

int distanceRadiusV1(int phase, int candidateCount)
{
    // Exploratory ranges inspired by VCF Helper's staged distance concept;
    // not claimed to be a literal reproduction of its proprietary engine.
    if (phase >= 2) return 9;
    // Phase 1: with at most two candidates, do not prune by distance at all.
    if (phase == 0 && candidateCount <= 2) return -1;
    int base = candidateCount > 20 ? 2 : candidateCount > 2 ? 4 : 5;
    return phase == 1 ? std::min(9, base + 2) : base;
}

bool distanceAllowedV1(int candidate, int previousAttack, int radius)
{
    const int dx = std::abs(candidate % BOARD_SIZE - previousAttack % BOARD_SIZE);
    const int dy = std::abs(candidate / BOARD_SIZE - previousAttack / BOARD_SIZE);
    return std::max(dx, dy) <= radius;
}

struct DistanceSearchRunnerV1 {
    const uint8_t *initialBoard = nullptr;
    int attacker = BLACK;
    int rule = RENJU;
    int phase = 0;
    bool simplify = false;
    SearchContext *ctx = nullptr;
    LegacyTransTable *transTable = nullptr;
    std::vector<CandidateList> candidatesByDepth;
    CandidateBuildScratch buildScratch;
    std::vector<uint8_t> solution;
    int rootCandidates = 0;

    bool dfs(Position &position, int ply, int lastDefense, int previousAttack,
             std::vector<uint8_t> &route)
    {
        if (ctx->aborted || ply >= ctx->maxDepth)
            return false;
        if (transTable->has(position, ply))
            return false;

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
            std::min<size_t>(size_t(ply / 2), candidatesByDepth.size() - 1)];
        scanCandidates(position, attacker, rule, forcedPoint, previousAttack,
                       buildScratch, candidates);
        if (ply == 0) {
            rootCandidates = candidates.count;
            singleSearchDiagnostics.rootCandidates = uint32_t(candidates.count);
        }

        const int radius = distanceRadiusV1(phase, candidates.count);
        for (int i = 0; i < candidates.count; i++) {
            const Candidate candidate = candidates.items[i];
            // Preserve all root candidates, forced counters and terminal wins.
            // Only speculative intermediate one-defense attacks are restricted.
            if (ply > 0 && forcedPoint == NIL && !candidate.immediate
                && candidate.defenseCount == 1
                && radius >= 0
                && !distanceAllowedV1(candidate.idx, previousAttack, radius))
                continue;
            if (!ctx->touch(ply + 1))
                break;

            singleSearchDiagnostics.depthNodes[ply / 2]++;
            singleSearchDiagnostics.maxPly = uint32_t(
                std::max<int>(singleSearchDiagnostics.maxPly, ply + 1));
            const uint32_t rootStartNodes = ctx->nodes - 1;
            if (ply == 0) {
                ctx->activeRoot = candidate.idx;
                ctx->activeRootStart = rootStartNodes;
            }
            const size_t oldSize = route.size();
            position.play(candidate.idx, attacker);
            route.push_back(candidate.idx);

            bool terminalWin = candidate.immediate || candidate.defenseCount >= 2;
            bool childWin = false;
            if (!terminalWin && candidate.defenseCount == 1) {
                const int defense = candidate.defenses[0];
                if (!fullLegal(position.board, defense, defender, rule))
                    terminalWin = true;
                else if (ply + 2 <= ctx->maxDepth) {
                    position.play(defense, defender);
                    route.push_back(uint8_t(defense));
                    childWin = dfs(position, ply + 2, defense, candidate.idx, route);
                    position.undo(defense);
                }
            }

            if (terminalWin)
                solution = simplify
                    ? simplifyOld(initialBoard, attacker, rule, route)
                    : route;

            route.resize(oldSize);
            position.undo(candidate.idx);
            if (ply == 0) {
                singleSearchDiagnostics.rootNodes[candidate.idx] += ctx->nodes - rootStartNodes;
                ctx->activeRoot = -1;
            }
            if (terminalWin || childWin)
                return true;
            if (ctx->aborted)
                break;
        }
        if (!ctx->aborted)
            transTable->store(position, ply);
        return false;
    }
};

} // namespace

// Exact same ABI result format as legacy single mode, with one extra 'phase'
// input. The caller decides budgets and the exhaustive fallback policy.
extern "C" VCF_LEGACY_SEARCH_KEEPALIVE int vcfBbFindDistanceV1(
    const uint8_t *board, int attacker, int rule, int simplify, int phase,
    int maxDepth, uint32_t maxNodes, uint8_t *outMoves,
    uint16_t *outLengths, int maxMovesPerRoute, SearchStats *stats)
{
    singleSearchDiagnostics = SingleSearchDiagnostics {};
    std::VcfSingleFourWayTransTableV5<CompactPosition, CompactPositionHasher>::clearTelemetry();
    const double start = legacyNowMs();
    SearchContext ctx;
    ctx.startedMs = start;
    int candidateCount = 0;
    if (!board || !outMoves || !outLengths || (attacker != BLACK && attacker != WHITE)
        || rule < FREESTYLE || rule > RENJU || phase < 0 || phase > 2
        || maxMovesPerRoute <= 0) {
        writeStats(stats, ctx, start, 0, 0, true);
        return 0;
    }

    ctx.maxDepth = std::clamp(maxDepth, 1, MAX_ROUTE_PLY);
    ctx.maxNodes = std::max<uint32_t>(1, maxNodes);
    Position position;
    position.load(board);
    DistanceSearchRunnerV1 runner;
    runner.initialBoard = board;
    runner.attacker = attacker;
    runner.rule = rule;
    runner.phase = phase;
    runner.simplify = simplify != 0;
    runner.ctx = &ctx;
    runner.candidatesByDepth.resize(size_t(ctx.maxDepth / 2 + 2));

    const auto immediate = scanWinningMovesAll(position, attacker, rule, 1);
    if (!immediate.empty()) {
        runner.solution.push_back(immediate[0]);
        candidateCount = 1;
        ctx.nodes = 1;
        ctx.maxPlySeen = 1;
        singleSearchDiagnostics.rootCandidates = 1;
        singleSearchDiagnostics.rootNodes[immediate[0]] = 1;
        singleSearchDiagnostics.depthNodes[0] = 1;
        singleSearchDiagnostics.maxPly = 1;
    } else {
        LegacyTransTable transTable(ctx.maxDepth);
        runner.transTable = &transTable;
        std::vector<uint8_t> route;
        route.reserve(size_t(ctx.maxDepth) + 1);
        runner.dfs(position, 0, -1, CENTER, route);
        candidateCount = runner.rootCandidates;
    }

    const int written = runner.solution.empty() ? 0 : 1;
    if (written) {
        const int length = std::min<int>(runner.solution.size(), maxMovesPerRoute);
        outLengths[0] = uint16_t(length);
        std::copy_n(runner.solution.begin(), length, outMoves);
    }
    writeStats(stats, ctx, start, written, candidateCount);
    return written;
}
