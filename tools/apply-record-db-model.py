from pathlib import Path

for script in [
    "tools/apply-record-db-model-core.py",
    "tools/fix-record-state-architecture.py",
    "tools/fix-record-format-backcompat.py",
]:
    source = Path(script).read_text(encoding="utf-8")
    exec(compile(source, script, "exec"))
