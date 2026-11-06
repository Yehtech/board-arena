// ============================================
// Date: 2026-11-06
// Version: v1.2.0
// Changes: Selection reasons returned as language-neutral messages
// 修改: 選子提示改回傳語言中立的訊息
// ============================================
/**
 * Classic Board Arena — Othello (Reversi) 8x8 Rule Engine
 * Tournament rules: 8-direction outflank flips, mandatory auto-pass when stuck,
 * game end when neither side can move, and corner/X/C-square + mobility + parity evaluation.
 */
(function (global) {
  'use strict';

  const BoardArena = (global.BoardArena = global.BoardArena || {});
  const msg = BoardArena.msg;

  const ROWS = 8;
  const COLS = 8;
  const COL_LABELS = 'ABCDEFGH';
  const DIRS = [
    [-1, -1], [-1, 0], [-1, 1],
    [0, -1],           [0, 1],
    [1, -1],  [1, 0],  [1, 1]
  ];

  // Base static hints used for fast move ordering and inner-square scoring
  const INNER_WEIGHTS = [
    [120, -20,  15,  15,  15,  15, -20, 120],
    [-20, -40,  -2,  -2,  -2,  -2, -40, -20],
    [ 15,  -2,   8,   4,   4,   8,  -2,  15],
    [ 15,  -2,   4,   2,   2,   4,  -2,  15],
    [ 15,  -2,   4,   2,   2,   4,  -2,  15],
    [ 15,  -2,   8,   4,   4,   8,  -2,  15],
    [-20, -40,  -2,  -2,  -2,  -2, -40, -20],
    [120, -20,  15,  15,  15,  15, -20, 120]
  ];

  const CORNER_QUADS = [
    { cr: 0, cc: 0, xr: 1, xc: 1, c1r: 0, c1c: 1, c2r: 1, c2c: 0 },
    { cr: 0, cc: 7, xr: 1, xc: 6, c1r: 0, c1c: 6, c2r: 1, c2c: 7 },
    { cr: 7, cc: 0, xr: 6, xc: 1, c1r: 7, c1c: 1, c2r: 6, c2c: 0 },
    { cr: 7, cc: 7, xr: 6, xc: 6, c1r: 7, c1c: 6, c2r: 6, c2c: 7 }
  ];

  function createEmptyBoard() {
    const b = new Array(ROWS);
    for (let r = 0; r < ROWS; r++) {
      b[r] = [0, 0, 0, 0, 0, 0, 0, 0];
    }
    return b;
  }

  function cloneBoard(board) {
    const out = new Array(ROWS);
    for (let r = 0; r < ROWS; r++) {
      out[r] = board[r].slice();
    }
    return out;
  }

  function cloneState(state) {
    return {
      gameId: 'othello',
      rows: ROWS,
      cols: COLS,
      board: cloneBoard(state.board),
      currentPlayer: state.currentPlayer,
      counts: { 1: state.counts[1], 2: state.counts[2] },
      autoPassedPlayer: state.autoPassedPlayer || null,
      turnNumber: state.turnNumber,
      status: state.status,
      winner: state.winner,
      endReason: state.endReason,
      lastMove: state.lastMove
        ? {
            id: state.lastMove.id,
            from: null,
            to: state.lastMove.to ? { r: state.lastMove.to.r, c: state.lastMove.to.c } : null,
            isCapture: state.lastMove.isCapture,
            captures: state.lastMove.captures
              ? state.lastMove.captures.map(function (p) { return { r: p.r, c: p.c }; })
              : [],
            notation: state.lastMove.notation,
            player: state.lastMove.player
          }
        : null,
      moveHistory: state.moveHistory ? state.moveHistory.slice() : []
    };
  }

  function collectFlips(board, r, c, player) {
    if (board[r][c] !== 0) return null;
    const opp = player === 1 ? 2 : 1;
    let flips = null;

    for (let d = 0; d < 8; d++) {
      const dr = DIRS[d][0];
      const dc = DIRS[d][1];
      let nr = r + dr;
      let nc = c + dc;
      if (nr < 0 || nr >= ROWS || nc < 0 || nc >= COLS || board[nr][nc] !== opp) {
        continue;
      }

      let steps = 1;
      nr += dr;
      nc += dc;
      while (nr >= 0 && nr < ROWS && nc >= 0 && nc < COLS && board[nr][nc] === opp) {
        steps++;
        nr += dr;
        nc += dc;
      }

      if (nr >= 0 && nr < ROWS && nc >= 0 && nc < COLS && board[nr][nc] === player) {
        if (!flips) flips = [];
        for (let k = 1; k <= steps; k++) {
          flips.push({ r: r + dr * k, c: c + dc * k });
        }
      }
    }

    return flips;
  }

  function canOutflankAt(board, r, c, player) {
    if (board[r][c] !== 0) return false;
    const opp = player === 1 ? 2 : 1;
    for (let d = 0; d < 8; d++) {
      const dr = DIRS[d][0];
      const dc = DIRS[d][1];
      let nr = r + dr;
      let nc = c + dc;
      if (nr < 0 || nr >= ROWS || nc < 0 || nc >= COLS || board[nr][nc] !== opp) {
        continue;
      }
      nr += dr;
      nc += dc;
      while (nr >= 0 && nr < ROWS && nc >= 0 && nc < COLS && board[nr][nc] === opp) {
        nr += dr;
        nc += dc;
      }
      if (nr >= 0 && nr < ROWS && nc >= 0 && nc < COLS && board[nr][nc] === player) {
        return true;
      }
    }
    return false;
  }

  function hasAnyLegalMove(board, player) {
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if (board[r][c] === 0 && canOutflankAt(board, r, c, player)) {
          return true;
        }
      }
    }
    return false;
  }

  function countLegalMoves(board, player) {
    let count = 0;
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if (board[r][c] === 0 && canOutflankAt(board, r, c, player)) {
          count++;
        }
      }
    }
    return count;
  }

  function createInitialState() {
    const board = createEmptyBoard();
    board[3][3] = 2;
    board[3][4] = 1;
    board[4][3] = 1;
    board[4][4] = 2;

    return {
      gameId: 'othello',
      rows: ROWS,
      cols: COLS,
      board: board,
      currentPlayer: 1,
      counts: { 1: 2, 2: 2 },
      autoPassedPlayer: null,
      turnNumber: 1,
      status: 'playing',
      winner: null,
      endReason: null,
      lastMove: null,
      moveHistory: []
    };
  }

  function getLegalMoves(state, player) {
    if (!state || state.status === 'ended') return [];
    const p = player || state.currentPlayer;
    const moves = [];

    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if (state.board[r][c] !== 0) continue;
        const flips = collectFlips(state.board, r, c, p);
        if (flips && flips.length > 0) {
          moves.push({
            id: 'r' + r + 'c' + c,
            from: null,
            to: { r: r, c: c },
            isCapture: true,
            captures: flips,
            notation: COL_LABELS[c] + (r + 1)
          });
        }
      }
    }

    // Order moves from strongest static square (corners first, X-squares last) for faster Alpha-Beta
    moves.sort(function (a, b) {
      const wa = INNER_WEIGHTS[a.to.r][a.to.c] + a.captures.length;
      const wb = INNER_WEIGHTS[b.to.r][b.to.c] + b.captures.length;
      if (wb !== wa) return wb - wa;
      if (a.to.r !== b.to.r) return a.to.r - b.to.r;
      return a.to.c - b.to.c;
    });

    return moves;
  }

  function resolveMove(state, move, player) {
    if (!move) return null;
    if (move.to && typeof move.to.r === 'number' && typeof move.to.c === 'number') {
      const r = move.to.r;
      const c = move.to.c;
      if (r < 0 || r >= ROWS || c < 0 || c >= COLS || state.board[r][c] !== 0) return null;
      const flips =
        Array.isArray(move.captures) && move.captures.length > 0
          ? move.captures
          : collectFlips(state.board, r, c, player);
      if (!flips || flips.length === 0) return null;
      return {
        id: 'r' + r + 'c' + c,
        from: null,
        to: { r: r, c: c },
        isCapture: true,
        captures: flips,
        notation: COL_LABELS[c] + (r + 1)
      };
    }
    if (typeof move.id === 'string') {
      const legal = getLegalMoves(state, player);
      for (let i = 0; i < legal.length; i++) {
        if (legal[i].id === move.id) return legal[i];
      }
    }
    return null;
  }

  function applyMove(state, move) {
    if (!state || state.status === 'ended') {
      throw new Error('Cannot apply move to an ended Othello game.');
    }
    const player = state.currentPlayer;
    const opponent = player === 1 ? 2 : 1;
    const resolved = resolveMove(state, move, player);
    if (!resolved) {
      throw new Error('Illegal Othello move.');
    }

    const next = cloneState(state);
    const board = next.board;
    const tr = resolved.to.r;
    const tc = resolved.to.c;

    board[tr][tc] = player;
    const caps = resolved.captures;
    for (let i = 0; i < caps.length; i++) {
      board[caps[i].r][caps[i].c] = player;
    }

    let bCount = 0;
    let wCount = 0;
    for (let r = 0; r < ROWS; r++) {
      const row = board[r];
      for (let c = 0; c < COLS; c++) {
        if (row[c] === 1) bCount++;
        else if (row[c] === 2) wCount++;
      }
    }
    next.counts = { 1: bCount, 2: wCount };
    next.turnNumber = state.turnNumber + 1;
    next.lastMove = {
      id: resolved.id,
      from: null,
      to: { r: tr, c: tc },
      isCapture: true,
      captures: caps.map(function (p) { return { r: p.r, c: p.c }; }),
      notation: resolved.notation,
      player: player
    };
    next.moveHistory.push(resolved.notation);

    if (hasAnyLegalMove(board, opponent)) {
      next.currentPlayer = opponent;
      next.autoPassedPlayer = null;
    } else if (hasAnyLegalMove(board, player)) {
      next.currentPlayer = player;
      next.autoPassedPlayer = opponent;
    } else {
      next.status = 'ended';
      next.autoPassedPlayer = null;
      next.winner = bCount > wCount ? 1 : wCount > bCount ? 2 : 0;
      next.endReason = 'disc_count';
    }

    return next;
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
    let myDiscs = 0;
    let oppDiscs = 0;
    let posScore = 0;

    // Score base board weights while adjusting X-squares and C-squares dynamically around occupied corners
    for (let r = 0; r < ROWS; r++) {
      const row = board[r];
      const wRow = INNER_WEIGHTS[r];
      for (let c = 0; c < COLS; c++) {
        const cell = row[c];
        if (cell === 0) continue;
        if (cell === me) {
          myDiscs++;
          posScore += wRow[c];
        } else {
          oppDiscs++;
          posScore -= wRow[c];
        }
      }
    }

    // If a corner is occupied, neutralize the empty-corner X-square (-40) and C-square (-20) penalties
    for (let q = 0; q < 4; q++) {
      const quad = CORNER_QUADS[q];
      const cornerOwner = board[quad.cr][quad.cc];
      if (cornerOwner !== 0) {
        const xCell = board[quad.xr][quad.xc];
        if (xCell !== 0) {
          // Restore -40 penalty to +6 supported inner diagonal
          posScore += (xCell === me ? 1 : -1) * 46;
        }
        const c1Cell = board[quad.c1r][quad.c1c];
        if (c1Cell !== 0) {
          // Restore -20 penalty to +18 stable edge adjacent to corner
          posScore += (c1Cell === me ? 1 : -1) * 38;
        }
        const c2Cell = board[quad.c2r][quad.c2c];
        if (c2Cell !== 0) {
          posScore += (c2Cell === me ? 1 : -1) * 38;
        }
      }
    }

    const myMoves = countLegalMoves(board, me);
    const oppMoves = countLegalMoves(board, opp);
    const mobilityScore = (myMoves - oppMoves) * 11;

    // Frontier discs (discs adjacent to at least one empty square are vulnerable to being flipped)
    let myFrontier = 0;
    let oppFrontier = 0;
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const cell = board[r][c];
        if (cell === 0) continue;
        let isFrontier = false;
        for (let d = 0; d < 8; d++) {
          const nr = r + DIRS[d][0];
          const nc = c + DIRS[d][1];
          if (nr >= 0 && nr < ROWS && nc >= 0 && nc < COLS && board[nr][nc] === 0) {
            isFrontier = true;
            break;
          }
        }
        if (isFrontier) {
          if (cell === me) myFrontier++;
          else oppFrontier++;
        }
      }
    }
    const frontierScore = (oppFrontier - myFrontier) * 5;

    // Corner-anchored edge stability (contiguous chains from occupied corners along the 4 edges)
    let stabilityScore = 0;
    const cornerCoords = [
      { r: 0, c: 0, dirs: [[0, 1], [1, 0]] },
      { r: 0, c: 7, dirs: [[0, -1], [1, 0]] },
      { r: 7, c: 0, dirs: [[0, 1], [-1, 0]] },
      { r: 7, c: 7, dirs: [[0, -1], [-1, 0]] }
    ];
    for (let k = 0; k < 4; k++) {
      const cc = cornerCoords[k];
      const owner = board[cc.r][cc.c];
      if (owner !== 0) {
        const sign = owner === me ? 1 : -1;
        for (let d = 0; d < 2; d++) {
          const dr = cc.dirs[d][0];
          const dc = cc.dirs[d][1];
          let sr = cc.r + dr;
          let sc = cc.c + dc;
          let steps = 0;
          while (steps < 6 && board[sr][sc] === owner) {
            stabilityScore += sign * 16;
            sr += dr;
            sc += dc;
            steps++;
          }
        }
      }
    }

    const totalDiscs = myDiscs + oppDiscs;
    let endgameScore = 0;
    if (totalDiscs >= 50) {
      const empties = 64 - totalDiscs;
      const discWeight = 14 + (totalDiscs - 50) * 3;
      endgameScore += (myDiscs - oppDiscs) * discWeight;
      // Disc parity: side moving on odd remaining empty squares gets the final move advantage
      const oddEmpties = (empties & 1) === 1;
      const parityFavorsCurrent = oddEmpties ? 16 : -16;
      endgameScore += state.currentPlayer === me ? parityFavorsCurrent : -parityFavorsCurrent;
    }

    return posScore + mobilityScore + frontierScore + stabilityScore + endgameScore;
  }

  function canSelectSource(state, source, player) {
    const p = player || state.currentPlayer;
    if (!state || state.status === 'ended') {
      return { ok: false, selectable: false, hasMoves: false, moves: [], reason: msg('rule.gameEnded') };
    }
    if (!source || typeof source.r !== 'number' || typeof source.c !== 'number') {
      return { ok: false, selectable: false, hasMoves: false, moves: [], reason: msg('rule.othello.selectEmpty') };
    }
    const flips = collectFlips(state.board, source.r, source.c, p);
    if (flips && flips.length > 0) {
      const move = {
        id: 'r' + source.r + 'c' + source.c,
        from: null,
        to: { r: source.r, c: source.c },
        isCapture: true,
        captures: flips,
        notation: COL_LABELS[source.c] + (source.r + 1)
      };
      return { ok: true, selectable: true, hasMoves: true, moves: [move] };
    }
    return {
      ok: false,
      selectable: false,
      hasMoves: false,
      moves: [],
      reason: msg('rule.othello.noOutflank')
    };
  }

  BoardArena.registerRule('othello', {
    id: 'othello',
    selectionMode: 'drop',
    rows: ROWS,
    cols: COLS,
    sideLabels: { 1: 'side.black', 2: 'side.white' },
    createInitialState: createInitialState,
    cloneState: cloneState,
    getLegalMoves: getLegalMoves,
    canSelectSource: canSelectSource,
    applyMove: applyMove,
    evaluate: evaluate
  });
})(typeof window !== 'undefined' ? window : globalThis);
