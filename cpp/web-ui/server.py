import json
import os
import subprocess
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from urllib.parse import urlparse

HOST = "127.0.0.1"
PORT = 5173

ROOT = Path(__file__).resolve().parent
PUBLIC = ROOT / "public"
ENGINE = Path(os.environ.get("VCF_ENGINE") or (ROOT.parent / "build" / "Release" / "engine.exe")).resolve()


def run_engine_yxvcf(size: int, moves):
    # Use explicit color so engine position matches UI exactly.
    # Format: x,y,color (Gomocup-style board)
    lines = [f"start {size}", "board"]
    for m in moves:
        lines.append(f"{m['x']},{m['y']},{m['color']}")
    lines += ["done", "yxvcf", "end"]
    inp = ("\n".join(lines) + "\n").encode("utf-8")

    try:
        p = subprocess.run(
            [str(ENGINE)],
            input=inp,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            cwd=str(ENGINE.parent),
            timeout=30,
        )
    except Exception as e:
        return {"ok": False, "error": f"spawn_failed: {e}", "enginePath": str(ENGINE)}

    stdout = p.stdout.decode("utf-8", errors="replace")
    stderr = p.stderr.decode("utf-8", errors="replace")
    out_lines = [s.strip() for s in stdout.splitlines() if s.strip()]
    msg = next((l for l in reversed(out_lines) if l.startswith("MESSAGE ")), "")
    payload = msg[len("MESSAGE ") :].strip() if msg else ""

    solution = None
    if payload and payload.upper() != "UNKNOWN":
        coords = []
        for t in payload.split():
            if "," not in t:
                continue
            xs, ys = t.split(",", 1)
            try:
                x = int(xs)
                y = int(ys)
                coords.append({"x": x, "y": y})
            except ValueError:
                pass
        solution = coords

    return {
        "ok": True,
        "enginePath": str(ENGINE),
        "stdout": stdout,
        "stderr": stderr,
        "message": payload or None,
        "solution": solution,
    }


class Handler(BaseHTTPRequestHandler):
    def _json(self, status: int, obj):
        data = json.dumps(obj).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == "/api/health":
            return self._json(200, {"ok": True, "enginePath": str(ENGINE)})

        p = parsed.path
        if p == "/":
            p = "/index.html"

        file_path = (PUBLIC / p.lstrip("/")).resolve()
        if not str(file_path).startswith(str(PUBLIC.resolve())):
            self.send_response(403)
            self.end_headers()
            return

        if not file_path.exists() or not file_path.is_file():
            self.send_response(404)
            self.end_headers()
            return

        if file_path.suffix == ".html":
            ctype = "text/html; charset=utf-8"
        elif file_path.suffix == ".css":
            ctype = "text/css; charset=utf-8"
        elif file_path.suffix == ".js":
            ctype = "text/javascript; charset=utf-8"
        else:
            ctype = "application/octet-stream"

        data = file_path.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_POST(self):
        parsed = urlparse(self.path)
        if parsed.path != "/api/solve":
            self.send_response(404)
            self.end_headers()
            return

        length = int(self.headers.get("Content-Length") or "0")
        raw = self.rfile.read(length).decode("utf-8", errors="replace")
        try:
            body = json.loads(raw or "{}")
        except Exception:
            return self._json(400, {"ok": False, "error": "invalid_json"})

        size = 15
        moves = body.get("moves") if isinstance(body.get("moves"), list) else []
        ordered = []
        for m in moves:
            if not isinstance(m, dict):
                continue
            x = m.get("x")
            y = m.get("y")
            color = m.get("color")
            if isinstance(x, int) and isinstance(y, int) and color in (1, 2):
                ordered.append({"x": x, "y": y, "color": int(color)})

        return self._json(200, run_engine_yxvcf(size, ordered))


def main():
    print(f"VCF Web UI: http://{HOST}:{PORT}")
    print(f"Engine: {ENGINE}")
    HTTPServer((HOST, PORT), Handler).serve_forever()


if __name__ == "__main__":
    main()

