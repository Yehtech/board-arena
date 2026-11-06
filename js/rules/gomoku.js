// ============================================
// Date: 2026-11-06
// Version: v1.2.0
// Changes: Selection reasons returned as language-neutral messages
// 修改: 選子提示改回傳語言中立的訊息
// ============================================
/**
 * Classic Board Arena — Gomoku 15x15 Rule Engine
 * Supports standard 5-in-a-row (5+ contiguous) and Three-Move Swap (Pie Rule, default true),
 * neighbor/tactical move ordering, and 4-axis threat pattern evaluation.
 */
(function (global) {
  'use strict';

  const BoardArena = (global.BoardArena = global.BoardArena || {});
  const msg = BoardArena.msg;

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

  function inBounds(r, c) {
    return r >= 0 && r < SIZE && c >= 0 && c < SIZE;
  }

  /**
   * High-speed 4-Axis Gomoku/Renju Pattern Classifier at empty point (r, c) for `player`.
   * Classifies what shapes placing a stone of `player` at (r, c) creates across all 4 axes:
   *   - fives:      5+ contiguous stones (Immediate Victory)
   *   - liveFours:  .XXXX. (4 stones with 2 open ends, or double-gap 4 on same line)
   *   - rushFours:  OXXXX. or XXX.X or XX.XX (1 empty completion square to make 5)
   *   - liveThrees: .XXX. (with >=6 corridor) or .XX.X. / .X.XX. (broken open three)
   *   - sleepThrees: OXXX.. or OXX.X. (blocked on one side, can still make Rush Four)
   *   - liveTwos:   ..XX.. or .X.X. (open two with development room)
   *   - sleepTwos:  OXX...
   */
  function analyzePointFourAxes(board, r, c, player) {
    let fives = 0;
    let liveFours = 0;
    let rushFours = 0;
    let liveThrees = 0;
    let sleepThrees = 0;
    let liveTwos = 0;
    let sleepTwos = 0;

    for (let a = 0; a < 4; a++) {
      const dr = AXES[a][0];
      const dc = AXES[a][1];

      // Check maximum unblocked corridor (up to 4 cells in each direction not occupied by opponent)
      let room1 = 0;
      let tr = r + dr;
      let tc = c + dc;
      while (room1 < 4 && inBounds(tr, tc) && (board[tr][tc] === 0 || board[tr][tc] === player)) {
        room1++;
        tr += dr;
        tc += dc;
      }
      let room2 = 0;
      tr = r - dr;
      tc = c - dc;
      while (room2 < 4 && inBounds(tr, tc) && (board[tr][tc] === 0 || board[tr][tc] === player)) {
        room2++;
        tr -= dr;
        tc -= dc;
      }
      if (1 + room1 + room2 < 5) continue;

      // Positive direction (+dr, +dc)
      let c1 = 0;
      let nr = r + dr;
      let nc = c + dc;
      while (inBounds(nr, nc) && board[nr][nc] === player) {
        c1++;
        nr += dr;
        nc += dc;
      }
      let open1 = false;
      let ext1 = 0;
      let open1Far = false;
      if (inBounds(nr, nc) && board[nr][nc] === 0) {
        open1 = true;
        let er = nr + dr;
        let ec = nc + dc;
        while (inBounds(er, ec) && board[er][ec] === player) {
          ext1++;
          er += dr;
          ec += dc;
        }
        if (inBounds(er, ec) && board[er][ec] === 0) {
          open1Far = true;
        }
      }

      // Negative direction (-dr, -dc)
      let c2 = 0;
      nr = r - dr;
      nc = c - dc;
      while (inBounds(nr, nc) && board[nr][nc] === player) {
        c2++;
        nr -= dr;
        nc -= dc;
      }
      let open2 = false;
      let ext2 = 0;
      let open2Far = false;
      if (inBounds(nr, nc) && board[nr][nc] === 0) {
        open2 = true;
        let er = nr - dr;
        let ec = nc - dc;
        while (inBounds(er, ec) && board[er][ec] === player) {
          ext2++;
          er -= dr;
          ec -= dc;
        }
        if (inBounds(er, ec) && board[er][ec] === 0) {
          open2Far = true;
        }
      }

      const contig = 1 + c1 + c2;
      const total1 = open1 ? contig + ext1 : contig;
      const total2 = open2 ? contig + ext2 : contig;

      if (contig >= 5) {
        fives++;
      } else if (contig === 4) {
        if (open1 && open2) liveFours++;
        else if (open1 || open2) rushFours++;
      } else if (total1 >= 4 || total2 >= 4) {
        if (total1 >= 4 && total2 >= 4) liveFours++;
        else rushFours++;
      } else if (contig === 3) {
        if (open1 && open2) {
          if (open1Far || open2Far || ext1 > 0 || ext2 > 0) liveThrees++;
          else sleepThrees++;
        } else if (open1 || open2) {
          sleepThrees++;
        }
      } else if (total1 === 3 || total2 === 3) {
        if ((total1 === 3 && open1 && open2 && open1Far) || (total2 === 3 && open2 && open1 && open2Far)) {
          liveThrees++;
        } else {
          sleepThrees++;
        }
      } else if (contig === 2) {
        if (open1 && open2 && (open1Far || open2Far)) liveTwos++;
        else if (open1 || open2) sleepTwos++;
      } else if ((total1 === 2 && open1 && open2 && open1Far) || (total2 === 2 && open2 && open1 && open2Far)) {
        liveTwos++;
      }
    }

    return {
      fives: fives,
      liveFours: liveFours,
      rushFours: rushFours,
      liveThrees: liveThrees,
      sleepThrees: sleepThrees,
      liveTwos: liveTwos,
      sleepTwos: sleepTwos,
      five: fives,
      openFour: liveFours,
      halfFour: rushFours,
      openThree: liveThrees,
      openTwo: liveTwos
    };
  }

  function hasNearbyStone(board, r, c, radius) {
    const rad = radius || 2;
    const rMin = r > rad ? r - rad : 0;
    const rMax = r + rad < SIZE ? r + rad : SIZE - 1;
    const cMin = c > rad ? c - rad : 0;
    const cMax = c + rad < SIZE ? c + rad : SIZE - 1;
    for (let nr = rMin; nr <= rMax; nr++) {
      const row = board[nr];
      for (let nc = cMin; nc <= cMax; nc++) {
        if (row[nc] !== 0) return true;
      }
    }
    return false;
  }

  function scorePointThreatObj(t, isAttack) {
    if (t.fives >= 1) return isAttack ? 1000000 : 900000;
    if (t.liveFours >= 1 || t.rushFours >= 2) return isAttack ? 450000 : 380000;
    if (t.rushFours >= 1 && t.liveThrees >= 1) return isAttack ? 320000 : 280000;
    if (t.liveThrees >= 2) return isAttack ? 180000 : 160000;

    let s = 0;
    if (t.rushFours === 1) {
      s += (isAttack ? 18000 : 15000) + t.sleepThrees * 4500 + t.liveTwos * 3200;
    }
    if (t.liveThrees === 1) {
      s += (isAttack ? 15000 : 13500) + t.sleepThrees * 3500 + t.liveTwos * 2800;
    }
    if (t.liveTwos >= 2) {
      s += (isAttack ? 5200 : 4600) + (t.liveTwos - 2) * 1800;
    } else if (t.liveTwos === 1) {
      s += (isAttack ? 950 : 820) + t.sleepThrees * 900;
    }
    s += t.sleepThrees * (isAttack ? 780 : 650) + t.sleepTwos * 95;
    return s;
  }

  // Quick local run-length & fork check at empty (r, c) for tactical move ordering
  function quickPointTacticalScore(board, r, c, player, opp) {
    const enemy = opp || (player === 1 ? 2 : 1);
    const myT = analyzePointFourAxes(board, r, c, player);
    const opT = analyzePointFourAxes(board, r, c, enemy);
    return scorePointThreatObj(myT, true) + scorePointThreatObj(opT, false);
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

  // Score one directional ray starting at (sr, sc) with step (dr, dc), updating scores[1] and scores[2] and threats[1]/[2]
  function scoreLinePatterns(board, sr, sc, dr, dc, scores, threats) {
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
        scores[cell] += 200000;
        threats[cell].five++;
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
            scores[cell] += 5200;
            threats[cell].halfFour++;
            splitHandled = true;
          } else if (combined === 3) {
            if (openLeft && farRightOpen) {
              scores[cell] += 3600;
              threats[cell].openThree++;
              splitHandled = true;
            } else if (openLeft || farRightOpen) {
              scores[cell] += 420;
              threats[cell].sleepThree++;
              splitHandled = true;
            }
          }
        }

        if (!splitHandled) {
          if (runLen === 4) {
            if (openEnds === 2) {
              scores[cell] += 45000;
              threats[cell].openFour++;
            } else if (openEnds === 1) {
              scores[cell] += 5500;
              threats[cell].halfFour++;
            }
          } else if (runLen === 3) {
            if (openEnds === 2) {
              const leftOpen2 = i >= 2 && board[sr + (i - 2) * dr][sc + (i - 2) * dc] === 0;
              const rightOpen2 = j + 2 < len && board[sr + (j + 2) * dr][sc + (j + 2) * dc] === 0;
              if (leftOpen2 || rightOpen2) {
                scores[cell] += 4200;
                threats[cell].openThree++;
              } else {
                scores[cell] += 650;
                threats[cell].sleepThree++;
              }
            } else if (openEnds === 1) {
              scores[cell] += 450;
              threats[cell].sleepThree++;
            }
          } else if (runLen === 2) {
            if (openEnds === 2) {
              scores[cell] += 260;
              threats[cell].openTwo++;
            } else if (openEnds === 1) {
              scores[cell] += 35;
            }
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
    const threats = {
      1: { five: 0, openFour: 0, halfFour: 0, openThree: 0, sleepThree: 0, openTwo: 0 },
      2: { five: 0, openFour: 0, halfFour: 0, openThree: 0, sleepThree: 0, openTwo: 0 }
    };

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
      scoreLinePatterns(board, r, 0, 0, 1, scores, threats);
    }
    // 2. Vertical lines (dr=1, dc=0)
    for (let c = 0; c < SIZE; c++) {
      scoreLinePatterns(board, 0, c, 1, 0, scores, threats);
    }
    // 3. Main diagonals (dr=1, dc=1)
    for (let c = 0; c <= SIZE - 5; c++) {
      scoreLinePatterns(board, 0, c, 1, 1, scores, threats);
    }
    for (let r = 1; r <= SIZE - 5; r++) {
      scoreLinePatterns(board, r, 0, 1, 1, scores, threats);
    }
    // 4. Anti-diagonals (dr=1, dc=-1)
    for (let c = 4; c < SIZE; c++) {
      scoreLinePatterns(board, 0, c, 1, -1, scores, threats);
    }
    for (let r = 1; r <= SIZE - 5; r++) {
      scoreLinePatterns(board, r, SIZE - 1, 1, -1, scores, threats);
    }

    if (threats[me].five > 0 || scores[me] >= 180000) return 100000;
    if (threats[opp].five > 0 || scores[opp] >= 180000) return -100000;

    // Turn-aware lethal tactical patterns
    const toMove = state.currentPlayer;
    for (let p = 1; p <= 2; p++) {
      const t = threats[p];
      const other = threats[p === 1 ? 2 : 1];
      if (p === toMove) {
        // Side to move has a four -> wins immediately on this turn!
        if (t.openFour > 0 || t.halfFour > 0) {
          scores[p] += 88000;
        } else if (t.openThree > 0 && other.openFour === 0 && other.halfFour === 0) {
          // Side to move has an open three and opponent has no four -> creates unstoppable open four!
          scores[p] += 36000 + (t.openThree - 1) * 10000;
        }
      } else {
        // Side NOT to move still has unblocked lethal threats
        if (t.openFour > 0 && other.openFour === 0 && other.halfFour === 0) {
          scores[p] += 68000;
        } else if (t.halfFour >= 2 && other.openFour === 0 && other.halfFour === 0) {
          scores[p] += 55000;
        } else if (t.halfFour >= 1 && t.openThree >= 1 && other.openFour === 0 && other.halfFour === 0) {
          scores[p] += 42000;
        } else if (t.openThree >= 2 && other.openFour === 0 && other.halfFour === 0) {
          scores[p] += 28000;
        }
      }
    }

    // 對手分數權重（>1 偏防守）。可由 BoardArena.TUNING.gomokuDefenseWeight 調整，供棋力實驗使用
    const defenseWeight =
      BoardArena.TUNING && typeof BoardArena.TUNING.gomokuDefenseWeight === 'number' ? BoardArena.TUNING.gomokuDefenseWeight : 1.12;
    const diff = scores[me] - scores[opp] * defenseWeight;
    if (diff > 99000) return 99000;
    if (diff < -99000) return -99000;
    return Math.round(diff);
  }

  function getCandidateMoves(state, player, maxBranch) {
    if (!state || state.status === 'ended') return [];
    const p = player || state.currentPlayer;
    if (state.swapOffered && p === 2) {
      return getLegalMoves(state, p);
    }
    const board = state.board;
    if (state.stoneCount === 0) {
      return [
        {
          id: 'r7c7',
          action: null,
          from: null,
          to: { r: 7, c: 7 },
          isCapture: false,
          notation: 'H8',
          priority: 1000
        }
      ];
    }

    const candidates = [];
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        if (board[r][c] !== 0) continue;
        if (!hasNearbyStone(board, r, c, 2)) continue;
        const prio = quickPointTacticalScore(board, r, c, p);
        candidates.push({
          id: 'r' + r + 'c' + c,
          action: null,
          from: null,
          to: { r: r, c: c },
          isCapture: false,
          notation: COL_LABELS[c] + (SIZE - r),
          priority: prio
        });
      }
    }
    candidates.sort(function (a, b) {
      return b.priority - a.priority;
    });
    const limit = maxBranch || 18;
    return candidates.length > limit ? candidates.slice(0, limit) : candidates;
  }

  function canSelectSource(state, source) {
    if (!state || state.status === 'ended') {
      return { ok: false, selectable: false, hasMoves: false, moves: [], reason: msg('rule.gameEnded') };
    }
    if (!source || typeof source.r !== 'number' || typeof source.c !== 'number') {
      return { ok: false, selectable: false, hasMoves: false, moves: [], reason: msg('rule.clickEmptyPoint') };
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
      return { ok: true, selectable: true, hasMoves: true, moves: [m] };
    }
    return {
      ok: false,
      selectable: false,
      hasMoves: false,
      moves: [],
      reason: msg('rule.occupied')
    };
  }

  BoardArena.registerRule('gomoku', {
    id: 'gomoku',
    selectionMode: 'drop',
    rows: SIZE,
    cols: SIZE,
    starPoints: STAR_POINTS,
    sideLabels: { 1: 'side.black', 2: 'side.white' },
    createInitialState: createInitialState,
    cloneState: cloneState,
    getLegalMoves: getLegalMoves,
    getCandidateMoves: getCandidateMoves,
    analyzePointFourAxes: analyzePointFourAxes,
    quickPointTacticalScore: quickPointTacticalScore,
    canSelectSource: canSelectSource,
    applyMove: applyMove,
    evaluate: evaluate
  });
})(typeof window !== 'undefined' ? window : globalThis);
