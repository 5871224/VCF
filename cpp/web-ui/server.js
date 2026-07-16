/* eslint-disable no-console */
const http = require("http");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const HOST = "127.0.0.1";
const PORT = 5173;

const publicDir = path.join(__dirname, "public");
const enginePath =
  process.env.VCF_ENGINE ||
  path.resolve(__dirname, "..", "build", "Release", "engine.exe");

function sendJson(res, status, obj) {
  const body = Buffer.from(JSON.stringify(obj));
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": body.length,
    "Cache-Control": "no-store",
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function safeJoinPublic(urlPath) {
  const clean = urlPath.split("?")[0].split("#")[0];
  const p = clean === "/" ? "/index.html" : clean;
  const abs = path.resolve(publicDir, "." + p);
  if (!abs.startsWith(publicDir)) return null;
  return abs;
}

function contentTypeFor(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".html") return "text/html; charset=utf-8";
  if (ext === ".css") return "text/css; charset=utf-8";
  if (ext === ".js") return "text/javascript; charset=utf-8";
  if (ext === ".json") return "application/json; charset=utf-8";
  if (ext === ".png") return "image/png";
  if (ext === ".svg") return "image/svg+xml; charset=utf-8";
  return "application/octet-stream";
}

function runEngineYxvcf({ size, moves, attacker }) {
  return new Promise((resolve) => {
    const child = spawn(enginePath, [], {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
      cwd: path.dirname(enginePath),
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (d) => (stdout += d.toString("utf8")));
    child.stderr.on("data", (d) => (stderr += d.toString("utf8")));

    child.on("error", (err) => {
      resolve({
        ok: false,
        error: `spawn_failed: ${String(err.message || err)}`,
        stdout,
        stderr,
      });
    });

    const lines = [];
    lines.push(`start ${size}`);
    // Use explicit color so engine position matches UI exactly.
    // Format: x,y,color (Gomocup-style board)
    lines.push("board");
    for (const m of moves) {
      // x,y,color where color: 1=black 2=white
      lines.push(`${m.x},${m.y},${m.color}`);
    }
    lines.push("done");
    // attacker currently fixed to black in engine, but keep param for UI
    if (attacker && attacker.toLowerCase() !== "black") {
      // no-op for now
    }
    lines.push("yxvcf");
    lines.push("end");

    child.stdin.write(lines.join("\n") + "\n");
    child.stdin.end();

    child.on("close", () => {
      // Engine prints "MESSAGE ..." lines; normalize to the last MESSAGE line.
      const outLines = stdout
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter(Boolean);

      const msg = [...outLines].reverse().find((l) => l.startsWith("MESSAGE "));
      const payload = msg ? msg.slice("MESSAGE ".length).trim() : "";
      let solution = null;
      if (payload && payload.toUpperCase() !== "UNKNOWN") {
        const coords = payload
          .split(/\s+/)
          .map((t) => t.trim())
          .filter(Boolean)
          .map((t) => {
            const [x, y] = t.split(",").map((n) => Number(n));
            if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
            return { x, y };
          })
          .filter(Boolean);
        solution = coords;
      }

      resolve({
        ok: true,
        enginePath,
        stdout,
        stderr,
        message: payload || null,
        solution,
      });
    });
  });
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === "GET" && req.url === "/api/health") {
      return sendJson(res, 200, { ok: true, enginePath });
    }

    if (req.method === "POST" && req.url === "/api/solve") {
      const bodyText = await readBody(req);
      let body;
      try {
        body = JSON.parse(bodyText || "{}");
      } catch {
        return sendJson(res, 400, { ok: false, error: "invalid_json" });
      }

      const size = body.size === 15 ? 15 : 15;
      const moves = Array.isArray(body.moves) ? body.moves : [];
      const attacker = typeof body.attacker === "string" ? body.attacker : "black";

      // moves: [{x,y,color}] but we only need order, and yxboard alternates colors
      const ordered = moves
        .filter(
          (m) =>
            m &&
            Number.isFinite(m.x) &&
            Number.isFinite(m.y) &&
            (m.color === 1 || m.color === 2)
        )
        .map((m) => ({ x: m.x | 0, y: m.y | 0, color: m.color | 0 }));

      const result = await runEngineYxvcf({ size, moves: ordered, attacker });
      return sendJson(res, 200, result);
    }

    if (req.method === "GET") {
      const filePath = safeJoinPublic(req.url || "/");
      if (!filePath) {
        res.writeHead(403);
        return res.end("Forbidden");
      }
      if (!fs.existsSync(filePath)) {
        res.writeHead(404);
        return res.end("Not found");
      }
      const data = fs.readFileSync(filePath);
      res.writeHead(200, { "Content-Type": contentTypeFor(filePath) });
      return res.end(data);
    }

    res.writeHead(405);
    res.end("Method not allowed");
  } catch (e) {
    sendJson(res, 500, { ok: false, error: String(e && e.message ? e.message : e) });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`VCF Web UI: http://${HOST}:${PORT}`);
  console.log(`Engine: ${enginePath}`);
});

