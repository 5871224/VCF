// Standalone Rapfi tactical VCF benchmark. GPL-3.0-or-later.
// Uses only the pinned upstream Rapfi Board, Pattern and MoveGen; never VCF Bitboard.
// Search control and reporting are isolated from the workbench search engine.
#include "config.h"
#include "game/board.h"
#include "game/movegen.h"
#include <algorithm>
#include <array>
#include <chrono>
#include <cstdint>
#include <memory>
#include <unordered_map>
#include <vector>

namespace Config {
// Rapfi's original lookup tables in game/pattern.cpp initialise P4SCORES.
// Evaluation / neural networks are intentionally absent in this standalone build.
Eval EVALS[RULE_NB + 1][PCODE_NB] {};
Eval EVALS_THREAT[RULE_NB + 1][THREAT_NB] {};
Pattern4Score P4SCORES[RULE_NB + 1][PCODE_NB] {};
float ScalingFactor = 200.0f;
}

namespace {
constexpr int N = 15;
constexpr int CELLS = N * N;
constexpr uint32_t DEFAULT_NODES = 5000000;
constexpr size_t MAX_TABLE = 262144;

template<Rule R>
void play(Board &board, Pos pos) { board.move<R, Board::MoveType::NO_EVAL>(pos); }
template<Rule R>
void undo(Board &board) { board.undo<R, Board::MoveType::NO_EVAL>(); }

int indexOf(Pos p) { return p.y() * N + p.x(); }
Pos positionOf(int p) { return Pos(p % N, p / N); }

template<Rule R>
bool forbidden(const Board &board, Pos p)
{
    return R == RENJU && board.sideToMove() == BLACK && board.checkForbiddenPoint(p);
}

template<Rule R>
bool loadPosition(Board &board, const uint8_t *cells, Color attacker)
{
    board.newGame<R>();
    int passes = 0;
    int stones = 0;
    for (int i = 0; i < CELLS; i++) {
        if (cells[i] != 1 && cells[i] != 2) {
            if (cells[i] != 0) return false;
            continue;
        }
        Color target = cells[i] == 1 ? BLACK : WHITE;
        if (board.sideToMove() != target) {
            if (++passes >= CELLS) return false;
            play<R>(board, Pos::PASS);
        }
        play<R>(board, positionOf(i));
        stones++;
    }
    if (stones >= CELLS) return false;
    if (board.sideToMove() != attacker) {
        if (++passes >= CELLS) return false;
        play<R>(board, Pos::PASS);
    }
    return true;
}

template<Rule R>
class TacticalSearch {
public:
    explicit TacticalSearch(Board &b, uint32_t limit, int depth)
        : board(b), nodeLimit(limit), maxPly(depth) {}

    bool run() { return attack(0, NONE, NONE); }
    uint32_t nodes = 0;
    uint32_t maxPlyVisited = 0;
    bool aborted = false;
    std::vector<uint8_t> route;

private:
    Board &board;
    const uint32_t nodeLimit;
    const int maxPly;
    std::unordered_map<HashKey, int> provenFailures;

    bool visit(int ply)
    {
        if (nodes >= nodeLimit) { aborted = true; return false; }
        nodes++;
        maxPlyVisited = std::max(maxPlyVisited, uint32_t(ply));
        return true;
    }

    bool attack(int ply, Pattern4 previousP4, Pattern4 olderP4)
    {
        if (aborted || ply >= maxPly || board.movesLeft() <= 0) return false;
        const Color self = board.sideToMove();
        const Color opponent = ~self;
        const HashKey key = board.zobristKey();
        const int remaining = maxPly - ply;
        const auto known = provenFailures.find(key);
        if (known != provenFailures.end() && known->second >= remaining)
            return false;

        // Rapfi incremental p4Count / lastPattern4 give immediate tactical replies.
        if (board.p4Count(self, A_FIVE)) {
            ScoredMove moves[CELLS];
            ScoredMove *end = generate<WINNING>(board, moves);
            if (end != moves && board.isEmpty(moves[0].pos)
                && !forbidden<R>(board, moves[0].pos) && visit(ply + 1)) {
                route.push_back(uint8_t(indexOf(moves[0].pos)));
                return true;
            }
            if (aborted) return false;
        }
        if (board.p4Count(opponent, A_FIVE) >= 2) return false;
        Pos mustDefend = Pos::NONE;
        if (board.p4Count(opponent, A_FIVE)) {
            ScoredMove moves[CELLS];
            ScoredMove *end = generate<DEFEND_FIVE>(board, moves);
            if (end == moves) return false;
            mustDefend = moves[0].pos;
        }

        // Rapfi's QVCF policy: full candidate set for arbitrary imported roots;
        // subsequent attacks use its exact neighbor offsets, progressively
        // preferring combined threats at greater negative QVCF depth.
        ScoredMove candidates[CELLS];
        ScoredMove *end = candidates;
        if (ply == 0) {
            end = R == RENJU
                ? generate<VCF | RULE_RENJU>(board, candidates)
                : generate<VCF>(board, candidates);
        } else {
            Pos center = board.getLastActualMoveOfSide(self);
            if (!center) return false;
            bool allowPlain = (ply <= 2 || (previousP4 >= D_BLOCK4_PLUS && olderP4 >= D_BLOCK4_PLUS));
            end = allowPlain
                ? generateNeighbors<VCF>(board, candidates, center, RANGE_SQUARE2_LINE4.data(), RANGE_SQUARE2_LINE4.size())
                : generateNeighbors<VCF | COMB>(board, candidates, center, RANGE_SQUARE2_LINE4.data(), RANGE_SQUARE2_LINE4.size());
        }
        std::sort(candidates, end, [&](const ScoredMove &a, const ScoredMove &b) {
            const Pattern4 pa = board.cell(a.pos).pattern4[self];
            const Pattern4 pb = board.cell(b.pos).pattern4[self];
            if (pa != pb) return pa > pb;
            const Score sa = board.cell(a.pos).score[self];
            const Score sb = board.cell(b.pos).score[self];
            return sa != sb ? sa > sb : a.pos < b.pos;
        });

        for (ScoredMove *move = candidates; move != end; ++move) {
            Pos p = move->pos;
            if (!board.isEmpty(p) || (mustDefend && p != mustDefend) || forbidden<R>(board, p))
                continue;
            if (!visit(ply + 1)) return false;
            const Pattern4 threatType = board.cell(p).pattern4[self];
            route.push_back(uint8_t(indexOf(p)));
            play<R>(board, p);
            bool winning = threatType == A_FIVE || threatType == B_FLEX4;

            if (!winning && ply + 2 < maxPly && board.p4Count(self, A_FIVE)) {
                // Rapfi's forced defence step. Black forbidden defence loses.
                ScoredMove defendMoves[CELLS];
                ScoredMove *dend = generate<DEFEND_FIVE>(board, defendMoves);
                Pos defense = dend == defendMoves ? Pos::NONE : defendMoves[0].pos;
                if (defense && board.isEmpty(defense)) {
                    if (R == RENJU && board.sideToMove() == BLACK && board.checkForbiddenPoint(defense)) {
                        winning = true;
                    } else if (visit(ply + 2)) {
                        route.push_back(uint8_t(indexOf(defense)));
                        play<R>(board, defense);
                        winning = attack(ply + 2, threatType, previousP4);
                        undo<R>(board);
                        if (!winning) route.pop_back();
                    }
                }
            }

            undo<R>(board);
            if (winning) return true;
            route.pop_back();
            if (aborted) return false;
        }

        if (!aborted && provenFailures.size() < MAX_TABLE) {
            auto &depth = provenFailures[key];
            depth = std::max(depth, remaining);
        }
        return false;
    }
};

template<Rule R>
int runRule(const uint8_t *cells, int attacker, uint32_t limit, int maxPly,
            uint8_t *outMoves, uint32_t *stats)
{
    auto board = std::make_unique<Board>(N, CandidateRange::FULL_BOARD);
    if (!loadPosition<R>(*board, cells, attacker == 1 ? BLACK : WHITE)) return -1;
    maxPly = std::max(1, std::min(maxPly, std::min(224, board->movesLeft())));
    TacticalSearch<R> search(*board, limit ? limit : DEFAULT_NODES, maxPly);
    auto start = std::chrono::steady_clock::now();
    bool found = search.run();
    auto micros = std::chrono::duration_cast<std::chrono::microseconds>(
        std::chrono::steady_clock::now() - start).count();
    stats[0] = search.nodes;
    stats[1] = uint32_t(std::min<int64_t>(micros, UINT32_MAX));
    stats[2] = search.maxPlyVisited;
    stats[3] = search.aborted ? 1U : 0U;
    stats[4] = uint32_t(search.route.size());
    if (found)
        std::copy(search.route.begin(), search.route.end(), outMoves);
    return found ? 1 : 0;
}
}

extern "C" int rapfiStandaloneVCF(const uint8_t *cells, int attacker, int rule,
                                 uint32_t maxNodes, int maxPly,
                                 uint8_t *outMoves, uint32_t *outStats)
{
    if (!cells || !outMoves || !outStats || (attacker != 1 && attacker != 2)
        || rule < 0 || rule > 2 || maxPly < 1 || maxPly > 224) return -1;
    std::fill_n(outStats, 5, 0U);
    switch (rule) {
    case 0: return runRule<FREESTYLE>(cells, attacker, maxNodes, maxPly, outMoves, outStats);
    case 1: return runRule<STANDARD>(cells, attacker, maxNodes, maxPly, outMoves, outStats);
    case 2: return runRule<RENJU>(cells, attacker, maxNodes, maxPly, outMoves, outStats);
    }
    return -1;
}

#ifdef VCF_RAPFI_VCF_STANDALONE_TEST_MAIN
#include <cassert>
#include <cstdio>
int main()
{
    uint8_t b[CELLS] {};
    uint8_t moves[CELLS] {};
    uint32_t stats[5] {};
    b[7 * 15 + 6] = b[7 * 15 + 7] = b[7 * 15 + 8] = b[7 * 15 + 9] = 1;
    const int found = rapfiStandaloneVCF(b, 1, 0, 100000, 21, moves, stats);
    assert(found == 1 && stats[4] >= 1 && stats[0] > 0);
    assert(moves[0] == 7 * 15 + 5 || moves[0] == 7 * 15 + 10);
    std::puts("Independent Rapfi VCF smoke test passed");
}
#endif
