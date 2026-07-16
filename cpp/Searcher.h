#ifndef SEARCHER_H
#define SEARCHER_H

#include <vector>
#include <optional>
#include <unordered_map>
#include <future>
#include <atomic>
#include "Board.h"
#include "Evaluator.h"
#include "Constants.h"

struct VCFInfo {
    int vcfCount = 0;
    int nodeCount = 0;
    std::vector<std::vector<int>> winMoves;
};

struct TTEntry {
    bool win;
    int  depth;
};

struct SearchContext {
    int nodeCount = 0;
    int maxDepth  = 0;
    int maxNode   = 0;
    std::unordered_map<uint64_t, TTEntry> tt;
    const std::atomic<bool>* cancel = nullptr;
};

class Searcher {
public:
    Searcher(Evaluator& eval);

    VCFInfo findVCF(Board& board, Color attacker, int maxVCF, int maxDepth, int maxNode);
    bool isVCF(Color color, Board& board, const std::vector<int>& moves);
    std::vector<int> getBlockVCF(Board& board, Color color,
                                 const std::vector<int>& vcfMoves, bool includeFour);

private:
    Evaluator& evaluator;

    std::optional<std::vector<int>> vcfDFS(Board& board, Color attacker, int depth,
                                           SearchContext& ctx);
    std::vector<int> getCandidateMoves(Board& board, Color color, bool isAttacker);
};

#endif // SEARCHER_H
