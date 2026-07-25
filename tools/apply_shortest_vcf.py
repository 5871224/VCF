from pathlib import Path

root = Path(__file__).resolve().parents[1]


def replace_once(path: str, old: str, new: str) -> None:
    target = root / path
    text = target.read_text(encoding="utf-8")
    if old not in text:
        raise SystemExit(f"missing patch anchor in {path}: {old[:100]!r}")
    target.write_text(text.replace(old, new, 1), encoding="utf-8")


shortest_inc = r'''// 保證最短的單組 VCF 搜尋。
//
// 流程：
// 1. 先在指定上限內找到任一組 VCF。
// 2. 以目前最佳路線 bestPly - 2 作為下一個合法奇數深度上限。
// 3. 找到更短路線就更新 best，直到較短範圍完整證明無解。
//
// 搜尋全程使用同一張有限容量、無覆蓋的完整盤面無解集合。
// 只有完整搜尋完成的失敗節點會寫入；容量滿後停止新增，不會錯誤剪枝。
#pragma once

namespace {

class ShortestOneExactNoWinTableV1 {
public:
    static constexpr size_t MAX_ENTRIES = 524288;

    ShortestOneExactNoWinTableV1()
    {
        table.reserve(MAX_ENTRIES);
        table.max_load_factor(0.82f);
    }

    bool has(const Position &position) const
    {
        const CompactPosition key {position.board.black, position.board.white, position.board.hash};
        return table.find(key) != table.end();
    }

    void store(const Position &position)
    {
        if (table.size() >= MAX_ENTRIES)
            return;
        table.insert({position.board.black, position.board.white, position.board.hash});
    }

private:
    std::unordered_set<CompactPosition, CompactPositionHasher> table;
};

struct ShortestOneRunnerV1 {
    int attacker = BLACK;
    int rule = RENJU;
    int maxDepth = 1;
    TimedSearchContextV4 *ctx = nullptr;
    ShortestOneExactNoWinTableV1 *transTable = nullptr;
    std::vector<CandidateList> candidatesByDepth;
    CandidateBuildScratch buildScratch;
    std::vector<uint8_t> route;
    std::vector<uint8_t> foundRoute;
    int rootCandidates = 0;

    bool dfs(Position &position, int ply, int lastDefense, int center)
    {
        if (ctx->aborted || ply >= maxDepth)
            return false;
        if (transTable->has(position))
            return false;

        const int defender = 3 - attacker;
        const Threat counter = ply == 0
            ? scanThreatAll(position, defender, rule)
            : scanThreatThrough(position, lastDefense, defender, rule);
        if (counter.hasFive || counter.count >= 2) {
            transTable->store(position);
            return false;
        }
        const int forcedPoint = counter.count == 1 ? counter.points[0] : NIL;

        CandidateList &candidates = candidatesByDepth[
            std::min<size_t>(size_t(ply / 2), candidatesByDepth.size() - 1)
        ];
        scanCandidates(position, attacker, rule, forcedPoint, center, buildScratch, candidates);
        if (ply == 0)
            rootCandidates = candidates.count;

        for (int i = 0; i < candidates.count; i++) {
            const Candidate candidate = candidates.items[i];
            if (ctx->aborted || !ctx->touch(ply + 1))
                break;

            const size_t oldSize = route.size();
            position.play(candidate.idx, attacker);
            route.push_back(candidate.idx);

            bool terminalWin = candidate.immediate || candidate.defenseCount >= 2;
            bool childWin = false;
            if (!terminalWin && candidate.defenseCount == 1) {
                const int defense = candidate.defenses[0];
                if (!fullLegal(position.board, defense, defender, rule)) {
                    terminalWin = true;
                }
                else if (ply + 2 <= maxDepth) {
                    position.play(defense, defender);
                    route.push_back(uint8_t(defense));
                    childWin = dfs(position, ply + 2, defense, candidate.idx);
                    position.undo(defense);
                }
            }

            if (terminalWin)
                foundRoute = route;

            route.resize(oldSize);
            position.undo(candidate.idx);

            if (terminalWin || childWin)
                return true;
        }

        if (!ctx->aborted)
            transTable->store(position);
        return false;
    }

    bool search(Position &position, int depth, std::vector<uint8_t> &output)
    {
        maxDepth = std::max(1, depth);
        ctx->maxDepth = maxDepth;
        route.clear();
        foundRoute.clear();
        const bool found = dfs(position, 0, -1, CENTER);
        output = foundRoute;
        return found;
    }
};

int normalizeShortestOneDepthV1(int maxDepth)
{
    int depth = std::clamp(maxDepth, 1, MAX_ROUTE_PLY);
    if ((depth & 1) == 0)
        depth--;
    return std::max(1, depth);
}

int shortestOneFindImplV1(const uint8_t *board,
                          int attacker,
                          int rule,
                          int maxDepth,
                          uint32_t encodedLimits,
                          uint8_t *outMoves,
                          uint16_t *outLength,
                          int maxMoves,
                          SearchStats *stats)
{
    const double start = legacyNowMs();
    TimedSearchContextV4 ctx;
    ctx.maxNodes = configureMultiLimitsV4(encodedLimits);
    int rootCandidates = 0;

    if (!board || !outMoves || !outLength || maxMoves <= 0
        || (attacker != BLACK && attacker != WHITE)
        || rule < FREESTYLE || rule > RENJU) {
        writeStatsMultiV4(stats, ctx, start, 0, 0, true);
        return 0;
    }

    Position position;
    position.load(board);
    ShortestOneExactNoWinTableV1 transTable;
    ShortestOneRunnerV1 runner;
    runner.attacker = attacker;
    runner.rule = rule;
    runner.ctx = &ctx;
    runner.transTable = &transTable;
    runner.candidatesByDepth.resize(size_t(MAX_ROUTE_PLY / 2 + 2));
    runner.route.reserve(MAX_ROUTE_PLY);
    runner.foundRoute.reserve(MAX_ROUTE_PLY);

    std::vector<uint8_t> bestRoute;
    const int initialDepth = normalizeShortestOneDepthV1(maxDepth);
    const bool initialFound = runner.search(position, initialDepth, bestRoute);
    rootCandidates = runner.rootCandidates;

    int status = 0;
    if (initialFound && !bestRoute.empty()) {
        status = ctx.aborted ? 1 : 2;
        while (!ctx.aborted && bestRoute.size() > 1) {
            const int shorterDepth = int(bestRoute.size()) - 2;
            std::vector<uint8_t> shorterRoute;
            const bool shorterFound = runner.search(position, shorterDepth, shorterRoute);
            if (ctx.aborted) {
                status = 1;
                break;
            }
            if (!shorterFound) {
                status = 2;
                break;
            }
            if (shorterRoute.empty() || shorterRoute.size() >= bestRoute.size()) {
                ctx.aborted = true;
                status = 1;
                break;
            }
            bestRoute.swap(shorterRoute);
        }
    }

    const int length = std::min<int>(bestRoute.size(), maxMoves);
    *outLength = uint16_t(length);
    if (length > 0)
        std::copy_n(bestRoute.begin(), length, outMoves);
    writeStatsMultiV4(stats, ctx, start, length > 0 ? 1 : 0, rootCandidates);
    return status;
}

int shortestOneV1SelfTest()
{
    std::array<uint8_t, BOARD_CELLS> board {};
    for (int x = 3; x <= 6; x++)
        board[7 * BOARD_SIZE + x] = BLACK;
    std::array<uint8_t, MAX_ROUTE_PLY> moves {};
    uint16_t length = 0;
    SearchStats stats {};
    const int status = shortestOneFindImplV1(board.data(), BLACK, RENJU, 15, 100000,
                                             moves.data(), &length, MAX_ROUTE_PLY, &stats);
    if (status != 2 || length != 1 || stats.aborted)
        return 401;
    return 0;
}

} // namespace

extern "C" VCF_LEGACY_SEARCH_KEEPALIVE int vcfBbFindShortestOne(const uint8_t *board,
                                                                   int attacker,
                                                                   int rule,
                                                                   int maxDepth,
                                                                   uint32_t encodedLimits,
                                                                   uint8_t *outMoves,
                                                                   uint16_t *outLength,
                                                                   int maxMoves,
                                                                   SearchStats *stats)
{
    return shortestOneFindImplV1(board, attacker, rule, maxDepth, encodedLimits,
                                 outMoves, outLength, maxMoves, stats);
}
'''
(root / "rapfi/vcf-bitboard-search-shortest-one-v1.inc").write_text(shortest_inc, encoding="utf-8")

replace_once(
    "rapfi/vcf-bitboard-search-v2.cpp",
    '#include "vcf-bitboard-search-time-limit-v4.inc"\n#define LegacyTransTable ExactPositionTransTableV3',
    '#include "vcf-bitboard-search-time-limit-v4.inc"\n#include "vcf-bitboard-search-shortest-one-v1.inc"\n#define LegacyTransTable ExactPositionTransTableV3',
)
replace_once(
    "rapfi/vcf-bitboard-search-v2.cpp",
    "    const int multiResult = vcfBbSearchV2SelfTestMultiV3();\n    if (multiResult != 0)\n        return multiResult;",
    "    const int shortestResult = shortestOneV1SelfTest();\n    if (shortestResult != 0)\n        return shortestResult;\n    const int multiResult = vcfBbSearchV2SelfTestMultiV3();\n    if (multiResult != 0)\n        return multiResult;",
)

worker = root / "rapfi/vcf-bitboard-worker.js"
text = worker.read_text(encoding="utf-8")
shortest_worker = r'''
function findShortestVCF(param) {
  if (!api.findShortestOne) throw new Error("目前 Wasm 不支援最短單組 VCF");
  const board = toBoard(param.arr);
  writeBoard(board);
  const maxDepth = Math.max(1, Math.min(MAX_ROUTE_PLY, Number(param.maxDepth) || 200));
  const maxNode = Math.max(1, Math.min(0xffffffff, Number(param.maxNode) || 5_000_000));
  moduleInstance.HEAPU8.fill(0, ptr.moves, ptr.moves + MAX_ROUTE_PLY);
  moduleInstance.HEAPU16[ptr.lengths >>> 1] = 0;

  const status = api.findShortestOne(
    ptr.board,
    Number(param.color) || 1,
    Number(param.rules ?? currentRules),
    maxDepth,
    maxNode,
    ptr.moves,
    ptr.lengths,
    MAX_ROUTE_PLY,
    ptr.stats,
  );
  const length = moduleInstance.HEAPU16[ptr.lengths >>> 1];
  const route = length
    ? Array.from(moduleInstance.HEAPU8.subarray(ptr.moves, ptr.moves + length))
    : [];
  return {
    ...readStats(),
    vcfCount: route.length ? 1 : 0,
    winMoves: route.length ? [route] : [],
    searchMode: "shortest-one",
    shortestProven: status === 2,
    bestKnown: status >= 1,
  };
}

'''
anchor = "function validateRoute(param) {"
if anchor not in text:
    raise SystemExit("worker function anchor missing")
text = text.replace(anchor, shortest_worker + anchor, 1)
api_anchor = '''      findModeV3: moduleInstance._vcfBbFindModeV3
        ? moduleInstance.cwrap("vcfBbFindModeV3", "number", Array(13).fill("number"))
        : null,'''
api_replacement = api_anchor + '''
      findShortestOne: moduleInstance._vcfBbFindShortestOne
        ? moduleInstance.cwrap("vcfBbFindShortestOne", "number", Array(9).fill("number"))
        : null,'''
if api_anchor not in text:
    raise SystemExit("worker api anchor missing")
text = text.replace(api_anchor, api_replacement, 1)
handler_anchor = '      case "findVCF": result = findVCF(data || {}); break;'
if handler_anchor not in text:
    raise SystemExit("worker handler anchor missing")
text = text.replace(handler_anchor, handler_anchor + '\n      case "findShortestVCF": result = findShortestVCF(data || {}); break;', 1)
worker.write_text(text, encoding="utf-8")

ui = r'''"use strict";

(function installShortestVcfUi() {
  let attempts = 0;

  const init = () => {
    const multiButton = document.getElementById("btn-multi-vcf");
    if (!multiButton || !window.VCFBitboard?.main) {
      if (attempts++ < 200) window.setTimeout(init, 50);
      return;
    }
    if (document.getElementById("btn-shortest-vcf")) return;

    const button = document.createElement("button");
    button.id = "btn-shortest-vcf";
    button.type = "button";
    button.className = multiButton.className;
    button.textContent = "最短 VCF";
    multiButton.insertAdjacentElement("afterend", button);

    if (typeof setBusy === "function") {
      const baseSetBusy = setBusy;
      setBusy = function(value) {
        baseSetBusy(value);
        button.disabled = Boolean(value);
      };
    }

    const integerValue = (id, fallback, max) => {
      const raw = document.getElementById(id)?.value;
      const parsed = Math.trunc(Number(raw));
      return Number.isFinite(parsed) ? Math.max(0, Math.min(max, parsed)) : fallback;
    };
    const packLimits = (seconds, millions) => (
      0x80000000 + seconds * 1024 + millions
    ) >>> 0;
    const formatNodes = value => `${Number(value || 0).toLocaleString("zh-TW")} 節點`;
    const showStatus = message => {
      if (typeof setStatus === "function") setStatus(message);
      else console.log(message);
    };

    button.addEventListener("click", async event => {
      event.preventDefault();
      event.stopImmediatePropagation();

      const arr = window._getArr?.();
      if (!arr || !arr.slice(0, 225).some(value => value > 0)) {
        showStatus("請先擺好棋型");
        return;
      }

      const color = typeof getAColor === "function" ? getAColor() : 1;
      const colorName = color === 1 ? "黑" : "白";
      const seconds = integerValue("vcf-multi-time-seconds", 30, 2097151);
      const millions = integerValue("vcf-multi-node-millions", 20, 1023);
      const encodedLimits = packLimits(seconds, millions);
      const started = performance.now();
      let timer = 0;

      if (typeof setBusy === "function") setBusy(true);
      button.disabled = true;
      window._clearVCF?.();
      window._clearAnalysis?.();
      if (typeof resetVcfGroups === "function") resetVcfGroups();

      const updateProgress = () => {
        const elapsedSeconds = ((performance.now() - started) / 1000).toFixed(1);
        showStatus(`正在搜尋 ${colorName}子最短 VCF……已執行 ${elapsedSeconds} 秒`);
      };

      try {
        updateProgress();
        timer = window.setInterval(updateProgress, 250);
        const info = await window.VCFBitboard.main.call("findShortestVCF", {
          arr: Array.from(arr).slice(0, 225),
          color,
          rules: window.VCFBitboard.rules,
          maxDepth: 200,
          maxNode: encodedLimits,
        });
        window.clearInterval(timer);
        timer = 0;

        const route = info?.winMoves?.[0] || [];
        const elapsedText = `${((performance.now() - started) / 1000).toFixed(3)} 秒`;
        const statsText = `${elapsedText}，${formatNodes(info?.nodeCount)}`;

        if (route.length) {
          try { lastVCFMoves = route; } catch (_) {}
          window._showVCF?.(route, color);
          if (info.shortestProven) {
            const shorterBound = Math.max(0, route.length - 2);
            showStatus(`${colorName}子最短 VCF：${route.length} 手；已完整證明 ${shorterBound} 手以內無解（${statsText}）`);
          } else {
            showStatus(`${colorName}子已找到 ${route.length} 手 VCF，但搜尋因限制中止，尚未證明為最短（${statsText}）`);
          }
        } else if (info?.aborted) {
          showStatus(`${colorName}子在限制內未找到 VCF，搜尋尚未完整（${statsText}）`);
        } else {
          showStatus(`${colorName}子在搜尋上限內無 VCF（${statsText}）`);
        }
      } catch (error) {
        console.error(error);
        showStatus(`最短 VCF 搜尋失敗：${error?.message || error}`);
      } finally {
        if (timer) window.clearInterval(timer);
        if (typeof setBusy === "function") setBusy(false);
        button.disabled = false;
      }
    }, true);
  };

  init();
})();
'''
(root / "rapfi/vcf-shortest-vcf-ui.js").write_text(ui, encoding="utf-8")

main = root / "rapfi/vcf-bitboard-main.js"
text = main.read_text(encoding="utf-8")
main_anchor = "  if (!installGeneratorNodeLimit()) {"
loader = '''  const shortestUiScript = document.createElement("script");
  shortestUiScript.src = new URL("rapfi/vcf-shortest-vcf-ui.js", document.baseURI).href;
  shortestUiScript.defer = true;
  document.head.appendChild(shortestUiScript);

'''
if main_anchor not in text:
    raise SystemExit("main loader anchor missing")
text = text.replace(main_anchor, loader + main_anchor, 1)
main.write_text(text, encoding="utf-8")

spec = root / "新版Bitboard VCF規格.MD"
text = spec.read_text(encoding="utf-8")
text = text.replace(
    '| `rapfi/vcf-bitboard-search-time-limit-v4.inc` | 多組時間、節點限制與停止狀態 |',
    '| `rapfi/vcf-bitboard-search-time-limit-v4.inc` | 多組與最短單組的時間、節點限制與停止狀態 |\n| `rapfi/vcf-bitboard-search-shortest-one-v1.inc` | 保證最短的單組有界 DFS 與精確無解集合 |',
    1,
)
text = text.replace(
    '| `rapfi/rapfi-bitboard-dashboard.js` | 棋盤、搜尋選項、結果與進度 |',
    '| `rapfi/rapfi-bitboard-dashboard.js` | 棋盤、搜尋選項、結果與進度 |\n| `rapfi/vcf-shortest-vcf-ui.js` | 「最短 VCF」按鈕、進度與完整證明狀態 |',
    1,
)
section_anchor = "## 4. 多組路線處理"
section = '''### 3.4 `shortest-one`

用途：只回傳一組已證明最短的 VCF。

- 全程單執行緒，不拆分根候選。
- 先在最大深度內找到任一組路線，作為目前最佳上限。
- 合法 VCF 路線長度必為奇數 ply；尋找更短反例時固定使用 `bestPly - 2`，不使用 `bestPly - 1`。
- 找到更短反例後更新最佳路線，再以新的 `bestPly - 2` 繼續。
- 同一次搜尋的各次縮限共用完整黑白盤面無解集合；只有完整證明失敗的盤面可寫入。
- 無解集合最多保存 524,288 個盤面；容量滿後停止新增，不覆蓋既有項目。
- 較短範圍完整無解時才設定 `shortestProven = true`。
- 因時間或節點限制中止時保留目前最佳路線，但介面只能顯示「尚未證明為最短」。
- 工作台按鈕名稱為「最短 VCF」，使用與多組搜尋相同的時間與節點限制輸入。

'''
if section_anchor not in text:
    raise SystemExit("spec section anchor missing")
text = text.replace(section_anchor, section + section_anchor, 1)
spec.write_text(text, encoding="utf-8")

agents = root / "AGENTS.md"
text = agents.read_text(encoding="utf-8")
agent_anchor = "- 單組使用專用 256K 四路精確同型表。"
if agent_anchor not in text:
    raise SystemExit("AGENTS anchor missing")
text = text.replace(
    agent_anchor,
    agent_anchor + '\n- 「最短 VCF」使用 `shortest-one` 單執行緒有界 DFS；以 `bestPly - 2` 排除更短路線，限制中止時不得宣告最短。',
    1,
)
agents.write_text(text, encoding="utf-8")

for path in list((root / ".github").rglob("*")) + list((root / "rapfi").rglob("*")):
    if not path.is_file() or path.suffix.lower() not in {".yml", ".yaml", ".sh", ".ps1", ".md"}:
        continue
    try:
        source = path.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        continue
    if "EXPORTED_FUNCTIONS" not in source or "_vcfBbFindModeV3" not in source or "_vcfBbFindShortestOne" in source:
        continue
    source = source.replace("'_vcfBbFindModeV3',", "'_vcfBbFindModeV3','_vcfBbFindShortestOne',")
    path.write_text(source, encoding="utf-8")
