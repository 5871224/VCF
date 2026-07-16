#ifndef ZOBRIST_H
#define ZOBRIST_H

#include <random>
#include "Constants.h"

class Zobrist {
public:
    static Zobrist& getInstance() {
        static Zobrist instance;
        return instance;
    }

    uint64_t getKey(int idx, int color) const {
        if (idx < 0 || idx >= BOARD_TOTAL || color <= 0 || color > 2) return 0;
        return table[idx][color];
    }

private:
    uint64_t table[BOARD_TOTAL][3];

    Zobrist() {
        std::mt19937_64 engine(42); // Seed for deterministic hashing
        std::uniform_int_distribution<uint64_t> dist;
        for (int i = 0; i < BOARD_TOTAL; ++i) {
            table[i][0] = 0; // Empty
            table[i][1] = dist(engine); // Black
            table[i][2] = dist(engine); // White
        }
    }
};

#endif // ZOBRIST_H
