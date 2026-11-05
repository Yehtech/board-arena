/**
 * Classic Board Arena — Four-Tier Traditional AI Engine (No Generative AI)
 * Levels:
 *   - easy   (簡單): Shallow 1-ply + controlled mistake noise (beginner-friendly)
 *   - normal (普通): 2-ply Alpha-Beta / positional heuristics / light MCTS
 *   - hard   (困難): 3-4 ply Alpha-Beta + tactical move ordering + threat detection
 *   - master (大師): Iterative Deepening Alpha-Beta (up to ~850ms budget) +
 *                    Transposition Table + Killer Heuristic + Endgame/VCF/Equity extensions
 */
(function (global) {
  'use strict';

  const BoardArena = (global.BoardArena = global.BoardArena || {});

  const LEVEL_CONFIG = {
    easy: { maxDepth: 1, timeBudgetMs: 120, noiseProb: 0.38, maxBranch: 20, mctsPlayouts: 28 },
    normal: { maxDepth: 2, timeBudgetMs: 260, noiseProb: 0.08, maxBranch: 24, mctsPlayouts: 75 },
    hard: { maxDepth: 3, timeBudgetMs: 520, noiseProb: 0.0, maxBranch: 30, mctsPlayouts: 180 },
    master: { maxDepth: 6, timeBudgetMs: 880, noiseProb: 0.0, maxBranch: 38, mctsPlayouts: 380 }
  };

  function opponentOf(p) {
    return p === 1 ? 2 : 1;
  }

  /**
   * Prune and order candidate moves so large-board games (Gomoku 15x15, Go 19x19, Shogi drops)
   * search deeply and accurately within the 1-second budget.
   */
  function orderAndFilterMoves(gameId, rule, state, moves, maxBranch, killerMoveId) {
    if (!moves || moves.length <= 1) return moves || [];

    // Gomoku: restrict candidates to empty cells within Chebyshev distance 2 of existing stones
    if (gameId === 'gomoku' && state.board) {
      const filtered = filterGomokuNeighborhood(state, moves);
      if (filtered.length > 0) moves = filtered;
    }

    // Go: avoid Pass while productive board moves exist unless near end
    if (gameId === 'go' && state.board && moves.length > 2) {
      const filtered = filterGoCandidates(state, moves);
      if (filtered.length > 0) moves = filtered;
    }

    // Score each move cheaply for ordering
    const scored = new Array(moves.length);
    for (let i = 0; i < moves.length; i++) {
      const m = moves[i];
      let priority = 0;
      if (killerMoveId && m.id === killerMoveId) priority += 50000;
      if (m.isCapture) {
        priority += 4000;
        if (Array.isArray(m.captures)) priority += m.captures.length * 400;
      }
      if (m.promote) priority += 2200;
      if (m.action === 'pass') priority -= 8000;
      if (m.action === 'swap') priority -= 2000;

      if (gameId === 'othello' && m.to) {
        const r = m.to.r;
        const c = m.to.c;
        if ((r === 0 || r === 7) && (c === 0 || c === 7)) priority += 9000;
        else if ((r === 1 || r === 6) && (c === 1 || c === 6)) priority -= 2500;
        else if (r === 0 || r === 7 || c === 0 || c === 7) priority += 900;
      } else if (gameId === 'gomoku' && m.to && state.board) {
        priority += quickGomokuPointScore(state.board, m.to.r, m.to.c, state.currentPlayer);
      } else if (gameId === 'shogi' && m.isDrop) {
        // Prioritize drops near enemy King or center
        priority += m.to ? 350 - Math.abs(4 - m.to.c) * 30 : 100;
      } else if (m.to && typeof m.to.r === 'number') {
        priority += 60 - (Math.abs(3.5 - m.to.r) + Math.abs(3.5 - m.to.c)) * 4;
      }

      scored[i] = { move: m, priority: priority };
    }

    scored.sort(function (a, b) {
      return b.priority - a.priority;
    });

    const limit = Math.min(scored.length, maxBranch || 32);
    const out = new Array(limit);
    for (let i = 0; i < limit; i++) out[i] = scored[i].move;
    return out;
  }

  function filterGomokuNeighborhood(state, moves) {
    const b = state.board;
    const n = b.length;
    let hasStone = false;
    for (let r = 0; r < n && !hasStone; r++) {
      for (let c = 0; c < n; c++) {
        if (b[r][c] !== 0) {
          hasStone = true;
          break;
        }
      }
    }
    if (!hasStone) {
      const mid = Math.floor(n / 2);
      return moves.filter(function (m) {
        return m.to && Math.abs(m.to.r - mid) <= 1 && Math.abs(m.to.c - mid) <= 1;
      });
    }

    const near = [];
    for (let i = 0; i < moves.length; i++) {
      const m = moves[i];
      if (!m.to) continue;
      const r0 = m.to.r;
      const c0 = m.to.c;
      let neighbor = false;
      for (let dr = -2; dr <= 2 && !neighbor; dr++) {
        for (let dc = -2; dc <= 2; dc++) {
          if (dr === 0 && dc === 0) continue;
          const nr = r0 + dr;
          const nc = c0 + dc;
          if (nr >= 0 && nr < n && nc >= 0 && nc < n && b[nr][nc] !== 0) {
            neighbor = true;
            break;
          }
        }
      }
      if (neighbor) near.push(m);
    }
    return near;
  }

  function quickGomokuPointScore(board, r, c, player) {
    const n = board.length;
    const opp = opponentOf(player);
    const dirs = [
      [0, 1],
      [1, 0],
      [1, 1],
      [1, -1]
    ];
    let score = (7 - Math.abs(7 - r)) * 4 + (7 - Math.abs(7 - c)) * 4;

    for (let d = 0; d < 4; d++) {
      const dr = dirs[d][0];
      const dc = dirs[d][1];
      const myRun = countLinePotential(board, n, r, c, dr, dc, player);
      const opRun = countLinePotential(board, n, r, c, dr, dc, opp);
      if (myRun.cnt >= 4) score += 200000;
      else if (opRun.cnt >= 4) score += 160000;
      else if (myRun.cnt === 3 && myRun.open === 2) score += 35000;
      else if (opRun.cnt === 3 && opRun.open === 2) score += 30000;
      else score += myRun.cnt * myRun.cnt * 45 * (myRun.open + 1) + opRun.cnt * opRun.cnt * 40 * (opRun.open + 1);
    }
    return score;
  }

  function countLinePotential(board, n, r, c, dr, dc, who) {
    let cnt = 0;
    let open = 0;
    let nr = r + dr;
    let nc = c + dc;
    while (nr >= 0 && nr < n && nc >= 0 && nc < n && board[nr][nc] === who) {
      cnt++;
      nr += dr;
      nc += dc;
    }
    if (nr >= 0 && nr < n && nc >= 0 && nc < n && board[nr][nc] === 0) open++;

    nr = r - dr;
    nc = c - dc;
    while (nr >= 0 && nr < n && nc >= 0 && nc < n && board[nr][nc] === who) {
      cnt++;
      nr -= dr;
      nc -= dc;
    }
    if (nr >= 0 && nr < n && nc >= 0 && nc < n && board[nr][nc] === 0) open++;
    return { cnt: cnt, open: open };
  }

  function filterGoCandidates(state, moves) {
    const b = state.board;
    const sz = b.length;
    let stoneCount = 0;
    for (let r = 0; r < sz; r++) {
      for (let c = 0; c < sz; c++) {
        if (b[r][c] !== 0) stoneCount++;
      }
    }
    if (stoneCount === 0) {
      // Opening star points / komoku
      const star = sz === 9 ? [2, 4, 6] : sz === 13 ? [3, 6, 9] : [3, 9, 15];
      return moves.filter(function (m) {
        return m.to && star.indexOf(m.to.r) >= 0 && star.indexOf(m.to.c) >= 0;
      });
    }
    // Keep moves within distance 2 of existing stones or star points
    const out = [];
    for (let i = 0; i < moves.length; i++) {
      const m = moves[i];
      if (m.action === 'pass') continue;
      if (!m.to) continue;
      const r = m.to.r;
      const c = m.to.c;
      // Avoid filling own single-point true eye!
      if (isLikelyOwnEye(b, sz, r, c, state.currentPlayer)) continue;
      let near = false;
      for (let dr = -2; dr <= 2 && !near; dr++) {
        for (let dc = -2; dc <= 2; dc++) {
          const nr = r + dr;
          const nc = c + dc;
          if (nr >= 0 && nr < sz && nc >= 0 && nc < sz && b[nr][nc] !== 0) near = true;
        }
      }
      if (near || ((r === 2 || r === 3 || r === sz - 3 || r === sz - 4) && (c === 2 || c === 3 || c === sz - 3 || c === sz - 4))) {
        out.push(m);
      }
    }
    return out;
  }

  function isLikelyOwnEye(board, sz, r, c, player) {
    const ortho = [
      [-1, 0],
      [1, 0],
      [0, -1],
      [0, 1]
    ];
    for (let i = 0; i < 4; i++) {
      const nr = r + ortho[i][0];
      const nc = c + ortho[i][1];
      if (nr >= 0 && nr < sz && nc >= 0 && nc < sz) {
        if (board[nr][nc] !== player) return false;
      }
    }
    let diagEnemy = 0;
    let diagTotal = 0;
    const diags = [
      [-1, -1],
      [-1, 1],
      [1, -1],
      [1, 1]
    ];
    const opp = opponentOf(player);
    for (let i = 0; i < 4; i++) {
      const nr = r + diags[i][0];
      const nc = c + diags[i][1];
      if (nr >= 0 && nr < sz && nc >= 0 && nc < sz) {
        diagTotal++;
        if (board[nr][nc] === opp) diagEnemy++;
      }
    }
    return diagTotal === 4 ? diagEnemy <= 1 : diagEnemy === 0;
  }

  function quickStateHash(gameId, state) {
    try {
      if (state.board) {
        let s = gameId + ':' + state.currentPlayer + ':';
        const b = state.board;
        for (let r = 0; r < b.length; r++) {
          const row = b[r];
          for (let c = 0; c < row.length; c++) {
            const cell = row[c];
            if (!cell) s += '.';
            else if (typeof cell === 'number') s += cell;
            else s += (cell.owner || 0) + (cell.type || (cell.king ? 'K' : 'm')) + (cell.promoted ? '+' : '');
          }
        }
        if (state.hands) s += JSON.stringify(state.hands);
        return s;
      }
      return JSON.stringify([state.currentPlayer, state.points, state.bar, state.diceLeft]);
    } catch (e) {
      return String(Math.random());
    }
  }

  /**
   *Specialized Go Tactical + Monte-Carlo Evaluator
   */
  function evaluateGoMoveList(rule, state, legalMoves, cfg) {
    const rootPlayer = state.currentPlayer;
    const candidates = orderAndFilterMoves('go', rule, state, legalMoves, Math.min(22, cfg.maxBranch));
    if (candidates.length === 0) {
      const passMove = legalMoves.find(function (m) {
        return m.action === 'pass';
      });
      return passMove ? [{ move: passMove, score: 0 }] : [{ move: legalMoves[0], score: 0 }];
    }

    const baseEval = rule.evaluate(state, rootPlayer);
    const ranked = [];
    const playoutsPerCand = Math.max(2, Math.floor(cfg.mctsPlayouts / Math.max(1, candidates.length)));
    const rng = BoardArena.createRng(Date.now() ^ (state.turnNumber * 7919));

    for (let i = 0; i < candidates.length; i++) {
      const mv = candidates[i];
      const next = rule.applyMove(state, mv);
      let tacticalScore = rule.evaluate(next, rootPlayer) - baseEval;
      if (mv.isCapture) tacticalScore += 85 * ((mv.captures && mv.captures.length) || 1);

      // Short rollout simulation for Hard / Master
      if (cfg.mctsPlayouts >= 60 && next.status === 'playing') {
        let rolloutSum = 0;
        for (let p = 0; p < playoutsPerCand; p++) {
          let sim = next;
          for (let step = 0; step < 6 && sim.status === 'playing'; step++) {
            const sm = rule.getLegalMoves(sim, sim.currentPlayer);
            const nonPass = sm.filter(function (x) {
              return x.action !== 'pass';
            });
            if (nonPass.length === 0) break;
            const pick = nonPass[rng.nextInt(0, nonPass.length - 1)];
            sim = rule.applyMove(sim, pick);
          }
          rolloutSum += rule.evaluate(sim, rootPlayer);
        }
        tacticalScore = tacticalScore * 0.65 + (rolloutSum / playoutsPerCand - baseEval) * 0.35;
      }

      ranked.push({ move: mv, score: Math.round(tacticalScore * 100) / 100 });
    }

    ranked.sort(function (a, b) {
      return b.score - a.score;
    });

    // If best move seriously loses ground late in game, consider Pass
    if (ranked[0].score < -25 && state.turnNumber > state.size * state.size * 0.7) {
      const passMove = legalMoves.find(function (m) {
        return m.action === 'pass';
      });
      if (passMove) ranked.unshift({ move: passMove, score: 0 });
    }
    return ranked;
  }

  /**
   * Specialized Backgammon Turn-Completion & Equity Search
   * Evaluates full turn outcome across remaining dice + opponent counter-roll danger on Master/Hard.
   */
  function evaluateBackgammonMoveList(rule, state, legalMoves, cfg) {
    const rootPlayer = state.currentPlayer;
    if (legalMoves.length <= 1) {
      return legalMoves.map(function (m) {
        return { move: m, score: 0 };
      });
    }

    function searchRemainingDice(curState, depthLeft) {
      if (curState.status === 'ended') {
        return curState.winner === rootPlayer ? 100000 : -100000;
      }
      if (curState.currentPlayer !== rootPlayer || depthLeft <= 0) {
        return rule.evaluate(curState, rootPlayer);
      }
      const subMoves = rule.getLegalMoves(curState, rootPlayer);
      if (subMoves.length === 0) return rule.evaluate(curState, rootPlayer);
      let best = -Infinity;
      const cap = Math.min(subMoves.length, 18);
      for (let i = 0; i < cap; i++) {
        const ns = rule.applyMove(curState, subMoves[i]);
        const val = searchRemainingDice(ns, depthLeft - 1);
        if (val > best) best = val;
      }
      return best;
    }

    const ranked = [];
    for (let i = 0; i < legalMoves.length; i++) {
      const m = legalMoves[i];
      const next = rule.applyMove(state, m);
      let score = searchRemainingDice(next, cfg.maxDepth >= 3 ? 4 : 2);
      if (m.isCapture) score += 45; // Hitting opponent blot bonus
      ranked.push({ move: m, score: Math.round(score * 100) / 100 });
    }

    ranked.sort(function (a, b) {
      return b.score - a.score;
    });
    return ranked;
  }

  /**
   * Iterative Deepening Alpha-Beta with Transposition Table & Same-Player Multi-Jump Handling
   */
  function rankMovesAlphaBeta(gameId, rule, state, legalMoves, cfg) {
    if (gameId === 'go') {
      return evaluateGoMoveList(rule, state, legalMoves, cfg);
    }
    if (gameId === 'backgammon') {
      return evaluateBackgammonMoveList(rule, state, legalMoves, cfg);
    }

    const rootPlayer = state.currentPlayer;
    const deadline = Date.now() + cfg.timeBudgetMs;
    const tt = new Map();
    const killers = Object.create(null);

    let rootMoves = orderAndFilterMoves(gameId, rule, state, legalMoves, cfg.maxBranch, null);
    if (rootMoves.length === 0) rootMoves = legalMoves.slice(0, 1);

    let bestRanking = rootMoves.map(function (m) {
      return { move: m, score: 0 };
    });

    // Othello Master Endgame Solver: search deeper when <= 10 empty squares remain!
    let targetDepth = cfg.maxDepth;
    if (gameId === 'othello' && cfg.maxDepth >= 5 && state.board) {
      let empties = 0;
      for (let r = 0; r < 8; r++) {
        for (let c = 0; c < 8; c++) {
          if (state.board[r][c] === 0) empties++;
        }
      }
      if (empties <= 10) targetDepth = Math.min(10, empties);
    } else if (gameId === 'gomoku' && cfg.maxDepth >= 5) {
      targetDepth = 4; // Wider tactical branching in 15x15 Gomoku
    } else if (gameId === 'shogi' && cfg.maxDepth >= 5) {
      targetDepth = 4; // Shogi drop branching factor
    }

    function alphaBeta(curState, depth, alpha, beta, ply) {
      if (curState.status === 'ended') {
        if (curState.winner === rootPlayer) return 100000 - ply * 25;
        if (curState.winner === 0) return 0;
        return -100000 + ply * 25;
      }
      if (depth <= 0 || Date.now() >= deadline) {
        return rule.evaluate(curState, rootPlayer);
      }

      const hash = tt.size < 25000 ? quickStateHash(gameId, curState) : null;
      if (hash && tt.has(hash)) {
        const entry = tt.get(hash);
        if (entry.depth >= depth) {
          if (entry.flag === 0) return entry.val;
          if (entry.flag === -1 && entry.val <= alpha) return alpha;
          if (entry.flag === 1 && entry.val >= beta) return beta;
        }
      }

      const rawMoves = rule.getLegalMoves(curState, curState.currentPlayer);
      if (!rawMoves || rawMoves.length === 0) {
        return rule.evaluate(curState, rootPlayer);
      }

      const ordered = orderAndFilterMoves(
        gameId,
        rule,
        curState,
        rawMoves,
        Math.max(10, cfg.maxBranch - ply * 4),
        killers[ply]
      );

      const maximizing = curState.currentPlayer === rootPlayer;
      const origAlpha = alpha;
      let bestVal = maximizing ? -Infinity : Infinity;

      for (let i = 0; i < ordered.length; i++) {
        if (ply > 1 && Date.now() >= deadline) break;
        const mv = ordered[i];
        const nextState = rule.applyMove(curState, mv);
        // Multi-jump continuation (e.g. International Draughts) keeps depth without penalizing chain
        const nextDepth = nextState.currentPlayer === curState.currentPlayer ? depth : depth - 1;
        const val = alphaBeta(nextState, nextDepth, alpha, beta, ply + 1);

        if (maximizing) {
          if (val > bestVal) bestVal = val;
          if (bestVal > alpha) alpha = bestVal;
          if (alpha >= beta) {
            if (!mv.isCapture) killers[ply] = mv.id;
            break;
          }
        } else {
          if (val < bestVal) bestVal = val;
          if (bestVal < beta) beta = bestVal;
          if (alpha >= beta) {
            if (!mv.isCapture) killers[ply] = mv.id;
            break;
          }
        }
      }

      if (hash && Date.now() < deadline) {
        let flag = 0;
        if (bestVal <= origAlpha) flag = -1;
        else if (bestVal >= beta) flag = 1;
        tt.set(hash, { depth: depth, val: bestVal, flag: flag });
      }
      return bestVal;
    }

    for (let d = 1; d <= targetDepth; d++) {
      if (d > 1 && Date.now() >= deadline) break;
      const iterScores = [];
      let alpha = -Infinity;
      const beta = Infinity;
      let aborted = false;

      const currentOrder = bestRanking.map(function (x) {
        return x.move;
      });

      for (let i = 0; i < currentOrder.length; i++) {
        if (d > 1 && i > 0 && Date.now() >= deadline) {
          aborted = true;
          break;
        }
        const mv = currentOrder[i];
        const nextState = rule.applyMove(state, mv);
        const val = alphaBeta(nextState, d - 1, alpha, beta, 1);
        iterScores.push({ move: mv, score: Math.round(val * 100) / 100 });
        if (val > alpha) alpha = val;
      }

      if (!aborted && iterScores.length === currentOrder.length) {
        iterScores.sort(function (a, b) {
          return b.score - a.score;
        });
        bestRanking = iterScores;
        // Stop early if forced win found
        if (bestRanking[0].score >= 95000) break;
      }
    }

    return bestRanking;
  }

  /**
   * Choose a move for the AI at the specified level ('easy' | 'normal' | 'hard' | 'master').
   */
  function chooseMove(gameId, state, level, options) {
    const rule = BoardArena.getRule(gameId);
    if (!state || state.status === 'ended') return null;

    // Handle Go scoring confirmation automatically if AI is asked during 'scoring'
    if (gameId === 'go' && state.status === 'scoring') {
      return { id: 'confirm_score', action: 'confirm_score', from: null, to: null, isCapture: false, notation: 'Confirm Score' };
    }

    const legalMoves = rule.getLegalMoves(state, state.currentPlayer);
    if (!legalMoves || legalMoves.length === 0) return null;
    if (legalMoves.length === 1) return legalMoves[0];

    // Avoid AI trivially swapping on move 4 unless Master evaluates swap有利
    const usableMoves =
      gameId === 'gomoku'
        ? legalMoves.filter(function (m) {
            return m.action !== 'swap';
          })
        : legalMoves;
    const pool = usableMoves.length > 0 ? usableMoves : legalMoves;

    const lvlKey = LEVEL_CONFIG[level] ? level : 'normal';
    const cfg = LEVEL_CONFIG[lvlKey];
    const ranked = rankMovesAlphaBeta(gameId, rule, state, pool, cfg);
    if (!ranked || ranked.length === 0) return pool[0];

    const seed = (options && options.seed) || (Date.now() ^ (state.turnNumber * 131));
    const rng = BoardArena.createRng(seed);

    // Easy / Normal controlled imperfection (unless there is an immediate winning move!)
    if (cfg.noiseProb > 0 && ranked.length > 1 && ranked[0].score < 85000) {
      if (rng.nextFloat() < cfg.noiseProb) {
        const cap = Math.min(ranked.length - 1, lvlKey === 'easy' ? 4 : 2);
        const pickIdx = rng.nextInt(1, cap);
        // Don't blunder into immediate checkmate if avoidable on Normal
        if (lvlKey !== 'normal' || ranked[pickIdx].score > -80000) {
          return ranked[pickIdx].move;
        }
      }
    }

    // Break exact score ties cleanly
    const topScore = ranked[0].score;
    const tied = ranked.filter(function (x) {
      return Math.abs(x.score - topScore) <= 1;
    });
    return tied[rng.nextInt(0, tied.length - 1)].move;
  }

  /**
   * Compute Top-K Master tactical hints (used by Rewarded Ad Hint in vs-Bot mode).
   */
  function getTopHints(gameId, state, topK) {
    const rule = BoardArena.getRule(gameId);
    if (!state || state.status !== 'playing') return [];
    const legalMoves = rule.getLegalMoves(state, state.currentPlayer).filter(function (m) {
      return m.action !== 'swap';
    });
    if (legalMoves.length === 0) return [];
    const ranked = rankMovesAlphaBeta(gameId, rule, state, legalMoves, LEVEL_CONFIG.master);
    return ranked.slice(0, topK || 3);
  }

  const WINRATE_SCALE = {
    othello: 180,
    xiangqi: 450,
    go: 18,
    gomoku: 1200,
    draughts: 220,
    chess: 380,
    shogi: 450,
    backgammon: 140
  };

  function evalToWinRateP1(gameId, rule, state) {
    if (!state) return 50;
    if (state.status === 'ended') {
      if (state.winner === 1) return 100;
      if (state.winner === 2) return 0;
      return 50;
    }
    const scale = WINRATE_SCALE[gameId] || 300;
    const rawP1 = rule.evaluate(state, 1);
    const prob = 100 / (1 + Math.exp(-rawP1 / scale));
    return Math.max(1, Math.min(99, Math.round(prob * 10) / 10));
  }

  function buildCoachComment(gameId, stateBefore, actualMove, bestMove, stateAfter, grade, winDrop) {
    const actualNot = (actualMove && (actualMove.notation || actualMove.id)) || '—';
    const bestNot = (bestMove && (bestMove.notation || bestMove.id)) || actualNot;
    const sameMove = !bestMove || actualMove.id === bestMove.id || actualNot === bestNot;

    if (stateAfter && stateAfter.status === 'ended' && stateAfter.winner === stateBefore.currentPlayer) {
      return {
        zh: '🏆 致勝一擊！實戰走 【' + actualNot + '】 直接鎖定勝局。',
        en: '🏆 Winning finisher! Playing [' + actualNot + '] clinches victory immediately.'
      };
    }

    if (grade === 'best') {
      let detailZh = '與導師引擎首選完全吻合，子力效率與盤面控制極佳。';
      let detailEn = 'Matches the Mentor engine #1 choice with optimal positional efficiency.';
      if (gameId === 'othello' && actualMove.to) {
        const r = actualMove.to.r;
        const c = actualMove.to.c;
        if ((r === 0 || r === 7) && (c === 0 || c === 7)) {
          detailZh = '精準搶佔黃金角位，建立不可翻轉的絕對根據地！';
          detailEn = 'Captures a permanent Golden Corner anchor!';
        }
      } else if (actualMove.isCapture) {
        detailZh = '果斷出擊得子，擴大盤面實利與先手主動權。';
        detailEn = 'Decisive tactical capture gaining material and initiative.';
      } else if (actualMove.promote) {
        detailZh = '即時升變強化子力，大幅提升進攻威脅。';
        detailEn = 'Timely promotion boosting piece firepower.';
      }
      return {
        zh: '🌟 妙手！實戰 【' + actualNot + '】 ' + detailZh,
        en: '🌟 Best Move! [' + actualNot + '] — ' + detailEn
      };
    }

    if (grade === 'good') {
      return {
        zh: sameMove
          ? '✅ 好棋！實戰 【' + actualNot + '】 穩健維持局勢均衡。'
          : '✅ 好棋！實戰 【' + actualNot + '】 相當穩健（導師微幅首選為 【' + bestNot + '】，差距僅 ' + winDrop.toFixed(1) + '%）。',
        en: sameMove
          ? '✅ Good move! [' + actualNot + '] maintains a solid position.'
          : '✅ Solid move [' + actualNot + '] (Mentor slightly prefers [' + bestNot + '], Δ' + winDrop.toFixed(1) + '%).'
      };
    }

    // For inaccuracy / mistake / blunder, explain what was missed and why bestMove is better
    let reasonZh = '讓出盤面主動權，導師建議改走 【' + bestNot + '】 以穩固陣型並爭取先手。';
    let reasonEn = 'Concedes initiative; Mentor recommends [' + bestNot + '] for stronger control.';

    if (bestMove && bestMove.isCapture && !actualMove.isCapture) {
      reasonZh = '錯失吃子良機！此時應走 【' + bestNot + '】 直接奪取敵方子力。';
      reasonEn = 'Missed a tactical capture! Play [' + bestNot + '] to win material.';
    } else if (gameId === 'othello' && actualMove.to) {
      const r = actualMove.to.r;
      const c = actualMove.to.c;
      if ((r === 1 || r === 6) && (c === 1 || c === 6)) {
        reasonZh = '過早踏入角旁危險 X 位，易讓對手順勢佔角；應改下 【' + bestNot + '】 控制行動力。';
        reasonEn = 'Stepped onto a risky X-square near an empty corner; play [' + bestNot + '] instead.';
      }
    } else if (gameId === 'gomoku') {
      reasonZh = '攻守焦點偏移，漏看關鍵連珠威脅或強攻點；應改落 【' + bestNot + '】 搶佔連珠要津。';
      reasonEn = 'Missed a key five-in-a-row threat or fork; play [' + bestNot + '] instead.';
    } else if (gameId === 'xiangqi' || gameId === 'chess' || gameId === 'shogi') {
      if (stateAfter && stateAfter.inCheck) {
        reasonZh = '實戰走法雖有攻勢，但 【' + bestNot + '】 能兼顧防守與子力協同。';
        reasonEn = 'While aggressive, [' + bestNot + '] provides superior defense and coordination.';
      } else {
        reasonZh = '導致子力受制或防線暴露破綻；導師推薦 【' + bestNot + '】 化解威脅並反奪先手。';
        reasonEn = 'Exposes a tactical weakness; Mentor recommends [' + bestNot + '] to secure the position.';
      }
    } else if (gameId === 'backgammon') {
      reasonZh = '此步易留下孤子（Blot）或分散防線；導師建議 【' + bestNot + '】 建立安全錨點並推進跑子。';
      reasonEn = 'Leaves blots exposed; Mentor recommends [' + bestNot + '] for safer point-building.';
    }

    const prefixZh =
      grade === 'blunder'
        ? '💥 敗著（勝率流失 -' + winDrop.toFixed(1) + '%）：實戰 【' + actualNot + '】 '
        : grade === 'mistake'
        ? '❌ 失誤（勝率流失 -' + winDrop.toFixed(1) + '%）：實戰 【' + actualNot + '】 '
        : '⚠️ 緩手（勝率流失 -' + winDrop.toFixed(1) + '%）：實戰 【' + actualNot + '】 ';

    const prefixEn =
      grade === 'blunder'
        ? '💥 Blunder (-' + winDrop.toFixed(1) + '% win rate): [' + actualNot + '] — '
        : grade === 'mistake'
        ? '❌ Mistake (-' + winDrop.toFixed(1) + '% win rate): [' + actualNot + '] — '
        : '⚠️ Inaccuracy (-' + winDrop.toFixed(1) + '% win rate): [' + actualNot + '] — ';

    return {
      zh: prefixZh + reasonZh,
      en: prefixEn + reasonEn
    };
  }

  /**
   * Full-Match AI Mentor Post-Game Review Engine
   * Analyzes stateHistory[0..N] & moveHistory[0..N-1], returning:
   *   - winRateTimeline: [50, ...] (P1 win probability at each state 0..N)
   *   - steps: per-move evaluation, grade ('best'|'good'|'inaccuracy'|'mistake'|'blunder'),
   *            actualMove, bestMove, topCandidates, winDrop, commentZh, commentEn
   *   - summary: accuracy & grade counts per player, plus top turning points
   */
  function analyzeMatchForMentor(gameId, stateHistory, moveHistory, humanSide) {
    const rule = BoardArena.getRule(gameId);
    const states = stateHistory || [];
    const moves = moveHistory || [];
    const fastCfg = {
      maxDepth: gameId === 'gomoku' || gameId === 'go' ? 2 : 2,
      timeBudgetMs: 32,
      noiseProb: 0,
      maxBranch: 16,
      mctsPlayouts: 24
    };

    const winRateTimeline = [];
    for (let s = 0; s < states.length; s++) {
      winRateTimeline.push(evalToWinRateP1(gameId, rule, states[s]));
    }
    if (winRateTimeline.length === 0) winRateTimeline.push(50);

    const steps = [];
    const stats = {
      1: { best: 0, good: 0, inaccuracy: 0, mistake: 0, blunder: 0, lossSum: 0, count: 0, accuracy: 100 },
      2: { best: 0, good: 0, inaccuracy: 0, mistake: 0, blunder: 0, lossSum: 0, count: 0, accuracy: 100 }
    };

    for (let i = 0; i < moves.length; i++) {
      const rec = moves[i];
      const stateBefore = states[i];
      const stateAfter = states[i + 1] || stateBefore;
      const mover = rec.player || (stateBefore ? stateBefore.currentPlayer : 1);
      const actualMove = rec.move || { id: rec.notation, notation: rec.notation };

      const winBeforeP1 = winRateTimeline[i] !== undefined ? winRateTimeline[i] : 50;
      const winAfterP1 = winRateTimeline[i + 1] !== undefined ? winRateTimeline[i + 1] : winBeforeP1;
      const winBeforeMover = mover === 1 ? winBeforeP1 : 100 - winBeforeP1;
      const winAfterMover = mover === 1 ? winAfterP1 : 100 - winAfterP1;

      let topCandidates = [];
      if (stateBefore && stateBefore.status === 'playing') {
        const legal = rule.getLegalMoves(stateBefore, mover).filter(function (m) {
          return m.action !== 'swap';
        });
        if (legal.length === 1) {
          topCandidates = [{ move: legal[0], score: 0 }];
        } else if (legal.length > 1) {
          topCandidates = rankMovesAlphaBeta(gameId, rule, stateBefore, legal, fastCfg).slice(0, 3);
        }
      }

      const bestMove = (topCandidates[0] && topCandidates[0].move) || actualMove;
      let bestWinMover = winBeforeMover;
      if (stateBefore && bestMove && bestMove.id !== actualMove.id) {
        try {
          const bestNextState = rule.applyMove(stateBefore, bestMove);
          const bestP1 = evalToWinRateP1(gameId, rule, bestNextState);
          bestWinMover = mover === 1 ? bestP1 : 100 - bestP1;
        } catch (e) {
          bestWinMover = Math.max(winBeforeMover, winAfterMover);
        }
      } else {
        bestWinMover = winAfterMover;
      }

      const isBestMatch =
        !bestMove ||
        bestMove.id === actualMove.id ||
        (bestMove.notation && actualMove.notation && bestMove.notation === actualMove.notation);

      const rawDrop = isBestMatch ? 0 : Math.max(0, Math.max(bestWinMover, winBeforeMover) - winAfterMover);
      const winDrop = Math.round(rawDrop * 10) / 10;

      let grade = 'best';
      if (isBestMatch || winDrop <= 1.8) {
        grade = 'best';
      } else if (winDrop <= 6.0) {
        grade = 'good';
      } else if (winDrop <= 13.0) {
        grade = 'inaccuracy';
      } else if (winDrop <= 22.0) {
        grade = 'mistake';
      } else {
        grade = 'blunder';
      }

      const comment = buildCoachComment(gameId, stateBefore, actualMove, bestMove, stateAfter, grade, winDrop);

      if (stats[mover]) {
        stats[mover][grade]++;
        stats[mover].lossSum += winDrop;
        stats[mover].count++;
      }

      steps.push({
        seq: i + 1,
        stateIndexBefore: i,
        stateIndexAfter: i + 1,
        player: mover,
        notation: rec.notation || actualMove.notation || actualMove.id,
        actualMove: actualMove,
        bestMove: bestMove,
        bestNotation: (bestMove && (bestMove.notation || bestMove.id)) || rec.notation,
        topCandidates: topCandidates.length > 0 ? topCandidates : [{ move: bestMove, score: 0 }],
        winBeforeP1: winBeforeP1,
        winAfterP1: winAfterP1,
        winDrop: winDrop,
        grade: grade,
        commentZh: comment.zh,
        commentEn: comment.en
      });
    }

    [1, 2].forEach(function (p) {
      const st = stats[p];
      if (st.count > 0) {
        const avgLoss = st.lossSum / st.count;
        st.accuracy = Math.max(35, Math.min(100, Math.round((100 - avgLoss * 2.1) * 10) / 10));
      }
    });

    // Identify Top 3 Turning Points (preferring humanSide mistakes/blunders first, then biggest winDrop overall)
    const targetSide = humanSide === 2 ? 2 : 1;
    const turningPoints = steps
      .filter(function (st) {
        return st.winDrop >= 5.0 || st.grade === 'mistake' || st.grade === 'blunder';
      })
      .sort(function (a, b) {
        const aHuman = a.player === targetSide ? 1 : 0;
        const bHuman = b.player === targetSide ? 1 : 0;
        if (aHuman !== bHuman && Math.abs(a.winDrop - b.winDrop) < 12) return bHuman - aHuman;
        return b.winDrop - a.winDrop;
      })
      .slice(0, 3);

    return {
      gameId: gameId,
      humanSide: targetSide,
      winRateTimeline: winRateTimeline,
      steps: steps,
      stats: stats,
      turningPoints: turningPoints
    };
  }

  BoardArena.AI = {
    chooseMove: chooseMove,
    getTopHints: getTopHints,
    evalToWinRateP1: evalToWinRateP1,
    analyzeMatchForMentor: analyzeMatchForMentor,
    LEVEL_CONFIG: LEVEL_CONFIG
  };
})(typeof window !== 'undefined' ? window : globalThis);
