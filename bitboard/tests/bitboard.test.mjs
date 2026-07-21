import assert from "node:assert/strict";
import {
    BitBoard256,
    Position,
    Stone,
    bitToExternalIndex,
    externalToBitIndex,
    isPlayableBitIndex,
    toBitIndex,
    toExternalIndex,
} from "../bitboard.js";

assert.equal(toExternalIndex(0, 0), 0);
assert.equal(toExternalIndex(14, 0), 14);
assert.equal(toExternalIndex(0, 1), 15);
assert.equal(toExternalIndex(14, 14), 224);
assert.equal(toExternalIndex(15, 0), -1);

assert.equal(toBitIndex(0, 0), 0);
assert.equal(toBitIndex(14, 0), 14);
assert.equal(toBitIndex(0, 1), 16);
assert.equal(toBitIndex(14, 14), 238);
assert.equal(externalToBitIndex(224), 238);
assert.equal(bitToExternalIndex(238), 224);
assert.equal(bitToExternalIndex(15), -1); // 每列補位
assert.equal(bitToExternalIndex(240), -1); // 最後一列
assert.equal(isPlayableBitIndex(239), false);

const bits = new BitBoard256();
for (const bitIndex of [0, 63, 64, 127, 128, 191, 192, 238]) {
    if (isPlayableBitIndex(bitIndex)) {
        assert.equal(bits.setBit(bitIndex), true);
        assert.equal(bits.hasBit(bitIndex), true);
        assert.equal(bits.clearBit(bitIndex), true);
        assert.equal(bits.hasBit(bitIndex), false);
    }
}
assert.equal(bits.setBit(15), false);
assert.equal(bits.setBit(255), false);

const position = new Position();
assert.equal(position.place(7, 7, Stone.BLACK), true);
assert.equal(position.stoneAt(7, 7), Stone.BLACK);
assert.equal(position.place(7, 7, Stone.WHITE), false);
assert.equal(position.place(14, 14, Stone.WHITE), true);
assert.equal(position.stoneAt(14, 14), Stone.WHITE);
assert.equal(position.remove(7, 7), true);
assert.equal(position.stoneAt(7, 7), Stone.EMPTY);
assert.equal(position.remove(7, 7), false);

console.log("Bitboard mapping and placement tests passed.");
