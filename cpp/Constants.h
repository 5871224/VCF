#ifndef CONSTANTS_H
#define CONSTANTS_H

#include <cstdint>

// Board Config
const int BOARD_SIZE = 15;
const int BOARD_TOTAL = BOARD_SIZE * BOARD_SIZE;

// Color Definitions
enum Color : int8_t {
    COLOR_OUT = -1,
    COLOR_EMPTY = 0,
    COLOR_BLACK = 1,
    COLOR_WHITE = 2
};

inline Color invertColor(Color c) {
    return (c == COLOR_BLACK) ? COLOR_WHITE : (c == COLOR_WHITE) ? COLOR_BLACK : c;
}

// Rules Config
enum Rules : int8_t {
    GOMOKU_RULES = 0,
    RENJU_RULES = 1
};

// Threat levels (matches JS engine: getLevelPoint & 0x0f)
enum Level : int {
    LEVEL_NONE       = 0,
    LEVEL_VCT        = 4,
    LEVEL_VCF        = 6,
    LEVEL_FREETHREE  = 7,
    LEVEL_NOFREEFOUR = 8,
    LEVEL_FREEFOUR   = 9,
    LEVEL_WIN        = 10
};

// Global rules setting (defined in Main.cpp)
extern Rules g_rules;

// Renju Patterns
enum Pattern : uint32_t {
    PATTERN_NONE = 0x00,
    PATTERN_THREE_NOFREE = 0x01,
    PATTERN_THREE_FREE = 0x02,
    PATTERN_FOUR_NOFREE = 0x03,
    PATTERN_FOUR_FREE = 0x04,
    PATTERN_FIVE = 0x05,
    PATTERN_SIX = 0x06
};

// Pattern Flags
const uint32_t FOUL_BIT = 0x10;
const uint32_t FREE_BIT = 0x01;

#endif // CONSTANTS_H
