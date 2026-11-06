// ============================================
// Date: 2026-11-06
// Version: v1.3.0
// Changes: Selection reasons returned as language-neutral messages
// 修改: 選子提示改回傳語言中立的訊息
// ============================================
// ============================================
// Date: 2026-11-05
// Version: v1.1.0
// Changes: Repetition rule: 3-fold repetition draws, perpetual check loses (perpetual chase not implemented)
// 修改: 新增重複局面規則：同局面 3 次判和，長將方判負（長捉細則未實作）
// ============================================
/**
 * Classic Board Arena — Xiangqi (中國象棋 9×10) Complete Rule Engine
 * Implements Palace bounds, Flying General (王不見王), Blocked Elephant Eye (塞象眼),
 * Hobbled Horse Leg (蹩馬腿), Cannon Screen Jump Capture (隔山打牛), Soldier River Crossing,
 * Strict Legal Check Filter, Checkmate & Stalemate-is-Loss (困斃判負), and 120-ply Draw rule.
 */
(function (global) {
  'use strict';

  const BoardArena = global.BoardArena;
  const msg = BoardArena.msg;
  if (!BoardArena || typeof BoardArena.registerRule !== 'function') {
    throw new Error('BoardArena.registerRule is required before loading xiangqi.js');
  }

  const ROWS = 10;
  const COLS = 9;

  const SIDE_LABELS = {
    1: 'side.red',
    2: 'side.black'
  };

  const PIECE_LABELS = {
    1: { K: '帥', A: '仕', E: '相', H: '傌', R: '俥', C: '炮', P: '兵' },
    2: { K: '將', A: '士', E: '象', H: '馬', R: '車', C: '砲', P: '卒' }
  };

  const BASE_VALUES = {
    K: 100000,
    R: 900,
    C: 450,
    H: 400,
    E: 200,
    A: 200,
    P: 100
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

  const ELEPHANT_DELTAS = [
    [-2, -2, -1, -1],
    [-2, 2, -1, 1],
    [2, -2, 1, -1],
    [2, 2, 1, 1]
  ];

  // [dr, dc, legR, legC] from the moving Horse's square
  const HORSE_DELTAS = [
    [-2, -1, -1, 0],
    [-2, 1, -1, 0],
    [2, -1, 1, 0],
    [2, 1, 1, 0],
    [-1, -2, 0, -1],
    [1, -2, 0, -1],
    [-1, 2, 0, 1],
    [1, 2, 0, 1]
  ];

  function opponentOf(p) {
    return p === 1 ? 2 : 1;
  }

  function inBounds(r, c) {
    return r >= 0 && r < ROWS && c >= 0 && c < COLS;
  }

  function inPalace(player, r, c) {
    if (c < 3 || c > 5) return false;
    return player === 1 ? r >= 7 && r <= 9 : r >= 0 && r <= 2;
  }

  function createEmptyBoard() {
    const b = new Array(ROWS);
    for (let r = 0; r < ROWS; r++) {
      b[r] = [null, null, null, null, null, null, null, null, null];
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
    return {
      gameId: 'xiangqi',
      rows: ROWS,
      cols: COLS,
      board: cloneBoard(state.board),
      currentPlayer: state.currentPlayer,
      status: state.status,
      winner: state.winner,
      endReason: state.endReason,
      inCheck: state.inCheck || 0,
      turnNumber: state.turnNumber || 1,
      moveCount: state.moveCount || 0,
      halfMoveClock: state.halfMoveClock || 0,
      // 自上次吃子以來的局面紀錄（每筆物件建立後不再修改，可共用）
      repHistory: state.repHistory ? state.repHistory.slice() : [],
      lastMove: state.lastMove
        ? {
            id: state.lastMove.id,
            from: state.lastMove.from ? { r: state.lastMove.from.r, c: state.lastMove.from.c } : null,
            to: state.lastMove.to ? { r: state.lastMove.to.r, c: state.lastMove.to.c } : null,
            piece: state.lastMove.piece,
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

  function createInitialState() {
    const board = createEmptyBoard();
    const backRow = ['R', 'H', 'E', 'A', 'K', 'A', 'E', 'H', 'R'];

    for (let c = 0; c < COLS; c++) {
      board[0][c] = { owner: 2, type: backRow[c] };
      board[9][c] = { owner: 1, type: backRow[c] };
    }

    // Cannons
    board[2][1] = { owner: 2, type: 'C' };
    board[2][7] = { owner: 2, type: 'C' };
    board[7][1] = { owner: 1, type: 'C' };
    board[7][7] = { owner: 1, type: 'C' };

    // Five Soldiers each on even columns
    for (let c = 0; c < COLS; c += 2) {
      board[3][c] = { owner: 2, type: 'P' };
      board[6][c] = { owner: 1, type: 'P' };
    }

    return {
      gameId: 'xiangqi',
      rows: ROWS,
      cols: COLS,
      board: board,
      currentPlayer: 1,
      status: 'playing',
      winner: null,
      endReason: null,
      inCheck: 0,
      turnNumber: 1,
      moveCount: 0,
      halfMoveClock: 0,
      repHistory: [{ key: positionKey(board, 1), check: false, mover: 0 }],
      lastMove: null,
      captured: { 1: [], 2: [] }
    };
  }

  const REPETITION_LIMIT = 3;

  /** 局面鍵：棋盤 + 輪到哪方 */
  function positionKey(board, sideToMove) {
    let s = '';
    for (let r = 0; r < ROWS; r++) {
      const row = board[r];
      for (let c = 0; c < COLS; c++) {
        const cell = row[c];
        s += cell ? (cell.owner === 1 ? cell.type : cell.type.toLowerCase()) : '.';
      }
    }
    return s + sideToMove;
  }

  /**
   * 重複局面裁決（簡化的亞洲規則）：同一局面第 3 次出現時，
   * 循環中一方每步都將軍（長將）→ 該方判負；雙方都長將或都沒長將 → 和棋。
   * 註：「長捉」細則未實作，一律以和棋處理。
   * @param {Array<{key:string, check:boolean, mover:number}>} history 自上次吃子以來的紀錄（含最新一筆）
   * @returns {{winner:number, endReason:string}|null} 未達重複次數時回傳 null
   */
  function adjudicateRepetition(history) {
    const last = history[history.length - 1];
    let count = 0;
    let firstIdx = -1;
    for (let i = 0; i < history.length; i++) {
      if (history[i].key === last.key) {
        count++;
        if (firstIdx < 0) firstIdx = i;
      }
    }
    if (count < REPETITION_LIMIT) return null;
    const cycle = history.slice(firstIdx + 1);
    function allChecks(player) {
      const own = cycle.filter(function (h) {
        return h.mover === player;
      });
      return own.length > 0 && own.every(function (h) {
        return h.check;
      });
    }
    const p1 = allChecks(1);
    const p2 = allChecks(2);
    if (p1 && !p2) return { winner: 2, endReason: 'perpetual_check' };
    if (p2 && !p1) return { winner: 1, endReason: 'perpetual_check' };
    return { winner: 0, endReason: 'repetition_draw' };
  }

  function findGeneral(board, player) {
    // Check own palace first for O(1) typical lookup, fallback to full scan for custom test positions
    const rStart = player === 1 ? 7 : 0;
    const rEnd = player === 1 ? 9 : 2;
    for (let r = rStart; r <= rEnd; r++) {
      for (let c = 3; c <= 5; c++) {
        const p = board[r][c];
        if (p && p.owner === player && p.type === 'K') return { r: r, c: c };
      }
    }
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const p = board[r][c];
        if (p && p.owner === player && p.type === 'K') return { r: r, c: c };
      }
    }
    return null;
  }

  /**
   * Returns true if `player`'s General is currently attacked by any opponent piece
   * OR directly faces the opponent's General on an open file (Flying General 王不見王).
   */
  function isInCheck(board, player) {
    const kingPos = findGeneral(board, player);
    if (!kingPos) return true;
    const kr = kingPos.r;
    const kc = kingPos.c;
    const opp = opponentOf(player);

    // 1. Orthogonal rays: Chariots (R), Cannons (C) over 1 screen, Flying General (K), and adjacent Soldiers (P)
    for (let d = 0; d < 4; d++) {
      const dr = ORTHO_DIRS[d][0];
      const dc = ORTHO_DIRS[d][1];
      let screens = 0;
      let dist = 1;
      let nr = kr + dr;
      let nc = kc + dc;

      while (inBounds(nr, nc)) {
        const cell = board[nr][nc];
        if (cell) {
          if (screens === 0) {
            if (cell.owner === opp) {
              if (cell.type === 'R' || cell.type === 'K') return true;
              if (dist === 1 && cell.type === 'P') {
                const oppFwd = opp === 1 ? -1 : 1;
                const oppCrossed = opp === 1 ? nr <= 4 : nr >= 5;
                if (nr + oppFwd === kr && nc === kc) return true;
                if (oppCrossed && nr === kr && Math.abs(nc - kc) === 1) return true;
              }
            }
            screens = 1;
          } else {
            if (cell.owner === opp && cell.type === 'C') return true;
            break;
          }
        }
        nr += dr;
        nc += dc;
        dist++;
      }
    }

    // 2. Enemy Horses (H) checking (kr, kc) — leg is adjacent to the enemy Horse!
    for (let i = 0; i < 8; i++) {
      const dkr = HORSE_DELTAS[i][0];
      const dkc = HORSE_DELTAS[i][1];
      const hr = kr + dkr;
      const hc = kc + dkc;
      if (!inBounds(hr, hc)) continue;
      const cell = board[hr][hc];
      if (cell && cell.owner === opp && cell.type === 'H') {
        // From (hr, hc) jumping (-dkr, -dkc) to (kr, kc), the Horse's orthogonal leg is:
        const legR = Math.abs(dkr) === 2 ? hr - dkr / 2 : hr;
        const legC = Math.abs(dkc) === 2 ? hc - dkc / 2 : hc;
        if (!board[legR][legC]) return true;
      }
    }

    return false;
  }

  function formatNotation(piece, r, c, nr, nc, isCapture) {
    const label = PIECE_LABELS[piece.owner][piece.type];
    const colLabel = piece.owner === 1 ? 9 - c : c + 1;
    const destColLabel = piece.owner === 1 ? 9 - nc : nc + 1;
    let actionChar;
    let targetVal;
    if (nr === r) {
      actionChar = '平';
      targetVal = destColLabel;
    } else {
      const movingForward = piece.owner === 1 ? nr < r : nr > r;
      actionChar = movingForward ? '進' : '退';
      if (piece.type === 'H' || piece.type === 'E' || piece.type === 'A') {
        targetVal = destColLabel;
      } else {
        targetVal = Math.abs(nr - r);
      }
    }
    return label + colLabel + actionChar + targetVal + (isCapture ? '吃' : '');
  }

  function tryPushLegalMove(board, player, piece, r, c, nr, nc, out) {
    const target = board[nr][nc];
    if (target && target.owner === player) return false;

    // Fast in-place simulation & restore
    board[nr][nc] = piece;
    board[r][c] = null;
    const illegal = isInCheck(board, player);
    board[r][c] = piece;
    board[nr][nc] = target;

    if (illegal) return false;

    if (out) {
      const isCap = Boolean(target);
      out.push({
        id: 'r' + r + 'c' + c + '-r' + nr + 'c' + nc,
        from: { r: r, c: c },
        to: { r: nr, c: nc },
        piece: piece.type,
        isCapture: isCap,
        captures: isCap ? [{ r: nr, c: nc }] : [],
        notation: formatNotation(piece, r, c, nr, nc, isCap)
      });
    }
    return true;
  }

  /**
   * Generates legal moves for a single piece at (r, c).
   * If `out` is null, returns true immediately upon finding the first legal move (early-exit check).
   */
  function generatePieceLegalMoves(board, r, c, out) {
    const piece = board[r][c];
    if (!piece) return false;
    const player = piece.owner;
    const type = piece.type;

    if (type === 'K') {
      for (let i = 0; i < 4; i++) {
        const nr = r + ORTHO_DIRS[i][0];
        const nc = c + ORTHO_DIRS[i][1];
        if (inPalace(player, nr, nc)) {
          if (tryPushLegalMove(board, player, piece, r, c, nr, nc, out) && !out) return true;
        }
      }
      return out ? out.length > 0 : false;
    }

    if (type === 'A') {
      for (let i = 0; i < 4; i++) {
        const nr = r + DIAG_DIRS[i][0];
        const nc = c + DIAG_DIRS[i][1];
        if (inPalace(player, nr, nc)) {
          if (tryPushLegalMove(board, player, piece, r, c, nr, nc, out) && !out) return true;
        }
      }
      return out ? out.length > 0 : false;
    }

    if (type === 'E') {
      for (let i = 0; i < 4; i++) {
        const nr = r + ELEPHANT_DELTAS[i][0];
        const nc = c + ELEPHANT_DELTAS[i][1];
        if (!inBounds(nr, nc)) continue;
        // Cannot cross the river
        if (player === 1 && nr < 5) continue;
        if (player === 2 && nr > 4) continue;
        // Blocked Elephant Eye (塞象眼)
        const eyeR = r + ELEPHANT_DELTAS[i][2];
        const eyeC = c + ELEPHANT_DELTAS[i][3];
        if (board[eyeR][eyeC] !== null) continue;
        if (tryPushLegalMove(board, player, piece, r, c, nr, nc, out) && !out) return true;
      }
      return out ? out.length > 0 : false;
    }

    if (type === 'H') {
      for (let i = 0; i < 8; i++) {
        const nr = r + HORSE_DELTAS[i][0];
        const nc = c + HORSE_DELTAS[i][1];
        if (!inBounds(nr, nc)) continue;
        // Hobbled Horse Leg (蹩馬腿)
        const legR = r + HORSE_DELTAS[i][2];
        const legC = c + HORSE_DELTAS[i][3];
        if (board[legR][legC] !== null) continue;
        if (tryPushLegalMove(board, player, piece, r, c, nr, nc, out) && !out) return true;
      }
      return out ? out.length > 0 : false;
    }

    if (type === 'R') {
      for (let d = 0; d < 4; d++) {
        const dr = ORTHO_DIRS[d][0];
        const dc = ORTHO_DIRS[d][1];
        let nr = r + dr;
        let nc = c + dc;
        while (inBounds(nr, nc)) {
          const cell = board[nr][nc];
          if (!cell) {
            if (tryPushLegalMove(board, player, piece, r, c, nr, nc, out) && !out) return true;
          } else {
            if (cell.owner !== player) {
              if (tryPushLegalMove(board, player, piece, r, c, nr, nc, out) && !out) return true;
            }
            break;
          }
          nr += dr;
          nc += dc;
        }
      }
      return out ? out.length > 0 : false;
    }

    if (type === 'C') {
      for (let d = 0; d < 4; d++) {
        const dr = ORTHO_DIRS[d][0];
        const dc = ORTHO_DIRS[d][1];
        let nr = r + dr;
        let nc = c + dc;
        let jumpedScreen = false;
        while (inBounds(nr, nc)) {
          const cell = board[nr][nc];
          if (!jumpedScreen) {
            if (!cell) {
              if (tryPushLegalMove(board, player, piece, r, c, nr, nc, out) && !out) return true;
            } else {
              jumpedScreen = true;
            }
          } else if (cell) {
            if (cell.owner !== player) {
              if (tryPushLegalMove(board, player, piece, r, c, nr, nc, out) && !out) return true;
            }
            break;
          }
          nr += dr;
          nc += dc;
        }
      }
      return out ? out.length > 0 : false;
    }

    if (type === 'P') {
      const fwd = player === 1 ? -1 : 1;
      const crossedRiver = player === 1 ? r <= 4 : r >= 5;
      const fr = r + fwd;
      if (inBounds(fr, c)) {
        if (tryPushLegalMove(board, player, piece, r, c, fr, c, out) && !out) return true;
      }
      if (crossedRiver) {
        if (inBounds(r, c - 1)) {
          if (tryPushLegalMove(board, player, piece, r, c, r, c - 1, out) && !out) return true;
        }
        if (inBounds(r, c + 1)) {
          if (tryPushLegalMove(board, player, piece, r, c, r, c + 1, out) && !out) return true;
        }
      }
      return out ? out.length > 0 : false;
    }

    return false;
  }

  function hasAnyLegalMove(board, player) {
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const cell = board[r][c];
        if (cell && cell.owner === player) {
          if (generatePieceLegalMoves(board, r, c, null)) return true;
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
          generatePieceLegalMoves(state.board, r, c, moves);
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
    generatePieceLegalMoves(state.board, source.r, source.c, moves);
    return moves;
  }

  function pieceMsg(piece) {
    return msg('piece.xiangqi.' + piece.owner + '.' + piece.type);
  }

  function diagnoseZeroMoves(state, r, c, piece) {
    const player = piece.owner;
    const params = { piece: pieceMsg(piece) };
    if (state.inCheck === player || isInCheck(state.board, player)) return msg('rule.xiangqi.cannotResolveCheck', params);
    if (piece.type === 'H') return msg('rule.xiangqi.horseBlocked', params);
    if (piece.type === 'E') return msg('rule.xiangqi.elephantBlocked', params);
    return msg('rule.xiangqi.blocked', params);
  }

  function canSelectSource(state, source, player) {
    if (!state || state.status !== 'playing') {
      return {
        selectable: false,
        hasMoves: false,
        reason: msg('rule.gameEnded')
      };
    }
    const p = player || state.currentPlayer;
    if (p !== state.currentPlayer) {
      return {
        selectable: false,
        hasMoves: false,
        reason: msg('rule.notYourTurn', { side: msg(SIDE_LABELS[state.currentPlayer]) })
      };
    }
    if (!source || typeof source.r !== 'number' || typeof source.c !== 'number' || !inBounds(source.r, source.c)) {
      return {
        selectable: false,
        hasMoves: false,
        reason: msg('rule.xiangqi.clickOwnPiece')
      };
    }
    const cell = state.board[source.r][source.c];
    if (!cell) {
      return {
        selectable: false,
        hasMoves: false,
        reason: msg('rule.xiangqi.empty', { side: msg(SIDE_LABELS[p]) })
      };
    }
    if (cell.owner !== p) {
      return {
        selectable: false,
        hasMoves: false,
        reason: msg('rule.xiangqi.opponentPiece', { piece: pieceMsg(cell), side: msg(SIDE_LABELS[p]) })
      };
    }
    const moves = getMovesForSource(state, source);
    if (moves.length === 0) {
      return {
        selectable: true,
        hasMoves: false,
        reason: diagnoseZeroMoves(state, source.r, source.c, cell)
      };
    }
    const capCount = moves.filter(function (m) {
      return m.isCapture;
    }).length;
    return {
      selectable: true,
      hasMoves: true,
      reason: msg('rule.xiangqi.selected', {
        piece: pieceMsg(cell),
        count: moves.length,
        captures: capCount > 0 ? msg('rule.xiangqi.capturesSuffix', { count: capCount }) : ''
      })
    };
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
    if (!movingPiece || movingPiece.owner !== mover) {
      return next;
    }

    const capturedPiece = next.board[tr][tc];
    next.board[tr][tc] = movingPiece;
    next.board[fr][fc] = null;

    if (capturedPiece) {
      next.captured[mover].push(capturedPiece.type);
      next.halfMoveClock = 0;
    } else {
      next.halfMoveClock = (state.halfMoveClock || 0) + 1;
    }

    next.moveCount = (state.moveCount || 0) + 1;
    next.turnNumber = (state.turnNumber || 1) + 1;
    next.currentPlayer = opp;
    next.lastMove = {
      id: move.id,
      from: { r: fr, c: fc },
      to: { r: tr, c: tc },
      piece: movingPiece.type,
      isCapture: Boolean(capturedPiece),
      notation: move.notation || formatNotation(movingPiece, fr, fc, tr, tc, Boolean(capturedPiece)),
      player: mover
    };

    // Immediate General capture guard (should not occur in legal play, kept as defensive safety)
    if (capturedPiece && capturedPiece.type === 'K') {
      next.status = 'ended';
      next.winner = mover;
      next.endReason = 'checkmate';
      next.inCheck = opp;
      return next;
    }

    const oppInCheck = isInCheck(next.board, opp);
    next.inCheck = oppInCheck ? opp : 0;

    if (!hasAnyLegalMove(next.board, opp)) {
      next.status = 'ended';
      next.winner = mover;
      // In Xiangqi, stalemate (困斃) is a LOSS for the stalemated player!
      next.endReason = oppInCheck ? 'checkmate' : 'stalemate';
      return next;
    }

    // 重複局面（長將判負／循環和棋）；吃子後局面不可能回復，紀錄歸零
    if (capturedPiece) next.repHistory = [];
    next.repHistory.push({ key: positionKey(next.board, opp), check: Boolean(oppInCheck), mover: mover });
    const rep = adjudicateRepetition(next.repHistory);
    if (rep) {
      next.status = 'ended';
      next.winner = rep.winner;
      next.endReason = rep.endReason;
      return next;
    }

    if (next.halfMoveClock >= 120) {
      next.status = 'ended';
      next.winner = 0;
      next.endReason = 'draw_120_ply';
    }

    return next;
  }

  function piecePositionalScore(piece, r, c) {
    // Normalize row from owner's perspective: relR = 0 is enemy back rank, relR = 9 is own back rank
    const relR = piece.owner === 1 ? r : 9 - r;
    const centerDist = Math.abs(4 - c);
    const t = piece.type;

    if (t === 'P') {
      // Across river (relR <= 4): base jumps from 100 to 200 (+100 bonus) + palace pressure!
      if (relR <= 4) {
        let bonus = 100; // Total 200 across river
        if (relR >= 1 && relR <= 3) bonus += 35 - centerDist * 6;
        else if (relR === 0) bonus += 10; // Bottom Soldier ("老兵") loses forward step
        else bonus += 20 - centerDist * 4;
        return bonus;
      }
      return relR === 5 ? 18 - centerDist * 3 : 0;
    }

    if (t === 'R') {
      let bonus = (4 - centerDist) * 4;
      if (relR <= 4) bonus += 22;
      if (relR === 2 || relR === 1) bonus += 16; // Throat / Soldier-rank control
      if (c === 3 || c === 5) bonus += 14; // Rib files (肋道)
      return bonus;
    }

    if (t === 'H') {
      if (relR === 9 && (c === 1 || c === 7)) return -18; // Undeveloped corner horse
      let bonus = 24 - centerDist * 5 - Math.abs(3.5 - relR) * 4;
      if (relR >= 1 && relR <= 4 && centerDist <= 2) bonus += 24;
      return bonus;
    }

    if (t === 'C') {
      let bonus = 0;
      if (c === 4) bonus += 32; // Central Cannon (中炮)
      if (relR <= 3) bonus += 14;
      return bonus;
    }

    if (t === 'A' || t === 'E') {
      // Linked central palace/river guard
      if (t === 'A' && relR === 8 && c === 4) return 18;
      if (t === 'E' && relR === 7 && c === 4) return 18;
      return 6;
    }

    if (t === 'K') {
      return relR === 9 && c === 4 ? 12 : 0;
    }

    return 0;
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
    const counts = {
      1: { A: 0, E: 0, R: 0 },
      2: { A: 0, E: 0, R: 0 }
    };
    const generals = { 1: null, 2: null };

    for (let r = 0; r < ROWS; r++) {
      const row = board[r];
      for (let c = 0; c < COLS; c++) {
        const cell = row[c];
        if (!cell) continue;
        const val = BASE_VALUES[cell.type] + piecePositionalScore(cell, r, c);
        if (cell.owner === me) score += val;
        else score -= val;
        if (cell.type === 'K') generals[cell.owner] = { r: r, c: c };
        else if (cell.type === 'A' || cell.type === 'E' || cell.type === 'R') {
          counts[cell.owner][cell.type]++;
        }
      }
    }

    // Palace defense synergy (雙仕雙相) vs broken palace penalty when opponent has Chariots
    for (let p = 1; p <= 2; p++) {
      const sign = p === me ? 1 : -1;
      const other = p === 1 ? 2 : 1;
      if (counts[p].A === 2) score += sign * 35;
      if (counts[p].E === 2) score += sign * 30;
      if (counts[p].A === 0 && counts[other].R > 0) score -= sign * 65;

      // Hollow / Central Cannon alignment with enemy General
      const oppKing = generals[other];
      if (oppKing) {
        const kc = oppKing.c;
        const kr = oppKing.r;
        const step = kr < 5 ? 1 : -1;
        let screens = 0;
        let sr = kr + step;
        while (sr >= 0 && sr < ROWS) {
          const pc = board[sr][kc];
          if (pc) {
            if (pc.owner === p && pc.type === 'C') {
              if (screens === 0) score += sign * 85; // Hollow Cannon (空頭炮)!
              else if (screens === 1) score += sign * 50; // Central Cannon check/pin!
              break;
            }
            screens++;
            if (screens > 2) break;
          }
          sr += step;
        }
      }
    }

    if (state.inCheck === opp) score += 75;
    else if (state.inCheck === me) score -= 75;

    return score;
  }

  BoardArena.registerRule('xiangqi', {
    id: 'xiangqi',
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
    isInCheck: isInCheck
  });
})(typeof window !== 'undefined' ? window : globalThis);
