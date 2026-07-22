#include <algorithm>
#include <array>
#include <cstdint>
#include <cstdlib>
#include <vector>

#ifdef __EMSCRIPTEN__
#include <emscripten/emscripten.h>
#define VCF_LEGACY_KEEPALIVE EMSCRIPTEN_KEEPALIVE
#else
#define VCF_LEGACY_KEEPALIVE
#endif

namespace {
constexpr int BOARD_SIZE = 15;
constexpr int BOARD_CELLS = 225;
constexpr int RENJU = 2;
constexpr int BLACK = 1;
constexpr uint8_t F5 = 13;

#pragma pack(push, 1)
struct PatternExportResult {
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

extern "C" int vcfAnalyzePoint(const uint8_t *, int, int, int, int, PatternExportResult *);
extern "C" int vcfBbLegacyGetLevelPoint(const uint8_t *, int, int, int);
extern "C" int vcfBbLegacyTestLineFour(const uint8_t *, int, int, int, int);

bool inBoard(int x, int y)
{
    return x >= 0 && x < BOARD_SIZE && y >= 0 && y < BOARD_SIZE;
}

bool legal(const PatternExportResult &result, int side, int rule)
{
    return !(rule == RENJU && side == BLACK && result.forbidden);
}

std::vector<int> lineFivePoints(const uint8_t *source, int idx, int direction, int side, int rule)
{
    std::vector<int> points;
    if (!source || idx < 0 || idx >= BOARD_CELLS || direction < 0 || direction > 3)
        return points;

    std::array<uint8_t, BOARD_CELLS> board {};
    std::copy_n(source, BOARD_CELLS, board.begin());
    if (board[idx] != 0 && board[idx] != side)
        return points;
    board[idx] = uint8_t(side);

    static constexpr int dx[4] = {1, 0, 1, 1};
    static constexpr int dy[4] = {0, 1, 1, -1};
    const int x0 = idx % BOARD_SIZE;
    const int y0 = idx / BOARD_SIZE;

    for (int offset = -5; offset <= 5; offset++) {
        const int x = x0 + dx[direction] * offset;
        const int y = y0 + dy[direction] * offset;
        if (!inBoard(x, y))
            continue;
        const int point = y * BOARD_SIZE + x;
        if (board[point] != 0)
            continue;
        PatternExportResult result {};
        if (vcfAnalyzePoint(board.data(), point, side, rule, 0, &result)
            && legal(result, side, rule)
            && result.directions[direction] == F5)
            points.push_back(point);
    }
    return points;
}

bool isCompactDoubleFour(const std::vector<int> &points)
{
    if (points.size() < 2)
        return false;
    const int first = points.front();
    const int last = points.back();
    const int distance = std::max(std::abs(first % BOARD_SIZE - last % BOARD_SIZE),
                                  std::abs(first / BOARD_SIZE - last / BOARD_SIZE));
    return distance < 5;
}
} // namespace

extern "C" VCF_LEGACY_KEEPALIVE int vcfBbLegacyTestLineFourCompat(const uint8_t *board,
                                                                    int idx,
                                                                    int direction,
                                                                    int side,
                                                                    int rule)
{
    const int original = vcfBbLegacyTestLineFour(board, idx, direction, side, rule);
    const std::vector<int> points = lineFivePoints(board, idx, direction, side, rule);
    const int point = points.empty() ? 255 : points.front();
    const int low = isCompactDoubleFour(points) ? 24 : (original & 0x1f);
    return low | ((point & 0xff) << 8);
}

extern "C" VCF_LEGACY_KEEPALIVE int vcfBbLegacyGetLevelPointCompat(const uint8_t *board,
                                                                    int idx,
                                                                    int side,
                                                                    int rule)
{
    int value = vcfBbLegacyGetLevelPoint(board, idx, side, rule);
    for (int direction = 0; direction < 4; direction++) {
        if (isCompactDoubleFour(lineFivePoints(board, idx, direction, side, rule))) {
            value &= ~0x20;
            value |= 0x40;
            break;
        }
    }
    return value;
}
