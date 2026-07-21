"use strict";

export const BOARD_SIZE = 15;
export const EXTERNAL_CELL_COUNT = BOARD_SIZE * BOARD_SIZE; // 225
export const INTERNAL_STRIDE = 16;
export const INTERNAL_CELL_COUNT = INTERNAL_STRIDE * INTERNAL_STRIDE; // 256
export const WORD_BITS = 64;
export const WORD_COUNT = INTERNAL_CELL_COUNT / WORD_BITS; // 4

export const Stone = Object.freeze({
    EMPTY: 0,
    BLACK: 1,
    WHITE: 2,
});

export function isBoardCoordinate(x, y) {
    return Number.isInteger(x) && Number.isInteger(y)
        && x >= 0 && x < BOARD_SIZE
        && y >= 0 && y < BOARD_SIZE;
}

export function isExternalIndex(index) {
    return Number.isInteger(index) && index >= 0 && index < EXTERNAL_CELL_COUNT;
}

export function toExternalIndex(x, y) {
    return isBoardCoordinate(x, y) ? y * BOARD_SIZE + x : -1;
}

export function externalToBitIndex(index) {
    return isExternalIndex(index)
        ? Math.floor(index / BOARD_SIZE) * INTERNAL_STRIDE + (index % BOARD_SIZE)
        : -1;
}

export function toBitIndex(x, y) {
    return isBoardCoordinate(x, y) ? y * INTERNAL_STRIDE + x : -1;
}

export function bitIndexToX(bitIndex) {
    return Number.isInteger(bitIndex) && bitIndex >= 0 && bitIndex < INTERNAL_CELL_COUNT
        ? bitIndex % INTERNAL_STRIDE
        : -1;
}

export function bitIndexToY(bitIndex) {
    return Number.isInteger(bitIndex) && bitIndex >= 0 && bitIndex < INTERNAL_CELL_COUNT
        ? Math.floor(bitIndex / INTERNAL_STRIDE)
        : -1;
}

export function isPlayableBitIndex(bitIndex) {
    return isBoardCoordinate(bitIndexToX(bitIndex), bitIndexToY(bitIndex));
}

export function bitToExternalIndex(bitIndex) {
    return isPlayableBitIndex(bitIndex)
        ? bitIndexToY(bitIndex) * BOARD_SIZE + bitIndexToX(bitIndex)
        : -1;
}

export function wordIndexOf(bitIndex) {
    return bitIndex >> 6;
}

export function bitOffsetOf(bitIndex) {
    return bitIndex & 63;
}

export class BitBoard256 {
    constructor() {
        this.words = new BigUint64Array(WORD_COUNT);
    }

    clearAll() {
        this.words.fill(0n);
    }

    hasBit(bitIndex) {
        if (!isPlayableBitIndex(bitIndex)) return false;
        const mask = 1n << BigInt(bitOffsetOf(bitIndex));
        return (this.words[wordIndexOf(bitIndex)] & mask) !== 0n;
    }

    setBit(bitIndex) {
        if (!isPlayableBitIndex(bitIndex)) return false;
        const wordIndex = wordIndexOf(bitIndex);
        this.words[wordIndex] |= 1n << BigInt(bitOffsetOf(bitIndex));
        return true;
    }

    clearBit(bitIndex) {
        if (!isPlayableBitIndex(bitIndex)) return false;
        const wordIndex = wordIndexOf(bitIndex);
        this.words[wordIndex] &= ~(1n << BigInt(bitOffsetOf(bitIndex)));
        return true;
    }

    toHexWords() {
        return Array.from(this.words, word => `0x${word.toString(16).padStart(16, "0")}`);
    }
}

export class Position {
    constructor() {
        this.black = new BitBoard256();
        this.white = new BitBoard256();
    }

    clear() {
        this.black.clearAll();
        this.white.clearAll();
    }

    stoneAtBit(bitIndex) {
        if (!isPlayableBitIndex(bitIndex)) return Stone.EMPTY;
        if (this.black.hasBit(bitIndex)) return Stone.BLACK;
        if (this.white.hasBit(bitIndex)) return Stone.WHITE;
        return Stone.EMPTY;
    }

    stoneAt(x, y) {
        return this.stoneAtBit(toBitIndex(x, y));
    }

    isEmpty(x, y) {
        const bitIndex = toBitIndex(x, y);
        return isPlayableBitIndex(bitIndex) && this.stoneAtBit(bitIndex) === Stone.EMPTY;
    }

    place(x, y, stone) {
        if ((stone !== Stone.BLACK && stone !== Stone.WHITE) || !this.isEmpty(x, y)) {
            return false;
        }
        const bitIndex = toBitIndex(x, y);
        return stone === Stone.BLACK
            ? this.black.setBit(bitIndex)
            : this.white.setBit(bitIndex);
    }

    remove(x, y) {
        const bitIndex = toBitIndex(x, y);
        if (!isPlayableBitIndex(bitIndex)) return false;
        const occupied = this.black.hasBit(bitIndex) || this.white.hasBit(bitIndex);
        this.black.clearBit(bitIndex);
        this.white.clearBit(bitIndex);
        return occupied;
    }

    toArray225() {
        const cells = new Uint8Array(EXTERNAL_CELL_COUNT);
        for (let index = 0; index < EXTERNAL_CELL_COUNT; index += 1) {
            cells[index] = this.stoneAtBit(externalToBitIndex(index));
        }
        return cells;
    }
}
