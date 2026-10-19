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

    bool run() { return attack(0); }
    uint64_t nodes = 0;
    uint32_t maxPlyVisited = 0;
    bool aborted = false;
    std::vector<uint8_t> route;

private:
    Board &board;
    const uint32_t nodeLimit; // 0 means no node limit; the dedicated Worker may be stopped manually.
    const int maxPly;
    std::unordered_map<HashKey, int> provenFailures;

    bool visit(int ply)
    {
        if (nodeLimit != 0 && nodes >= nodeLimit) { aborted = true; return false; }
        nodes++;
        maxPlyVisited = std::max(maxPlyVisited, uint32_t(ply));
        return true;
    }

    bool attack(int ply)
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

        // Do not inherit Rapfi's quiescence QVCF neighbor/COMB pruning:
        // at ply >= 4 they silently discard ordinary block-four attacks
        // and prevent valid seven-ply-and-deeper forced sequences.
        // Always use Rapfi's own full-board incremental VCF generator,
        // for every attack ply (including Renju forbidden-point candidates).
        ScoredMove candidates[CELLS];
        ScoredMove *end = R == RENJU
            ? generate<VCF | RULE_RENJU>(board, candidates)
            : generate<VCF>(board, candidates);
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
                        winning = attack(ply + 2);
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
    TacticalSearch<R> search(*board, limit, maxPly);
    auto start = std::chrono::steady_clock::now();
    bool found = search.run();
    auto micros = std::chrono::duration_cast<std::chrono::microseconds>(
        std::chrono::steady_clock::now() - start).count();
    // Preserve long-running unlimited search metrics without 32-bit counter overflow.
    const uint64_t elapsedMicros = uint64_t(std::max<int64_t>(0, micros));
    stats[0] = uint32_t(search.nodes);
    stats[1] = uint32_t(search.nodes >> 32);
    stats[2] = uint32_t(elapsedMicros);
    stats[3] = uint32_t(elapsedMicros >> 32);
    stats[4] = search.maxPlyVisited;
    stats[5] = search.aborted ? 1U : 0U;
    stats[6] = uint32_t(search.route.size());
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
    std::fill_n(outStats, 7, 0U);
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
    uint32_t stats[7] {};
    b[7 * 15 + 6] = b[7 * 15 + 7] = b[7 * 15 + 8] = b[7 * 15 + 9] = 1;
    const int found = rapfiStandaloneVCF(b, 1, 0, 100000, 21, moves, stats);
    assert(found == 1 && stats[6] >= 1 && stats[0] > 0);
    // Zero-node-limit now means truly unlimited (not the old default 5M).
    const int unlimited = rapfiStandaloneVCF(b, 1, 0, 0, 21, moves, stats);
    assert(unlimited == 1 && stats[6] >= 1 && stats[5] == 0);
    assert(moves[0] == 7 * 15 + 5 || moves[0] == 7 * 15 + 10);
    // Construct a 7-ply forced-win chain with separated rows/columns
    // (and no accidental diagonal early open-four):
    // h8-g8 (block), h5-h4 (block), e5-d5 (block), e8 (open four).
    // Before a preceding attack is played, its subsequent move is only
    // an open-three, not a four. This catches depth-dependent pruning.
    uint8_t deepBoard[CELLS] {};
    auto stone = [&](int x, int y, int color) { deepBoard[y * N + x] = uint8_t(color); };
    for (int x : {8, 9, 10}) stone(x, 7, 1);
    stone(11, 7, 2);
    stone(7, 5, 1);
    stone(7, 6, 1);
    stone(7, 8, 2);
    stone(5, 4, 1);
    stone(6, 4, 1);
    stone(8, 4, 2);
    stone(4, 5, 1);
    stone(4, 6, 1);
    // Block two incidental diagonal open-four shortcuts from this setup,
    // without occupying any of the planned 7-ply attack/defence points.
    stone(9, 8, 2);
    stone(5, 3, 2);
    uint8_t deepRoute[CELLS] {};
    uint32_t deepStats[7] {};
    const int deepFound = rapfiStandaloneVCF(deepBoard, 1, 0, 0, 7, deepRoute, deepStats);
    assert(deepFound == 1);
    std::fprintf(stderr, "deep smoke routeLength=%u deepest=%u nodes=%u route: ", deepStats[6], deepStats[4], deepStats[0]);
    for (uint32_t i = 0; i < deepStats[6]; ++i) std::fprintf(stderr, " %u", unsigned(deepRoute[i]));
    std::fprintf(stderr, "\\n");
    assert(deepStats[6] == 7 && deepStats[4] == 7);
    assert(deepRoute[0] == 7 * N + 7 && deepRoute[6] == 7 * N + 4);
    std::puts("Independent Rapfi VCF deep 7-ply regression passed");
}
#endif
