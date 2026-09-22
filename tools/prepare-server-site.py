#!/usr/bin/env python3
"""Add server-only Google/YXDB features to an already prepared static VCF site."""

from __future__ import annotations

import argparse
import json
import shutil
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
MARKER = "<!-- vcf-server-cloud -->"


def copy_file(source: Path, destination: Path) -> None:
    if not source.is_file():
        raise FileNotFoundError(source)
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source, destination)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--site", type=Path, required=True)
    parser.add_argument("--yxdb-engine-dir", type=Path, required=True)
    parser.add_argument("--api-url", required=True)
    parser.add_argument("--revision", required=True)
    args = parser.parse_args()

    site = args.site.resolve()
    index = site / "index.html"
    if not index.is_file():
        raise FileNotFoundError(index)
    if not args.api_url.startswith(("/", "https://")):
        raise ValueError("api-url must be an absolute path or HTTPS URL")
    revision = args.revision.strip()
    if not revision or not all(char.isalnum() or char in "._-" for char in revision):
        raise ValueError("revision contains unsupported characters")

    copy_file(ROOT / "rapfi" / "vcf-lz4-cloud.js", site / "rapfi" / "vcf-lz4-cloud.js")
    for name in ("vcf-yxdb-index.js", "vcf-yxdb-index.wasm"):
        copy_file(args.yxdb_engine_dir / name, site / "rapfi" / "engine" / name)

    html = index.read_text(encoding="utf-8")
    if MARKER in html or "</body>" not in html:
        raise RuntimeError("server feature injection point is missing or duplicated")
    version = revision[:12]
    block = f"""{MARKER}
<script>window.VCF_CLOUD_API_URL={json.dumps(args.api_url, ensure_ascii=False)};</script>
<script src="https://accounts.google.com/gsi/client"></script>
<script src="rapfi/engine/vcf-yxdb-index.js?v={version}"></script>
<script src="rapfi/vcf-lz4-cloud.js?v={version}"></script>
"""
    index.write_text(html.replace("</body>", block + "\n</body>", 1), encoding="utf-8", newline="\n")

    deployment = {
        "source": "5871224/VCF",
        "revision": revision,
        "target": "BD1",
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }
    (site / "deployment.json").write_text(
        json.dumps(deployment, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
        newline="\n",
    )
    print(f"Prepared server site for {deployment['source']}@{revision}")


if __name__ == "__main__":
    main()
