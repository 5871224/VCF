#include <array>
#include <functional>
#include <limits>
#include <string>

#define main vcfShortestBenchmarkOriginalMain
#include "vcf-shortest-benchmark.cpp"
#undef main

namespace {

struct SampleSet {
    std::string name;
    std::vector<BenchResult> values;
};

BenchResult medianSample(std::vector<BenchResult> values)
{
    std::sort(values.begin(), values.end(), [](const BenchResult &a, const BenchResult &b) {
        return a.milliseconds < b.milliseconds;
    });
    return values[values.size() / 2];
}

void printSampleSummary(const SampleSet &set)
{
    const BenchResult median = medianSample(set.values);
    double minimum = std::numeric_limits<double>::infinity();
    double maximum = 0.0;
    for (const BenchResult &value : set.values) {
        minimum = std::min(minimum, value.milliseconds);
        maximum = std::max(maximum, value.milliseconds);
    }
    std::cout << set.name
              << " median_ms=" << std::fixed << std::setprecision(3) << median.milliseconds
              << " min_ms=" << minimum
              << " max_ms=" << maximum
              << " nodes=" << median.nodes
              << " tt=" << median.ttEntries
              << " capacity=" << median.ttCapacity
              << '\n';
}

} // namespace

int main()
{
#ifdef __EMSCRIPTEN__
    constexpr int ROUNDS = 11;
    std::cout << "runtime=wasm-interleaved\n";
#else
    constexpr int ROUNDS = 15;
    std::cout << "runtime=native-interleaved\n";
#endif

    const auto board = loadQuestion();
    const BenchResult best = productionSearch(board, 200, 50000000);
    printResult("find-current", best);
    if (!best.found || best.routeLength != 111 || best.aborted)
        return 2;

    constexpr int BOUND = 110;
    using Run = std::function<BenchResult()>;
    std::array<Run, 5> runs {
        [&]() { return productionSearch(board, BOUND); },
        [&]() { return genericSearch<LocalFourWayTT<16>>(board, BOUND); },
        [&]() { return genericSearch<LocalFourWayTT<17>>(board, BOUND); },
        [&]() { return genericSearch<LocalFourWayTT<18>>(board, BOUND); },
        [&]() { return exactSetSearch(board, BOUND); },
    };
    std::array<SampleSet, 5> samples {{
        {"v1-production-256k", {}},
        {"v1-dedicated-256k", {}},
        {"v2-dedicated-512k", {}},
        {"v2-dedicated-1024k", {}},
        {"v2-dedicated-exact-set", {}},
    }};

    for (int i = 0; i < 5; i++) {
        const BenchResult warm = runs[i]();
        if (warm.found || warm.aborted || warm.rootCandidates != 18)
            return 3;
    }

    for (int round = 0; round < ROUNDS; round++) {
        for (int offset = 0; offset < 5; offset++) {
            const int index = (round + offset) % 5;
            BenchResult result = runs[index]();
            if (result.found || result.aborted || result.rootCandidates != 18)
                return 4;
            samples[index].values.push_back(result);
        }
    }

    for (const SampleSet &sample : samples)
        printSampleSummary(sample);

    std::vector<std::pair<std::string, double>> ranking;
    for (const SampleSet &sample : samples)
        ranking.push_back({sample.name, medianSample(sample.values).milliseconds});
    std::sort(ranking.begin(), ranking.end(), [](const auto &a, const auto &b) {
        return a.second < b.second;
    });
    std::cout << "winner=" << ranking.front().first
              << " median_ms=" << std::fixed << std::setprecision(3) << ranking.front().second
              << '\n';
    return 0;
}
