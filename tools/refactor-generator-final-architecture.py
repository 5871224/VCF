from pathlib import Path
import base64
import gzip
import hashlib
import subprocess

root = Path(__file__).resolve().parents[1]
parts = sorted((root / "tools").glob(".generator-final-architecture-v2-payload-*"))
expected = {
    "00": (17000, "14954cd00f30d349684713e60a83d685b6e2053edf42d0bc7fbb41b7b55f9209"),
    "01": (17000, "92fc9adc2ac8ef7496be49c003dc117decd3e807da4a5f9b94e533f790f1ee79"),
    "02": (17000, "a74f909ff6035bf275b73737893f94e7bea2bb18d7dfc28ab2e6c5b0fe5a7f1b"),
    "03": (17000, "c534101e9a2613bd7adca1a830411a114671a4cf282b365ca35b6018787e6abd"),
    "04": (13224, "a24cb4f446d87a22a6b3eaddd168a650692b976f14634c5922d9f42cdbffadbb"),
}
if len(parts) != len(expected):
    raise RuntimeError(f"expected {len(expected)} payload chunks, found {len(parts)}")

chunks = []
for part in parts:
    suffix = part.name.rsplit("-", 1)[-1]
    data = part.read_text().strip()
    length, digest = expected[suffix]
    actual_digest = hashlib.sha256(data.encode()).hexdigest()
    print(f"payload {suffix}: length={len(data)} sha256={actual_digest}")
    if len(data) != length or actual_digest != digest:
        raise RuntimeError(f"payload {suffix} checksum mismatch")
    chunks.append(data)

encoded = "".join(chunks)
if hashlib.sha256(encoded.encode()).hexdigest() != "c5c1464ef266e23fe8ddf0ed621f20bbe790fb04e88d58ccce8f1792b6cc26c1":
    raise RuntimeError("combined payload checksum mismatch")
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
