// VCF 搜尋以舊版 Evaluator 的 findVCF 流程為主；
// 熱路徑維護 572 個五格視窗的增量狀態，每手只更新相關視窗。
// 另外使用 generation stamp、固定候選順序表與固定容量扁平置換表。
// 正式單路搜尋恢復共享根置換表；獨立根只保留給 V4 實驗 API 與 CI。
//
// 原候選與獨立根搜尋保留為 Legacy／實驗版本，供差異測試與回退。
#include "vcf-bitboard-search-fast-part1.inc"
#define scanCandidates scanCandidatesLegacy
#include "vcf-bitboard-search-fast-part2.inc"
#define runAtDepth runAtDepthShared
#include "vcf-bitboard-search-opt-part3.inc"
#define vcfBbSearchV2SelfTest vcfBbSearchV2SelfTestBase
#include "vcf-bitboard-search-fast-part4.inc"
#undef runAtDepth
#undef vcfBbSearchV2SelfTest
#include "vcf-bitboard-search-root-exports.inc"
#include "vcf-bitboard-search-opt-selftest.inc"
