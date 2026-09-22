#!/usr/bin/env python3

import json
import subprocess
import sys
import tempfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


with tempfile.TemporaryDirectory() as raw_temp:
    temp = Path(raw_temp)
    site = temp / "site"
    engine = temp / "engine"
    site.mkdir()
    engine.mkdir()
    (site / "index.html").write_text("<!doctype html><body>VCF</body>", encoding="utf-8")
    (engine / "vcf-yxdb-index.js").write_text("fake-index", encoding="utf-8")
    (engine / "vcf-yxdb-index.wasm").write_bytes(b"\x00asm")

    subprocess.run(
        [
            sys.executable,
            str(ROOT / "tools" / "prepare-server-site.py"),
            "--site",
            str(site),
            "--yxdb-engine-dir",
            str(engine),
            "--api-url",
            "/BD/api/yxdb.php",
            "--revision",
            "abc123",
        ],
        check=True,
    )

    html = (site / "index.html").read_text(encoding="utf-8")
    for token in (
        'window.VCF_CLOUD_API_URL="/BD/api/yxdb.php"',
        "accounts.google.com/gsi/client",
        "rapfi/engine/vcf-yxdb-index.js?v=abc123",
        "rapfi/vcf-lz4-cloud.js?v=abc123",
    ):
        if token not in html:
            raise AssertionError(f"server site missing {token}")
    if html.index("vcf-yxdb-index.js") > html.index("vcf-lz4-cloud.js"):
        raise AssertionError("YXDB index must load before the cloud UI")

    deployment = json.loads((site / "deployment.json").read_text(encoding="utf-8"))
    if deployment["revision"] != "abc123" or deployment["target"] != "BD1":
        raise AssertionError("deployment metadata is incorrect")
    if not (site / "rapfi" / "vcf-lz4-cloud.js").is_file():
        raise AssertionError("cloud UI was not copied")
    if (site / "rapfi" / "engine" / "vcf-yxdb-index.wasm").read_bytes() != b"\x00asm":
        raise AssertionError("YXDB engine was not copied")

print("Server site preparation test passed")
