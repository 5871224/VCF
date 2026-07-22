#include <array>
#include <algorithm>
#include <chrono>
#include <cstdint>
#include <cstdio>
#include <vector>

#ifdef __EMSCRIPTEN__
#include <emscripten/emscripten.h>
#define VCF_KEEPALIVE EMSCRIPTEN_KEEPALIVE
static double nowMs() { return emscripten_get_now(); }
#else
#define VCF_KEEPALIVE
static double nowMs()
{
    using clock = std::chrono::steady_clock;
    return std::chrono::duration<double, std::milli>(clock::now().time_since_epoch()).count();
}
#endif

namespace {

constexpr int BOARD_SIZE = 15;
constexpr int BOARD_CELLS = BOARD_SIZE * BOARD_SIZE;
constexpr int MAX_HALF = 5;
constexpr int MAX_LINE_LEN = MAX_HALF * 2 + 1;
constexpr int MAX_VARIABLE_CELLS = MAX_HALF * 2;
constexpr int TERNARY_KEY_COUNT = 59049;
constexpr int BINARY_KEY_COUNT = 1 << 20;
constexpr int SAMPLE_COUNT = 4096;
constexpr int SAMPLE_MASK = SAMPLE_COUNT - 1;
constexpr uint8_t NIL = 255;

constexpr uint8_t EMPTY = 0;
constexpr uint8_t BLACK = 1;
constexpr uint8_t WHITE = 2;
constexpr uint8_t SELF = 0;
constexpr uint8_t OPPO = 1;
constexpr uint8_t EMPT = 2;

enum Rule : int { FREESTYLE = 0, STANDARD = 1, RENJU = 2 };
enum Method : int { TERNARY_MAINTAINED = 0, HELPER_TABLES = 1, BINARY_TABLE = 2 };
enum Pattern : uint8_t {
    DEAD = 0,
    OL = 1,
    B1 = 2,
    F1 = 3,
    B2 = 4,
    F2 = 5,
    F2A = 6,
    F2B = 7,
    B3 = 8,
    F3 = 9,
    F3S = 10,
    B4 = 11,
    F4 = 12,
    F5 = 13,
    PATTERN_NB = 14,
};
enum Pattern4 : uint8_t {
    NONE = 0,
    FORBID = 1,
    L_FLEX2 = 2,
    K_BLOCK3 = 3,
    J_FLEX2_2X = 4,
    I_BLOCK3_PLUS = 5,
    H_FLEX3 = 6,
    G_FLEX3_PLUS = 7,
    F_FLEX3_2X = 8,
    E_BLOCK4 = 9,
    D_BLOCK4_PLUS = 10,
    C_BLOCK4_FLEX3 = 11,
    B_FLEX4 = 12,
    A_FIVE = 13,
};
enum ForbiddenType : uint8_t {
    FORBID_NOT_APPLICABLE = 0,
    FORBID_LEGAL = 1,
    FORBID_LEGAL_FIVE = 2,
    FORBID_OVERLINE = 3,
    FORBID_DOUBLE_FOUR = 4,
    FORBID_DOUBLE_THREE = 5,
    FORBID_FAKE = 6,
    FORBID_OCCUPIED = 7,
};

constexpr int DX[4] = {1, 0, 1, 1};
constexpr int DY[4] = {0, 1, 1, -1};

struct Line {
    std::array<uint8_t, MAX_LINE_LEN> cells {};
    int len = 0;
};

struct CountInfo {
    int realLen = 1;
    int fullLen = 1;
    int start = 0;
    int end = 0;
};

struct DirectionResult {
    uint8_t pattern = DEAD;
    bool actualOverline = false;
    bool sameLineDoubleFour = false;
};

struct PointResult {
    std::array<uint8_t, 4> directions {};
    uint8_t pattern4 = NONE;
    uint8_t actualOverlineMask = 0;
    uint8_t sameLineDoubleFourMask = 0;
};

#pragma pack(push, 1)
struct ExportResult {
    uint8_t directions[4];
    uint8_t pattern4;
    uint8_t forbidden;
    uint8_t forbiddenType;
    uint8_t actualOverlineMask;
    uint8_t sameLineDoubleFourMask;
    uint8_t realThreeDirections;
    uint8_t reserved[6];
};
#pragma pack(pop)
static_assert(sizeof(ExportResult) == 16, "ExportResult must remain a 16-byte ABI");

struct ForbiddenResult {
    bool forbidden = false;
    uint8_t type = FORBID_LEGAL;
    uint8_t realThreeDirections = 0;
};

struct ModeTables {
    int rule = RENJU;
    int side = BLACK;
    int half = 5;
    int variableCells = 10;
    int ternaryCount = TERNARY_KEY_COUNT;
    std::array<uint32_t, 1024> ownToTernary {};
    std::array<uint32_t, 1024> blockToTernary {};
    std::vector<uint8_t> ternaryTable;
    std::vector<uint8_t> binaryTable;
    std::vector<uint8_t> memo;
    std::array<uint32_t, SAMPLE_COUNT> sampleTernaryKeys {};
    std::array<uint16_t, SAMPLE_COUNT> sampleOwnMasks {};
    std::array<uint16_t, SAMPLE_COUNT> sampleBlockMasks {};
    std::array<uint32_t, SAMPLE_COUNT> sampleBinaryKeys {};
};

std::array<uint32_t, 12> POW3 {};
std::array<ModeTables, 4> MODES;
bool initialized = false;
volatile uint64_t benchmarkSink = 0;

bool inBoard(int x, int y)
{
    return x >= 0 && x < BOARD_SIZE && y >= 0 && y < BOARD_SIZE;
}

int modeIndex(int rule, int side)
{
    if (rule == FREESTYLE)
        return 0;
    if (rule == STANDARD)
        return 1;
    return side == BLACK ? 2 : 3;
}

bool shouldCheckOverline(int rule, int side)
{
    return rule == STANDARD || (rule == RENJU && side == BLACK);
}

CountInfo countLine(const Line &line)
{
    const int mid = line.len >> 1;
    CountInfo info;
    info.start = mid;
    info.end = mid;

    int realLenInc = 1;
    for (int i = mid - 1; i >= 0; i--) {
        if (line.cells[i] == SELF)
            info.realLen += realLenInc;
        else if (line.cells[i] == OPPO)
            break;
        else
            realLenInc = 0;
        info.fullLen++;
        info.start = i;
    }

    realLenInc = 1;
    for (int i = mid + 1; i < line.len; i++) {
        if (line.cells[i] == SELF)
            info.realLen += realLenInc;
        else if (line.cells[i] == OPPO)
            break;
        else
            realLenInc = 0;
        info.fullLen++;
        info.end = i;
    }
    return info;
}

uint32_t encodeLine(const Line &line)
{
    uint32_t code = 0;
    for (int i = 0; i < line.len; i++)
        code = code * 3 + line.cells[i];
    return code;
}

Line shiftLine(const Line &line, int centerIndex)
{
    Line shifted;
    shifted.len = line.len;
    const int mid = line.len >> 1;
    for (int j = 0; j < line.len; j++) {
        const int src = j + centerIndex - mid;
        shifted.cells[j] = src >= 0 && src < line.len ? line.cells[src] : OPPO;
    }
    return shifted;
}

uint8_t classifyLine(ModeTables &mode, const Line &line)
{
    const uint32_t memoCode = encodeLine(line);
    uint8_t &cached = mode.memo[memoCode];
    if (cached != NIL)
        return cached;

    const CountInfo info = countLine(line);
    uint8_t pattern = DEAD;

    if (shouldCheckOverline(mode.rule, mode.side) && info.realLen >= 6)
        pattern = OL;
    else if (info.realLen >= 5)
        pattern = F5;
    else if (info.fullLen < 5)
        pattern = DEAD;
    else {
        std::array<uint8_t, PATTERN_NB> counts {};
        std::array<int, 2> f5Indices {-99, -99};
        int f5IndexCount = 0;
        const int mid = line.len >> 1;

        for (int i = info.start; i <= info.end; i++) {
            if (line.cells[i] != EMPT)
                continue;
            Line shifted = shiftLine(line, i);
            shifted.cells[mid] = SELF;
            const uint8_t childPattern = classifyLine(mode, shifted);
            if (childPattern == F5 && f5IndexCount < 2)
                f5Indices[f5IndexCount++] = i;
            counts[childPattern]++;
        }

        if (counts[F5] >= 2) {
            pattern = F4;
            if (mode.rule == RENJU && mode.side == BLACK && f5IndexCount >= 2
                && f5Indices[1] - f5Indices[0] < 5)
                pattern = OL;
        }
        else if (counts[F5])
            pattern = B4;
        else if (counts[F4] >= 2)
            pattern = F3S;
        else if (counts[F4])
            pattern = F3;
        else if (counts[B4])
            pattern = B3;
        else if (counts[F3S] + counts[F3] >= 4)
            pattern = F2B;
        else if (counts[F3S] + counts[F3] >= 3)
            pattern = F2A;
        else if (counts[F3S] + counts[F3])
            pattern = F2;
        else if (counts[B3])
            pattern = B2;
        else if (counts[F2] + counts[F2A] + counts[F2B])
            pattern = F1;
        else if (counts[B2])
            pattern = B1;
    }

    cached = pattern;
    return pattern;
}

Line decodeTernaryLine(uint32_t key, int variableCells)
{
    Line line;
    line.len = variableCells + 1;
    const int half = variableCells >> 1;
    for (int variableIndex = 0; variableIndex < variableCells; variableIndex++) {
        const uint32_t digit = key % 3;
        key /= 3;
        const int lineIndex = variableIndex < half ? variableIndex : variableIndex + 1;
        line.cells[lineIndex] = digit == 0 ? EMPT : digit == 1 ? SELF : OPPO;
    }
    line.cells[half] = SELF;
    return line;
}

void decodeKeyToMasks(uint32_t key, int variableCells, uint16_t &ownMask, uint16_t &blockMask)
{
    ownMask = 0;
    blockMask = 0;
    for (int bit = 0; bit < variableCells; bit++) {
        const uint32_t digit = key % 3;
        key /= 3;
        if (digit == 1)
            ownMask |= uint16_t(1U << bit);
        else if (digit == 2)
            blockMask |= uint16_t(1U << bit);
    }
}

void initializeMode(ModeTables &mode, int rule, int side)
{
    mode.rule = rule;
    mode.side = side;
    mode.half = rule == FREESTYLE ? 4 : 5;
    mode.variableCells = mode.half * 2;
    mode.ternaryCount = int(POW3[mode.variableCells]);
    mode.ternaryTable.assign(mode.ternaryCount, DEAD);
    mode.binaryTable.assign(BINARY_KEY_COUNT, DEAD);
    mode.memo.assign(POW3[mode.variableCells + 1], NIL);

    for (int mask = 0; mask < 1024; mask++) {
        uint32_t ownKey = 0;
        uint32_t blockKey = 0;
        for (int bit = 0; bit < MAX_VARIABLE_CELLS; bit++) {
            if ((mask >> bit) & 1) {
                ownKey += POW3[bit];
                blockKey += POW3[bit] * 2;
            }
        }
        mode.ownToTernary[mask] = ownKey;
        mode.blockToTernary[mask] = blockKey;
    }

    for (uint32_t key = 0; key < uint32_t(mode.ternaryCount); key++) {
        const Line line = decodeTernaryLine(key, mode.variableCells);
        const uint8_t pattern = classifyLine(mode, line);
        mode.ternaryTable[key] = pattern;
        uint16_t ownMask, blockMask;
        decodeKeyToMasks(key, mode.variableCells, ownMask, blockMask);
        const uint32_t binaryKey = uint32_t(ownMask) | (uint32_t(blockMask) << 10);
        mode.binaryTable[binaryKey] = pattern;
    }

    uint32_t state = 0x9e3779b9U ^ uint32_t(rule * 97 + side * 131);
    for (int sample = 0; sample < SAMPLE_COUNT; sample++) {
        uint16_t ownMask = 0;
        uint16_t blockMask = 0;
        uint32_t ternaryKey = 0;
        for (int bit = 0; bit < mode.variableCells; bit++) {
            state ^= state << 13;
            state ^= state >> 17;
            state ^= state << 5;
            const uint32_t cell = state % 3;
            if (cell == 1) {
                ownMask |= uint16_t(1U << bit);
                ternaryKey += POW3[bit];
            }
            else if (cell == 2) {
                blockMask |= uint16_t(1U << bit);
                ternaryKey += POW3[bit] * 2;
            }
        }
        mode.sampleOwnMasks[sample] = ownMask;
        mode.sampleBlockMasks[sample] = blockMask;
        mode.sampleTernaryKeys[sample] = ternaryKey;
        mode.sampleBinaryKeys[sample] = uint32_t(ownMask) | (uint32_t(blockMask) << 10);
    }
}

void ensureInitialized()
{
    if (initialized)
        return;
    POW3[0] = 1;
    for (int i = 1; i < int(POW3.size()); i++)
        POW3[i] = POW3[i - 1] * 3;

    initializeMode(MODES[0], FREESTYLE, BLACK);
    initializeMode(MODES[1], STANDARD, BLACK);
    initializeMode(MODES[2], RENJU, BLACK);
    initializeMode(MODES[3], RENJU, WHITE);
    initialized = true;
}

DirectionResult classifyDirection(const uint8_t *board,
                                  int idx,
                                  int side,
                                  int rule,
                                  int direction,
                                  int method)
{
    ModeTables &mode = MODES[modeIndex(rule, side)];
    const int x0 = idx % BOARD_SIZE;
    const int y0 = idx / BOARD_SIZE;
    const int half = mode.half;
    uint16_t ownMask = 0;
    uint16_t blockMask = 0;
    uint32_t directKey = 0;
    int variableIndex = 0;

    Line line;
    line.len = half * 2 + 1;
    line.cells[half] = SELF;

    for (int offset = -half; offset <= half; offset++) {
        if (offset == 0)
            continue;
        const int x = x0 + DX[direction] * offset;
        const int y = y0 + DY[direction] * offset;
        uint8_t relative = OPPO;
        if (inBoard(x, y)) {
            const uint8_t cell = board[y * BOARD_SIZE + x];
            if (cell == EMPTY)
                relative = EMPT;
            else if (cell == side)
                relative = SELF;
        }
        const int lineIndex = offset + half;
        line.cells[lineIndex] = relative;
        if (relative == SELF) {
            ownMask |= uint16_t(1U << variableIndex);
            directKey += POW3[variableIndex];
        }
        else if (relative == OPPO) {
            blockMask |= uint16_t(1U << variableIndex);
            directKey += POW3[variableIndex] * 2;
        }
        variableIndex++;
    }

    uint8_t pattern = DEAD;
    if (method == TERNARY_MAINTAINED)
        pattern = mode.ternaryTable[directKey];
    else if (method == HELPER_TABLES) {
        const uint32_t key = mode.ownToTernary[ownMask] + mode.blockToTernary[blockMask];
        pattern = mode.ternaryTable[key];
    }
    else {
        const uint32_t key = uint32_t(ownMask) | (uint32_t(blockMask) << 10);
        pattern = mode.binaryTable[key];
    }

    const CountInfo info = countLine(line);
    DirectionResult result;
    result.pattern = pattern;
    result.actualOverline = shouldCheckOverline(rule, side) && info.realLen >= 6;
    result.sameLineDoubleFour = rule == RENJU && side == BLACK && pattern == OL && info.realLen < 6;
    return result;
}

uint8_t combinePattern4(const std::array<uint8_t, 4> &patterns, int rule, int side)
{
    std::array<uint8_t, PATTERN_NB> n {};
    for (uint8_t p : patterns)
        n[p]++;

    if (n[F5] >= 1)
        return A_FIVE;

    if (rule == RENJU && side == BLACK) {
        if (n[OL] >= 1)
            return FORBID;
        if (n[F4] + n[B4] >= 2)
            return FORBID;
        if (n[F3] + n[F3S] >= 2)
            return FORBID;
    }

    if (n[B4] >= 2 || n[F4] >= 1)
        return B_FLEX4;
    if (n[B4] >= 1) {
        if (n[F3] >= 1 || n[F3S] >= 1)
            return C_BLOCK4_FLEX3;
        if (n[B3] >= 1 || n[F2] + n[F2A] + n[F2B] >= 1)
            return D_BLOCK4_PLUS;
        return E_BLOCK4;
    }
    if (n[F3] >= 1 || n[F3S] >= 1) {
        if (n[F3] + n[F3S] >= 2)
            return F_FLEX3_2X;
        if (n[B3] >= 1 || n[F2] + n[F2A] + n[F2B] >= 1)
            return G_FLEX3_PLUS;
        return H_FLEX3;
    }
    if (n[B3] >= 1) {
        if (n[B3] >= 2 || n[F2] + n[F2A] + n[F2B] >= 1)
            return I_BLOCK3_PLUS;
    }
    if (n[F2] + n[F2A] + n[F2B] >= 2)
        return J_FLEX2_2X;
    if (n[B3] >= 1)
        return K_BLOCK3;
    if (n[F2] + n[F2A] + n[F2B] >= 1)
        return L_FLEX2;
    return NONE;
}

PointResult classifyPoint(const uint8_t *board, int idx, int side, int rule, int method)
{
    PointResult result;
    for (int direction = 0; direction < 4; direction++) {
        const DirectionResult d = classifyDirection(board, idx, side, rule, direction, method);
        result.directions[direction] = d.pattern;
        if (d.actualOverline)
            result.actualOverlineMask |= uint8_t(1U << direction);
        if (d.sameLineDoubleFour)
            result.sameLineDoubleFourMask |= uint8_t(1U << direction);
    }
    result.pattern4 = combinePattern4(result.directions, rule, side);
    return result;
}

ForbiddenResult forbiddenInfo(std::array<uint8_t, BOARD_CELLS> &board,
                              int idx,
                              int rule,
                              int method,
                              int depth = 0)
{
    if (rule != RENJU)
        return {false, FORBID_NOT_APPLICABLE, 0};
    if (idx < 0 || idx >= BOARD_CELLS || board[idx] != EMPTY)
        return {false, FORBID_OCCUPIED, 0};
    if (depth > BOARD_CELLS)
        return {true, FORBID_DOUBLE_THREE, 2};

    const PointResult analysis = classifyPoint(board.data(), idx, BLACK, rule, method);
    if (analysis.pattern4 != FORBID)
        return {false, analysis.pattern4 == A_FIVE ? FORBID_LEGAL_FIVE : FORBID_LEGAL, 0};
    if (analysis.actualOverlineMask)
        return {true, FORBID_OVERLINE, 0};
    if (analysis.sameLineDoubleFourMask)
        return {true, FORBID_DOUBLE_FOUR, 0};

    int fourCount = 0;
    for (uint8_t p : analysis.directions)
        if (p == B4 || p == F4)
            fourCount++;
    if (fourCount >= 2)
        return {true, FORBID_DOUBLE_FOUR, 0};

    board[idx] = BLACK;
    int realThreeDirections = 0;
    const int x0 = idx % BOARD_SIZE;
    const int y0 = idx / BOARD_SIZE;

    for (int direction = 0; direction < 4 && realThreeDirections < 2; direction++) {
        const uint8_t originalPattern = analysis.directions[direction];
        if (originalPattern != F3 && originalPattern != F3S)
            continue;
        bool real = false;

        for (int sign : {-1, 1}) {
            int x = x0;
            int y = y0;
            for (int step = 0; step < 4; step++) {
                x += DX[direction] * sign;
                y += DY[direction] * sign;
                if (!inBoard(x, y))
                    break;
                const int p = y * BOARD_SIZE + x;
                const uint8_t value = board[p];
                if (value == BLACK)
                    continue;
                if (value == EMPTY) {
                    const PointResult extension = classifyPoint(board.data(), p, BLACK, rule, method);
                    const uint8_t linePattern = extension.directions[direction];
                    if (extension.pattern4 == B_FLEX4 || linePattern == F5)
                        real = true;
                    else if (extension.pattern4 == FORBID && linePattern == F4) {
                        const ForbiddenResult nested = forbiddenInfo(board, p, rule, method, depth + 1);
                        real = !nested.forbidden;
                    }
                }
                break;
            }
            if (real)
                break;
        }
        if (real)
            realThreeDirections++;
    }

    board[idx] = EMPTY;
    if (realThreeDirections >= 2)
        return {true, FORBID_DOUBLE_THREE, uint8_t(realThreeDirections)};
    return {false, FORBID_FAKE, uint8_t(realThreeDirections)};
}

int selfTestInternal()
{
    ensureInitialized();
    int mismatches = 0;
    for (ModeTables &mode : MODES) {
        for (uint32_t key = 0; key < uint32_t(mode.ternaryCount); key++) {
            uint16_t ownMask, blockMask;
            decodeKeyToMasks(key, mode.variableCells, ownMask, blockMask);
            const uint32_t helperKey = mode.ownToTernary[ownMask] + mode.blockToTernary[blockMask];
            const uint32_t binaryKey = uint32_t(ownMask) | (uint32_t(blockMask) << 10);
            const uint8_t expected = mode.ternaryTable[key];
            if (expected >= PATTERN_NB || helperKey != key
                || mode.ternaryTable[helperKey] != expected || mode.binaryTable[binaryKey] != expected)
                mismatches++;
        }
    }
    return mismatches;
}

double benchmarkLookup(int rule, int side, int mode, int iterations)
{
    ensureInitialized();
    if (iterations <= 0)
        return 0.0;
    ModeTables &data = MODES[modeIndex(rule, side)];
    uint64_t checksum = benchmarkSink;

    auto runOne = [&](int i) {
        const int sample = i & SAMPLE_MASK;
        if (mode == TERNARY_MAINTAINED)
            checksum += data.ternaryTable[data.sampleTernaryKeys[sample]];
        else if (mode == HELPER_TABLES) {
            const uint32_t key = data.ownToTernary[data.sampleOwnMasks[sample]]
                                 + data.blockToTernary[data.sampleBlockMasks[sample]];
            checksum += data.ternaryTable[key];
        }
        else
            checksum += data.binaryTable[data.sampleBinaryKeys[sample]];
    };

    for (int i = 0; i < SAMPLE_COUNT; i++)
        runOne(i);
    const double start = nowMs();
    for (int i = 0; i < iterations; i++)
        runOne(i);
    const double elapsed = nowMs() - start;
    benchmarkSink = checksum;
    return elapsed * 1000000.0 / double(iterations);
}

}  // namespace

extern "C" VCF_KEEPALIVE int vcfPatternSelfTest()
{
    return selfTestInternal();
}

extern "C" VCF_KEEPALIVE double vcfLookupBenchmark(int rule,
                                                    int side,
                                                    int mode,
                                                    int iterations)
{
    if (rule < FREESTYLE || rule > RENJU || (side != BLACK && side != WHITE)
        || mode < TERNARY_MAINTAINED || mode > BINARY_TABLE)
        return 0.0;
    return benchmarkLookup(rule, side, mode, iterations);
}

extern "C" VCF_KEEPALIVE int vcfAnalyzePoint(const uint8_t *board,
                                              int idx,
                                              int side,
                                              int rule,
                                              int method,
                                              ExportResult *out)
{
    ensureInitialized();
    if (!board || !out || idx < 0 || idx >= BOARD_CELLS || (side != BLACK && side != WHITE)
        || rule < FREESTYLE || rule > RENJU || method < TERNARY_MAINTAINED
        || method > BINARY_TABLE)
        return 0;

    std::array<uint8_t, BOARD_CELLS> boardCopy {};
    std::copy_n(board, BOARD_CELLS, boardCopy.begin());
    const PointResult point = classifyPoint(boardCopy.data(), idx, side, rule, method);
    ForbiddenResult forbidden;
    if (side == BLACK)
        forbidden = forbiddenInfo(boardCopy, idx, rule, method);
    else
        forbidden = {false, FORBID_NOT_APPLICABLE, 0};

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

#ifdef VCF_PATTERN_TEST_MAIN
static bool equalExport(const ExportResult &a, const ExportResult &b)
{
    return std::equal(std::begin(a.directions), std::end(a.directions), std::begin(b.directions))
           && a.pattern4 == b.pattern4 && a.forbidden == b.forbidden
           && a.forbiddenType == b.forbiddenType
           && a.actualOverlineMask == b.actualOverlineMask
           && a.sameLineDoubleFourMask == b.sameLineDoubleFourMask
           && a.realThreeDirections == b.realThreeDirections;
}

int main()
{
    const int mismatches = vcfPatternSelfTest();
    std::printf("table mismatches: %d\n", mismatches);
    if (mismatches)
        return 1;

    std::array<uint8_t, BOARD_CELLS> board {};
    uint32_t state = 0x12345678U;
    for (int test = 0; test < 2000; test++) {
        board.fill(EMPTY);
        for (int i = 0; i < BOARD_CELLS; i++) {
            state ^= state << 13;
            state ^= state >> 17;
            state ^= state << 5;
            const uint32_t v = state % 10;
            board[i] = v < 2 ? BLACK : v < 4 ? WHITE : EMPTY;
        }
        const int idx = (test * 37) % BOARD_CELLS;
        board[idx] = EMPTY;
        const int side = test & 1 ? BLACK : WHITE;
        const int rule = test % 3;
        ExportResult a {}, b {}, c {};
        vcfAnalyzePoint(board.data(), idx, side, rule, 0, &a);
        vcfAnalyzePoint(board.data(), idx, side, rule, 1, &b);
        vcfAnalyzePoint(board.data(), idx, side, rule, 2, &c);
        if (!equalExport(a, b) || !equalExport(a, c)) {
            std::printf("method mismatch at test %d\n", test);
            return 2;
        }
    }

    board.fill(EMPTY);
    for (int x = 2; x <= 6; x++)
        board[7 * BOARD_SIZE + x] = BLACK;
    ExportResult overline {};
    vcfAnalyzePoint(board.data(), 7 * BOARD_SIZE + 7, BLACK, RENJU, 0, &overline);
    if (!overline.forbidden || overline.forbiddenType != FORBID_OVERLINE)
        return 3;

    board.fill(EMPTY);
    for (int x = 3; x <= 6; x++)
        board[7 * BOARD_SIZE + x] = BLACK;
    ExportResult five {};
    vcfAnalyzePoint(board.data(), 7 * BOARD_SIZE + 7, BLACK, RENJU, 0, &five);
    if (five.forbidden || five.pattern4 != A_FIVE)
        return 4;

    std::puts("all tests passed");
    return 0;
}
#endif
