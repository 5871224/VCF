// VCF 搜尋以舊版 Evaluator 的 findVCF 流程為主；
// 熱路徑另外維護 572 個五格視窗的增量狀態：
// 每手只更新最多 20 個相關視窗，搜尋時只列舉有效的三／四／五子視窗。
// 單組搜尋維持目前最快版本；多組 V3 使用專用精確同型表，
// 再依模式選擇嚴格完全同盤剪枝或高速勝型子集剪枝。
//
// 分檔僅為方便維護；inc 依序組成同一個翻譯單元。
#include "vcf-bitboard-search-fast-part1.inc"
#include "vcf-bitboard-search-fast-part2.inc"
#include "vcf-bitboard-search-fast-part3.inc"

// 保留舊 V3 實作供對照，但正式匯出由 multi-v3 接管。
#define vcfBbFindModeV3 vcfBbFindModeV3Legacy
#define vcfBbScanPointsModeV3 vcfBbScanPointsModeV3Legacy
#define vcfBbSearchV2SelfTest vcfBbSearchV2SelfTestLegacy
#include "vcf-bitboard-search-fast-part4.inc"
#undef vcfBbFindModeV3
#undef vcfBbScanPointsModeV3
#undef vcfBbSearchV2SelfTest

// 新版多組搜尋不再沿用依 ply 分桶的 unordered_set。
// 透過區域巨集只替換 multi-v3 使用的同型表，單組熱路徑完全不變。
#include "vcf-bitboard-exact-tt-v3.inc"
#define LegacyTransTable ExactPositionTransTableV3
#define vcfBbSearchV2SelfTest vcfBbSearchV2SelfTestMultiV3
#include "vcf-bitboard-search-multi-v3.inc"
#undef vcfBbSearchV2SelfTest
#undef LegacyTransTable

extern "C" VCF_LEGACY_SEARCH_KEEPALIVE int vcfBbSearchV2SelfTest()
{
    const int multiResult = vcfBbSearchV2SelfTestMultiV3();
    if (multiResult != 0)
        return multiResult;
    return exactPositionTransTableV3SelfTest();
}
