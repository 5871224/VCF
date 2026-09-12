#include <algorithm>
#include <array>
#include <cstdint>
#include <cstring>
#include <string>
#include <utility>
#include <vector>

namespace {
constexpr int BOARD_SIZE = 15;
constexpr int BOARD_CELLS = 225;

struct Record {
    uint64_t hash = 0;
    uint32_t keyOffset = 0;
    uint16_t keyLength = 0;
    uint32_t textOffset = 0;
    uint32_t textLength = 0;
};

std::vector<uint8_t> g_raw;
std::vector<Record> g_records;
std::vector<int32_t> g_slots;
std::vector<uint8_t> g_queryKey;
int32_t g_match = -1;
int32_t g_error = 0;

uint16_t read16(const uint8_t* p) {
    return static_cast<uint16_t>(p[0]) | (static_cast<uint16_t>(p[1]) << 8);
}

uint32_t read32(const uint8_t* p) {
    return static_cast<uint32_t>(p[0])
        | (static_cast<uint32_t>(p[1]) << 8)
        | (static_cast<uint32_t>(p[2]) << 16)
        | (static_cast<uint32_t>(p[3]) << 24);
}

uint64_t hashKey(const uint8_t* data, size_t length) {
    uint64_t h = 1469598103934665603ull;
    for (size_t i = 0; i < length; ++i) {
        h ^= data[i];
        h *= 1099511628211ull;
    }
    return h ? h : 1ull;
}

bool decodeLz4Block(const uint8_t* src, size_t length, std::vector<uint8_t>& out) {
    size_t ip = 0;
    while (ip < length) {
        const uint8_t token = src[ip++];
        size_t literalLength = token >> 4;
        if (literalLength == 15) {
            uint8_t s = 255;
            while (s == 255) {
                if (ip >= length) return false;
                s = src[ip++];
                literalLength += s;
            }
        }
        if (ip + literalLength > length) return false;
        out.insert(out.end(), src + ip, src + ip + literalLength);
        ip += literalLength;
        if (ip == length) return true;
        if (ip + 2 > length) return false;
        const uint16_t offset = read16(src + ip);
        ip += 2;
        if (offset == 0 || offset > out.size()) return false;

        size_t matchLength = (token & 0x0f) + 4;
        if ((token & 0x0f) == 15) {
            uint8_t s = 255;
            while (s == 255) {
                if (ip >= length) return false;
                s = src[ip++];
                matchLength += s;
            }
        }
        const size_t start = out.size() - offset;
        for (size_t i = 0; i < matchLength; ++i) {
            out.push_back(out[start + i]);
        }
    }
    return true;
}

bool decodeFrame(const uint8_t* data, size_t length, std::vector<uint8_t>& out) {
    if (!data || length < 11) return false;
    if (read32(data) != 0x184D2204u) return false;
    size_t p = 4;
    const uint8_t flg = data[p++];
    const uint8_t bd = data[p++];
    (void)bd;
    if ((flg & 0xC0u) != 0x40u) return false;
    const bool blockChecksum = (flg & 0x10u) != 0;
    const bool contentSize = (flg & 0x08u) != 0;
    const bool contentChecksum = (flg & 0x04u) != 0;
    const bool dictId = (flg & 0x01u) != 0;
    if (contentSize) {
        if (p + 8 > length) return false;
        p += 8;
    }
    if (dictId) {
        if (p + 4 > length) return false;
        p += 4;
    }
    if (p >= length) return false;
    ++p; // header checksum

    out.clear();
    while (true) {
        if (p + 4 > length) return false;
        uint32_t blockSize = read32(data + p);
        p += 4;
        if (blockSize == 0) break;
        const bool uncompressed = (blockSize & 0x80000000u) != 0;
        blockSize &= 0x7fffffffu;
        if (p + blockSize > length) return false;
        if (uncompressed) {
            out.insert(out.end(), data + p, data + p + blockSize);
        } else {
            std::vector<uint8_t> block;
            block.reserve(64 * 1024);
            if (!decodeLz4Block(data + p, blockSize, block)) return false;
            out.insert(out.end(), block.begin(), block.end());
        }
        p += blockSize;
        if (blockChecksum) {
            if (p + 4 > length) return false;
            p += 4;
        }
    }
    if (contentChecksum) {
        if (p + 4 > length) return false;
        p += 4;
    }
    return p <= length;
}

bool sameKey(const Record& record, const uint8_t* key, size_t keyLength) {
    return record.keyLength == keyLength
        && record.keyOffset + record.keyLength <= g_raw.size()
        && std::memcmp(g_raw.data() + record.keyOffset, key, keyLength) == 0;
}

void buildIndex() {
    size_t slots = 8;
    while (slots < g_records.size() * 2 + 1) slots <<= 1;
    g_slots.assign(slots, -1);
    const size_t mask = slots - 1;
    for (size_t i = 0; i < g_records.size(); ++i) {
        size_t pos = static_cast<size_t>(g_records[i].hash) & mask;
        while (g_slots[pos] >= 0) pos = (pos + 1) & mask;
        g_slots[pos] = static_cast<int32_t>(i);
    }
}

bool parseRaw() {
    g_records.clear();
    g_slots.clear();
    g_match = -1;
    if (g_raw.size() < 4) return false;
    const uint32_t total = read32(g_raw.data());
    size_t p = 4;
    if (total == 0 || total > 100000000u) return false;

    for (uint32_t i = 0; i < total; ++i) {
        if (p + 2 > g_raw.size()) return false;
        const uint16_t keyLength = read16(g_raw.data() + p);
        p += 2;
        if (p + keyLength + 2 > g_raw.size()) return false;
        const uint32_t keyOffset = static_cast<uint32_t>(p);
        p += keyLength;
        const uint16_t valueLength = read16(g_raw.data() + p);
        p += 2;
        if (p + valueLength > g_raw.size()) return false;
        const uint32_t valueOffset = static_cast<uint32_t>(p);

        const bool metadata = (i == 0 && keyLength == 3
            && g_raw[keyOffset] == 0 && g_raw[keyOffset + 1] == 0 && g_raw[keyOffset + 2] == 0);
        if (!metadata) {
            if (valueLength < 5) return false;
            Record record;
            record.keyOffset = keyOffset;
            record.keyLength = keyLength;
            record.textOffset = valueOffset + 5;
            record.textLength = valueLength - 5;
            record.hash = hashKey(g_raw.data() + keyOffset, keyLength);
            g_records.push_back(record);
        }
        p += valueLength;
    }
    if (p != g_raw.size()) return false;
    buildIndex();
    return true;
}

int lookupKey(const uint8_t* key, size_t keyLength) {
    g_match = -1;
    if (!key || keyLength == 0 || g_slots.empty()) return 0;
    const uint64_t hash = hashKey(key, keyLength);
    const size_t mask = g_slots.size() - 1;
    size_t pos = static_cast<size_t>(hash) & mask;
    for (size_t probes = 0; probes < g_slots.size(); ++probes) {
        const int32_t index = g_slots[pos];
        if (index < 0) return 0;
        const Record& record = g_records[static_cast<size_t>(index)];
        if (record.hash == hash && sameKey(record, key, keyLength)) {
            g_match = index;
            return 1;
        }
        pos = (pos + 1) & mask;
    }
    return 0;
}

std::pair<int, int> transformXY(int x, int y, int transform) {
    const int m = BOARD_SIZE - 1;
    switch (transform) {
        case 0: return {x, y};
        case 1: return {m - y, x};
        case 2: return {m - x, m - y};
        case 3: return {y, m - x};
        case 4: return {m - x, y};
        case 5: return {m - y, m - x};
        case 6: return {x, m - y};
        case 7: return {y, x};
        default: return {x, y};
    }
}

std::vector<uint8_t> makeKey(const uint8_t* board, uint8_t rule, int transform) {
    std::vector<std::pair<int, int>> black;
    std::vector<std::pair<int, int>> white;
    black.reserve(113);
    white.reserve(112);
    for (int i = 0; i < BOARD_CELLS; ++i) {
        const uint8_t stone = board[i];
        if (stone != 1 && stone != 2) continue;
        const auto xy = transformXY(i % BOARD_SIZE, i / BOARD_SIZE, transform);
        (stone == 1 ? black : white).push_back(xy);
    }
    auto cmp = [](const auto& a, const auto& b) {
        return a.first != b.first ? a.first < b.first : a.second < b.second;
    };
    std::sort(black.begin(), black.end(), cmp);
    std::sort(white.begin(), white.end(), cmp);
    std::vector<uint8_t> key;
    key.reserve(3 + (black.size() + white.size()) * 2);
    key.push_back(rule);
    key.push_back(BOARD_SIZE);
    key.push_back(BOARD_SIZE);
    for (const auto& xy : black) { key.push_back(static_cast<uint8_t>(xy.first)); key.push_back(static_cast<uint8_t>(xy.second)); }
    for (const auto& xy : white) { key.push_back(static_cast<uint8_t>(xy.first)); key.push_back(static_cast<uint8_t>(xy.second)); }
    return key;
}

bool keyLess(const std::vector<uint8_t>& a, const std::vector<uint8_t>& b) {
    return std::lexicographical_compare(a.begin(), a.end(), b.begin(), b.end());
}

std::vector<uint8_t> canonicalKey(const uint8_t* board, uint8_t rule) {
    std::vector<uint8_t> best = makeKey(board, rule, 0);
    for (int transform = 1; transform < 8; ++transform) {
        auto candidate = makeKey(board, rule, transform);
        if (keyLess(candidate, best)) best.swap(candidate);
    }
    return best;
}
}

extern "C" {
int vcfYxdbLoadFrame(const uint8_t* data, int length) {
    g_error = 0;
    g_match = -1;
    g_queryKey.clear();
    if (!data || length <= 0) { g_error = -1; return -1; }
    if (!decodeFrame(data, static_cast<size_t>(length), g_raw)) { g_error = -2; return -2; }
    if (!parseRaw()) { g_error = -3; return -3; }
    return static_cast<int>(g_records.size());
}

int vcfYxdbQueryKey(const uint8_t* key, int keyLength) {
    if (!key || keyLength <= 0) return 0;
    return lookupKey(key, static_cast<size_t>(keyLength));
}

int vcfYxdbQueryBoard(const uint8_t* board, int rule) {
    if (!board || rule < 0 || rule > 255) return 0;
    g_queryKey = canonicalKey(board, static_cast<uint8_t>(rule));
    return lookupKey(g_queryKey.data(), g_queryKey.size());
}

const uint8_t* vcfYxdbResultTextPtr() {
    if (g_match < 0 || static_cast<size_t>(g_match) >= g_records.size()) return nullptr;
    const Record& record = g_records[static_cast<size_t>(g_match)];
    return g_raw.data() + record.textOffset;
}

int vcfYxdbResultTextLength() {
    if (g_match < 0 || static_cast<size_t>(g_match) >= g_records.size()) return 0;
    return static_cast<int>(g_records[static_cast<size_t>(g_match)].textLength);
}

const uint8_t* vcfYxdbQueryKeyPtr() { return g_queryKey.empty() ? nullptr : g_queryKey.data(); }
int vcfYxdbQueryKeyLength() { return static_cast<int>(g_queryKey.size()); }
int vcfYxdbRecordCount() { return static_cast<int>(g_records.size()); }
int vcfYxdbRawSize() { return static_cast<int>(g_raw.size()); }
int vcfYxdbIndexSlots() { return static_cast<int>(g_slots.size()); }
int vcfYxdbLastError() { return g_error; }
}

#ifdef VCF_YXDB_INDEX_TEST_MAIN
#include <cassert>
#include <iostream>

static void put16(std::vector<uint8_t>& out, uint16_t v) { out.push_back(v & 255); out.push_back((v >> 8) & 255); }
static void put32(std::vector<uint8_t>& out, uint32_t v) { out.push_back(v & 255); out.push_back((v >> 8) & 255); out.push_back((v >> 16) & 255); out.push_back((v >> 24) & 255); }

int main() {
    std::array<uint8_t, BOARD_CELLS> board{};
    board[112] = 1;
    auto key = canonicalKey(board.data(), 2);
    std::vector<uint8_t> raw;
    put32(raw, 2);
    put16(raw, 3); raw.insert(raw.end(), {0,0,0}); put16(raw, 5); raw.insert(raw.end(), {0,0,0,0,0});
    put16(raw, static_cast<uint16_t>(key.size())); raw.insert(raw.end(), key.begin(), key.end());
    const std::string text = "center";
    put16(raw, static_cast<uint16_t>(5 + text.size())); raw.insert(raw.end(), {255,0,0,0,0}); raw.insert(raw.end(), text.begin(), text.end());

    std::vector<uint8_t> frame = {0x04,0x22,0x4d,0x18,0x60,0x40,0};
    put32(frame, 0x80000000u | static_cast<uint32_t>(raw.size()));
    frame.insert(frame.end(), raw.begin(), raw.end());
    put32(frame, 0);
    assert(vcfYxdbLoadFrame(frame.data(), static_cast<int>(frame.size())) == 1);
    assert(vcfYxdbQueryBoard(board.data(), 2) == 1);
    assert(vcfYxdbResultTextLength() == static_cast<int>(text.size()));
    assert(std::memcmp(vcfYxdbResultTextPtr(), text.data(), text.size()) == 0);
    std::cout << "vcf-yxdb-index self-test passed\n";
    return 0;
}
#endif
