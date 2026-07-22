// VCF 搜尋以舊版 Evaluator 的 findVCF 流程為主：
// 1. 固定五格視窗一次掃描全部衝四候選。
// 2. 非根節點只分析最後一手防守造成的反四。
// 3. 使用黑白 Bitboard 同層局面置換表與舊版候選分組順序。
//
// 分檔僅為方便維護；三個 inc 依序組成同一個翻譯單元。
#include "vcf-bitboard-search-legacy-part1.inc"
#include "vcf-bitboard-search-legacy-part2.inc"
#include "vcf-bitboard-search-legacy-part3.inc"
