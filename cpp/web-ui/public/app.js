const SIZE = 15;
const EMPTY = 0;
const BLACK = 1;
const WHITE = 2;

/** @type {number[]} */
const cells = Array(SIZE * SIZE).fill(EMPTY);
/** @type {{x:number,y:number}[]|null} */
let lastSolution = null;

function idx(x, y) {
  return y * SIZE + x;
}

function get(x, y) {
  return cells[idx(x, y)];
}

function set(x, y, v) {
  cells[idx(x, y)] = v;
}

function cycle(v) {
  if (v === EMPTY) return BLACK;
  if (v === BLACK) return WHITE;
  return EMPTY;
}

function movesInOrderFromBoard() {
  // Reconstruct order by scanning for any stones is ambiguous.
  // For this simple UI, we define order by click history recorded in DOM dataset.
  // We'll maintain an array order separately for correctness.
  return order.slice();
}

/** @type {{x:number,y:number,color:number}[]} */
const order = [];

function removeFromOrder(x, y) {
  const i = order.findIndex((m) => m.x === x && m.y === y);
  if (i >= 0) order.splice(i, 1);
}

function upsertOrder(x, y, color) {
  removeFromOrder(x, y);
  if (color !== EMPTY) order.push({ x, y, color });
}

function clearAll() {
  for (let i = 0; i < cells.length; i++) cells[i] = EMPTY;
  order.length = 0;
  lastSolution = null;
  render();
  setText("message", "");
  setText("coords", "");
  setText("raw", "");
}

function setText(id, text) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = text ?? "";
}

function render() {
  const board = document.getElementById("board");
  board.innerHTML = "";

  const markMap = new Map();
  if (lastSolution) {
    lastSolution.forEach((p, i) => markMap.set(`${p.x},${p.y}`, String(i + 1)));
  }

  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const v = get(x, y);
      const cell = document.createElement("div");
      cell.className = "cell";
      cell.dataset.x = String(x);
      cell.dataset.y = String(y);

      if (v === BLACK || v === WHITE) {
        const stone = document.createElement("div");
        stone.className = `stone ${v === BLACK ? "black" : "white"}`;
        cell.appendChild(stone);
      }

      const key = `${x},${y}`;
      if (markMap.has(key)) {
        const mark = document.createElement("div");
        mark.className = "mark";
        mark.textContent = markMap.get(key);
        cell.appendChild(mark);
      }

      cell.addEventListener("click", (e) => {
        e.preventDefault();
        const cur = get(x, y);
        const next = cycle(cur);
        set(x, y, next);
        upsertOrder(x, y, next);
        lastSolution = null;
        render();
      });

      cell.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        set(x, y, EMPTY);
        removeFromOrder(x, y);
        lastSolution = null;
        render();
      });

      board.appendChild(cell);
    }
  }
}

async function refreshHealth() {
  try {
    const r = await fetch("/api/health");
    const j = await r.json();
    setText("health", j.ok ? "ok" : "not ok");
    setText("enginePath", j.enginePath || "");
  } catch (e) {
    setText("health", "offline");
    setText("enginePath", "");
  }
}

async function solve() {
  setText("message", "running...");
  setText("coords", "");
  setText("raw", "");
  lastSolution = null;
  render();

  const payload = {
    size: 15,
    attacker: "black",
    moves: movesInOrderFromBoard(),
  };

  const r = await fetch("/api/solve", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const j = await r.json();

  setText("enginePath", j.enginePath || "");
  setText("raw", (j.stdout || "") + (j.stderr ? "\n[stderr]\n" + j.stderr : ""));
  setText("message", j.message || "");

  if (Array.isArray(j.solution) && j.solution.length > 0) {
    lastSolution = j.solution;
    setText(
      "coords",
      j.solution.map((p) => `${p.x},${p.y}`).join(" ")
    );
  } else {
    lastSolution = null;
    setText("coords", "");
  }
  render();
}

document.getElementById("btnClear").addEventListener("click", clearAll);
document.getElementById("btnSolve").addEventListener("click", solve);

render();
refreshHealth();
setInterval(refreshHealth, 4000);

