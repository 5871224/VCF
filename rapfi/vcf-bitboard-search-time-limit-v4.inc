// 新版多組 VCF 的時間／節點限制。
//
// 呼叫端可把兩種限制封裝在既有 maxNodes 參數，避免破壞 V3 ABI：
// - bit 31：封裝標記。
// - bit 0..9：節點上限，單位為一百萬；0 表示不限制。
// - bit 10..30：時間上限，單位為秒；0 表示不限制。
//
// 時間只在每 524,288 個節點檢查一次，避免在熱路徑頻繁讀取時鐘。

namespace {

constexpr uint32_t MULTI_LIMIT_PACKED_FLAG_V4 = 0x80000000u;
constexpr uint32_t MULTI_LIMIT_NODE_MASK_V4 = 0x000003ffu;
constexpr uint32_t MULTI_LIMIT_TIME_MASK_V4 = 0x001fffffu;
constexpr uint32_t MULTI_TIME_CHECK_MASK_V4 = (uint32_t(1) << 19) - 1;

enum MultiStopReasonV4 : uint8_t {
    MULTI_STOP_COMPLETE_V4 = 0,
    MULTI_STOP_TIME_V4 = 2,
    MULTI_STOP_NODES_V4 = 3,
};

struct MultiDecodedLimitsV4 {
    uint32_t maxNodes = 5000000;
    uint32_t maxTimeSeconds = 0;
};

thread_local double multiDeadlineMsV4 = 0.0;

MultiDecodedLimitsV4 decodeMultiLimitsV4(uint32_t encoded)
{
    MultiDecodedLimitsV4 limits;
    if ((encoded & MULTI_LIMIT_PACKED_FLAG_V4) == 0) {
        limits.maxNodes = std::max<uint32_t>(1, encoded);
        limits.maxTimeSeconds = 0;
        return limits;
    }

    const uint32_t nodeMillions = encoded & MULTI_LIMIT_NODE_MASK_V4;
    limits.maxTimeSeconds = (encoded >> 10) & MULTI_LIMIT_TIME_MASK_V4;
    limits.maxNodes = nodeMillions == 0
        ? std::numeric_limits<uint32_t>::max()
        : nodeMillions * 1000000u;
    return limits;
}

uint32_t configureMultiLimitsV4(uint32_t encoded)
{
    const MultiDecodedLimitsV4 limits = decodeMultiLimitsV4(encoded);
    multiDeadlineMsV4 = limits.maxTimeSeconds == 0
        ? 0.0
        : legacyNowMs() + double(limits.maxTimeSeconds) * 1000.0;
    return limits.maxNodes;
}

struct TimedSearchContextV4 : SearchContext {
    uint8_t stopReason = MULTI_STOP_COMPLETE_V4;

    bool touch(int ply)
    {
        maxPlySeen = std::max(maxPlySeen, ply);
        if (nodes >= maxNodes || ply > maxDepth) {
            aborted = true;
            if (nodes >= maxNodes)
                stopReason = MULTI_STOP_NODES_V4;
            return false;
        }

        nodes++;
        if (multiDeadlineMsV4 > 0.0
            && (nodes & MULTI_TIME_CHECK_MASK_V4) == 0
            && legacyNowMs() >= multiDeadlineMsV4) {
            aborted = true;
            stopReason = MULTI_STOP_TIME_V4;
            return false;
        }
        return true;
    }
};

void writeStatsMultiV4(SearchStats *out,
                       const TimedSearchContextV4 &ctx,
                       double start,
                       int routes,
                       int candidates,
                       bool forcedAbort = false)
{
    if (!out)
        return;
    *out = SearchStats {};
    out->nodes = ctx.nodes;
    out->elapsedMicros = uint32_t(std::max(0.0, (legacyNowMs() - start) * 1000.0));
    out->routeCount = uint16_t(std::clamp(routes, 0, 65535));
    out->candidateCount = uint16_t(std::clamp(candidates, 0, 65535));
    out->maxPly = uint16_t(std::clamp(ctx.maxPlySeen, 0, 65535));
    out->aborted = (ctx.aborted || forcedAbort) ? 1 : 0;
    out->reserved = ctx.stopReason;
}

int multiTimeLimitV4SelfTest()
{
    const uint32_t packed = MULTI_LIMIT_PACKED_FLAG_V4 | (30u << 10) | 20u;
    const MultiDecodedLimitsV4 decoded = decodeMultiLimitsV4(packed);
    if (decoded.maxNodes != 20000000u || decoded.maxTimeSeconds != 30u)
        return 301;

    const MultiDecodedLimitsV4 unlimited = decodeMultiLimitsV4(MULTI_LIMIT_PACKED_FLAG_V4);
    if (unlimited.maxNodes != std::numeric_limits<uint32_t>::max()
        || unlimited.maxTimeSeconds != 0)
        return 302;
    return 0;
}

} // namespace
