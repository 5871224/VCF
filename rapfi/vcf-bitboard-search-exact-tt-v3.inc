// 新版多組 VCF 專用精確同型表。
//
// 嚴格搜尋只允許在黑、白 bitboard 完全相同時命中；ply 不參與 key，
// 因為固定起始盤且每層固定增加攻守各一子時，相同黑白盤面自然具有相同手數。
// 雜湊只用於定位與快速篩選，命中前仍會逐字比較完整 bitboard，避免碰撞誤剪。
// 固定容量直接對映表避免 unordered_set 的節點配置、ply bucket 與探查鏈開銷；
// 表項碰撞時覆蓋舊項目只會降低命中率，不會造成錯誤剪枝。

namespace {

class ExactPositionTransTableV3 {
public:
    explicit ExactPositionTransTableV3(int maxDepth)
        : entries(ENTRY_COUNT)
    {
        (void)maxDepth;
    }

    bool has(const Position &position, int ply) const
    {
        (void)ply;
        const uint64_t mixed = mixHash(position.board.hash);
        const Entry &entry = entries[size_t(mixed) & ENTRY_MASK];
        return entry.tag == (mixed | 1ULL)
            && entry.black == position.board.black
            && entry.white == position.board.white;
    }

    void store(const Position &position, int ply)
    {
        (void)ply;
        const uint64_t mixed = mixHash(position.board.hash);
        Entry &entry = entries[size_t(mixed) & ENTRY_MASK];
        entry.black = position.board.black;
        entry.white = position.board.white;
        entry.tag = mixed | 1ULL;
    }

private:
    // 131,072 個精確盤面表項；每項保存完整黑白 bitboard 與非零 tag。
    // 固定記憶體約 9 MiB，避免搜尋途中配置與 rehash。
    static constexpr size_t ENTRY_COUNT = size_t(1) << 17;
    static constexpr size_t ENTRY_MASK = ENTRY_COUNT - 1;

    struct Entry {
        std::array<uint64_t, BIT_WORDS> black {};
        std::array<uint64_t, BIT_WORDS> white {};
        uint64_t tag = 0;
    };

    std::vector<Entry> entries;

    static uint64_t mixHash(uint64_t value)
    {
        value ^= value >> 30;
        value *= 0xbf58476d1ce4e5b9ULL;
        value ^= value >> 27;
        value *= 0x94d049bb133111ebULL;
        value ^= value >> 31;
        return value;
    }
};

int exactPositionTransTableV3SelfTest()
{
    std::array<uint8_t, BOARD_CELLS> source {};
    Position position;
    position.load(source.data());
    position.play(CENTER, BLACK);

    ExactPositionTransTableV3 table(15);
    table.store(position, 0);
    if (!table.has(position, 0))
        return 201;

    // 相同盤面即使命中查詢傳入不同 ply，仍必須視為同一局面。
    if (!table.has(position, 10))
        return 202;

    Position superset = position;
    superset.play(CENTER + 1, WHITE);
    if (table.has(superset, 2))
        return 203;

    Position differentBlack = position;
    differentBlack.play(CENTER + BOARD_SIZE, BLACK);
    if (table.has(differentBlack, 2))
        return 204;

    return 0;
}

} // namespace
