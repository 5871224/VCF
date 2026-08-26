#!/usr/bin/env python3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

def read(path):
    return (ROOT / path).read_text(encoding="utf-8")

def write(path, text):
    (ROOT / path).write_text(text, encoding="utf-8")

# 1) Marker controls are a toggled group: hidden unless marker mode is active.
path = "rapfi/vcf-record-tools.js"
text = read(path)
old = '''  markerInput.setAttribute("aria-label", "盤面標記文字");

  actions.append(
'''
new = '''  markerInput.setAttribute("aria-label", "盤面標記文字");
  markerInput.classList.add("vcf-record-marker-control");
  for (const button of [markAButton, markStarButton, markArrowButton, clearMarkTextButton]) {
    button.classList.add("vcf-record-marker-control");
  }

  actions.append(
'''
if old not in text:
    raise SystemExit("marker input anchor not found")
text = text.replace(old, new, 1)
old = '''    markerInput.disabled = !state.editMode || !state.markerMode;
    for (const button of [markAButton, markStarButton, markArrowButton, clearMarkTextButton]) {
      button.disabled = markerInput.disabled;
    }
'''
new = '''    const markerControlsVisible = state.editMode && state.markerMode;
    markerInput.hidden = !markerControlsVisible;
    markerInput.disabled = !markerControlsVisible;
    for (const button of [markAButton, markStarButton, markArrowButton, clearMarkTextButton]) {
      button.hidden = !markerControlsVisible;
      button.disabled = !markerControlsVisible;
    }
'''
if old not in text:
    raise SystemExit("syncUI marker anchor not found")
text = text.replace(old, new, 1)
write(path, text)

# 2) Cache bust the record UI assets.
path = "makevcf.html"
text = read(path)
if "20260826-record-tools-v1" not in text:
    raise SystemExit("cache-bust v1 not found")
text = text.replace("20260826-record-tools-v1", "20260826-record-tools-v2")
write(path, text)

# 3) Architecture test follows the cache-bust and verifies toggled marker controls.
path = "tests/workbench-architecture.test.js"
text = read(path)
text = text.replace("20260826-record-tools-v1", "20260826-record-tools-v2")
anchor = '''if (!entry.includes('makevcf-layout.js?v=20260826-record-tools-v2')
    || !entry.includes('rapfi/rapfi-workbench-header.js?v=20260826-record-tools-v2')
    || !entry.includes('rapfi/vcf-record-tools.js?v=20260826-record-tools-v2')) {
  throw new Error("record UI scripts must be cache-busted and load the record tools module");
}
'''
if anchor not in text:
    raise SystemExit("architecture entry anchor not found")
extra = anchor + '''
const recordToolsMarkerToggle = read("rapfi/vcf-record-tools.js");
for (const token of [
  'markerInput.classList.add("vcf-record-marker-control")',
  'const markerControlsVisible = state.editMode && state.markerMode',
  'markerInput.hidden = !markerControlsVisible',
  'button.hidden = !markerControlsVisible',
  'const markerText = markerInput.value.trim()',
  'if (point.index >= 0) addOrReplaceMarker(point.index)',
]) if (!recordToolsMarkerToggle.includes(token)) throw new Error(`marker toggle contract missing: ${token}`);
'''
text = text.replace(anchor, extra, 1)
write(path, text)

# 4) Product specification.
path = "規格書.MD"
text = read(path)
old = '- 標記模式只有在編輯模式下可用；左鍵新增／修改目前盤面的文字標記，右鍵刪除。標記保存於 Rapfi `@BTXT@`，快捷文字包含 `A`、`★`、`→`，也可手動輸入。'
new = '- 標記模式只有在編輯模式下可用；平時只顯示標記模式開關，開啟後才展開標記文字輸入欄、`A`／`★`／`→` 預設文字按鈕與清空標記欄按鈕，再次關閉時整組收起。使用者先在標記欄輸入或選擇文字，再以左鍵逐點新增／修改目前盤面的文字標記，右鍵刪除。標記保存於 Rapfi `@BTXT@`。'
if old not in text:
    raise SystemExit("spec marker line not found")
text = text.replace(old, new, 1)
write(path, text)
