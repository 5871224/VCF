struct SearchContext {
    uint32_t maxNodes = 5000000;
    int maxDepth = 200;
    uint32_t nodes = 0;
    int maxPlySeen = 0;
    bool aborted = false;

    bool touch(int ply)
    {
        maxPlySeen = std::max(maxPlySeen, ply);
        if (nodes >= maxNodes || ply > maxDepth) {
            aborted = true;
            return false;
        }
        nodes++;
        return true;
    }

    uint32_t remaining() const
    {
        return maxNodes > nodes ? maxNodes - nodes : 0;
    }
};

struct CompactPosition {
    std::array<uint64_t, BIT_WORDS> black {};
    std::array<uint64_t, BIT_WORDS> white {};
};

bool bitSubset(const std::array<uint64_t, BIT_WORDS> &small,
               const std::array<uint64_t, BIT_WORDS> &large)
{
    for (int word = 0; word < BIT_WORDS; word++)
        if ((small[word] & large[word]) != small[word])
            return false;
    return true;
}

bool positionSubset(const CompactPosition &small, const Board &large)
{
    return bitSubset(small.black, large.black) && bitSubset(small.white, large.white);
}

bool positionSubset(const Board &small, const CompactPosition &large)
{
    return bitSubset(small.black, large.black) && bitSubset(small.white, large.white);
}

class LegacySubsetTable {
public:
    explicit LegacySubsetTable(int maxDepth)
        : byPly(size_t(std::max(1, maxDepth / 2 + 2)))
    {
    }

    bool hasSubset(const Board &board, int ply) const
    {
        const int bucket = std::min<int>(ply / 2, int(byPly.size()) - 1);
        for (int depth = bucket; depth >= 0; depth--)
            for (const CompactPosition &entry : byPly[depth])
                if (positionSubset(entry, board))
                    return true;
        return false;
    }

    void store(const Board &board, int ply)
    {
        const int bucket = std::min<int>(ply / 2, int(byPly.size()) - 1);
        for (int depth = bucket; depth >= 0; depth--)
            for (const CompactPosition &entry : byPly[depth])
                if (positionSubset(entry, board))
                    return;

        CompactPosition current {board.black, board.white};
        // 較短的無解局面可以支配較長局面；維持小型反鏈，避免線性表膨脹。
        for (int depth = bucket; depth < int(byPly.size()); depth++) {
            auto &entries = byPly[depth];
            entries.erase(std::remove_if(entries.begin(), entries.end(), [&](const CompactPosition &entry) {
                return positionSubset(board, entry);
            }), entries.end());
        }
        byPly[bucket].push_back(current);
    }

private:
    std::vector<std::vector<CompactPosition>> byPly;
};

bool routeValidOld(Board board, int attacker, int rule, const std::vector<uint8_t> &route)
{
    const int defender = 3 - attacker;
    int lastDefense = -1;
    for (size_t ply = 0; ply < route.size(); ply += 2) {
        const Threat counter = ply == 0
            ? scanThreatAll(board, defender, rule)
            : scanThreatThrough(board, lastDefense, defender, rule);
        if (counter.hasFive || counter.count >= 2)
            return false;
        const int forced = counter.count == 1 ? counter.points[0] : NIL;
        const int attack = route[ply];
        if (!board.empty(attack) || (forced < BOARD_CELLS && attack != forced))
            return false;
        std::vector<Candidate> candidates = scanCandidates(board, attacker, rule, forced, attack);
        auto found = std::find_if(candidates.begin(), candidates.end(), [&](const Candidate &candidate) {
            return candidate.idx == attack;
        });
        if (found == candidates.end())
            return false;
        board.play(attack, attacker);
        if (found->immediate || found->defenseCount >= 2)
            return true;
        if (found->defenseCount != 1 || ply + 1 >= route.size())
            return false;
        const int defense = route[ply + 1];
        if (defense != found->defenses[0] || !fullLegal(board, defense, defender, rule))
            return false;
        board.play(defense, defender);
        lastDefense = defense;
    }
    return false;
}

std::vector<uint8_t> simplifyOld(const uint8_t *initialBoard,
                                 int attacker,
                                 int rule,
                                 const std::vector<uint8_t> &source)
{
    std::vector<uint8_t> result = source;
    if (!initialBoard || result.size() < 5)
        return result;
    for (int start = int(result.size()) - 3; start >= 0; start -= 2) {
        std::vector<uint8_t> tested = result;
        tested.erase(tested.begin() + start, tested.begin() + start + 2);
        Board board;
        board.load(initialBoard);
        if (routeValidOld(board, attacker, rule, tested))
            result.swap(tested);
    }
    return result;
}

bool routeSubsetByColor(const std::vector<uint8_t> &small,
                        const std::vector<uint8_t> &large)
{
    if (small.size() > large.size())
        return false;
    std::array<uint8_t, BOARD_CELLS> position {};
    for (size_t i = 0; i < large.size(); i++)
        position[large[i]] = uint8_t((i & 1) ? 2 : 1);
    for (size_t i = 0; i < small.size(); i++)
        if (position[small[i]] != uint8_t((i & 1) ? 2 : 1))
            return false;
    return true;
}

struct SearchRunner {
    const uint8_t *initialBoard = nullptr;
    int attacker = BLACK;
    int rule = RENJU;
    int maxRoutes = 1;
    bool simplify = false;
    SearchContext *ctx = nullptr;
    LegacySubsetTable *subset = nullptr;
    std::vector<std::vector<uint8_t>> routes;
    int rootCandidates = 0;

    bool full() const { return int(routes.size()) >= maxRoutes; }

    void addRoute(const std::vector<uint8_t> &raw)
    {
        std::vector<uint8_t> route = simplify ? simplifyOld(initialBoard, attacker, rule, raw) : raw;
        if (route.empty())
            return;
        for (size_t i = routes.size(); i-- > 0;) {
            if (route.size() < routes[i].size() && routeSubsetByColor(route, routes[i]))
                routes.erase(routes.begin() + i);
            else if (routeSubsetByColor(routes[i], route))
                return;
        }
        auto pos = std::lower_bound(routes.begin(), routes.end(), route.size(), [](const auto &moves, size_t len) {
            return moves.size() < len;
        });
        routes.insert(pos, std::move(route));
    }

    bool dfs(Board &board, int ply, int lastDefense, int center, std::vector<uint8_t> &route)
    {
        if (ctx->aborted || full() || ply >= ctx->maxDepth)
            return false;
        if (subset->hasSubset(board, ply))
            return false;

        const int defender = 3 - attacker;
        const Threat counter = ply == 0
            ? scanThreatAll(board, defender, rule)
            : scanThreatThrough(board, lastDefense, defender, rule);
        if (counter.hasFive || counter.count >= 2) {
            subset->store(board, ply);
            return false;
        }
        const int forcedPoint = counter.count == 1 ? counter.points[0] : NIL;
        if (forcedPoint < BOARD_CELLS && !fullLegal(board, forcedPoint, attacker, rule)) {
            subset->store(board, ply);
            return false;
        }

        std::vector<Candidate> candidates = scanCandidates(board, attacker, rule, forcedPoint, center);
        if (ply == 0)
            rootCandidates = int(candidates.size());
        bool foundAny = false;

        for (const Candidate &candidate : candidates) {
            if (full() || ctx->aborted || !ctx->touch(ply + 1))
                break;
            const size_t oldSize = route.size();
            board.play(candidate.idx, attacker);
            route.push_back(candidate.idx);

            bool terminalWin = candidate.immediate || candidate.defenseCount >= 2;
            bool childWin = false;
            if (!terminalWin && candidate.defenseCount == 1) {
                const int defense = candidate.defenses[0];
                if (!fullLegal(board, defense, defender, rule)) {
                    terminalWin = true;
                }
                else if (ply + 2 <= ctx->maxDepth) {
                    board.play(defense, defender);
                    route.push_back(uint8_t(defense));
                    childWin = dfs(board, ply + 2, defense, candidate.idx, route);
                    board.undo(defense);
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
            board.undo(candidate.idx);

            if (maxRoutes == 1 && foundAny)
                return true;
        }

        if (!foundAny && !ctx->aborted && !full())
            subset->store(board, ply);
        return foundAny;
    }
};
