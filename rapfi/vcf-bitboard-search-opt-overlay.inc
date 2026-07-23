// 搜尋熱路徑疊加優化：
// - 以 generation stamp 取代每節點清空 225 個 CandidateAcc。
// - 以預先計算的中心距離順序和固定優先群組取代 stable_sort。
// 原始 scanCandidates 會在主翻譯單元中改名保留，供差異測試使用。

struct CandidateMoveOrderTable {
    std::array<std::array<uint8_t, BOARD_CELLS>, BOARD_CELLS> byCenter {};

    CandidateMoveOrderTable()
    {
        for (int center = 0; center < BOARD_CELLS; center++) {
            auto &order = byCenter[center];
            for (int idx = 0; idx < BOARD_CELLS; idx++)
                order[idx] = uint8_t(idx);
            std::sort(order.begin(), order.end(), [center](uint8_t a, uint8_t b) {
                const int da = distanceKey(a, center);
                const int db = distanceKey(b, center);
                return da != db ? da < db : a < b;
            });
        }
    }
};

const CandidateMoveOrderTable CANDIDATE_MOVE_ORDER;

struct CandidateGenerationState {
    std::array<uint16_t, BOARD_CELLS> generation {};
    std::array<uint8_t, BOARD_CELLS> candidateSlot {};
    std::array<Candidate, BOARD_CELLS> ordered {};
    uint16_t current = 0;

    uint16_t next()
    {
        current++;
        if (current == 0) {
            generation.fill(0);
            current = 1;
        }
        return current;
    }
};

CandidateGenerationState CANDIDATE_GENERATION_STATE;

int candidatePriorityGroup(const Candidate &candidate)
{
    // 完整對應舊 comparator：immediate、free、chainRank、distance、原始 idx。
    const int immediateBase = candidate.immediate ? 0 : 6;
    const int freeBase = candidate.defenseCount >= 2 ? 0 : 3;
    return immediateBase + freeBase + std::min<int>(candidate.chainRank, 2);
}

void scanCandidates(Position &position,
                    int attacker,
                    int rule,
                    int forcedPoint,
                    int center,
                    CandidateBuildScratch &scratch,
                    CandidateList &candidates)
{
    CandidateGenerationState &state = CANDIDATE_GENERATION_STATE;
    const uint16_t generation = state.next();
    int touchedCount = 0;
    candidates.count = 0;

    auto touch = [&](int idx) -> CandidateAcc & {
        if (state.generation[idx] != generation) {
            state.generation[idx] = generation;
            state.candidateSlot[idx] = NIL;
            scratch.acc[idx] = CandidateAcc {};
            scratch.touched[touchedCount++] = uint8_t(idx);
        }
        scratch.acc[idx].used = true;
        return scratch.acc[idx];
    };

    position.forEachCategory(attacker, 4, [&](int id) {
        const Window &window = WINDOW_TABLE.windows[id];
        if (!exactWindowAllowed(position.board, window, attacker, rule))
            return;
        const int attack = firstEmpty(position.board, window);
        if (attack >= BOARD_CELLS || (forcedPoint < BOARD_CELLS && attack != forcedPoint))
            return;
        touch(attack).immediate = true;
    });

    position.forEachCategory(attacker, 3, [&](int id) {
        const Window &window = WINDOW_TABLE.windows[id];
        if (!exactWindowAllowed(position.board, window, attacker, rule))
            return;
        std::array<uint8_t, 2> empties {NIL, NIL};
        int n = 0;
        for (uint8_t idx : window.points)
            if (position.board.cells[idx] == EMPTY && n < 2)
                empties[n++] = idx;
        if (n != 2)
            return;
        for (int e = 0; e < 2; e++) {
            const int attack = empties[e];
            if (forcedPoint < BOARD_CELLS && attack != forcedPoint)
                continue;
            touch(attack).addDefense(empties[1 - e]);
        }
    });

    // 不必再將 touched 排序；最後會依預先計算的 distance／idx 順序輸出。
    for (int i = 0; i < touchedCount; i++) {
        const int idx = scratch.touched[i];
        if (!position.empty(idx) || !fullLegal(position.board, idx, attacker, rule))
            continue;
        const int slot = candidates.count++;
        state.candidateSlot[idx] = uint8_t(slot);
        Candidate &candidate = candidates.items[slot];
        candidate = Candidate {};
        candidate.idx = uint8_t(idx);
        candidate.immediate = scratch.acc[idx].immediate;
        candidate.defenseCount = scratch.acc[idx].defenseCount;
        candidate.defenses = scratch.acc[idx].defenses;
    }

    int augmentedCount = 0;
    for (int i = 0; i < candidates.count; i++) {
        const Candidate &candidate = candidates.items[i];
        if (!candidate.immediate) {
            position.play(candidate.idx, attacker);
            scratch.augmentedMoves[augmentedCount++] = candidate.idx;
        }
    }
    for (int i = 0; i < candidates.count; i++) {
        Candidate &candidate = candidates.items[i];
        candidate.chainRank = candidate.immediate
            ? 0
            : candidateChainRank(position, candidate.idx, attacker, rule);
    }
    for (int i = augmentedCount - 1; i >= 0; i--)
        position.undo(scratch.augmentedMoves[i]);

    const int safeCenter = center >= 0 && center < BOARD_CELLS ? center : CENTER;
    int orderedCount = 0;
    for (int group = 0; group < 12; group++) {
        for (uint8_t idx : CANDIDATE_MOVE_ORDER.byCenter[safeCenter]) {
            if (state.generation[idx] != generation)
                continue;
            const uint8_t slot = state.candidateSlot[idx];
            if (slot == NIL)
                continue;
            const Candidate &candidate = candidates.items[slot];
            if (candidatePriorityGroup(candidate) == group)
                state.ordered[orderedCount++] = candidate;
        }
    }

    for (int i = 0; i < orderedCount; i++)
        candidates.items[i] = state.ordered[i];
    candidates.count = orderedCount;
}
