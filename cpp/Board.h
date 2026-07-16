#ifndef BOARD_H
#define BOARD_H

#include <vector>
#include <string>
#include <cstring>
#include "Constants.h"
#include "Zobrist.h"

class Board {
public:
    Board() {
        clear();
    }

    void clear() {
        std::memset(cells, COLOR_EMPTY, sizeof(cells));
        std::memset(bb_black, 0, sizeof(bb_black));
        std::memset(bb_white, 0, sizeof(bb_white));
        moves.clear();
        currentKey = 0;
    }

    bool putStone(int idx, Color color) {
        if (idx < 0 || idx >= BOARD_TOTAL || cells[idx] != COLOR_EMPTY) return false;
        
        cells[idx] = color;
        moves.push_back(idx);
        
        // Update Bitboard
        int word = idx >> 6; // idx / 64
        int shift = idx & 63; // idx % 64
        if (color == COLOR_BLACK) bb_black[word] |= (1ULL << shift);
        else if (color == COLOR_WHITE) bb_white[word] |= (1ULL << shift);

        // Update Zobrist Hash
        currentKey ^= Zobrist::getInstance().getKey(idx, color);
        
        return true;
    }

    bool takeStone() {
        if (moves.empty()) return false;
        int idx = moves.back();
        Color color = static_cast<Color>(cells[idx]);
        moves.pop_back();

        // Update Zobrist
        currentKey ^= Zobrist::getInstance().getKey(idx, color);

        // Update Bitboard
        int word = idx >> 6;
        int shift = idx & 63;
        if (color == COLOR_BLACK) bb_black[word] &= ~(1ULL << shift);
        else if (color == COLOR_WHITE) bb_white[word] &= ~(1ULL << shift);

        cells[idx] = COLOR_EMPTY;
        return true;
    }

    Color getCell(int idx) const {
        if (idx < 0 || idx >= BOARD_TOTAL) return COLOR_OUT;
        return static_cast<Color>(cells[idx]);
    }

    void setCell(int idx, Color color) {
        if (idx >= 0 && idx < BOARD_TOTAL) {
            if (cells[idx] != COLOR_EMPTY) {
                // To be safe, clear current first if overwriting
                int word = idx >> 6;
                int shift = idx & 63;
                bb_black[word] &= ~(1ULL << shift);
                bb_white[word] &= ~(1ULL << shift);
                currentKey ^= Zobrist::getInstance().getKey(idx, cells[idx]);
            }
            cells[idx] = color;
            if (color != COLOR_EMPTY) {
                int word = idx >> 6;
                int shift = idx & 63;
                if (color == COLOR_BLACK) bb_black[word] |= (1ULL << shift);
                else bb_white[word] |= (1ULL << shift);
                currentKey ^= Zobrist::getInstance().getKey(idx, color);
            }
        }
    }

    uint64_t getHashKey() const { return currentKey; }

    static int toIdx(int x, int y) {
        if (x < 0 || x >= BOARD_SIZE || y < 0 || y >= BOARD_SIZE) return -1;
        return y * BOARD_SIZE + x;
    }

    static int getX(int idx) { return idx % BOARD_SIZE; }
    static int getY(int idx) { return idx / BOARD_SIZE; }

    const std::vector<int>& getHistory() const { return moves; }

private:
    int8_t cells[BOARD_TOTAL];
    uint64_t bb_black[4]; // 256 bits for 15x15 board
    uint64_t bb_white[4];
    uint64_t currentKey;
    std::vector<int> moves;
};

#endif // BOARD_H
