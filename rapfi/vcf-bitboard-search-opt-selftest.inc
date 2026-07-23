bool selfTestRouteValid(Position position,
                        int attacker,
                        int rule,
                        const std::vector<uint8_t> &route)
{
    if (route.empty() || (route.size() & 1) == 0)
        return false;

    const int defender = 3 - attacker;
    int lastDefense = -1;
    CandidateBuildScratch scratch;
    CandidateList candidates;

    for (size_t ply = 0; ply < route.size(); ply += 2) {
        const int attack = route[ply];

        // runAtDepth 在根節點先找直接五；直接五優先於守方原有的反四。
        if (ply == 0) {
            const std::vector<uint8_t> immediate = scanWinningMovesAll(position, attacker, rule, BOARD_CELLS);
            if (std::find(immediate.begin(), immediate.end(), uint8_t(attack)) != immediate.end())
                return route.size() == 1;
        }

        const Threat counter = ply == 0
            ? scanThreatAll(position, defender, rule)
            : scanThreatThrough(position, lastDefense, defender, rule);
        if (counter.hasFive || counter.count >= 2)
            return false;
        const int forced = counter.count == 1 ? counter.points[0] : NIL;
        if (!position.empty(attack) || (forced < BOARD_CELLS && attack != forced))
            return false;

        scanCandidates(position, attacker, rule, forced, attack, scratch, candidates);
        const Candidate *selected = nullptr;
        for (int i = 0; i < candidates.count; i++) {
            if (candidates.items[i].idx == attack) {
                selected = &candidates.items[i];
                break;
            }
        }
        if (!selected)
            return false;

        const Candidate candidate = *selected;
        position.play(attack, attacker);
        if (candidate.immediate || candidate.defenseCount >= 2)
            return ply + 1 == route.size();
        if (candidate.defenseCount != 1)
            return false;

        const int forcedDefense = candidate.defenses[0];
        // 唯一防點若是守方禁手，搜尋會在攻方這手直接判勝，不會把防點放進路線。
        if (!fullLegal(position.board, forcedDefense, defender, rule))
            return ply + 1 == route.size();
        if (ply + 1 >= route.size() || route[ply + 1] != forcedDefense)
            return false;

        position.play(forcedDefense, defender);
        lastDefense = forcedDefense;
    }
    return false;
}

extern "C" VCF_LEGACY_SEARCH_KEEPALIVE int vcfBbSearchV2SelfTest()
{
    const int base = vcfBbSearchV2SelfTestBase();
    if (base != 0)
        return base;

    uint32_t state = 0x6d2b79f5U;
    auto nextRandom = [&]() {
        state ^= state << 13;
        state ^= state >> 17;
        state ^= state << 5;
        return state;
    };

    for (int test = 0; test < 512; test++) {
        std::array<uint8_t, BOARD_CELLS> source {};
        const int stones = 8 + int(nextRandom() % 54);
        for (int i = 0; i < stones; i++) {
            const int idx = int(nextRandom() % BOARD_CELLS);
            if (source[idx] == EMPTY)
                source[idx] = uint8_t((nextRandom() & 1) ? BLACK : WHITE);
        }

        Position position;
        position.load(source.data());
        const auto beforeBlack = position.board.black;
        const auto beforeWhite = position.board.white;
        const auto beforeCategory = position.category;
        const auto beforeActive = position.active;
        const uint64_t beforeHash = position.board.hash;

        const int attacker = (test & 1) ? BLACK : WHITE;
        const int rule = test % 3;
        const int center = int(nextRandom() % BOARD_CELLS);
        int forcedPoint = NIL;
        if ((test % 5) == 0) {
            const int candidate = int(nextRandom() % BOARD_CELLS);
            if (position.empty(candidate))
                forcedPoint = candidate;
        }

        CandidateBuildScratch legacyScratch;
        CandidateBuildScratch optimizedScratch;
        CandidateList legacy;
        CandidateList optimized;
        scanCandidatesLegacy(position, attacker, rule, forcedPoint, center, legacyScratch, legacy);
        scanCandidates(position, attacker, rule, forcedPoint, center, optimizedScratch, optimized);

        if (legacy.count != optimized.count)
            return 10;
        for (int i = 0; i < legacy.count; i++) {
            const Candidate &a = legacy.items[i];
            const Candidate &b = optimized.items[i];
            if (a.idx != b.idx || a.immediate != b.immediate
                || a.defenseCount != b.defenseCount || a.defenses != b.defenses
                || a.chainRank != b.chainRank)
                return 11;
        }

        if (position.board.black != beforeBlack || position.board.white != beforeWhite
            || position.category != beforeCategory || position.active != beforeActive
            || position.board.hash != beforeHash || position.board.cells != source)
            return 12;
    }

    Position transPosition;
    std::array<uint8_t, BOARD_CELLS> transSource {};
    transSource[CENTER] = BLACK;
    transSource[CENTER + 1] = WHITE;
    transPosition.load(transSource.data());
    LegacyTransTable table(31);
    if (table.has(transPosition, 4))
        return 13;
    table.store(transPosition, 4);
    if (!table.has(transPosition, 4) || table.has(transPosition, 6))
        return 14;

    transPosition.play(CENTER + BOARD_SIZE, BLACK);
    if (table.has(transPosition, 4))
        return 15;
    transPosition.undo(CENTER + BOARD_SIZE);
    if (!table.has(transPosition, 4))
        return 16;

    // 比較原本共享根置換表與新的獨立根搜尋。固定較淺深度避免自測過久；
    // 只有兩邊都完整結束時才比較有解／無解，並依搜尋本身的終局語意驗證路線。
    for (int test = 0; test < 128; test++) {
        std::array<uint8_t, BOARD_CELLS> source {};
        const int stones = 10 + int(nextRandom() % 30);
        for (int i = 0; i < stones; i++) {
            const int idx = int(nextRandom() % BOARD_CELLS);
            if (source[idx] == EMPTY)
                source[idx] = uint8_t((nextRandom() & 1) ? BLACK : WHITE);
        }

        Position sharedPosition;
        Position independentPosition;
        sharedPosition.load(source.data());
        independentPosition.load(source.data());
        const Position sharedBefore = sharedPosition;
        const Position independentBefore = independentPosition;
        const int attacker = (test & 1) ? BLACK : WHITE;
        const int rule = test % 3;
        SearchContext sharedCtx;
        SearchContext independentCtx;
        int sharedCandidates = 0;
        int independentCandidates = 0;
        auto sharedRoutes = runAtDepthShared(sharedPosition, source.data(), attacker, rule,
                                             1, false, 9, 50000,
                                             sharedCtx, sharedCandidates);
        auto independentRoutes = runAtDepth(independentPosition, source.data(), attacker, rule,
                                            1, false, 9, 50000,
                                            independentCtx, independentCandidates);

        if (sharedPosition.board.cells != sharedBefore.board.cells
            || sharedPosition.board.black != sharedBefore.board.black
            || sharedPosition.board.white != sharedBefore.board.white
            || sharedPosition.blackCount != sharedBefore.blackCount
            || sharedPosition.whiteCount != sharedBefore.whiteCount
            || sharedPosition.category != sharedBefore.category
            || sharedPosition.active != sharedBefore.active
            || sharedPosition.board.hash != sharedBefore.board.hash
            || independentPosition.board.cells != independentBefore.board.cells
            || independentPosition.board.black != independentBefore.board.black
            || independentPosition.board.white != independentBefore.board.white
            || independentPosition.blackCount != independentBefore.blackCount
            || independentPosition.whiteCount != independentBefore.whiteCount
            || independentPosition.category != independentBefore.category
            || independentPosition.active != independentBefore.active
            || independentPosition.board.hash != independentBefore.board.hash)
            return 20;

        if (!sharedCtx.aborted && !independentCtx.aborted) {
            if (sharedRoutes.empty() != independentRoutes.empty())
                return 21;
            if (!sharedRoutes.empty()) {
                if (sharedRoutes.front().front() != independentRoutes.front().front())
                    return 22;
                Position verifyShared;
                Position verifyIndependent;
                verifyShared.load(source.data());
                verifyIndependent.load(source.data());
                if (!selfTestRouteValid(verifyShared, attacker, rule, sharedRoutes.front())
                    || !selfTestRouteValid(verifyIndependent, attacker, rule, independentRoutes.front()))
                    return 23;
            }
        }
    }

    // V4 根 API：列舉順序必須能交給指定根搜尋，且輸出路線從指定根開始。
    std::array<uint8_t, BOARD_CELLS> rootSource {};
    for (int x = 3; x <= 6; x++)
        rootSource[7 * BOARD_SIZE + x] = BLACK;
    std::array<uint8_t, BOARD_CELLS> rootMoves {};
    SearchStats rootStats {};
    const int rootCount = vcfBbRootCandidatesV4(rootSource.data(), BLACK, RENJU,
                                                rootMoves.data(), BOARD_CELLS, &rootStats);
    if (rootCount < 1)
        return 24;
    std::array<uint8_t, MAX_ROUTE_PLY> forcedRoute {};
    uint16_t forcedLength = 0;
    SearchStats forcedStats {};
    const int forced = vcfBbFindForcedRootV4(rootSource.data(), BLACK, RENJU,
                                              rootMoves[0], 0, 9, 50000,
                                              forcedRoute.data(), &forcedLength,
                                              MAX_ROUTE_PLY, &forcedStats);
    if (!forced || forcedLength != 1 || forcedRoute[0] != rootMoves[0])
        return 25;

    return 0;
}
