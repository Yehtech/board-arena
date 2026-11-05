/**
 * Classic Board Arena — Chess (西洋棋 8×8 FIDE) Complete Rule Engine
 * Implements Castling (O-O / O-O-O), En Passant, 4-Piece Promotion (Q/R/B/N),
 * Strict Legal Check Filter, Checkmate, Stalemate, 50-Move Rule, Threefold Repetition,
 * Insufficient Material Draw, and PeSTO Piece-Square + Mobility Evaluator.
 */
(function (global) {
  'use strict';

  const BoardArena = global.BoardArena;
  if (!BoardArena || typeof BoardArena.registerRule !== 'function') {
    throw new Error('BoardArena.registerRule is required before loading chess.js');
  }

  const ROWS = 8;
  const COLS = 8;
  const FILES = 'abcdefgh';

  const SIDE_LABELS = {
    1: { zh: '白方', en: 'White' },
    2: { zh: '黑方', en: 'Black' }
  };

  const PIECE_LABELS = {
    K: { zh: '國王', en: 'King', w: '♔', b: '♚' },
    Q: { zh: '皇后', en: 'Queen', w: '♕', b: '♛' },
    R: { zh: '城堡', en: 'Rook', w: '♖', b: '♜' },
    B: { zh: '主教', en: 'Bishop', w: '♗', b: '♝' },
    N: { zh: '騎士', en: 'Knight', w: '♘', b: '♞' },
    P: { zh: '士兵', en: 'Pawn', w: '♙', b: '♟' }
  };

  const PROMO_OPTIONS = [
    { type: 'Q', choiceLabel: { zh: '升變皇后', en: 'Queen' } },
    { type: 'R', choiceLabel: { zh: '升變城堡', en: 'Rook' } },
    { type: 'B', choiceLabel: { zh: '升變主教', en: 'Bishop' } },
    { type: 'N', choiceLabel: { zh: '升變騎士', en: 'Knight' } }
  ];

  const MATERIAL = {
    K: 20000,
    Q: 900,
    R: 500,
    B: 330,
    N: 320,
    P: 100
  };

  // PeSTO-inspired Piece-Square Tables (from White's perspective: row 0 = rank 8, row 7 = rank 1)
  const PST = {
    P: [
      [0, 0, 0, 0, 0, 0, 0, 0],
      [65, 70, 70, 75, 75, 70, 70, 65],
      [25, 30, 35, 45, 45, 35, 30, 25],
      [10, 12, 18, 32, 32, 18, 12, 10],
      [4, 6, 12, 26, 26, 12, 6, 4],
      [4, -4, -6, 4, 4, -6, -4, 4],
      [6, 10, 10, -20, -20, 10, 10, 6],
      [0, 0, 0, 0, 0, 0, 0, 0]
    ],
    N: [
      [-50, -40, -30, -30, -30, -30, -40, -50],
      [-40, -20, 0, 4, 4, 0, -20, -40],
      [-30, 5, 14, 18, 18, 14, 5, -30],
      [-30, 6, 18, 24, 24, 18, 6, -30],
      [-30, 4, 16, 22, 22, 16, 4, -30],
      [-30, 6, 12, 16, 16, 12, 6, -30],
      [-40, -20, 0, 4, 4, 0, -20, -40],
      [-50, -40, -30, -30, -30, -30, -40, -50]
    ],
    B: [
      [-20, -10, -10, -10, -10, -10, -10, -20],
      [-10, 4, 0, 4, 4, 0, 4, -10],
      [-10, 6, 10, 14, 14, 10, 6, -10],
      [-10, 8, 12, 16, 16, 12, 8, -10],
      [-10, 6, 14, 16, 16, 14, 6, -10],
      [-10, 12, 12, 12, 12, 12, 12, -10],
      [-10, 8, 4, 4, 4, 4, 8, -10],
      [-20, -10, -10, -10, -10, -10, -10, -20]
    ],
    R: [
      [4, 6, 8, 10, 10, 8, 6, 4],
      [14, 18, 18, 20, 20, 18, 18, 14],
      [-4, 0, 2, 4, 4, 2, 0, -4],
      [-4, 0, 2, 4, 4, 2, 0, -4],
      [-4, 0, 2, 4, 4, 2, 0, -4],
      [-4, 0, 2, 4, 4, 2, 0, -4],
      [-4, 0, 2, 4, 4, 2, 0, -4],
      [0, 0, 4, 10, 10, 4, 0, 0]
    ],
    Q: [
      [-20, -10, -10, -5, -5, -10, -10, -20],
      [-10, 0, 4, 4, 4, 4, 0, -10],
      [-10, 4, 6, 8, 8, 6, 4, -10],
      [-5, 4, 8, 10, 10, 8, 4, -5],
      [0, 4, 8, 10, 10, 8, 4, -5],
      [-10, 6, 6, 6, 6, 6, 4, -10],
      [-10, 0, 4, 2, 2, 0, 0, -10],
      [-20, -10, -10, -5, -5, -10, -10, -20]
    ],
    K_MID: [
      [-30, -40, -40, -50, -50, -40, -40, -30],
      [-30, -40, -40, -50, -50, -40, -40, -30],
      [-30, -40, -40, -50, -50, -40, -40, -30],
      [-30, -40, -40, -50, -50, -40, -40, -30],
      [-20, -30, -30, -40, -40, -30, -30, -20],
      [-10, -20, -20, -20, -20, -20, -20, -10],
      [18, 20, -4, -10, -10, -4, 20, 18],
      [20, 32, 12, -10, 0, -6, 32, 20]
    ],
    K_END: [
      [-40, -25, -20, -15, -15, -20, -25, -40],
      [-25, -10, 0, 5, 5, 0, -10, -25],
      [-20, 0, 15, 20, 20, 15, 0, -20],
      [-15, 5, 20, 28, 28, 20, 5, -15],
      [-15, 5, 20, 28, 28, 20, 5, -15],
      [-20, 0, 15, 20, 20, 15, 0, -20],
      [-25, -10, 0, 5, 5, 0, -10, -25],
      [-40, -25, -20, -15, -15, -20, -25, -40]
    ]
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

  const KNIGHT_DELTAS = [
    [-2, -1],
    [-2, 1],
    [2, -1],
    [2, 1],
    [-1, -2],
    [1, -2],
    [-1, 2],
    [1, 2]
  ];

  function opponentOf(p) {
    return p === 1 ? 2 : 1;
  }

  function inBounds(r, c) {
    return r >= 0 && r < ROWS && c >= 0 && c < COLS;
  }

  function sqName(r, c) {
    return FILES[c] + String(8 - r);
  }

  function createEmptyBoard() {
    const b = new Array(ROWS);
    for (let r = 0; r < ROWS; r++) {
      b[r] = [null, null, null, null, null, null, null, null];
    }
    return b;
  }

  function cloneBoard(board) {
    const out = new Array(ROWS);
    for (let r = 0; r < ROWS; r++) {
      const row = board[r];
      const nextRow = new Array(COLS);
      for (let c = 0; c < COLS; c++) {
        const cell = row[c];
        nextRow[c] = cell ? { owner: cell.owner, type: cell.type } : null;
      }
      out[r] = nextRow;
    }
    return out;
  }

  function cloneState(state) {
    const posCountsCopy = Object.create(null);
    if (state.posCounts) {
      const keys = Object.keys(state.posCounts);
      for (let i = 0; i < keys.length; i++) {
        posCountsCopy[keys[i]] = state.posCounts[keys[i]];
      }
    }
    return {
      gameId: 'chess',
      rows: ROWS,
      cols: COLS,
      board: cloneBoard(state.board),
      currentPlayer: state.currentPlayer,
      status: state.status,
      winner: state.winner,
      endReason: state.endReason,
      inCheck: state.inCheck || 0,
      castling: {
        1: { k: Boolean(state.castling && state.castling[1] && state.castling[1].k), q: Boolean(state.castling && state.castling[1] && state.castling[1].q) },
        2: { k: Boolean(state.castling && state.castling[2] && state.castling[2].k), q: Boolean(state.castling && state.castling[2] && state.castling[2].q) }
      },
      enPassant: state.enPassant
        ? {
            r: state.enPassant.r,
            c: state.enPassant.c,
            pawnR: state.enPassant.pawnR,
            pawnC: state.enPassant.pawnC
          }
        : null,
      halfMoveClock: state.halfMoveClock || 0,
      turnNumber: state.turnNumber || 1,
      moveCount: state.moveCount || 0,
      posCounts: posCountsCopy,
      lastMove: state.lastMove
        ? {
            id: state.lastMove.id,
            from: state.lastMove.from ? { r: state.lastMove.from.r, c: state.lastMove.from.c } : null,
            to: state.lastMove.to ? { r: state.lastMove.to.r, c: state.lastMove.to.c } : null,
            piece: state.lastMove.piece,
            promote: state.lastMove.promote || null,
            castle: state.lastMove.castle || null,
            enPassant: Boolean(state.lastMove.enPassant),
            isCapture: state.lastMove.isCapture,
            notation: state.lastMove.notation,
            player: state.lastMove.player
          }
        : null,
      captured: {
        1: state.captured && state.captured[1] ? state.captured[1].slice() : [],
        2: state.captured && state.captured[2] ? state.captured[2].slice() : []
      }
    };
  }

  function computePosKey(board, currentPlayer, castling, enPassant) {
    let s = '';
    for (let r = 0; r < ROWS; r++) {
      const row = board[r];
      for (let c = 0; c < COLS; c++) {
        const cell = row[c];
        s += cell ? cell.owner + cell.type : '..';
      }
    }
    const c1 = castling && castling[1] ? (castling[1].k ? 'K' : '') + (castling[1].q ? 'Q' : '') : '';
    const c2 = castling && castling[2] ? (castling[2].k ? 'k' : '') + (castling[2].q ? 'q' : '') : '';
    let epPart = '-';
    if (enPassant) {
      // FIDE rule: en-passant target only distinguishes position when an active-side pawn is adjacent
      const epRow = enPassant.pawnR;
      const epCol = enPassant.c;
      const leftCell = epCol > 0 ? board[epRow][epCol - 1] : null;
      const rightCell = epCol < 7 ? board[epRow][epCol + 1] : null;
      if (
        (leftCell && leftCell.owner === currentPlayer && leftCell.type === 'P') ||
        (rightCell && rightCell.owner === currentPlayer && rightCell.type === 'P')
      ) {
        epPart = enPassant.r + ',' + enPassant.c;
      }
    }
    return s + '|' + currentPlayer + '|' + (c1 + c2 || '-') + '|' + epPart;
  }

  function createInitialState() {
    const board = createEmptyBoard();
    const backRank = ['R', 'N', 'B', 'Q', 'K', 'B', 'N', 'R'];

    for (let c = 0; c < COLS; c++) {
      board[0][c] = { owner: 2, type: backRank[c] };
      board[1][c] = { owner: 2, type: 'P' };
      board[6][c] = { owner: 1, type: 'P' };
      board[7][c] = { owner: 1, type: backRank[c] };
    }

    const castling = {
      1: { k: true, q: true },
      2: { k: true, q: true }
    };

    const posCounts = Object.create(null);
    const initKey = computePosKey(board, 1, castling, null);
    posCounts[initKey] = 1;

    return {
      gameId: 'chess',
      rows: ROWS,
      cols: COLS,
      board: board,
      currentPlayer: 1,
      status: 'playing',
      winner: null,
      endReason: null,
      inCheck: 0,
      castling: castling,
      enPassant: null,
      halfMoveClock: 0,
      turnNumber: 1,
      moveCount: 0,
      posCounts: posCounts,
      lastMove: null,
      captured: { 1: [], 2: [] }
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
   * Returns true if square (r, c) is attacked by at least one piece owned by `byPlayer`.
   */
  function isSquareAttacked(board, r, c, byPlayer) {
    // 1. Pawn attacks: a pawn of `byPlayer` advances by `atkDir`, so it sits at `r - atkDir`
    const atkDir = byPlayer === 1 ? -1 : 1;
    const pr = r - atkDir;
    if (pr >= 0 && pr < ROWS) {
      if (c > 0) {
        const lp = board[pr][c - 1];
        if (lp && lp.owner === byPlayer && lp.type === 'P') return true;
      }
      if (c < 7) {
        const rp = board[pr][c + 1];
        if (rp && rp.owner === byPlayer && rp.type === 'P') return true;
      }
    }

    // 2. Knight attacks
    for (let i = 0; i < 8; i++) {
      const nr = r + KNIGHT_DELTAS[i][0];
      const nc = c + KNIGHT_DELTAS[i][1];
      if (inBounds(nr, nc)) {
        const cell = board[nr][nc];
        if (cell && cell.owner === byPlayer && cell.type === 'N') return true;
      }
    }

    // 3. King attacks
    for (let i = 0; i < 8; i++) {
      const nr = r + ALL_DIRS[i][0];
      const nc = c + ALL_DIRS[i][1];
      if (inBounds(nr, nc)) {
        const cell = board[nr][nc];
        if (cell && cell.owner === byPlayer && cell.type === 'K') return true;
      }
    }

    // 4. Orthogonal sliding (Rook / Queen)
    for (let d = 0; d < 4; d++) {
      const dr = ORTHO_DIRS[d][0];
      const dc = ORTHO_DIRS[d][1];
      let nr = r + dr;
      let nc = c + dc;
      while (inBounds(nr, nc)) {
        const cell = board[nr][nc];
        if (cell) {
          if (cell.owner === byPlayer && (cell.type === 'R' || cell.type === 'Q')) return true;
          break;
        }
        nr += dr;
        nc += dc;
      }
    }

    // 5. Diagonal sliding (Bishop / Queen)
    for (let d = 0; d < 4; d++) {
      const dr = DIAG_DIRS[d][0];
      const dc = DIAG_DIRS[d][1];
      let nr = r + dr;
      let nc = c + dc;
      while (inBounds(nr, nc)) {
        const cell = board[nr][nc];
        if (cell) {
          if (cell.owner === byPlayer && (cell.type === 'B' || cell.type === 'Q')) return true;
          break;
        }
        nr += dr;
        nc += dc;
      }
    }

    return false;
  }

  function isInCheck(board, player) {
    const k = findKing(board, player);
    if (!k) return true;
    return isSquareAttacked(board, k.r, k.c, opponentOf(player));
  }

  function isMoveLegalOnBoard(board, player, r, c, nr, nc, epCapturePos) {
    const movingPiece = board[r][c];
    const destTarget = board[nr][nc];
    let epPiece = null;

    board[nr][nc] = movingPiece;
    board[r][c] = null;
    if (epCapturePos) {
      epPiece = board[epCapturePos.r][epCapturePos.c];
      board[epCapturePos.r][epCapturePos.c] = null;
    }

    const inChk = isInCheck(board, player);

    if (epCapturePos) {
      board[epCapturePos.r][epCapturePos.c] = epPiece;
    }
    board[r][c] = movingPiece;
    board[nr][nc] = destTarget;

    return !inChk;
  }

  function buildNotation(pieceType, r, c, nr, nc, isCapture, promote, castle, enPassant) {
    if (castle === 'K') return 'O-O';
    if (castle === 'Q') return 'O-O-O';
    const dest = sqName(nr, nc);
    if (pieceType === 'P') {
      const base = isCapture ? FILES[c] + 'x' + dest : dest;
      return base + (promote ? '=' + promote : '') + (enPassant ? ' e.p.' : '');
    }
    return pieceType + (isCapture ? 'x' : '') + dest + (promote ? '=' + promote : '');
  }

  /**
   * Generates legal moves for the piece at (r, c).
   * If `out` is null, returns true immediately upon finding any legal move.
   */
  function generatePieceLegalMoves(state, r, c, out) {
    const board = state.board;
    const piece = board[r][c];
    if (!piece) return false;
    const player = piece.owner;
    const opp = opponentOf(player);
    const type = piece.type;

    if (type === 'P') {
      const dir = player === 1 ? -1 : 1;
      const startRank = player === 1 ? 6 : 1;
      const promoRank = player === 1 ? 0 : 7;
      const r1 = r + dir;

      // 1-step forward
      if (inBounds(r1, c) && !board[r1][c]) {
        if (isMoveLegalOnBoard(board, player, r, c, r1, c, null)) {
          if (!out) return true;
          if (r1 === promoRank) {
            for (let p = 0; p < PROMO_OPTIONS.length; p++) {
              const pr = PROMO_OPTIONS[p];
              out.push({
                id: 'r' + r + 'c' + c + '-r' + r1 + 'c' + c + '=' + pr.type,
                from: { r: r, c: c },
                to: { r: r1, c: c },
                piece: 'P',
                promote: pr.type,
                choiceLabel: pr.choiceLabel,
                isCapture: false,
                captures: [],
                notation: buildNotation('P', r, c, r1, c, false, pr.type, null, false)
              });
            }
          } else {
            out.push({
              id: 'r' + r + 'c' + c + '-r' + r1 + 'c' + c,
              from: { r: r, c: c },
              to: { r: r1, c: c },
              piece: 'P',
              isCapture: false,
              captures: [],
              notation: buildNotation('P', r, c, r1, c, false, null, null, false)
            });
          }
        }

        // 2-step advance from start rank
        const r2 = r + 2 * dir;
        if (r === startRank && inBounds(r2, c) && !board[r2][c]) {
          if (isMoveLegalOnBoard(board, player, r, c, r2, c, null)) {
            if (!out) return true;
            out.push({
              id: 'r' + r + 'c' + c + '-r' + r2 + 'c' + c,
              from: { r: r, c: c },
              to: { r: r2, c: c },
              piece: 'P',
              doublePawnPush: true,
              isCapture: false,
              captures: [],
              notation: buildNotation('P', r, c, r2, c, false, null, null, false)
            });
          }
        }
      }

      // Diagonal captures & En Passant
      for (let dc = -1; dc <= 1; dc += 2) {
        const nc = c + dc;
        if (!inBounds(r1, nc)) continue;
        const target = board[r1][nc];
        if (target && target.owner === opp) {
          if (isMoveLegalOnBoard(board, player, r, c, r1, nc, null)) {
            if (!out) return true;
            if (r1 === promoRank) {
              for (let p = 0; p < PROMO_OPTIONS.length; p++) {
                const pr = PROMO_OPTIONS[p];
                out.push({
                  id: 'r' + r + 'c' + c + '-r' + r1 + 'c' + nc + '=' + pr.type,
                  from: { r: r, c: c },
                  to: { r: r1, c: nc },
                  piece: 'P',
                  promote: pr.type,
                  choiceLabel: pr.choiceLabel,
                  isCapture: true,
                  captures: [{ r: r1, c: nc }],
                  notation: buildNotation('P', r, c, r1, nc, true, pr.type, null, false)
                });
              }
            } else {
              out.push({
                id: 'r' + r + 'c' + c + '-r' + r1 + 'c' + nc,
                from: { r: r, c: c },
                to: { r: r1, c: nc },
                piece: 'P',
                isCapture: true,
                captures: [{ r: r1, c: nc }],
                notation: buildNotation('P', r, c, r1, nc, true, null, null, false)
              });
            }
          }
        } else if (
          state.enPassant &&
          state.enPassant.r === r1 &&
          state.enPassant.c === nc &&
          board[state.enPassant.pawnR] &&
          board[state.enPassant.pawnR][state.enPassant.pawnC] &&
          board[state.enPassant.pawnR][state.enPassant.pawnC].owner === opp
        ) {
          const epCap = { r: state.enPassant.pawnR, c: state.enPassant.pawnC };
          if (isMoveLegalOnBoard(board, player, r, c, r1, nc, epCap)) {
            if (!out) return true;
            out.push({
              id: 'r' + r + 'c' + c + '-r' + r1 + 'c' + nc + '-ep',
              from: { r: r, c: c },
              to: { r: r1, c: nc },
              piece: 'P',
              enPassant: true,
              isCapture: true,
              captures: [epCap],
              notation: buildNotation('P', r, c, r1, nc, true, null, null, true)
            });
          }
        }
      }
      return out ? out.length > 0 : false;
    }

    if (type === 'N') {
      for (let i = 0; i < 8; i++) {
        const nr = r + KNIGHT_DELTAS[i][0];
        const nc = c + KNIGHT_DELTAS[i][1];
        if (!inBounds(nr, nc)) continue;
        const target = board[nr][nc];
        if (target && target.owner === player) continue;
        if (isMoveLegalOnBoard(board, player, r, c, nr, nc, null)) {
          if (!out) return true;
          const isCap = Boolean(target);
          out.push({
            id: 'r' + r + 'c' + c + '-r' + nr + 'c' + nc,
            from: { r: r, c: c },
            to: { r: nr, c: nc },
            piece: 'N',
            isCapture: isCap,
            captures: isCap ? [{ r: nr, c: nc }] : [],
            notation: buildNotation('N', r, c, nr, nc, isCap, null, null, false)
          });
        }
      }
      return out ? out.length > 0 : false;
    }

    if (type === 'B' || type === 'R' || type === 'Q') {
      const dirs = type === 'B' ? DIAG_DIRS : type === 'R' ? ORTHO_DIRS : ALL_DIRS;
      for (let d = 0; d < dirs.length; d++) {
        const dr = dirs[d][0];
        const dc = dirs[d][1];
        let nr = r + dr;
        let nc = c + dc;
        while (inBounds(nr, nc)) {
          const target = board[nr][nc];
          if (!target) {
            if (isMoveLegalOnBoard(board, player, r, c, nr, nc, null)) {
              if (!out) return true;
              out.push({
                id: 'r' + r + 'c' + c + '-r' + nr + 'c' + nc,
                from: { r: r, c: c },
                to: { r: nr, c: nc },
                piece: type,
                isCapture: false,
                captures: [],
                notation: buildNotation(type, r, c, nr, nc, false, null, null, false)
              });
            }
          } else {
            if (target.owner === opp && isMoveLegalOnBoard(board, player, r, c, nr, nc, null)) {
              if (!out) return true;
              out.push({
                id: 'r' + r + 'c' + c + '-r' + nr + 'c' + nc,
                from: { r: r, c: c },
                to: { r: nr, c: nc },
                piece: type,
                isCapture: true,
                captures: [{ r: nr, c: nc }],
                notation: buildNotation(type, r, c, nr, nc, true, null, null, false)
              });
            }
            break;
          }
          nr += dr;
          nc += dc;
        }
      }
      return out ? out.length > 0 : false;
    }

    if (type === 'K') {
      for (let i = 0; i < 8; i++) {
        const nr = r + ALL_DIRS[i][0];
        const nc = c + ALL_DIRS[i][1];
        if (!inBounds(nr, nc)) continue;
        const target = board[nr][nc];
        if (target && target.owner === player) continue;
        if (isMoveLegalOnBoard(board, player, r, c, nr, nc, null)) {
          if (!out) return true;
          const isCap = Boolean(target);
          out.push({
            id: 'r' + r + 'c' + c + '-r' + nr + 'c' + nc,
            from: { r: r, c: c },
            to: { r: nr, c: nc },
            piece: 'K',
            isCapture: isCap,
            captures: isCap ? [{ r: nr, c: nc }] : [],
            notation: buildNotation('K', r, c, nr, nc, isCap, null, null, false)
          });
        }
      }

      // Castling (O-O and O-O-O)
      const homeR = player === 1 ? 7 : 0;
      const rights = state.castling && state.castling[player];
      if (rights && r === homeR && c === 4 && (rights.k || rights.q)) {
        if (!isSquareAttacked(board, homeR, 4, opp)) {
          // Kingside O-O
          if (
            rights.k &&
            board[homeR][7] &&
            board[homeR][7].owner === player &&
            board[homeR][7].type === 'R' &&
            !board[homeR][5] &&
            !board[homeR][6] &&
            !isSquareAttacked(board, homeR, 5, opp) &&
            !isSquareAttacked(board, homeR, 6, opp)
          ) {
            if (!out) return true;
            out.push({
              id: 'r' + homeR + 'c4-r' + homeR + 'c6-OO',
              from: { r: homeR, c: 4 },
              to: { r: homeR, c: 6 },
              piece: 'K',
              castle: 'K',
              isCapture: false,
              captures: [],
              notation: 'O-O'
            });
          }

          // Queenside O-O-O (b1/b8 must be empty; e, d, c files must not be attacked)
          if (
            rights.q &&
            board[homeR][0] &&
            board[homeR][0].owner === player &&
            board[homeR][0].type === 'R' &&
            !board[homeR][1] &&
            !board[homeR][2] &&
            !board[homeR][3] &&
            !isSquareAttacked(board, homeR, 3, opp) &&
            !isSquareAttacked(board, homeR, 2, opp)
          ) {
            if (!out) return true;
            out.push({
              id: 'r' + homeR + 'c4-r' + homeR + 'c2-OOO',
              from: { r: homeR, c: 4 },
              to: { r: homeR, c: 2 },
              piece: 'K',
              castle: 'Q',
              isCapture: false,
              captures: [],
              notation: 'O-O-O'
            });
          }
        }
      }
      return out ? out.length > 0 : false;
    }

    return false;
  }

  function hasAnyLegalMove(state, player) {
    const tempState = state.currentPlayer === player ? state : Object.assign({}, state, { currentPlayer: player });
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const cell = tempState.board[r][c];
        if (cell && cell.owner === player) {
          if (generatePieceLegalMoves(tempState, r, c, null)) return true;
        }
      }
    }
    return false;
  }

  function getLegalMoves(state, player) {
    if (!state || state.status !== 'playing') return [];
    const p = player || state.currentPlayer;
    const moves = [];
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const cell = state.board[r][c];
        if (cell && cell.owner === p) {
          generatePieceLegalMoves(state, r, c, moves);
        }
      }
    }
    return moves;
  }

  function getMovesForSource(state, source) {
    if (!state || state.status !== 'playing' || !source) return [];
    if (typeof source.r !== 'number' || typeof source.c !== 'number') return [];
    if (!inBounds(source.r, source.c)) return [];
    const cell = state.board[source.r][source.c];
    if (!cell || cell.owner !== state.currentPlayer) return [];
    const moves = [];
    generatePieceLegalMoves(state, source.r, source.c, moves);
    return moves;
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
    if (!source || typeof source.r !== 'number' || typeof source.c !== 'number' || !inBounds(source.r, source.c)) {
      return {
        selectable: false,
        hasMoves: false,
        reasonZh: '請點擊棋盤上的己方棋子',
        reasonEn: 'Click one of your own pieces on the board'
      };
    }
    const cell = state.board[source.r][source.c];
    if (!cell) {
      return {
        selectable: false,
        hasMoves: false,
        reasonZh: '此方格為空位，請點擊' + SIDE_LABELS[p].zh + '棋子',
        reasonEn: 'Empty square — select a ' + SIDE_LABELS[p].en + ' piece'
      };
    }
    if (cell.owner !== p) {
      return {
        selectable: false,
        hasMoves: false,
        reasonZh: '這是對手的' + PIECE_LABELS[cell.type].zh + '，請點選' + SIDE_LABELS[p].zh + '棋子',
        reasonEn: 'Opponent piece — select your own ' + SIDE_LABELS[p].en + ' piece'
      };
    }

    const moves = getMovesForSource(state, source);
    if (moves.length === 0) {
      const inChk = state.inCheck === p || isInCheck(state.board, p);
      return {
        selectable: true,
        hasMoves: false,
        reasonZh: inChk
          ? '己方國王正受將軍，此' + PIECE_LABELS[cell.type].zh + '無法解將'
          : '此' + PIECE_LABELS[cell.type].zh + '受阻擋或遭絕對牽制（移動將使國王暴露於將軍之下）',
        reasonEn: inChk
          ? 'Your King is in check and this ' + PIECE_LABELS[cell.type].en + ' cannot resolve check'
          : 'This ' + PIECE_LABELS[cell.type].en + ' is blocked or pinned to your King'
      };
    }

    // Count distinct destination squares (since promotion generates 4 choices on 1 square)
    const uniqueTargets = Object.create(null);
    let capSquares = 0;
    for (let i = 0; i < moves.length; i++) {
      const key = moves[i].to.r + ',' + moves[i].to.c;
      if (!uniqueTargets[key]) {
        uniqueTargets[key] = true;
        if (moves[i].isCapture) capSquares++;
      }
    }
    const destCount = Object.keys(uniqueTargets).length;

    return {
      selectable: true,
      hasMoves: true,
      reasonZh:
        '已選取' +
        PIECE_LABELS[cell.type].zh +
        '（' +
        sqName(source.r, source.c) +
        '）：可走 ' +
        destCount +
        ' 格' +
        (capSquares > 0 ? '（含 ' + capSquares + ' 個可吃目標）' : ''),
      reasonEn:
        'Selected ' +
        PIECE_LABELS[cell.type].en +
        ' (' +
        sqName(source.r, source.c) +
        '): ' +
        destCount +
        ' legal square(s)' +
        (capSquares > 0 ? ' (' + capSquares + ' capture(s))' : '')
    };
  }

  function isInsufficientMaterial(board) {
    let minors = [];
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const cell = board[r][c];
        if (!cell || cell.type === 'K') continue;
        if (cell.type === 'P' || cell.type === 'R' || cell.type === 'Q') return false;
        minors.push({ owner: cell.owner, type: cell.type, sqColor: (r + c) & 1 });
        if (minors.length > 2) return false;
      }
    }
    if (minors.length <= 1) return true; // K vs K, K+B vs K, K+N vs K
    // K+B vs K+B with both Bishops on the same square color
    if (
      minors.length === 2 &&
      minors[0].type === 'B' &&
      minors[1].type === 'B' &&
      minors[0].owner !== minors[1].owner &&
      minors[0].sqColor === minors[1].sqColor
    ) {
      return true;
    }
    return false;
  }

  function resolveMove(state, move) {
    if (!move) return null;
    if (move.from && move.to && typeof move.from.r === 'number' && typeof move.to.r === 'number') {
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
    const fr = move.from.r;
    const fc = move.from.c;
    const tr = move.to.r;
    const tc = move.to.c;

    const movingPiece = next.board[fr][fc];
    if (!movingPiece || movingPiece.owner !== mover) return next;

    let capturedType = null;
    const directTarget = next.board[tr][tc];
    if (directTarget) {
      capturedType = directTarget.type;
    }

    // En Passant capture removes the jumped enemy pawn
    if (move.enPassant && state.enPassant) {
      const epCell = next.board[state.enPassant.pawnR][state.enPassant.pawnC];
      if (epCell) capturedType = epCell.type;
      next.board[state.enPassant.pawnR][state.enPassant.pawnC] = null;
    }

    // Move piece (applying promotion if specified)
    next.board[tr][tc] = {
      owner: mover,
      type: move.promote || movingPiece.type
    };
    next.board[fr][fc] = null;

    // Castling moves the corresponding Rook
    if (move.castle === 'K') {
      next.board[tr][5] = next.board[tr][7];
      next.board[tr][7] = null;
    } else if (move.castle === 'Q') {
      next.board[tr][3] = next.board[tr][0];
      next.board[tr][0] = null;
    }

    // Update castling rights when King or Rook moves OR when a corner Rook is captured
    if (movingPiece.type === 'K') {
      next.castling[mover].k = false;
      next.castling[mover].q = false;
    }
    if (fr === 7 && fc === 7) next.castling[1].k = false;
    if (fr === 7 && fc === 0) next.castling[1].q = false;
    if (fr === 0 && fc === 7) next.castling[2].k = false;
    if (fr === 0 && fc === 0) next.castling[2].q = false;
    if (tr === 7 && tc === 7) next.castling[1].k = false;
    if (tr === 7 && tc === 0) next.castling[1].q = false;
    if (tr === 0 && tc === 7) next.castling[2].k = false;
    if (tr === 0 && tc === 0) next.castling[2].q = false;

    // Update En Passant square
    if (movingPiece.type === 'P' && Math.abs(tr - fr) === 2) {
      next.enPassant = {
        r: (fr + tr) / 2,
        c: fc,
        pawnR: tr,
        pawnC: tc
      };
    } else {
      next.enPassant = null;
    }

    // Update captured list & 50-move halfMoveClock
    if (capturedType) {
      next.captured[mover].push(capturedType);
    }
    if (movingPiece.type === 'P' || capturedType) {
      next.halfMoveClock = 0;
    } else {
      next.halfMoveClock = (state.halfMoveClock || 0) + 1;
    }

    next.moveCount = (state.moveCount || 0) + 1;
    next.turnNumber = (state.turnNumber || 1) + 1;
    next.currentPlayer = opp;

    const oppInCheck = isInCheck(next.board, opp);
    next.inCheck = oppInCheck ? opp : 0;

    let notation =
      move.notation ||
      buildNotation(
        movingPiece.type,
        fr,
        fc,
        tr,
        tc,
        Boolean(capturedType),
        move.promote || null,
        move.castle || null,
        Boolean(move.enPassant)
      );

    const oppHasMove = hasAnyLegalMove(next, opp);

    if (!oppHasMove) {
      next.status = 'ended';
      if (oppInCheck) {
        next.winner = mover;
        next.endReason = 'checkmate';
        notation += '#';
      } else {
        next.winner = 0;
        next.endReason = 'stalemate';
      }
    } else {
      if (oppInCheck) notation += '+';
      const posKey = computePosKey(next.board, opp, next.castling, next.enPassant);
      const count = (next.posCounts[posKey] || 0) + 1;
      next.posCounts[posKey] = count;

      if (count >= 3) {
        next.status = 'ended';
        next.winner = 0;
        next.endReason = 'threefold_repetition';
      } else if (next.halfMoveClock >= 100) {
        next.status = 'ended';
        next.winner = 0;
        next.endReason = 'fifty_move_rule';
      } else if (isInsufficientMaterial(next.board)) {
        next.status = 'ended';
        next.winner = 0;
        next.endReason = 'insufficient_material';
      }
    }

    next.lastMove = {
      id: move.id,
      from: { r: fr, c: fc },
      to: { r: tr, c: tc },
      piece: movingPiece.type,
      promote: move.promote || null,
      castle: move.castle || null,
      enPassant: Boolean(move.enPassant),
      isCapture: Boolean(capturedType),
      notation: notation,
      player: mover
    };

    return next;
  }

  function evaluate(state, perspectivePlayer) {
    const me = perspectivePlayer || state.currentPlayer;
    const opp = opponentOf(me);

    if (state.status === 'ended') {
      if (state.winner === 0 || state.winner === null) return 0;
      return state.winner === me ? 100000 : -100000;
    }

    const board = state.board;
    let nonPawnMaterial = 0;
    let myBishops = 0;
    let oppBishops = 0;

    for (let r = 0; r < ROWS; r++) {
      const row = board[r];
      for (let c = 0; c < COLS; c++) {
        const cell = row[c];
        if (!cell || cell.type === 'K' || cell.type === 'P') continue;
        nonPawnMaterial += MATERIAL[cell.type];
        if (cell.type === 'B') {
          if (cell.owner === me) myBishops++;
          else oppBishops++;
        }
      }
    }

    // Endgame phase weight: 0.0 in opening (nonPawnMaterial >= 2800), 1.0 in pure endgame (<= 900)
    const endPhase = Math.max(0, Math.min(1, (2800 - nonPawnMaterial) / 1900));

    let score = 0;
    for (let r = 0; r < ROWS; r++) {
      const row = board[r];
      for (let c = 0; c < COLS; c++) {
        const cell = row[c];
        if (!cell) continue;
        const relR = cell.owner === 1 ? r : 7 - r;
        let val = MATERIAL[cell.type];
        if (cell.type === 'K') {
          const midK = PST.K_MID[relR][c];
          const endK = PST.K_END[relR][c];
          val += Math.round(midK * (1 - endPhase) + endK * endPhase);
        } else {
          val += PST[cell.type][relR][c];
        }
        if (cell.owner === me) score += val;
        else score -= val;
      }
    }

    // Bishop pair bonus
    if (myBishops >= 2) score += 32;
    if (oppBishops >= 2) score -= 32;

    // Center control / light mobility signal on d4/e4/d5/e5
    for (let r = 3; r <= 4; r++) {
      for (let c = 3; c <= 4; c++) {
        if (isSquareAttacked(board, r, c, me)) score += 7;
        if (isSquareAttacked(board, r, c, opp)) score -= 7;
      }
    }

    if (state.inCheck === opp) score += 35;
    else if (state.inCheck === me) score -= 35;

    return score;
  }

  BoardArena.registerRule('chess', {
    id: 'chess',
    selectionMode: 'piece',
    rows: ROWS,
    cols: COLS,
    sideLabels: SIDE_LABELS,
    pieceLabels: PIECE_LABELS,
    createInitialState: createInitialState,
    cloneState: cloneState,
    getLegalMoves: getLegalMoves,
    getMovesForSource: getMovesForSource,
    canSelectSource: canSelectSource,
    applyMove: applyMove,
    evaluate: evaluate,
    isInCheck: isInCheck,
    isSquareAttacked: isSquareAttacked
  });
})(typeof window !== 'undefined' ? window : globalThis);
