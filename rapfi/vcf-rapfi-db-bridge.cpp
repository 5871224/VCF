
// VCF browser bridge for Rapfi's native Board / DBClient / DBRecord model.
// The algorithms for transposition/symmetry, children, comments and board text remain in Rapfi.
// This file only supplies an in-memory DBStorage and a small C ABI for JavaScript.

#include "config.h"
#include "core/hash.h"
#include "database/dbclient.h"
#include "database/dbstorage.h"
#include "database/dbtypes.h"
#include "database/yxdbstorage.h"
#include "game/board.h"

#include <algorithm>
#include <cstdint>
#include <filesystem>
#include <map>
#include <memory>
#include <string>
#include <utility>
#include <vector>

using Database::DBClient;
using Database::DBKey;
using Database::DBRecord;
using Database::DBRecordMask;
using Database::DBStorage;
using Database::StonePos;
using Database::OverwriteRule;
using Database::YXDBStorage;

namespace Config {
// Minimal model tables required by Rapfi Board. PatternConfig in pattern.cpp fills P4SCORES.
// Evaluation values are irrelevant to the workbench database bridge and remain zero.
Eval EVALS[RULE_NB + 1][PCODE_NB] {};
Eval EVALS_THREAT[RULE_NB + 1][THREAT_NB] {};
Pattern4Score P4SCORES[RULE_NB + 1][PCODE_NB] {};
float ScalingFactor = 200.0f;
int DatabaseOverwriteExactBias = 3;
int DatabaseOverwriteDepthBoundBias = -1;
uint16_t DatabaseLegacyFileCodePage = 65001;
}  // namespace Config

namespace {

constexpr int BOARD_SIZE = 15;
constexpr int BOARD_CELLS = BOARD_SIZE * BOARD_SIZE;

std::unique_ptr<YXDBStorage> g_storage;
std::unique_ptr<DBClient> g_client;
std::unique_ptr<Board> g_board;
Rule g_rule = RENJU;
std::string g_textResult;
std::vector<std::pair<Pos, DBRecord>> g_children;
std::vector<std::pair<Pos, std::string>> g_boardTexts;
std::vector<uint8_t> g_blobResult;

#ifdef __EMSCRIPTEN__
constexpr const char *STORAGE_PATH = "/vcf-workbench.db";
#else
constexpr const char *STORAGE_PATH = "/tmp/vcf-workbench-bridge.db";
#endif

Rule normalizeRule(int rule)
{
    if (rule == FREESTYLE || rule == STANDARD || rule == RENJU)
        return static_cast<Rule>(rule);
    return RENJU;
}

Pos toRapfiPos(int move)
{
    if (move < 0)
        return Pos::PASS;
    return Pos {move % BOARD_SIZE, move / BOARD_SIZE};
}

int toWebMove(Pos pos)
{
    if (pos == Pos::PASS)
        return -1;
    return pos.y() * BOARD_SIZE + pos.x();
}

int toWebStone(Color color)
{
    if (color == BLACK)
        return 1;
    if (color == WHITE)
        return 2;
    return 0;
}

bool ready()
{
    return g_storage && g_client && g_board;
}

void flushWrites()
{
    if (g_client) {
        // A single canonical DBKey can be reached through many histories/orientations with
        // different Zobrist hashes. After mutating a position record, clear Rapfi's hash-keyed
        // caches so every transposed/mirrored/rotated alias observes the same fresh DBRecord.
        g_client->sync(true);
    }
}

void resetBoard(Rule rule)
{
    g_rule = rule;
    g_board = std::make_unique<Board>(BOARD_SIZE, CandidateRange::FULL_BOARD);
    g_board->newGame(g_rule);
    g_children.clear();
    g_boardTexts.clear();
    g_textResult.clear();
}

void openStorage(Rule rule)
{
    g_storage = std::make_unique<YXDBStorage>(
        std::filesystem::path(STORAGE_PATH),
        false,
        false,
        0,
        false);
    g_client = std::make_unique<DBClient>(*g_storage, Database::RECORD_MASK_ALL, 256, 1024);
    resetBoard(rule);
}

void clearAll(Rule rule)
{
    // Client must be destroyed before storage because its destructor writes dirty cache entries.
    g_client.reset();
    g_storage.reset();
    std::error_code ec;
    std::filesystem::remove(std::filesystem::path(STORAGE_PATH), ec);
    openStorage(rule);
}

bool queryCurrentRecord(DBRecord &record)
{
    return ready() && g_client->query(*g_board, g_rule, record);
}

// Rapfi keeps the parent-symmetry helper private in dbclient.cpp. Keep this bridge copy
// byte-for-byte equivalent to the pinned Rapfi 3aedf3a implementation so occupied-point
// @BTXT@ markers can use the same canonical slot mapping as DBClient::setBoardText().
bool isDBKeySymmetryForBoardText(const DBKey &key, TransformType transform)
{
    if (key.boardWidth != key.boardHeight && !isRectangleTransform(transform))
        return false;

    std::map<StonePos, Color> stones;
    for (auto s = key.blackStonesBegin(); s < key.blackStonesEnd(); s++)
        stones[*s] = BLACK;
    for (auto s = key.whiteStonesBegin(); s < key.whiteStonesEnd(); s++)
        stones[*s] = WHITE;

    for (const auto &[stone, color] : stones) {
        Pos pos {stone.x, stone.y};
        Pos transformed = applyTransform(pos, key.boardWidth, key.boardHeight, transform);
        StonePos transformedStone {transformed.x(), transformed.y()};
        auto it = stones.find(transformedStone);
        if (it == stones.end() || it->second != color)
            return false;
    }
    return true;
}

Pos canonicalBoardTextPos(const Board &board, Rule rule, Pos pos)
{
    TransformType parentTransform;
    DBKey parentKey = Database::constructDBKey(board, rule, &parentTransform);
    Pos canonicalPos = applyTransform(pos, board.size(), parentTransform);
    for (int t = IDENTITY + 1; t < TRANS_NB; t++) {
        TransformType transform = static_cast<TransformType>(t);
        if (!isDBKeySymmetryForBoardText(parentKey, transform))
            continue;
        Pos transformed = applyTransform(canonicalPos, board.size(), transform);
        canonicalPos = std::min(canonicalPos, transformed);
    }
    return canonicalPos;
}

void setCurrentDisplayText(std::string raw)
{
    DBRecord display {Database::LABEL_NONE};
    display.text = std::move(raw);

    DBRecord stored;
    if (!queryCurrentRecord(stored))
        stored = DBRecord {Database::LABEL_NONE};

    stored.clearAllBoardText();
    stored.setComment(display.comment());
    for (const auto &[displayPos, text] : display.getAllBoardTexts()) {
        Pos canonicalPos = canonicalBoardTextPos(*g_board, g_rule, displayPos);
        stored.setBoardText(canonicalPos, std::string(text));
    }

    g_client->save(*g_board, g_rule, stored, OverwriteRule::Always);
    flushWrites();
}

std::string currentDisplayText()
{
    DBRecord stored;
    if (!queryCurrentRecord(stored))
        return {};

    DBRecord display {Database::LABEL_NONE};
    display.setComment(stored.comment());

    std::map<int, std::string> boardTexts;
    for (const auto &[pos, text] : stored.getAllBoardTexts())
        boardTexts.emplace(int(pos), std::string(text));

    // Enumerating all 225 points intentionally preserves the existing workbench feature that
    // allows @BTXT@ on stones, while still using Rapfi's canonical parent-symmetry slots.
    for (int y = 0; y < BOARD_SIZE; y++) {
        for (int x = 0; x < BOARD_SIZE; x++) {
            Pos displayPos {x, y};
            Pos canonicalPos = canonicalBoardTextPos(*g_board, g_rule, displayPos);
            auto it = boardTexts.find(int(canonicalPos));
            if (it != boardTexts.end())
                display.setBoardText(displayPos, it->second);
        }
    }
    return display.text;
}

void ensureCurrentRecord()
{
    DBRecord record;
    if (!queryCurrentRecord(record)) {
        g_client->save(*g_board,
                       g_rule,
                       DBRecord {Database::LABEL_NONE},
                       OverwriteRule::Always);
        flushWrites();
    }
}

bool replayMove(int move, bool createRecord, bool enforceForbidden)
{
    if (!ready())
        return false;

    Pos pos = toRapfiPos(move);
    if (pos != Pos::PASS && !g_board->isLegal(pos))
        return false;

    if (enforceForbidden && g_rule == RENJU && g_board->sideToMove() == BLACK
        && pos != Pos::PASS && g_board->checkForbiddenPoint(pos))
        return false;

    g_board->move(g_rule, pos);
    if (createRecord)
        ensureCurrentRecord();
    g_children.clear();
    g_boardTexts.clear();
    return true;
}

void setCurrentRawText(std::string text)
{
    DBRecord record;
    if (!queryCurrentRecord(record))
        record = DBRecord {Database::LABEL_NONE};
    record.text = std::move(text);
    g_client->save(*g_board, g_rule, record, OverwriteRule::Always);
    flushWrites();
}

std::string inputString(const char *ptr, int length)
{
    if (!ptr || length <= 0)
        return {};
    return std::string(ptr, ptr + length);
}

bool exportStorageBytes()
{
    if (!ready())
        return false;
    g_client->sync(true);

    std::vector<std::pair<DBKey, DBRecord>> records;
    const size_t total = g_storage->size();
    if (total)
        g_storage->scan(0, total, records);

    g_blobResult.clear();
    auto appendByte = [](std::vector<uint8_t> &out, int value) {
        out.push_back(static_cast<uint8_t>(value));
    };
    auto appendU16 = [](std::vector<uint8_t> &out, uint16_t value) {
        out.push_back(static_cast<uint8_t>(value));
        out.push_back(static_cast<uint8_t>(value >> 8));
    };
    auto appendU32 = [](std::vector<uint8_t> &out, uint32_t value) {
        for (int shift = 0; shift < 32; shift += 8)
            out.push_back(static_cast<uint8_t>(value >> shift));
    };
    auto appendText = [](std::vector<uint8_t> &out, const std::string &text) {
        out.insert(out.end(), text.begin(), text.end());
    };

    // ponytail: YXDB itself is little-endian, so serialize Rapfi's public records directly;
    // this avoids Emscripten's crashing filesystem stream without creating another DB model.
    appendU32(g_blobResult, static_cast<uint32_t>(records.size() + 1));
    const std::string metadata = "charset=\"UTF-8\"";
    appendU16(g_blobResult, 3);
    g_blobResult.insert(g_blobResult.end(), 3, 0);
    appendU16(g_blobResult, static_cast<uint16_t>(5 + metadata.size()));
    g_blobResult.insert(g_blobResult.end(), 5, 0);
    appendText(g_blobResult, metadata);

    for (const auto &[key, record] : records) {
        const uint16_t numStones = key.numBlackStones + key.numWhiteStones;
        const Color normalSide = numStones % 2 == 0 ? BLACK : WHITE;
        const bool addPass = normalSide != key.sideToMove;
        appendU16(g_blobResult, static_cast<uint16_t>(3 + 2 * (numStones + addPass)));
        appendByte(g_blobResult, key.rule);
        appendByte(g_blobResult, key.boardWidth);
        appendByte(g_blobResult, key.boardHeight);

        for (const StonePos *stone = key.blackStonesBegin(); stone != key.blackStonesEnd(); stone++) {
            appendByte(g_blobResult, stone->x);
            appendByte(g_blobResult, stone->y);
        }
        if (addPass && normalSide == BLACK) {
            appendByte(g_blobResult, -1);
            appendByte(g_blobResult, -1);
        }
        for (const StonePos *stone = key.whiteStonesBegin(); stone != key.whiteStonesEnd(); stone++) {
            appendByte(g_blobResult, stone->x);
            appendByte(g_blobResult, stone->y);
        }
        if (addPass && normalSide == WHITE) {
            appendByte(g_blobResult, -1);
            appendByte(g_blobResult, -1);
        }

        if (record.isNull()) {
            appendU16(g_blobResult, 0);
            continue;
        }
        appendU16(g_blobResult, static_cast<uint16_t>(5 + record.text.size()));
        appendByte(g_blobResult, record.label);
        appendU16(g_blobResult, static_cast<uint16_t>(record.value));
        appendU16(g_blobResult, static_cast<uint16_t>(record.depthbound));
        appendText(g_blobResult, record.text);
    }
    return true;
}

bool importStorageBytes(const uint8_t *bytes, int length, Rule rule)
{
    if (!bytes || length <= 0)
        return false;

    const uint8_t *cursor = bytes;
    const uint8_t *end = bytes + length;
    auto takeU16 = [&cursor, end](uint16_t &value) {
        if (end - cursor < 2)
            return false;
        value = uint16_t(cursor[0]) | (uint16_t(cursor[1]) << 8);
        cursor += 2;
        return true;
    };
    auto takeU32 = [&cursor, end](uint32_t &value) {
        if (end - cursor < 4)
            return false;
        value = uint32_t(cursor[0]) | (uint32_t(cursor[1]) << 8)
            | (uint32_t(cursor[2]) << 16) | (uint32_t(cursor[3]) << 24);
        cursor += 4;
        return true;
    };

    uint32_t recordCount = 0;
    if (!takeU32(recordCount) || recordCount == 0
        || recordCount > 10000000 || recordCount > static_cast<uint32_t>(length / 4 + 1))
        return false;

    std::vector<std::pair<DBKey, DBRecord>> records;
    for (uint32_t recordIndex = 0; recordIndex < recordCount; recordIndex++) {
        uint16_t keyLength = 0;
        if (!takeU16(keyLength) || end - cursor < keyLength)
            return false;
        const uint8_t *keyBytes = cursor;
        cursor += keyLength;

        uint16_t valueLength = 0;
        if (!takeU16(valueLength) || end - cursor < valueLength)
            return false;
        const uint8_t *valueBytes = cursor;
        cursor += valueLength;

        if (keyLength < 3)
            return false;
        const Rule sourceRule = static_cast<Rule>(keyBytes[0]);
        const int width = keyBytes[1];
        const int height = keyBytes[2];
        if (width == 0 && height == 0)
            continue;
        if (sourceRule >= RULE_NB || width != BOARD_SIZE || height != BOARD_SIZE
            || (keyLength - 3) % 2 != 0)
            return false;

        const size_t slotCount = (keyLength - 3) / 2;
        if (slotCount > BOARD_CELLS)
            return false;
        const size_t blackSlots = (slotCount + 1) / 2;
        const size_t whiteSlots = slotCount / 2;
        std::vector<Pos> blackMoves;
        std::vector<Pos> whiteMoves;
        std::vector<uint8_t> occupied(BOARD_CELLS, 0);
        bool sawPass = false;
        for (size_t slot = 0; slot < slotCount; slot++) {
            const int x = static_cast<int8_t>(keyBytes[3 + slot * 2]);
            const int y = static_cast<int8_t>(keyBytes[4 + slot * 2]);
            if (x == -1 && y == -1) {
                const size_t colorEnd = slot < blackSlots ? blackSlots : slotCount;
                if (sawPass || slot + 1 != colorEnd)
                    return false;
                sawPass = true;
                continue;
            }
            if (x < 0 || y < 0 || x >= BOARD_SIZE || y >= BOARD_SIZE)
                return false;
            const int move = y * BOARD_SIZE + x;
            if (occupied[move])
                return false;
            occupied[move] = 1;
            (slot < blackSlots ? blackMoves : whiteMoves).emplace_back(x, y);
        }

        const Color sideToMove = slotCount % 2 == 0 ? BLACK : WHITE;
        DBKey key {sourceRule,
                   BOARD_SIZE,
                   BOARD_SIZE,
                   sideToMove,
                   blackMoves,
                   whiteMoves};
        DBRecord record {Database::LABEL_NULL};
        if (valueLength) {
            record.label = static_cast<Database::DBLabel>(static_cast<int8_t>(valueBytes[0]));
            record.value = valueLength > 2
                ? static_cast<int16_t>(uint16_t(valueBytes[1]) | (uint16_t(valueBytes[2]) << 8))
                : 0;
            record.depthbound = valueLength > 4
                ? static_cast<int16_t>(uint16_t(valueBytes[3]) | (uint16_t(valueBytes[4]) << 8))
                : 0;
            if (valueLength > 5)
                record.text.assign(reinterpret_cast<const char *>(valueBytes + 5), valueLength - 5);
        }
        records.emplace_back(std::move(key), std::move(record));
    }

    if (records.empty())
        return false;
    clearAll(rule);
    for (const auto &[key, record] : records)
        g_storage->set(key, record, Database::RECORD_MASK_ALL);
    g_blobResult.clear();
    return true;
}

}  // namespace

extern "C" {

int vcfRapfiDbInit(int rule)
{
    clearAll(normalizeRule(rule));
    ensureCurrentRecord();
    return 1;
}

int vcfRapfiDbResetBoard(int rule)
{
    if (!g_storage || !g_client)
        clearAll(normalizeRule(rule));
    else
        resetBoard(normalizeRule(rule));
    return 1;
}

int vcfRapfiDbClear(int rule)
{
    clearAll(normalizeRule(rule));
    ensureCurrentRecord();
    return 1;
}

int vcfRapfiDbReady() { return ready() ? 1 : 0; }

int vcfRapfiDbEnsureCurrent()
{
    if (!ready())
        return 0;
    ensureCurrentRecord();
    return 1;
}

int vcfRapfiDbReplayMove(int move, int createRecord)
{
    return replayMove(move, createRecord != 0, false) ? 1 : 0;
}

int vcfRapfiDbPlay(int move, int createRecord)
{
    return replayMove(move, createRecord != 0, true) ? 1 : 0;
}

int vcfRapfiDbUndo()
{
    if (!ready() || g_board->ply() <= 0)
        return 0;
    g_board->undo(g_rule);
    g_children.clear();
    g_boardTexts.clear();
    return 1;
}

int vcfRapfiDbPly() { return ready() ? g_board->ply() : 0; }

int vcfRapfiDbHistoryMove(int ply)
{
    if (!ready() || ply < 0 || ply >= g_board->ply())
        return -2;
    return toWebMove(g_board->getHistoryMove(ply));
}

int vcfRapfiDbSideToMove()
{
    return ready() ? toWebStone(g_board->sideToMove()) : 1;
}

int vcfRapfiDbBoardCell(int move)
{
    if (!ready() || move < 0 || move >= BOARD_CELLS)
        return 0;
    return toWebStone(g_board->get(toRapfiPos(move)));
}

int vcfRapfiDbIsForbidden(int move)
{
    if (!ready() || g_rule != RENJU || g_board->sideToMove() != BLACK
        || move < 0 || move >= BOARD_CELLS)
        return 0;
    Pos pos = toRapfiPos(move);
    if (!g_board->isEmpty(pos))
        return 0;
    return g_board->checkForbiddenPoint(pos) ? 1 : 0;
}

int vcfRapfiDbSetDisplayText(const char *text, int length)
{
    if (!ready())
        return 0;
    setCurrentDisplayText(inputString(text, length));
    return 1;
}

int vcfRapfiDbGetDisplayText()
{
    if (!ready())
        return 0;
    g_textResult = currentDisplayText();
    return static_cast<int>(g_textResult.size());
}

int vcfRapfiDbSetRawText(const char *text, int length)
{
    if (!ready())
        return 0;
    setCurrentRawText(inputString(text, length));
    return 1;
}

int vcfRapfiDbGetRawText()
{
    if (!ready())
        return 0;
    DBRecord record;
    g_textResult = queryCurrentRecord(record) ? record.text : std::string {};
    return static_cast<int>(g_textResult.size());
}

int vcfRapfiDbSetComment(const char *text, int length)
{
    if (!ready())
        return 0;
    DBRecord record;
    if (!queryCurrentRecord(record))
        record = DBRecord {Database::LABEL_NONE};
    record.setComment(inputString(text, length));
    g_client->save(*g_board, g_rule, record, OverwriteRule::Always);
    flushWrites();
    return 1;
}

int vcfRapfiDbGetComment()
{
    if (!ready())
        return 0;
    DBRecord record;
    g_textResult = queryCurrentRecord(record) ? record.comment() : std::string {};
    return static_cast<int>(g_textResult.size());
}

const char *vcfRapfiDbTextPtr() { return g_textResult.c_str(); }
int vcfRapfiDbTextLength() { return static_cast<int>(g_textResult.size()); }

int vcfRapfiDbSetBoardText(int move, const char *text, int length)
{
    if (!ready() || move < 0 || move >= BOARD_CELLS)
        return 0;
    Pos pos = toRapfiPos(move);
    if (!g_board->isLegal(pos))
        return 0;
    g_client->setBoardText(*g_board, g_rule, pos, inputString(text, length));
    flushWrites();
    g_boardTexts.clear();
    return 1;
}

int vcfRapfiDbQueryBoardTexts()
{
    if (!ready())
        return 0;
    g_boardTexts = g_client->queryBoardTexts(*g_board, g_rule);
    return static_cast<int>(g_boardTexts.size());
}

int vcfRapfiDbBoardTextMove(int index)
{
    if (index < 0 || static_cast<size_t>(index) >= g_boardTexts.size())
        return -2;
    return toWebMove(g_boardTexts[static_cast<size_t>(index)].first);
}

int vcfRapfiDbBoardTextValue(int index)
{
    if (index < 0 || static_cast<size_t>(index) >= g_boardTexts.size()) {
        g_textResult.clear();
        return 0;
    }
    g_textResult = g_boardTexts[static_cast<size_t>(index)].second;
    return static_cast<int>(g_textResult.size());
}

int vcfRapfiDbQueryChildren()
{
    if (!ready())
        return 0;
    g_children = g_client->queryChildren(*g_board, g_rule);

    // Rapfi DBClient::queryChildren() enumerates board intersections only. The workbench
    // also supports an explicit PASS node (for RenLib / side-to-move preservation), so query
    // the same board with the opposite side-to-move as one additional database child.
    DBRecord passRecord;
    g_board->move(g_rule, Pos::PASS);
    const bool hasPass = g_client->query(*g_board, g_rule, passRecord);
    g_board->undo(g_rule);
    if (hasPass)
        g_children.emplace_back(Pos::PASS, std::move(passRecord));

    std::sort(g_children.begin(), g_children.end(), [](const auto &a, const auto &b) {
        return toWebMove(a.first) < toWebMove(b.first);
    });
    return static_cast<int>(g_children.size());
}

int vcfRapfiDbChildMove(int index)
{
    if (index < 0 || static_cast<size_t>(index) >= g_children.size())
        return -2;
    return toWebMove(g_children[static_cast<size_t>(index)].first);
}

int vcfRapfiDbRecordCount()
{
    if (!ready())
        return 0;
    flushWrites();
    return static_cast<int>(g_storage->size());
}

int vcfRapfiDbDeleteCurrentAndChildren()
{
    if (!ready() || g_board->ply() <= 0)
        return 0;
    g_client->delChildren(*g_board, g_rule);
    g_client->del(*g_board, g_rule);
    flushWrites();
    g_children.clear();
    g_boardTexts.clear();
    return 1;
}

int vcfRapfiDbCloneRule(int fromRule, int toRule)
{
    if (!ready())
        return 0;
    const Rule from = normalizeRule(fromRule);
    const Rule to = normalizeRule(toRule);
    if (from == to)
        return 1;

    g_client->sync(true);
    std::vector<std::pair<DBKey, DBRecord>> records;
    const size_t total = g_storage->size();
    if (total)
        g_storage->scan(0, total, records);

    int copied = 0;
    for (const auto &[key, record] : records) {
        if (key.rule != from)
            continue;
        DBKey cloned = key;
        cloned.rule = to;
        g_storage->set(cloned, record, Database::RECORD_MASK_ALL);
        copied++;
    }
    g_client->sync(true);
    return copied + 1;
}

int vcfRapfiDbExportYXDB()
{
    return exportStorageBytes() ? static_cast<int>(g_blobResult.size()) : 0;
}

int vcfRapfiDbImportYXDB(const uint8_t *bytes, int length, int rule)
{
    return importStorageBytes(bytes, length, normalizeRule(rule)) ? 1 : 0;
}

const uint8_t *vcfRapfiDbBytesPtr()
{
    return g_blobResult.empty() ? nullptr : g_blobResult.data();
}

int vcfRapfiDbBytesLength()
{
    return static_cast<int>(g_blobResult.size());
}

}  // extern "C"

#ifdef VCF_RAPFI_DB_BRIDGE_TEST_MAIN
#include <cassert>
#include <iostream>

static void replayPath(const std::vector<int> &moves, bool save)
{
    assert(vcfRapfiDbResetBoard(RENJU) == 1);
    vcfRapfiDbEnsureCurrent();
    for (int move : moves)
        assert(vcfRapfiDbReplayMove(move, save ? 1 : 0) == 1);
}

int main()
{
    assert(vcfRapfiDbInit(RENJU) == 1);
    assert(vcfRapfiDbExportYXDB() > 0);

    // First route to a position.
    replayPath({112, 97, 113, 98}, true);
    const std::string comment = "same canonical position";
    assert(vcfRapfiDbSetComment(comment.data(), static_cast<int>(comment.size())) == 1);
    vcfRapfiDbGetComment();
    assert(g_textResult == comment);

    // Different move order, same black/white stone sets.
    replayPath({113, 98, 112, 97}, false);
    vcfRapfiDbGetComment();
    assert(g_textResult == comment);

    // Horizontal mirror x -> 14-x:
    // 112=(7,7)->112, 97=(7,6)->97, 113=(8,7)->111, 98=(8,6)->96.
    replayPath({112, 97, 111, 96}, false);
    vcfRapfiDbGetComment();
    assert(g_textResult == comment);

    // Display recordText uses Rapfi canonical mapping, including markers placed on stones.
    replayPath({112, 97, 113, 98}, false);
    const std::string occupiedMarker = "@BTXT@87A\bsame canonical position";
    assert(vcfRapfiDbSetDisplayText(occupiedMarker.data(), static_cast<int>(occupiedMarker.size())) == 1);
    assert(vcfRapfiDbGetDisplayText() > 0);
    assert(g_textResult.find("87A") != std::string::npos);

    // The horizontal mirror must expose the same marker at mirrored occupied point 111=(6,7).
    replayPath({112, 97, 111, 96}, false);
    assert(vcfRapfiDbGetDisplayText() > 0);
    assert(g_textResult.find("67A") != std::string::npos);
    assert(g_textResult.find("same canonical position") != std::string::npos);

    // Board text is owned by the parent position and mapped through Rapfi symmetry.
    replayPath({112}, true);
    const std::string mark = "A";
    assert(vcfRapfiDbSetBoardText(97, mark.data(), 1) == 1);
    int textCount = vcfRapfiDbQueryBoardTexts();
    assert(textCount >= 1);

    // Creating a child from one orientation makes the corresponding symmetric child queryable.
    assert(vcfRapfiDbReplayMove(97, 1) == 1);
    assert(vcfRapfiDbUndo() == 1);
    int childCount = vcfRapfiDbQueryChildren();
    assert(childCount >= 1);

    // Persist the whole native position database through Rapfi's own YXDBStorage serializer.
    const int beforeCount = vcfRapfiDbRecordCount();
    const int snapshotLength = vcfRapfiDbExportYXDB();
    assert(snapshotLength > 0);
    std::vector<uint8_t> snapshot(g_blobResult.begin(), g_blobResult.end());
    assert(snapshot.size() == static_cast<size_t>(snapshotLength));

    assert(vcfRapfiDbClear(RENJU) == 1);
    assert(vcfRapfiDbRecordCount() == 1);
    assert(vcfRapfiDbImportYXDB(snapshot.data(), static_cast<int>(snapshot.size()), RENJU) == 1);
    assert(vcfRapfiDbRecordCount() == beforeCount);

    // Comment/marker and branch survive a full YXDB round-trip.
    replayPath({112, 97, 111, 96}, false);
    assert(vcfRapfiDbGetDisplayText() > 0);
    assert(g_textResult.find("67A") != std::string::npos);
    assert(g_textResult.find("same canonical position") != std::string::npos);
    replayPath({112}, false);
    assert(vcfRapfiDbQueryChildren() >= 1);

    std::cout << "vcf-rapfi-db bridge self-test passed with "
              << vcfRapfiDbRecordCount() << " records\n";
    return 0;
}
#endif
