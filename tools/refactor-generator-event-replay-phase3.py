from pathlib import Path
import base64
import gzip

root = Path(__file__).resolve().parents[1]
parts = sorted((root / "tools").glob(".generator-event-replay-phase3-payload-*"))
if not parts:
    raise RuntimeError("missing generator event replay phase 3 payload")
payload = "".join(part.read_text().strip() for part in parts)
source = gzip.decompress(base64.b64decode(payload))
virtual_file = root / "tools" / "refactor-generator-event-replay-phase3-expanded.py"
namespace = {"__file__": str(virtual_file), "__name__": "__main__"}
exec(compile(source, str(virtual_file), "exec"), namespace)
