// ============================================
// Date: 2026-11-05
// Version: v1.1.0
// Changes: FMJD majority-capture rule; jumped pieces stay on board until the sequence ends (no double jumping)
// 修改: 加入 FMJD「最多吃子」規則；連跳中被吃的子保留到整串結束才移除，不可重複跳過
// ============================================
/**
 * Classic Board Arena — International Draughts (10×10 FMJD Polish Checkers) Rule Engine
 * Features:
 *   - 10×10 board (20 White vs 20 Black pieces on dark squares (r + c) % 2 === 1)
 *   - Regular men step diagonally forward 1 square, but capture both forward & backward!
 *   - Flying Kings (加冕飛行王棋): slide and capture at long range along all 4 diagonals
 *   - Mandatory Capture (有吃必吃): if any capture is available, non-captures are illegal
 *   - Multi-Jump Chain Continuation (多連跳強制續跳): when a capturing piece can continue
 *     jumping from its landing square, `state.mustContinueFrom = { r, c }` keeps the turn
 *     on the same player until the capture sequence completes; promotion to King occurs
 *     when the turn ends on the far rank (row 0 for White, row 9 for Black).
 *   - Piece-selection support (`getMovesForSource`, `canSelectSource`) for crystal-clear UI highlighting
 */
(function (global) {
  'use strict';

  const BoardArena = (global.BoardArena = global.BoardArena || {});

  const ROWS = 10;
  const COLS = 10;

  const SIDE_LABELS = {
    1: { zh: '白方', en: 'White' },
    2: { zh: '黑方', en: 'Black' }
  };

  const DIAGS = [
    [-1, -1],
    [-1, 1],
    [1, -1],
    [1, 1]
  ];

  function opponentOf(p) {
    return p === 1 ? 2 : 1;
  }

  function inBounds(r, c) {
    return r >= 0 && r < ROWS && c >= 0 && c < COLS;
  }

  /**
   * Standard FMJD 1..50 dark-square notation
   */
  function sqNum(r, c) {
    if ((r + c) % 2 === 0) return r * 10 + c + 1;
    return r * 5 + Math.floor(c / 2) + 1;
  }

  function createEmptyBoard() {
    const b = new Array(ROWS);
    for (let r = 0; r < ROWS; r++) {
      b[r] = new Array(COLS).fill(null);
    }
    return b;
  }

  function createInitialState() {
    const board = createEmptyBoard();
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if ((r + c) % 2 === 1) {
          if (r <= 3) {
            board[r][c] = { owner: 2, king: false };
          } else if (r >= 6) {
            board[r][c] = { owner: 1, king: false };
          }
        }
      }
    }

    return {
      gameType: 'draughts',
      rows: ROWS,
      cols: COLS,
      board: board,
      currentPlayer: 1,
      turnNumber: 1,
      moveCount: 0,
      mustContinueFrom: null,
      pendingCaptures: [],
      capturedCount: { 1: 0, 2: 0 },
      quietMoves: 0,
      status: 'playing',
      winner: null,
      endReason: null,
      lastMove: null
    };
  }

  function cloneState(state) {
    if (!state) return null;
    const b = new Array(ROWS);
    for (let r = 0; r < ROWS; r++) {
      const row = new Array(COLS);
      for (let c = 0; c < COLS; c++) {
        const cell = state.board[r][c];
        row[c] = cell ? { owner: cell.owner, king: Boolean(cell.king) } : null;
      }
      b[r] = row;
    }
    return {
      gameType: 'draughts',
      rows: ROWS,
      cols: COLS,
      board: b,
      currentPlayer: state.currentPlayer,
      turnNumber: state.turnNumber,
      moveCount: state.moveCount || 0,
      mustContinueFrom: state.mustContinueFrom
        ? { r: state.mustContinueFrom.r, c: state.mustContinueFrom.c }
        : null,
      pendingCaptures: (state.pendingCaptures || []).map(function (p) {
        return { r: p.r, c: p.c };
      }),
      capturedCount: {
        1: (state.capturedCount && state.capturedCount[1]) || 0,
        2: (state.capturedCount && state.capturedCount[2]) || 0
      },
      quietMoves: state.quietMoves || 0,
      status: state.status,
      winner: state.winner,
      endReason: state.endReason,
      lastMove: state.lastMove ? BoardArena.deepClone(state.lastMove) : null
    };
  }

  function isPending(pending, r, c) {
    if (!pending) return false;
    for (let i = 0; i < pending.length; i++) {
      if (pending[i].r === r && pending[i].c === c) return true;
    }
    return false;
  }

  /**
   * 從目前位置往下最多還能連吃幾子（FMJD：被吃的子在整串連跳結束前仍留在盤上、不可重複跳過）。
   * @param {Array} board 棋盤（會暫時修改後還原）
   * @param {number} r 跳子目前列
   * @param {number} c 跳子目前行
   * @param {Array<{r:number,c:number}>} pending 本回合已跳過、尚未移除的敵子
   * @returns {number} 可再吃的最大子數
   */
  function maxFurtherCaptures(board, r, c, pending) {
    const piece = board[r][c];
    const jumps = getCapturesFromSquare(board, r, c, pending);
    let best = 0;
    for (let i = 0; i < jumps.length; i++) {
      const j = jumps[i];
      board[r][c] = null;
      board[j.to.r][j.to.c] = piece;
      pending.push(j.captures[0]);
      const total = 1 + maxFurtherCaptures(board, j.to.r, j.to.c, pending);
      pending.pop();
      board[j.to.r][j.to.c] = null;
      board[r][c] = piece;
      if (total > best) best = total;
    }
    return best;
  }

  /**
   * 為每個單跳計算「走這一跳後整串最多可吃幾子」，只保留達到最大值者（最多吃子規則）。
   * @returns {Array} 符合最多吃子規則的單跳
   */
  function filterMajorityJumps(board, jumps, pending) {
    let best = 0;
    const scored = [];
    for (let i = 0; i < jumps.length; i++) {
      const j = jumps[i];
      const piece = board[j.from.r][j.from.c];
      board[j.from.r][j.from.c] = null;
      board[j.to.r][j.to.c] = piece;
      const nextPending = pending.concat([j.captures[0]]);
      const total = 1 + maxFurtherCaptures(board, j.to.r, j.to.c, nextPending);
      board[j.to.r][j.to.c] = null;
      board[j.from.r][j.from.c] = piece;
      scored.push(total);
      if (total > best) best = total;
    }
    return jumps.filter(function (_, i) {
      return scored[i] === best;
    });
  }

  /**
   * Generate single-jump captures from (r, c) for the piece at board[r][c].
   * @param {Array<{r:number,c:number}>} [pending] 本回合已跳過的敵子：仍佔據格子、不可再被跳
   */
  function getCapturesFromSquare(board, r, c, pending) {
    const piece = board[r][c];
    if (!piece) return [];
    const owner = piece.owner;
    const opp = opponentOf(owner);
    const captures = [];

    if (!piece.king) {
      // Men capture in all 4 diagonal directions (forward and backward)
      for (let d = 0; d < 4; d++) {
        const dr = DIAGS[d][0];
        const dc = DIAGS[d][1];
        const mr = r + dr;
        const mc = c + dc;
        const tr = r + 2 * dr;
        const tc = c + 2 * dc;
        if (!inBounds(tr, tc)) continue;
        const mid = board[mr][mc];
        if (mid && mid.owner === opp && !isPending(pending, mr, mc) && !board[tr][tc]) {
          const fromN = sqNum(r, c);
          const toN = sqNum(tr, tc);
          captures.push({
            id: 'cap:' + r + ',' + c + '->' + tr + ',' + tc,
            from: { r: r, c: c },
            to: { r: tr, c: tc },
            isCapture: true,
            captures: [{ r: mr, c: mc }],
            notation: fromN + 'x' + toN
          });
        }
      }
    } else {
      // Flying King: slide any number of empty squares, jump 1 enemy piece, land on any empty square beyond
      for (let d = 0; d < 4; d++) {
        const dr = DIAGS[d][0];
        const dc = DIAGS[d][1];
        let sr = r + dr;
        let sc = c + dc;
        while (inBounds(sr, sc) && !board[sr][sc]) {
          sr += dr;
          sc += dc;
        }
        if (!inBounds(sr, sc)) continue;
        const enemy = board[sr][sc];
        if (!enemy || enemy.owner !== opp || isPending(pending, sr, sc)) continue;

        let lr = sr + dr;
        let lc = sc + dc;
        while (inBounds(lr, lc) && !board[lr][lc]) {
          const fromN = sqNum(r, c);
          const toN = sqNum(lr, lc);
          captures.push({
            id: 'kcap:' + r + ',' + c + '->' + lr + ',' + lc,
            from: { r: r, c: c },
            to: { r: lr, c: lc },
            isCapture: true,
            captures: [{ r: sr, c: sc }],
            notation: 'K' + fromN + 'x' + toN
          });
          lr += dr;
          lc += dc;
        }
      }
    }

    return captures;
  }

  /**
   * Generate non-capturing step/slide moves from (r, c).
   */
  function getStepMovesFromSquare(board, r, c) {
    const piece = board[r][c];
    if (!piece) return [];
    const owner = piece.owner;
    const moves = [];

    if (!piece.king) {
      const forwardDr = owner === 1 ? -1 : 1;
      const dcs = [-1, 1];
      for (let i = 0; i < 2; i++) {
        const tr = r + forwardDr;
        const tc = c + dcs[i];
        if (inBounds(tr, tc) && !board[tr][tc]) {
          const fromN = sqNum(r, c);
          const toN = sqNum(tr, tc);
          moves.push({
            id: 'step:' + r + ',' + c + '->' + tr + ',' + tc,
            from: { r: r, c: c },
            to: { r: tr, c: tc },
            isCapture: false,
            captures: [],
            notation: fromN + '-' + toN
          });
        }
      }
    } else {
      // Flying King slides along all 4 diagonals
      for (let d = 0; d < 4; d++) {
        const dr = DIAGS[d][0];
        const dc = DIAGS[d][1];
        let tr = r + dr;
        let tc = c + dc;
        while (inBounds(tr, tc) && !board[tr][tc]) {
          const fromN = sqNum(r, c);
          const toN = sqNum(tr, tc);
          moves.push({
            id: 'kstep:' + r + ',' + c + '->' + tr + ',' + tc,
            from: { r: r, c: c },
            to: { r: tr, c: tc },
            isCapture: false,
            captures: [],
            notation: 'K' + fromN + '-' + toN
          });
          tr += dr;
          tc += dc;
        }
      }
    }

    return moves;
  }

  function getLegalMoves(state, player) {
    if (!state || state.status !== 'playing') return [];
    const p = player || state.currentPlayer;
    if (p !== state.currentPlayer) return [];

    // If in the middle of a multi-jump chain, only that jumping piece may continue capturing
    const pending = state.pendingCaptures || [];
    if (state.mustContinueFrom) {
      const mr = state.mustContinueFrom.r;
      const mc = state.mustContinueFrom.c;
      const cell = state.board[mr] && state.board[mr][mc];
      if (cell && cell.owner === p) {
        const chainCaps = getCapturesFromSquare(state.board, mr, mc, pending);
        if (chainCaps.length > 0) return filterMajorityJumps(state.board, chainCaps, pending);
      }
    }

    // Collect all captures first (Mandatory Capture rule)
    const allCaptures = [];
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const cell = state.board[r][c];
        if (!cell || cell.owner !== p) continue;
        const caps = getCapturesFromSquare(state.board, r, c, pending);
        for (let i = 0; i < caps.length; i++) {
          allCaptures.push(caps[i]);
        }
      }
    }

    if (allCaptures.length > 0) {
      // FMJD 最多吃子規則：只能選擇吃子數最多的連跳路線
      return filterMajorityJumps(state.board, allCaptures, pending);
    }

    // Otherwise collect normal diagonal moves
    const allSteps = [];
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const cell = state.board[r][c];
        if (!cell || cell.owner !== p) continue;
        const steps = getStepMovesFromSquare(state.board, r, c);
        for (let i = 0; i < steps.length; i++) {
          allSteps.push(steps[i]);
        }
      }
    }

    return allSteps;
  }

  function getMovesForSource(state, source) {
    if (!state || !source || typeof source.r !== 'number' || typeof source.c !== 'number') {
      return [];
    }
    const all = getLegalMoves(state, state.currentPlayer);
    return all.filter(function (m) {
      return m.from && m.from.r === source.r && m.from.c === source.c;
    });
  }

  function canSelectSource(state, source, player) {
    const p = player || state.currentPlayer;
    if (!source || typeof source.r !== 'number' || typeof source.c !== 'number') {
      return { selectable: false, hasMoves: false };
    }
    const cell = state.board[source.r] && state.board[source.r][source.c];
    if (!cell || cell.owner !== p) {
      return { selectable: false, hasMoves: false };
    }

    const moves = getMovesForSource(state, source);
    if (moves.length > 0) {
      const capCount = moves.filter(function (m) {
        return m.isCapture;
      }).length;
      return {
        selectable: true,
        hasMoves: true,
        reasonZh:
          '已選取' +
          (cell.king ? '飛行王棋' : '跳棋') +
          '（#' +
          sqNum(source.r, source.c) +
          '）：可走 ' +
          moves.length +
          ' 格' +
          (capCount > 0 ? '（強制跳吃 ' + capCount + ' 處）' : ''),
        reasonEn:
          'Selected ' +
          (cell.king ? 'Flying King' : 'Checker') +
          ' (#' +
          sqNum(source.r, source.c) +
          '): ' +
          moves.length +
          ' legal destination(s)'
      };
    }

    // Check why this piece has 0 legal moves
    if (state.mustContinueFrom && (state.mustContinueFrom.r !== source.r || state.mustContinueFrom.c !== source.c)) {
      return {
        selectable: true,
        hasMoves: false,
        reasonZh: '連跳進行中：必須繼續操作正在連跳的棋子（#' + sqNum(state.mustContinueFrom.r, state.mustContinueFrom.c) + '）！',
        reasonEn: 'Multi-jump in progress: you must continue jumping with piece #' + sqNum(state.mustContinueFrom.r, state.mustContinueFrom.c) + '!'
      };
    }

    const allLegal = getLegalMoves(state, p);
    if (allLegal.length > 0 && allLegal[0].isCapture) {
      return {
        selectable: true,
        hasMoves: false,
        reasonZh: '國際跳棋「有吃必吃」規則：場上有其他己方棋子可跳吃敵子，必須優先執行跳吃！',
        reasonEn: 'Mandatory Capture Rule: another friendly piece has a capture and must jump!'
      };
    }

    return {
      selectable: true,
      hasMoves: false,
      reasonZh: '此棋子前方斜格已被阻擋，目前無合法走位。',
      reasonEn: 'This piece is blocked along its diagonals.'
    };
  }

  function applyMove(state, rawMove) {
    if (!state || state.status !== 'playing' || !rawMove) return cloneState(state);
    const legal = getLegalMoves(state, state.currentPlayer);
    let move = null;
    for (let i = 0; i < legal.length; i++) {
      if (
        legal[i].id === rawMove.id ||
        (rawMove.from &&
          rawMove.to &&
          legal[i].from.r === rawMove.from.r &&
          legal[i].from.c === rawMove.from.c &&
          legal[i].to.r === rawMove.to.r &&
          legal[i].to.c === rawMove.to.c)
      ) {
        move = legal[i];
        break;
      }
    }
    if (!move) return cloneState(state);

    const next = cloneState(state);
    const mover = state.currentPlayer;
    const opp = opponentOf(mover);
    const fr = move.from.r;
    const fc = move.from.c;
    const tr = move.to.r;
    const tc = move.to.c;

    const movingPiece = next.board[fr][fc];
    if (!movingPiece) return next;

    next.board[tr][tc] = {
      owner: mover,
      king: movingPiece.king
    };
    next.board[fr][fc] = null;

    // FMJD：被吃的子在整串連跳結束前仍留在盤上（不可重複跳過），結束時才一併移除
    if (move.isCapture && Array.isArray(move.captures)) {
      next.pendingCaptures = next.pendingCaptures.concat(move.captures);
    }

    // Check if multi-jump continuation is available from (tr, tc)
    let canContinueJump = false;
    if (move.isCapture) {
      const followUpCaps = getCapturesFromSquare(next.board, tr, tc, next.pendingCaptures);
      if (followUpCaps.length > 0) {
        canContinueJump = true;
      }
    }

    let promoted = false;
    if (canContinueJump) {
      next.mustContinueFrom = { r: tr, c: tc };
      // Same player continues jumping!
    } else {
      next.mustContinueFrom = null;
      for (let i = 0; i < next.pendingCaptures.length; i++) {
        const cap = next.pendingCaptures[i];
        if (next.board[cap.r][cap.c]) {
          next.board[cap.r][cap.c] = null;
          next.capturedCount[mover] = (next.capturedCount[mover] || 0) + 1;
        }
      }
      next.pendingCaptures = [];
      // Promotion to Flying King at the end of the turn on the far row
      const promoRow = mover === 1 ? 0 : ROWS - 1;
      if (!next.board[tr][tc].king && tr === promoRow) {
        next.board[tr][tc].king = true;
        promoted = true;
      }
      next.currentPlayer = opp;
      next.turnNumber = (state.turnNumber || 1) + 1;
    }

    next.moveCount = (state.moveCount || 0) + 1;
    if (move.isCapture || !movingPiece.king) {
      next.quietMoves = 0;
    } else {
      next.quietMoves = (state.quietMoves || 0) + 1;
    }

    let notation = move.notation || sqNum(fr, fc) + (move.isCapture ? 'x' : '-') + sqNum(tr, tc);
    if (promoted) notation += '=K';

    next.lastMove = {
      id: move.id,
      from: { r: fr, c: fc },
      to: { r: tr, c: tc },
      isCapture: Boolean(move.isCapture),
      captures: move.captures || [],
      promote: promoted ? 'K' : null,
      notation: notation,
      player: mover
    };

    // Check terminal conditions when turn passes to opponent
    if (!canContinueJump) {
      const oppMoves = getLegalMoves(next, opp);
      if (oppMoves.length === 0) {
        next.status = 'ended';
        next.winner = mover;
        next.endReason = 'elimination_or_blockade';
      } else if (next.quietMoves >= 50) {
        next.status = 'ended';
        next.winner = 0;
        next.endReason = 'fifty_move_draw';
      }
    }

    return next;
  }

  function evaluate(state, perspectivePlayer) {
    const me = perspectivePlayer || state.currentPlayer;
    const opp = opponentOf(me);

    if (state.status === 'ended') {
      if (state.winner === 0 || state.winner === null) return 0;
      return state.winner === me ? 100000 : -100000;
    }

    let score = 0;
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const cell = state.board[r][c];
        if (!cell) continue;
        let val = cell.king ? 340 : 100;
        if (!cell.king) {
          // Advancement bonus toward promotion row
          const adv = cell.owner === 1 ? 9 - r : r;
          val += adv * 6;
        }
        // Center control bonus (rows 3..6, cols 2..7)
        if (r >= 3 && r <= 6 && c >= 2 && c <= 7) {
          val += 12;
        }
        // Edge safety bonus for men
        if (c === 0 || c === 9) {
          val += 5;
        }
        if (cell.owner === me) score += val;
        else score -= val;
      }
    }

    return score;
  }

  BoardArena.registerRule('draughts', {
    id: 'draughts',
    selectionMode: 'piece',
    rows: ROWS,
    cols: COLS,
    sideLabels: SIDE_LABELS,
    createInitialState: createInitialState,
    cloneState: cloneState,
    getLegalMoves: getLegalMoves,
    getMovesForSource: getMovesForSource,
    canSelectSource: canSelectSource,
    applyMove: applyMove,
    evaluate: evaluate
  });
})(typeof window !== 'undefined' ? window : globalThis);
