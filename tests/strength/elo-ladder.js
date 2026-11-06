// ============================================
// Date: 2026-11-05
// Version: v1.0.0
// Changes: Self-play strength ladder for the built-in JS AI (paired openings, full games, Elo with 95% CI)
// 修改: 內建 JS AI 自我對戰棋力量測工具（成對開局、完整對局、等級分與 95% 信賴區間）
// ============================================
/**
 * 棋力量測：讓相鄰難度互相對戰，估計等級分差（Elo）。
 *
 * 用法：
 *   node tests/strength/elo-ladder.js [--games=24] [--workers=8] [--only=chess,go] [--pairs=easy-normal,hard-master]
 *   圍棋新舊比較：--only=go --pairs=master@ab-master（左邊為較低／對照組）
 *
 * 方法：
 * - 成對對局：同一個隨機開局，兩個難度各執先後手一次，抵消先手優勢。
 * - 每盤完整下完，達到步數上限才判和。AI 使用網站上的真實時間預算。
 * - 工作執行緒預設 8 個（= 實體核心數），避免 CPU 搶不到時間而讓時間制 AI 變弱。
 * - 等級分差 = -400·log10(1/s − 1)，s 為得分率；以逐局變異數估計 95% 信賴區間。
 *
 * 注意：網站上西洋棋／象棋／將棋的困難與大師使用 Fairy-Stockfish（瀏覽器內），
 * 本工具量的是內建 JS AI（引擎無法使用時的備援）。
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');

const ROOT = path.resolve(__dirname, '..', '..');
const GAMES = ['chess', 'xiangqi', 'shogi', 'draughts', 'othello', 'gomoku', 'go', 'backgammon'];
const PAIRS = [['easy', 'normal'], ['normal', 'hard'], ['hard', 'master']];
const MAX_PLIES = { chess: 300, xiangqi: 300, shogi: 320, draughts: 300, othello: 70, gomoku: 225, go: 120, backgammon: 500 };
const RANDOM_OPENING_PLIES = { chess: 4, xiangqi: 4, shogi: 4, draughts: 4, othello: 4, gomoku: 3, go: 2, backgammon: 0 };

/* =========================================================================
 * Worker：在獨立 VM 中載入規則與 AI，下完一盤棋
 * ========================================================================= */

function loadBoardArena() {
  const ctx = { console, Math, Date, JSON, Object, Array, Map, Set, performance, setTimeout, clearTimeout, Promise };
  ctx.window = ctx;
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  const files = ['rules-core', 'othello', 'xiangqi', 'go', 'gomoku', 'draughts', 'chess', 'shogi', 'backgammon']
    .map((f) => 'js/rules/' + f + '.js')
    .concat(['js/ai/go-mcts.js', 'js/ai/ai-engine.js']);
  for (const f of files) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
  }
  return ctx.BoardArena;
}

function makeRng(seed) {
  let s = seed >>> 0 || 1;
  return function (n) {
    s = (Math.imul(s, 1103515245) + 12345) >>> 0;
    return (s >>> 8) % n;
  };
}

function createGame(BA, gameId, seed) {
  const opts = { seed: seed, boardSize: 9, swapRule: false };
  return BA.getRule(gameId).createInitialState(opts);
}

/** 隨機開局：只從靠近中央的走法挑（五子棋、圍棋），其餘棋種任選合法步 */
function randomOpening(BA, gameId, state, plies, rnd) {
  const rule = BA.getRule(gameId);
  for (let i = 0; i < plies && state.status === 'playing'; i++) {
    let legal = rule.getLegalMoves(state, state.currentPlayer);
    if (gameId === 'gomoku' || gameId === 'go') {
      const size = state.size || (state.board && state.board.length) || 15;
      const mid = (size - 1) / 2;
      const radius = gameId === 'go' ? 2 : 3;
      const central = legal.filter((m) => m.to && Math.abs(m.to.r - mid) <= radius && Math.abs(m.to.c - mid) <= radius);
      if (central.length) legal = central;
    }
    if (!legal.length) break;
    state = rule.applyMove(state, legal[rnd(legal.length)]);
  }
  return state;
}

function playOneGame(BA, task) {
  const rule = BA.getRule(task.game);
  const rnd = makeRng(task.openingSeed);
  let state = randomOpening(BA, task.game, createGame(BA, task.game, task.openingSeed), RANDOM_OPENING_PLIES[task.game], rnd);
  const levelOf = { 1: task.aIsP1 ? task.a : task.b, 2: task.aIsP1 ? task.b : task.a };
  const time = { a: 0, b: 0, na: 0, nb: 0 };
  let plies = 0;
  while (plies < MAX_PLIES[task.game] && state.status !== 'ended') {
    if (state.status === 'scoring') {
      const confirm = rule.getLegalMoves(state, state.currentPlayer).find((m) => m.action === 'confirm_score');
      if (!confirm) break;
      state = rule.applyMove(state, confirm);
      continue;
    }
    const legal = rule.getLegalMoves(state, state.currentPlayer);
    if (!legal || !legal.length) break;
    // 難度規格：
    //   "master@ab" → 圍棋使用舊的 Alpha-Beta（新舊比較）
    //   "master~d6" → 暫時把該難度在此棋種的搜尋深度上限改為 6（參數實驗）
    //   "master^gomokuDefenseWeight=1" → 暫時設定 BoardArena.TUNING 參數（參數實驗）
    const raw = levelOf[state.currentPlayer];
    const depthOverride = /~d(\d+)/.exec(raw);
    const tuning = {};
    raw.replace(/\^(\w+)=([-\d.]+)/g, function (_, k, v) {
      tuning[k] = Number(v);
      return '';
    });
    BA.TUNING = tuning;
    const spec = raw.replace(/~(d|ib|mb)\d+/g, '').replace(/\^\w+=[-\d.]+/g, '').split('@');
    BA.AI.goEngine = spec[1] === 'ab' ? 'alphabeta' : 'mcts';
    //   "master~ib15" / "master~mb20" → 暫時改內層／根節點候選數 innerBranch / maxBranch
    const profile = BA.AI.LEVEL_PROFILES && BA.AI.LEVEL_PROFILES[spec[0]];
    const savedDepth = profile ? profile.depthByGame[task.game] : undefined;
    const ib = /~ib(\d+)/.exec(raw);
    const mb = /~mb(\d+)/.exec(raw);
    const savedIb = profile ? profile.innerBranch : undefined;
    const savedMb = profile ? profile.maxBranch : undefined;
    if (depthOverride && profile) profile.depthByGame[task.game] = Number(depthOverride[1]);
    if (ib && profile) profile.innerBranch = Number(ib[1]);
    if (mb && profile) profile.maxBranch = Number(mb[1]);
    const t0 = performance.now();
    const move = BA.AI.chooseMove(task.game, state, spec[0]) || legal[0];
    const dt = performance.now() - t0;
    if (profile) {
      profile.depthByGame[task.game] = savedDepth;
      profile.innerBranch = savedIb;
      profile.maxBranch = savedMb;
    }
    const isA = (state.currentPlayer === 1) === task.aIsP1;
    if (isA) { time.a += dt; time.na++; } else { time.b += dt; time.nb++; }
    state = rule.applyMove(state, move);
    plies++;
  }
  // 圍棋：目前 AI 不會主動虛手，達上限時強制雙方虛手並以中國數子法數地（盤上棋子一律視為活子）
  let goAdjudicated = false;
  if (task.game === 'go' && state.status !== 'ended') {
    for (let i = 0; i < 4 && state.status !== 'ended'; i++) {
      const legal = rule.getLegalMoves(state, state.currentPlayer);
      const mv = legal.find((m) => m.action === 'confirm_score') || legal.find((m) => m.action === 'pass');
      if (!mv) break;
      state = rule.applyMove(state, mv);
    }
    goAdjudicated = state.status === 'ended';
  }
  const aPlayer = task.aIsP1 ? 1 : 2;
  let scoreA = 0.5;
  if (state.status === 'ended' && state.winner) scoreA = state.winner === aPlayer ? 1 : 0;
  return {
    game: task.game,
    a: task.a,
    b: task.b,
    scoreA: scoreA,
    plies: plies,
    endReason: goAdjudicated ? 'cap_then_area_score' : state.status === 'ended' ? state.endReason || 'ended' : 'ply_cap',
    msPerMoveA: time.na ? time.a / time.na : 0,
    msPerMoveB: time.nb ? time.b / time.nb : 0
  };
}

if (!isMainThread) {
  const BA = loadBoardArena();
  parentPort.on('message', (task) => {
    try {
      parentPort.postMessage({ ok: true, result: playOneGame(BA, task) });
    } catch (err) {
      parentPort.postMessage({ ok: false, task: task, error: String((err && err.stack) || err) });
    }
  });
  if (workerData && workerData.ready) parentPort.postMessage({ ready: true });
}

/* =========================================================================
 * 主程式：排程、統計、輸出報告
 * ========================================================================= */

function parseArgs(argv) {
  const args = {};
  for (const a of argv) {
    const m = /^--([a-z]+)=(.*)$/.exec(a);
    if (m) args[m[1]] = m[2];
  }
  return args;
}

/**
 * 由得分率估計等級分差與 95% 信賴區間。
 * @param {number[]} scores 每局得分（1 / 0.5 / 0）
 * @returns {{n:number, score:number, elo:number, lo:number, hi:number, w:number, d:number, l:number}}
 */
function eloStats(scores) {
  const n = scores.length;
  const mean = scores.reduce((x, y) => x + y, 0) / n;
  const variance = scores.reduce((acc, x) => acc + (x - mean) * (x - mean), 0) / n;
  const se = Math.sqrt(variance / n);
  const clamp = (s) => Math.min(1 - 0.5 / n, Math.max(0.5 / n, s));
  const toElo = (s) => -400 * Math.log10(1 / clamp(s) - 1);
  return {
    n: n,
    score: mean,
    elo: toElo(mean),
    lo: toElo(mean - 1.96 * se),
    hi: toElo(mean + 1.96 * se),
    w: scores.filter((x) => x === 1).length,
    d: scores.filter((x) => x === 0.5).length,
    l: scores.filter((x) => x === 0).length
  };
}

function fmt(x) {
  if (!isFinite(x)) return x > 0 ? '+∞' : '−∞';
  return (x >= 0 ? '+' : '') + Math.round(x);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const gamesPerPair = Math.max(2, Number(args.games || 24) & ~1);
  const workers = Math.max(1, Number(args.workers || Math.min(8, os.cpus().length)));
  const games = args.only ? args.only.split(',') : GAMES;
  const pairs = args.pairs ? args.pairs.split(',').map((p) => p.split('-')) : PAIRS;

  const tasks = [];
  for (const g of games) {
    for (const [lo, hi] of pairs) {
      for (let i = 0; i < gamesPerPair / 2; i++) {
        const openingSeed = 1000 + i * 7919 + g.length * 31;
        // a = 較高難度；兩盤同開局、交換先後手
        tasks.push({ game: g, a: hi, b: lo, openingSeed: openingSeed, aIsP1: true });
        tasks.push({ game: g, a: hi, b: lo, openingSeed: openingSeed, aIsP1: false });
      }
    }
  }
  // 預估最久的先跑（含大師的對局），讓執行緒負載平均
  const weight = (t) => (t.a.startsWith('master') || t.b.startsWith('master') ? 3 : t.a.startsWith('hard') ? 2 : 1);
  tasks.sort((x, y) => weight(y) - weight(x));

  console.log('Tasks: ' + tasks.length + ' games, workers: ' + workers + ', games/pair: ' + gamesPerPair);
  const started = Date.now();
  const results = [];
  const errors = [];
  let next = 0;

  await new Promise((resolve) => {
    let active = 0;
    function feed(w) {
      if (next >= tasks.length) {
        w.terminate();
        active--;
        if (active === 0) resolve();
        return;
      }
      w.postMessage(tasks[next++]);
    }
    for (let i = 0; i < workers; i++) {
      const w = new Worker(__filename);
      active++;
      w.on('message', (msg) => {
        if (msg.ok) results.push(msg.result);
        else errors.push(msg);
        if (msg.ok || msg.error) {
          const done = results.length + errors.length;
          if (done % 10 === 0 || done === tasks.length) {
            const mins = ((Date.now() - started) / 60000).toFixed(1);
            console.log('  ' + done + '/' + tasks.length + ' done (' + mins + ' min)');
          }
          feed(w);
        }
      });
      w.on('error', (e) => errors.push({ error: String(e) }));
      feed(w);
    }
  });

  // 彙整
  const rows = [];
  for (const g of games) {
    for (const [lo, hi] of pairs) {
      const rs = results.filter((r) => r.game === g && r.a === hi && r.b === lo);
      if (!rs.length) continue;
      const st = eloStats(rs.map((r) => r.scoreA));
      const reasons = {};
      rs.forEach((r) => (reasons[r.endReason] = (reasons[r.endReason] || 0) + 1));
      rows.push({
        game: g,
        pair: hi + ' vs ' + lo,
        stats: st,
        avgPlies: Math.round(rs.reduce((x, r) => x + r.plies, 0) / rs.length),
        msHi: Math.round(rs.reduce((x, r) => x + r.msPerMoveA, 0) / rs.length),
        msLo: Math.round(rs.reduce((x, r) => x + r.msPerMoveB, 0) / rs.length),
        reasons: reasons
      });
    }
  }

  const lines = [];
  lines.push('# 內建 JS AI 棋力量測（' + new Date().toISOString().slice(0, 10) + '）');
  lines.push('');
  lines.push('每組 ' + gamesPerPair + ' 盤（成對開局、交換先後手），工作執行緒 ' + workers + ' 個，耗時 ' + ((Date.now() - started) / 60000).toFixed(1) + ' 分鐘。');
  lines.push('Elo 差為「較高難度 − 較低難度」，括號為 95% 信賴區間；區間包含 0 代表無法確定較高難度比較強。');
  lines.push('');
  lines.push('| 棋種 | 對戰 | 勝-和-負 | 得分率 | Elo 差 (95% CI) | 平均步數 | 每步毫秒（高/低） | 結束原因 |');
  lines.push('|---|---|---|---|---|---|---|---|');
  for (const r of rows) {
    const s = r.stats;
    lines.push(
      '| ' + r.game + ' | ' + r.pair + ' | ' + s.w + '-' + s.d + '-' + s.l + ' | ' + Math.round(s.score * 100) + '% | ' +
        fmt(s.elo) + ' (' + fmt(s.lo) + ', ' + fmt(s.hi) + ') | ' + r.avgPlies + ' | ' + r.msHi + ' / ' + r.msLo + ' | ' +
        Object.entries(r.reasons).map(([k, v]) => k + '×' + v).join(', ') + ' |'
    );
  }
  if (errors.length) {
    lines.push('');
    lines.push('錯誤 ' + errors.length + ' 筆：');
    errors.slice(0, 5).forEach((e) => lines.push('- ' + String(e.error).split('\n')[0]));
  }
  const report = lines.join('\n');
  console.log('\n' + report);

  const outDir = path.join(__dirname, 'results');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'latest.md'), report + '\n', 'utf8');
  fs.writeFileSync(path.join(outDir, 'latest.json'), JSON.stringify({ gamesPerPair, workers, rows, errors, results }, null, 1), 'utf8');
}

if (isMainThread) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
