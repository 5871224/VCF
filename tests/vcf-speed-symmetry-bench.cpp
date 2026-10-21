// Bench-only comparison. This file is never used by the production app.
#include <algorithm>
#include <array>
#include <chrono>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <vector>

extern "C" int vcfBbFindModeV3(const uint8_t*, int, int, int, int, int,
                               int, int, uint32_t, uint8_t*, uint16_t*, int, void*);
extern "C" int rapfiStandaloneVCF(const uint8_t*, int, int, uint32_t,
                                  int, uint8_t*, uint32_t*);

#pragma pack(push, 1)
struct BbStats {
  uint32_t nodes, elapsedMicros;
  uint16_t routeCount, candidateCount, maxPly;
  uint8_t aborted, reserved;
};
#pragma pack(pop)
static_assert(sizeof(BbStats) == 16, "Bitboard stats layout");

using Board = std::array<uint8_t, 225>;
constexpr uint32_t LIMIT = 40000;
constexpr int MAX_PLY = 15;
constexpr int WARMUPS = 2;
constexpr int BATCH = 6;
constexpr int TRIALS = 5;

struct Sample {
  bool win = false, aborted = false;
  uint64_t nodes = 0, attackNodes = 0;
  double engineMs = 0;
  int routeLength = 0;
};

Sample runBitboard(const Board& b, int rule) {
  uint8_t moves[224] {};
  uint16_t lengths[64] {};
  BbStats stats {};
  int found = vcfBbFindModeV3(b.data(), 1, rule, 0, 0, 0,
                             1, MAX_PLY, LIMIT, moves, lengths, 224, &stats);
  return {found > 0, stats.aborted != 0, stats.nodes, stats.nodes,
          stats.elapsedMicros / 1000.0, found > 0 ? int(lengths[0]) : 0};
}
Sample runRapfi(const Board& b, int rule) {
  uint8_t moves[225] {};
  uint32_t stats[9] {};
  int found = rapfiStandaloneVCF(b.data(), 1, rule, LIMIT, MAX_PLY, moves, stats);
  uint64_t nodes = uint64_t(stats[0]) | (uint64_t(stats[1]) << 32);
  uint64_t micros = uint64_t(stats[2]) | (uint64_t(stats[3]) << 32);
  uint64_t attacks = uint64_t(stats[7]) | (uint64_t(stats[8]) << 32);
  return {found > 0, stats[5] != 0, nodes, attacks, micros / 1000.0,
          found > 0 ? int(stats[6]) : 0};
}

Board rotate(const Board& input, int code) {
  Board out {};
  for (int y=0; y<15; y++) for (int x=0; x<15; x++) {
    int a = code >= 4 ? 14-x : x, b=y;
    for (int r=0; r<(code % 4); r++) {
      int tmp=a; a=14-b; b=tmp;
    }
    out[b*15+a] = input[y*15+x];
  }
  return out;
}
Board deep7() {
  Board b {};
  auto put=[&](int x,int y,int color) { b[y*15+x] = uint8_t(color); };
  for (int x : {8,9,10}) put(x,7,1);
  put(11,7,2); put(7,5,1); put(7,6,1); put(7,8,2);
  put(5,4,1); put(6,4,1); put(8,4,2);
  put(4,5,1); put(4,6,1);
  put(9,8,2); put(5,3,2); put(6,5,2);
  return b;
}
Board noise7() {
  Board b = deep7();
  b[1*15+1]=1; b[2*15+2]=2;
  b[12*15+12]=1; b[13*15+13]=2;
  return b;
}
Board open4() {
  Board b {};
  for (int x=5;x<=8;x++) b[7*15+x]=1;
  return b;
}
double median(std::vector<double> samples) {
  std::sort(samples.begin(),samples.end());
  const int n = int(samples.size());
  return n&1 ? samples[n/2] : (samples[n/2-1]+samples[n/2])*0.5;
}

struct Result {
  double wallMs = 0, engineMs = 0;
  Sample sample;
};

Result benchmark(const Board& board, int rule, bool rapfi) {
  auto run=[&]() { return rapfi ? runRapfi(board,rule):runBitboard(board,rule); };
  for (int k=0;k<WARMUPS;k++) run();
  std::vector<double> walls, engines;
  Sample observed {};
  for (int trial=0;trial<TRIALS;trial++) {
    const auto start = std::chrono::steady_clock::now();
    double inner=0;
    for (int rep=0;rep<BATCH;rep++) {
      Sample s = run();
      inner += s.engineMs;
      if (rep==0 && trial==0) observed=s;
      if (s.win!=observed.win || s.aborted!=observed.aborted ||
          s.nodes!=observed.nodes || s.attackNodes!=observed.attackNodes ||
          s.routeLength!=observed.routeLength) {
        std::printf("UNSTABLE trial=%d rep=%d\n",trial,rep);
      }
    }
    const auto stop=std::chrono::steady_clock::now();
    const double wall=std::chrono::duration<double,std::milli>(stop-start).count()/BATCH;
    walls.push_back(wall);
    engines.push_back(inner/BATCH);
  }
  return {median(walls),median(engines),observed};
}

int main() {
  struct Fixture { const char* name; Board board; int rule; };
  const std::vector<Fixture> fixtures {
    {"deep7_free", deep7(), 0},
    {"deep7_renju", deep7(), 2},
    {"deep7_noise", noise7(), 0},
    {"open4_free", open4(), 0},
  };
  double ratios[4][8] {};
  int valid=0, mismatches=0, incomplete=0;
  std::puts("BEGIN_VCF_BENCH mode=native compiler=O3_LTO warmups=2 trials=5 batch=6 maxDepth=15 maxNodes=40000");
  for (const auto& fixture:fixtures) {
    int transform=0;
    for (;transform<8;transform++) {
      Board b=rotate(fixture.board,transform);
      const Result bb=benchmark(b,fixture.rule,false);
      const Result rp=benchmark(b,fixture.rule,true);
      const auto& a=bb.sample; const auto& c=rp.sample;
      const bool match=(a.win==c.win);
      const bool complete=(!a.aborted&&!c.aborted);
      double ratio = rp.wallMs>0 ? bb.wallMs/rp.wallMs : 0;
      std::printf("VCF_BENCH fixture=%s sym=%d rule=%d "
                  "bb_found=%d rp_found=%d bb_abort=%d rp_abort=%d "
                  "bb_wall_ms=%.6f rp_wall_ms=%.6f "
                  "bb_engine_ms=%.6f rp_engine_ms=%.6f "
                  "bb_raw_nodes=%llu rp_raw_nodes=%llu "
                  "bb_attack_nodes=%llu rp_attack_nodes=%llu "
                  "bb_nps=%.1f rp_raw_nps=%.1f rp_attack_nps=%.1f "
                  "ratio_bb_over_rapfi=%.3f bb_route=%d rp_route=%d\n",
                  fixture.name,transform,fixture.rule,
                  int(a.win),int(c.win),int(a.aborted),int(c.aborted),
                  bb.wallMs,rp.wallMs,bb.engineMs,rp.engineMs,
                  (unsigned long long)a.nodes,(unsigned long long)c.nodes,
                  (unsigned long long)a.attackNodes,(unsigned long long)c.attackNodes,
                  bb.wallMs>0 ? a.attackNodes*1000.0/bb.wallMs:0,
                  rp.wallMs>0 ? c.nodes*1000.0/rp.wallMs:0,
                  rp.wallMs>0 ? c.attackNodes*1000.0/rp.wallMs:0,
                  ratio,a.routeLength,c.routeLength);
      if (!match) mismatches++;
      if (!complete) incomplete++;
      if (match && complete) { ratios[valid/8][valid%8]=ratio; valid++; }
    }
  }
  std::printf("VCF_SUMMARY complete_matched=%d mismatches=%d incomplete=%d total=32\n",valid,mismatches,incomplete);
  return 0;
}
