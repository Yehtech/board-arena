// ============================================
// Date: 2026-11-06
// Version: v1.0.0
// Changes: Monte-Carlo Tree Search (UCT + RAVE) Go engine with fast pseudo-liberty board
// 修改: 新增圍棋蒙地卡羅樹搜尋（UCT + RAVE），使用虛擬氣數快速棋盤進行模擬對局
// ============================================
/**
 * Classic Board Arena — Go MCTS Engine
 *
 * - 快速棋盤：一維陣列（含邊界），棋串以循環鏈結串列記錄，氣數使用「虛擬氣數」（pseudo-liberties）。
 * - 模擬對局：隨機落子但不填自己的真眼；雙方都無子可下時結束，以數子法（含貼目）判勝負。
 * - 搜尋：UCT + RAVE（AMAF），最後選擇訪問次數最多的走法。
 * - 打劫：樹內與模擬使用「簡單劫」；實際落子前由呼叫端以正式規則再次確認合法性。
 */
(function (global) {
  'use strict';

  const BoardArena = (global.BoardArena = global.BoardArena || {});

  const EMPTY = 0;
  const BLACK = 1;
  const WHITE = 2;
  const EDGE = 3;
  const PASS = -1;

  /* =========================================================================
   * 1. 快速棋盤
   * ========================================================================= */

  /**
   * 建立快速棋盤。
   * @param {number} size 路數
   * @param {number} komi 貼目
   * @returns {Object}
   */
  function createBoard(size, komi) {
    const W = size + 2;
    const n = W * W;
    const b = {
      size: size,
      W: W,
      komi: komi,
      color: new Uint8Array(n),
      next: new Int32Array(n), // 棋串循環鏈結
      head: new Int32Array(n), // 棋串代表點
      libs: new Int32Array(n), // 代表點上的虛擬氣數
      ko: -1,
      toPlay: BLACK,
      passes: 0,
      neighbors: [-W, 1, W, -1],
      diagonals: [-W - 1, -W + 1, W - 1, W + 1],
      points: []
    };
    for (let i = 0; i < n; i++) {
      const r = Math.floor(i / W);
      const c = i % W;
      if (r === 0 || c === 0 || r === W - 1 || c === W - 1) {
        b.color[i] = EDGE;
      } else {
        b.points.push(i);
      }
    }
    return b;
  }

  function copyBoard(src) {
    return {
      size: src.size,
      W: src.W,
      komi: src.komi,
      color: src.color.slice(),
      next: src.next.slice(),
      head: src.head.slice(),
      libs: src.libs.slice(),
      ko: src.ko,
      toPlay: src.toPlay,
      passes: src.passes,
      neighbors: src.neighbors,
      diagonals: src.diagonals,
      points: src.points
    };
  }

  function opponent(c) {
    return c === BLACK ? WHITE : BLACK;
  }

  /** 把一顆子加入棋盤（不處理提子），回傳其棋串代表點 */
  function placeStone(b, p, c) {
    const color = b.color;
    color[p] = c;
    b.head[p] = p;
    b.next[p] = p;
    let libs = 0;
    for (let k = 0; k < 4; k++) if (color[p + b.neighbors[k]] === EMPTY) libs++;
    b.libs[p] = libs;
    return p;
  }

  /** 合併兩個同色棋串（虛擬氣數直接相加） */
  function mergeGroups(b, h1, h2) {
    if (h1 === h2) return h1;
    // 把 h2 的每顆子指向 h1
    let s = h2;
    do {
      b.head[s] = h1;
      s = b.next[s];
    } while (s !== h2);
    const t = b.next[h1];
    b.next[h1] = b.next[h2];
    b.next[h2] = t;
    b.libs[h1] += b.libs[h2];
    return h1;
  }

  /** 提走整個棋串，回傳提子數 */
  function removeGroup(b, h) {
    let count = 0;
    let s = h;
    do {
      const nextStone = b.next[s];
      b.color[s] = EMPTY;
      count++;
      // 鄰接棋串得到一口虛擬氣
      for (let k = 0; k < 4; k++) {
        const q = s + b.neighbors[k];
        const qc = b.color[q];
        if (qc === BLACK || qc === WHITE) b.libs[b.head[q]]++;
      }
      s = nextStone;
    } while (s !== h);
    return count;
  }

  /**
   * 判斷在 p 落子 c 是否合法（空點、非簡單劫、非自殺）。
   * 虛擬氣數判斷：棋串與 p 相鄰的次數等於其虛擬氣數時，代表 p 是它唯一的氣。
   */
  function isLegal(b, p, c) {
    if (b.color[p] !== EMPTY || p === b.ko) return false;
    const opp = opponent(c);
    const nb = b.neighbors;
    for (let k = 0; k < 4; k++) {
      const q = p + nb[k];
      const qc = b.color[q];
      if (qc === EMPTY) return true;
      if (qc === EDGE) continue;
      const h = b.head[q];
      let adj = 0;
      for (let j = 0; j < 4; j++) {
        const r = p + nb[j];
        if ((b.color[r] === BLACK || b.color[r] === WHITE) && b.head[r] === h) adj++;
      }
      if (qc === c && b.libs[h] > adj) return true; // 連上有其他氣的己方棋串
      if (qc === opp && b.libs[h] === adj) return true; // 可提對方棋串
    }
    return false;
  }

  /**
   * 落子（呼叫前須確認合法）。更新提子與簡單劫。
   * @returns {number} 提子數
   */
  function play(b, p, c) {
    if (p === PASS) {
      b.ko = -1;
      b.passes++;
      b.toPlay = opponent(c);
      return 0;
    }
    b.passes = 0;
    const nb = b.neighbors;
    const opp = opponent(c);
    // 先扣掉周圍棋串因 p 被佔而失去的虛擬氣
    for (let k = 0; k < 4; k++) {
      const q = p + nb[k];
      const qc = b.color[q];
      if (qc === BLACK || qc === WHITE) b.libs[b.head[q]]--;
    }
    let h = placeStone(b, p, c);
    let captured = 0;
    let lastCaptured = -1;
    for (let k = 0; k < 4; k++) {
      const q = p + nb[k];
      const qc = b.color[q];
      if (qc === c) {
        h = mergeGroups(b, b.head[q], h);
      } else if (qc === opp && b.libs[b.head[q]] === 0) {
        const n = removeGroup(b, b.head[q]);
        if (n === 1) lastCaptured = q;
        captured += n;
      }
    }
    // 簡單劫：提一子、且落下的子成為單子且只有一口氣
    b.ko = -1;
    if (captured === 1 && b.next[p] === p && b.libs[p] === 1) b.ko = lastCaptured;
    b.toPlay = opp;
    return captured;
  }

  /** 是否為 c 方的真眼（模擬時不填） */
  function isEye(b, p, c) {
    const nb = b.neighbors;
    for (let k = 0; k < 4; k++) {
      const qc = b.color[p + nb[k]];
      if (qc !== c && qc !== EDGE) return false;
    }
    let bad = 0;
    let edge = 0;
    const dg = b.diagonals;
    for (let k = 0; k < 4; k++) {
      const qc = b.color[p + dg[k]];
      if (qc === EDGE) edge = 1;
      else if (qc === opponent(c)) bad++;
    }
    return bad + edge < 2;
  }

  /** 數子法分數（黑 − 白 − 貼目），終局時空點多為單點眼 */
  function areaScore(b) {
    let black = 0;
    let white = 0;
    const pts = b.points;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      const c = b.color[p];
      if (c === BLACK) black++;
      else if (c === WHITE) white++;
      else {
        let nB = false;
        let nW = false;
        for (let k = 0; k < 4; k++) {
          const qc = b.color[p + b.neighbors[k]];
          if (qc === BLACK) nB = true;
          else if (qc === WHITE) nW = true;
        }
        if (nB && !nW) black++;
        else if (nW && !nB) white++;
      }
    }
    return black - white - b.komi;
  }

  /* =========================================================================
   * 2. 模擬對局（含 AMAF 紀錄）
   * ========================================================================= */

  function randomInt(n) {
    return (Math.random() * n) | 0;
  }

  /**
   * 從目前局面隨機下到終局。
   * @param {Object} b 棋盤（會被修改）
   * @param {Int8Array} amaf 記錄每個點第一個由哪一方下（AMAF 用）
   * @returns {number} 勝方顏色
   */
  function playout(b, amaf) {
    const pts = b.points;
    const n = pts.length;
    const maxMoves = n * 3;
    const candidates = new Int32Array(n);
    let moves = 0;
    while (b.passes < 2 && moves < maxMoves) {
      const c = b.toPlay;
      // 隨機起點掃描：快速取得一個合法且不填眼的點
      let count = 0;
      for (let i = 0; i < n; i++) {
        const p = pts[i];
        if (b.color[p] === EMPTY) candidates[count++] = p;
      }
      let chosen = PASS;
      while (count > 0) {
        const idx = randomInt(count);
        const p = candidates[idx];
        if (!isEye(b, p, c) && isLegal(b, p, c)) {
          chosen = p;
          break;
        }
        candidates[idx] = candidates[--count];
      }
      if (chosen !== PASS && amaf[chosen] === 0) amaf[chosen] = c;
      play(b, chosen, c);
      moves++;
    }
    return areaScore(b) > 0 ? BLACK : WHITE;
  }

  /* =========================================================================
   * 3. UCT + RAVE 樹搜尋
   * ========================================================================= */

  const RAVE_EQUIV = 600;

  function createNode(move, player) {
    return {
      move: move, // 到達此節點的走法
      player: player, // 下這步的一方
      visits: 0,
      wins: 0,
      amafVisits: 0,
      amafWins: 0,
      children: null
    };
  }

  function expand(node, b) {
    const c = b.toPlay;
    const kids = [];
    const pts = b.points;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      if (b.color[p] === EMPTY && !isEye(b, p, c) && isLegal(b, p, c)) kids.push(createNode(p, c));
    }
    // 只有在沒有其他合理走法，或對方已虛手時，才把虛手列入
    if (kids.length === 0 || b.passes > 0) kids.push(createNode(PASS, c));
    node.children = kids;
  }

  function selectChild(node) {
    let best = null;
    let bestVal = -Infinity;
    const logN = Math.log(node.visits + 1);
    const kids = node.children;
    for (let i = 0; i < kids.length; i++) {
      const ch = kids[i];
      let value;
      if (ch.visits === 0 && ch.amafVisits === 0) {
        value = 10 + Math.random(); // 尚未探索：優先
      } else {
        const q = ch.visits > 0 ? ch.wins / ch.visits : 0.5;
        const aq = ch.amafVisits > 0 ? ch.amafWins / ch.amafVisits : 0.5;
        const beta = Math.sqrt(RAVE_EQUIV / (3 * ch.visits + RAVE_EQUIV));
        value = (1 - beta) * q + beta * aq + 0.2 * Math.sqrt(logN / (ch.visits + 1));
      }
      if (value > bestVal) {
        bestVal = value;
        best = ch;
      }
    }
    return best;
  }

  /**
   * 執行 MCTS。
   * @param {Object} rootBoard 快速棋盤
   * @param {{timeMs:number, maxPlayouts:number}} limits 時間與次數上限
   * @returns {{ranked: Array<{move:number, visits:number, winRate:number}>, playouts:number}}
   */
  function search(rootBoard, limits) {
    const root = createNode(PASS, opponent(rootBoard.toPlay));
    expand(root, rootBoard);
    const deadline = Date.now() + limits.timeMs;
    const amaf = new Int8Array(rootBoard.color.length);
    const path = [];
    let playouts = 0;

    while (playouts < limits.maxPlayouts && (playouts & 15 || Date.now() < deadline)) {
      const b = copyBoard(rootBoard);
      amaf.fill(0);
      path.length = 0;
      let node = root;
      path.push(node);
      // 選擇
      while (node.children && node.children.length) {
        const child = selectChild(node);
        if (child.move !== PASS && !isLegal(b, child.move, child.player)) {
          // 樹內局面因劫等原因不合法：移除此子節點
          node.children.splice(node.children.indexOf(child), 1);
          if (!node.children.length) break;
          continue;
        }
        if (child.move !== PASS && amaf[child.move] === 0) amaf[child.move] = child.player;
        play(b, child.move, child.player);
        node = child;
        path.push(node);
        if (b.passes >= 2) break;
      }
      // 展開
      if (!node.children && node.visits > 0 && b.passes < 2) {
        expand(node, b);
      }
      // 模擬
      const winner = b.passes >= 2 ? (areaScore(b) > 0 ? BLACK : WHITE) : playout(b, amaf);
      // 回傳
      for (let i = 0; i < path.length; i++) {
        const nd = path[i];
        nd.visits++;
        if (nd.player === winner) nd.wins++;
        if (nd.children) {
          const kids = nd.children;
          for (let k = 0; k < kids.length; k++) {
            const ch = kids[k];
            if (ch.move !== PASS && amaf[ch.move] === ch.player) {
              ch.amafVisits++;
              if (ch.player === winner) ch.amafWins++;
            }
          }
        }
      }
      playouts++;
    }

    const ranked = root.children
      .map(function (ch) {
        return { move: ch.move, visits: ch.visits, winRate: ch.visits ? ch.wins / ch.visits : 0 };
      })
      .sort(function (a, b) {
        return b.visits - a.visits;
      });
    // 主要變化（沿訪問次數最多的子節點）的深度：代表實際往下看了幾手
    let pvDepth = 0;
    for (let nd = root; nd.children && nd.children.length; ) {
      let best = null;
      for (let i = 0; i < nd.children.length; i++) {
        if (!best || nd.children[i].visits > best.visits) best = nd.children[i];
      }
      if (!best || best.visits < 2) break;
      pvDepth++;
      nd = best;
    }
    return { ranked: ranked, playouts: playouts, pvDepth: pvDepth };
  }

  /* =========================================================================
   * 4. 與規則引擎狀態互轉
   * ========================================================================= */

  /** 由 go.js 的遊戲狀態建立快速棋盤 */
  function fromRuleState(state) {
    const size = state.size || state.board.length;
    const komi = typeof state.komi === 'number' ? state.komi : size === 9 ? 5.5 : 7.5;
    const b = createBoard(size, komi);
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        const v = state.board[r][c];
        if (v === BLACK || v === WHITE) {
          const p = (r + 1) * b.W + (c + 1);
          for (let k = 0; k < 4; k++) {
            const q = p + b.neighbors[k];
            const qc = b.color[q];
            if (qc === BLACK || qc === WHITE) b.libs[b.head[q]]--;
          }
          let h = placeStone(b, p, v);
          for (let k = 0; k < 4; k++) {
            const q = p + b.neighbors[k];
            if (b.color[q] === v) h = mergeGroups(b, b.head[q], h);
          }
        }
      }
    }
    b.toPlay = state.currentPlayer;
    b.passes = state.consecutivePasses || 0;
    return b;
  }

  function pointToRC(b, p) {
    return { r: Math.floor(p / b.W) - 1, c: (p % b.W) - 1 };
  }

  /** 各難度的搜尋設定 */
  const LEVELS = {
    easy: { timeMs: 120, maxPlayouts: 150 },
    normal: { timeMs: 300, maxPlayouts: 1200 },
    hard: { timeMs: 600, maxPlayouts: 1e9 },
    master: { timeMs: 950, maxPlayouts: 1e9 }
  };

  /**
   * 選出一步棋（回傳規則引擎的合法走法物件）。
   * @param {Object} rule go 規則物件
   * @param {Object} state 遊戲狀態
   * @param {Array} legalMoves 規則引擎的合法走法
   * @param {string} levelKey 難度
   * @returns {{move: Object, stats: Object}|null}
   */
  function chooseMove(rule, state, legalMoves, levelKey) {
    const limits = LEVELS[levelKey] || LEVELS.normal;
    const b = fromRuleState(state);
    const started = Date.now();
    const result = search(b, limits);
    const byKey = {};
    let passMove = null;
    for (let i = 0; i < legalMoves.length; i++) {
      const m = legalMoves[i];
      if (m.action === 'pass') passMove = m;
      else if (m.to) byKey[m.to.r + ',' + m.to.c] = m;
    }
    for (let i = 0; i < result.ranked.length; i++) {
      const cand = result.ranked[i];
      let move = null;
      if (cand.move === PASS) move = passMove;
      else {
        const rc = pointToRC(b, cand.move);
        move = byKey[rc.r + ',' + rc.c] || null; // 正式規則（含全局同形）再確認
      }
      if (move) {
        return {
          move: move,
          stats: {
            gameId: 'go',
            levelKey: levelKey,
            depthReached: result.pvDepth,
            nodes: result.playouts,
            elapsedMs: Date.now() - started,
            bestScore: Math.round(cand.winRate * 100),
            source: 'go-mcts-rave'
          }
        };
      }
    }
    return passMove ? { move: passMove, stats: { gameId: 'go', levelKey: levelKey, source: 'go-mcts-pass' } } : null;
  }

  BoardArena.GoMCTS = {
    chooseMove: chooseMove,
    LEVELS: LEVELS,
    // 測試用
    _internal: { createBoard: createBoard, fromRuleState: fromRuleState, isLegal: isLegal, play: play, areaScore: areaScore, search: search, PASS: PASS }
  };
})(typeof window !== 'undefined' ? window : globalThis);
