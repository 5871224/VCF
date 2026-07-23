#include <algorithm>
#include <array>
#include <chrono>
#include <cmath>
#include <cstdint>
#include <fstream>
#include <iomanip>
#include <iostream>
#include <numeric>
#include <sstream>
#include <string>
#include <tuple>
#include <vector>

namespace {

constexpr int BOARD_SIZE = 15;
constexpr int BOARD_CELLS = 225;
constexpr int BLACK = 1;
constexpr int WHITE = 2;
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

static_assert(sizeof(SearchStats) == 16, "stats ABI mismatch");

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

bool makesFive(const std::array<uint8_t, BOARD_CELLS> &board, int idx, int side)
{
    static constexpr int dx[4] = {1, 0, 1, 1};
    static constexpr int dy[4] = {0, 1, 1, -1};
    const int x0 = idx % BOARD_SIZE;
    const int y0 = idx / BOARD_SIZE;
    for (int d = 0; d < 4; d++) {
        int count = 1;
        for (int sign : {-1, 1}) {
            for (int step = 1; step < BOARD_SIZE; step++) {
                const int x = x0 + dx[d] * step * sign;
                const int y = y0 + dy[d] * step * sign;
                if (x < 0 || x >= BOARD_SIZE || y < 0 || y >= BOARD_SIZE)
                    break;
                if (board[y * BOARD_SIZE + x] != side)
                    break;
                count++;
            }
        }
        if (count >= 5)
            return true;
    }
    return false;
}

std::array<uint8_t, BOARD_CELLS> makeBoard(int stones, uint64_t seed)
{
    std::array<uint8_t, BOARD_CELLS> board {};
    std::vector<int> cells;
    cells.reserve(BOARD_CELLS);

    // 集中在中央 11x11，讓盤面具有較多互相影響的三、四候選。
    for (int y = 2; y <= 12; y++)
        for (int x = 2; x <= 12; x++)
            cells.push_back(y * BOARD_SIZE + x);

    Rng rng(seed * 0x9e3779b97f4a7c15ULL + uint64_t(stones));
    for (size_t i = cells.size(); i > 1; i--) {
        const size_t j = size_t(rng.next() % i);
        std::swap(cells[i - 1], cells[j]);
    }

    int placed = 0;
    int side = BLACK;
    for (int idx : cells) {
        if (placed >= stones)
            break;
        board[idx] = uint8_t(side);
        if (makesFive(board, idx, side)) {
            board[idx] = 0;
            continue;
        }
        placed++;
        side = 3 - side;
    }
    return board;
}

struct RunResult {
    double milliseconds = 0;
    uint32_t nodes = 0;
    int routes = 0;
    int routeLength = 0;
    bool aborted = false;
    bool valid = true;
    uint64_t checksum = 0;
};

RunResult runSearch(const std::array<uint8_t, BOARD_CELLS> &board, uint32_t maxNodes)
{
    std::array<uint8_t, MAX_ROUTE> moves {};
    std::array<uint16_t, 1> lengths {};
    SearchStats stats {};
    const auto started = std::chrono::steady_clock::now();
    const int count = vcfBbFindMode(board.data(), BLACK, RENJU, MODE_SINGLE, 0, 1, 81,
                                    maxNodes, moves.data(), lengths.data(), MAX_ROUTE, &stats);
    const auto ended = std::chrono::steady_clock::now();

    RunResult result;
    result.milliseconds = std::chrono::duration<double, std::milli>(ended - started).count();
    result.nodes = stats.nodes;
    result.routes = count;
    result.routeLength = count > 0 ? lengths[0] : 0;
    result.aborted = stats.aborted != 0;

    uint64_t checksum = uint64_t(count) * 0x9e3779b97f4a7c15ULL + result.routeLength;
    for (int i = 0; i < result.routeLength; i++)
        checksum = (checksum ^ moves[size_t(i)]) * 0x100000001b3ULL;
    result.checksum = checksum;

    if (count > 0) {
        SearchStats validateStats {};
        result.valid = vcfBbValidateRoute(board.data(), BLACK, RENJU, moves.data(),
                                           result.routeLength, 5000000, &validateStats) != 0;
    }
    return result;
}

struct Token {
    int stones = 0;
    uint64_t seed = 0;
};

Token parseToken(const std::string &text)
{
    const size_t colon = text.find(':');
    if (colon == std::string::npos)
        throw std::runtime_error("bad token: " + text);
    return {std::stoi(text.substr(0, colon)), std::stoull(text.substr(colon + 1))};
}

std::vector<Token> readTokens(const std::string &path)
{
    std::ifstream input(path);
    if (!input)
        throw std::runtime_error("cannot open seeds file: " + path);
    std::vector<Token> tokens;
    std::string text;
    while (input >> text)
        tokens.push_back(parseToken(text));
    return tokens;
}

int selectBoards(const std::string &outputPath)
{
    struct Candidate {
        uint32_t nodes;
        int stones;
        uint64_t seed;
        bool aborted;
    };
    std::vector<Candidate> candidates;
    const std::array<int, 5> densities = {18, 24, 30, 36, 42};
    constexpr uint32_t selectLimit = 100000;

    for (int stones : densities) {
        for (uint64_t seed = 1; seed <= 80; seed++) {
            const auto board = makeBoard(stones, seed);
            const RunResult result = runSearch(board, selectLimit);
            if (result.routes == 0)
                candidates.push_back({result.nodes, stones, seed, result.aborted});
        }
    }

    std::stable_sort(candidates.begin(), candidates.end(), [](const Candidate &a, const Candidate &b) {
        if (a.aborted != b.aborted)
            return a.aborted > b.aborted;
        return a.nodes > b.nodes;
    });
    if (candidates.size() < 8)
        throw std::runtime_error("not enough benchmark boards");

    std::ofstream output(outputPath);
    if (!output)
        throw std::runtime_error("cannot create seeds file");

    std::array<int, 64> usedByDensity {};
    int written = 0;
    for (const Candidate &candidate : candidates) {
        const int densityIndex = std::find(densities.begin(), densities.end(), candidate.stones) - densities.begin();
        if (densityIndex >= int(densities.size()) || usedByDensity[size_t(densityIndex)] >= 2)
            continue;
        output << candidate.stones << ':' << candidate.seed << '\n';
        std::cout << "SELECT stones=" << candidate.stones
                  << " seed=" << candidate.seed
                  << " nodes=" << candidate.nodes
                  << " aborted=" << candidate.aborted << '\n';
        usedByDensity[size_t(densityIndex)]++;
        if (++written == 8)
            break;
    }

    // 若部分密度沒有足夠難題，以整體排名補滿。
    for (const Candidate &candidate : candidates) {
        if (written >= 8)
            break;
        bool duplicate = false;
        for (const Token &token : readTokens(outputPath))
            if (token.stones == candidate.stones && token.seed == candidate.seed)
                duplicate = true;
        if (duplicate)
            continue;
        output << candidate.stones << ':' << candidate.seed << '\n';
        written++;
    }
    output.close();

    std::cout << "SELECTED_COUNT=" << written << '\n';
    return written == 8 ? 0 : 2;
}

double median(std::vector<double> values)
{
    std::sort(values.begin(), values.end());
    const size_t middle = values.size() / 2;
    return values.size() & 1 ? values[middle] : (values[middle - 1] + values[middle]) / 2.0;
}

int runBenchmark(const std::string &label,
                 const std::string &seedPath,
                 uint32_t maxNodes,
                 int repetitions)
{
    const std::vector<Token> tokens = readTokens(seedPath);
    if (tokens.empty())
        throw std::runtime_error("empty benchmark set");

    const auto firstBoard = makeBoard(tokens.front().stones, tokens.front().seed);
    const RunResult cold = runSearch(firstBoard, maxNodes);

    double totalMedianMs = 0;
    uint64_t totalNodes = 0;
    int totalRoutes = 0;
    int abortedCases = 0;
    uint64_t checksum = 0;
    bool allValid = cold.valid;

    for (const Token &token : tokens) {
        const auto board = makeBoard(token.stones, token.seed);
        std::vector<double> times;
        times.reserve(size_t(repetitions));
        RunResult representative;
        for (int rep = 0; rep < repetitions; rep++) {
            const RunResult result = runSearch(board, maxNodes);
            times.push_back(result.milliseconds);
            if (rep == 0)
                representative = result;
            allValid = allValid && result.valid;
        }
        const double caseMedian = median(times);
        totalMedianMs += caseMedian;
        totalNodes += representative.nodes;
        totalRoutes += representative.routes;
        abortedCases += representative.aborted ? 1 : 0;
        checksum ^= representative.checksum + uint64_t(token.seed) * 0x9e3779b97f4a7c15ULL;

        std::cout << std::fixed << std::setprecision(3)
                  << "CASE label=" << label
                  << " stones=" << token.stones
                  << " seed=" << token.seed
                  << " median_ms=" << caseMedian
                  << " nodes=" << representative.nodes
                  << " nps=" << (caseMedian > 0 ? double(representative.nodes) * 1000.0 / caseMedian : 0.0)
                  << " routes=" << representative.routes
                  << " length=" << representative.routeLength
                  << " aborted=" << representative.aborted
                  << " valid=" << representative.valid << '\n';
    }

    const double aggregateNps = totalMedianMs > 0
        ? double(totalNodes) * 1000.0 / totalMedianMs
        : 0.0;
    std::cout << std::fixed << std::setprecision(3)
              << "SUMMARY label=" << label
              << " cold_ms=" << cold.milliseconds
              << " median_total_ms=" << totalMedianMs
              << " total_nodes=" << totalNodes
              << " nps=" << aggregateNps
              << " routes=" << totalRoutes
              << " aborted_cases=" << abortedCases
              << " valid=" << allValid
              << " checksum=" << checksum << '\n';
    return allValid ? 0 : 3;
}

} // namespace

int main(int argc, char **argv)
{
    try {
        if (argc >= 3 && std::string(argv[1]) == "--select")
            return selectBoards(argv[2]);
        if (argc >= 6 && std::string(argv[1]) == "--run")
            return runBenchmark(argv[2], argv[3], uint32_t(std::stoul(argv[4])), std::stoi(argv[5]));
        std::cerr << "usage:\n"
                  << "  benchmark --select seeds.txt\n"
                  << "  benchmark --run label seeds.txt maxNodes repetitions\n";
        return 1;
    }
    catch (const std::exception &error) {
        std::cerr << "benchmark error: " << error.what() << '\n';
        return 10;
    }
}
