#include "../BitBoard256.h"
#include <cassert>
#include <iostream>

using namespace vcf::bitboard;

int main() {
    static_assert(toExternalIndex(0, 0) == 0);
    static_assert(toExternalIndex(14, 14) == 224);
    static_assert(toBitIndex(0, 1) == 16);
    static_assert(externalToBitIndex(224) == 238);
    static_assert(bitToExternalIndex(15) == -1);

    Position position;
    assert(position.place(7, 7, Stone::Black));
    assert(position.stoneAt(7, 7) == Stone::Black);
    assert(!position.place(7, 7, Stone::White));
    assert(position.place(14, 14, Stone::White));
    assert(position.stoneAt(14, 14) == Stone::White);
    assert(position.remove(7, 7));
    assert(position.stoneAt(7, 7) == Stone::Empty);

    std::cout << "Bitboard mapping and placement tests passed.\n";
}
