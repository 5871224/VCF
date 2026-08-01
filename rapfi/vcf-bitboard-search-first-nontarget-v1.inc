// 題目產生器專用的第一條非目標 VCF 搜尋。
//
// 沿用多組 V3 的單次 DFS。每找到一條精簡後路線就立即重播：
// - 指定步數且標準完成盤面等於 targetBoard：保存第一條目標路線，繼續搜尋。
// - 比指定步數短，或啟用 blockOther 且標準盤面不同：保存第一條不需要路線。
// 目標與不需要路線都找到後立即停止，不再列舉其他 VCF。
// 若時間／節點限制中止，SearchStats.aborted 與 reserved 會保留停止原因。

namespace {

constexpr int MODE_FIRST_NON_TARGET_V1 = 3;
constexpr int LEGACY_FIVE_LEVEL_V1 = 10;
constexpr int LEGACY_FREE_FOUR_LEVEL_V1 = 9;
constexpr int LEGACY_DOUBLE_FOUR_FLAGS_V1 = 0x60;

extern "C" int vcfBbLegacyGetLevelPointCompat(const uint8_t *board,
                                               int idx,
                                               int side,
                                               int rule);
extern "C" int vcfBbLegacyIsFoul(const uint8_t *board,
                                 int idx,
                                 int rule);

struct StandardRouteAnalysisV1 {
    bool valid = false;
    int steps = 0;
    std::array<uint8_t, BOARD_CELLS> standardBoard {};
};

StandardRouteAnalysisV1 analyzeStandardRouteV1(const uint8_t *initialBoard,
                                                const std::vector<uint8_t> &moves,
                                                int attacker,
                                                int rule)
{
    StandardRouteAnalysisV1 result;
    if (!initialBoard || moves.empty())
        return result;

    std::array<uint8_t, BOARD_CELLS> board {};
    std::copy_n(initialBoard, BOARD_CELLS, board.begin());
    const int defender = 3 - attacker;
    bool standardReady = false;

    for (size_t ply = 0; ply < moves.size(); ply++) {
        const int idx = moves[ply];
        const int side = (ply & 1U) ? defender : attacker;
        if (idx < 0 || idx >= BOARD_CELLS || board[size_t(idx)] != EMPTY)
            return result;

        std::array<uint8_t, BOARD_CELLS> beforeAttack {};
        if (side == attacker)
            beforeAttack = board;

        board[size_t(idx)] = uint8_t(side);
        if (side != attacker)
            continue;

        const int rawLevel = vcfBbLegacyGetLevelPointCompat(
            board.data(), idx, attacker, rule
        );
        const int level = rawLevel & 0x0f;
        const bool doubleFour = (rawLevel & LEGACY_DOUBLE_FOUR_FLAGS_V1) != 0;

        // 與 genAnalyzeVCFGroup 完全相同：
        // 連五終局不計入 steps；四四記到該手；活四記到該手之前。
        if (level >= LEGACY_FIVE_LEVEL_V1) {
            result.standardBoard = board;
            standardReady = true;
            break;
        }

        result.steps++;
        if (doubleFour) {
            result.standardBoard = board;
            standardReady = true;
            break;
        }
        if (level == LEGACY_FREE_FOUR_LEVEL_V1) {
            // 白方抓禁手的死四會以等級 9 回報，但沒有一般活四旗標；
            // 此時標準盤面必須包含白方這一手，與 summary.js 的覆寫一致。
            const int foulPoint = (rawLevel >> 8) & 0xff;
            const bool whiteCatchFoul =
                attacker == WHITE
                && rule == RENJU
                && (rawLevel & 0xe0) == 0
                && foulPoint >= 0
                && foulPoint < BOARD_CELLS
                && board[size_t(foulPoint)] == EMPTY
                && vcfBbLegacyIsFoul(board.data(), foulPoint, rule);
            result.standardBoard = whiteCatchFoul ? board : beforeAttack;
            standardReady = true;
            break;
        }
    }

    if (!standardReady)
        result.standardBoard = board;
    result.valid = true;
    return result;
}

bool sameBoardV1(const std::array<uint8_t, BOARD_CELLS> &left,
                 const std::array<uint8_t, BOARD_CELLS> &right)
{
    return left == right;
}

struct FirstNonTargetRunnerV1 {
    const uint8_t *initialBoard = nullptr;
    std::array<uint8_t, BOARD_CELLS> targetBoard {};
    int attacker = BLACK;
    int rule = RENJU;
    int expectedSteps = 0;
    bool blockOther = true;
    TimedSearchContextV4 *ctx = nullptr;
    ExactPositionTransTableV3 *transTable = nullptr;
    std::vector<std::vector<uint8_t>> acceptedOutput;
    std::vector<uint8_t> targetRoute;
    std::vector<uint8_t> unwantedRoute;
    std::vector<CandidateList> candidatesByDepth;
    CandidateBuildScratch buildScratch;
    int rootCandidates = 0;

    bool done() const
    {
        return !targetRoute.empty() && !unwantedRoute.empty();
    }

    void addRoute(const std::vector<uint8_t> &raw)
    {
        if (raw.empty() || ctx->aborted || done())
            return;

        std::vector<uint8_t> output = simplifyOld(
            initialBoard, attacker, rule, raw
        );
        if (output.empty())
            return;
        for (const auto &existing : acceptedOutput)
            if (existing == output)
                return;

        acceptedOutput.push_back(output);

        const StandardRouteAnalysisV1 analysis = analyzeStandardRouteV1(
            initialBoard, output, attacker, rule
        );
        if (!analysis.valid)
            return;

        const bool target =
            analysis.steps == expectedSteps
            && sameBoardV1(analysis.standardBoard, targetBoard);
        const bool unwanted =
            analysis.steps < expectedSteps
            || (blockOther && !sameBoardV1(analysis.standardBoard, targetBoard));

        if (target && targetRoute.empty())
            targetRoute = output;
        else if (unwanted && unwantedRoute.empty())
            unwantedRoute = output;
    }

    bool dfs(Position &position,
             int ply,
             int lastDefense,
             int center,
             std::vector<uint8_t> &route)
    {
        if (ctx->aborted || done() || ply >= ctx->maxDepth)
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
            std::min<size_t>(
                size_t(ply / 2), candidatesByDepth.size() - 1
            )
        ];
        scanCandidatesWithOpenFourStopV4(
            position,
            attacker,
            rule,
            forcedPoint,
            center,
            buildScratch,
            candidates
        );
        if (ply == 0)
            rootCandidates = candidates.count;

        bool foundAny = false;
        bool complete = true;
        for (int i = 0; i < candidates.count; i++) {
            const Candidate candidate = candidates.items[i];
            if (done() || ctx->aborted || !ctx->touch(ply + 1)) {
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
                    childWin = dfs(
                        position, ply + 2, defense, candidate.idx, route
                    );
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
            if (done() || ctx->aborted) {
                complete = false;
                break;
            }
        }

        if (complete && !foundAny)
            transTable->store(position, ply);
        return foundAny;
    }
};

int findFirstNonTargetModeV1(const uint8_t *board,
                             int attacker,
                             int rule,
                             bool blockOther,
                             int pruning,
                             int expectedSteps,
                             int maxDepth,
                             uint32_t maxNodes,
                             uint8_t *outMoves,
                             uint16_t *outLengths,
                             int maxMovesPerRoute,
                             SearchStats *stats)
{
    const double start = legacyNowMs();
    TimedSearchContextV4 ctx;
    int rootCandidates = 0;

    if (!board || !outMoves || !outLengths
        || (attacker != BLACK && attacker != WHITE)
        || rule < FREESTYLE || rule > RENJU
        || expectedSteps < 0 || maxMovesPerRoute <= 0) {
        writeStatsMultiV4(stats, ctx, start, 0, 0, true);
        return 0;
    }

    // outMoves 在模式 3 呼叫前先放入 225 格目標標準盤面。
    // 必須在覆寫輸出路線前立即複製。
    std::array<uint8_t, BOARD_CELLS> targetBoard {};
    std::copy_n(outMoves, BOARD_CELLS, targetBoard.begin());
    outLengths[0] = 0;
    outLengths[1] = 0;

    ctx.maxDepth = std::clamp(maxDepth, 1, MAX_ROUTE_PLY);
    ctx.maxNodes = std::max<uint32_t>(1, maxNodes);

    Position position;
    position.load(board);

    ExactPositionTransTableV3 transTable(ctx.maxDepth);
    FirstNonTargetRunnerV1 runner;
    runner.initialBoard = board;
    runner.targetBoard = targetBoard;
    runner.attacker = attacker;
    runner.rule = rule;
    runner.expectedSteps = expectedSteps;
    runner.blockOther = blockOther;
    (void)pruning;
    runner.ctx = &ctx;
    runner.transTable = &transTable;
    runner.candidatesByDepth.resize(size_t(ctx.maxDepth / 2 + 2));

    // 即使已有一手立即勝，也必須繼續同一棵 DFS 尋找目標路線；
    // 否則只會得到較短 VCF，無法計算「較短防點－目標防點」。
    std::vector<uint8_t> route;
    route.reserve(size_t(ctx.maxDepth) + 1);
    runner.dfs(position, 0, -1, CENTER, route);
    rootCandidates = runner.rootCandidates;

    int written = 0;
    const auto writeRoute = [&](int slot, const std::vector<uint8_t> &routeToWrite) {
        if (routeToWrite.empty())
            return;
        const int length = std::min<int>(routeToWrite.size(), maxMovesPerRoute);
        outLengths[slot] = uint16_t(length);
        std::copy_n(
            routeToWrite.begin(),
            length,
            outMoves + slot * maxMovesPerRoute
        );
        written++;
    };
    writeRoute(0, runner.targetRoute);
    writeRoute(1, runner.unwantedRoute);

    writeStatsMultiV4(
        stats, ctx, start, written, rootCandidates
    );
    return written;
}

int firstNonTargetV1SelfTest()
{
    std::array<uint8_t, BOARD_CELLS> board {};
    const int row = 7 * BOARD_SIZE;

    // 連五終局手不計入 steps，標準盤面包含該手。
    board[size_t(row + 3)] = BLACK;
    board[size_t(row + 4)] = BLACK;
    board[size_t(row + 5)] = BLACK;
    board[size_t(row + 6)] = BLACK;
    const StandardRouteAnalysisV1 five = analyzeStandardRouteV1(
        board.data(), {uint8_t(row + 7)}, BLACK, FREESTYLE
    );
    if (!five.valid || five.steps != 0
        || five.standardBoard[size_t(row + 7)] != BLACK)
        return 401;

    // 活四手計為一步，但標準盤面取落活四之前。
    board.fill(EMPTY);
    board[size_t(row + 4)] = BLACK;
    board[size_t(row + 5)] = BLACK;
    board[size_t(row + 6)] = BLACK;
    const StandardRouteAnalysisV1 freeFour = analyzeStandardRouteV1(
        board.data(), {uint8_t(row + 7)}, BLACK, FREESTYLE
    );
    if (!freeFour.valid || freeFour.steps != 1
        || freeFour.standardBoard[size_t(row + 7)] != EMPTY)
        return 402;

    return 0;
}

} // namespace
