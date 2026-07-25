#include <algorithm>
#include <chrono>
#include <cstdint>
#include <iomanip>
#include <iostream>
#include <limits>
#include <string>
#include <unordered_set>
#include <utility>
#include <vector>

#include "vcf-bitboard-search-v2.cpp"

namespace {

constexpr const char *QUESTION_BOARD =
    "000000000222000020000111000000000010020010000020100000021000001000200020100000020000000200012000000000010010000010000010010200001200010000000000000002001000000000100000100000201202000012002210000200000111000000020200000220000";

struct BenchResult {
    bool found = false;
    bool aborted = false;
    uint64_t nodes = 0;
    int maxPly = 0;
    int rootCandidates = 0;
    size_t routeLength = 0;
    size_t ttEntries = 0;
    size_t ttCapacity = 0;
    double milliseconds = 0.0;
};

std::array<uint8_t, BOARD_CELLS> loadQuestion()
{
    const std::string text = QUESTION_BOARD;
    if (text.size() != BOARD_CELLS)
        throw std::runtime_error("question board length mismatch");
    std::array<uint8_t, BOARD_CELLS> board {};
    for (int i = 0; i < BOARD_CELLS; i++) {
        if (text[i] < '0' || text[i] > '2')
            throw std::runtime_error("question board contains invalid cell");
        board[i] = uint8_t(text[i] - '0');
    }
    return board;
}

BenchResult productionSearch(const std::array<uint8_t, BOARD_CELLS> &board,
                             int maxDepth,
                             uint32_t maxNodes = std::numeric_limits<uint32_t>::max())
{
    Position position;
    position.load(board.data());
    SearchContext ctx;
    int roots = 0;
    const auto start = std::chrono::steady_clock::now();
    const auto routes = runAtDepth(position, board.data(), BLACK, RENJU, 1, false,
                                   maxDepth, maxNodes, ctx, roots);
    const auto end = std::chrono::steady_clock::now();
    BenchResult result;
    result.found = !routes.empty();
    result.aborted = ctx.aborted;
    result.nodes = ctx.nodes;
    result.maxPly = ctx.maxPlySeen;
    result.rootCandidates = roots;
    result.routeLength = routes.empty() ? 0 : routes.front().size();
    result.ttCapacity = 262144;
    result.milliseconds = std::chrono::duration<double, std::milli>(end - start).count();
    return result;
}

template<int BucketBits>
class LocalFourWayTT {
private:
    static constexpr size_t BUCKET_COUNT = size_t(1) << BucketBits;
    static constexpr size_t BUCKET_MASK = BUCKET_COUNT - 1;
    static constexpr size_t WAY_COUNT = 4;

    struct Slot {
        CompactPosition key {};
        uint64_t tag = 0;
    };

    std::vector<Slot> slots;
    uint64_t replacementCounter = 0;
    size_t occupied = 0;

    static uint64_t mixHash(uint64_t value)
    {
        value ^= value >> 30;
        value *= 0xbf58476d1ce4e5b9ULL;
        value ^= value >> 27;
        value *= 0x94d049bb133111ebULL;
        value ^= value >> 31;
        return value;
    }

public:
    LocalFourWayTT() : slots(BUCKET_COUNT * WAY_COUNT) {}

    bool has(const Position &position) const
    {
        const CompactPosition key {position.board.black, position.board.white, position.board.hash};
        const uint64_t hash = mixHash(key.hash);
        const uint64_t tag = hash | 1ULL;
        const size_t base = (size_t(hash) & BUCKET_MASK) * WAY_COUNT;
        for (size_t way = 0; way < WAY_COUNT; way++) {
            const Slot &slot = slots[base + way];
            if (slot.tag == tag && slot.key == key)
                return true;
        }
        return false;
    }

    void store(const Position &position)
    {
        const CompactPosition key {position.board.black, position.board.white, position.board.hash};
        const uint64_t hash = mixHash(key.hash);
        const uint64_t tag = hash | 1ULL;
        const size_t base = (size_t(hash) & BUCKET_MASK) * WAY_COUNT;
        for (size_t way = 0; way < WAY_COUNT; way++) {
            Slot &slot = slots[base + way];
            if (slot.tag == tag && slot.key == key)
                return;
            if (slot.tag == 0) {
                slot.key = key;
                slot.tag = tag;
                occupied++;
                return;
            }
        }
        Slot &victim = slots[base + size_t(replacementCounter++ & 3ULL)];
        victim.key = key;
        victim.tag = tag;
    }

    size_t size() const { return occupied; }
    size_t capacity() const { return slots.size(); }
};

class ExactSetTT {
public:
    explicit ExactSetTT(size_t reserveHint = 0)
    {
        table.max_load_factor(0.82f);
        if (reserveHint)
            table.reserve(reserveHint);
    }

    bool has(const Position &position) const
    {
        const CompactPosition key {position.board.black, position.board.white, position.board.hash};
        return table.find(key) != table.end();
    }

    void store(const Position &position)
    {
        table.insert({position.board.black, position.board.white, position.board.hash});
    }

    size_t size() const { return table.size(); }
    size_t capacity() const { return table.bucket_count(); }

private:
    std::unordered_set<CompactPosition, CompactPositionHasher> table;
};

template<typename TT>
struct ExistsRunner {
    int maxDepth = 110;
    SearchContext *ctx = nullptr;
    TT *tt = nullptr;
    std::vector<CandidateList> candidatesByDepth;
    CandidateBuildScratch scratch;
    int rootCandidates = 0;

    bool dfs(Position &position, int ply, int lastDefense, int center)
    {
        if (ctx->aborted || ply >= maxDepth)
            return false;
        if (tt->has(position))
            return false;

        const Threat counter = ply == 0
            ? scanThreatAll(position, WHITE, RENJU)
            : scanThreatThrough(position, lastDefense, WHITE, RENJU);
        if (counter.hasFive || counter.count >= 2) {
            tt->store(position);
            return false;
        }
        const int forcedPoint = counter.count == 1 ? counter.points[0] : NIL;

        CandidateList &candidates = candidatesByDepth[
            std::min<size_t>(size_t(ply / 2), candidatesByDepth.size() - 1)
        ];
        scanCandidates(position, BLACK, RENJU, forcedPoint, center, scratch, candidates);
        if (ply == 0)
            rootCandidates = candidates.count;

        for (int i = 0; i < candidates.count; i++) {
            const Candidate candidate = candidates.items[i];
            if (!ctx->touch(ply + 1))
                break;

            position.play(candidate.idx, BLACK);
            bool terminalWin = candidate.immediate || candidate.defenseCount >= 2;
            bool childWin = false;
            if (!terminalWin && candidate.defenseCount == 1) {
                const int defense = candidate.defenses[0];
                if (!fullLegal(position.board, defense, WHITE, RENJU)) {
                    terminalWin = true;
                }
                else if (ply + 2 <= maxDepth) {
                    position.play(defense, WHITE);
                    childWin = dfs(position, ply + 2, defense, candidate.idx);
                    position.undo(defense);
                }
            }
            position.undo(candidate.idx);

            if (terminalWin || childWin)
                return true;
        }

        if (!ctx->aborted)
            tt->store(position);
        return false;
    }
};

template<typename TT>
BenchResult genericSearch(const std::array<uint8_t, BOARD_CELLS> &board, int maxDepth)
{
    Position position;
    position.load(board.data());
    SearchContext ctx;
    ctx.maxDepth = maxDepth;
    ctx.maxNodes = std::numeric_limits<uint32_t>::max();
    TT tt;
    ExistsRunner<TT> runner;
    runner.maxDepth = maxDepth;
    runner.ctx = &ctx;
    runner.tt = &tt;
    runner.candidatesByDepth.resize(size_t(maxDepth / 2 + 2));

    const auto start = std::chrono::steady_clock::now();
    const bool found = runner.dfs(position, 0, -1, CENTER);
    const auto end = std::chrono::steady_clock::now();

    BenchResult result;
    result.found = found;
    result.aborted = ctx.aborted;
    result.nodes = ctx.nodes;
    result.maxPly = ctx.maxPlySeen;
    result.rootCandidates = runner.rootCandidates;
    result.ttEntries = tt.size();
    result.ttCapacity = tt.capacity();
    result.milliseconds = std::chrono::duration<double, std::milli>(end - start).count();
    return result;
}

BenchResult exactSetSearch(const std::array<uint8_t, BOARD_CELLS> &board, int maxDepth)
{
    Position position;
    position.load(board.data());
    SearchContext ctx;
    ctx.maxDepth = maxDepth;
    ctx.maxNodes = std::numeric_limits<uint32_t>::max();
    ExactSetTT tt(1000000);
    ExistsRunner<ExactSetTT> runner;
    runner.maxDepth = maxDepth;
    runner.ctx = &ctx;
    runner.tt = &tt;
    runner.candidatesByDepth.resize(size_t(maxDepth / 2 + 2));

    const auto start = std::chrono::steady_clock::now();
    const bool found = runner.dfs(position, 0, -1, CENTER);
    const auto end = std::chrono::steady_clock::now();

    BenchResult result;
    result.found = found;
    result.aborted = ctx.aborted;
    result.nodes = ctx.nodes;
    result.maxPly = ctx.maxPlySeen;
    result.rootCandidates = runner.rootCandidates;
    result.ttEntries = tt.size();
    result.ttCapacity = tt.capacity();
    result.milliseconds = std::chrono::duration<double, std::milli>(end - start).count();
    return result;
}

template<typename Fn>
BenchResult medianRun(int repetitions, Fn &&fn)
{
    std::vector<BenchResult> results;
    results.reserve(repetitions);
    for (int i = 0; i < repetitions; i++)
        results.push_back(fn());
    std::sort(results.begin(), results.end(), [](const BenchResult &a, const BenchResult &b) {
        return a.milliseconds < b.milliseconds;
    });
    return results[results.size() / 2];
}

void printResult(const char *name, const BenchResult &result)
{
    std::cout << name
              << " found=" << result.found
              << " aborted=" << result.aborted
              << " roots=" << result.rootCandidates
              << " nodes=" << result.nodes
              << " maxPly=" << result.maxPly
              << " route=" << result.routeLength
              << " tt=" << result.ttEntries
              << " capacity=" << result.ttCapacity
              << " ms=" << std::fixed << std::setprecision(3) << result.milliseconds
              << '\n';
}

} // namespace

int main()
{
#ifdef __EMSCRIPTEN__
    std::cout << "runtime=wasm\n";
    constexpr int REPETITIONS = 5;
#else
    std::cout << "runtime=native\n";
    constexpr int REPETITIONS = 7;
#endif
    const auto board = loadQuestion();
    const BenchResult best = productionSearch(board, 200, 50000000);
    printResult("find-current", best);
    if (!best.found || best.routeLength != 111 || best.aborted)
        return 2;

    constexpr int BOUND = 110;
    const BenchResult warmup = productionSearch(board, BOUND);
    printResult("warmup", warmup);
    if (warmup.found || warmup.aborted || warmup.rootCandidates != 18)
        return 3;

    const BenchResult production = medianRun(REPETITIONS, [&]() { return productionSearch(board, BOUND); });
    const BenchResult fixed16 = medianRun(REPETITIONS, [&]() { return genericSearch<LocalFourWayTT<16>>(board, BOUND); });
    const BenchResult fixed17 = medianRun(REPETITIONS, [&]() { return genericSearch<LocalFourWayTT<17>>(board, BOUND); });
    const BenchResult fixed18 = medianRun(REPETITIONS, [&]() { return genericSearch<LocalFourWayTT<18>>(board, BOUND); });
    const BenchResult exact = medianRun(REPETITIONS, [&]() { return exactSetSearch(board, BOUND); });

    printResult("v1-production-256k", production);
    printResult("v2-local-256k", fixed16);
    printResult("v2-local-512k", fixed17);
    printResult("v2-local-1024k", fixed18);
    printResult("v2-exact-set", exact);

    if (production.found || fixed16.found || fixed17.found || fixed18.found || exact.found)
        return 4;
    if (fixed16.nodes != production.nodes)
        std::cout << "warning=fixed16-node-count-differs-from-production\n";

    std::vector<std::pair<std::string, double>> ranking {
        {"v1-production-256k", production.milliseconds},
        {"v2-local-256k", fixed16.milliseconds},
        {"v2-local-512k", fixed17.milliseconds},
        {"v2-local-1024k", fixed18.milliseconds},
        {"v2-exact-set", exact.milliseconds},
    };
    std::sort(ranking.begin(), ranking.end(), [](const auto &a, const auto &b) {
        return a.second < b.second;
    });
    std::cout << "winner=" << ranking.front().first
              << " ms=" << std::fixed << std::setprecision(3) << ranking.front().second << '\n';
    return 0;
}
