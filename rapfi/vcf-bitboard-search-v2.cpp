// VCF 搜尋以舊版 Evaluator 的 findVCF 流程為主；
// 熱路徑維護 572 個五格視窗的增量狀態，每手只更新相關視窗。
// 另外使用 generation stamp、固定候選順序表與固定容量扁平置換表，
// 候選、防點、排序優先級與路線輸出語意維持舊版流程。
//
// 原候選函式保留為 scanCandidatesLegacy，供差異測試與回歸比較。
#include "vcf-bitboard-search-fast-part1.inc"
#define scanCandidates scanCandidatesLegacy
#include "vcf-bitboard-search-fast-part2.inc"
#include "vcf-bitboard-search-opt-part3.inc"
#include "vcf-bitboard-search-fast-part4.inc"
