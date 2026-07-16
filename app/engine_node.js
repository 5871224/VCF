const fs = require("fs");
const path = require("path");
const vm = require("vm");
const readline = require("readline");

global.self = global;
global.window = global;
global.post = () => {};
console.warn = () => {};

function findProjectRoot(startDir) {
  let current = startDir;
  for (let i = 0; i < 6; i++) {
    if (fs.existsSync(path.join(current, "eval", "Evaluator.js")) &&
        fs.existsSync(path.join(current, "emoji", "emoji.js"))) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  throw new Error("project root not found");
}

const PROJECT_ROOT = findProjectRoot(__dirname);

function loadScript(relPath) {
  const filePath = path.resolve(PROJECT_ROOT, relPath);
  const code = fs.readFileSync(filePath, "utf8");
  vm.runInThisContext(code, { filename: filePath });
}

loadScript("emoji/emoji.js");
loadScript("eval/EvaluatorJScript.js");
loadScript("eval/Evaluator.js");

const BOARD_SIZE = 15;
const BOARD_TOTAL = BOARD_SIZE * BOARD_SIZE;
const BLACK = 1;
const WHITE = 2;

const board = new Array(226).fill(0);
board[225] = -1;

let nextToMove = BLACK;
let boardMode = false;
let boardSeq = 0;

function clearBoard() {
  for (let i = 0; i < BOARD_TOTAL; i++) board[i] = 0;
  board[225] = -1;
}

function toIdx(x, y) {
  if (x < 0 || x >= BOARD_SIZE || y < 0 || y >= BOARD_SIZE) return -1;
  return y * BOARD_SIZE + x;
}

function getX(idx) {
  return idx % BOARD_SIZE;
}

function getY(idx) {
  return Math.floor(idx / BOARD_SIZE);
}

function fallbackMove() {
  const cx = 7;
  const cy = 7;
  let best = -1;
  let bestDist = Infinity;
  for (let i = 0; i < BOARD_TOTAL; i++) {
    if (board[i] !== 0) continue;
    const dx = getX(i) - cx;
    const dy = getY(i) - cy;
    const dist = dx * dx + dy * dy;
    if (dist < bestDist) {
      bestDist = dist;
      best = i;
    }
  }
  return best;
}

function parseTurnToken(token) {
  const parts = token.split(",");
  if (parts.length < 2) return null;
  const a = Number(parts[0]);
  const b = Number(parts[1]);
  if (!Number.isInteger(a) || !Number.isInteger(b)) return null;
  return [a, b];
}

function print(line) {
  process.stdout.write(String(line) + "\n");
}

function runFindVCF(color, maxVCF, maxDepth, maxNode) {
  findVCF(board, color, maxVCF, maxDepth, maxNode);
  return {
    vcfCount: vcfInfo.vcfCount,
    nodeCount: vcfInfo.nodeCount,
    winMoves: (vcfInfo.winMoves || []).map(moves => Array.from(moves)),
  };
}

function handleBoardLine(line) {
  const token = line.trim();
  if (!token) return;
  if (token.toUpperCase() === "DONE") {
    nextToMove = (boardSeq % 2 === 0) ? BLACK : WHITE;
    boardMode = false;
    print("OK");
    return;
  }

  const parts = token.split(",");
  if (parts.length < 2) return;
  const row = Number(parts[0]);
  const col = Number(parts[1]);
  if (!Number.isInteger(row) || !Number.isInteger(col)) return;

  const idx = toIdx(col, row);
  if (idx < 0) return;
  board[idx] = (boardSeq % 2 === 0) ? BLACK : WHITE;
  boardSeq++;
}

function handleCommand(line) {
  const cleaned = line.trim();
  if (!cleaned) return;

  if (boardMode) {
    handleBoardLine(cleaned);
    return;
  }

  const parts = cleaned.split(/\s+/);
  const cmd = parts[0].toUpperCase();

  if (cmd === "START") {
    clearBoard();
    nextToMove = BLACK;
    print("OK");
    return;
  }

  if (cmd === "BOARD" || cmd === "YXBOARD") {
    clearBoard();
    nextToMove = BLACK;
    boardMode = true;
    boardSeq = 0;
    return;
  }

  if (cmd === "PUT") {
    const x = Number(parts[1]);
    const y = Number(parts[2]);
    const color = Number(parts[3]);
    const idx = toIdx(x, y);
    if (idx < 0 || ![0, 1, 2].includes(color)) {
      print("ERROR");
      return;
    }
    if (color === 0) {
      board[idx] = 0;
      print("OK");
      return;
    }
    if (board[idx] !== 0) {
      print("ERROR");
      return;
    }
    board[idx] = color;
    print("OK");
    return;
  }

  if (cmd === "PLAY") {
    const x = Number(parts[1]);
    const y = Number(parts[2]);
    const idx = toIdx(x, y);
    if (idx < 0 || board[idx] !== 0) {
      print("ERROR");
      return;
    }
    board[idx] = nextToMove;
    nextToMove = nextToMove === BLACK ? WHITE : BLACK;
    print("OK");
    return;
  }

  if (cmd === "CLEAR") {
    clearBoard();
    nextToMove = BLACK;
    print("OK");
    return;
  }

  if (cmd === "BEGIN") {
    const idx = fallbackMove();
    if (idx < 0) {
      print("ERROR");
      return;
    }
    board[idx] = nextToMove;
    nextToMove = nextToMove === BLACK ? WHITE : BLACK;
    print(`${getY(idx)},${getX(idx)}`);
    return;
  }

  if (cmd === "TURN") {
    const token = parts[1];
    const parsed = token ? parseTurnToken(token) : null;
    if (!parsed) {
      print("ERROR");
      return;
    }
    const [row, col] = parsed;
    const oppIdx = toIdx(col, row);
    if (oppIdx < 0 || board[oppIdx] !== 0) {
      print("ERROR");
      return;
    }
    board[oppIdx] = nextToMove;
    nextToMove = nextToMove === BLACK ? WHITE : BLACK;

    const info = runFindVCF(nextToMove, 1, 40, 2000000);
    let responseIdx = -1;
    if (info.vcfCount > 0 && info.winMoves[0] && info.winMoves[0].length) {
      responseIdx = info.winMoves[0][0];
    } else {
      responseIdx = fallbackMove();
    }

    if (responseIdx < 0 || board[responseIdx] !== 0) {
      print("ERROR");
      return;
    }
    board[responseIdx] = nextToMove;
    nextToMove = nextToMove === BLACK ? WHITE : BLACK;
    print(`${getY(responseIdx)},${getX(responseIdx)}`);
    return;
  }

  if (cmd === "SETRULES") {
    const rules = Number(parts[1] || 2);
    setGameRules(rules === 2 ? 2 : 1);
    print("OK");
    return;
  }

  if (cmd === "YXVCF") {
    let bc = 0;
    let wc = 0;
    for (let i = 0; i < BOARD_TOTAL; i++) {
      if (board[i] === BLACK) bc++;
      else if (board[i] === WHITE) wc++;
    }
    let info = runFindVCF(nextToMove, 1, 40, 5000000);
    if (info.vcfCount > 0 && info.winMoves[0] && info.winMoves[0].length) {
      print(`MESSAGE ${info.winMoves[0].map(idx => `${getY(idx)},${getX(idx)}`).join(" ")}`);
      return;
    }

    const other = nextToMove === BLACK ? WHITE : BLACK;
    info = runFindVCF(other, 1, 40, 5000000);
    if (info.vcfCount > 0 && info.winMoves[0] && info.winMoves[0].length) {
      print(`MESSAGE WRONG_COLOR=${other === BLACK ? "B" : "W"} ${info.winMoves[0].map(idx => `${getY(idx)},${getX(idx)}`).join(" ")}`);
      return;
    }

    print(`MESSAGE UNKNOWN B=${bc} W=${wc} next=${nextToMove === BLACK ? "B" : "W"}`);
    return;
  }

  if (cmd === "DUMPBOARD") {
    for (let i = 0; i < BOARD_TOTAL; i++) {
      if (board[i] === BLACK) print(`B ${getY(i)},${getX(i)}`);
      else if (board[i] === WHITE) print(`W ${getY(i)},${getX(i)}`);
    }
    print("DONE");
    return;
  }

  if (cmd === "FINDVCF") {
    const color = Number(parts[1] || 1) === 2 ? WHITE : BLACK;
    const maxVCF = Number(parts[2] || 1);
    const maxDepth = Number(parts[3] || 200);
    const maxNode = Number(parts[4] || 5000000);
    const info = runFindVCF(color, maxVCF, maxDepth, maxNode);
    print(`VCFCOUNT ${info.vcfCount}`);
    for (const path of info.winMoves) {
      print(`VCFPATH ${path.length}${path.length ? " " + path.join(" ") : ""}`);
    }
    print(`NODECOUNT ${info.nodeCount}`);
    return;
  }

  if (cmd === "LEVELPOINT") {
    const idx = Number(parts[1]);
    const color = Number(parts[2] || 1) === 2 ? WHITE : BLACK;
    print(`LEVEL ${getLevelPoint(idx, color, board)}`);
    return;
  }

  if (cmd === "ISVCF") {
    const color = Number(parts[1] || 1) === 2 ? WHITE : BLACK;
    const n = Number(parts[2] || 0);
    const moves = parts.slice(3, 3 + n).map(Number).filter(Number.isInteger);
    print(`ISVCF ${isVCF(color, board, moves) ? "TRUE" : "FALSE"}`);
    return;
  }

  if (cmd === "BLOCKVCF") {
    const color = Number(parts[1] || 1) === 2 ? WHITE : BLACK;
    const includeFour = Number(parts[2] || 1) !== 0;
    const n = Number(parts[3] || 0);
    const moves = parts.slice(4, 4 + n).map(Number).filter(Number.isInteger);
    const pts = getBlockVCF(board, color, moves, includeFour);
    print(`BLOCKPOINTS ${pts.length}${pts.length ? " " + pts.join(" ") : ""}`);
    return;
  }

  if (cmd === "SETBOARD") {
    clearBoard();
    const n = Number(parts[1] || 0);
    for (let i = 0; i < n; i++) {
      const idx = Number(parts[2 + i * 2]);
      const color = Number(parts[3 + i * 2]);
      if (Number.isInteger(idx) && idx >= 0 && idx < BOARD_TOTAL && (color === BLACK || color === WHITE)) {
        board[idx] = color;
      }
    }
    let bc = 0;
    let wc = 0;
    for (let i = 0; i < BOARD_TOTAL; i++) {
      if (board[i] === BLACK) bc++;
      else if (board[i] === WHITE) wc++;
    }
    nextToMove = (bc <= wc) ? BLACK : WHITE;
    print("OK");
    return;
  }

  if (cmd === "GETLEVELPOINTS") {
    const placeColor = Number(parts[1] || 1) === 2 ? WHITE : BLACK;
    const color = Number(parts[2] || 1) === 2 ? WHITE : BLACK;
    const maxDepth = Number(parts[3] || 200);
    const maxNode = Number(parts[4] || 5000000);
    const indices = parts.slice(5).map(Number).filter(Number.isInteger);
    const scan = indices.length ? indices : Array.from({ length: 225 }, (_, i) => i);
    let totalNodes = 0;

    for (const i of scan) {
      if (i < 0 || i >= BOARD_TOTAL || board[i] !== 0) continue;
      board[i] = placeColor;

      let label = null;
      if (placeColor === color) {
        const level = getLevelPoint(i, color, board) & 0x0f;
        if (level >= 10) label = "5";
        else if (level === 8 || level === 9) label = "4";
      }

      if (label === null) {
        runFindVCF(color, 1, maxDepth, maxNode);
        totalNodes += vcfInfo.nodeCount;
        if (vcfInfo.vcfCount > 0 && vcfInfo.winMoves.length > 0 && vcfInfo.winMoves[0].length > 0) {
          label = String(vcfInfo.winMoves[0].length);
        }
      }

      board[i] = 0;
      if (label !== null) print(`ITEM ${i} ${label}`);
    }

    print(`NODECOUNT ${totalNodes}`);
    print("DONE");
    return;
  }

  if (cmd === "INFO") return;

  if (cmd === "END") {
    process.exit(0);
  }

  if (cmd === "ABOUT") {
    print('name="engine", version="web-parity", author="OpenAI", country="Taiwan"');
  }
}

setGameRules(2);

const rl = readline.createInterface({
  input: process.stdin,
  crlfDelay: Infinity,
});

rl.on("line", handleCommand);
