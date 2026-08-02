from pathlib import Path
import base64
import gzip
import subprocess

root = Path(__file__).resolve().parents[1]
parts = sorted((root / "tools").glob(".generator-final-architecture-v2-payload-*"))
if not parts:
    raise RuntimeError("missing final architecture payload")

encoded = "".join(part.read_text().strip() for part in parts)
patch_bytes = gzip.decompress(base64.b64decode(encoded))
patch_file = root / "tools" / "generator-final-architecture.patch"
patch_file.write_bytes(patch_bytes)
try:
    subprocess.run(
        ["patch", "-p1", "--batch", "--forward", "-i", str(patch_file)],
        cwd=root,
        check=True,
    )
finally:
    patch_file.unlink(missing_ok=True)
