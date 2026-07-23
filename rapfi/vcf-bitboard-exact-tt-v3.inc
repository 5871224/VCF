// 新版多組 VCF 專用精確同型表。
//
// 嚴格搜尋只允許在黑、白 bitboard 完全相同時命中；ply 不參與 key，
// 因為固定起始盤且每層固定增加攻守各一子時，相同黑白盤面自然具有相同手數。
// 雜湊只用於定位與快速篩選，命中前仍會逐字比較完整 bitboard，避免碰撞誤剪。
// 固定容量、二路組相連設計避免 unordered_set 的節點配置與多個 ply bucket 開銷；
// 表滿時覆蓋舊項目只會降低命中率，不會造成錯誤剪枝。

namespace {

class ExactPositionTransTableV3 {
public:
    explicit ExactPositionTransTableV3(int maxDepth)
    {
        (void)maxDepth;
        buckets.resize(BUCKET_COUNT);
    }

    bool has(const Position &position, int ply) const
    {
        (void)ply;
        const uint64_t mixed = mixHash(position.board.hash);
        const uint64_t tag = mixed | 1ULL;
        const Bucket &bucket = buckets[size_t(mixed) & BUCKET_MASK];
        for (const Entry &entry : bucket.entries) {
            if (entry.tag == tag
                && entry.black == position.board.black
                && entry.white == position.board.white)
                return true;
        }
        return false;
    }

    void store(const Position &position, int ply)
    {
        (void)ply;
        const uint64_t mixed = mixHash(position.board.hash);
        const uint64_t tag = mixed | 1ULL;
        Bucket &bucket = buckets[size_t(mixed) & BUCKET_MASK];

        for (Entry &entry : bucket.entries) {
            if (entry.tag == tag
                && entry.black == position.board.black
                && entry.white == position.board.white)
                return;
        }
        for (Entry &entry : bucket.entries) {
            if (entry.tag == 0) {
                write(entry, position, tag);
                return;
            }
        }

        Entry &replacement = bucket.entries[bucket.nextReplace & (WAYS - 1)];
        bucket.nextReplace = uint8_t((bucket.nextReplace + 1) & (WAYS - 1));
        write(replacement, position, tag);
    }

private:
    static constexpr size_t WAYS = 2;
    static constexpr size_t BUCKET_COUNT = size_t(1) << 16;
    static constexpr size_t BUCKET_MASK = BUCKET_COUNT - 1;

    struct Entry {
        std::array<uint64_t, BIT_WORDS> black {};
        std::array<uint64_t, BIT_WORDS> white {};
        uint64_t tag = 0;
    };

    struct Bucket {
        std::array<Entry, WAYS> entries {};
        uint8_t nextReplace = 0;
    };

    std::vector<Bucket> buckets;

    static uint64_t mixHash(uint64_t value)
    {
        value ^= value >> 30;
        value *= 0xbf58476d1ce4e5b9ULL;
        value ^= value >> 27;
        value *= 0x94d049bb133111ebULL;
        value ^= value >> 31;
        return value;
    }

    static void write(Entry &entry, const Position &position, uint64_t tag)
    {
        entry.black = position.board.black;
        entry.white = position.board.white;
        entry.tag = tag;
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
