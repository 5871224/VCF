#include "Searcher.h"
#include <algorithm>

Searcher::Searcher(Evaluator& eval) : evaluator(eval) {}

VCFInfo Searcher::findVCF(Board& board, Color attacker, int maxVCF, int maxDepth, int maxNode) {
    VCFInfo result;

    // Pre-scan: immediate five-in-a-row
    for (int i = 0; i < BOARD_TOTAL && result.vcfCount < maxVCF; i++) {
        if (board.getCell(i) != COLOR_EMPTY) continue;
        board.putStone(i, attacker);
        bool isFive = false;
        for (int d = 0; d < 4; d++) {
            if ((evaluator.checkLine(board, i, d, attacker) & 0xFF) == PATTERN_FIVE) {
                isFive = true; break;
            }
        }
        board.takeStone();
        if (isFive) {
            result.winMoves.push_back({i});
            result.vcfCount++;
        }
    }
    if (result.vcfCount >= maxVCF) {
        result.nodeCount = BOARD_TOTAL;
        return result;
    }

    // Build task list: each valid four/five candidate with its board snapshot
    struct Task { int move; Board snap; bool immediateFive; };
    std::vector<Task> tasks;

    std::vector<int> atkMoves = getCandidateMoves(board, attacker, true);
    tasks.reserve(atkMoves.size());

    for (int move : atkMoves) {
        Board snap = board;
        snap.putStone(move, attacker);
        bool isFive = false;
        for (int d = 0; d < 4; d++) {
            if ((evaluator.checkLine(snap, move, d, attacker) & 0xFF) == PATTERN_FIVE) {
                isFive = true; break;
            }
        }
        // isFoul must be checked AFTER placing: a move creating five overrides any foul
        if (!isFive && evaluator.isFoul(snap, move, attacker)) continue;
        tasks.push_back({move, std::move(snap), isFive});
    }

    // Collect immediate wins first; short-circuit if maxVCF reached
    for (auto& t : tasks) {
        if (t.immediateFive && result.vcfCount < maxVCF) {
            result.winMoves.push_back({t.move});
            result.vcfCount++;
        }
    }
    if (result.vcfCount >= maxVCF) {
        result.nodeCount = 0;
        return result;
    }

    // Shared early-exit flag; valid until all futures complete
    std::atomic<bool> cancelled{false};

    using Result = std::pair<std::optional<std::vector<int>>, int>;
    std::vector<std::future<Result>> futures;
    futures.reserve(tasks.size());

    for (auto& t : tasks) {
        if (t.immediateFive) continue;
        futures.push_back(std::async(std::launch::async,
            [this, snap = t.snap, move = t.move,
             attacker, maxDepth, maxNode, &cancelled]() mutable -> Result {
                SearchContext ctx;
                ctx.maxDepth = maxDepth;
                ctx.maxNode  = maxNode;
                ctx.cancel   = &cancelled;
                auto sub = vcfDFS(snap, attacker, 1, ctx);
                if (sub) {
                    std::vector<int> path = {move};
                    path.insert(path.end(), sub->begin(), sub->end());
                    return {std::move(path), ctx.nodeCount};
                }
                return {std::nullopt, ctx.nodeCount};
            }));
    }

    int totalNodes = 0;
    for (auto& f : futures) {
        auto [path, nodes] = f.get();
        totalNodes += nodes;
        if (path && result.vcfCount < maxVCF) {
            result.winMoves.push_back(std::move(*path));
            result.vcfCount++;
            if (result.vcfCount >= maxVCF)
                cancelled.store(true, std::memory_order_relaxed);
        }
    }

    result.nodeCount = totalNodes;
    return result;
}

std::optional<std::vector<int>> Searcher::vcfDFS(Board& board, Color attacker, int depth,
                                                   SearchContext& ctx) {
    ctx.nodeCount++;
    if (ctx.nodeCount >= ctx.maxNode || depth >= ctx.maxDepth) return std::nullopt;
    if (ctx.cancel && ctx.cancel->load(std::memory_order_relaxed)) return std::nullopt;

    uint64_t key = board.getHashKey();
    {
        auto it = ctx.tt.find(key);
        if (it != ctx.tt.end() && !it->second.win && it->second.depth >= (ctx.maxDepth - depth))
            return std::nullopt;
    }

    Color defender = invertColor(attacker);
    std::vector<int> atkMoves = getCandidateMoves(board, attacker, true);

    for (int atkMove : atkMoves) {
        board.putStone(atkMove, attacker);

        bool isFive = false;
        for (int d = 0; d < 4; d++) {
            if ((evaluator.checkLine(board, atkMove, d, attacker) & 0xFF) == PATTERN_FIVE) {
                isFive = true; break;
            }
        }

        if (isFive) {
            board.takeStone();
            return std::vector<int>{atkMove};
        }

        // isFoul must be checked AFTER placing: five overrides all fouls
        if (evaluator.isFoul(board, atkMove, attacker)) {
            board.takeStone();
            continue;
        }

        std::vector<int> defMoves = getCandidateMoves(board, attacker, false);
        if (defMoves.empty()) {
            board.takeStone();
            continue;
        }

        bool atkWins = true;
        std::vector<int> recordedCont;
        bool contRecorded = false;

        for (int defMove : defMoves) {
            board.putStone(defMove, defender);
            auto sub = vcfDFS(board, attacker, depth + 1, ctx);
            board.takeStone();

            if (!sub) {
                atkWins = false;
                break;
            }
            if (!contRecorded) {
                contRecorded = true;
                recordedCont.push_back(defMove);
                recordedCont.insert(recordedCont.end(), sub->begin(), sub->end());
            }
        }

        board.takeStone();

        if (atkWins) {
            std::vector<int> winPath = {atkMove};
            winPath.insert(winPath.end(), recordedCont.begin(), recordedCont.end());
            return winPath;
        }
    }

    ctx.tt[key] = {false, ctx.maxDepth - depth};
    return std::nullopt;
}

bool Searcher::isVCF(Color color, Board& board, const std::vector<int>& moves) {
    if (moves.empty() || moves.size() % 2 == 0) return false;
    Color defender = invertColor(color);

    for (int i = 0; i < (int)moves.size(); i++) {
        int idx = moves[i];
        Color c = (i % 2 == 0) ? color : defender;
        if (board.getCell(idx) != COLOR_EMPTY) return false;

        if (i % 2 == 0) {
            std::vector<int> atkMoves = getCandidateMoves(board, color, true);
            if (std::find(atkMoves.begin(), atkMoves.end(), idx) == atkMoves.end())
                return false;
        } else {
            std::vector<int> defMoves = getCandidateMoves(board, color, false);
            if (defMoves.empty() ||
                std::find(defMoves.begin(), defMoves.end(), idx) == defMoves.end())
                return false;
        }

        board.putStone(idx, c);

        if (i % 2 == 0) {
            bool isFive = false;
            for (int d = 0; d < 4; d++) {
                if ((evaluator.checkLine(board, idx, d, color) & 0xFF) == PATTERN_FIVE) {
                    isFive = true; break;
                }
            }
            if (isFive && i != (int)moves.size() - 1) {
                board.takeStone();
                return false;
            }

            if (!isFive) {
                std::vector<int> defMoves = getCandidateMoves(board, color, false);
                if (defMoves.empty()) {
                    board.takeStone();
                    return false;
                }
                if (i + 1 >= (int)moves.size()) {
                    board.takeStone();
                    return false;
                }
                int nextDef = moves[i + 1];
                if (std::find(defMoves.begin(), defMoves.end(), nextDef) == defMoves.end()) {
                    board.takeStone();
                    return false;
                }
            }
        }
    }

    for (int i = 0; i < (int)moves.size(); i++) board.takeStone();
    return true;
}

std::vector<int> Searcher::getBlockVCF(Board& board, Color color,
                                       const std::vector<int>& vcfMoves, bool includeFour) {
    std::vector<int> result;
    Color defender = invertColor(color);
    int placed = 0;

    for (int i = 0; i < (int)vcfMoves.size(); i++) {
        int idx = vcfMoves[i];
        Color c = (i % 2 == 0) ? color : defender;

        if (board.getCell(idx) != COLOR_EMPTY) break;

        if (i % 2 == 0) {
            int level = evaluator.getLevelPoint(board, idx, color);
            if (level == LEVEL_WIN || level == LEVEL_NOFREEFOUR ||
                (level == LEVEL_FREEFOUR && includeFour)) {
                result.push_back(idx);
            }
        }

        board.putStone(idx, c);
        placed++;
    }

    for (int i = 0; i < placed; i++) board.takeStone();
    return result;
}

std::vector<int> Searcher::getCandidateMoves(Board& board, Color color, bool isAttacker) {
    std::vector<int> candidates;
    uint32_t threats[BOARD_TOTAL];
    evaluator.getThreats(board, color, threats);

    if (isAttacker) {
        for (int i = 0; i < BOARD_TOTAL; i++) {
            if ((threats[i] & 0xFF) == PATTERN_FIVE) return {i};
        }
        for (int i = 0; i < BOARD_TOTAL; i++) {
            uint32_t type = threats[i] & 0xFF;
            if (type == PATTERN_FOUR_FREE || type == PATTERN_FOUR_NOFREE)
                candidates.push_back(i);
        }
    } else {
        for (int i = 0; i < BOARD_TOTAL; i++) {
            if ((threats[i] & 0xFF) == PATTERN_FIVE)
                candidates.push_back(i);
        }
    }
    return candidates;
}
