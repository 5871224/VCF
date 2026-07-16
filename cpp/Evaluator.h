#ifndef EVALUATOR_H
#define EVALUATOR_H

#include <vector>
#include "Board.h"
#include "Constants.h"

class Evaluator {
public:
    Evaluator();

    // Check pattern on a specific line
    uint32_t checkLine(const Board& board, int idx, int direction, Color color) const;

    // Legacy mapping to checkLine
    uint32_t testLine(const Board& board, int idx, int direction, Color color) const;

    // Full Renju foul check (33, 44, long)
    bool isFoul(const Board& board, int idx, Color color) const;

    // Get all threats on empty squares (temporarily places each stone to get correct patterns)
    void getThreats(Board& board, Color color, uint32_t shadowInfo[BOARD_TOTAL]) const;

    // Get threat level of placing color at idx (matches JS getLevelPoint & 0x0f)
    // Temporarily places stone, evaluates, then removes it.
    int getLevelPoint(Board& board, int idx, Color color) const;

    // Get the highest threat level for color across all empty squares
    int getLevel(Board& board, Color color) const;

private:
    int idxTable[BOARD_TOTAL][29][4]; // [idx][move+14][dir]
    void initIdxTable();
    void initAroundIdxTable();
};

#endif // EVALUATOR_H
