#!/usr/bin/env python3
from __future__ import annotations

from pathlib import Path
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def write(path: str, text: str) -> None:
    (ROOT / path).write_text(text, encoding="utf-8")


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected one match, got {count}")
    return text.replace(old, new, 1)


def patch_header() -> None:
    path = "rapfi/rapfi-workbench-header.js"
    text = read(path)

    text = replace_once(text,
'''      if (!Number.isInteger(index) || index < 0 || index >= BOARD_CELLS) return null;
      if (stone !== expectedStone || replay[index] !== EMPTY) return null;
      replay[index] = stone;
      normalized.push({
        index,
        stone,
        recordText: typeof raw?.recordText === "string" ? raw.recordText : "",
      });
      expectedStone = expectedStone === BLACK ? WHITE : BLACK;''',
'''      if (!Number.isInteger(index) || (index !== PASS && (index < 0 || index >= BOARD_CELLS))) return null;
      if (stone !== expectedStone) return null;
      if (index !== PASS) {
        if (replay[index] !== EMPTY) return null;
        replay[index] = stone;
      }
      normalized.push({
        index,
        stone,
        recordText: typeof raw?.recordText === "string" ? raw.recordText : "",
      });
      expectedStone = expectedStone === BLACK ? WHITE : BLACK;''',
        "normalizeSetupHistory PASS")

    text = replace_once(text,
'''    const routeList = normalizedRoutes(routes);
    const side = routeList.length ? Number(attacker) : 0;''',
'''    const routeList = normalizedRoutes(routes);
    if (Array.isArray(history) && history.some(raw => Number(raw?.index ?? raw?.move) === PASS)) {
      throw new Error("YXDB 無法表示 PASS 後改變輪次但盤面不變的手順；含 PASS 的棋譜請改用 RenLib (.lib)。");
    }
    const side = routeList.length ? Number(attacker) : 0;''',
        "YXDB PASS rejection")

    text = replace_once(text,
'''        if (!Number.isInteger(index) || index < 0 || index >= BOARD_CELLS || stone !== expected || board[index]) return null;
        board[index] = stone;
        expected = oppositeStone(expected);''',
'''        if (!Number.isInteger(index) || (index !== PASS && (index < 0 || index >= BOARD_CELLS)) || stone !== expected) return null;
        if (index !== PASS) {
          if (board[index]) return null;
          board[index] = stone;
        }
        expected = oppositeStone(expected);''',
        "record replay PASS")

    helpers = '''
    const transformRecordText = (value, transform) => {
      const raw = String(value || "").replace(/\\0+$/g, "");
      if (!raw.startsWith("@BTXT@")) return raw;
      const separator = raw.indexOf("\\b");
      const markerPart = raw.slice(6, separator >= 0 ? separator : raw.length);
      const suffix = separator >= 0 ? raw.slice(separator) : "";
      const decode = char => {
        if (/^[0-9]$/.test(char)) return char.charCodeAt(0) - 48;
        if (/^[A-F]$/i.test(char)) return char.toUpperCase().charCodeAt(0) - 55;
        return -1;
      };
      const encode = number => Number(number).toString(16).toUpperCase();
      const lines = markerPart.split("\\n").map(line => {
        if (line.length <= 2) return line;
        const x = decode(line[0]);
        const y = decode(line[1]);
        if (x < 0 || x >= BOARD_SIZE || y < 0 || y >= BOARD_SIZE) return line;
        const [tx, ty] = transformXY(x, y, transform);
        return `${encode(tx)}${encode(ty)}${line.slice(2)}`;
      });
      return `@BTXT@${lines.join("\\n")}${suffix}`;
    };
    const transformMove = (move, transform) => {
      if (!Number.isInteger(move) || move === PASS) return move;
      const x = move % BOARD_SIZE;
      const y = Math.floor(move / BOARD_SIZE);
      const [tx, ty] = transformXY(x, y, transform);
      return ty * BOARD_SIZE + tx;
    };
    const transformTree = (node, transform) => {
      node.move = transformMove(node.move, transform);
      node.recordText = transformRecordText(node.recordText, transform);
      for (const child of node.children) transformTree(child, transform);
    };
'''
    text = replace_once(text,
'''    global.VCFWorkbenchRecord = {''',
helpers + '''
    global.VCFWorkbenchRecord = {''',
        "record transform helpers")

    methods = '''
      appendPass() {
        if (!exact) return false;
        const expected = currentHistory().length % 2 === 0 ? BLACK : WHITE;
        let childIndex = current.children.findIndex(child => child.move === PASS && child.stone === expected);
        if (childIndex < 0) {
          const child = makeNode(PASS, expected, "", current);
          current.children.push(child);
          childIndex = current.children.length - 1;
        }
        current.selectedChild = childIndex;
        current = current.children[childIndex];
        return applyCurrentBoard();
      },
      deleteCurrentAndFollowing() {
        if (!exact || !current.parent) return false;
        const parent = current.parent;
        const index = parent.children.indexOf(current);
        if (index < 0) return false;
        parent.children.splice(index, 1);
        parent.selectedChild = parent.children.length
          ? Math.max(0, Math.min(parent.children.length - 1, Number(parent.selectedChild || 0)))
          : 0;
        current = parent;
        return applyCurrentBoard();
      },
      transform(transform) {
        if (!exact || !Number.isInteger(Number(transform)) || Number(transform) < 0 || Number(transform) > 7) return false;
        transformTree(root, Number(transform));
        return applyCurrentBoard();
      },
'''
    text = replace_once(text,
'''      invalidate() {
        exact = false;''',
methods + '''      invalidate() {
        exact = false;''',
        "record tree APIs")

    write(path, text)


def patch_layout() -> None:
    path = "makevcf-layout.js"
    text = read(path)

    text = replace_once(text,
'''      if (Number.isInteger(cursor.move) && cursor.move >= 0) {
        reversed.push({''',
'''      if (Number.isInteger(cursor.move)) {
        reversed.push({''',
        "imported PASS history")

    transform_text = '''
  function transformRapfiRecordText(text, transform) {
    const raw = String(text || "").replace(/\\0+$/g, "");
    if (!raw.startsWith("@BTXT@")) return raw;
    const separator = raw.indexOf("\\b");
    const markerPart = raw.slice(6, separator >= 0 ? separator : raw.length);
    const suffix = separator >= 0 ? raw.slice(separator) : "";
    const encode = number => Number(number).toString(16).toUpperCase();
    const lines = markerPart.split("\\n").map(line => {
      if (line.length <= 2) return line;
      const x = rapfiHexCoord(line[0]);
      const y = rapfiHexCoord(line[1]);
      if (x < 0 || x >= BOARD_SIZE || y < 0 || y >= BOARD_SIZE) return line;
      const [tx, ty] = transformXY(x, y, transform);
      return `${encode(tx)}${encode(ty)}${line.slice(2)}`;
    });
    return `@BTXT@${lines.join("\\n")}${suffix}`;
  }
'''
    text = replace_once(text,
'''  // 修改注釋時只替換 DBRecord.text 的 comment 部分；若原 record 含 @BTXT@''',
transform_text + '''
  // 修改注釋時只替換 DBRecord.text 的 comment 部分；若原 record 含 @BTXT@''',
        "imported marker transform helper")

    api = '''
  window.VCFImportedRecordAPI = {
    isActive() {
      return Boolean(importedTree?.current);
    },
    setCurrentRecordText(text) {
      if (!importedTree?.current) return false;
      const node = importedTree.current;
      node.recordText = String(text || "");
      const meta = parseRapfiRecordText(node.recordText);
      node.comment = meta.comment;
      node.boardTexts = meta.boardTexts;
      renderRecordAnnotations(node);
      return true;
    },
    appendPass() {
      if (!importedTree?.current) return false;
      const current = importedTree.current;
      let child = current.children.find(item => item.move === PASS_MOVE);
      if (!child) {
        child = makeRecordNode({
          move: PASS_MOVE,
          board: current.board,
          sideToMove: opposite(current.sideToMove),
          ply: current.ply + 1,
          rule: current.rule,
        });
        child.parent = current;
        current.children.push(child);
      }
      current.selectedChild = current.children.indexOf(child);
      renderImportedNode(child);
      return true;
    },
    deleteCurrentAndFollowing() {
      if (!importedTree?.current) return false;
      const current = importedTree.current;
      const parent = current.parent;
      if (!parent || parent.navigable === false || current.synthetic || current.move == null) return false;
      const index = parent.children.indexOf(current);
      if (index < 0) return false;
      parent.children.splice(index, 1);
      parent.selectedChild = parent.children.length
        ? Math.max(0, Math.min(parent.children.length - 1, Number(parent.selectedChild || 0)))
        : 0;
      renderImportedNode(parent);
      return true;
    },
    transform(transform) {
      if (!importedTree?.root || !Number.isInteger(Number(transform)) || Number(transform) < 0 || Number(transform) > 7) return false;
      const t = Number(transform);
      const transformNode = node => {
        if (Number.isInteger(node.move) && node.move >= 0) {
          const x = node.move % BOARD_SIZE;
          const y = Math.floor(node.move / BOARD_SIZE);
          const [tx, ty] = transformXY(x, y, t);
          node.move = ty * BOARD_SIZE + tx;
        }
        node.board = transformBoard(node.board, t);
        node.recordText = transformRapfiRecordText(node.recordText, t);
        const meta = parseRapfiRecordText(node.recordText);
        node.comment = meta.comment;
        node.boardTexts = meta.boardTexts;
        for (const child of node.children) transformNode(child);
      };
      transformNode(importedTree.root);
      renderImportedNode(importedTree.current);
      return true;
    },
  };
'''
    text = replace_once(text,
'''  function moveImportedStep(direction) {''',
api + '''
  function moveImportedStep(direction) {''',
        "imported record API")

    old_listener = '''  window.addEventListener("vcf-board-changed", event => {
    if (event.detail?.source === "record-playback") return;
    if (importedTree) importedTree = null;
    queueMicrotask(() => syncCommentEditorFromRecordText(window.VCFWorkbenchRecord?.currentRecordText?.() || ""));
  });'''
    new_listener = '''  window.addEventListener("vcf-board-changed", event => {
    if (event.detail?.source === "record-playback") return;
    if (importedTree?.current && typeof window._getArr === "function") {
      const current = importedTree.current;
      const live = Uint8Array.from(window._getArr().slice(0, BOARD_CELLS));
      let added = -1;
      let additions = 0;
      let valid = true;
      for (let idx = 0; idx < BOARD_CELLS; idx++) {
        const before = current.board[idx];
        const after = live[idx];
        if (before === after) continue;
        if (before === EMPTY && after === current.sideToMove && ++additions === 1) {
          added = idx;
        } else {
          valid = false;
          break;
        }
      }
      if (valid && additions === 1) {
        let child = current.children.find(item => item.move === added);
        if (!child) {
          child = makeRecordNode({
            move: added,
            board: live,
            sideToMove: opposite(current.sideToMove),
            ply: current.ply + 1,
            rule: current.rule,
          });
          child.parent = current;
          current.children.push(child);
        } else {
          child.board = new Uint8Array(live);
        }
        current.selectedChild = current.children.indexOf(child);
        importedTree.current = child;
        queueMicrotask(() => {
          renderRecordAnnotations(child);
          importedStatus();
        });
      } else {
        importedTree = null;
      }
    }
    queueMicrotask(() => syncCommentEditorFromRecordText(window.VCFWorkbenchRecord?.currentRecordText?.() || ""));
  });'''
    text = replace_once(text, old_listener, new_listener, "preserve imported branches while editing")

    write(path, text)


def patch_entry() -> None:
    path = "makevcf.html"
    text = read(path)
    text = replace_once(text,
'''<script src="makevcf-layout.js?v=20260826-branch-jump-v4"></script>''',
'''<script src="makevcf-layout.js?v=20260826-record-tools-v1"></script>''',
        "layout cache buster")
    text = replace_once(text,
'''<script src="rapfi/rapfi-workbench-header.js?v=20260826-branch-jump-v4"></script>
<script src="rapfi/rapfi-question-bank.js"></script>''',
'''<script src="rapfi/rapfi-workbench-header.js?v=20260826-record-tools-v1"></script>
<script src="rapfi/vcf-record-tools.js?v=20260826-record-tools-v1"></script>
<script src="rapfi/rapfi-question-bank.js"></script>''',
        "record tools script")
    write(path, text)


def patch_pages_builder() -> None:
    path = "scripts/prepare-pages-site.py"
    text = read(path)
    text = replace_once(text,
'''    "rapfi-workbench-header.js",
    "rapfi-question-bank.js",''',
'''    "rapfi-workbench-header.js",
    "vcf-record-tools.js",
    "rapfi-question-bank.js",''',
        "Pages record module allowlist")
    text = replace_once(text,
'''    for name in RAPFI_FILES:
        copy_file(ROOT / "rapfi" / name, SITE / "rapfi" / name)

    engine_dir = SITE / "rapfi" / "engine"''',
'''    for name in RAPFI_FILES:
        copy_file(ROOT / "rapfi" / name, SITE / "rapfi" / name)
    for source in sorted((ROOT / "rapfi" / "record-svg").glob("*.svg")):
        copy_file(source, SITE / "rapfi" / "record-svg" / source.name)

    engine_dir = SITE / "rapfi" / "engine"''',
        "Pages SVG allowlist")
    write(path, text)


def patch_verify() -> None:
    path = "scripts/verify-workbench-architecture.js"
    text = read(path)
    text = replace_once(text,
'''  "rapfi/rapfi-workbench-header.js",
  "makevcf-generator-integrated.js",''',
'''  "rapfi/rapfi-workbench-header.js",
  "rapfi/vcf-record-tools.js",
  "makevcf-generator-integrated.js",''',
        "record tools no-overrides list")
    text = replace_once(text,
'''  'replaceRapfiComment',
]) if (!layout.includes(token)) throw new Error(`branch replay contract missing: ${token}`);''',
'''  'replaceRapfiComment',
  'window.VCFImportedRecordAPI = {',
  'appendPass()',
  'deleteCurrentAndFollowing()',
]) if (!layout.includes(token)) throw new Error(`branch replay contract missing: ${token}`);''',
        "layout record API verification")
    text = replace_once(text,
'''  'vcf-record-state-changed',
]) if (!header.includes(token)) throw new Error(`Rapfi export contract missing: ${token}`);''',
'''  'vcf-record-state-changed',
  'appendPass()',
  'deleteCurrentAndFollowing()',
  'transform(transform)',
  'YXDB 無法表示 PASS',
]) if (!header.includes(token)) throw new Error(`Rapfi export contract missing: ${token}`);''',
        "header record API verification")

    marker = '''const recordTools = read("rapfi/vcf-record-tools.js");
new Function(recordTools);
for (const token of [
  'double_arrow_left.svg',
  'photo.svg',
  'edit.svg',
  'font.svg',
  'cancel.svg',
  'number.svg',
  'flip.svg',
  'rotate_90.svg',
  'forbidden.svg',
  'circle.svg',
  'circle_n.svg',
  'vcf-record-marker-text',
  'deleteCurrentAndFollowing',
  'transformRecord(4)',
  'transformRecord(1)',
]) if (!recordTools.includes(token)) throw new Error(`record tools contract missing: ${token}`);
for (const excluded of ['share.svg', 'link.svg', 'grid_3x3.svg', 'flag.svg', 'flag_check.svg']) {
  if (recordTools.includes(excluded)) throw new Error(`excluded record control returned: ${excluded}`);
}
for (const icon of [
  'double_arrow_left.svg','arrow_left.svg','arrow_right.svg','double_arrow_right.svg','photo.svg','edit.svg','font.svg','Aa.svg','star.svg','arrow.svg','delete.svg','cancel.svg','number.svg','settings.svg','dock_top.svg','dock_left.svg','flip.svg','rotate_90.svg','forbidden.svg','circle.svg','circle_n.svg'
]) {
  if (!exists(`rapfi/record-svg/${icon}`)) throw new Error(`record SVG missing: ${icon}`);
}

'''
    text = replace_once(text,
'''const questionBank = read("rapfi/rapfi-question-bank.js");''',
marker + '''const questionBank = read("rapfi/rapfi-question-bank.js");''',
        "record tools verification block")

    text = replace_once(text,
'''if (!entry.includes('makevcf-layout.js?v=20260826-branch-jump-v4') || !entry.includes('rapfi/rapfi-workbench-header.js?v=20260826-branch-jump-v4')) {
  throw new Error("record UI scripts must be cache-busted after branch-jump navigation change");
}''',
'''if (!entry.includes('makevcf-layout.js?v=20260826-record-tools-v1')
    || !entry.includes('rapfi/rapfi-workbench-header.js?v=20260826-record-tools-v1')
    || !entry.includes('rapfi/vcf-record-tools.js?v=20260826-record-tools-v1')) {
  throw new Error("record UI scripts must be cache-busted and load the record tools module");
}''',
        "entry cache verification")

    text = replace_once(text,
'''if (!pages.includes("prepare-pages-site.py")) throw new Error("Pages does not use the deployment allowlist builder");''',
'''if (!pages.includes("prepare-pages-site.py")) throw new Error("Pages does not use the deployment allowlist builder");
const pagesBuilder = read("scripts/prepare-pages-site.py");
if (!pagesBuilder.includes('"vcf-record-tools.js"') || !pagesBuilder.includes('"record-svg"')) {
  throw new Error("Pages allowlist is missing record tools or SVG assets");
}''',
        "Pages record asset verification")
    write(path, text)


def patch_spec() -> None:
    path = "規格書.MD"
    text = read(path)
    anchor = '''- 空盤注釋保存為 `rootRecordText`；第 N 手後的盤面注釋保存於第 N 筆 history 的 `recordText`。若 record text 同時含 Rapfi `@BTXT@` 盤面文字，修改一般注釋不得破壞或重排既有 `@BTXT@` 區段。'''
    addition = anchor + '''
- 棋譜工具列沿用 `https://587.renju.org.tw/5.php` 的 SVG 圖示資源並在本專案保存副本；前／後手、前／後分支、截圖、編輯、標記、刪除後續、手順、一般設定、標題／解說顯示、鏡像、旋轉、禁手、手順減少與隱藏前 N 手均使用相同圖示語意。
- 棋譜功能固定 15×15；不提供棋盤尺寸切換、不提供定位點／跳到定位點，也不提供把棋譜內容放進網址的分享功能。
- 瀏覽模式下，棋盤左鍵為次一手、右鍵為前一手；編輯模式才可新增棋子。點已有棋子不直接刪除，刪除必須使用「刪除目前棋子及之後分支」，以避免破壞其他既有分支。
- 編輯模式下點棋盤左下角可加入一手 PASS；分支樹與 RenLib 必須保存 PASS。YXDB 無法無損表示 PASS 改變輪次而盤面不變的狀態，含 PASS 時必須拒絕 YXDB 匯出並提示改用 RenLib。
- 標記模式只有在編輯模式下可用；左鍵新增／修改目前盤面的文字標記，右鍵刪除。標記保存於 Rapfi `@BTXT@`，快捷文字包含 `A`、`★`、`→`，也可手動輸入。
- 棋譜標題屬於整份工作台棋譜，不隨盤面切換；解說仍屬於每個棋譜節點。標題與解說各有顯示開關，截圖只包含目前開啟的標題／解說。
- 手順顯示以實際 history 為準；PASS 計入手數但不在交點畫數字。可設定「手順減少值」及「隱藏前 N 手」，減少後小於等於 0 的手順不顯示。
- 鏡像與旋轉 90 度作用於整棵目前棋譜樹，不只目前盤面；所有分支落點與 `@BTXT@` 標記座標必須同步轉換。已讀取的 DB／LIB 分支樹也使用同一規則。
- 已讀取 DB／LIB 後若在編輯模式於目前節點新增棋子，必須保留既有讀入分支並新增或選取該子分支，不得因手動新增一手就丟棄整棵讀入棋譜。
- 截圖輸出 PNG，包含目前棋盤、手順、盤面標記與禁手圖層；標題及解說依各自顯示開關決定是否納入。'''
    text = replace_once(text, anchor, addition, "record tools product spec")
    write(path, text)


def patch_file_overview() -> None:
    path = "檔案用途總覽.MD"
    text = read(path)
    text = text.replace("目前共 107 個檔案。", "目前共 129 個檔案。", 1)
    anchor = '''| `rapfi/rapfi-workbench-header.js` | 正式 | 精簡頁首、規則選項、Rapfi-compatible YXDB／RenLib 序列化與盤面／VCF 檔案匯出、實驗室連結及強制重新整理。 |'''
    rows = [
        anchor,
        '| `rapfi/vcf-record-tools.js` | 正式 | 15×15 棋譜工具列、瀏覽／編輯模式、盤面標記、刪除後續分支、PASS、手順、鏡像／旋轉、標題／解說顯示與 PNG 截圖。 |',
    ]
    icon_meanings = {
        "double_arrow_left.svg":"前一分支／起始點", "arrow_left.svg":"前一手", "arrow_right.svg":"次一手", "double_arrow_right.svg":"次一分支／末端",
        "photo.svg":"截圖", "edit.svg":"編輯模式", "font.svg":"標記模式", "Aa.svg":"A 標記快捷鍵", "star.svg":"星號標記快捷鍵", "arrow.svg":"箭頭標記快捷鍵",
        "delete.svg":"清空標記輸入", "cancel.svg":"刪除目前棋子及後續分支", "number.svg":"手順顯示", "settings.svg":"棋譜設定", "dock_top.svg":"標題欄顯示",
        "dock_left.svg":"解說欄顯示", "flip.svg":"鏡像盤面", "rotate_90.svg":"旋轉 90 度", "forbidden.svg":"禁手顯示", "circle.svg":"手順減少值", "circle_n.svg":"隱藏前 N 手手順",
    }
    for name, meaning in icon_meanings.items():
        rows.append(f'| `rapfi/record-svg/{name}` | 正式 | 從原五子棋打譜頁沿用的 SVG：{meaning}。 |')
    text = replace_once(text, anchor, "\n".join(rows), "file overview record assets")
    write(path, text)


def download_icons() -> None:
    names = [
        "double_arrow_left.svg", "arrow_left.svg", "arrow_right.svg", "double_arrow_right.svg",
        "photo.svg", "edit.svg", "font.svg", "Aa.svg", "star.svg", "arrow.svg", "delete.svg", "cancel.svg",
        "number.svg", "settings.svg", "dock_top.svg", "dock_left.svg", "flip.svg", "rotate_90.svg", "forbidden.svg",
        "circle.svg", "circle_n.svg",
    ]
    target = ROOT / "rapfi" / "record-svg"
    target.mkdir(parents=True, exist_ok=True)
    for name in names:
        url = f"https://587.renju.org.tw/bb/svg/{name}"
        request = Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urlopen(request, timeout=20) as response:
            data = response.read()
        if b"<svg" not in data[:2048].lower():
            raise RuntimeError(f"downloaded asset is not SVG: {name}")
        (target / name).write_bytes(data)


def main() -> None:
    download_icons()
    patch_header()
    patch_layout()
    patch_entry()
    patch_pages_builder()
    patch_verify()
    patch_spec()
    patch_file_overview()


if __name__ == "__main__":
    main()
