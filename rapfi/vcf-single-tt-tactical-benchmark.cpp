#include <algorithm>
#include <array>
#include <chrono>
#include <cstdint>
#include <iomanip>
#include <iostream>
#include <string>
#include <vector>

namespace {

constexpr int BOARD_SIZE = 15;
constexpr int BOARD_CELLS = 225;
constexpr int BLACK = 1;
constexpr int RENJU = 2;
constexpr int MODE_SINGLE = 0;
constexpr int MAX_ROUTE = 224;

#pragma pack(push, 1)
struct SearchStats {
    uint32_t nodes;
    uint32_t elapsedMicros;
    uint16_t routeCount;
    uint16_t candidateCount;
    uint16_t maxPly;
    uint8_t aborted;
    uint8_t reserved;
};
#pragma pack(pop)

extern "C" int vcfBbFindMode(const uint8_t *board,
                              int attacker,
                              int rule,
                              int mode,
                              int simplify,
                              int maxRoutes,
                              int maxDepth,
                              uint32_t maxNodes,
                              uint8_t *outMoves,
                              uint16_t *outLengths,
                              int maxMovesPerRoute,
                              SearchStats *stats);

extern "C" int vcfBbValidateRoute(const uint8_t *board,
                                   int attacker,
                                   int rule,
                                   const uint8_t *moves,
                                   int moveCount,
                                   uint32_t maxNodes,
                                   SearchStats *stats);

struct Rng {
    uint64_t state;
    explicit Rng(uint64_t seed) : state(seed ? seed : 1) {}
    uint64_t next()
    {
        uint64_t x = state;
        x ^= x << 13;
        x ^= x >> 7;
        x ^= x << 17;
        state = x;
        return x;
    }
};

// 每個獨立棋型都是 .XXX.。攻方任選一端形成四，守方只能擋另一端；
// 多個棋型可用不同順序消耗，因此會產生大量「落子順序不同、完整盤面相同」的轉置。
std::array<uint8_t, BOARD_CELLS> makeTranspositionBoard(int patternCount, uint64_t seed)
{
    struct Pattern { int y; int startX; };
    std::array<Pattern, 14> patterns {};
    int n = 0;
    for (int y = 1; y <= 13; y += 2) {
        patterns[size_t(n++)] = {y, 0};
        patterns[size_t(n++)] = {y, 9};
    }

    Rng rng(seed * 0x9e3779b97f4a7c15ULL);
    for (size_t i = patterns.size(); i > 1; i--) {
        const size_t j = size_t(rng.next() % i);
        std::swap(patterns[i - 1], patterns[j]);
    }

    std::array<uint8_t, BOARD_CELLS> board {};
    patternCount = std::clamp(patternCount, 1, int(patterns.size()));
    for (int i = 0; i < patternCount; i++) {
        const Pattern p = patterns[size_t(i)];
        for (int x = p.startX + 1; x <= p.startX + 3; x++)
            board[size_t(p.y * BOARD_SIZE + x)] = BLACK;
    }
    return board;
}

struct Result {
    double ms = 0;
    uint32_t nodes = 0;
    int routes = 0;
    int length = 0;
    bool aborted = false;
    bool valid = true;
    uint64_t checksum = 0;
};

Result search(const std::array<uint8_t, BOARD_CELLS> &board, uint32_t maxNodes)
{
    std::array<uint8_t, MAX_ROUTE> moves {};
    std::array<uint16_t, 1> lengths {};
    SearchStats stats {};
    const auto t0 = std::chrono::steady_clock::now();
    const int count = vcfBbFindMode(board.data(), BLACK, RENJU, MODE_SINGLE, 0,
                                    1, 41, maxNodes, moves.data(), lengths.data(),
                                    MAX_ROUTE, &stats);
    const auto t1 = std::chrono::steady_clock::now();

    Result result;
    result.ms = std::chrono::duration<double, std::milli>(t1 - t0).count();
    result.nodes = stats.nodes;
    result.routes = count;
    result.length = count ? lengths[0] : 0;
    result.aborted = stats.aborted != 0;
    result.checksum = uint64_t(count) * 0x9e3779b97f4a7c15ULL + uint64_t(result.length);
    for (int i = 0; i < result.length; i++)
        result.checksum = (result.checksum ^ moves[size_t(i)]) * 0x100000001b3ULL;

    if (count) {
        SearchStats validateStats {};
        result.valid = vcfBbValidateRoute(board.data(), BLACK, RENJU, moves.data(),
                                           result.length, 5000000, &validateStats) != 0;
    }
    return result;
}

double median(std::vector<double> values)
{
    std::sort(values.begin(), values.end());
    const size_t m = values.size() / 2;
    return values.size() & 1 ? values[m] : (values[m - 1] + values[m]) / 2.0;
}

int run(const std::string &label, uint32_t maxNodes, int repetitions)
{
    const std::array<std::pair<int, uint64_t>, 8> cases = {{
        {8, 11}, {9, 23}, {10, 37}, {11, 41},
        {12, 53}, {13, 67}, {14, 79}, {14, 97},
    }};

    const Result cold = search(makeTranspositionBoard(cases[0].first, cases[0].second), maxNodes);
    double totalMs = 0;
    uint64_t totalNodes = 0;
    int totalRoutes = 0;
    int abortedCases = 0;
    bool valid = cold.valid;
    uint64_t checksum = 0;

    for (const auto &[patterns, seed] : cases) {
        const auto board = makeTranspositionBoard(patterns, seed);
        std::vector<double> times;
        Result representative;
        for (int rep = 0; rep < repetitions; rep++) {
            const Result result = search(board, maxNodes);
            times.push_back(result.ms);
            if (rep == 0)
                representative = result;
            valid = valid && result.valid;
        }
        const double med = median(times);
        totalMs += med;
        totalNodes += representative.nodes;
        totalRoutes += representative.routes;
        abortedCases += representative.aborted ? 1 : 0;
        checksum ^= representative.checksum + seed * 0x9e3779b97f4a7c15ULL;

        std::cout << std::fixed << std::setprecision(3)
                  << "CASE label=" << label
                  << " patterns=" << patterns
                  << " seed=" << seed
                  << " median_ms=" << med
                  << " nodes=" << representative.nodes
                  << " nps=" << (med > 0 ? double(representative.nodes) * 1000.0 / med : 0.0)
                  << " routes=" << representative.routes
                  << " length=" << representative.length
                  << " aborted=" << representative.aborted
                  << " valid=" << representative.valid << '\n';
    }

    std::cout << std::fixed << std::setprecision(3)
              << "SUMMARY label=" << label
              << " cold_ms=" << cold.ms
              << " median_total_ms=" << totalMs
              << " total_nodes=" << totalNodes
              << " nps=" << (totalMs > 0 ? double(totalNodes) * 1000.0 / totalMs : 0.0)
              << " routes=" << totalRoutes
              << " aborted_cases=" << abortedCases
              << " valid=" << valid
              << " checksum=" << checksum << '\n';
    return valid ? 0 : 2;
}

} // namespace

int main(int argc, char **argv)
{
    if (argc != 4) {
        std::cerr << "usage: benchmark label maxNodes repetitions\n";
        return 1;
    }
    return run(argv[1], uint32_t(std::stoul(argv[2])), std::stoi(argv[3]));
}
