// 單組 VCF 專用精確同型表。
//
// 2026-07-23 Native／LTO SIMD Wasm 基準共同最快版本：
// - 65,536 buckets × 4 ways = 262,144 個表項。
// - Zobrist hash 先經 SplitMix64 finalizer。
// - tag 命中後仍完整比較黑、白 bitboard。
// - 四路全滿時以全域循環方式覆蓋近期表項。
// - 所有 ply bucket 共用同一張表，因此 ply 不屬於命中 key。
// - generation 讓各次搜尋重用固定儲存區，不必反覆配置或清空整張表。
//
// 本檔在 vcf-bitboard-search-v2.cpp 中，僅於包含單組核心時以巨集替換
// std::unordered_set；多組 V3 仍使用自己的 ExactPositionTransTableV3。
#pragma once

#include <cstddef>
#include <cstdint>
#include <memory>
#include <unordered_set>
#include <vector>

namespace std {

template<class Key, class Hash>
class VcfSingleFourWayTransTableV5 {
private:
    static constexpr size_t BUCKET_BITS = 16;
    static constexpr size_t BUCKET_COUNT = size_t(1) << BUCKET_BITS;
    static constexpr size_t BUCKET_MASK = BUCKET_COUNT - 1;
    static constexpr size_t WAY_COUNT = 4;

    struct Slot {
        Key key {};
        uint64_t tag = 0;
        uint32_t generation = 0;
    };

    struct Storage {
        vector<Slot> slots;
        uint32_t generation = 0;
        uint64_t replacementCounter = 0;

        Storage()
            : slots(BUCKET_COUNT * WAY_COUNT)
        {
        }

        void beginSearch()
        {
            generation++;
            replacementCounter = 0;
            if (generation == 0) {
                for (Slot &slot : slots)
                    slot.generation = 0;
                generation = 1;
            }
        }
    };

    struct Session {};

    inline static Storage storage {};
    inline static weak_ptr<Session> currentSession {};

    shared_ptr<Session> session;

    static uint64_t mixHash(uint64_t value)
    {
        value ^= value >> 30;
        value *= 0xbf58476d1ce4e5b9ULL;
        value ^= value >> 27;
        value *= 0x94d049bb133111ebULL;
        value ^= value >> 31;
        return value;
    }

    static bool exactMatch(const Slot &slot, const Key &key, uint64_t tag)
    {
        return slot.generation == storage.generation
            && slot.tag == tag
            && slot.key == key;
    }

    static void writeSlot(Slot &slot, const Key &key, uint64_t tag)
    {
        slot.key = key;
        slot.tag = tag;
        slot.generation = storage.generation;
    }

public:
    using const_iterator = const Key *;

    VcfSingleFourWayTransTableV5()
    {
        // LegacyTransTable 仍保留依 ply 建立容器的外形。第一個容器開始新搜尋，
        // 後續 ply 容器鎖定同一個 session，因此共用 generation 與完整盤面表。
        session = currentSession.lock();
        if (!session) {
            session = make_shared<Session>();
            currentSession = session;
            storage.beginSearch();
        }
    }

    void max_load_factor(float) {}
    void reserve(size_t) {}
    bool empty() const { return false; }
    const_iterator end() const { return nullptr; }

    const_iterator find(const Key &key) const
    {
        const uint64_t hash = mixHash(key.hash);
        const uint64_t tag = hash | 1ULL;
        const size_t base = (size_t(hash) & BUCKET_MASK) * WAY_COUNT;

        for (size_t way = 0; way < WAY_COUNT; way++) {
            const Slot &slot = storage.slots[base + way];
            if (exactMatch(slot, key, tag))
                return &slot.key;
        }
        return nullptr;
    }

    void insert(const Key &key)
    {
        const uint64_t hash = mixHash(key.hash);
        const uint64_t tag = hash | 1ULL;
        const size_t base = (size_t(hash) & BUCKET_MASK) * WAY_COUNT;

        for (size_t way = 0; way < WAY_COUNT; way++) {
            Slot &slot = storage.slots[base + way];
            if (exactMatch(slot, key, tag))
                return;
            if (slot.generation != storage.generation) {
                writeSlot(slot, key, tag);
                return;
            }
        }

        const size_t victim = size_t(storage.replacementCounter++ & 3ULL);
        writeSlot(storage.slots[base + victim], key, tag);
    }
};

} // namespace std
