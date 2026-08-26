from pathlib import Path
import re

header = Path("rapfi/rapfi-workbench-header.js")
s = header.read_text(encoding="utf-8")
pattern = re.compile(
    r'''\n    const originalSetBoardArr = global\._setBoardArr;.*?\n    global\.VCFWorkbenchRecord = \{''',
    re.S,
)
replacement = r'''
    document.getElementById("btn-clear")?.addEventListener("click", () => {
      queueMicrotask(() => setState([], true, readBoard()));
    });
    document.getElementById("btn-import-apply")?.addEventListener("click", () => {
      queueMicrotask(() => setState([], false, readBoard()));
    });

    global.VCFWorkbenchRecord = {'''
s, count = pattern.subn(replacement, s, count=1)
if count != 1:
    raise SystemExit(f"header architecture cleanup expected 1 replacement, got {count}")
header.write_text(s, encoding="utf-8")

layout = Path("makevcf-layout.js")
s = layout.read_text(encoding="utf-8")
old = 'const applyBoard = () => window._setBoardArr?.(Array.from(node.board), node.sideToMove, { history: historyForImportedNode(node), exact: true, source: "record-playback" });'
new = '''const applyBoard = () => {
      window._setBoardArr?.(Array.from(node.board), node.sideToMove);
      window.VCFWorkbenchRecord?.setHistory?.(historyForImportedNode(node), true);
    };'''
if old not in s:
    raise SystemExit("layout applyBoard architecture anchor not found")
s = s.replace(old, new, 1)
layout.write_text(s, encoding="utf-8")
