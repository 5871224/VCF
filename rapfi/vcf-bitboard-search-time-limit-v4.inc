// 新版多組 VCF 的時間／節點限制與節點內活四支配選項。
//
// 呼叫端可把限制與選項封裝在既有 maxNodes 參數，避免破壞 V3 ABI：
// - bit 31：封裝標記。
// - bit 30：活四不搜後續；該盤面若有直接五或活四，只搜尋這些終局候選。
// - bit 0..9：節點上限，單位為一百萬；0 表示不限制。
// - bit 10..29：時間上限，單位為秒；0 表示不限制。
//
// 時間只在每 524,288 個節點檢查一次，避免在熱路徑頻繁讀取時鐘。

namespace {

constexpr uint32_t MULTI_LIMIT_PACKED_FLAG_V4 = 0x80000000u;
constexpr uint32_t MULTI_STOP_AFTER_OPEN_FOUR_FLAG_V4 = 0x40000000u;
constexpr uint32_t MULTI_LIMIT_NODE_MASK_V4 = 0x000003ffu;
constexpr uint32_t MULTI_LIMIT_TIME_MASK_V4 = 0x000fffffu;
constexpr uint32_t MULTI_TIME_CHECK_MASK_V4 = (uint32_t(1) << 19) - 1;

enum MultiStopReasonV4 : uint8_t {
    MULTI_STOP_COMPLETE_V4 = 0,
    MULTI_STOP_TIME_V4 = 2,
    MULTI_STOP_NODES_V4 = 3,
};

struct MultiDecodedLimitsV4 {
    uint32_t maxNodes = 5000000;
    uint32_t maxTimeSeconds = 0;
    bool stopAfterOpenFour = false;
};

thread_local double multiDeadlineMsV4 = 0.0;
thread_local bool multiStopAfterOpenFourV4 = false;

MultiDecodedLimitsV4 decodeMultiLimitsV4(uint32_t encoded)
{
    MultiDecodedLimitsV4 limits;
    if ((encoded & MULTI_LIMIT_PACKED_FLAG_V4) == 0) {
        limits.maxNodes = std::max<uint32_t>(1, encoded);
        limits.maxTimeSeconds = 0;
        limits.stopAfterOpenFour = false;
        return limits;
    }

    const uint32_t nodeMillions = encoded & MULTI_LIMIT_NODE_MASK_V4;
    limits.maxTimeSeconds = (encoded >> 10) & MULTI_LIMIT_TIME_MASK_V4;
    limits.maxNodes = nodeMillions == 0
        ? std::numeric_limits<uint32_t>::max()
        : nodeMillions * 1000000u;
    limits.stopAfterOpenFour = (encoded & MULTI_STOP_AFTER_OPEN_FOUR_FLAG_V4) != 0;
    return limits;
}

uint32_t configureMultiLimitsV4(uint32_t encoded)
{
    const MultiDecodedLimitsV4 limits = decodeMultiLimitsV4(encoded);
    multiDeadlineMsV4 = limits.maxTimeSeconds == 0
        ? 0.0
        : legacyNowMs() + double(limits.maxTimeSeconds) * 1000.0;
    multiStopAfterOpenFourV4 = limits.stopAfterOpenFour;
    return limits.maxNodes;
}

void applyOpenFourDominanceV4(CandidateList &candidates)
{
    if (!multiStopAfterOpenFourV4)
        return;

    // scanCandidates 已固定把直接五、活四排在其他單防死四之前。
    // 只要有任一終局候選，就保留全部終局候選，捨棄後續較弱分支。
    int terminalCount = 0;
    while (terminalCount < candidates.count) {
        const Candidate &candidate = candidates.items[terminalCount];
        if (!candidate.immediate && candidate.defenseCount < 2)
            break;
        terminalCount++;
    }
    if (terminalCount > 0)
        candidates.count = terminalCount;
}

void scanCandidatesWithOpenFourStopV4(Position &position,
                                      int attacker,
                                      int rule,
                                      int forcedPoint,
                                      int center,
                                      CandidateBuildScratch &scratch,
                                      CandidateList &candidates)
{
    scanCandidates(position, attacker, rule, forcedPoint, center, scratch, candidates);
    applyOpenFourDominanceV4(candidates);
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
    const uint32_t packed = MULTI_LIMIT_PACKED_FLAG_V4
        | MULTI_STOP_AFTER_OPEN_FOUR_FLAG_V4
        | (30u << 10)
        | 20u;
    const MultiDecodedLimitsV4 decoded = decodeMultiLimitsV4(packed);
    if (decoded.maxNodes != 20000000u || decoded.maxTimeSeconds != 30u
        || !decoded.stopAfterOpenFour)
        return 301;

    const MultiDecodedLimitsV4 unlimited = decodeMultiLimitsV4(MULTI_LIMIT_PACKED_FLAG_V4);
    if (unlimited.maxNodes != std::numeric_limits<uint32_t>::max()
        || unlimited.maxTimeSeconds != 0 || unlimited.stopAfterOpenFour)
        return 302;

    CandidateList candidates;
    candidates.count = 3;
    candidates.items[0].immediate = true;
    candidates.items[1].defenseCount = 2;
    candidates.items[2].defenseCount = 1;
    multiStopAfterOpenFourV4 = true;
    applyOpenFourDominanceV4(candidates);
    if (candidates.count != 2)
        return 303;

    CandidateList disabled;
    disabled.count = 3;
    disabled.items[0].immediate = true;
    disabled.items[1].defenseCount = 2;
    disabled.items[2].defenseCount = 1;
    multiStopAfterOpenFourV4 = false;
    applyOpenFourDominanceV4(disabled);
    if (disabled.count != 3)
        return 304;

    return 0;
}

} // namespace