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

    return 0;
}
