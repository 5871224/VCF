        Candidate &candidate = candidates.items[i];
        candidate.chainRank = candidate.immediate
            ? 0
            : candidateChainRank(position, candidate.idx, attacker, rule);
    }
    for (int i = augmentedCount - 1; i >= 0; i--)
        position.undo(scratch.augmentedMoves[i]);

    std::stable_sort(candidates.begin(), candidates.end(), [&](const Candidate &a, const Candidate &b) {
        if (a.immediate != b.immediate)
            return a.immediate > b.immediate;
        const bool aFree = a.defenseCount >= 2;
        const bool bFree = b.defenseCount >= 2;
        if (aFree != bFree)
            return aFree > bFree;
        if (a.chainRank != b.chainRank)
            return a.chainRank < b.chainRank;
        return distanceKey(a.idx, center) < distanceKey(b.idx, center);
    });
}

#undef scanCandidates
#include "vcf-bitboard-search-opt-overlay.inc"

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
    uint64_t hash = 0;

    bool operator==(const CompactPosition &other) const
    {
        return hash == other.hash && black == other.black && white == other.white;
    }
};

struct CompactPositionHasher {
    size_t operator()(const CompactPosition &position) const
    {
        return size_t(position.hash ^ (position.hash >> 32));
    }
};

constexpr int TT_PLY_BUCKETS = MAX_ROUTE_PLY / 2 + 2;
constexpr int TT_SET_COUNT = 128;
constexpr int TT_WAYS = 2;
constexpr int TT_SLOTS_PER_PLY = TT_SET_COUNT * TT_WAYS;

struct FlatTransSlot {
    uint32_t generation = 0;
    uint64_t hash = 0;
    std::array<uint64_t, BIT_WORDS> black {};
    std::array<uint64_t, BIT_WORDS> white {};
};

struct FlatTransStorage {
    std::array<std::array<FlatTransSlot, TT_SLOTS_PER_PLY>, TT_PLY_BUCKETS> slots {};
    uint32_t generation = 0;

    uint32_t beginSearch()
    {
        generation++;
        if (generation == 0) {
            for (auto &ply : slots)
                for (FlatTransSlot &slot : ply)
                    slot.generation = 0;
            generation = 1;
        }
        return generation;
    }
};

FlatTransStorage FLAT_TRANS_STORAGE;

class LegacyTransTable {
public:
    explicit LegacyTransTable(int maxDepth)
        : generation(FLAT_TRANS_STORAGE.beginSearch()),
          maxBucket(std::min(TT_PLY_BUCKETS - 1, std::max(0, maxDepth / 2 + 1)))
    {
    }

    bool has(const Position &position, int ply) const
    {
        const int bucket = std::min(ply / 2, maxBucket);
        const uint64_t hash = position.board.hash;
        const size_t set = size_t(hash ^ (hash >> 32)) & (TT_SET_COUNT - 1);
        const int base = int(set) * TT_WAYS;
        const auto &slots = FLAT_TRANS_STORAGE.slots[bucket];
        for (int way = 0; way < TT_WAYS; way++) {
            const FlatTransSlot &slot = slots[base + way];
            if (slot.generation == generation && slot.hash == hash
                && slot.black == position.board.black && slot.white == position.board.white)
                return true;
        }
        return false;
    }

    void store(const Position &position, int ply)
    {
        const int bucket = std::min(ply / 2, maxBucket);
        const uint64_t hash = position.board.hash;
        const size_t mixed = size_t(hash ^ (hash >> 32));
        const int base = int(mixed & (TT_SET_COUNT - 1)) * TT_WAYS;
        auto &slots = FLAT_TRANS_STORAGE.slots[bucket];

        for (int way = 0; way < TT_WAYS; way++) {
            FlatTransSlot &slot = slots[base + way];
            if (slot.generation == generation && slot.hash == hash
                && slot.black == position.board.black && slot.white == position.board.white)
                return;
            if (slot.generation != generation) {
                write(slot, position);
                return;
            }
        }

        // 碰撞只覆蓋舊剪枝資料，不會產生假命中，因此不影響正確性。
        write(slots[base + int((mixed >> 7) & 1)], position);
    }

private:
    uint32_t generation;
    int maxBucket;

    void write(FlatTransSlot &slot, const Position &position)
    {
        slot.hash = position.board.hash;
        slot.black = position.board.black;
        slot.white = position.board.white;
        slot.generation = generation;
    }
};

bool routeValidOld(Position position, int attacker, int rule, const std::vector<uint8_t> &route)
{
    const int defender = 3 - attacker;
    int lastDefense = -1;
    CandidateBuildScratch scratch;
    CandidateList candidates;
    for (size_t ply = 0; ply < route.size(); ply += 2) {
        const Threat counter = ply == 0
            ? scanThreatAll(position, defender, rule)
            : scanThreatThrough(position, lastDefense, defender, rule);
        if (counter.hasFive || counter.count >= 2)
            return false;
        const int forced = counter.count == 1 ? counter.points[0] : NIL;
        const int attack = route[ply];
        if (!position.empty(attack) || (forced < BOARD_CELLS && attack != forced))
            return false;
        scanCandidates(position, attacker, rule, forced, attack, scratch, candidates);
        const Candidate *found = nullptr;
        for (int i = 0; i < candidates.count; i++) {
            if (candidates.items[i].idx == attack) {
                found = &candidates.items[i];
                break;
            }
        }
        if (!found)
            return false;
        const Candidate selected = *found;
        position.play(attack, attacker);
        if (selected.immediate || selected.defenseCount >= 2)
            return true;
        if (selected.defenseCount != 1 || ply + 1 >= route.size())
            return false;
        const int defense = route[ply + 1];
        if (defense != selected.defenses[0] || !fullLegal(position.board, defense, defender, rule))
            return false;
        position.play(defense, defender);
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
        Position position;
        position.load(initialBoard);
        if (routeValidOld(position, attacker, rule, tested))
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
    LegacyTransTable *transTable = nullptr;
    std::vector<std::vector<uint8_t>> routes;
    std::vector<CandidateList> candidatesByDepth;
    CandidateBuildScratch buildScratch;
    int rootCandidates = 0;

    bool full() const { return int(routes.size()) >= maxRoutes; }

    void addRoute(const std::vector<uint8_t> &raw)
    {
        std::vector<uint8_t> route = simplify ? simplifyOld(initialBoard, attacker, rule, raw) : raw;
        if (route.empty())
            return;
        if (maxRoutes == 1) {
            routes.clear();
            routes.push_back(std::move(route));
            return;
        }
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

    bool dfs(Position &position, int ply, int lastDefense, int center, std::vector<uint8_t> &route)
    {
        if (ctx->aborted || full() || ply >= ctx->maxDepth)
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

        CandidateList &candidates = candidatesByDepth[std::min<size_t>(size_t(ply / 2), candidatesByDepth.size() - 1)];
        scanCandidates(position, attacker, rule, forcedPoint, center, buildScratch, candidates);
        if (ply == 0)
            rootCandidates = candidates.count;
        bool foundAny = false;

        for (int i = 0; i < candidates.count; i++) {
            const Candidate candidate = candidates.items[i];
            if (full() || ctx->aborted || !ctx->touch(ply + 1))
                break;
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
                    childWin = dfs(position, ply + 2, defense, candidate.idx, route);
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

            if (maxRoutes == 1 && foundAny)
                return true;
        }

        if (!foundAny && !ctx->aborted && !full())
            transTable->store(position, ply);
        return foundAny;
    }
};

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
    ctx.maxDepth = std::clamp(maxDepth, 1, MAX_ROUTE_PLY);
    ctx.maxNodes = std::max<uint32_t>(1, maxNodes);

    const std::vector<uint8_t> immediate = scanWinningMovesAll(position, attacker, rule,
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
    runner.routes.reserve(runner.maxRoutes);
    runner.candidatesByDepth.resize(size_t(ctx.maxDepth / 2 + 2));
    std::vector<uint8_t> route;
    route.reserve(size_t(ctx.maxDepth) + 1);
    runner.dfs(position, 0, -1, CENTER, route);
