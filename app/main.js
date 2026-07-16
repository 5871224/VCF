const { app, BrowserWindow, ipcMain } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const readline = require('readline');
const os = require('os');

const ENGINE_PATH = app.isPackaged
  ? path.join(path.dirname(process.execPath), 'engine.exe')
  : path.join(__dirname, 'engine.exe');
const POOL_SIZE = Math.max(1, Math.min(os.cpus().length, 8));

class EngineProcess {
  constructor() {
    this._proc = null;
    this._current = null;
    this._queue = [];
  }

  start() {
    this._proc = spawn(ENGINE_PATH, [], { stdio: ['pipe', 'pipe', 'ignore'] });
    const rl = readline.createInterface({ input: this._proc.stdout, crlfDelay: Infinity });
    rl.on('line', line => this._onLine(line.trim()));
    this._proc.on('error', e => console.error('Engine error:', e));
  }

  _onLine(line) {
    if (!this._current) return;
    this._current.lines.push(line);
    if (this._current.done(line)) {
      const { resolve, lines } = this._current;
      this._current = null;
      resolve(lines);
      this._next();
    }
  }

  _next() {
    if (this._queue.length && !this._current) {
      const item = this._queue.shift();
      this._current = { resolve: item.resolve, lines: [], done: item.done };
      this._proc.stdin.write(item.cmd + '\n');
    }
  }

  send(cmd, done) {
    return new Promise(resolve => {
      this._queue.push({ cmd, resolve, done });
      this._next();
    });
  }

  kill() {
    if (this._proc) { this._proc.kill(); this._proc = null; }
    if (this._current) { this._current.resolve([]); this._current = null; }
    this._queue.forEach(q => q.resolve([]));
    this._queue = [];
  }

  restart() { this.kill(); this.start(); }
}

function boardCmd(arr) {
  const stones = [];
  for (let i = 0; i < 225; i++) {
    if (arr[i]) stones.push(i, arr[i]);
  }
  return `SETBOARD ${stones.length / 2} ${stones.join(' ')}`;
}

function parseFindVCF(lines) {
  let vcfCount = 0;
  let nodeCount = 0;
  const winMoves = [];
  for (const line of lines) {
    if (line.startsWith('VCFCOUNT')) {
      vcfCount = +line.split(' ')[1];
    } else if (line.startsWith('VCFPATH')) {
      const p = line.split(' ');
      winMoves.push(p.slice(2).map(Number));
    } else if (line.startsWith('NODECOUNT')) {
      nodeCount = +line.split(' ')[1];
    }
  }
  return { vcfCount, winMoves, nodeCount };
}

function parseGetLevelPoints(lines) {
  const items = [];
  let nodeCount = 0;
  for (const line of lines) {
    if (line.startsWith('ITEM')) {
      const p = line.split(' ');
      const raw = p[2];
      items.push({ idx: +p[1], label: (raw === '5' || raw === '4') ? raw : +raw });
    } else if (line.startsWith('NODECOUNT')) {
      nodeCount = +line.split(' ')[1];
    }
  }
  return { items, nodeCount };
}

async function trimVCFGroupsImpl(eng, { arr, groups, color }) {
  const oppColor = 3 - color;
  const processed = [];
  const seen = new Set();
  for (const moves of groups) {
    if (!moves || !moves.length) continue;
    const fullArr = arr.slice();
    for (let i = 0; i < moves.length; i++) {
      fullArr[moves[i]] = (i % 2 === 0) ? color : oppColor;
    }
    await eng.send(boardCmd(fullArr), l => l === 'OK');
    const lastIdx = moves[moves.length - 1];
    const lvLines = await eng.send(`LEVELPOINT ${lastIdx} ${color}`, l => l.startsWith('LEVEL'));
    const level = +lvLines[0].split(' ')[1];
    let trimmed = Array.from(moves);
    if ((level & 0x0f) === 9) trimmed = trimmed.slice(0, -1);
    const key = trimmed.map((idx, i) => `${idx}:${i % 2 === 0 ? color : oppColor}`).sort().join(',');
    if (!seen.has(key)) {
      seen.add(key);
      processed.push(Array.from(moves));
    }
  }
  processed.sort((a, b) => a.length - b.length);
  return processed;
}

async function engineCmd(cmd, param) {
  switch (cmd) {
    case 'setGameRules': {
      await engine.send(`SETRULES ${param.rules}`, l => l === 'OK');
      return null;
    }
    case 'findVCF': {
      const { arr, color, maxVCF = 1, maxDepth = 200, maxNode = 5000000 } = param;
      await engine.send(boardCmd(arr), l => l === 'OK');
      const lines = await engine.send(
        `FINDVCF ${color} ${maxVCF} ${maxDepth} ${maxNode}`,
        l => l.startsWith('NODECOUNT')
      );
      return parseFindVCF(lines);
    }
    case 'getBlockVCF': {
      const { arr, color, vcfMoves, includeFour = true } = param;
      await engine.send(boardCmd(arr), l => l === 'OK');
      const n = vcfMoves.length;
      const lines = await engine.send(
        `BLOCKVCF ${color} ${includeFour ? 1 : 0} ${n}${n ? ' ' + vcfMoves.join(' ') : ''}`,
        l => l.startsWith('BLOCKPOINTS')
      );
      const p = lines[0].split(' ').map(Number);
      return p.slice(2);
    }
    case 'isVCF': {
      const { color, arr, moves } = param;
      await engine.send(boardCmd(arr), l => l === 'OK');
      const n = moves.length;
      const lines = await engine.send(
        `ISVCF ${color} ${n}${n ? ' ' + moves.join(' ') : ''}`,
        l => l.startsWith('ISVCF')
      );
      return lines[0].includes('TRUE');
    }
    case 'getLevelPoints': {
      const { arr, color, placeColor, maxDepth = 200, maxNode = 5000000 } = param;
      await engine.send(boardCmd(arr), l => l === 'OK');
      const pc = placeColor || color;
      const lines = await engine.send(
        `GETLEVELPOINTS ${pc} ${color} ${maxDepth} ${maxNode}`,
        l => l === 'DONE'
      );
      return parseGetLevelPoints(lines);
    }
    case 'trimVCFGroups':
      return trimVCFGroupsImpl(engine, param);
    default:
      return null;
  }
}

const pool = Array.from({ length: POOL_SIZE }, () => new EngineProcess());

async function poolGetLevelPoints({ arr, color, placeColor, indices, maxDepth = 200, maxNode = 5000000 }) {
  const pc = placeColor || color;
  const emptyIdx = indices
    ? indices.filter(i => arr[i] === 0)
    : Array.from({ length: 225 }, (_, i) => i).filter(i => arr[i] === 0);
  const chunks = Array.from({ length: pool.length }, () => []);
  emptyIdx.forEach((idx, i) => chunks[i % pool.length].push(idx));

  const board = boardCmd(arr);
  const results = await Promise.all(pool.map(async (eng, i) => {
    if (!chunks[i].length) return { items: [], nodeCount: 0 };
    await eng.send(board, l => l === 'OK');
    const idxStr = chunks[i].join(' ');
    const lines = await eng.send(
      `GETLEVELPOINTS ${pc} ${color} ${maxDepth} ${maxNode} ${idxStr}`,
      l => l === 'DONE'
    );
    return parseGetLevelPoints(lines);
  }));

  return {
    items: results.flatMap(r => r.items),
    nodeCount: results.reduce((sum, r) => sum + r.nodeCount, 0),
  };
}

const engine = new EngineProcess();

app.whenReady().then(() => {
  engine.start();
  pool.forEach(e => e.start());

  const win = new BrowserWindow({
    width: 1200,
    height: 900,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.loadFile(app.isPackaged
    ? path.join(__dirname, 'makevcf.html')
    : path.join(__dirname, '..', 'makevcf.html'));
});

app.on('window-all-closed', () => {
  engine.kill();
  pool.forEach(e => e.kill());
  if (process.platform !== 'darwin') app.quit();
});

ipcMain.handle('engine:cmd', (_, cmd, param) => engineCmd(cmd, param));
ipcMain.handle('engine:cancel', () => { engine.restart(); return null; });
ipcMain.handle('pool:getLevelPoints', (_, param) => poolGetLevelPoints(param));
ipcMain.handle('pool:cancel', () => { pool.forEach(e => e.restart()); return null; });
ipcMain.handle('pool:setRules', (_, rules) => Promise.all(pool.map(e => e.send(`SETRULES ${rules}`, l => l === 'OK'))));
ipcMain.on('pool:workerCount', e => { e.returnValue = POOL_SIZE; });
