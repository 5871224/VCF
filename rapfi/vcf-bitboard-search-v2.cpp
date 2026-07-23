// VCF 搜尋以舊版 Evaluator 的 findVCF 流程為主；
// 熱路徑另外維護 572 個五格視窗的增量狀態：
// 每手只更新最多 20 個相關視窗，搜尋時只列舉有效的三／四／五子視窗。
// 單組搜尋使用 256K 四路組相連精確同型表；多組 V3 使用自己的精確同型表，
// 再依模式選擇嚴格完全同盤剪枝或高速勝型子集剪枝。
//
// 分檔僅為方便維護；inc 依序組成同一個翻譯單元。
#include "vcf-bitboard-search-single-tt-v5.inc"
#define unordered_set VcfSingleFourWayTransTableV5
#include "vcf-bitboard-search-fast-part1.inc"
#include "vcf-bitboard-search-fast-part2.inc"
#include "vcf-bitboard-search-fast-part3.inc"
#undef unordered_set

int singleFourWayTransTableV5SelfTest()
{
    using TestTable = std::VcfSingleFourWayTransTableV5<CompactPosition, CompactPositionHasher>;

    CompactPosition base {};
    base.black[0] = 1ULL << 5;
    base.white[1] = 1ULL << 7;
    base.hash = 0x123456789abcdef0ULL;

    CompactPosition sameHashDifferentBoard = base;
    sameHashDifferentBoard.white[1] ^= 1ULL << 9;

    {
        // 不同 Legacy ply bucket 必須共用同一張完整盤面表。
        TestTable shallowBucket;
        TestTable deepBucket;
        shallowBucket.insert(base);
        if (deepBucket.find(base) == deepBucket.end())
            return 1;
        if (deepBucket.find(sameHashDifferentBoard) != deepBucket.end())
            return 2;
    }

    {
        // 新搜尋只切換 generation，不得命中上一輪資料。
        TestTable nextSearch;
        if (nextSearch.find(base) != nextSearch.end())
            return 3;
    }

    return 0;
}

// 保留舊 V3 實作供對照，但正式匯出由 multi-v3 接管。
#define vcfBbFindModeV3 vcfBbFindModeV3Legacy
#define vcfBbScanPointsModeV3 vcfBbScanPointsModeV3Legacy
#define vcfBbSearchV2SelfTest vcfBbSearchV2SelfTestLegacy
#include "vcf-bitboard-search-fast-part4.inc"
#undef vcfBbFindModeV3
#undef vcfBbScanPointsModeV3
#undef vcfBbSearchV2SelfTest

// 新版多組搜尋使用獨立的直接對映精確表與時間限制 context；
// 不會改寫單組四路同型表、第一組立即返回或單組 DFS 熱路徑。
#include "vcf-bitboard-search-exact-tt-v3.inc"
#include "vcf-bitboard-search-time-limit-v4.inc"
#define LegacyTransTable ExactPositionTransTableV3
#define SearchContext TimedSearchContextV4
#define writeStats writeStatsMultiV4
#define vcfBbFindModeV3 vcfBbFindModeV3MultiInternal
#define vcfBbScanPointsModeV3 vcfBbScanPointsModeV3MultiInternal
#define vcfBbSearchV2SelfTest vcfBbSearchV2SelfTestMultiV3
#include "vcf-bitboard-search-multi-v3.inc"
#undef vcfBbSearchV2SelfTest
#undef vcfBbScanPointsModeV3
#undef vcfBbFindModeV3
#undef writeStats
#undef SearchContext
#undef LegacyTransTable

extern "C" VCF_LEGACY_SEARCH_KEEPALIVE int vcfBbFindModeV3(const uint8_t *board,
                                                               int attacker,
                                                               int rule,
                                                               int mode,
                                                               int simplify,
                                                               int pruning,
                                                               int maxRoutes,
                                                               int maxDepth,
                                                               uint32_t encodedLimits,
                                                               uint8_t *outMoves,
                                                               uint16_t *outLengths,
                                                               int maxMovesPerRoute,
                                                               SearchStats *stats)
{
    const uint32_t maxNodes = configureMultiLimitsV4(encodedLimits);
    return vcfBbFindModeV3MultiInternal(board, attacker, rule, mode, simplify, pruning,
                                        maxRoutes, maxDepth, maxNodes, outMoves, outLengths,
                                        maxMovesPerRoute, stats);
}

extern "C" VCF_LEGACY_SEARCH_KEEPALIVE int vcfBbScanPointsModeV3(const uint8_t *board,
                                                                     int attacker,
                                                                     int placeColor,
                                                                     int rule,
                                                                     int mode,
                                                                     int simplify,
                                                                     int pruning,
                                                                     const uint16_t *indices,
                                                                     int indexCount,
                                                                     int maxDepth,
                                                                     uint32_t encodedLimits,
                                                                     uint16_t *outIndices,
                                                                     uint16_t *outLabels,
                                                                     int maxResults,
                                                                     SearchStats *stats)
{
    const uint32_t maxNodes = configureMultiLimitsV4(encodedLimits);
    return vcfBbScanPointsModeV3MultiInternal(board, attacker, placeColor, rule, mode,
                                               simplify, pruning, indices, indexCount,
                                               maxDepth, maxNodes, outIndices, outLabels,
                                               maxResults, stats);
}

extern "C" VCF_LEGACY_SEARCH_KEEPALIVE int vcfBbSearchV2SelfTest()
{
    const int singleTtResult = singleFourWayTransTableV5SelfTest();
    if (singleTtResult != 0)
        return 100 + singleTtResult;
    const int multiResult = vcfBbSearchV2SelfTestMultiV3();
    if (multiResult != 0)
        return multiResult;
    const int exactResult = exactPositionTransTableV3SelfTest();
    if (exactResult != 0)
        return exactResult;
    return multiTimeLimitV4SelfTest();
}
