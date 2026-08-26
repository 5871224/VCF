from pathlib import Path

path = Path("tests/workbench-architecture.test.js")
s = path.read_text(encoding="utf-8")
old = '''// Rapfi DB-backed record model contract.
assert.ok(layout.includes('btn-vcf-branch-prev'), '棋譜導覽需固定包含前一分支按鈕');
assert.ok(layout.includes('btn-vcf-branch-next'), '棋譜導覽需固定包含後一分支按鈕');
assert.ok(layout.includes('parseRapfiRecordText'), 'YXDB loader 必須解析 Rapfi record text');
assert.ok(layout.includes('vcf-record-text-layer'), '工作台必須顯示 Rapfi @BTXT@ 盤面標記');
assert.ok(header.includes('VCFWorkbenchRecord'), '盤面必須保存可匯出的落子 history');
assert.ok(header.includes('normalizeSetupHistory'), 'YXDB setup path 必須以實際 history 驗證');
'''
new = '''// Rapfi DB-backed record model contract.
if (!layout.includes('btn-vcf-branch-prev')) throw new Error('棋譜導覽需固定包含前一分支按鈕');
if (!layout.includes('btn-vcf-branch-next')) throw new Error('棋譜導覽需固定包含後一分支按鈕');
if (!layout.includes('parseRapfiRecordText')) throw new Error('YXDB loader 必須解析 Rapfi record text');
if (!layout.includes('vcf-record-text-layer')) throw new Error('工作台必須顯示 Rapfi @BTXT@ 盤面標記');
if (!header.includes('VCFWorkbenchRecord')) throw new Error('盤面必須保存可匯出的落子 history');
if (!header.includes('normalizeSetupHistory')) throw new Error('YXDB setup path 必須以實際 history 驗證');
'''
if old not in s:
    raise SystemExit("record contract test anchor not found")
s = s.replace(old, new, 1)
path.write_text(s, encoding="utf-8")
