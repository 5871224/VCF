#include "Evaluator.h"
#include <algorithm>

Evaluator::Evaluator() {
    initIdxTable();
    initAroundIdxTable();
}

void Evaluator::initIdxTable() {
    int outIdx = 225;
    for (int i = 0; i < BOARD_TOTAL; ++i) {
        for (int m = 0; m < 29; ++m) {
            for (int d = 0; d < 4; ++d) {
                idxTable[i][m][d] = outIdx;
            }
        }
    }

    auto getX = [](int idx) { return idx % 15; };
    auto getY = [](int idx) { return idx / 15; };

    for (int idx = 0; idx < 225; idx++) {
        int x = getX(idx);
        int y = getY(idx);
        for (int move = -14; move <= 14; move++) {
            if (x + move >= 0 && x + move < 15)
                idxTable[idx][move + 14][0] = y * 15 + (x + move);
            if (y + move >= 0 && y + move < 15)
                idxTable[idx][move + 14][1] = (y + move) * 15 + x;
            if (x + move >= 0 && x + move < 15 && y + move >= 0 && y + move < 15)
                idxTable[idx][move + 14][2] = (y + move) * 15 + (x + move);
            if (x + move >= 0 && x + move < 15 && y - move >= 0 && y - move < 15)
                idxTable[idx][move + 14][3] = (y - move) * 15 + (x + move);
        }
    }
}

void Evaluator::initAroundIdxTable() {}

uint32_t Evaluator::testLine(const Board& board, int idx, int direction, Color color) const {
    return checkLine(board, idx, direction, color);
}

uint32_t Evaluator::checkLine(const Board& board, int idx, int direction, Color color) const {
    int maxCount = 0;
    int freeCount = 0;
    int8_t vs[11];
    for (int move = -5; move <= 5; ++move) {
        vs[move + 5] = board.getCell(idxTable[idx][move + 14][direction]);
    }

    for (int move = -4; move <= 0; ++move) {
        int colorCount = 0;
        int emptyCount = 0;
        bool blocked = false;
        for (int i = 0; i < 5; ++i) {
            int8_t v = vs[move + i + 5];
            if (v == color) colorCount++;
            else if (v == COLOR_EMPTY) emptyCount++;
            else { blocked = true; break; }
        }

        if (!blocked && (colorCount + emptyCount == 5)) {
            if (color == COLOR_BLACK && (vs[move + 4] == color || vs[move + 10] == color)) {
                if (colorCount == 5) { maxCount = 6; break; }
                continue;
            }
            if (colorCount > maxCount) {
                maxCount = colorCount;
                bool leftOpen = (vs[move + 4] == COLOR_EMPTY);
                bool rightOpen = (vs[move + 10] == COLOR_EMPTY);
                freeCount = (leftOpen && rightOpen) ? 1 : 0;
            } else if (colorCount == maxCount) {
                bool leftOpen = (vs[move + 4] == COLOR_EMPTY);
                bool rightOpen = (vs[move + 10] == COLOR_EMPTY);
                if (leftOpen && rightOpen) freeCount++;
            }
        }
    }

    uint32_t pattern = PATTERN_NONE;
    if (maxCount >= 5) pattern = PATTERN_FIVE | (maxCount >= 6 ? FOUL_BIT : 0);
    else if (maxCount == 4) pattern = (freeCount > 0 ? PATTERN_FOUR_FREE : PATTERN_FOUR_NOFREE);
    else if (maxCount == 3 && freeCount > 0) pattern = PATTERN_THREE_FREE;
    
    return (direction << 12) | pattern;
}

bool Evaluator::isFoul(const Board& board, int idx, Color color) const {
    if (color != COLOR_BLACK || g_rules != RENJU_RULES) return false;
    int threeCount = 0, fourCount = 0;
    for (int d = 0; d < 4; ++d) {
        uint32_t p = checkLine(board, idx, d, color);
        if (p & FOUL_BIT) return true;
        uint32_t type = p & 0xFF;
        if (type == PATTERN_FOUR_FREE || type == PATTERN_FOUR_NOFREE) fourCount++;
        else if (type == PATTERN_THREE_FREE) threeCount++;
    }
    return (threeCount >= 2 || fourCount >= 2);
}

int Evaluator::getLevelPoint(Board& board, int idx, Color color) const {
    if (board.getCell(idx) != COLOR_EMPTY) return LEVEL_NONE;
    board.putStone(idx, color);

    bool hasFive = false, hasFourFree = false, hasFourNoFree = false, hasThreeFree = false;
    for (int d = 0; d < 4; d++) {
        uint32_t raw = checkLine(board, idx, d, color);
        uint32_t p   = raw & 0xFF;
        bool isLong  = (raw & FOUL_BIT) != 0;
        if (p == PATTERN_FIVE) {
            // Long connection (6+) is forbidden for black in Renju
            if (!isLong || color != COLOR_BLACK || g_rules != RENJU_RULES)
                hasFive = true;
        } else if (p == PATTERN_FOUR_FREE)  hasFourFree  = true;
        else if (p == PATTERN_FOUR_NOFREE)  hasFourNoFree = true;
        else if (p == PATTERN_THREE_FREE)   hasThreeFree  = true;
    }

    int level = LEVEL_NONE;
    if (hasFive && !isFoul(board, idx, color))         level = LEVEL_WIN;
    else if (hasFive)                                   level = LEVEL_NONE; // foul
    else if (isFoul(board, idx, color))                 level = LEVEL_NONE;
    else if (hasFourFree)                               level = LEVEL_FREEFOUR;
    else if (hasFourNoFree)                             level = LEVEL_NOFREEFOUR;
    else if (hasThreeFree)                              level = LEVEL_FREETHREE;

    board.takeStone();
    return level;
}

int Evaluator::getLevel(Board& board, Color color) const {
    int best = LEVEL_NONE;
    for (int i = 0; i < BOARD_TOTAL; i++) {
        int lvl = getLevelPoint(board, i, color);
        if (lvl > best) best = lvl;
        if (best >= LEVEL_WIN) break;
    }
    return best;
}

void Evaluator::getThreats(Board& board, Color color, uint32_t shadowInfo[BOARD_TOTAL]) const {
    for (int i = 0; i < BOARD_TOTAL; ++i) {
        shadowInfo[i] = PATTERN_NONE;
        if (board.getCell(i) != COLOR_EMPTY) continue;
        board.putStone(i, color);
        uint32_t best = PATTERN_NONE;
        for (int d = 0; d < 4; ++d) {
            uint32_t p = checkLine(board, i, d, color);
            if ((p & 0xFF) > (best & 0xFF)) best = p;
        }
        board.takeStone();
        shadowInfo[i] = best;
    }
}
