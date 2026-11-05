/**
 * Classic Board Arena — Shogi (日本將棋 9×9 + 駒台持駒打入) Complete Rule Engine
 * Implements exact 8-piece unpromoted/promoted movements, optional & mandatory Promotion (成り),
 * Komadai Hand Captures & Drops (持ち駒打入), Nifu (二步) double-pawn drop ban, dead-rank drop ban,
 * Strict Legal Check Filter (王手放置禁止), Checkmate, and Hand-aware King-Safety Evaluator.
 */
(function (global) {
  'use strict';

  const BoardArena = global.BoardArena;
  if (!BoardArena || typeof BoardArena.registerRule !== 'function') {
    throw new Error('BoardArena.registerRule is required before loading shogi.js');
  }

  const ROWS = 9;
  const COLS = 9;
  const HAND_ORDER = ['R', 'B', 'G', 'S', 'N', 'L', 'P'];
  const PROMOTABLE = { R: true, B: true, S: true, N: true, L: true, P: true };

  const SIDE_LABELS = {
    1: { zh: '先手 ☗', en: 'Sente ☗' },
    2: { zh: '後手 ☖', en: 'Gote ☖' }
  };

  const PIECE_LABELS = {
    K: { zh1: '王將', zh2: '玉將', short1: '王', short2: '玉', en: 'King' },
    R: { base: '飛', promoted: '龍', en: 'Rook', enPromoted: 'Dragon (+R)' },
    B: { base: '角', promoted: '馬', en: 'Bishop', enPromoted: 'Horse (+B)' },
    G: { base: '金', promoted: '金', en: 'Gold', enPromoted: 'Gold' },
    S: { base: '銀', promoted: '全', en: 'Silver', enPromoted: 'Promoted Silver (+S)' },
    N: { base: '桂', promoted: '圭', en: 'Knight', enPromoted: 'Promoted Knight (+N)' },
    L: { base: '香', promoted: '杏', en: 'Lance', enPromoted: 'Promoted Lance (+L)' },
    P: { base: '步', promoted: 'と', en: 'Pawn', enPromoted: 'Tokin (+P)' }
  };

  const BOARD_VALUES = {
    K: { base: 100000, promoted: 100000 },
    R: { base: 1000, promoted: 1300 },
    B: { base: 900, promoted: 1150 },
    G: { base: 600, promoted: 600 },
    S: { base: 550, promoted: 600 },
    N: { base: 400, promoted: 580 },
    L: { base: 380, promoted: 570 },
    P: { base: 100, promoted: 520 }
  };

  const HAND_VALUES = {
    R: Math.round(1000 * 1.08),
    B: Math.round(900 * 1.08),
    G: Math.round(600 * 1.08),
    S: Math.round(550 * 1.08),
    N: Math.round(400 * 1.08),
    L: Math.round(380 * 1.08),
    P: Math.round(100 * 1.08)
  };

  const ORTHO_DIRS = [
    [-1, 0],
    [1, 0],
    [0, -1],
    [0, 1]
  ];

  const DIAG_DIRS = [
    [-1, -1],
    [-1, 1],
    [1, -1],
    [1, 1]
  ];

  const ALL_DIRS = ORTHO_DIRS.concat(DIAG_DIRS);

  function opponentOf(p) {
    return p === 1 ? 2 : 1;
  }

  function inBounds(r, c) {
    return r >= 0 && r < ROWS && c >= 0 && c < COLS;
  }

  function inPromoZone(player, r) {
    return player === 1 ? r <= 2 : r >= 6;
  }

  function mustPromote(player, type, toR) {
    if (type === 'P' || type === 'L') {
      return player === 1 ? toR === 0 : toR === 8;
    }
    if (type === 'N') {
      return player === 1 ? toR <= 1 : toR >= 7;
    }
    return false;
  }

  function isDeadDropRank(player, type, r) {
    if (type === 'P' || type === 'L') {
      return player === 1 ? r === 0 : r === 8;
    }
    if (type === 'N') {
      return player === 1 ? r <= 1 : r >= 7;
    }
    return false;
  }

  function pieceKanji(piece) {
    if (piece.type === 'K') return piece.owner === 1 ? '王' : '玉';
    const meta = PIECE_LABELS[piece.type];
    return piece.promoted ? meta.promoted : meta.base;
  }

  function createEmptyBoard() {
    const b = new Array(ROWS);
    for (let r = 0; r < ROWS; r++) {
      b[r] = [null, null, null, null, null, null, null, null, null];
    }
    return b;
  }

  function createEmptyHand() {
    return { R: 0, B: 0, G: 0, S: 0, N: 0, L: 0, P: 0 };
  }

  function cloneHand(h) {
    return {
      R: (h && h.R) || 0,
      B: (h && h.B) || 0,
      G: (h && h.G) || 0,
      S: (h && h.S) || 0,
      N: (h && h.N) || 0,
      L: (h && h.L) || 0,
      P: (h && h.P) || 0
    };
  }

  function cloneBoard(board) {
    const out = new Array(ROWS);
    for (let r = 0; r < ROWS; r++) {
      const row = board[r];
      const nextRow = new Array(COLS);
      for (let c = 0; c < COLS; c++) {
        const cell = row[c];
        nextRow[c] = cell ? { owner: cell.owner, type: cell.type, promoted: Boolean(cell.promoted) } : null;
      }
      out[r] = nextRow;
    }
    return out;
  }

  function cloneState(state) {
    return {
      gameId: 'shogi',
      rows: ROWS,
      cols: COLS,
      board: cloneBoard(state.board),
      hands: {
        1: cloneHand(state.hands && state.hands[1]),
        2: cloneHand(state.hands && state.hands[2])
      },
      currentPlayer: state.currentPlayer,
      status: state.status,
      winner: state.winner,
      endReason: state.endReason,
      inCheck: state.inCheck || 0,
      turnNumber: state.turnNumber || 1,
      moveCount: state.moveCount || 0,
      lastMove: state.lastMove
        ? {
            id: state.lastMove.id,
            from: state.lastMove.from
              ? state.lastMove.from.zone === 'hand'
                ? { zone: 'hand', owner: state.lastMove.from.owner, piece: state.lastMove.from.piece }
                : { r: state.lastMove.from.r, c: state.lastMove.from.c }
              : null,
            to: state.lastMove.to ? { r: state.lastMove.to.r, c: state.lastMove.to.c } : null,
            piece: state.lastMove.piece,
            isDrop: Boolean(state.lastMove.isDrop),
            promote: Boolean(state.lastMove.promote),
            isCapture: Boolean(state.lastMove.isCapture),
            notation: state.lastMove.notation,
            player: state.lastMove.player
          }
        : null
    };
  }

  function createInitialState() {
    const board = createEmptyBoard();
    const backRow = ['L', 'N', 'S', 'G', 'K', 'G', 'S', 'N', 'L'];

    for (let c = 0; c < COLS; c++) {
      board[0][c] = { owner: 2, type: backRow[c], promoted: false };
      board[2][c] = { owner: 2, type: 'P', promoted: false };
      board[6][c] = { owner: 1, type: 'P', promoted: false };
      board[8][c] = { owner: 1, type: backRow[c], promoted: false };
    }

    // Gote (owner 2): Rook at c=1, Bishop at c=7
    board[1][1] = { owner: 2, type: 'R', promoted: false };
    board[1][7] = { owner: 2, type: 'B', promoted: false };

    // Sente (owner 1): Bishop at c=1, Rook at c=7
    board[7][1] = { owner: 1, type: 'B', promoted: false };
    board[7][7] = { owner: 1, type: 'R', promoted: false };

    return {
      gameId: 'shogi',
      rows: ROWS,
      cols: COLS,
      board: board,
      hands: {
        1: createEmptyHand(),
        2: createEmptyHand()
      },
      currentPlayer: 1,
      status: 'playing',
      winner: null,
      endReason: null,
      inCheck: 0,
      turnNumber: 1,
      moveCount: 0,
      lastMove: null
    };
  }

  function findKing(board, player) {
    for (let r = 0; r < ROWS; r++) {
      const row = board[r];
      for (let c = 0; c < COLS; c++) {
        const p = row[c];
        if (p && p.owner === player && p.type === 'K') return { r: r, c: c };
      }
    }
    return null;
  }

  /**
   * Returns true if `player`'s King is currently attacked by any piece of opponent.
   */
  function isInCheck(board, player) {
    const king = findKing(board, player);
    if (!king) return true;
    const kr = king.r;
    const kc = king.c;
    const opp = opponentOf(player);
    const oppFwd = opp === 1 ? -1 : 1;

    // 1. Adjacent 8 squares (K, G, +S/+N/+L/+P, S, P, +R, +B)
    for (let i = 0; i < 8; i++) {
      const pr = kr + ALL_DIRS[i][0];
      const pc = kc + ALL_DIRS[i][1];
      if (!inBounds(pr, pc)) continue;
      const cell = board[pr][pc];
      if (!cell || cell.owner !== opp) continue;

      // Vector from enemy piece (pr, pc) to King (kr, kc)
      const dr = kr - pr;
      const dc = kc - pc;
      const t = cell.type;
      const prom = cell.promoted;

      if (t === 'K') return true;
      if ((t === 'R' || t === 'B') && prom) return true;
      if (t === 'G' || (prom && (t === 'S' || t === 'N' || t === 'L' || t === 'P'))) {
        // Gold movement: 6 squares (everything except back-diagonals)
        if (!(dr === -oppFwd && dc !== 0)) return true;
      } else if (t === 'S' && !prom) {
        // Silver movement: 3 forward + 2 back-diagonals
        if (dr === oppFwd || (dr === -oppFwd && dc !== 0)) return true;
      } else if (t === 'P' && !prom) {
        if (dr === oppFwd && dc === 0) return true;
      }
    }

    // 2. Enemy unpromoted Knights jumping (2 * oppFwd, +-1) onto (kr, kc)
    const knightOriginR = kr - 2 * oppFwd;
    if (knightOriginR >= 0 && knightOriginR < ROWS) {
      if (kc > 0) {
        const ln = board[knightOriginR][kc - 1];
        if (ln && ln.owner === opp && ln.type === 'N' && !ln.promoted) return true;
      }
      if (kc < COLS - 1) {
        const rn = board[knightOriginR][kc + 1];
        if (rn && rn.owner === opp && rn.type === 'N' && !rn.promoted) return true;
      }
    }

    // 3. Orthogonal rays: Rook / Dragon (+R) and forward Lance (L)
    for (let d = 0; d < 4; d++) {
      const rStep = ORTHO_DIRS[d][0];
      const cStep = ORTHO_DIRS[d][1];
      let nr = kr + rStep;
      let nc = kc + cStep;
      while (inBounds(nr, nc)) {
        const cell = board[nr][nc];
        if (cell) {
          if (cell.owner === opp) {
            if (cell.type === 'R') return true;
            if (cell.type === 'L' && !cell.promoted && cStep === 0 && rStep === -oppFwd) return true;
          }
          break;
        }
        nr += rStep;
        nc += cStep;
      }
    }

    // 4. Diagonal rays: Bishop / Horse (+B)
    for (let d = 0; d < 4; d++) {
      const rStep = DIAG_DIRS[d][0];
      const cStep = DIAG_DIRS[d][1];
      let nr = kr + rStep;
      let nc = kc + cStep;
      while (inBounds(nr, nc)) {
        const cell = board[nr][nc];
        if (cell) {
          if (cell.owner === opp && cell.type === 'B') return true;
          break;
        }
        nr += rStep;
        nc += cStep;
      }
    }

    return false;
  }

  function formatBoardNotation(player, piece, nr, nc, isCapture, promoteFlag, optionalPromo) {
    const prefix = player === 1 ? '☗' : '☖';
    const coord = String(9 - nc) + String(nr + 1);
    const label = pieceKanji(piece);
    const capMark = isCapture ? 'x' : '';
    let suffix = '';
    if (promoteFlag) suffix = '成';
    else if (optionalPromo) suffix = '不成';
    return prefix + coord + label + capMark + suffix;
  }

  function tryPushBoardDestination(board, player, piece, r, c, nr, nc, out) {
    const target = board[nr][nc];
    if (target && target.owner === player) return false;

    // Simulate move on board (promotion status of the moved piece cannot expose own King, so 1 check suffices!)
    board[nr][nc] = piece;
    board[r][c] = null;
    const illegal = isInCheck(board, player);
    board[r][c] = piece;
    board[nr][nc] = target;

    if (illegal) return false;
    if (!out) return true;

    const isCap = Boolean(target);
    const caps = isCap ? [{ r: nr, c: nc }] : [];
    const baseId = 'r' + r + 'c' + c + '-r' + nr + 'c' + nc;
    const canProm = !piece.promoted && PROMOTABLE[piece.type] && (inPromoZone(player, r) || inPromoZone(player, nr));

    if (canProm) {
      if (mustPromote(player, piece.type, nr)) {
        out.push({
          id: baseId + '+',
          from: { r: r, c: c },
          to: { r: nr, c: nc },
          piece: piece.type,
          promote: true,
          isCapture: isCap,
          captures: caps,
          notation: formatBoardNotation(player, piece, nr, nc, isCap, true, false)
        });
      } else {
        out.push({
          id: baseId + '+',
          from: { r: r, c: c },
          to: { r: nr, c: nc },
          piece: piece.type,
          promote: true,
          choiceLabel: { zh: '成 (升變)', en: 'Promote' },
          isCapture: isCap,
          captures: caps,
          notation: formatBoardNotation(player, piece, nr, nc, isCap, true, true)
        });
        out.push({
          id: baseId + '=',
          from: { r: r, c: c },
          to: { r: nr, c: nc },
          piece: piece.type,
          promote: false,
          choiceLabel: { zh: '不成', en: 'Keep' },
          isCapture: isCap,
          captures: caps,
          notation: formatBoardNotation(player, piece, nr, nc, isCap, false, true)
        });
      }
    } else {
      out.push({
        id: baseId,
        from: { r: r, c: c },
        to: { r: nr, c: nc },
        piece: piece.type,
        promote: false,
        isCapture: isCap,
        captures: caps,
        notation: formatBoardNotation(player, piece, nr, nc, isCap, false, false)
      });
    }

    return true;
  }

  function generateGoldSteps(board, player, piece, r, c, fwd, out) {
    const goldOffsets = [
      [fwd, -1],
      [fwd, 0],
      [fwd, 1],
      [0, -1],
      [0, 1],
      [-fwd, 0]
    ];
    for (let i = 0; i < 6; i++) {
      const nr = r + goldOffsets[i][0];
      const nc = c + goldOffsets[i][1];
      if (inBounds(nr, nc)) {
        if (tryPushBoardDestination(board, player, piece, r, c, nr, nc, out) && !out) return true;
      }
    }
    return out ? out.length > 0 : false;
  }

  function generateBoardPieceMoves(board, r, c, out) {
    const piece = board[r][c];
    if (!piece) return false;
    const player = piece.owner;
    const fwd = player === 1 ? -1 : 1;
    const t = piece.type;
    const prom = piece.promoted;

    if (t === 'K') {
      for (let i = 0; i < 8; i++) {
        const nr = r + ALL_DIRS[i][0];
        const nc = c + ALL_DIRS[i][1];
        if (inBounds(nr, nc)) {
          if (tryPushBoardDestination(board, player, piece, r, c, nr, nc, out) && !out) return true;
        }
      }
      return out ? out.length > 0 : false;
    }

    // Gold General OR Promoted Silver / Knight / Lance / Pawn
    if (t === 'G' || (prom && (t === 'S' || t === 'N' || t === 'L' || t === 'P'))) {
      return generateGoldSteps(board, player, piece, r, c, fwd, out);
    }

    if (t === 'S') {
      const silverOffsets = [
        [fwd, -1],
        [fwd, 0],
        [fwd, 1],
        [-fwd, -1],
        [-fwd, 1]
      ];
      for (let i = 0; i < 5; i++) {
        const nr = r + silverOffsets[i][0];
        const nc = c + silverOffsets[i][1];
        if (inBounds(nr, nc)) {
          if (tryPushBoardDestination(board, player, piece, r, c, nr, nc, out) && !out) return true;
        }
      }
      return out ? out.length > 0 : false;
    }

    if (t === 'N') {
      const nr = r + 2 * fwd;
      if (nr >= 0 && nr < ROWS) {
        if (c > 0 && tryPushBoardDestination(board, player, piece, r, c, nr, c - 1, out) && !out) return true;
        if (c < COLS - 1 && tryPushBoardDestination(board, player, piece, r, c, nr, c + 1, out) && !out) return true;
      }
      return out ? out.length > 0 : false;
    }

    if (t === 'L') {
      let nr = r + fwd;
      while (nr >= 0 && nr < ROWS) {
        const cell = board[nr][c];
        if (!cell) {
          if (tryPushBoardDestination(board, player, piece, r, c, nr, c, out) && !out) return true;
        } else {
          if (cell.owner !== player) {
            if (tryPushBoardDestination(board, player, piece, r, c, nr, c, out) && !out) return true;
          }
          break;
        }
        nr += fwd;
      }
      return out ? out.length > 0 : false;
    }

    if (t === 'P') {
      const nr = r + fwd;
      if (inBounds(nr, c)) {
        if (tryPushBoardDestination(board, player, piece, r, c, nr, c, out) && !out) return true;
      }
      return out ? out.length > 0 : false;
    }

    if (t === 'R') {
      for (let d = 0; d < 4; d++) {
        const dr = ORTHO_DIRS[d][0];
        const dc = ORTHO_DIRS[d][1];
        let nr = r + dr;
        let nc = c + dc;
        while (inBounds(nr, nc)) {
          const cell = board[nr][nc];
          if (!cell) {
            if (tryPushBoardDestination(board, player, piece, r, c, nr, nc, out) && !out) return true;
          } else {
            if (cell.owner !== player) {
              if (tryPushBoardDestination(board, player, piece, r, c, nr, nc, out) && !out) return true;
            }
            break;
          }
          nr += dr;
          nc += dc;
        }
      }
      if (prom) {
        // Dragon (+R) adds 4 diagonal 1-step moves
        for (let d = 0; d < 4; d++) {
          const nr = r + DIAG_DIRS[d][0];
          const nc = c + DIAG_DIRS[d][1];
          if (inBounds(nr, nc)) {
            if (tryPushBoardDestination(board, player, piece, r, c, nr, nc, out) && !out) return true;
          }
        }
      }
      return out ? out.length > 0 : false;
    }

    if (t === 'B') {
      for (let d = 0; d < 4; d++) {
        const dr = DIAG_DIRS[d][0];
        const dc = DIAG_DIRS[d][1];
        let nr = r + dr;
        let nc = c + dc;
        while (inBounds(nr, nc)) {
          const cell = board[nr][nc];
          if (!cell) {
            if (tryPushBoardDestination(board, player, piece, r, c, nr, nc, out) && !out) return true;
          } else {
            if (cell.owner !== player) {
              if (tryPushBoardDestination(board, player, piece, r, c, nr, nc, out) && !out) return true;
            }
            break;
          }
          nr += dr;
          nc += dc;
        }
      }
      if (prom) {
        // Horse (+B) adds 4 orthogonal 1-step moves
        for (let d = 0; d < 4; d++) {
          const nr = r + ORTHO_DIRS[d][0];
          const nc = c + ORTHO_DIRS[d][1];
          if (inBounds(nr, nc)) {
            if (tryPushBoardDestination(board, player, piece, r, c, nr, nc, out) && !out) return true;
          }
        }
      }
      return out ? out.length > 0 : false;
    }

    return false;
  }

  function hasUnpromotedPawnOnCol(board, player, col) {
    for (let r = 0; r < ROWS; r++) {
      const cell = board[r][col];
      if (cell && cell.owner === player && cell.type === 'P' && !cell.promoted) return true;
    }
    return false;
  }

  function generateDropMovesForType(board, player, pieceType, currentlyInCheck, out) {
    const nifuBlockedCol = pieceType === 'P' ? new Array(COLS) : null;
    if (nifuBlockedCol) {
      for (let c = 0; c < COLS; c++) {
        nifuBlockedCol[c] = hasUnpromotedPawnOnCol(board, player, c);
      }
    }

    const tempPiece = { owner: player, type: pieceType, promoted: false };
    const prefix = player === 1 ? '☗' : '☖';

    for (let r = 0; r < ROWS; r++) {
      if (isDeadDropRank(player, pieceType, r)) continue;
      for (let c = 0; c < COLS; c++) {
        if (board[r][c] !== null) continue;
        if (nifuBlockedCol && nifuBlockedCol[c]) continue;

        // Optimization: dropping a piece onto an empty square can NEVER expose own King to new attacks;
        // it can only fail to block an existing check! So only run `isInCheck` if currently in check!
        if (currentlyInCheck) {
          board[r][c] = tempPiece;
          const stillChecked = isInCheck(board, player);
          board[r][c] = null;
          if (stillChecked) continue;
        }

        if (!out) return true;
        out.push({
          id: 'drop:' + pieceType + '->r' + r + 'c' + c,
          from: { zone: 'hand', owner: player, piece: pieceType },
          to: { r: r, c: c },
          piece: pieceType,
          isCapture: false,
          captures: [],
          isDrop: true,
          notation: prefix + (9 - c) + (r + 1) + pieceType + '打'
        });
      }
    }
    return out ? out.length > 0 : false;
  }

  function hasAnyLegalMove(state, player) {
    const board = state.board;
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const cell = board[r][c];
        if (cell && cell.owner === player) {
          if (generateBoardPieceMoves(board, r, c, null)) return true;
        }
      }
    }
    const hand = state.hands && state.hands[player];
    if (hand) {
      const inChk = isInCheck(board, player);
      for (let i = 0; i < HAND_ORDER.length; i++) {
        const t = HAND_ORDER[i];
        if (hand[t] > 0) {
          if (generateDropMovesForType(board, player, t, inChk, null)) return true;
        }
      }
    }
    return false;
  }

  function getLegalMoves(state, player) {
    if (!state || state.status !== 'playing') return [];
    const p = player || state.currentPlayer;
    const board = state.board;
    const moves = [];

    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const cell = board[r][c];
        if (cell && cell.owner === p) {
          generateBoardPieceMoves(board, r, c, moves);
        }
      }
    }

    const hand = state.hands && state.hands[p];
    if (hand) {
      const inChk = isInCheck(board, p);
      for (let i = 0; i < HAND_ORDER.length; i++) {
        const t = HAND_ORDER[i];
        if (hand[t] > 0) {
          generateDropMovesForType(board, p, t, inChk, moves);
        }
      }
    }

    return moves;
  }

  function getMovesForSource(state, source) {
    if (!state || state.status !== 'playing' || !source) return [];
    const p = state.currentPlayer;

    if (source.zone === 'hand') {
      if (source.owner !== p || !source.piece) return [];
      const count = state.hands && state.hands[p] ? state.hands[p][source.piece] || 0 : 0;
      if (count <= 0) return [];
      const drops = [];
      const inChk = isInCheck(state.board, p);
      generateDropMovesForType(state.board, p, source.piece, inChk, drops);
      return drops;
    }

    if (typeof source.r === 'number' && typeof source.c === 'number' && inBounds(source.r, source.c)) {
      const cell = state.board[source.r][source.c];
      if (!cell || cell.owner !== p) return [];
      const moves = [];
      generateBoardPieceMoves(state.board, source.r, source.c, moves);
      return moves;
    }

    return [];
  }

  function canSelectSource(state, source, player) {
    if (!state || state.status !== 'playing') {
      return {
        selectable: false,
        hasMoves: false,
        reasonZh: '對局已結束',
        reasonEn: 'Game has already ended'
      };
    }
    const p = player || state.currentPlayer;
    if (p !== state.currentPlayer) {
      return {
        selectable: false,
        hasMoves: false,
        reasonZh: '目前輪到' + SIDE_LABELS[state.currentPlayer].zh + '行動',
        reasonEn: 'It is currently ' + SIDE_LABELS[state.currentPlayer].en + "'s turn"
      };
    }
    if (!source) {
      return {
        selectable: false,
        hasMoves: false,
        reasonZh: '請點擊盤面己方棋駒或駒台上的持駒',
        reasonEn: 'Select one of your board pieces or a piece from your Komadai hand'
      };
    }

    // Komadai hand source
    if (source.zone === 'hand') {
      if (source.owner !== p) {
        return {
          selectable: false,
          hasMoves: false,
          reasonZh: '這是對手的駒台，請選擇己方駒台持駒',
          reasonEn: 'Opponent Komadai — select from your own captured pieces'
        };
      }
      const pieceType = source.piece;
      const count = state.hands && state.hands[p] ? state.hands[p][pieceType] || 0 : 0;
      if (count <= 0) {
        return {
          selectable: false,
          hasMoves: false,
          reasonZh: '駒台上沒有可用的「' + (PIECE_LABELS[pieceType] ? PIECE_LABELS[pieceType].base : pieceType) + '」',
          reasonEn: 'You have no ' + pieceType + ' in hand to drop'
        };
      }
      const drops = getMovesForSource(state, source);
      const kanji = PIECE_LABELS[pieceType].base;
      if (drops.length === 0) {
        const inChk = state.inCheck === p || isInCheck(state.board, p);
        return {
          selectable: true,
          hasMoves: false,
          reasonZh: inChk
            ? '己方玉將正受王手，打入「' + kanji + '」無法合駒解將（或受二步禁手限制）'
            : '持駒「' + kanji + '」受二步禁手（同筋已有未升變步兵）或死格限制，無合法打入點',
          reasonEn: inChk
            ? 'Your King is in check and dropping ' + PIECE_LABELS[pieceType].en + ' cannot block check'
            : 'No legal drop square (restricted by Nifu double-pawn rule or dead rank)'
        };
      }
      return {
        selectable: true,
        hasMoves: true,
        reasonZh: '已選取駒台持駒「' + kanji + '」：可打入 ' + drops.length + ' 處空位',
        reasonEn: 'Selected hand ' + PIECE_LABELS[pieceType].en + ': ' + drops.length + ' legal drop square(s)'
      };
    }

    // Board square source
    if (typeof source.r !== 'number' || typeof source.c !== 'number' || !inBounds(source.r, source.c)) {
      return {
        selectable: false,
        hasMoves: false,
        reasonZh: '請點擊有效盤面座標或駒台持駒',
        reasonEn: 'Select a valid board coordinate or Komadai piece'
      };
    }

    const cell = state.board[source.r][source.c];
    if (!cell) {
      return {
        selectable: false,
        hasMoves: false,
        reasonZh: '此格為空位，請點擊己方棋駒或先選取駒台持駒再打入',
        reasonEn: 'Empty square — select a friendly piece or choose a Komadai piece to drop'
      };
    }
    if (cell.owner !== p) {
      return {
        selectable: false,
        hasMoves: false,
        reasonZh: '這是對手的「' + pieceKanji(cell) + '」，請點選' + SIDE_LABELS[p].zh + '棋駒',
        reasonEn: 'Opponent piece — select your own ' + SIDE_LABELS[p].en + ' piece'
      };
    }

    const moves = getMovesForSource(state, source);
    const kLabel = pieceKanji(cell);
    if (moves.length === 0) {
      const inChk = state.inCheck === p || isInCheck(state.board, p);
      return {
        selectable: true,
        hasMoves: false,
        reasonZh: inChk
          ? '己方正受王手，此「' + kLabel + '」無法解將'
          : '此「' + kLabel + '」受阻擋或受牽制（移動會使玉將受王手）',
        reasonEn: inChk
          ? 'Your King is in check and this piece cannot resolve check'
          : 'This piece is blocked or pinned to your King'
      };
    }

    const uniqueTargets = Object.create(null);
    let capCount = 0;
    for (let i = 0; i < moves.length; i++) {
      const key = moves[i].to.r + ',' + moves[i].to.c;
      if (!uniqueTargets[key]) {
        uniqueTargets[key] = true;
        if (moves[i].isCapture) capCount++;
      }
    }
    const destCount = Object.keys(uniqueTargets).length;

    return {
      selectable: true,
      hasMoves: true,
      reasonZh:
        '已選取「' +
        kLabel +
        '」：可走 ' +
        destCount +
        ' 格' +
        (capCount > 0 ? '（含 ' + capCount + ' 個可吃目標）' : ''),
      reasonEn:
        'Selected ' +
        kLabel +
        ': ' +
        destCount +
        ' legal destination(s)' +
        (capCount > 0 ? ' (' + capCount + ' capture(s))' : '')
    };
  }

  function resolveMove(state, move) {
    if (!move) return null;
    if (move.from && move.to && typeof move.to.r === 'number') {
      return move;
    }
    const legal = getLegalMoves(state, state.currentPlayer);
    for (let i = 0; i < legal.length; i++) {
      if (legal[i].id === move.id) return legal[i];
    }
    return null;
  }

  function applyMove(state, rawMove) {
    const move = resolveMove(state, rawMove);
    if (!move || state.status !== 'playing') return cloneState(state);

    const next = cloneState(state);
    const mover = state.currentPlayer;
    const opp = opponentOf(mover);
    const tr = move.to.r;
    const tc = move.to.c;

    if (move.isDrop || (move.from && move.from.zone === 'hand')) {
      const dropType = move.piece || move.from.piece;
      if (!next.hands[mover] || (next.hands[mover][dropType] || 0) <= 0 || next.board[tr][tc] !== null) {
        return next;
      }
      next.hands[mover][dropType]--;
      next.board[tr][tc] = {
        owner: mover,
        type: dropType,
        promoted: false
      };
      next.lastMove = {
        id: move.id,
        from: { zone: 'hand', owner: mover, piece: dropType },
        to: { r: tr, c: tc },
        piece: dropType,
        isDrop: true,
        promote: false,
        isCapture: false,
        notation: move.notation || (mover === 1 ? '☗' : '☖') + (9 - tc) + (tr + 1) + dropType + '打',
        player: mover
      };
    } else {
      const fr = move.from.r;
      const fc = move.from.c;
      const movingPiece = next.board[fr][fc];
      if (!movingPiece || movingPiece.owner !== mover) return next;

      const captured = next.board[tr][tc];
      if (captured) {
        // Captured piece demotes to base type and joins mover's Komadai hand (unless K)
        if (captured.type !== 'K' && next.hands[mover][captured.type] !== undefined) {
          next.hands[mover][captured.type]++;
        }
      }

      const willPromote = Boolean(movingPiece.promoted || move.promote);
      next.board[tr][tc] = {
        owner: mover,
        type: movingPiece.type,
        promoted: willPromote
      };
      next.board[fr][fc] = null;

      next.lastMove = {
        id: move.id,
        from: { r: fr, c: fc },
        to: { r: tr, c: tc },
        piece: movingPiece.type,
        isDrop: false,
        promote: Boolean(move.promote),
        isCapture: Boolean(captured),
        notation:
          move.notation || formatBoardNotation(mover, movingPiece, tr, tc, Boolean(captured), Boolean(move.promote), false),
        player: mover
      };

      if (captured && captured.type === 'K') {
        next.moveCount = (state.moveCount || 0) + 1;
        next.turnNumber = (state.turnNumber || 1) + 1;
        next.currentPlayer = opp;
        next.status = 'ended';
        next.winner = mover;
        next.endReason = 'checkmate';
        next.inCheck = opp;
        return next;
      }
    }

    next.moveCount = (state.moveCount || 0) + 1;
    next.turnNumber = (state.turnNumber || 1) + 1;
    next.currentPlayer = opp;

    const oppInCheck = isInCheck(next.board, opp);
    next.inCheck = oppInCheck ? opp : 0;

    if (!hasAnyLegalMove(next, opp)) {
      next.status = 'ended';
      next.winner = mover;
      next.endReason = 'checkmate';
    }

    return next;
  }

  function kingSafetyScore(board, player) {
    const k = findKing(board, player);
    if (!k) return -500;
    let bonus = 0;
    // Reward Mino / Yagura style friendly Gold/Silver generals escorting own King
    for (let i = 0; i < 8; i++) {
      const nr = k.r + ALL_DIRS[i][0];
      const nc = k.c + ALL_DIRS[i][1];
      if (!inBounds(nr, nc)) continue;
      const cell = board[nr][nc];
      if (cell && cell.owner === player) {
        if (cell.type === 'G' || cell.type === 'S' || cell.promoted) bonus += 26;
        else bonus += 8;
      }
    }
    // Encourage keeping King tucked in back 2 ranks away from center file
    const relR = player === 1 ? k.r : 8 - k.r;
    if (relR >= 7) bonus += 16;
    if (k.c <= 2 || k.c >= 6) bonus += 18;
    return bonus;
  }

  function evaluate(state, perspectivePlayer) {
    const me = perspectivePlayer || state.currentPlayer;
    const opp = opponentOf(me);

    if (state.status === 'ended') {
      if (state.winner === 0 || state.winner === null) return 0;
      return state.winner === me ? 100000 : -100000;
    }

    let score = 0;
    const board = state.board;

    for (let r = 0; r < ROWS; r++) {
      const row = board[r];
      for (let c = 0; c < COLS; c++) {
        const cell = row[c];
        if (!cell) continue;
        const meta = BOARD_VALUES[cell.type];
        let val = cell.promoted ? meta.promoted : meta.base;

        // Positional advancement & central control for non-King pieces
        if (cell.type !== 'K') {
          const relR = cell.owner === 1 ? r : 8 - r;
          val += (8 - relR) * 4 + (4 - Math.abs(4 - c)) * 3;
          if (relR <= 2) val += 15; // Enemy camp pressure
        }

        if (cell.owner === me) score += val;
        else score -= val;
      }
    }

    // Komadai hand values (1.08x base value — captured pieces can be dropped anywhere!)
    const myHand = state.hands && state.hands[me];
    const opHand = state.hands && state.hands[opp];
    for (let i = 0; i < HAND_ORDER.length; i++) {
      const t = HAND_ORDER[i];
      if (myHand && myHand[t] > 0) score += myHand[t] * HAND_VALUES[t];
      if (opHand && opHand[t] > 0) score -= opHand[t] * HAND_VALUES[t];
    }

    score += kingSafetyScore(board, me) - kingSafetyScore(board, opp);

    if (state.inCheck === opp) score += 50;
    else if (state.inCheck === me) score -= 50;

    return score;
  }

  BoardArena.registerRule('shogi', {
    id: 'shogi',
    selectionMode: 'piece',
    rows: ROWS,
    cols: COLS,
    HAND_ORDER: HAND_ORDER,
    sideLabels: SIDE_LABELS,
    pieceLabels: PIECE_LABELS,
    createInitialState: createInitialState,
    cloneState: cloneState,
    getLegalMoves: getLegalMoves,
    getMovesForSource: getMovesForSource,
    canSelectSource: canSelectSource,
    applyMove: applyMove,
    evaluate: evaluate,
    isInCheck: isInCheck
  });
})(typeof window !== 'undefined' ? window : globalThis);
