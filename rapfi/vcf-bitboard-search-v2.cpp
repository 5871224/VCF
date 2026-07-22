// VCF 搜尋以舊版 Evaluator 的 findVCF 流程為主；
// 熱路徑另外維護 572 個五格視窗的增量狀態：
// 每手只更新最多 20 個相關視窗，搜尋時只列舉有效的三／四／五子視窗。
// 候選、防點、排序、置換表與路線輸出語意維持舊版流程。
//
// 分檔僅為方便維護；四個 inc 依序組成同一個翻譯單元。
#include "vcf-bitboard-search-fast-part1.inc"
#include "vcf-bitboard-search-fast-part2.inc"
#include "vcf-bitboard-search-fast-part3.inc"
#include "vcf-bitboard-search-fast-part4.inc"
