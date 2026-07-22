            }
            blackCount[id] = black;
            whiteCount[id] = white;
            refresh(id);
        }
    }

    bool empty(int idx) const { return board.empty(idx); }

    uint8_t count(int id, int side) const
    {
        return side == BLACK ? blackCount[id] : whiteCount[id];
    }

    uint8_t opponentCount(int id, int side) const
    {
        return side == BLACK ? whiteCount[id] : blackCount[id];
    }

    void play(int idx, int side)
    {
        board.play(idx, side);
        const int n = WINDOW_TABLE.byPointCount[idx];
        for (int i = 0; i < n; i++) {
            const int id = WINDOW_TABLE.byPoint[idx][i];
            if (side == BLACK)
                blackCount[id]++;
            else
                whiteCount[id]++;
            refresh(id);
        }
    }

    void undo(int idx)
    {
        const int side = board.cells[idx];
        const int n = WINDOW_TABLE.byPointCount[idx];
        for (int i = 0; i < n; i++) {
            const int id = WINDOW_TABLE.byPoint[idx][i];
            if (side == BLACK)
                blackCount[id]--;
            else if (side == WHITE)
                whiteCount[id]--;
            refresh(id);
        }
        board.undo(idx);
    }

    template <typename Fn>
    void forEachCategory(int side, int stones, Fn &&fn) const
    {
        const int categoryIndex = (side == BLACK ? 0 : 3) + stones - 3;
        for (int word = 0; word < WINDOW_BIT_WORDS; word++) {
            uint64_t bits = active[categoryIndex][word];
            while (bits) {
                const int bit = ctz64(bits);
                const int id = word * 64 + bit;
                if (id < WINDOW_TABLE.count)
                    fn(id);
                bits &= bits - 1;
            }
        }
    }
};

bool fullLegal(const Board &board, int idx, int side, int rule)
{
    if (!board.empty(idx))
        return false;
    if (rule != RENJU || side != BLACK)
        return true;
    PatternExportResult result {};
    return vcfAnalyzePoint(board.cells.data(), idx, side, rule, 0, &result) != 0 && !result.forbidden;
}

int firstEmpty(const Board &board, const Window &window)
{
    for (uint8_t idx : window.points)
        if (board.cells[idx] == EMPTY)
            return idx;
    return NIL;
}

struct Threat {
    bool hasFive = false;
    uint8_t count = 0;
    std::array<uint8_t, 2> points {NIL, NIL};

    bool contains(int idx) const
    {
        for (int i = 0; i < count; i++)
            if (points[i] == idx)
                return true;
        return false;
    }

    void add(int idx)
    {
        if (contains(idx))
            return;
        if (count < 2)
            points[count++] = uint8_t(idx);
    }
};

void scanThreatWindow(const Position &position, int id, int side, int rule, Threat &threat)
{
    const Window &window = WINDOW_TABLE.windows[id];
    if (!exactWindowAllowed(position.board, window, side, rule))
        return;
    const int stones = position.count(id, side);
    if (position.opponentCount(id, side) != 0)
        return;
    if (stones == 5) {
        threat.hasFive = true;
        return;
    }
    if (stones != 4 || threat.count >= 2)
        return;
    const int idx = firstEmpty(position.board, window);
    if (idx < BOARD_CELLS && !threat.contains(idx) && fullLegal(position.board, idx, side, rule))
        threat.add(idx);
}

Threat scanThreatAll(const Position &position, int side, int rule)
{
    Threat threat;
    position.forEachCategory(side, 5, [&](int id) {
        if (!threat.hasFive)
            scanThreatWindow(position, id, side, rule, threat);
    });
    if (threat.hasFive)
        return threat;
    position.forEachCategory(side, 4, [&](int id) {
        if (threat.count < 2)
            scanThreatWindow(position, id, side, rule, threat);
    });
    return threat;
}

Threat scanThreatThrough(const Position &position, int lastMove, int side, int rule)
{
    Threat threat;
    if (lastMove < 0 || lastMove >= BOARD_CELLS || position.board.cells[lastMove] != side)
        return threat;
    const int n = WINDOW_TABLE.byPointCount[lastMove];
    for (int i = 0; i < n; i++) {
        scanThreatWindow(position, WINDOW_TABLE.byPoint[lastMove][i], side, rule, threat);
        if (threat.hasFive || threat.count >= 2)
            break;
    }
    return threat;
}

std::vector<uint8_t> scanWinningMovesAll(const Position &position, int side, int rule, int limit)
{
    std::array<uint8_t, BOARD_CELLS> seen {};
    std::vector<uint8_t> moves;
    moves.reserve(std::min(limit, BOARD_CELLS));
    position.forEachCategory(side, 4, [&](int id) {
        if (int(moves.size()) >= limit)
            return;
        const Window &window = WINDOW_TABLE.windows[id];
        if (!exactWindowAllowed(position.board, window, side, rule))
            return;
        const int idx = firstEmpty(position.board, window);
        if (idx < BOARD_CELLS && !seen[idx] && fullLegal(position.board, idx, side, rule)) {
            seen[idx] = 1;
            moves.push_back(uint8_t(idx));
        }
    });
    return moves;
}

struct CandidateAcc {
    bool used = false;
    bool immediate = false;
    uint8_t defenseCount = 0;
    std::array<uint8_t, 2> defenses {NIL, NIL};

    void addDefense(int idx)
    {
        for (int i = 0; i < defenseCount; i++)
            if (defenses[i] == idx)
                return;
        if (defenseCount < 2)
            defenses[defenseCount++] = uint8_t(idx);
    }
};

struct Candidate {
    uint8_t idx = NIL;
    uint8_t defenseCount = 0;
    std::array<uint8_t, 2> defenses {NIL, NIL};
    uint8_t chainRank = 3;
    bool immediate = false;
};

struct CandidateList {
    std::array<Candidate, BOARD_CELLS> items {};
    int count = 0;

    Candidate *begin() { return items.data(); }
    Candidate *end() { return items.data() + count; }
    const Candidate *begin() const { return items.data(); }
    const Candidate *end() const { return items.data() + count; }
};

struct CandidateBuildScratch {
    std::array<CandidateAcc, BOARD_CELLS> acc {};
    std::array<uint8_t, BOARD_CELLS> touched {};
    std::array<uint8_t, BOARD_CELLS> augmentedMoves {};
};

int distanceKey(int idx, int center)
{
    const int dx = idx % BOARD_SIZE - center % BOARD_SIZE;
    const int dy = idx / BOARD_SIZE - center / BOARD_SIZE;
    return dx * dx + dy * dy;
}

uint8_t candidateChainRank(const Position &position, int idx, int attacker, int rule)
{
    int best = 0;
    const int n = WINDOW_TABLE.byPointCount[idx];
    for (int i = 0; i < n; i++) {
        const int id = WINDOW_TABLE.byPoint[idx][i];
        const Window &window = WINDOW_TABLE.windows[id];
        if (position.opponentCount(id, attacker) != 0
            || !exactWindowAllowed(position.board, window, attacker, rule))
            continue;
        best = std::max(best, int(position.count(id, attacker)));
    }
    if (best >= 3)
        return 0;
    if (best == 2)
        return 1;
    return 2;
}

void scanCandidates(Position &position,
                    int attacker,
                    int rule,
                    int forcedPoint,
                    int center,
                    CandidateBuildScratch &scratch,
                    CandidateList &candidates)
{
    scratch.acc.fill(CandidateAcc {});
    int touchedCount = 0;
    candidates.count = 0;

    auto touch = [&](int idx) -> CandidateAcc & {
        if (!scratch.acc[idx].used)
            scratch.touched[touchedCount++] = uint8_t(idx);
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

    std::sort(scratch.touched.begin(), scratch.touched.begin() + touchedCount);
    for (int i = 0; i < touchedCount; i++) {
        const int idx = scratch.touched[i];
        if (!position.empty(idx) || !fullLegal(position.board, idx, attacker, rule))
            continue;
        Candidate &candidate = candidates.items[candidates.count++];
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
