from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def read(path):
    return (ROOT / path).read_text(encoding="utf-8")


def write(path, text):
    (ROOT / path).write_text(text, encoding="utf-8")


def replace_once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected 1 anchor, got {count}")
    return text.replace(old, new, 1)


path = "makevcf-layout.js"
s = read(path)

old = '''    renderNextMoveMarkers(event.detail?.nextMoves || []);
    if (!currentReplayRoute().length) {
      prevStepButton.disabled = !event.detail?.canPrev;
      nextStepButton.disabled = !event.detail?.canNext;
      previousBranchButton.disabled = !event.detail?.canPrev;
      nextBranchButton.disabled = !event.detail?.canNext;
    }
'''
new = '''    renderNextMoveMarkers(event.detail?.nextMoves || []);
'''
s = replace_once(s, old, new, "manual navigation buttons stay enabled")

old = '''  function updateImportedBranchButtons() {
    if (!importedTree) return;
    const current = importedTree.current;
    const canPrev = Boolean(current?.parent && current.parent.navigable !== false);
    const canNext = Boolean(current?.children?.length);
    if (prevStepButton) prevStepButton.disabled = !canPrev;
    if (nextStepButton) nextStepButton.disabled = !canNext;
    if (previousBranchButton) previousBranchButton.disabled = !canPrev;
    if (nextBranchButton) nextBranchButton.disabled = !canNext;
  }
'''
new = '''  function updateImportedBranchButtons() {
    // 四顆棋譜導覽鍵固定可按；到起點／末端時由導覽函式停在邊界並回報狀態。
  }
'''
s = replace_once(s, old, new, "imported navigation buttons stay enabled")

write(path, s)
