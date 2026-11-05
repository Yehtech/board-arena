/**
 * Classic Board Arena — Gomoku 15x15 Rule Engine
 * Supports standard 5-in-a-row (5+ contiguous) and Three-Move Swap (Pie Rule, default true),
 * neighbor/tactical move ordering, and 4-axis threat pattern evaluation.
 */
(function (global) {
  'use strict';

  const BoardArena = (global.BoardArena = global.BoardArena || {});

  const SIZE = 15;
  const TOTAL_CELLS = SIZE * SIZE;
  const COL_LABELS = 'ABCDEFGHIJKLMNO';
  const AXES = [
    [0, 1],
    [1, 0],
    [1, 1],
    [1, -1]
  ];

  const STAR_POINTS = [
    { r: 3, c: 3 },
    { r: 3, c: 11 },
    { r: 7, c: 7 },
    { r: 11, c: 3 },
    { r: 11, c: 11 }
  ];

  function createEmptyBoard() {
    const b = new Array(SIZE);
    for (let r = 0; r < SIZE; r++) {
      const row = new Array(SIZE);
      for (let c = 0; c < SIZE; c++) row[c] = 0;
      b[r] = row;
    }
    return b;
  }

  function cloneBoard(board) {
    const out = new Array(SIZE);
    for (let r = 0; r < SIZE; r++) {
      out[r] = board[r].slice();
    }
    return out;
  }

  function cloneState(state) {
    return {
      gameId: 'gomoku',
      rows: SIZE,
      cols: SIZE,
      board: cloneBoard(state.board),
      currentPlayer: state.currentPlayer,
      stoneCount: state.stoneCount,
      swapRule: state.swapRule,
      swapOffered: state.swapOffered,
      swappedSides: state.swappedSides,
      winningLine: state.winningLine
        ? state.winningLine.map(function (p) { return { r: p.r, c: p.c }; })
        : null,
      turnNumber: state.turnNumber,
      status: state.status,
      winner: state.winner,
      endReason: state.endReason,
      lastMove: state.lastMove
        ? {
            id: state.lastMove.id,
            action: state.lastMove.action || null,
            from: null,
            to: state.lastMove.to ? { r: state.lastMove.to.r, c: state.lastMove.to.c } : null,
            isCapture: false,
            notation: state.lastMove.notation,
            player: state.lastMove.player
          }
        : null,
      moveHistory: state.moveHistory ? state.moveHistory.slice() : []
    };
  }

  function createInitialState(options) {
    const swapRule = options && typeof options.swapRule === 'boolean' ? options.swapRule : true;
    return {
      gameId: 'gomoku',
      rows: SIZE,
      cols: SIZE,
      board: createEmptyBoard(),
      currentPlayer: 1,
      stoneCount: 0,
      swapRule: swapRule,
      swapOffered: false,
      swappedSides: false,
      winningLine: null,
      turnNumber: 1,
      status: 'playing',
      winner: null,
      endReason: null,
      lastMove: null,
      moveHistory: []
    };
  }

  // Quick local run-length check at empty (r, c) for tactical move ordering
  function quickPointTacticalScore(board, r, c, player, opp) {
    let bonus = 0;
    for (let a = 0; a < 4; a++) {
      const dr = AXES[a][0];
      const dc = AXES[a][1];

      // Friendly contiguous chain through (r, c)
      let myLen = 1;
      let openEnds = 0;
      let nr = r + dr;
      let nc = c + dc;
      while (nr >= 0 && nr < SIZE && nc >= 0 && nc < SIZE && board[nr][nc] === player) {
        myLen++;
        nr += dr;
        nc += dc;
      }
      if (nr >= 0 && nr < SIZE && nc >= 0 && nc < SIZE && board[nr][nc] === 0) openEnds++;

      nr = r - dr;
      nc = c - dc;
      while (nr >= 0 && nr < SIZE && nc >= 0 && nc < SIZE && board[nr][nc] === player) {
        myLen++;
        nr -= dr;
        nc -= dc;
      }
      if (nr >= 0 && nr < SIZE && nc >= 0 && nc < SIZE && board[nr][nc] === 0) openEnds++;

      if (myLen >= 5) bonus += 100000;
      else if (myLen === 4) bonus += openEnds === 2 ? 20000 : openEnds === 1 ? 4500 : 0;
      else if (myLen === 3 && openEnds === 2) bonus += 2200;
      else if (myLen === 2 && openEnds === 2) bonus += 160;

      // Opponent contiguous chain blocked at (r, c)
      let oppLen = 1;
      let oppOpen = 0;
      nr = r + dr;
      nc = c + dc;
      while (nr >= 0 && nr < SIZE && nc >= 0 && nc < SIZE && board[nr][nc] === opp) {
        oppLen++;
        nr += dr;
        nc += dc;
      }
      if (nr >= 0 && nr < SIZE && nc >= 0 && nc < SIZE && board[nr][nc] === 0) oppOpen++;

      nr = r - dr;
      nc = c - dc;
      while (nr >= 0 && nr < SIZE && nc >= 0 && nc < SIZE && board[nr][nc] === opp) {
        oppLen++;
        nr -= dr;
        nc -= dc;
      }
      if (nr >= 0 && nr < SIZE && nc >= 0 && nc < SIZE && board[nr][nc] === 0) oppOpen++;

      if (oppLen >= 5) bonus += 80000;
      else if (oppLen === 4) bonus += oppOpen === 2 ? 16000 : oppOpen === 1 ? 3800 : 0;
      else if (oppLen === 3 && oppOpen === 2) bonus += 1900;
      else if (oppLen === 2 && oppOpen === 2) bonus += 120;
    }
    return bonus;
  }

  function getLegalMoves(state, player) {
    if (!state || state.status === 'ended') return [];
    const p = player || state.currentPlayer;
    const opp = p === 1 ? 2 : 1;
    const board = state.board;
    const hasStones = state.stoneCount > 0;
    const scored = [];

    for (let r = 0; r < SIZE; r++) {
      const row = board[r];
      for (let c = 0; c < SIZE; c++) {
        if (row[c] !== 0) continue;

        const centerBias = 28 - (Math.abs(r - 7) * 2 + Math.abs(c - 7) * 2 + Math.max(Math.abs(r - 7), Math.abs(c - 7)));
        let priority = centerBias;

        if (hasStones) {
          let n1 = 0;
          let n2 = 0;
          const rMin = r > 1 ? r - 2 : 0;
          const rMax = r < SIZE - 2 ? r + 2 : SIZE - 1;
          const cMin = c > 1 ? c - 2 : 0;
          const cMax = c < SIZE - 2 ? c + 2 : SIZE - 1;

          for (let nr = rMin; nr <= rMax; nr++) {
            const nRow = board[nr];
            for (let nc = cMin; nc <= cMax; nc++) {
              if (nRow[nc] === 0) continue;
              const cheb = Math.max(Math.abs(nr - r), Math.abs(nc - c));
              if (cheb === 1) n1++;
              else if (cheb === 2) n2++;
            }
          }

          if (n1 > 0 || n2 > 0) {
            priority += 300 + n1 * 90 + n2 * 18;
            if (n1 > 0) {
              priority += quickPointTacticalScore(board, r, c, p, opp);
            }
          }
        }

        scored.push({
          priority: priority,
          move: {
            id: 'r' + r + 'c' + c,
            from: null,
            to: { r: r, c: c },
            isCapture: false,
            notation: COL_LABELS[c] + (SIZE - r)
          }
        });
      }
    }

    scored.sort(function (a, b) {
      if (b.priority !== a.priority) return b.priority - a.priority;
      if (a.move.to.r !== b.move.to.r) return a.move.to.r - b.move.to.r;
      return a.move.to.c - b.move.to.c;
    });

    const moves = new Array(scored.length);
    for (let i = 0; i < scored.length; i++) {
      moves[i] = scored[i].move;
    }

    if (state.swapRule && state.swapOffered && !state.swappedSides && state.turnNumber === 4) {
      moves.push({
        id: 'swap',
        action: 'swap',
        from: null,
        to: null,
        isCapture: false,
        notation: 'SWAP'
      });
    }

    return moves;
  }

  function findWinningLineAt(board, r, c, player) {
    for (let a = 0; a < 4; a++) {
      const dr = AXES[a][0];
      const dc = AXES[a][1];
      let sr = r;
      let sc = c;
      while (
        sr - dr >= 0 &&
        sr - dr < SIZE &&
        sc - dc >= 0 &&
        sc - dc < SIZE &&
        board[sr - dr][sc - dc] === player
      ) {
        sr -= dr;
        sc -= dc;
      }
      const line = [];
      let cr = sr;
      let cc = sc;
      while (cr >= 0 && cr < SIZE && cc >= 0 && cc < SIZE && board[cr][cc] === player) {
        line.push({ r: cr, c: cc });
        cr += dr;
        cc += dc;
      }
      if (line.length >= 5) {
        return line;
      }
    }
    return null;
  }

  function applyMove(state, move) {
    if (!state || state.status === 'ended') {
      throw new Error('Cannot apply move to an ended Gomoku game.');
    }
    if (!move) {
      throw new Error('Missing Gomoku move.');
    }

    const player = state.currentPlayer;
    const opponent = player === 1 ? 2 : 1;

    // Handle Three-Move Swap action on move 4
    if (move.action === 'swap' || move.id === 'swap') {
      if (!state.swapRule || !state.swapOffered || state.swappedSides || state.turnNumber !== 4) {
        throw new Error('Swap rule is only legal immediately after the 3rd opening stone.');
      }
      const next = cloneState(state);
      // Flip ownership of the 3 tentative opening stones so Player 2 assumes the 2-stone opening
      // and Player 1 assumes the 1-stone side and receives the turn to place the 4th stone cleanly.
      for (let r = 0; r < SIZE; r++) {
        for (let c = 0; c < SIZE; c++) {
          if (next.board[r][c] === 1) next.board[r][c] = 2;
          else if (next.board[r][c] === 2) next.board[r][c] = 1;
        }
      }
      next.swappedSides = true;
      next.swapOffered = false;
      next.currentPlayer = opponent;
      next.turnNumber = state.turnNumber + 1;
      next.lastMove = {
        id: 'swap',
        action: 'swap',
        from: null,
        to: null,
        isCapture: false,
        notation: 'SWAP',
        player: player
      };
      next.moveHistory.push('SWAP');
      return next;
    }

    // Resolve coordinate from move.to or move.id ('r7c7')
    let tr = -1;
    let tc = -1;
    if (move.to && typeof move.to.r === 'number' && typeof move.to.c === 'number') {
      tr = move.to.r;
      tc = move.to.c;
    } else if (typeof move.id === 'string') {
      const m = /^r(\d+)c(\d+)$/.exec(move.id);
      if (m) {
        tr = Number(m[1]);
        tc = Number(m[2]);
      }
    }

    if (tr < 0 || tr >= SIZE || tc < 0 || tc >= SIZE || state.board[tr][tc] !== 0) {
      throw new Error('Illegal Gomoku stone placement.');
    }

    const next = cloneState(state);
    next.board[tr][tc] = player;
    next.stoneCount = (state.stoneCount || 0) + 1;
    next.turnNumber = state.turnNumber + 1;

    const notation = COL_LABELS[tc] + (SIZE - tr);
    next.lastMove = {
      id: 'r' + tr + 'c' + tc,
      action: null,
      from: null,
      to: { r: tr, c: tc },
      isCapture: false,
      notation: notation,
      player: player
    };
    next.moveHistory.push(notation);

    const winLine = findWinningLineAt(next.board, tr, tc, player);
    if (winLine) {
      next.winningLine = winLine;
      next.status = 'ended';
      next.winner = player;
      next.endReason = 'five_in_row';
      next.swapOffered = false;
      return next;
    }

    if (next.stoneCount >= TOTAL_CELLS) {
      next.status = 'ended';
      next.winner = 0;
      next.endReason = 'full_board';
      next.swapOffered = false;
      return next;
    }

    next.currentPlayer = opponent;
    next.swapOffered = Boolean(next.swapRule && !next.swappedSides && next.stoneCount === 3 && next.turnNumber === 4);
    return next;
  }

  // Score one directional ray starting at (sr, sc) with step (dr, dc), updating scores[1] and scores[2]
  function scoreLinePatterns(board, sr, sc, dr, dc, scores) {
    // Walk line cells by index k = 0 .. len-1
    let len = 0;
    let tr = sr;
    let tc = sc;
    while (tr >= 0 && tr < SIZE && tc >= 0 && tc < SIZE) {
      len++;
      tr += dr;
      tc += dc;
    }
    if (len < 5) return;

    let i = 0;
    while (i < len) {
      const cell = board[sr + i * dr][sc + i * dc];
      if (cell === 0) {
        i++;
        continue;
      }

      // Contiguous run [i .. j] of color `cell`
      let j = i;
      while (j + 1 < len && board[sr + (j + 1) * dr][sc + (j + 1) * dc] === cell) {
        j++;
      }
      const runLen = j - i + 1;

      if (runLen >= 5) {
        scores[cell] += 100000;
        i = j + 1;
        continue;
      }

      const openLeft = i > 0 && board[sr + (i - 1) * dr][sc + (i - 1) * dc] === 0;
      const openRight = j + 1 < len && board[sr + (j + 1) * dr][sc + (j + 1) * dc] === 0;

      // Measure maximum available span (own stones + empties) to ensure pattern isn't cramped to <5
      let leftRoom = 0;
      let k = i - 1;
      while (k >= 0 && leftRoom < 4) {
        const v = board[sr + k * dr][sc + k * dc];
        if (v !== 0 && v !== cell) break;
        leftRoom++;
        k--;
      }
      let rightRoom = 0;
      k = j + 1;
      while (k < len && rightRoom < 4) {
        const v = board[sr + k * dr][sc + k * dc];
        if (v !== 0 && v !== cell) break;
        rightRoom++;
        k++;
      }

      if (runLen + leftRoom + rightRoom >= 5) {
        const openEnds = (openLeft ? 1 : 0) + (openRight ? 1 : 0);

        // Check 1-gap split patterns looking right (e.g. XXX.X, XX.XX, XX.X, X.XX)
        let splitHandled = false;
        if (openRight && j + 2 < len && board[sr + (j + 2) * dr][sc + (j + 2) * dc] === cell) {
          let r2 = 1;
          while (j + 2 + r2 < len && board[sr + (j + 2 + r2) * dr][sc + (j + 2 + r2) * dc] === cell) {
            r2++;
          }
          const combined = runLen + r2;
          const farRightOpen =
            j + 2 + r2 < len && board[sr + (j + 2 + r2) * dr][sc + (j + 2 + r2) * dc] === 0;
          if (combined >= 4) {
            // Broken four (XXX.X, X.XXX, XX.XX): immediate 1-move threat to make 5
            scores[cell] += 3200;
            splitHandled = true;
          } else if (combined === 3) {
            if (openLeft && farRightOpen) {
              scores[cell] += 1500;
              splitHandled = true;
            } else if (openLeft || farRightOpen) {
              scores[cell] += 320;
              splitHandled = true;
            }
          }
        }

        if (!splitHandled) {
          if (runLen === 4) {
            if (openEnds === 2) scores[cell] += 15000;
            else if (openEnds === 1) scores[cell] += 3200;
          } else if (runLen === 3) {
            if (openEnds === 2) scores[cell] += 1800;
            else if (openEnds === 1) scores[cell] += 350;
          } else if (runLen === 2) {
            if (openEnds === 2) scores[cell] += 90;
            else if (openEnds === 1) scores[cell] += 18;
          }
        }
      }

      i = j + 1;
    }
  }

  function evaluate(state, perspectivePlayer) {
    const me = perspectivePlayer || state.currentPlayer;
    const opp = me === 1 ? 2 : 1;

    if (state.status === 'ended') {
      if (state.winner === me) return 100000;
      if (state.winner === opp) return -100000;
      return 0;
    }

    const board = state.board;
    const scores = { 1: 0, 2: 0 };

    // Small center-control tie-breaker
    for (let r = 0; r < SIZE; r++) {
      const row = board[r];
      for (let c = 0; c < SIZE; c++) {
        const v = row[c];
        if (v !== 0) {
          scores[v] += 14 - (Math.abs(r - 7) + Math.abs(c - 7));
        }
      }
    }

    // 1. Horizontal lines (dr=0, dc=1)
    for (let r = 0; r < SIZE; r++) {
      scoreLinePatterns(board, r, 0, 0, 1, scores);
    }
    // 2. Vertical lines (dr=1, dc=0)
    for (let c = 0; c < SIZE; c++) {
      scoreLinePatterns(board, 0, c, 1, 0, scores);
    }
    // 3. Main diagonals (dr=1, dc=1)
    for (let c = 0; c <= SIZE - 5; c++) {
      scoreLinePatterns(board, 0, c, 1, 1, scores);
    }
    for (let r = 1; r <= SIZE - 5; r++) {
      scoreLinePatterns(board, r, 0, 1, 1, scores);
    }
    // 4. Anti-diagonals (dr=1, dc=-1)
    for (let c = 4; c < SIZE; c++) {
      scoreLinePatterns(board, 0, c, 1, -1, scores);
    }
    for (let r = 1; r <= SIZE - 5; r++) {
      scoreLinePatterns(board, r, SIZE - 1, 1, -1, scores);
    }

    if (scores[me] >= 100000) return 100000;
    if (scores[opp] >= 100000) return -100000;

    return Math.round(scores[me] - scores[opp] * 1.15);
  }

  function canSelectSource(state, source) {
    if (!state || state.status === 'ended') {
      return { ok: false, selectable: false, hasMoves: false, moves: [], reasonZh: '對局已結束。', reasonEn: 'Game has ended.' };
    }
    if (!source || typeof source.r !== 'number' || typeof source.c !== 'number') {
      return { ok: false, selectable: false, hasMoves: false, moves: [], reasonZh: '請點擊空白交叉點落子。', reasonEn: 'Click an empty intersection.' };
    }
    if (
      source.r >= 0 &&
      source.r < SIZE &&
      source.c >= 0 &&
      source.c < SIZE &&
      state.board[source.r][source.c] === 0
    ) {
      const m = {
        id: 'r' + source.r + 'c' + source.c,
        from: null,
        to: { r: source.r, c: source.c },
        isCapture: false,
        notation: COL_LABELS[source.c] + (SIZE - source.r)
      };
      return { ok: true, selectable: true, hasMoves: true, moves: [m], reasonZh: '', reasonEn: '' };
    }
    return {
      ok: false,
      selectable: false,
      hasMoves: false,
      moves: [],
      reasonZh: '此交叉點已有棋子。',
      reasonEn: 'Intersection is already occupied.'
    };
  }

  BoardArena.registerRule('gomoku', {
    id: 'gomoku',
    selectionMode: 'drop',
    rows: SIZE,
    cols: SIZE,
    starPoints: STAR_POINTS,
    sideLabels: {
      1: { zh: '黑方', en: 'Black' },
      2: { zh: '白方', en: 'White' }
    },
    createInitialState: createInitialState,
    cloneState: cloneState,
    getLegalMoves: getLegalMoves,
    canSelectSource: canSelectSource,
    applyMove: applyMove,
    evaluate: evaluate
  });
})(typeof window !== 'undefined' ? window : globalThis);
