/**
 * Classic Board Arena — Go / Weiqi (9x9, 13x13, 19x19) Rule Engine
 * Full rules: BFS group & liberty analysis, captures, suicide prohibition,
 * Positional Ko (boardHistoryHashes + koPoint), forbiddenPoints for UI '✕' markers,
 * consecutive pass -> dead-stone toggle confirmation & Chinese Area Scoring (komi 5.5 / 7.5).
 */
(function (global) {
  'use strict';

  const BoardArena = (global.BoardArena = global.BoardArena || {});

  // Standard Go column coordinates (omits 'I')
  const GO_COLS = 'ABCDEFGHJKLMNOPQRST';
  const ORTHO = [
    [-1, 0],
    [1, 0],
    [0, -1],
    [0, 1]
  ];

  function normalizeSize(options) {
    const raw = options && Number(options.boardSize || options.size);
    if (raw === 9 || raw === 13 || raw === 19) return raw;
    return 19;
  }

  function getStarPoints(size) {
    if (size === 9) {
      return [
        { r: 2, c: 2 }, { r: 2, c: 6 },
        { r: 4, c: 4 },
        { r: 6, c: 2 }, { r: 6, c: 6 }
      ];
    }
    if (size === 13) {
      return [
        { r: 3, c: 3 }, { r: 3, c: 6 }, { r: 3, c: 9 },
        { r: 6, c: 3 }, { r: 6, c: 6 }, { r: 6, c: 9 },
        { r: 9, c: 3 }, { r: 9, c: 6 }, { r: 9, c: 9 }
      ];
    }
    const pts = [];
    const coords = [3, 9, 15];
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) {
        pts.push({ r: coords[i], c: coords[j] });
      }
    }
    return pts;
  }

  function createEmptyBoard(size) {
    const b = new Array(size);
    for (let r = 0; r < size; r++) {
      const row = new Array(size);
      for (let c = 0; c < size; c++) row[c] = 0;
      b[r] = row;
    }
    return b;
  }

  function cloneBoard(board, size) {
    const out = new Array(size);
    for (let r = 0; r < size; r++) {
      out[r] = board[r].slice();
    }
    return out;
  }

  function boardToHash(board, size) {
    const parts = new Array(size);
    for (let r = 0; r < size; r++) {
      parts[r] = board[r].join('');
    }
    return parts.join('');
  }

  function cloneDeadStones(deadStones) {
    const out = {};
    if (!deadStones) return out;
    const keys = Object.keys(deadStones);
    for (let i = 0; i < keys.length; i++) {
      if (deadStones[keys[i]]) out[keys[i]] = true;
    }
    return out;
  }

  function cloneState(state) {
    const size = state.size;
    return {
      gameId: 'go',
      size: size,
      rows: size,
      cols: size,
      komi: state.komi,
      options: {
        boardSize: size,
        autoFinishScoring: Boolean(state.options && state.options.autoFinishScoring)
      },
      board: cloneBoard(state.board, size),
      captures: { 1: state.captures[1] || 0, 2: state.captures[2] || 0 },
      koPoint: state.koPoint ? { r: state.koPoint.r, c: state.koPoint.c } : null,
      consecutivePasses: state.consecutivePasses || 0,
      boardHistoryHashes: state.boardHistoryHashes ? state.boardHistoryHashes.slice() : [],
      deadStones: cloneDeadStones(state.deadStones),
      scoreSummary: state.scoreSummary ? Object.assign({}, state.scoreSummary) : null,
      forbiddenPoints: state.forbiddenPoints
        ? state.forbiddenPoints.map(function (fp) {
            return { r: fp.r, c: fp.c, reason: fp.reason };
          })
        : [],
      currentPlayer: state.currentPlayer,
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
            isCapture: Boolean(state.lastMove.isCapture),
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

  /**
   * BFS group & liberty analysis across the whole board in O(size^2).
   */
  function analyzeGroups(board, size) {
    const total = size * size;
    const groupIdAt = new Int16Array(total);
    for (let i = 0; i < total; i++) groupIdAt[i] = -1;

    const libStamp = new Int16Array(total);
    let stampCounter = 1;
    const groups = [];
    const queueR = new Int16Array(total);
    const queueC = new Int16Array(total);

    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        const color = board[r][c];
        const startIdx = r * size + c;
        if (color === 0 || groupIdAt[startIdx] !== -1) continue;

        const gid = groups.length;
        const stones = [];
        let liberties = 0;
        const curStamp = stampCounter++;

        let head = 0;
        let tail = 0;
        queueR[tail] = r;
        queueC[tail] = c;
        tail++;
        groupIdAt[startIdx] = gid;

        while (head < tail) {
          const cr = queueR[head];
          const cc = queueC[head];
          head++;
          stones.push({ r: cr, c: cc });

          for (let d = 0; d < 4; d++) {
            const nr = cr + ORTHO[d][0];
            const nc = cc + ORTHO[d][1];
            if (nr < 0 || nr >= size || nc < 0 || nc >= size) continue;
            const nIdx = nr * size + nc;
            const nColor = board[nr][nc];
            if (nColor === 0) {
              if (libStamp[nIdx] !== curStamp) {
                libStamp[nIdx] = curStamp;
                liberties++;
              }
            } else if (nColor === color && groupIdAt[nIdx] === -1) {
              groupIdAt[nIdx] = gid;
              queueR[tail] = nr;
              queueC[tail] = nc;
              tail++;
            }
          }
        }

        groups.push({
          id: gid,
          color: color,
          stones: stones,
          libertyCount: liberties
        });
      }
    }

    return { groupIdAt: groupIdAt, groups: groups };
  }

  /**
   * BFS single group & liberty count starting from (sr, sc).
   */
  function getSingleGroup(board, size, sr, sc) {
    const color = board[sr][sc];
    if (!color) return { color: 0, stones: [], libertyCount: 0 };
    const total = size * size;
    const visited = new Uint8Array(total);
    const libSeen = new Uint8Array(total);
    const stones = [];
    let liberties = 0;
    const queue = [{ r: sr, c: sc }];
    visited[sr * size + sc] = 1;

    for (let head = 0; head < queue.length; head++) {
      const cur = queue[head];
      stones.push(cur);
      for (let d = 0; d < 4; d++) {
        const nr = cur.r + ORTHO[d][0];
        const nc = cur.c + ORTHO[d][1];
        if (nr < 0 || nr >= size || nc < 0 || nc >= size) continue;
        const idx = nr * size + nc;
        const ncVal = board[nr][nc];
        if (ncVal === 0) {
          if (!libSeen[idx]) {
            libSeen[idx] = 1;
            liberties++;
          }
        } else if (ncVal === color && !visited[idx]) {
          visited[idx] = 1;
          queue.push({ r: nr, c: nc });
        }
      }
    }

    return { color: color, stones: stones, libertyCount: liberties };
  }

  /**
   * Classifies every empty intersection for `player` into legal moves and forbidden points ('ko' | 'suicide').
   */
  function scanBoardForPlayer(state, player) {
    const size = state.size;
    const board = state.board;
    const opp = player === 1 ? 2 : 1;
    const analysis = analyzeGroups(board, size);
    const groupIdAt = analysis.groupIdAt;
    const groups = analysis.groups;

    const baseHash = boardToHash(board, size);
    const historyArr = state.boardHistoryHashes || [];
    const historySet = new Set(historyArr);
    const anyPastCaptures = (state.captures[1] || 0) + (state.captures[2] || 0) > 0;
    const pChar = player === 1 ? '1' : '2';

    const legal = [];
    const forbidden = [];

    for (let r = 0; r < size; r++) {
      const row = board[r];
      for (let c = 0; c < size; c++) {
        if (row[c] !== 0) continue;

        let emptyNeighbors = 0;
        let hasMultiLibFriend = false;
        let savesAtariCount = 0;
        let putsOppInAtariCount = 0;
        const capGroupIds = [];
        const friendGroupIds = [];

        for (let d = 0; d < 4; d++) {
          const nr = r + ORTHO[d][0];
          const nc = c + ORTHO[d][1];
          if (nr < 0 || nr >= size || nc < 0 || nc >= size) continue;
          const nVal = board[nr][nc];
          if (nVal === 0) {
            emptyNeighbors++;
          } else {
            const gid = groupIdAt[nr * size + nc];
            const grp = groups[gid];
            if (nVal === opp) {
              if (grp.libertyCount === 1) {
                if (capGroupIds.indexOf(gid) === -1) capGroupIds.push(gid);
              } else if (grp.libertyCount === 2) {
                putsOppInAtariCount += grp.stones.length;
              }
            } else {
              if (friendGroupIds.indexOf(gid) === -1) {
                friendGroupIds.push(gid);
                if (grp.libertyCount >= 2) {
                  hasMultiLibFriend = true;
                } else if (grp.libertyCount === 1) {
                  savesAtariCount += grp.stones.length;
                }
              }
            }
          }
        }

        if (capGroupIds.length === 0) {
          // No enemy stones removed: check suicide
          if (emptyNeighbors === 0 && !hasMultiLibFriend) {
            forbidden.push({ r: r, c: c, reason: 'suicide' });
            continue;
          }

          // Check Positional Ko if possible
          if (state.koPoint && state.koPoint.r === r && state.koPoint.c === c) {
            forbidden.push({ r: r, c: c, reason: 'ko' });
            continue;
          }
          if (anyPastCaptures && historySet.size > 0) {
            const posIdx = r * size + c;
            const nextHash = baseHash.slice(0, posIdx) + pChar + baseHash.slice(posIdx + 1);
            if (historySet.has(nextHash)) {
              forbidden.push({ r: r, c: c, reason: 'ko' });
              continue;
            }
          }

          // Check if filling own single-point eye (deprioritize in AI move ordering, still legal)
          let likelyOwnEye = false;
          if (emptyNeighbors === 0 && friendGroupIds.length > 0 && capGroupIds.length === 0) {
            let allOrthoFriendSafe = true;
            for (let f = 0; f < friendGroupIds.length; f++) {
              if (groups[friendGroupIds[f]].libertyCount < 2) {
                allOrthoFriendSafe = false;
                break;
              }
            }
            if (allOrthoFriendSafe) {
              let diagTotal = 0;
              let diagOpp = 0;
              for (let dr = -1; dr <= 1; dr += 2) {
                for (let dc = -1; dc <= 1; dc += 2) {
                  const drr = r + dr;
                  const dcc = c + dc;
                  if (drr >= 0 && drr < size && dcc >= 0 && dcc < size) {
                    diagTotal++;
                    if (board[drr][dcc] === opp) diagOpp++;
                  }
                }
              }
              if ((diagTotal === 4 && diagOpp <= 1) || (diagTotal < 4 && diagOpp === 0)) {
                likelyOwnEye = true;
              }
            }
          }

          // Penalize self-atari (moving into 1 liberty without capturing)
          let isSelfAtari = false;
          if (emptyNeighbors === 0 && !hasMultiLibFriend) {
            isSelfAtari = true;
          } else if (emptyNeighbors === 1 && friendGroupIds.length === 0) {
            isSelfAtari = true;
          }

          let priority = 0;
          if (likelyOwnEye) {
            priority = -500;
          } else if (isSelfAtari) {
            priority = -320;
          } else {
            if (savesAtariCount > 0 && (emptyNeighbors >= 2 || hasMultiLibFriend)) {
              priority += 350 + savesAtariCount * 60;
            }
            if (putsOppInAtariCount > 0) {
              priority += 180 + putsOppInAtariCount * 35;
            }
            const edgeDistR = Math.min(r, size - 1 - r);
            const edgeDistC = Math.min(c, size - 1 - c);
            const minEdge = Math.min(edgeDistR, edgeDistC);
            if (minEdge === 2 || minEdge === 3) priority += 28;
            else if (minEdge === 0) priority -= 18;
            priority += (4 - emptyNeighbors) * 12;
          }

          legal.push({
            priority: priority,
            move: {
              id: 'r' + r + 'c' + c,
              from: null,
              to: { r: r, c: c },
              isCapture: false,
              captures: [],
              priority: priority,
              likelyOwnEye: likelyOwnEye,
              isSelfAtari: isSelfAtari,
              notation: GO_COLS[c] + (size - r)
            }
          });
        } else {
          // Captures >= 1 opponent group -> never suicide; check Positional Ko
          const captures = [];
          const chars = baseHash.split('');
          chars[r * size + c] = pChar;
          for (let g = 0; g < capGroupIds.length; g++) {
            const cStones = groups[capGroupIds[g]].stones;
            for (let s = 0; s < cStones.length; s++) {
              const st = cStones[s];
              captures.push({ r: st.r, c: st.c });
              chars[st.r * size + st.c] = '0';
            }
          }
          const nextHash = chars.join('');
          if (
            (state.koPoint && state.koPoint.r === r && state.koPoint.c === c && historySet.has(nextHash)) ||
            historySet.has(nextHash)
          ) {
            forbidden.push({ r: r, c: c, reason: 'ko' });
            continue;
          }

          const priority = 600 + captures.length * 140 + savesAtariCount * 50;
          legal.push({
            priority: priority,
            move: {
              id: 'r' + r + 'c' + c,
              from: null,
              to: { r: r, c: c },
              isCapture: true,
              captures: captures,
              priority: priority,
              notation: GO_COLS[c] + (size - r)
            }
          });
        }
      }
    }

    legal.sort(function (a, b) {
      if (b.priority !== a.priority) return b.priority - a.priority;
      if (a.move.to.r !== b.move.to.r) return a.move.to.r - b.move.to.r;
      return a.move.to.c - b.move.to.c;
    });

    const orderedMoves = new Array(legal.length);
    for (let i = 0; i < legal.length; i++) {
      orderedMoves[i] = legal[i].move;
    }

    return { moves: orderedMoves, forbiddenPoints: forbidden };
  }

  /**
   * Chinese Area Scoring:
   * Alive stones on board + orthogonally enclosed empty intersections + komi for White.
   */
  function computeAreaScore(state) {
    const size = state.size;
    const dead = state.deadStones || {};
    const eff = createEmptyBoard(size);

    let blackStones = 0;
    let whiteStones = 0;
    let deadBlack = 0;
    let deadWhite = 0;

    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        const v = state.board[r][c];
        if (v === 0) continue;
        if (dead[r + ',' + c]) {
          if (v === 1) deadBlack++;
          else if (v === 2) deadWhite++;
          eff[r][c] = 0;
        } else {
          eff[r][c] = v;
          if (v === 1) blackStones++;
          else if (v === 2) whiteStones++;
        }
      }
    }

    let blackTerritory = 0;
    let whiteTerritory = 0;
    let neutralPoints = 0;
    const visited = new Uint8Array(size * size);
    const queue = [];

    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        const startIdx = r * size + c;
        if (eff[r][c] !== 0 || visited[startIdx]) continue;

        queue.length = 0;
        queue.push({ r: r, c: c });
        visited[startIdx] = 1;
        let touchesBlack = false;
        let touchesWhite = false;

        for (let head = 0; head < queue.length; head++) {
          const cur = queue[head];
          for (let d = 0; d < 4; d++) {
            const nr = cur.r + ORTHO[d][0];
            const nc = cur.c + ORTHO[d][1];
            if (nr < 0 || nr >= size || nc < 0 || nc >= size) continue;
            const nv = eff[nr][nc];
            if (nv === 0) {
              const nIdx = nr * size + nc;
              if (!visited[nIdx]) {
                visited[nIdx] = 1;
                queue.push({ r: nr, c: nc });
              }
            } else if (nv === 1) {
              touchesBlack = true;
            } else if (nv === 2) {
              touchesWhite = true;
            }
          }
        }

        const regionSize = queue.length;
        if (touchesBlack && !touchesWhite) {
          blackTerritory += regionSize;
        } else if (touchesWhite && !touchesBlack) {
          whiteTerritory += regionSize;
        } else {
          neutralPoints += regionSize;
        }
      }
    }

    const komi = typeof state.komi === 'number' ? state.komi : size === 9 ? 5.5 : 7.5;
    const blackArea = blackStones + blackTerritory;
    const whiteArea = whiteStones + whiteTerritory;
    const whiteTotal = whiteArea + komi;
    const diff = Number((blackArea - whiteTotal).toFixed(1));

    return {
      blackStones: blackStones,
      whiteStones: whiteStones,
      blackTerritory: blackTerritory,
      whiteTerritory: whiteTerritory,
      neutralPoints: neutralPoints,
      deadCount: { 1: deadBlack, 2: deadWhite },
      blackArea: blackArea,
      whiteArea: whiteArea,
      whiteTotal: whiteTotal,
      komi: komi,
      diff: diff,
      winner: diff > 0 ? 1 : diff < 0 ? 2 : 0
    };
  }

  function createInitialState(options) {
    const size = normalizeSize(options);
    const komi = options && typeof options.komi === 'number' ? options.komi : size === 9 ? 5.5 : 7.5;
    const board = createEmptyBoard(size);
    const initialHash = boardToHash(board, size);

    return {
      gameId: 'go',
      size: size,
      rows: size,
      cols: size,
      komi: komi,
      options: {
        boardSize: size,
        autoFinishScoring: Boolean(options && options.autoFinishScoring)
      },
      board: board,
      captures: { 1: 0, 2: 0 },
      koPoint: null,
      consecutivePasses: 0,
      boardHistoryHashes: [initialHash],
      deadStones: {},
      scoreSummary: null,
      forbiddenPoints: [],
      currentPlayer: 1,
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

    if (state.status === 'scoring') {
      const scoringMoves = [
        {
          id: 'confirm_score',
          action: 'confirm_score',
          from: null,
          to: null,
          isCapture: false,
          notation: 'Confirm'
        }
      ];
      const size = state.size;
      for (let r = 0; r < size; r++) {
        for (let c = 0; c < size; c++) {
          if (state.board[r][c] !== 0) {
            scoringMoves.push({
              id: 'toggle_dead:' + r + ',' + c,
              action: 'toggle_dead',
              from: null,
              to: { r: r, c: c },
              isCapture: false,
              notation: 'Dead ' + GO_COLS[c] + (size - r)
            });
          }
        }
      }
      return scoringMoves;
    }

    const p = player || state.currentPlayer;
    const scanned = scanBoardForPlayer(state, p);
    scanned.moves.push({
      id: 'pass',
      action: 'pass',
      from: null,
      to: null,
      isCapture: false,
      notation: 'Pass'
    });
    return scanned.moves;
  }

  function applyMove(state, move) {
    if (!state || state.status === 'ended') {
      throw new Error('Cannot apply move to an ended Go game.');
    }
    if (!move) {
      throw new Error('Missing Go move.');
    }

    const size = state.size;
    const player = state.currentPlayer;
    const opponent = player === 1 ? 2 : 1;

    // Scoring phase actions (confirm_score & toggle_dead)
    if (
      move.action === 'confirm_score' ||
      move.id === 'confirm_score'
    ) {
      const next = cloneState(state);
      const summary = computeAreaScore(next);
      next.scoreSummary = summary;
      next.status = 'ended';
      next.winner = summary.winner;
      next.endReason = 'area_score';
      next.forbiddenPoints = [];
      next.lastMove = {
        id: 'confirm_score',
        action: 'confirm_score',
        from: null,
        to: null,
        isCapture: false,
        captures: [],
        notation: 'Confirm',
        player: player
      };
      return next;
    }

    if (
      state.status === 'scoring' &&
      (move.action === 'toggle_dead' ||
        (typeof move.id === 'string' && move.id.indexOf('toggle_dead:') === 0))
    ) {
      let tr = -1;
      let tc = -1;
      if (move.to && typeof move.to.r === 'number' && typeof move.to.c === 'number') {
        tr = move.to.r;
        tc = move.to.c;
      } else if (typeof move.id === 'string') {
        const parts = move.id.slice('toggle_dead:'.length).split(',');
        if (parts.length === 2) {
          tr = Number(parts[0]);
          tc = Number(parts[1]);
        }
      }
      if (tr < 0 || tr >= size || tc < 0 || tc >= size || state.board[tr][tc] === 0) {
        throw new Error('Invalid dead-stone toggle coordinate.');
      }

      const next = cloneState(state);
      const chain = getSingleGroup(next.board, size, tr, tc);
      const wasDead = Boolean(next.deadStones[tr + ',' + tc]);
      for (let i = 0; i < chain.stones.length; i++) {
        const key = chain.stones[i].r + ',' + chain.stones[i].c;
        if (wasDead) {
          delete next.deadStones[key];
        } else {
          next.deadStones[key] = true;
        }
      }
      next.scoreSummary = computeAreaScore(next);
      return next;
    }

    if (state.status !== 'playing') {
      throw new Error('Go game is currently in scoring mode.');
    }

    // Pass move
    if (move.action === 'pass' || move.id === 'pass') {
      const next = cloneState(state);
      next.consecutivePasses = (state.consecutivePasses || 0) + 1;
      next.koPoint = null;
      next.currentPlayer = opponent;
      next.turnNumber = state.turnNumber + 1;
      next.lastMove = {
        id: 'pass',
        action: 'pass',
        from: null,
        to: null,
        isCapture: false,
        captures: [],
        notation: 'Pass',
        player: player
      };
      next.moveHistory.push('Pass');

      if (next.consecutivePasses >= 2) {
        next.deadStones = {};
        const summary = computeAreaScore(next);
        next.scoreSummary = summary;
        next.forbiddenPoints = [];
        if (next.options && next.options.autoFinishScoring) {
          next.status = 'ended';
          next.winner = summary.winner;
          next.endReason = 'area_score';
        } else {
          next.status = 'scoring';
        }
      } else {
        next.forbiddenPoints = scanBoardForPlayer(next, opponent).forbiddenPoints;
      }

      return next;
    }

    // Stone placement
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

    if (tr < 0 || tr >= size || tc < 0 || tc >= size || state.board[tr][tc] !== 0) {
      throw new Error('Illegal Go stone placement: occupied or out of bounds.');
    }

    const next = cloneState(state);
    const board = next.board;
    board[tr][tc] = player;

    // Remove adjacent opponent groups reduced to 0 liberties
    const capturedStones = [];
    for (let d = 0; d < 4; d++) {
      const nr = tr + ORTHO[d][0];
      const nc = tc + ORTHO[d][1];
      if (nr < 0 || nr >= size || nc < 0 || nc >= size) continue;
      if (board[nr][nc] === opponent) {
        const oppGroup = getSingleGroup(board, size, nr, nc);
        if (oppGroup.libertyCount === 0) {
          for (let i = 0; i < oppGroup.stones.length; i++) {
            const st = oppGroup.stones[i];
            board[st.r][st.c] = 0;
            capturedStones.push({ r: st.r, c: st.c });
          }
        }
      }
    }

    // Check suicide
    const ownGroup = getSingleGroup(board, size, tr, tc);
    if (ownGroup.libertyCount === 0) {
      throw new Error('Illegal Go move: suicide is forbidden.');
    }

    // Check Positional Ko
    const newHash = boardToHash(board, size);
    if (
      (state.koPoint && state.koPoint.r === tr && state.koPoint.c === tc && state.boardHistoryHashes.indexOf(newHash) !== -1) ||
      state.boardHistoryHashes.indexOf(newHash) !== -1
    ) {
      throw new Error('Illegal Go move: Positional Ko forbids repeating a previous board position.');
    }

    next.captures[player] = (next.captures[player] || 0) + capturedStones.length;
    next.consecutivePasses = 0;
    next.boardHistoryHashes.push(newHash);

    if (
      capturedStones.length === 1 &&
      ownGroup.stones.length === 1 &&
      ownGroup.libertyCount === 1
    ) {
      next.koPoint = { r: capturedStones[0].r, c: capturedStones[0].c };
    } else {
      next.koPoint = null;
    }

    next.currentPlayer = opponent;
    next.turnNumber = state.turnNumber + 1;
    const notation = GO_COLS[tc] + (size - tr);
    next.lastMove = {
      id: 'r' + tr + 'c' + tc,
      action: null,
      from: null,
      to: { r: tr, c: tc },
      isCapture: capturedStones.length > 0,
      captures: capturedStones,
      notation: notation,
      player: player
    };
    next.moveHistory.push(notation);
    next.forbiddenPoints = scanBoardForPlayer(next, opponent).forbiddenPoints;

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

    const area = computeAreaScore(state);
    // Area differential (stones + enclosed territory - komi)
    let blackScore = area.diff * 100;

    // Captures pressure bonus
    blackScore += ((state.captures[1] || 0) - (state.captures[2] || 0)) * 45;

    // Liberty health and Atari tactical bonuses
    const analysis = analyzeGroups(state.board, state.size);
    const groups = analysis.groups;
    for (let i = 0; i < groups.length; i++) {
      const g = groups[i];
      const sign = g.color === 1 ? 1 : -1;
      const sz = g.stones.length;
      if (g.libertyCount === 1) {
        blackScore += sign * (-68 * sz);
      } else if (g.libertyCount === 2) {
        blackScore += sign * (-14 * sz);
      } else {
        blackScore += sign * (Math.min(g.libertyCount, 6) * 7);
      }
    }

    // Early-game 3rd/4th line development bonus
    if (state.turnNumber <= 24) {
      const size = state.size;
      for (let r = 0; r < size; r++) {
        for (let c = 0; c < size; c++) {
          const v = state.board[r][c];
          if (v === 0) continue;
          const sign = v === 1 ? 1 : -1;
          const minEdge = Math.min(r, c, size - 1 - r, size - 1 - c);
          if (minEdge === 2 || minEdge === 3) blackScore += sign * 8;
          else if (minEdge === 0) blackScore -= sign * 12;
        }
      }
    }

    return me === 1 ? Math.round(blackScore) : Math.round(-blackScore);
  }

  function canSelectSource(state, source, player) {
    const p = player || state.currentPlayer;
    if (!state || state.status === 'ended') {
      return { ok: false, selectable: false, hasMoves: false, moves: [], reasonZh: '對局已結束。', reasonEn: 'Game has ended.' };
    }
    if (!source || typeof source.r !== 'number' || typeof source.c !== 'number') {
      return { ok: false, selectable: false, hasMoves: false, moves: [], reasonZh: '請點擊空白交叉點。', reasonEn: 'Click an empty intersection.' };
    }
    if (state.status === 'scoring') {
      if (state.board[source.r] && state.board[source.r][source.c] !== 0) {
        const m = {
          id: 'toggle_dead:' + source.r + ',' + source.c,
          action: 'toggle_dead',
          from: null,
          to: { r: source.r, c: source.c },
          isCapture: false,
          notation: 'Dead ' + GO_COLS[source.c] + (state.size - source.r)
        };
        return { ok: true, selectable: true, hasMoves: true, moves: [m], reasonZh: '', reasonEn: '' };
      }
      return { ok: false, selectable: false, hasMoves: false, moves: [], reasonZh: '點目階段請點擊死子或確認結算。', reasonEn: 'Click stones to toggle dead status or confirm score.' };
    }
    if (state.board[source.r][source.c] !== 0) {
      return { ok: false, selectable: false, hasMoves: false, moves: [], reasonZh: '此交叉點已有棋子。', reasonEn: 'Intersection is already occupied.' };
    }
    const scanned = scanBoardForPlayer(state, p);
    for (let i = 0; i < scanned.forbiddenPoints.length; i++) {
      const fp = scanned.forbiddenPoints[i];
      if (fp.r === source.r && fp.c === source.c) {
        if (fp.reason === 'ko') {
          return {
            ok: false,
            selectable: false,
            hasMoves: false,
            moves: [],
            reasonZh: '禁著點：全局同形打劫（Ko），須先於他處尋劫！',
            reasonEn: 'Forbidden point: Positional Ko forbids immediate repetition!'
          };
        }
        return {
          ok: false,
          selectable: false,
          hasMoves: false,
          moves: [],
          reasonZh: '禁著點：此處氣數為零且無法提子（禁自殺）！',
          reasonEn: 'Forbidden point: Suicide is not allowed!'
        };
      }
    }
    for (let i = 0; i < scanned.moves.length; i++) {
      const mv = scanned.moves[i];
      if (mv.to && mv.to.r === source.r && mv.to.c === source.c) {
        return { ok: true, selectable: true, hasMoves: true, moves: [mv], reasonZh: '', reasonEn: '' };
      }
    }
    return { ok: false, selectable: false, hasMoves: false, moves: [], reasonZh: '此處無法落子。', reasonEn: 'Illegal intersection.' };
  }

  BoardArena.registerRule('go', {
    id: 'go',
    selectionMode: 'drop',
    rows: 19,
    cols: 19,
    supportedSizes: [9, 13, 19],
    sideLabels: {
      1: { zh: '黑方', en: 'Black' },
      2: { zh: '白方', en: 'White' }
    },
    getStarPoints: getStarPoints,
    computeAreaScore: computeAreaScore,
    createInitialState: createInitialState,
    cloneState: cloneState,
    getLegalMoves: getLegalMoves,
    canSelectSource: canSelectSource,
    applyMove: applyMove,
    evaluate: evaluate
  });
})(typeof window !== 'undefined' ? window : globalThis);
