// ============================================
// Date: 2026-11-05
// Version: v1.0.0
// Changes: Rule regression tests (draughts perft & FMJD captures, xiangqi/shogi repetition, uchifuzume, engine bridge)
// 修改: 規則回歸測試（跳棋 perft 與 FMJD 吃子、象棋／將棋重複局面、打步詰、引擎轉換）
// ============================================
/**
 * 規則回歸測試（不需要瀏覽器或引擎）
 *
 * 執行：node tests/node/rules-regression.test.js [跳棋 perft 深度，預設 5，最大 7]
 *
 * 參考答案來源：
 * - 國際跳棋起始局面 perft 公開數值：9 / 81 / 658 / 4265 / 27117 / 167140 / 1049442
 * - Fairy-Stockfish 內建起始 FEN（西洋棋、象棋、將棋）
 * - FMJD 規則（最多吃子、被吃子於連跳結束才移除、連跳途中不升王）
 * - 日本將棋聯盟規則（打步詰、千日手）、亞洲象棋規則（長將判負）
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..', '..');
const PERFT_DEPTH = Math.min(7, Number(process.argv[2] || 5));

/**
 * 在隔離的 VM 中載入專案的瀏覽器腳本。
 * @param {string[]} files 相對於專案根目錄的檔案
 * @returns {Object} BoardArena 全域物件
 */
function loadBoardArena(files) {
  const ctx = { console, Math, Date, JSON, Object, Array, Map, Set, URL, setTimeout, clearTimeout, Promise };
  ctx.window = ctx;
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  for (const f of files) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
  }
  return ctx.BoardArena;
}

const BA = loadBoardArena([
  'js/rules/rules-core.js',
  'js/rules/chess.js',
  'js/rules/xiangqi.js',
  'js/rules/shogi.js',
  'js/rules/draughts.js',
  'js/ai/fsf-bridge.js'
]);

let failures = 0;
function check(cond, name) {
  if (cond) {
    console.log('  ok   ' + name);
  } else {
    failures++;
    console.log('  FAIL ' + name);
  }
}

function emptyState(gameId) {
  const s = BA.getRule(gameId).createInitialState({});
  for (const row of s.board) row.fill(null);
  if (gameId === 'xiangqi') s.repHistory = [];
  if (gameId === 'shogi') s.repTail = null;
  return s;
}

function play(gameId, st, seq) {
  const rule = BA.getRule(gameId);
  for (const [fr, fc, tr, tc] of seq) {
    if (st.status !== 'playing') break;
    const mv = rule
      .getLegalMoves(st, st.currentPlayer)
      .find((m) => !m.isDrop && m.from && m.from.r === fr && m.from.c === fc && m.to.r === tr && m.to.c === tc);
    if (!mv) throw new Error(gameId + ': illegal move ' + [fr, fc, tr, tc].join(','));
    st = rule.applyMove(st, mv);
  }
  return st;
}

/* ---------------------------------------------------------------- draughts */
function draughtsTests() {
  console.log('International draughts (FMJD)');
  const rule = BA.getRule('draughts');

  function turnResults(st) {
    const out = new Map();
    const p = st.currentPlayer;
    (function rec(s, firstFrom, caps) {
      for (const m of rule.getLegalMoves(s, p)) {
        const n = rule.applyMove(s, m);
        const ff = firstFrom || m.from;
        const cs = caps.concat(m.captures || []);
        if (n.status === 'playing' && n.currentPlayer === p && n.mustContinueFrom) {
          rec(n, ff, cs);
        } else {
          const key = ff.r + ',' + ff.c + '>' + m.to.r + ',' + m.to.c + '|' + cs.map((x) => x.r + ',' + x.c).sort().join(';');
          if (!out.has(key)) out.set(key, n);
        }
      }
    })(st, null, []);
    return [...out.values()];
  }
  function perft(st, d) {
    if (d === 0) return 1;
    let n = 0;
    for (const s of turnResults(st)) n += s.status === 'playing' ? perft(s, d - 1) : d === 1 ? 1 : 0;
    return n;
  }
  const EXPECT = [1, 9, 81, 658, 4265, 27117, 167140, 1049442];
  const init = rule.createInitialState();
  for (let d = 1; d <= PERFT_DEPTH; d++) {
    const v = perft(init, d);
    check(v === EXPECT[d], 'perft(' + d + ') = ' + v + ' (published ' + EXPECT[d] + ')');
  }

  const empty = () => emptyState('draughts');
  {
    const s = empty();
    s.board[6][3] = { owner: 1, king: false };
    s.board[5][2] = { owner: 2, king: false };
    s.board[5][4] = { owner: 2, king: false };
    s.board[3][6] = { owner: 2, king: false };
    s.board[0][9] = { owner: 2, king: false };
    const legal = rule.getLegalMoves(s, 1);
    check(legal.length === 1 && legal[0].to.r === 4 && legal[0].to.c === 5, 'majority capture: only the 2-piece route is legal');
  }
  {
    const s = empty();
    s.board[7][2] = { owner: 1, king: true };
    s.board[6][3] = { owner: 2, king: false };
    s.board[8][1] = { owner: 2, king: false };
    s.board[0][1] = { owner: 2, king: false };
    const ends = rule.getLegalMoves(s, 1).every((m) => {
      const n = rule.applyMove(s, m);
      return !n.mustContinueFrom && n.currentPlayer === 2;
    });
    check(ends, 'jumped pieces block until the sequence ends (no passing through them)');
    const after = rule.applyMove(s, rule.getLegalMoves(s, 1).find((m) => m.captures[0].r === 6));
    check(after.board[6][3] === null && after.board[8][1] !== null, 'captured piece removed only at end of turn');
  }
  {
    const s = empty();
    s.board[2][3] = { owner: 1, king: false };
    s.board[1][4] = { owner: 2, king: false };
    s.board[1][6] = { owner: 2, king: false };
    s.board[9][0] = { owner: 2, king: false };
    let st = rule.applyMove(s, rule.getLegalMoves(s, 1)[0]);
    check(st.mustContinueFrom && !st.board[0][5].king, 'man crossing the far row mid-capture is not promoted');
    st = rule.applyMove(st, rule.getLegalMoves(st, 1)[0]);
    check(st.currentPlayer === 2 && !st.board[2][7].king, 'capture ending off the far row stays a man');
  }
}

/* ---------------------------------------------------------------- xiangqi */
function xiangqiTests() {
  console.log('Xiangqi repetition');
  const setup = () => {
    const s = emptyState('xiangqi');
    s.board[0][3] = { owner: 2, type: 'K' };
    s.board[9][5] = { owner: 1, type: 'K' };
    s.board[5][0] = { owner: 1, type: 'R' };
    return s;
  };
  let st = play('xiangqi', setup(), [[5, 0, 5, 3], [0, 3, 0, 4]]);
  for (let i = 0; i < 3 && st.status === 'playing'; i++) {
    st = play('xiangqi', st, [[5, 3, 5, 4], [0, 4, 0, 3], [5, 4, 5, 3], [0, 3, 0, 4]]);
  }
  check(st.endReason === 'perpetual_check' && st.winner === 2, 'perpetual check loses for the checking side');

  st = setup();
  for (let i = 0; i < 4 && st.status === 'playing'; i++) {
    st = play('xiangqi', st, [[5, 0, 5, 1], [0, 3, 1, 3], [5, 1, 5, 0], [1, 3, 0, 3]]);
  }
  check(st.endReason === 'repetition_draw' && st.winner === 0, 'quiet repetition is a draw');
}

/* ---------------------------------------------------------------- shogi */
function shogiTests() {
  console.log('Shogi');
  const rule = BA.getRule('shogi');
  const kings = () => {
    const s = emptyState('shogi');
    s.board[0][4] = { owner: 2, type: 'K', promoted: false };
    s.board[8][8] = { owner: 1, type: 'K', promoted: false };
    s.board[4][0] = { owner: 1, type: 'R', promoted: false };
    return s;
  };
  let st = play('shogi', kings(), [[4, 0, 4, 4], [0, 4, 0, 3]]);
  for (let i = 0; i < 4 && st.status === 'playing'; i++) {
    st = play('shogi', st, [[4, 4, 4, 3], [0, 3, 0, 4], [4, 3, 4, 4], [0, 4, 0, 3]]);
  }
  check(st.endReason === 'perpetual_check_sennichite' && st.winner === 2, 'perpetual-check sennichite: checking side loses');

  const cyc = [[4, 0, 4, 1], [0, 4, 0, 5], [4, 1, 4, 0], [0, 5, 0, 4]];
  st = kings();
  for (let i = 0; i < 3; i++) st = play('shogi', st, cyc);
  check(st.status === 'playing', 'sennichite not declared before the 4th occurrence');
  st = play('shogi', st, cyc);
  check(st.endReason === 'sennichite' && st.winner === 0, 'quiet 4-fold repetition is a draw (sennichite)');

  const dropMate = (withSilver) => {
    const s = emptyState('shogi');
    s.board[0][8] = { owner: 2, type: 'K', promoted: false };
    if (withSilver) s.board[1][6] = { owner: 1, type: 'S', promoted: false };
    s.board[2][7] = { owner: 1, type: 'G', promoted: false };
    s.board[8][0] = { owner: 1, type: 'K', promoted: false };
    s.hands[1].P = 1;
    return s;
  };
  const isDrop = (m) => m.isDrop && m.piece === 'P' && m.to.r === 1 && m.to.c === 8;
  check(!rule.getLegalMoves(dropMate(true), 1).some(isDrop), 'uchifuzume: pawn-drop checkmate is illegal');
  check(rule.getLegalMoves(dropMate(false), 1).some(isDrop), 'pawn-drop check that is not mate stays legal');
}

/* ---------------------------------------------------------------- engine bridge */
function bridgeTests() {
  console.log('Fairy-Stockfish bridge');
  const EXPECT = {
    chess: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    xiangqi: 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1',
    shogi: 'lnsgkgsnl/1r5b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL[-] w 0 1'
  };
  for (const g of Object.keys(EXPECT)) {
    check(BA.FSF.buildFen(g, BA.getRule(g).createInitialState({})) === EXPECT[g], g + ' start FEN matches the engine');
  }
  let seed = 12345;
  const rnd = (n) => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff), seed % n);
  for (const g of Object.keys(EXPECT)) {
    const rule = BA.getRule(g);
    let bad = 0;
    let moves = 0;
    for (let game = 0; game < 30; game++) {
      let st = rule.createInitialState({});
      for (let ply = 0; ply < 120 && st.status === 'playing'; ply++) {
        const legal = rule.getLegalMoves(st, st.currentPlayer);
        if (!legal.length) break;
        for (const m of legal) {
          moves++;
          const back = BA.FSF.matchLegalMove(g, legal, BA.FSF.parseEngineMove(g, BA.FSF.moveToEngine(g, m)));
          if (back !== m) bad++;
        }
        st = rule.applyMove(st, legal[rnd(legal.length)]);
      }
    }
    check(bad === 0, g + ': ' + moves + ' legal moves round-trip through engine notation');
  }
}

draughtsTests();
xiangqiTests();
shogiTests();
bridgeTests();
console.log(failures === 0 ? '\nALL PASS' : '\n' + failures + ' FAILURE(S)');
process.exit(failures === 0 ? 0 : 1);
