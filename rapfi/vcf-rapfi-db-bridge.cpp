
// VCF browser bridge for Rapfi's native Board / DBClient / DBRecord model.
// The algorithms for transposition/symmetry, children, comments and board text remain in Rapfi.
// This file only supplies an in-memory DBStorage and a small C ABI for JavaScript.

#include "config.h"
#include "core/hash.h"
#include "database/dbclient.h"
#include "database/dbstorage.h"
#include "database/dbtypes.h"
#include "game/board.h"

#include <algorithm>
#include <cstdint>
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
using Database::OverwriteRule;

namespace Config {
// Minimal model tables required by Rapfi Board. PatternConfig in pattern.cpp fills P4SCORES.
// Evaluation values are irrelevant to the workbench database bridge and remain zero.
Eval EVALS[RULE_NB + 1][PCODE_NB] {};
Eval EVALS_THREAT[RULE_NB + 1][THREAT_NB] {};
Pattern4Score P4SCORES[RULE_NB + 1][PCODE_NB] {};
}  // namespace Config

namespace {

constexpr int BOARD_SIZE = 15;
constexpr int BOARD_CELLS = BOARD_SIZE * BOARD_SIZE;

class MemoryStorage final : public DBStorage
{
public:
    bool get(const DBKey &key, DBRecord &record, DBRecordMask mask) noexcept override
    {
        auto it = records.find(key);
        if (it == records.end())
            return false;

        if (mask == Database::RECORD_MASK_ALL)
            record = it->second;
        else if (mask != Database::RECORD_MASK_NONE) {
            record = DBRecord {Database::LABEL_NULL};
            record.update(it->second, mask);
        }
        return true;
    }

    void set(const DBKey &key, const DBRecord &record, DBRecordMask mask) noexcept override
    {
        auto it = records.find(key);
        if (it == records.end()) {
            DBRecord inserted {Database::LABEL_NULL};
            inserted.update(record, mask);
            // New entries still need their label when only text is being saved.
            if (mask == Database::RECORD_MASK_ALL)
                inserted = record;
            records.emplace(key, std::move(inserted));
            return;
        }

        if (mask == Database::RECORD_MASK_ALL)
            it->second = record;
        else
            it->second.update(record, mask);
    }

    void del(const DBKey &key) noexcept override { records.erase(key); }
    bool flush() noexcept override { return true; }
    size_t size() noexcept override { return records.size(); }

    Cursor scan(Cursor cursor,
                size_t count,
                std::vector<std::pair<DBKey, DBRecord>> &out) noexcept override
    {
        auto it = cursor ? records.upper_bound(cursor.lastKey) : records.begin();
        size_t copied = 0;
        for (; it != records.end() && copied < count; ++it, ++copied)
            out.emplace_back(it->first, it->second);

        if (it == records.end() || copied == 0)
            return Cursor {};
        return Cursor {out.back().first};
    }

private:
    std::map<DBKey, DBRecord> records;
};

std::unique_ptr<MemoryStorage> g_storage;
std::unique_ptr<DBClient> g_client;
std::unique_ptr<Board> g_board;
Rule g_rule = RENJU;
std::string g_textResult;
std::vector<std::pair<Pos, DBRecord>> g_children;
std::vector<std::pair<Pos, std::string>> g_boardTexts;

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
    if (g_client)
        g_client->sync(false);
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

void clearAll(Rule rule)
{
    // Client must be destroyed before storage because its destructor writes dirty cache entries.
    g_client.reset();
    g_storage = std::make_unique<MemoryStorage>();
    g_client = std::make_unique<DBClient>(*g_storage, Database::RECORD_MASK_ALL, 256, 1024);
    resetBoard(rule);
}

bool queryCurrentRecord(DBRecord &record)
{
    return ready() && g_client->query(*g_board, g_rule, record);
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
    if (!g_board->isLegal(pos))
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

    // Horizontal mirror of the same final position must hit the same Rapfi DBRecord.
    replayPath({112, 103, 111, 102}, false);
    vcfRapfiDbGetComment();
    assert(g_textResult == comment);

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

    std::cout << "vcf-rapfi-db bridge self-test passed with "
              << vcfRapfiDbRecordCount() << " records\n";
    return 0;
}
#endif
