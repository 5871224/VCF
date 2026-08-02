#!/usr/bin/env python3
"""Build the GitHub Pages artifact from an explicit browser-runtime allowlist."""

from __future__ import annotations

import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SITE = ROOT / "_site"

ROOT_FILES = [
    "makevcf-mobile.js",
    "makevcf-layout.js",
    "makevcf-optimized-search-v2.js",
    "README.md",
    "AGENTS.md",
    "規格書.MD",
    "禁手判斷規格.MD",
    "檔案用途總覽.MD",
]
EVAL_FILES = [
    "Evaluator.js",
    "EvaluatorCore.js",
    "EvaluatorJScript.js",
    "EvaluatorWebassembly.js",
    "Evaluator.wasm",
    "worker.js",
]
RAPFI_FILES = [
    "SOURCE.md",
    "rapfi-app.js",
    "rapfi-vcf-tools.js",
    "rapfi-worker.js",
    "vcf-candidate-worker.js",
    "vcf-bitboard-main.js",
    "vcf-bitboard-worker.js",
    "vcf-bitboard-generator-compat.js",
    "rapfi-bitboard-dashboard.js",
    "vcf-shortest-vcf-ui.js",
    "vcf-forbidden-overlay.js",
    "rapfi-workbench-header.js",
    "rapfi-question-bank.js",
]


def copy_file(source: Path, destination: Path) -> None:
    if not source.is_file():
        raise FileNotFoundError(source)
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source, destination)


def main() -> None:
    shutil.rmtree(SITE, ignore_errors=True)
    SITE.mkdir(parents=True)

    copy_file(ROOT / "makevcf.html", SITE / "index.html")
    for source in sorted(ROOT.glob("makevcf-generator-*.js")):
        copy_file(source, SITE / source.name)
    for name in ROOT_FILES:
        copy_file(ROOT / name, SITE / name)

    copy_file(ROOT / "emoji" / "emoji.js", SITE / "emoji" / "emoji.js")
    for name in EVAL_FILES:
        copy_file(ROOT / "eval" / name, SITE / "eval" / name)

    copy_file(ROOT / "rapfi" / "index.html", SITE / "rapfi" / "lab.html")
    for name in RAPFI_FILES:
        copy_file(ROOT / "rapfi" / name, SITE / "rapfi" / name)

    engine_dir = SITE / "rapfi" / "engine"
    engine_dir.mkdir(parents=True, exist_ok=True)
    cache_patterns = [
        (ROOT / ".cache" / "rapfi-wasm", "rapfi-single-simd128.*"),
        (ROOT / ".cache" / "vcf-pattern-engine", "vcf-pattern-engine.*"),
        (ROOT / ".cache" / "vcf-bitboard-engine", "vcf-bitboard-engine.*"),
    ]
    for cache_dir, pattern in cache_patterns:
        matches = sorted(cache_dir.glob(pattern))
        if not matches:
            raise FileNotFoundError(f"missing build output: {cache_dir / pattern}")
        for source in matches:
            copy_file(source, engine_dir / source.name)

    (SITE / ".nojekyll").touch()

    forbidden = [
        SITE / "makevcf.html",
        SITE / "rapfi" / "index.html",
        SITE / "app",
        SITE / "cpp",
        SITE / "bitboard",
        SITE / "tests",
        SITE / "upstream",
        SITE / "rapfi" / "vcf-bitboard-worker-v4.js",
        SITE / "rapfi" / "vcf-first-nontarget-worker.js",
        SITE / "eval" / "engine.js",
    ]
    present = [str(path.relative_to(SITE)) for path in forbidden if path.exists()]
    if present:
        raise RuntimeError(f"forbidden Pages paths: {present}")

    html = (SITE / "index.html").read_text(encoding="utf-8")
    required_tokens = [
        "vcf-bitboard-main.js",
        "makevcf-generator-core.js",
        "rapfi-bitboard-dashboard.js",
        "vcf-shortest-vcf-ui.js",
        "vcf-forbidden-overlay.js",
    ]
    missing = [token for token in required_tokens if token not in html]
    if missing:
        raise RuntimeError(f"root entry is missing scripts: {missing}")

    files = [path for path in SITE.rglob("*") if path.is_file()]
    print(f"Prepared Pages allowlist: {len(files)} files")


if __name__ == "__main__":
    main()
