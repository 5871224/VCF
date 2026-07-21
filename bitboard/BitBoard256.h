#pragma once

#include <cstdint>

namespace vcf::bitboard {

constexpr int kBoardSize = 15;
constexpr int kExternalCellCount = kBoardSize * kBoardSize; // 225
constexpr int kInternalStride = 16;
constexpr int kInternalCellCount = kInternalStride * kInternalStride; // 256
constexpr int kWordBits = 64;
constexpr int kWordCount = kInternalCellCount / kWordBits; // 4

// 對外仍使用 15×15、0..224；核心內部使用 16×16、0..255。
// 每列第 16 位及最後一列是補位，永遠不是合法落點。
constexpr bool isBoardCoordinate(int x, int y) noexcept {
    return x >= 0 && x < kBoardSize && y >= 0 && y < kBoardSize;
}

constexpr bool isExternalIndex(int index) noexcept {
    return index >= 0 && index < kExternalCellCount;
}

constexpr int toExternalIndex(int x, int y) noexcept {
    return isBoardCoordinate(x, y) ? y * kBoardSize + x : -1;
}

constexpr int externalToBitIndex(int index) noexcept {
    return isExternalIndex(index)
        ? (index / kBoardSize) * kInternalStride + (index % kBoardSize)
        : -1;
}

constexpr int toBitIndex(int x, int y) noexcept {
    return isBoardCoordinate(x, y) ? y * kInternalStride + x : -1;
}

constexpr int bitIndexToX(int bitIndex) noexcept {
    return bitIndex >= 0 && bitIndex < kInternalCellCount
        ? bitIndex % kInternalStride
        : -1;
}

constexpr int bitIndexToY(int bitIndex) noexcept {
    return bitIndex >= 0 && bitIndex < kInternalCellCount
        ? bitIndex / kInternalStride
        : -1;
}

constexpr bool isPlayableBitIndex(int bitIndex) noexcept {
    return isBoardCoordinate(bitIndexToX(bitIndex), bitIndexToY(bitIndex));
}

constexpr int bitToExternalIndex(int bitIndex) noexcept {
    return isPlayableBitIndex(bitIndex)
        ? bitIndexToY(bitIndex) * kBoardSize + bitIndexToX(bitIndex)
        : -1;
}

constexpr int wordIndexOf(int bitIndex) noexcept {
    return bitIndex >> 6;
}

constexpr int bitOffsetOf(int bitIndex) noexcept {
    return bitIndex & 63;
}

enum class Stone : std::uint8_t {
    Empty = 0,
    Black = 1,
    White = 2,
};

struct BitBoard256 {
    std::uint64_t words[kWordCount]{};

    void clearAll() noexcept {
        for (auto& word : words) word = 0;
    }

    bool hasBit(int bitIndex) const noexcept {
        if (!isPlayableBitIndex(bitIndex)) return false;
        const auto mask = std::uint64_t{1} << bitOffsetOf(bitIndex);
        return (words[wordIndexOf(bitIndex)] & mask) != 0;
    }

    bool setBit(int bitIndex) noexcept {
        if (!isPlayableBitIndex(bitIndex)) return false;
        words[wordIndexOf(bitIndex)] |= std::uint64_t{1} << bitOffsetOf(bitIndex);
        return true;
    }

    bool clearBit(int bitIndex) noexcept {
        if (!isPlayableBitIndex(bitIndex)) return false;
        words[wordIndexOf(bitIndex)] &= ~(std::uint64_t{1} << bitOffsetOf(bitIndex));
        return true;
    }
};

struct Position {
    BitBoard256 black{};
    BitBoard256 white{};

    void clear() noexcept {
        black.clearAll();
        white.clearAll();
    }

    Stone stoneAtBit(int bitIndex) const noexcept {
        if (!isPlayableBitIndex(bitIndex)) return Stone::Empty;
        if (black.hasBit(bitIndex)) return Stone::Black;
        if (white.hasBit(bitIndex)) return Stone::White;
        return Stone::Empty;
    }

    Stone stoneAt(int x, int y) const noexcept {
        return stoneAtBit(toBitIndex(x, y));
    }

    bool isEmpty(int x, int y) const noexcept {
        const int bitIndex = toBitIndex(x, y);
        return isPlayableBitIndex(bitIndex) && stoneAtBit(bitIndex) == Stone::Empty;
    }

    bool place(int x, int y, Stone stone) noexcept {
        if (stone == Stone::Empty || !isEmpty(x, y)) return false;
        const int bitIndex = toBitIndex(x, y);
        return stone == Stone::Black
            ? black.setBit(bitIndex)
            : white.setBit(bitIndex);
    }

    bool remove(int x, int y) noexcept {
        const int bitIndex = toBitIndex(x, y);
        if (!isPlayableBitIndex(bitIndex)) return false;
        const bool occupied = black.hasBit(bitIndex) || white.hasBit(bitIndex);
        black.clearBit(bitIndex);
        white.clearBit(bitIndex);
        return occupied;
    }
};

} // namespace vcf::bitboard
