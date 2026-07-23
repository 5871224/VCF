// 僅供 benchmark 分支使用：以巨集替換 std::unordered_set，讓原本單組搜尋流程
// 在不改 DFS 邏輯的情況下測試不同固定式精確同型表。
#pragma once

#include <algorithm>
#include <array>
#include <cstddef>
#include <cstdint>
#include <memory>
#include <unordered_set>
#include <vector>

#ifndef VCF_SINGLE_TT_VARIANT
#define VCF_SINGLE_TT_VARIANT 1
#endif

#ifndef VCF_SINGLE_TT_BITS
#define VCF_SINGLE_TT_BITS 17
#endif

namespace std {

template<class Key, class Hash>
class VcfSingleTtBenchmarkSet {
private:
    static constexpr size_t BUCKET_COUNT = size_t(1) << VCF_SINGLE_TT_BITS;
    static constexpr size_t BUCKET_MASK = BUCKET_COUNT - 1;
    static constexpr size_t WAY_COUNT = VCF_SINGLE_TT_VARIANT >= 5
        ? 4
        : (VCF_SINGLE_TT_VARIANT >= 3 ? 2 : 1);

    struct Slot {
        Key key {};
        uint64_t tag = 0;
        uint32_t generation = 0;
        uint16_t plyBucket = 0;
    };

    struct Storage {
        vector<Slot> slots;
        uint32_t generation = 0;
        uint64_t replacementCounter = 0;

        Storage() : slots(BUCKET_COUNT * WAY_COUNT) {}

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

    struct Session {
        uint16_t nextBucket = 0;
    };

    inline static Storage storage {};
    inline static weak_ptr<Session> currentSession {};

    shared_ptr<Session> session;
    uint16_t plyBucket = 0;

    static uint64_t mixHash(uint64_t value)
    {
        value ^= value >> 30;
        value *= 0xbf58476d1ce4e5b9ULL;
        value ^= value >> 27;
        value *= 0x94d049bb133111ebULL;
        value ^= value >> 31;
        return value;
    }

    static uint64_t selectedHash(const Key &key)
    {
#if VCF_SINGLE_TT_VARIANT == 2
        return key.hash;
#else
        return mixHash(key.hash);
#endif
    }

    static bool exactMatch(const Slot &slot, const Key &key, uint64_t tag)
    {
        return slot.generation == storage.generation
            && slot.tag == tag
            && slot.key == key;
    }

    static void writeSlot(Slot &slot, const Key &key, uint64_t tag, uint16_t bucket)
    {
        slot.key = key;
        slot.tag = tag;
        slot.plyBucket = bucket;
        slot.generation = storage.generation;
    }

public:
    using const_iterator = const Key *;

    VcfSingleTtBenchmarkSet()
    {
        session = currentSession.lock();
        if (!session) {
            session = make_shared<Session>();
            currentSession = session;
            storage.beginSearch();
        }
        plyBucket = session->nextBucket++;
    }

    void max_load_factor(float) {}
    void reserve(size_t) {}
    bool empty() const { return false; }
    const_iterator end() const { return nullptr; }

    const_iterator find(const Key &key) const
    {
        const uint64_t hash = selectedHash(key);
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
        const uint64_t hash = selectedHash(key);
        const uint64_t tag = hash | 1ULL;
        const size_t base = (size_t(hash) & BUCKET_MASK) * WAY_COUNT;

        for (size_t way = 0; way < WAY_COUNT; way++) {
            Slot &slot = storage.slots[base + way];
            if (exactMatch(slot, key, tag))
                return;
            if (slot.generation != storage.generation) {
                writeSlot(slot, key, tag, plyBucket);
                return;
            }
        }

#if VCF_SINGLE_TT_VARIANT == 6
        // 四路：第 0 格優先保留較淺局面，其餘三格循環保存近期局面。
        Slot &depthSlot = storage.slots[base];
        if (plyBucket < depthSlot.plyBucket)
            writeSlot(depthSlot, key, tag, plyBucket);
        else {
            const size_t victim = 1 + size_t(storage.replacementCounter++ % 3ULL);
            writeSlot(storage.slots[base + victim], key, tag, plyBucket);
        }
#elif VCF_SINGLE_TT_VARIANT == 5
        // 四路最近替換：四格循環覆蓋。
        const size_t victim = size_t(storage.replacementCounter++ & 3ULL);
        writeSlot(storage.slots[base + victim], key, tag, plyBucket);
#elif VCF_SINGLE_TT_VARIANT == 4
        // 二路：第 0 格偏向保留較淺局面，第 1 格保存最新局面。
        Slot &depthSlot = storage.slots[base];
        if (plyBucket < depthSlot.plyBucket)
            writeSlot(depthSlot, key, tag, plyBucket);
        else
            writeSlot(storage.slots[base + 1], key, tag, plyBucket);
#elif VCF_SINGLE_TT_VARIANT == 3
        // 二路最近替換：輪流覆蓋，避免同一格持續抖動。
        const size_t victim = size_t(storage.replacementCounter++ & 1ULL);
        writeSlot(storage.slots[base + victim], key, tag, plyBucket);
#else
        writeSlot(storage.slots[base], key, tag, plyBucket);
#endif
    }
};

} // namespace std
