// 正式建置入口：保留原棋型查表核心，改寫對外禁手判斷流程。
// 第一次四方向棋型結果直接用於正五、長連、四四與疑似三三初篩；
// 只有疑似三三需要複製完整棋盤並驗證活四延伸點。

#ifdef VCF_PATTERN_TEST_MAIN
#define VCF_PATTERN_OPTIMIZED_TEST_MAIN 1
#undef VCF_PATTERN_TEST_MAIN
#endif

#define vcfPatternSelfTest vcfPatternSelfTestLegacy
#define vcfLookupBenchmark vcfLookupBenchmarkLegacy
#define vcfAnalyzePoint vcfAnalyzePointLegacy
#include "vcf-pattern-engine.cpp"
#undef vcfAnalyzePoint
#undef vcfLookupBenchmark
#undef vcfPatternSelfTest

#pragma pack(push, 1)
struct ForbiddenExportResult {
    uint8_t forbidden;
    uint8_t forbiddenType;
    uint8_t realThreeDirections;
    uint8_t reserved;
};
#pragma pack(pop)

static_assert(sizeof(ForbiddenExportResult) == 4, "ForbiddenExportResult must remain a 4-byte ABI");

extern "C" int vcfAnalyzeForbidden(const uint8_t *board,
                                     int idx,
                                     int rule,
                                     int method,
                                     ForbiddenExportResult *out);
extern "C" int vcfAnalyzePoint(const uint8_t *board,
                                int idx,
                                int side,
                                int rule,
                                int method,
                                ExportResult *out);

namespace {

constexpr uint8_t RECURSIVE_LINE_READY = 1U << 7;
constexpr uint8_t RECURSIVE_HAS_FIVE_RUN = 1U << 0;
constexpr uint8_t RECURSIVE_HAS_FIVE_COMPLETION = 1U << 1;

struct RecursiveLineInfo {
    uint16_t openFourMask = 0;
    uint8_t flags = 0;
};

struct RecursivePointInfo {
    std::array<uint16_t, 4> openFourMasks {};
    uint8_t suspectDirectionMask = 0;
};

struct RecursiveDoubleThreeResult {
    bool forbidden = false;
    uint8_t realThreeDirections = 0;
};

std::array<RecursiveLineInfo, TERNARY_KEY_COUNT> RECURSIVE_LINE_TABLE {};

bool resolveSimpleForbidden(const PointResult &analysis, ForbiddenResult &result)
{
    if (analysis.pattern4 != FORBID) {
        result = {
            false,
            analysis.pattern4 == A_FIVE ? FORBID_LEGAL_FIVE : FORBID_LEGAL,
            0,
        };
        return true;
    }
    if (analysis.actualOverlineMask) {
        result = {true, FORBID_OVERLINE, 0};
        return true;
    }
    if (analysis.sameLineDoubleFourMask) {
        result = {true, FORBID_DOUBLE_FOUR, 0};
        return true;
    }

    int fourCount = 0;
    for (uint8_t pattern : analysis.directions)
        if (pattern == B4 || pattern == F4)
            fourCount++;
    if (fourCount >= 2) {
        result = {true, FORBID_DOUBLE_FOUR, 0};
        return true;
    }
    return false;
}

int variableBitFromLineIndex(int lineIndex)
{
    return lineIndex < MAX_HALF ? lineIndex : lineIndex - 1;
}

int offsetFromVariableBit(int bit)
{
    return bit < MAX_HALF ? bit - MAX_HALF : bit - MAX_HALF + 1;
}

uint32_t encodeRenjuBlackDirectionKey(const uint8_t *board, int idx, int direction)
{
    const int x0 = idx % BOARD_SIZE;
    const int y0 = idx / BOARD_SIZE;
    uint32_t key = 0;
    int bit = 0;

    for (int offset = -MAX_HALF; offset <= MAX_HALF; offset++) {
        if (offset == 0)
            continue;

        const int x = x0 + DX[direction] * offset;
        const int y = y0 + DY[direction] * offset;
        uint8_t cell = WHITE;
        if (inBoard(x, y))
            cell = board[y * BOARD_SIZE + x];

        if (cell == BLACK)
            key += POW3[bit];
        else if (cell != EMPTY)
            key += POW3[bit] * 2;
        bit++;
    }
    return key;
}

const RecursiveLineInfo &recursiveLineInfoForKey(uint32_t key)
{
    RecursiveLineInfo &result = RECURSIVE_LINE_TABLE[key];
    if (result.flags & RECURSIVE_LINE_READY)
        return result;

    ModeTables &mode = MODES[modeIndex(RENJU, BLACK)];
    const Line line = decodeTernaryLine(key, mode.variableCells);
    const CountInfo count = countLine(line);
    const uint8_t pattern = mode.ternaryTable[key];

    uint8_t flags = RECURSIVE_LINE_READY;
    if (count.realLen >= 5)
        flags |= RECURSIVE_HAS_FIVE_RUN;

    // 遞迴層只需要知道是否至少存在一個合法連五點。
    // B4、F4，以及沒有實際長連的同線雙四，都符合這個條件。
    if (pattern == B4 || pattern == F4 || (pattern == OL && count.realLen < 6))
        flags |= RECURSIVE_HAS_FIVE_COMPLETION;

    uint16_t openFourMask = 0;
    if (pattern == F3 || pattern == F3S) {
        const int mid = line.len >> 1;
        for (int lineIndex = count.start; lineIndex <= count.end; lineIndex++) {
            if (line.cells[lineIndex] != EMPT)
                continue;

            Line shifted = shiftLine(line, lineIndex);
            shifted.cells[mid] = SELF;
            if (classifyLine(mode, shifted) == F4)
                openFourMask |= uint16_t(1U << variableBitFromLineIndex(lineIndex));
        }
    }

    result.openFourMask = openFourMask;
    result.flags = flags;
    return result;
}

const RecursiveLineInfo &recursiveLineInfo(const uint8_t *board,
                                           int idx,
                                           int direction)
{
    return recursiveLineInfoForKey(encodeRenjuBlackDirectionKey(board, idx, direction));
}

int countDirectionBits(uint8_t mask)
{
    int count = 0;
    while (mask) {
        mask &= uint8_t(mask - 1);
        count++;
    }
    return count;
}

int extensionIndexFromBit(int idx, int direction, int bit)
{
    const int offset = offsetFromVariableBit(bit);
    const int x = idx % BOARD_SIZE + DX[direction] * offset;
    const int y = idx / BOARD_SIZE + DY[direction] * offset;
    return inBoard(x, y) ? y * BOARD_SIZE + x : -1;
}

RecursiveDoubleThreeResult verifyDoubleThreePlacedMutable(
    std::array<uint8_t, BOARD_CELLS> &board,
    int idx,
    const RecursivePointInfo &point,
    int depth,
    bool needExactCount);

bool isOpenFourExtensionLegalMutable(std::array<uint8_t, BOARD_CELLS> &board,
                                     int extensionIdx,
                                     int originalDirection,
                                     int depth)
{
    if (extensionIdx < 0 || extensionIdx >= BOARD_CELLS || board[extensionIdx] != EMPTY)
        return false;
    if (depth > BOARD_CELLS)
        return false;

    board[extensionIdx] = BLACK;

    RecursivePointInfo nestedPoint;
    bool rejected = false;
    for (int direction = 0; direction < 4; direction++) {
        if (direction == originalDirection)
            continue;

        const RecursiveLineInfo &line = recursiveLineInfo(board.data(), extensionIdx, direction);
        if (line.flags & (RECURSIVE_HAS_FIVE_RUN | RECURSIVE_HAS_FIVE_COMPLETION)) {
            rejected = true;
            break;
        }
        if (line.openFourMask) {
            nestedPoint.openFourMasks[direction] = line.openFourMask;
            nestedPoint.suspectDirectionMask |= uint8_t(1U << direction);
        }
    }

    bool legal = false;
    if (!rejected) {
        if (countDirectionBits(nestedPoint.suspectDirectionMask) < 2)
            legal = true;
        else {
            const RecursiveDoubleThreeResult nested = verifyDoubleThreePlacedMutable(
                board, extensionIdx, nestedPoint, depth + 1, false);
            legal = !nested.forbidden;
        }
    }

    board[extensionIdx] = EMPTY;
    return legal;
}

RecursiveDoubleThreeResult verifyDoubleThreePlacedMutable(
    std::array<uint8_t, BOARD_CELLS> &board,
    int idx,
    const RecursivePointInfo &point,
    int depth,
    bool needExactCount)
{
    if (depth > BOARD_CELLS)
        return {true, 2};

    int confirmedReal = 0;
    int remainingPossible = countDirectionBits(point.suspectDirectionMask);
    uint8_t pending = point.suspectDirectionMask;

    while (pending) {
        const int direction = __builtin_ctz(unsigned(pending));
        pending &= uint8_t(pending - 1);
        remainingPossible--;

        bool real = false;
        uint16_t candidates = point.openFourMasks[direction];
        while (candidates) {
            const int bit = __builtin_ctz(unsigned(candidates));
            candidates &= uint16_t(candidates - 1);
            const int extensionIdx = extensionIndexFromBit(idx, direction, bit);
            if (isOpenFourExtensionLegalMutable(
                    board, extensionIdx, direction, depth)) {
                real = true;
                break;
            }
        }

        if (real)
            confirmedReal++;

        if (confirmedReal >= 2)
            return {true, uint8_t(confirmedReal)};

        if (confirmedReal + remainingPossible < 2) {
            // 遞迴內層只需要禁／非禁，可立即剪枝；最外層為維持
            // realThreeDirections 的既有輸出，最多再驗證最後一個方向。
            if (!needExactCount || remainingPossible == 0)
                return {false, uint8_t(confirmedReal)};
        }
    }

    return {false, uint8_t(confirmedReal)};
}

ForbiddenResult verifyDoubleThreeMutable(std::array<uint8_t, BOARD_CELLS> &board,
                                         int idx,
                                         const PointResult &analysis)
{
    board[idx] = BLACK;

    RecursivePointInfo point;
    for (int direction = 0; direction < 4; direction++) {
        const uint8_t pattern = analysis.directions[direction];
        if (pattern != F3 && pattern != F3S)
            continue;

        const RecursiveLineInfo &line = recursiveLineInfo(board.data(), idx, direction);
        if (line.openFourMask) {
            point.openFourMasks[direction] = line.openFourMask;
            point.suspectDirectionMask |= uint8_t(1U << direction);
        }
    }

    const RecursiveDoubleThreeResult verified = verifyDoubleThreePlacedMutable(
        board, idx, point, 0, true);
    board[idx] = EMPTY;

    if (verified.forbidden)
        return {true, FORBID_DOUBLE_THREE, verified.realThreeDirections};
    return {false, FORBID_FAKE, verified.realThreeDirections};
}

ForbiddenResult analyzeForbiddenFast(const uint8_t *board,
                                     int idx,
                                     int rule,
                                     int method,
                                     const PointResult *knownAnalysis = nullptr)
{
    if (rule != RENJU)
        return {false, FORBID_NOT_APPLICABLE, 0};
    if (idx < 0 || idx >= BOARD_CELLS || board[idx] != EMPTY)
        return {false, FORBID_OCCUPIED, 0};

    const PointResult analysis = knownAnalysis
        ? *knownAnalysis
        : classifyPoint(board, idx, BLACK, rule, method);

    ForbiddenResult simple;
    if (resolveSimpleForbidden(analysis, simple))
        return simple;

    std::array<uint8_t, BOARD_CELLS> boardCopy {};
    std::copy_n(board, BOARD_CELLS, boardCopy.begin());
    return verifyDoubleThreeMutable(boardCopy, idx, analysis);
}

bool equalExportOptimized(const ExportResult &a, const ExportResult &b)
{
    return std::equal(std::begin(a.directions), std::end(a.directions), std::begin(b.directions))
        && a.pattern4 == b.pattern4
        && a.forbidden == b.forbidden
        && a.forbiddenType == b.forbiddenType
        && a.actualOverlineMask == b.actualOverlineMask
        && a.sameLineDoubleFourMask == b.sameLineDoubleFourMask
        && a.realThreeDirections == b.realThreeDirections;
}

bool recursiveLineTableMatchesCanonical()
{
    ModeTables &mode = MODES[modeIndex(RENJU, BLACK)];
    for (uint32_t key = 0; key < uint32_t(mode.ternaryCount); key++) {
        const Line line = decodeTernaryLine(key, mode.variableCells);
        const CountInfo count = countLine(line);
        bool hasFiveCompletion = false;
        uint16_t openFourMask = 0;
        const int mid = line.len >> 1;

        for (int lineIndex = count.start; lineIndex <= count.end; lineIndex++) {
            if (line.cells[lineIndex] != EMPT)
                continue;
            Line shifted = shiftLine(line, lineIndex);
            shifted.cells[mid] = SELF;
            const uint8_t child = classifyLine(mode, shifted);
            if (child == F5)
                hasFiveCompletion = true;
            else if ((mode.ternaryTable[key] == F3 || mode.ternaryTable[key] == F3S)
                     && child == F4)
                openFourMask |= uint16_t(1U << variableBitFromLineIndex(lineIndex));
        }

        const RecursiveLineInfo &actual = recursiveLineInfoForKey(key);
        if (bool(actual.flags & RECURSIVE_HAS_FIVE_RUN) != (count.realLen >= 5)
            || bool(actual.flags & RECURSIVE_HAS_FIVE_COMPLETION) != hasFiveCompletion
            || actual.openFourMask != openFourMask)
            return false;
    }
    return true;
}

int optimizedSelfTestInternal()
{
    if (vcfPatternSelfTestLegacy() != 0)
        return 1;
    if (!recursiveLineTableMatchesCanonical())
        return 2;

    std::array<uint8_t, BOARD_CELLS> board {};
    uint32_t state = 0x12345678U;
    for (int test = 0; test < 12000; test++) {
        board.fill(EMPTY);
        const uint32_t density = test < 4000 ? 10 : test < 8000 ? 18 : 28;
        for (int i = 0; i < BOARD_CELLS; i++) {
            state ^= state << 13;
            state ^= state >> 17;
            state ^= state << 5;
            const uint32_t value = state % density;
            board[i] = value < 2 ? BLACK : value < 4 ? WHITE : EMPTY;
        }
        const int idx = (test * 37) % BOARD_CELLS;
        board[idx] = EMPTY;
        const int side = (test & 1) ? BLACK : WHITE;
        const int rule = test % 3;
        const int method = test % 3;

        ExportResult legacy {};
        ExportResult optimized {};
        if (!vcfAnalyzePointLegacy(board.data(), idx, side, rule, method, &legacy)
            || !vcfAnalyzePoint(board.data(), idx, side, rule, method, &optimized)
            || !equalExportOptimized(legacy, optimized))
            return 3;

        if (side == BLACK) {
            ForbiddenExportResult forbidden {};
            if (!vcfAnalyzeForbidden(board.data(), idx, rule, method, &forbidden)
                || forbidden.forbidden != optimized.forbidden
                || forbidden.forbiddenType != optimized.forbiddenType
                || forbidden.realThreeDirections != optimized.realThreeDirections)
                return 4;
        }
    }

    board.fill(EMPTY);
    for (int x = 2; x <= 6; x++)
        board[7 * BOARD_SIZE + x] = BLACK;
    ExportResult overline {};
    if (!vcfAnalyzePoint(board.data(), 7 * BOARD_SIZE + 7, BLACK, RENJU, 0, &overline)
        || !overline.forbidden || overline.forbiddenType != FORBID_OVERLINE)
        return 5;

    board.fill(EMPTY);
    for (int x = 3; x <= 6; x++)
        board[7 * BOARD_SIZE + x] = BLACK;
    ExportResult five {};
    if (!vcfAnalyzePoint(board.data(), 7 * BOARD_SIZE + 7, BLACK, RENJU, 0, &five)
        || five.forbidden || five.pattern4 != A_FIVE)
        return 6;

    board.fill(EMPTY);
    const int center = 7 * BOARD_SIZE + 7;
    board[7 * BOARD_SIZE + 6] = BLACK;
    board[7 * BOARD_SIZE + 8] = BLACK;
    board[6 * BOARD_SIZE + 7] = BLACK;
    board[8 * BOARD_SIZE + 7] = BLACK;
    const auto before = board;
    ForbiddenExportResult doubleThree {};
    if (!vcfAnalyzeForbidden(board.data(), center, RENJU, 0, &doubleThree)
        || !doubleThree.forbidden
        || doubleThree.forbiddenType != FORBID_DOUBLE_THREE
        || board != before)
        return 7;

    return 0;
}

} // namespace

extern "C" VCF_KEEPALIVE int vcfAnalyzeForbidden(const uint8_t *board,
                                                   int idx,
                                                   int rule,
                                                   int method,
                                                   ForbiddenExportResult *out)
{
    ensureInitialized();
    if (!board || !out || idx < 0 || idx >= BOARD_CELLS
        || rule < FREESTYLE || rule > RENJU
        || method < TERNARY_MAINTAINED || method > BINARY_TABLE)
        return 0;

    const ForbiddenResult forbidden = analyzeForbiddenFast(board, idx, rule, method);
    *out = ForbiddenExportResult {};
    out->forbidden = forbidden.forbidden ? 1 : 0;
    out->forbiddenType = forbidden.type;
    out->realThreeDirections = forbidden.realThreeDirections;
    return 1;
}

extern "C" VCF_KEEPALIVE int vcfAnalyzePoint(const uint8_t *board,
                                               int idx,
                                               int side,
                                               int rule,
                                               int method,
                                               ExportResult *out)
{
    ensureInitialized();
    if (!board || !out || idx < 0 || idx >= BOARD_CELLS
        || (side != BLACK && side != WHITE)
        || rule < FREESTYLE || rule > RENJU
        || method < TERNARY_MAINTAINED || method > BINARY_TABLE)
        return 0;

    const PointResult point = classifyPoint(board, idx, side, rule, method);
    const ForbiddenResult forbidden = side == BLACK
        ? analyzeForbiddenFast(board, idx, rule, method, &point)
        : ForbiddenResult {false, FORBID_NOT_APPLICABLE, 0};

    *out = ExportResult {};
    for (int i = 0; i < 4; i++)
        out->directions[i] = point.directions[i];
    out->pattern4 = point.pattern4;
    out->forbidden = forbidden.forbidden ? 1 : 0;
    out->forbiddenType = forbidden.type;
    out->actualOverlineMask = point.actualOverlineMask;
    out->sameLineDoubleFourMask = point.sameLineDoubleFourMask;
    out->realThreeDirections = forbidden.realThreeDirections;
    return 1;
}

extern "C" VCF_KEEPALIVE double vcfLookupBenchmark(int rule,
                                                     int side,
                                                     int mode,
                                                     int iterations)
{
    return vcfLookupBenchmarkLegacy(rule, side, mode, iterations);
}

extern "C" VCF_KEEPALIVE int vcfPatternSelfTest()
{
    return optimizedSelfTestInternal();
}

#ifdef VCF_PATTERN_OPTIMIZED_TEST_MAIN
int main()
{
    const int result = vcfPatternSelfTest();
    std::printf("optimized pattern self-test: %d\n", result);
    return result == 0 ? 0 : 1;
}
#endif
