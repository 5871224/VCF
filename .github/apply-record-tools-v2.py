#!/usr/bin/env python3
from __future__ import annotations

import importlib.util
from pathlib import Path

HERE = Path(__file__).resolve().parent
source = HERE / "apply-record-tools.py"
spec = importlib.util.spec_from_file_location("record_patch", source)
if spec is None or spec.loader is None:
    raise RuntimeError("cannot load record patch")
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)

original_read = mod.read
original_write = mod.write


def map_path(path: str) -> str:
    if path == "scripts/prepare-pages-site.py":
        return "tools/prepare-pages-site.py"
    if path == "scripts/verify-workbench-architecture.js":
        return "tests/workbench-architecture.test.js"
    return path


def mapped_read(path: str) -> str:
    return original_read(map_path(path))


def mapped_write(path: str, text: str) -> None:
    original_write(map_path(path), text)


mod.read = mapped_read
mod.write = mapped_write
mod.main()

verify = mod.ROOT / "tests" / "workbench-architecture.test.js"
text = verify.read_text(encoding="utf-8")
text = text.replace('read("scripts/prepare-pages-site.py")', 'read("tools/prepare-pages-site.py")')
verify.write_text(text, encoding="utf-8")
