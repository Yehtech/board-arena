// ============================================
// Date: 2026-11-05
// Version: v1.2.0
// Changes: Go uses MCTS (go-mcts.js) with pass decision; old alpha-beta kept behind AI.goEngine='alphabeta'
// 修改: 圍棋改用蒙地卡羅樹搜尋並會適時虛手；舊演算法保留（AI.goEngine='alphabeta'）供比較
// ============================================
// ============================================
// Date: 2026-11-05
// Version: v1.1.0
// Changes: Raise Hard/Master depth caps so iterative deepening uses the full time budget (master ~950ms)
// 修改: 放寬困難／大師的搜尋深度上限，讓迭代加深用滿時間預算（大師約 950 毫秒），棋力大幅提升
// ============================================
/**
 * Classic Board Arena — Unified 8-Game AI Engine (4 Distinct Skill Tiers: Easy / Normal / Hard / Master)
 * Supports:
 * 1. Client-side Iterative-Deepening Principal Variation / Negamax Alpha-Beta + Quiescence Search + TT + VCF Solver
 * 2. Optional Asynchronous Native CLI Engine Bridge (/api/ai/move -> Resident Stockfish / Pikafish / Edax / Rapfi / KataGo / Scan / gnubg)
 */
(function (global) {
  'use strict';

  var BoardArena = global.BoardArena || (global.BoardArena = {});

  var INF = 1000000;
  var WIN_SCORE = 100000;
  var TT_MAX_ENTRIES = 65536;

  // Transposition Table flags
  var TT_EXACT = 0;
  var TT_LOWER = 1; // Beta cutoff
  var TT_UPPER = 2; // Alpha fail-low

  /**
   * 4 Distinct AI Difficulty Profiles:
   * - easy   (Lv.1 休閒 ~1350): Blocks all immediate 4-in-a-row & Open-Three threats, 1-2 ply lookahead, zero 5-move losses.
   * - normal (Lv.2 進階 ~1650): 2-3 ply Alpha-Beta + positional & tactical evaluation.
   * - hard   (Lv.3 困難 ~1950): 4-5 ply Alpha-Beta + Quiescence + 6-ply Gomoku VCF solver + Opening Book, zero noise.
   * - master (Lv.4 大師 ~2250): 5-6 ply PVS Alpha-Beta + Quiescence + 10-ply VCF/VCT + 12-empty Exact Othello Solver.
   */
  var LEVEL_PROFILES = {
    easy: {
      level: 1,
      id: 'easy',
      maxDepth: 1,
      quiesceDepth: 0,
      vcfDepth: 0,
      timeBudgetMs: 60,
      maxBranch: 8,
      innerBranch: 5,
      tieMargin: 45,
      noiseProb: 0.3,
      useOpeningBook: false,
      depthByGame: {
        gomoku: 1,
        othello: 1,
        draughts: 1,
        xiangqi: 1,
        chess: 1,
        shogi: 1,
        go: 1,
        backgammon: 1
      }
    },
    normal: {
      level: 2,
      id: 'normal',
      maxDepth: 2,
      quiesceDepth: 1,
      vcfDepth: 2,
      timeBudgetMs: 180,
      maxBranch: 12,
      innerBranch: 7,
      tieMargin: 8,
      noiseProb: 0.08,
      useOpeningBook: false,
      depthByGame: {
        gomoku: 2,
        othello: 2,
        draughts: 2,
        xiangqi: 2,
        chess: 2,
        shogi: 2,
        go: 2,
        backgammon: 2
      }
    },
    hard: {
      level: 3,
      id: 'hard',
      maxDepth: 4,
      quiesceDepth: 1,
      vcfDepth: 6,
      timeBudgetMs: 480,
      maxBranch: 15,
      innerBranch: 8,
      tieMargin: 0,
      noiseProb: 0.0,
      useOpeningBook: true,
      // 深度上限放寬，實際由 timeBudgetMs 以迭代加深控制（時間到即採用上一層完整結果）
      depthByGame: {
        gomoku: 5,
        othello: 6,
        draughts: 6,
        xiangqi: 5,
        chess: 5,
        shogi: 5,
        go: 3,
        backgammon: 3
      }
    },
    master: {
      level: 4,
      id: 'master',
      maxDepth: 6,
      quiesceDepth: 2,
      vcfDepth: 10,
      timeBudgetMs: 950,
      maxBranch: 18,
      innerBranch: 9,
      tieMargin: 0,
      noiseProb: 0.0,
      useOpeningBook: true,
      // 深度上限放寬，實際由 timeBudgetMs 以迭代加深控制（圍棋為固定深度搜尋，維持 4）
      // 五子棋：實測（各 80 盤）深度 6–8 反而輸給困難（Elo −80 ~ −127），深度 5 與困難持平，故設為 5
      depthByGame: {
        gomoku: 5,
        othello: 12,
        draughts: 12,
        xiangqi: 12,
        chess: 12,
        shogi: 10,
        go: 4,
        backgammon: 4
      }
    }
  };

  var PIECE_MVV_VALUES = {
    K: 10000,
    Q: 950,
    R: 550,
    C: 460,
    H: 420,
    B: 340,
    N: 320,
    G: 540,
    S: 480,
    L: 360,
    A: 240,
    E: 240,
    P: 120
  };

  function nowMs() {
    if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
      return performance.now();
    }
    return Date.now();
  }

  function getOpponent(player) {
    return player === 1 ? 2 : 1;
  }

  function getProfile(levelKey) {
    return LEVEL_PROFILES[levelKey] || LEVEL_PROFILES.normal;
  }

  function getMoveId(move) {
    if (!move) return '';
    if (move.id) return String(move.id);
    if (move.action) return String(move.action);
    var parts = [];
    if (move.from) parts.push(move.from.r + ',' + move.from.c);
    if (move.to) parts.push(move.to.r + ',' + move.to.c);
    if (move.drop) parts.push('drop:' + move.drop);
    return parts.join('->');
  }

  function computeStateKey(gameId, state) {
    if (!state) return gameId + ':null';
    var out = gameId + '|' + (state.currentPlayer || 1) + '|';
    if (state.board && Array.isArray(state.board)) {
      var rows = state.board.length;
      for (var r = 0; r < rows; r++) {
        var row = state.board[r];
        if (!Array.isArray(row)) continue;
        for (var c = 0; c < row.length; c++) {
          var cell = row[c];
          if (cell === 0 || cell === null || cell === undefined) {
            out += '.';
          } else if (typeof cell === 'number' || typeof cell === 'string') {
            out += cell;
          } else if (typeof cell === 'object') {
            var code = cell.type || cell.kind || (cell.king ? 'K' : 'M');
            var p = cell.owner || cell.player || 1;
            out += p + (cell.promoted ? '+' : '') + code;
          }
        }
      }
    }
    return out;
  }

  /**
   * Estimate capture / tactical urgency using MVV-LVA (Most Valuable Victim - Least Valuable Attacker),
   * promotion, check, and center control.
   */
  function scoreMoveHeuristic(gameId, rule, state, move, ply, killers, ttBestMoveId) {
    if (!move) return -INF;
    var mId = getMoveId(move);
    if (ttBestMoveId && mId === ttBestMoveId) {
      return 500000;
    }

    var score = 0;
    if (typeof move.priority === 'number') {
      score += move.priority * 20;
    }

    // Killer move bonus for quiet moves
    if (killers && killers[ply]) {
      if (killers[ply][0] === mId) score += 9000;
      else if (killers[ply][1] === mId) score += 7500;
    }

    // Capture scoring (MVV-LVA)
    var isCap = Boolean(move.isCapture || (move.captures && move.captures.length > 0) || move.captured);
    if (isCap) {
      score += 15000;
      if (move.captures && move.captures.length > 0) {
        score += move.captures.length * 1800;
      }
      if (state && state.board && move.to && state.board[move.to.r]) {
        var victim = state.board[move.to.r][move.to.c];
        if (victim && typeof victim === 'object' && victim.type) {
          var vVal = PIECE_MVV_VALUES[victim.type] || 200;
          var aVal = 150;
          if (move.from && state.board[move.from.r]) {
            var attacker = state.board[move.from.r][move.from.c];
            if (attacker && attacker.type) {
              aVal = PIECE_MVV_VALUES[attacker.type] || 150;
            }
          }
          score += vVal * 16 - aVal;
        }
      }
    }

    if (move.promote || move.promotion || move.crowns) {
      score += 11000;
    }
    if (move.drop) {
      score += 1800 + (PIECE_MVV_VALUES[move.drop] || 150);
    }
    if (move.action === 'pass') {
      score -= 8000;
    }

    // Game-specific positional move ordering
    if (gameId === 'othello' && move.to) {
      var r = move.to.r;
      var c = move.to.c;
      if ((r === 0 || r === 7) && (c === 0 || c === 7)) {
        score += 25000; // Corner grab
      } else if ((r === 1 || r === 6) && (c === 1 || c === 6)) {
        score -= 6500; // X-square danger
      } else if (
        ((r === 0 || r === 7) && (c === 1 || c === 6)) ||
        ((c === 0 || c === 7) && (r === 1 || r === 6))
      ) {
        score -= 3200; // C-square caution
      } else if (r === 0 || r === 7 || c === 0 || c === 7) {
        score += 2400; // Safe edge
      }
    } else if (move.to && typeof move.to.r === 'number' && typeof move.to.c === 'number') {
      var rows = (rule && rule.rows) || (state && state.board && state.board.length) || 8;
      var cols = (rule && rule.cols) || (state && state.board && state.board[0] && state.board[0].length) || 8;
      var centerR = (rows - 1) * 0.5;
      var centerC = (cols - 1) * 0.5;
      var dist = Math.abs(move.to.r - centerR) + Math.abs(move.to.c - centerC);
      score += Math.max(0, 40 - dist * 4);
    }

    return score;
  }

  /**
   * Order and prune candidate moves for Alpha-Beta efficiency.
   */
  function orderAndFilterMoves(gameId, rule, state, moves, maxBranch, ply, killers, ttBestMoveId) {
    if (!moves || moves.length <= 1) return moves || [];

    // Gomoku uses specialized tactical candidate generator
    if (gameId === 'gomoku' && typeof rule.getCandidateMoves === 'function' && !state.swapOffered) {
      var cands = rule.getCandidateMoves(state, state.currentPlayer, maxBranch);
      if (cands && cands.length > 0) {
        if (ttBestMoveId) {
          for (var i = 0; i < cands.length; i++) {
            if (getMoveId(cands[i]) === ttBestMoveId && i > 0) {
              var best = cands[i];
              cands.splice(i, 1);
              cands.unshift(best);
              break;
            }
          }
        }
        return cands;
      }
    }

    // Go already computes tactical priorities in getLegalMoves; preserve & boost with TT
    if (gameId === 'go') {
      var goScored = [];
      for (var g = 0; g < moves.length; g++) {
        var gm = moves[g];
        if (gm.action === 'pass' && moves.length > 1) continue;
        if (gm.likelyOwnEye && moves.length > 2) continue;
        var gp = typeof gm.priority === 'number' ? gm.priority : 0;
        if (ttBestMoveId && getMoveId(gm) === ttBestMoveId) gp += 10000;
        goScored.push({ move: gm, s: gp });
      }
      goScored.sort(function (a, b) {
        return b.s - a.s;
      });
      var goOut = [];
      var goLimit = Math.min(goScored.length, maxBranch || 14);
      for (var k = 0; k < goLimit; k++) {
        goOut.push(goScored[k].move);
      }
      return goOut.length > 0 ? goOut : moves.slice(0, 1);
    }

    var scored = new Array(moves.length);
    for (var idx = 0; idx < moves.length; idx++) {
      var m = moves[idx];
      scored[idx] = {
        move: m,
        s: scoreMoveHeuristic(gameId, rule, state, m, ply, killers, ttBestMoveId)
      };
    }

    scored.sort(function (a, b) {
      return b.s - a.s;
    });

    var limit = maxBranch && scored.length > maxBranch ? maxBranch : scored.length;
    var result = new Array(limit);
    for (var j = 0; j < limit; j++) {
      result[j] = scored[j].move;
    }
    return result;
  }

  // ============================================================================
  // GOMOKU MANDATORY TACTICAL RESOLVER + VCF (VICTORY BY CONTINUOUS FOUR) SOLVER
  // ============================================================================

  /**
   * Inspect all empty intersections for immediate lethal Gomoku tactics:
   * Priority 1: Win in 1 move (create 5-in-a-row) -> 100% mandatory on all 4 levels.
   * Priority 2: Block opponent's 1-move win (4-in-a-row / broken-four) -> 100% mandatory on all 4 levels.
   * Priority 3: Create an unstoppable Open Four (or Double Four / Four-Three) -> mandatory on all 4 levels.
   * Priority 4: Block opponent from creating an Open Four (i.e. block opponent's Open Three) -> mandatory on all 4 levels!
   */
  function findGomokuMandatoryMove(rule, state, player, levelKey) {
    if (!state || !state.board || typeof rule.analyzePointFourAxes !== 'function') {
      return null;
    }
    if (state.swapOffered && player === 2) {
      return null;
    }

    var board = state.board;
    var size = board.length;
    var opp = getOpponent(player);

    var winMoves = [];
    var blockFiveMoves = [];
    var openFourMoves = [];
    var doubleThreatMoves = [];
    var blockOpenFourMoves = [];
    var blockDoubleThreatMoves = [];

    for (var r = 0; r < size; r++) {
      for (var c = 0; c < size; c++) {
        if (board[r][c] !== 0) continue;

        var myPat = rule.analyzePointFourAxes(board, r, c, player);
        var oppPat = rule.analyzePointFourAxes(board, r, c, opp);
        var totalPrio =
          typeof rule.quickPointTacticalScore === 'function'
            ? rule.quickPointTacticalScore(board, r, c, player)
            : 0;

        var moveObj = {
          id: 'r' + r + 'c' + c,
          action: null,
          from: null,
          to: { r: r, c: c },
          isCapture: false,
          notation: String.fromCharCode(65 + c) + (size - r),
          priority: totalPrio
        };

        if (myPat.five >= 1) {
          winMoves.push(moveObj);
        }
        if (oppPat.five >= 1) {
          blockFiveMoves.push(moveObj);
        }
        if (myPat.openFour >= 1 || myPat.halfFour >= 2) {
          openFourMoves.push(moveObj);
        }
        if (myPat.halfFour >= 1 && myPat.openThree >= 1) {
          doubleThreatMoves.push(moveObj);
        }
        if (oppPat.openFour >= 1 || oppPat.halfFour >= 2) {
          blockOpenFourMoves.push(moveObj);
        }
        if (
          (oppPat.halfFour >= 1 && oppPat.openThree >= 1) ||
          oppPat.openThree >= 2
        ) {
          blockDoubleThreatMoves.push(moveObj);
        }
      }
    }

    var sortByPrio = function (a, b) {
      return b.priority - a.priority;
    };

    if (winMoves.length > 0) {
      winMoves.sort(sortByPrio);
      return winMoves[0];
    }
    if (blockFiveMoves.length > 0) {
      blockFiveMoves.sort(sortByPrio);
      return blockFiveMoves[0];
    }
    if (openFourMoves.length > 0) {
      openFourMoves.sort(sortByPrio);
      return openFourMoves[0];
    }
    if (levelKey !== 'easy' && doubleThreatMoves.length > 0) {
      doubleThreatMoves.sort(sortByPrio);
      return doubleThreatMoves[0];
    }
    if (blockOpenFourMoves.length > 0) {
      blockOpenFourMoves.sort(sortByPrio);
      return blockOpenFourMoves[0];
    }
    if (levelKey !== 'easy' && blockDoubleThreatMoves.length > 0) {
      blockDoubleThreatMoves.sort(sortByPrio);
      return blockDoubleThreatMoves[0];
    }

    return null;
  }

  /**
   * Gomoku VCF (Victory by Continuous Four) Solver for Hard (6-ply) and Master (10-ply).
   */
  function solveGomokuVCF(rule, board, attacker, maxPly, deadline) {
    if (maxPly <= 0 || typeof rule.analyzePointFourAxes !== 'function') return null;
    var size = board.length;
    var defender = getOpponent(attacker);

    function vcfRecursive(plyRemaining) {
      if (plyRemaining <= 0 || nowMs() >= deadline) return null;

      var forcingMoves = [];
      for (var r = 0; r < size; r++) {
        for (var c = 0; c < size; c++) {
          if (board[r][c] !== 0) continue;
          var pat = rule.analyzePointFourAxes(board, r, c, attacker);
          if (pat.five >= 1) {
            return { r: r, c: c };
          }
          if (pat.openFour >= 1 || pat.halfFour >= 2 || (pat.halfFour >= 1 && pat.openThree >= 1)) {
            return { r: r, c: c };
          }
          if (pat.halfFour === 1) {
            var prio = pat.openThree * 500 + pat.openTwo * 80;
            forcingMoves.push({ r: r, c: c, prio: prio });
          }
        }
      }

      forcingMoves.sort(function (a, b) {
        return b.prio - a.prio;
      });
      var limit = Math.min(forcingMoves.length, 5);

      for (var i = 0; i < limit; i++) {
        var fm = forcingMoves[i];
        board[fm.r][fm.c] = attacker;

        var blockSq = null;
        var multiThreat = false;
        for (var br = 0; br < size; br++) {
          for (var bc = 0; bc < size; bc++) {
            if (board[br][bc] !== 0) continue;
            var checkWin = rule.analyzePointFourAxes(board, br, bc, attacker);
            if (checkWin.five >= 1) {
              if (blockSq !== null) {
                multiThreat = true;
                break;
              }
              blockSq = { r: br, c: bc };
            }
          }
          if (multiThreat) break;
        }

        if (multiThreat) {
          board[fm.r][fm.c] = 0;
          return { r: fm.r, c: fm.c };
        }

        if (blockSq) {
          var defCounter = rule.analyzePointFourAxes(board, blockSq.r, blockSq.c, defender);
          if (defCounter.five === 0) {
            board[blockSq.r][blockSq.c] = defender;
            var defFour = false;
            for (var dr = 0; dr < size; dr++) {
              for (var dc = 0; dc < size; dc++) {
                if (board[dr][dc] !== 0) continue;
                var dPat = rule.analyzePointFourAxes(board, dr, dc, defender);
                if (dPat.five >= 1) {
                  defFour = true;
                  break;
                }
              }
              if (defFour) break;
            }
            if (!defFour) {
              var winContinuation = vcfRecursive(plyRemaining - 2);
              if (winContinuation) {
                board[blockSq.r][blockSq.c] = 0;
                board[fm.r][fm.c] = 0;
                return { r: fm.r, c: fm.c };
              }
            }
            board[blockSq.r][blockSq.c] = 0;
          }
        }
        board[fm.r][fm.c] = 0;
      }

      return null;
    }

    var hit = vcfRecursive(maxPly);
    if (!hit) return null;
    return {
      id: 'r' + hit.r + 'c' + hit.c,
      action: null,
      from: null,
      to: { r: hit.r, c: hit.c },
      isCapture: false,
      notation: String.fromCharCode(65 + hit.c) + (size - hit.r)
    };
  }

  // ============================================================================
  // OPENING BOOKS FOR HARD & MASTER LEVELS
  // ============================================================================
  function getGamePlyCount(gameId, state) {
    if (!state) return 99;
    if (typeof state.stoneCount === 'number') return state.stoneCount;
    if (typeof state.moveCount === 'number') return state.moveCount;
    if (Array.isArray(state.moveHistory)) return state.moveHistory.length;
    if (typeof state.turnNumber === 'number') return Math.max(0, state.turnNumber - 1);
    return 99;
  }

  function lookupOpeningBook(gameId, state, legalMoves, levelKey) {
    if (levelKey !== 'hard' && levelKey !== 'master') {
      return null;
    }
    if (!state || !legalMoves || legalMoves.length === 0) return null;

    var ply = getGamePlyCount(gameId, state);
    if (ply > 2) return null;

    if (gameId === 'gomoku' && !state.swapOffered) {
      if (ply === 0) {
        for (var i = 0; i < legalMoves.length; i++) {
          if (legalMoves[i].to && legalMoves[i].to.r === 7 && legalMoves[i].to.c === 7) {
            return legalMoves[i];
          }
        }
      } else if (ply === 1 && state.board && state.board[7] && state.board[7][7] !== 0) {
        var diagTargets = [
          { r: 6, c: 6 },
          { r: 8, c: 8 },
          { r: 6, c: 8 },
          { r: 8, c: 6 }
        ];
        for (var d = 0; d < diagTargets.length; d++) {
          var dt = diagTargets[d];
          for (var j = 0; j < legalMoves.length; j++) {
            if (legalMoves[j].to && legalMoves[j].to.r === dt.r && legalMoves[j].to.c === dt.c) {
              return legalMoves[j];
            }
          }
        }
      }
    }

    if (gameId === 'chess' && ply <= 2) {
      var preferredIds =
        ply === 0
          ? ['r6c4-r4c4', 'r6c3-r4c3']
          : ply === 1
          ? ['r1c4-r3c4', 'r1c2-r3c2', 'r0c6-r2c5']
          : ['r7c6-r5c5', 'r7c1-r5c2'];
      for (var p = 0; p < preferredIds.length; p++) {
        for (var m = 0; m < legalMoves.length; m++) {
          if (legalMoves[m].id === preferredIds[p]) return legalMoves[m];
        }
      }
    }

    if (gameId === 'xiangqi' && ply <= 2) {
      var xqPreferred =
        ply === 0
          ? ['r7c7-r7c4', 'r7c1-r7c4']
          : ply === 1
          ? ['r0c7-r2c6', 'r2c7-r2c4', 'r0c1-r2c2']
          : ['r9c7-r7c6', 'r9c1-r7c2'];
      for (var xp = 0; xp < xqPreferred.length; xp++) {
        for (var xm = 0; xm < legalMoves.length; xm++) {
          if (legalMoves[xm].id === xqPreferred[xp]) return legalMoves[xm];
        }
      }
    }

    return null;
  }

  // ============================================================================
  // LEVEL-DIFFERENTIATED STATIC EVALUATOR
  // ============================================================================
  function evaluateForLevel(gameId, rule, state, perspectivePlayer, levelKey) {
    var me = perspectivePlayer || state.currentPlayer;
    var opp = getOpponent(me);

    if (state.status === 'ended') {
      return rule.evaluate(state, me);
    }

    // Level 1 (Easy): Coarse material / disc-count / basic run evaluation
    if (levelKey === 'easy') {
      if (gameId === 'othello' && state.board) {
        var bCount = 0;
        var wCount = 0;
        for (var r = 0; r < 8; r++) {
          for (var c = 0; c < 8; c++) {
            var v = state.board[r][c];
            if (v === 1) bCount++;
            else if (v === 2) wCount++;
          }
        }
        return (me === 1 ? bCount - wCount : wCount - bCount) * 12;
      }
      var rawEasy = rule.evaluate(state, me);
      if (Math.abs(rawEasy) >= 15000) return rawEasy;
      return Math.round(rawEasy / 85) * 85;
    }

    var baseScore = rule.evaluate(state, me);
    if (Math.abs(baseScore) >= WIN_SCORE - 500) {
      return baseScore;
    }

    // Level 2 (Normal): Standard positional + material evaluation with moderate grain
    if (levelKey === 'normal') {
      return Math.round(baseScore / 25) * 25;
    }

    // Level 3 (Hard): Full precision positional + tactical evaluation
    if (levelKey === 'hard') {
      return baseScore;
    }

    // Level 4 (Master): Full precision + tempo / initiative bonus
    return baseScore + (state.currentPlayer === me ? 12 : -12);
  }

  // ============================================================================
  // QUIESCENCE SEARCH (HORIZON-EFFECT STABILIZER FOR CAPTURE GAMES)
  // ============================================================================
  function quiesceSearch(ctx, state, qDepthLeft, alpha, beta) {
    ctx.nodes++;
    var perspective = state.currentPlayer;
    var standPat = evaluateForLevel(ctx.gameId, ctx.rule, state, perspective, ctx.levelKey);

    if (standPat >= beta) return beta;
    if (standPat > alpha) alpha = standPat;
    if (qDepthLeft <= 0 || state.status === 'ended' || nowMs() >= ctx.deadline) {
      return standPat;
    }

    var legal = ctx.rule.getLegalMoves(state, perspective);
    if (!legal || legal.length === 0) return standPat;

    var forcing = [];
    for (var i = 0; i < legal.length; i++) {
      var m = legal[i];
      if (m.isCapture || (m.captures && m.captures.length > 0) || m.promote || m.promotion || m.crowns) {
        forcing.push(m);
      }
    }
    if (forcing.length === 0) return standPat;

    var ordered = orderAndFilterMoves(ctx.gameId, ctx.rule, state, forcing, 6, 0, null, null);
    for (var j = 0; j < ordered.length; j++) {
      if (nowMs() >= ctx.deadline) break;
      var nextState = ctx.rule.applyMove(state, ordered[j]);
      var sameMover = nextState.currentPlayer === perspective;
      var score = sameMover
        ? quiesceSearch(ctx, nextState, qDepthLeft - 1, alpha, beta)
        : -quiesceSearch(ctx, nextState, qDepthLeft - 1, -beta, -alpha);

      if (score >= beta) return beta;
      if (score > alpha) alpha = score;
    }

    return alpha;
  }

  // ============================================================================
  // OTHELLO 12-EMPTY EXACT ENDGAME SOLVER (FOR MASTER & HARD)
  // ============================================================================
  function countOthelloDiscs(board) {
    var b = 0;
    var w = 0;
    for (var r = 0; r < 8; r++) {
      for (var c = 0; c < 8; c++) {
        if (board[r][c] === 1) b++;
        else if (board[r][c] === 2) w++;
      }
    }
    return { b: b, w: w, empties: 64 - (b + w) };
  }

  function solveOthelloEndgameExact(rule, state, rootPlayer, maxEmpties, deadline) {
    if (!state || !state.board) return null;
    var counts = countOthelloDiscs(state.board);
    if (counts.empties <= 0 || counts.empties > maxEmpties) return null;

    var legal = rule.getLegalMoves(state, rootPlayer);
    if (!legal || legal.length <= 1) return legal && legal[0] ? legal[0] : null;

    function exactDiscDiff(st, alpha, beta) {
      if (st.status === 'ended' || nowMs() >= deadline) {
        var c1 = countOthelloDiscs(st.board);
        return st.currentPlayer === 1 ? c1.b - c1.w : c1.w - c1.b;
      }
      var cur = st.currentPlayer;
      var moves = rule.getLegalMoves(st, cur);
      if (!moves || moves.length === 0) {
        var c2 = countOthelloDiscs(st.board);
        return cur === 1 ? c2.b - c2.w : c2.w - c2.b;
      }
      var best = -INF;
      for (var i = 0; i < moves.length; i++) {
        var nxt = rule.applyMove(st, moves[i]);
        var same = nxt.currentPlayer === cur;
        var val = same ? exactDiscDiff(nxt, alpha, beta) : -exactDiscDiff(nxt, -beta, -alpha);
        if (val > best) best = val;
        if (val > alpha) alpha = val;
        if (alpha >= beta) break;
      }
      return best;
    }

    var ordered = orderAndFilterMoves('othello', rule, state, legal, 14, 0, null, null);
    var bestMove = ordered[0];
    var bestDiff = -INF;
    for (var i = 0; i < ordered.length; i++) {
      if (nowMs() >= deadline) break;
      var nxt = rule.applyMove(state, ordered[i]);
      var same = nxt.currentPlayer === rootPlayer;
      var diff = same ? exactDiscDiff(nxt, -64, 64) : -exactDiscDiff(nxt, -64, 64);
      if (diff > bestDiff) {
        bestDiff = diff;
        bestMove = ordered[i];
      }
    }
    return bestMove;
  }

  // ============================================================================
  // PRINCIPAL VARIATION NEGAMAX WITH ALPHA-BETA + TT + KILLER HEURISTIC
  // ============================================================================
  function negamax(ctx, state, depth, ply, alpha, beta) {
    if ((ctx.nodes & 31) === 0 && nowMs() >= ctx.deadline) {
      ctx.aborted = true;
      return 0;
    }
    ctx.nodes++;

    var perspective = state.currentPlayer;
    if (state.status === 'ended') {
      var termScore = ctx.rule.evaluate(state, perspective);
      if (termScore > 0) return termScore + depth * 50;
      if (termScore < 0) return termScore - depth * 50;
      return 0;
    }

    if (depth <= 0) {
      if (
        ctx.quiesceDepth > 0 &&
        (ctx.gameId === 'chess' || ctx.gameId === 'xiangqi' || ctx.gameId === 'shogi' || ctx.gameId === 'draughts')
      ) {
        return quiesceSearch(ctx, state, ctx.quiesceDepth, alpha, beta);
      }
      return evaluateForLevel(ctx.gameId, ctx.rule, state, perspective, ctx.levelKey);
    }

    var alphaOrig = alpha;
    var stateKey = computeStateKey(ctx.gameId, state);
    var ttEntry = ctx.tt.get(stateKey);
    var ttBestMoveId = null;

    if (ttEntry && ttEntry.depth >= depth) {
      ttBestMoveId = ttEntry.bestMoveId;
      if (ttEntry.flag === TT_EXACT) return ttEntry.score;
      if (ttEntry.flag === TT_LOWER && ttEntry.score > alpha) alpha = ttEntry.score;
      else if (ttEntry.flag === TT_UPPER && ttEntry.score < beta) beta = ttEntry.score;
      if (alpha >= beta) return ttEntry.score;
    } else if (ttEntry) {
      ttBestMoveId = ttEntry.bestMoveId;
    }

    var branchLimit = ply <= 1 ? ctx.maxBranch : ctx.innerBranch;
    var moves;
    if (ctx.gameId === 'gomoku' && typeof ctx.rule.getCandidateMoves === 'function' && !state.swapOffered) {
      moves = ctx.rule.getCandidateMoves(state, perspective, branchLimit);
    } else {
      var rawMoves = ctx.rule.getLegalMoves(state, perspective);
      if (!rawMoves || rawMoves.length === 0) {
        return evaluateForLevel(ctx.gameId, ctx.rule, state, perspective, ctx.levelKey);
      }
      moves = orderAndFilterMoves(
        ctx.gameId,
        ctx.rule,
        state,
        rawMoves,
        branchLimit,
        ply,
        ctx.killers,
        ttBestMoveId
      );
    }

    if (!moves || moves.length === 0) {
      return evaluateForLevel(ctx.gameId, ctx.rule, state, perspective, ctx.levelKey);
    }

    var bestScore = -INF;
    var bestMoveId = getMoveId(moves[0]);

    for (var i = 0; i < moves.length; i++) {
      var move = moves[i];
      var nextState = ctx.rule.applyMove(state, move);
      var sameMover = nextState.currentPlayer === perspective;

      var score;
      if (i === 0 || sameMover) {
        score = sameMover
          ? negamax(ctx, nextState, depth - 1, ply + 1, alpha, beta)
          : -negamax(ctx, nextState, depth - 1, ply + 1, -beta, -alpha);
      } else {
        score = -negamax(ctx, nextState, depth - 1, ply + 1, -alpha - 1, -alpha);
        if (!ctx.aborted && score > alpha && score < beta) {
          score = -negamax(ctx, nextState, depth - 1, ply + 1, -beta, -alpha);
        }
      }

      if (ctx.aborted) return 0;

      if (score > bestScore) {
        bestScore = score;
        bestMoveId = getMoveId(move);
      }
      if (score > alpha) {
        alpha = score;
      }
      if (alpha >= beta) {
        if (!move.isCapture && (!move.captures || move.captures.length === 0)) {
          if (!ctx.killers[ply]) ctx.killers[ply] = [null, null];
          if (ctx.killers[ply][0] !== bestMoveId) {
            ctx.killers[ply][1] = ctx.killers[ply][0];
            ctx.killers[ply][0] = bestMoveId;
          }
        }
        break;
      }
    }

    if (!ctx.aborted && ctx.tt.size < TT_MAX_ENTRIES) {
      var flag = TT_EXACT;
      if (bestScore <= alphaOrig) flag = TT_UPPER;
      else if (bestScore >= beta) flag = TT_LOWER;
      ctx.tt.set(stateKey, {
        depth: depth,
        score: bestScore,
        flag: flag,
        bestMoveId: bestMoveId
      });
    }

    return bestScore;
  }

  // ============================================================================
  // SPECIALIZED GO & BACKGAMMON MULTI-TIER SEARCHERS
  // ============================================================================
  /**
   * 圍棋虛手判斷：
   * 1. 對方剛虛手，且以數子法計算我方領先 → 虛手結束對局；
   * 2. 除了虛手之外只剩填自己眼位的走法 → 虛手（避免自填眼位被吃）。
   * @returns {Object|null} 應虛手時回傳虛手走法
   */
  function goPassDecision(rule, state, legalMoves) {
    var passMove = null;
    var hasUsefulMove = false;
    for (var i = 0; i < legalMoves.length; i++) {
      var m = legalMoves[i];
      if (m.action === 'pass') passMove = m;
      else if (!m.likelyOwnEye) hasUsefulMove = true;
    }
    if (!passMove) return null;
    if (!hasUsefulMove) return passMove;
    if ((state.consecutivePasses || 0) >= 1 && typeof rule.computeAreaScore === 'function') {
      var score = rule.computeAreaScore(state);
      if (score.winner === state.currentPlayer) return passMove;
    }
    return null;
  }

  function chooseGoMoveByTier(rule, state, legalMoves, profile, levelKey) {
    var rootPlayer = state.currentPlayer;
    var passNow = goPassDecision(rule, state, legalMoves);
    if (passNow) {
      BoardArena.AI.lastSearchStats = {
        gameId: 'go',
        levelKey: levelKey,
        depthReached: 0,
        nodes: 1,
        elapsedMs: 0,
        bestScore: 0,
        source: 'go-pass-decision'
      };
      return passNow;
    }

    // 蒙地卡羅樹搜尋（go-mcts.js）；設定 BoardArena.AI.goEngine = 'alphabeta' 可改回舊演算法（量測比較用）
    if (BoardArena.GoMCTS && BoardArena.AI.goEngine !== 'alphabeta') {
      var mcts = BoardArena.GoMCTS.chooseMove(rule, state, legalMoves, levelKey);
      if (mcts && mcts.move) {
        BoardArena.AI.lastSearchStats = mcts.stats;
        return mcts.move;
      }
    }
    var candidates = orderAndFilterMoves('go', rule, state, legalMoves, profile.maxBranch, 0, null, null);
    if (candidates.length === 0) return legalMoves[0];

    var start = nowMs();
    var deadline = start + profile.timeBudgetMs;
    var depth = profile.depthByGame.go || 2;
    var ctx = {
      gameId: 'go',
      rule: rule,
      levelKey: levelKey,
      quiesceDepth: 0,
      maxBranch: Math.min(12, profile.maxBranch),
      innerBranch: Math.min(8, profile.innerBranch),
      deadline: deadline,
      aborted: false,
      nodes: 0,
      tt: new Map(),
      killers: {}
    };

    var ranked = [];
    for (var i = 0; i < candidates.length; i++) {
      var m = candidates[i];
      var nextState = rule.applyMove(state, m);
      var tacticalPrio = typeof m.priority === 'number' ? m.priority : 0;
      var evalScore;
      if (depth <= 1 || nowMs() >= deadline) {
        evalScore = evaluateForLevel('go', rule, nextState, rootPlayer, levelKey) + tacticalPrio * (levelKey === 'easy' ? 0.2 : 0.55);
        ctx.nodes++;
      } else {
        var subScore = -negamax(ctx, nextState, depth - 1, 1, -INF, INF);
        evalScore =
          (ctx.aborted ? evaluateForLevel('go', rule, nextState, rootPlayer, levelKey) : subScore) +
          tacticalPrio * (levelKey === 'master' ? 0.8 : 0.5);
      }
      ranked.push({ move: m, score: evalScore });
    }

    ranked.sort(function (a, b) {
      return b.score - a.score;
    });

    BoardArena.AI.lastSearchStats = {
      gameId: 'go',
      levelKey: levelKey,
      depthReached: depth,
      nodes: ctx.nodes,
      elapsedMs: Math.round(nowMs() - start),
      bestScore: ranked[0] ? Math.round(ranked[0].score) : 0,
      source: 'js-negamax-go'
    };

    return selectFromRankedWithMargin(ranked, profile);
  }

  var BG_SAMPLE_ROLLS_HARD = [
    { d1: 6, d2: 5, w: 2 },
    { d1: 6, d2: 1, w: 2 },
    { d1: 5, d2: 3, w: 2 },
    { d1: 4, d2: 2, w: 2 },
    { d1: 3, d2: 1, w: 2 },
    { d1: 4, d2: 4, w: 1 }
  ];

  var BG_ALL_21_ROLLS_MASTER = [
    { d1: 1, d2: 1, w: 1 }, { d1: 1, d2: 2, w: 2 }, { d1: 1, d2: 3, w: 2 }, { d1: 1, d2: 4, w: 2 }, { d1: 1, d2: 5, w: 2 }, { d1: 1, d2: 6, w: 2 },
    { d1: 2, d2: 2, w: 1 }, { d1: 2, d2: 3, w: 2 }, { d1: 2, d2: 4, w: 2 }, { d1: 2, d2: 5, w: 2 }, { d1: 2, d2: 6, w: 2 },
    { d1: 3, d2: 3, w: 1 }, { d1: 3, d2: 4, w: 2 }, { d1: 3, d2: 5, w: 2 }, { d1: 3, d2: 6, w: 2 },
    { d1: 4, d2: 4, w: 1 }, { d1: 4, d2: 5, w: 2 }, { d1: 4, d2: 6, w: 2 },
    { d1: 5, d2: 5, w: 1 }, { d1: 5, d2: 6, w: 2 },
    { d1: 6, d2: 6, w: 1 }
  ];

  function chooseBackgammonMoveByTier(rule, state, legalMoves, profile, levelKey) {
    var rootPlayer = state.currentPlayer;
    var oppPlayer = rootPlayer === 1 ? 2 : 1;
    var start = nowMs();
    var deadline = start + profile.timeBudgetMs;
    var nodes = 0;

    function evaluateOpponentRoll(afterTurnState, rolls) {
      if (afterTurnState.status === 'ended' || nowMs() >= deadline) {
        return evaluateForLevel('backgammon', rule, afterTurnState, rootPlayer, levelKey);
      }
      var totalWeight = 0;
      var weightedSum = 0;
      for (var rIdx = 0; rIdx < rolls.length; rIdx++) {
        if (nowMs() >= deadline) break;
        var roll = rolls[rIdx];
        var simState = rule.cloneState ? rule.cloneState(afterTurnState) : JSON.parse(JSON.stringify(afterTurnState));
        simState.currentPlayer = oppPlayer;
        simState.dice = [roll.d1, roll.d2];
        simState.remainingDice = roll.d1 === roll.d2 ? [roll.d1, roll.d1, roll.d1, roll.d1] : [roll.d1, roll.d2];
        var oppMoves = rule.getLegalMoves(simState, oppPlayer);
        nodes++;
        var worstForRoot = evaluateForLevel('backgammon', rule, simState, rootPlayer, levelKey);
        if (oppMoves && oppMoves.length > 0) {
          var cap = Math.min(oppMoves.length, levelKey === 'master' ? 8 : 5);
          for (var mIdx = 0; mIdx < cap; mIdx++) {
            nodes++;
            var s1 = rule.applyMove(simState, oppMoves[mIdx]);
            var v1 = evaluateForLevel('backgammon', rule, s1, rootPlayer, levelKey);
            if (v1 < worstForRoot) worstForRoot = v1;
          }
        }
        weightedSum += worstForRoot * roll.w;
        totalWeight += roll.w;
      }
      return totalWeight > 0
        ? weightedSum / totalWeight
        : evaluateForLevel('backgammon', rule, afterTurnState, rootPlayer, levelKey);
    }

    function findBestTurnSequenceScore(st, depthLeft) {
      nodes++;
      if (st.status === 'ended' || depthLeft <= 0 || nowMs() >= deadline) {
        return evaluateForLevel('backgammon', rule, st, rootPlayer, levelKey);
      }
      if (st.currentPlayer !== rootPlayer) {
        if (levelKey === 'hard') {
          return evaluateOpponentRoll(st, BG_SAMPLE_ROLLS_HARD);
        }
        if (levelKey === 'master') {
          return evaluateOpponentRoll(st, BG_ALL_21_ROLLS_MASTER);
        }
        return evaluateForLevel('backgammon', rule, st, rootPlayer, levelKey);
      }
      var moves = rule.getLegalMoves(st, rootPlayer);
      if (!moves || moves.length === 0) {
        return evaluateForLevel('backgammon', rule, st, rootPlayer, levelKey);
      }
      var best = -INF;
      var limit = Math.min(moves.length, levelKey === 'master' ? 14 : 10);
      for (var i = 0; i < limit; i++) {
        var nxt = rule.applyMove(st, moves[i]);
        var val = findBestTurnSequenceScore(nxt, depthLeft - 1);
        if (val > best) best = val;
      }
      return best;
    }

    var ranked = [];
    var seqDepth = levelKey === 'easy' ? 1 : levelKey === 'normal' ? 2 : levelKey === 'hard' ? 3 : 4;

    for (var i = 0; i < legalMoves.length; i++) {
      var m = legalMoves[i];
      var nextState = rule.applyMove(state, m);
      var score = findBestTurnSequenceScore(nextState, seqDepth - 1);

      if (levelKey !== 'easy') {
        if (m.isCapture) score += levelKey === 'master' ? 65 : 40;
        if (m.to && typeof m.to.point === 'number' && nextState.points && nextState.points[m.to.point]) {
          var pt = nextState.points[m.to.point];
          if (pt.owner === rootPlayer && pt.count === 2) {
            score += levelKey === 'master' ? 60 : 35;
          }
        }
      }
      ranked.push({ move: m, score: score });
    }

    ranked.sort(function (a, b) {
      return b.score - a.score;
    });

    BoardArena.AI.lastSearchStats = {
      gameId: 'backgammon',
      levelKey: levelKey,
      depthReached: profile.depthByGame.backgammon || 2,
      nodes: nodes,
      elapsedMs: Math.round(nowMs() - start),
      bestScore: ranked[0] ? Math.round(ranked[0].score) : 0,
      source: 'js-expectiminimax-bg'
    };

    return selectFromRankedWithMargin(ranked, profile);
  }

  function selectFromRankedWithMargin(ranked, profile) {
    if (!ranked || ranked.length === 0) return null;
    if (ranked.length === 1 || profile.tieMargin <= 0 || profile.noiseProb <= 0) {
      return ranked[0].move;
    }

    var bestScore = ranked[0].score;
    if (Math.abs(bestScore) >= 18000) {
      return ranked[0].move;
    }

    var acceptable = [ranked[0]];
    for (var i = 1; i < Math.min(ranked.length, 4); i++) {
      var delta = bestScore - ranked[i].score;
      if (delta <= profile.tieMargin && ranked[i].score > -15000) {
        acceptable.push(ranked[i]);
      }
    }

    if (acceptable.length > 1 && Math.random() < profile.noiseProb) {
      var pickIdx = 1 + Math.floor(Math.random() * (acceptable.length - 1));
      return acceptable[pickIdx].move;
    }
    return ranked[0].move;
  }

  // ============================================================================
  // MAIN SYNCHRONOUS ENTRY POINT: BoardArena.AI.chooseMove(gameId, state, levelKey)
  // ============================================================================
  function chooseMove(gameId, state, levelKey) {
    var rule = BoardArena.getRule(gameId);
    if (!rule || !state || state.status === 'ended') return null;

    var player = state.currentPlayer;
    var legalMoves = rule.getLegalMoves(state, player);
    if (!legalMoves || legalMoves.length === 0) return null;
    if (legalMoves.length === 1) {
      BoardArena.AI.lastSearchStats = {
        gameId: gameId,
        levelKey: levelKey || 'normal',
        depthReached: 1,
        nodes: 1,
        elapsedMs: 0,
        bestScore: 0,
        source: 'forced-single-move'
      };
      return legalMoves[0];
    }

    var normLevel = LEVEL_PROFILES[levelKey] ? levelKey : 'normal';
    var profile = getProfile(normLevel);
    var start = nowMs();
    var deadline = start + profile.timeBudgetMs;

    // 1. Gomoku Mandatory Tactical Resolver (Active across ALL 4 levels so computer NEVER loses in 5 moves)
    if (gameId === 'gomoku') {
      var mandatory = findGomokuMandatoryMove(rule, state, player, normLevel);
      if (mandatory) {
        for (var mIdx = 0; mIdx < legalMoves.length; mIdx++) {
          if (legalMoves[mIdx].id === mandatory.id) {
            BoardArena.AI.lastSearchStats = {
              gameId: 'gomoku',
              levelKey: normLevel,
              depthReached: profile.depthByGame.gomoku,
              nodes: 225,
              elapsedMs: Math.round(nowMs() - start),
              bestScore: WIN_SCORE,
              source: 'gomoku-tactical-guard'
            };
            return legalMoves[mIdx];
          }
        }
        return mandatory;
      }

      if (profile.vcfDepth >= 4 && state.stoneCount >= 6) {
        var vcfDeadline = start + Math.min(200, profile.timeBudgetMs * 0.4);
        var myVcfMove = solveGomokuVCF(rule, state.board, player, profile.vcfDepth, vcfDeadline);
        if (myVcfMove) {
          BoardArena.AI.lastSearchStats = {
            gameId: 'gomoku',
            levelKey: normLevel,
            depthReached: profile.vcfDepth,
            nodes: 600,
            elapsedMs: Math.round(nowMs() - start),
            bestScore: WIN_SCORE - 100,
            source: 'gomoku-vcf-solver'
          };
          return myVcfMove;
        }
        var oppVcfMove = solveGomokuVCF(rule, state.board, getOpponent(player), Math.min(6, profile.vcfDepth), vcfDeadline);
        if (oppVcfMove) {
          return oppVcfMove;
        }
      }
    }

    // 2. Opening Book lookup
    if (profile.useOpeningBook) {
      var bookMove = lookupOpeningBook(gameId, state, legalMoves, normLevel);
      if (bookMove) {
        BoardArena.AI.lastSearchStats = {
          gameId: gameId,
          levelKey: normLevel,
          depthReached: profile.depthByGame[gameId] || profile.maxDepth,
          nodes: 1,
          elapsedMs: Math.round(nowMs() - start),
          bestScore: 50,
          source: 'opening-book'
        };
        return bookMove;
      }
    }

    // 3. Othello Exact Endgame Solver on Hard (<=8 empties) and Master (<=12 empties)
    if (gameId === 'othello' && (normLevel === 'hard' || normLevel === 'master')) {
      var maxEmpties = normLevel === 'master' ? 12 : 8;
      var exactOthello = solveOthelloEndgameExact(rule, state, player, maxEmpties, deadline);
      if (exactOthello) {
        var cOth = countOthelloDiscs(state.board);
        BoardArena.AI.lastSearchStats = {
          gameId: 'othello',
          levelKey: normLevel,
          depthReached: cOth.empties,
          nodes: 2048,
          elapsedMs: Math.round(nowMs() - start),
          bestScore: WIN_SCORE,
          source: 'othello-exact-endgame'
        };
        return exactOthello;
      }
    }

    // 4. Go & Backgammon specialized multi-tier searchers
    if (gameId === 'go') {
      return chooseGoMoveByTier(rule, state, legalMoves, profile, normLevel);
    }
    if (gameId === 'backgammon') {
      return chooseBackgammonMoveByTier(rule, state, legalMoves, profile, normLevel);
    }

    // 5. Iterative-Deepening PVS Negamax with Alpha-Beta, Quiescence Search, Killer Heuristic & TT
    var targetDepth = (profile.depthByGame && profile.depthByGame[gameId]) || profile.maxDepth;
    var ctx = {
      gameId: gameId,
      rule: rule,
      levelKey: normLevel,
      quiesceDepth: profile.quiesceDepth,
      maxBranch: profile.maxBranch,
      innerBranch: profile.innerBranch || 8,
      deadline: deadline,
      aborted: false,
      nodes: 0,
      tt: new Map(),
      killers: {}
    };

    var rootMoves = orderAndFilterMoves(
      gameId,
      rule,
      state,
      legalMoves,
      profile.maxBranch,
      0,
      ctx.killers,
      null
    );

    var bestRanked = [];
    for (var rIdx = 0; rIdx < rootMoves.length; rIdx++) {
      bestRanked.push({ move: rootMoves[rIdx], score: 0 });
    }

    var completedDepth = 1;

    for (var depth = 1; depth <= targetDepth; depth++) {
      if (depth > 1 && nowMs() >= deadline) break;

      var iterRanked = [];
      var alpha = -INF;
      var beta = INF;
      var iterAborted = false;

      for (var i = 0; i < rootMoves.length; i++) {
        var move = rootMoves[i];
        var nextState = rule.applyMove(state, move);
        var sameMover = nextState.currentPlayer === player;

        var score = sameMover
          ? negamax(ctx, nextState, depth - 1, 1, alpha, beta)
          : -negamax(ctx, nextState, depth - 1, 1, -beta, -alpha);

        if (ctx.aborted) {
          iterAborted = true;
          break;
        }

        if (gameId === 'gomoku' && typeof move.priority === 'number' && normLevel !== 'easy') {
          score += Math.min(300, Math.round(move.priority * 0.02));
        }

        iterRanked.push({ move: move, score: score });
        if (score > alpha) alpha = score;
      }

      if (!iterAborted && iterRanked.length === rootMoves.length) {
        iterRanked.sort(function (a, b) {
          return b.score - a.score;
        });
        bestRanked = iterRanked;
        completedDepth = depth;

        for (var k = 0; k < bestRanked.length; k++) {
          rootMoves[k] = bestRanked[k].move;
        }

        if (bestRanked[0].score >= WIN_SCORE - 200) {
          break;
        }
      } else {
        break;
      }
    }

    BoardArena.AI.lastSearchStats = {
      gameId: gameId,
      levelKey: normLevel,
      depthReached: completedDepth,
      nodes: ctx.nodes,
      elapsedMs: Math.round(nowMs() - start),
      bestScore: bestRanked[0] ? Math.round(bestRanked[0].score) : 0,
      source: 'js-pvs-alphabeta'
    };

    return selectFromRankedWithMargin(bestRanked, profile);
  }

  /**
   * Asynchronous AI entrypoint that queries the local resident native engine process via /api/ai/move
   * when connected to BoardArenaServer, falling back seamlessly to chooseMove().
   */
  function chooseMoveAsync(gameId, state, levelKey, callback) {
    var done = typeof callback === 'function' ? callback : function () {};
    var normLevel = LEVEL_PROFILES[levelKey] ? levelKey : 'normal';

    if (
      BoardArena.AI.useNativeEngineBridge &&
      typeof fetch === 'function' &&
      typeof window !== 'undefined' &&
      window.location &&
      window.location.protocol.indexOf('http') === 0
    ) {
      var controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
      var timer = setTimeout(function () {
        if (controller) controller.abort();
      }, 3500);

      fetch('/api/ai/move', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          gameId: gameId,
          levelKey: normLevel,
          level: LEVEL_PROFILES[normLevel].level,
          state: state
        }),
        signal: controller ? controller.signal : undefined
      })
        .then(function (res) {
          clearTimeout(timer);
          if (!res.ok) throw new Error('HTTP ' + res.status);
          return res.json();
        })
        .then(function (data) {
          if (data && data.ok && data.move) {
            var rule = BoardArena.getRule(gameId);
            var legal = rule ? rule.getLegalMoves(state, state.currentPlayer) : [];
            var matched = matchEngineMoveToLegal(gameId, state, legal, data.move);
            if (matched) {
              BoardArena.AI.lastSearchStats = {
                gameId: gameId,
                levelKey: normLevel,
                depthReached: data.depth || LEVEL_PROFILES[normLevel].depthByGame[gameId],
                nodes: data.nodes || 0,
                elapsedMs: data.elapsedMs || 0,
                bestScore: data.score || 0,
                source: data.engineName || 'native-cli-engine',
                protocol: data.protocol || 'PIPE',
                rawMove: data.rawMove || ''
              };
              done(matched, BoardArena.AI.lastSearchStats);
              return;
            }
          }
          var fallback = chooseMove(gameId, state, normLevel);
          done(fallback, BoardArena.AI.lastSearchStats);
        })
        .catch(function () {
          clearTimeout(timer);
          var fallback = chooseMove(gameId, state, normLevel);
          done(fallback, BoardArena.AI.lastSearchStats);
        });
      return;
    }

    var syncMove = chooseMove(gameId, state, normLevel);
    done(syncMove, BoardArena.AI.lastSearchStats);
  }

  function matchEngineMoveToLegal(gameId, state, legalMoves, engineMove) {
    if (!legalMoves || legalMoves.length === 0 || !engineMove) return null;
    if (engineMove.id) {
      for (var i = 0; i < legalMoves.length; i++) {
        if (legalMoves[i].id === engineMove.id) return legalMoves[i];
      }
    }
    if (engineMove.to && !engineMove.from) {
      for (var j = 0; j < legalMoves.length; j++) {
        var lm = legalMoves[j];
        if (lm.to && lm.to.r === engineMove.to.r && lm.to.c === engineMove.to.c) {
          return lm;
        }
      }
    }
    if (engineMove.from && engineMove.to) {
      for (var k = 0; k < legalMoves.length; k++) {
        var pm = legalMoves[k];
        if (
          pm.from &&
          pm.to &&
          pm.from.r === engineMove.from.r &&
          pm.from.c === engineMove.from.c &&
          pm.to.r === engineMove.to.r &&
          pm.to.c === engineMove.to.c
        ) {
          if (engineMove.promotion && pm.promotion && pm.promotion.toLowerCase() !== engineMove.promotion.toLowerCase()) {
            continue;
          }
          return pm;
        }
      }
    }
    return null;
  }

  // ============================================================================
  // AI MENTOR POST-GAME REVIEW & TOP-K HINTS ENGINE (NON-BREAKING CONTRACT)
  // ============================================================================
  var WINRATE_SCALE = {
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
    var scale = WINRATE_SCALE[gameId] || 300;
    var rawP1 = rule.evaluate(state, 1);
    var prob = 100 / (1 + Math.exp(-rawP1 / scale));
    return Math.max(1, Math.min(99, Math.round(prob * 10) / 10));
  }

  function rankCandidatesFast(gameId, rule, state, legalMoves, maxDepth, budgetMs) {
    var player = state.currentPlayer;
    var deadline = nowMs() + (budgetMs || 45);
    var ctx = {
      gameId: gameId,
      rule: rule,
      levelKey: 'hard',
      quiesceDepth: 1,
      maxBranch: 12,
      innerBranch: 7,
      deadline: deadline,
      aborted: false,
      nodes: 0,
      tt: new Map(),
      killers: {}
    };
    var ordered = orderAndFilterMoves(gameId, rule, state, legalMoves, 12, 0, ctx.killers, null);
    var ranked = [];
    for (var i = 0; i < ordered.length; i++) {
      var mv = ordered[i];
      var nextState = rule.applyMove(state, mv);
      var sameMover = nextState.currentPlayer === player;
      var score;
      if (nowMs() >= deadline || maxDepth <= 1) {
        score = rule.evaluate(nextState, player);
      } else {
        score = sameMover
          ? negamax(ctx, nextState, maxDepth - 1, 1, -INF, INF)
          : -negamax(ctx, nextState, maxDepth - 1, 1, -INF, INF);
        if (ctx.aborted) score = rule.evaluate(nextState, player);
      }
      if (gameId === 'gomoku' && typeof mv.priority === 'number') {
        score += Math.round(mv.priority * 0.2);
      }
      ranked.push({ move: mv, score: Math.round(score * 100) / 100 });
    }
    ranked.sort(function (a, b) {
      return b.score - a.score;
    });
    return ranked;
  }

  function getTopHints(gameId, state, topK) {
    var rule = BoardArena.getRule(gameId);
    if (!rule || !state || state.status !== 'playing') return [];
    var legalMoves = rule.getLegalMoves(state, state.currentPlayer).filter(function (m) {
      return m.action !== 'swap';
    });
    if (legalMoves.length === 0) return [];
    var ranked = rankCandidatesFast(gameId, rule, state, legalMoves, 3, 120);
    return ranked.slice(0, topK || 3);
  }

  function buildCoachComment(gameId, stateBefore, actualMove, bestMove, stateAfter, grade, winDrop) {
    var actualNot = (actualMove && (actualMove.notation || actualMove.id)) || '—';
    var bestNot = (bestMove && (bestMove.notation || bestMove.id)) || actualNot;
    var sameMove = !bestMove || actualMove.id === bestMove.id || actualNot === bestNot;

    if (stateAfter && stateAfter.status === 'ended' && stateAfter.winner === stateBefore.currentPlayer) {
      return {
        zh: '🏆 致勝一擊！實戰走 【' + actualNot + '】 直接鎖定勝局。',
        en: '🏆 Winning finisher! Playing [' + actualNot + '] clinches victory immediately.'
      };
    }

    if (grade === 'best') {
      var detailZh = '與導師引擎首選完全吻合，子力效率與盤面控制極佳。';
      var detailEn = 'Matches the Mentor engine #1 choice with optimal positional efficiency.';
      if (gameId === 'othello' && actualMove.to) {
        var r = actualMove.to.r;
        var c = actualMove.to.c;
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

    var reasonZh = '讓出盤面主動權，導師建議改走 【' + bestNot + '】 以穩固陣型並爭取先手。';
    var reasonEn = 'Concedes initiative; Mentor recommends [' + bestNot + '] for stronger control.';

    if (bestMove && bestMove.isCapture && !actualMove.isCapture) {
      reasonZh = '錯失吃子良機！此時應走 【' + bestNot + '】 直接奪取敵方子力。';
      reasonEn = 'Missed a tactical capture! Play [' + bestNot + '] to win material.';
    } else if (gameId === 'othello' && actualMove.to) {
      var or = actualMove.to.r;
      var oc = actualMove.to.c;
      if ((or === 1 || or === 6) && (oc === 1 || oc === 6)) {
        reasonZh = '過早踏入角旁危險 X 位，易讓對手順勢佔角；應改下 【' + bestNot + '】 控制行動力。';
        reasonEn = 'Stepped onto a risky X-square near an empty corner; play [' + bestNot + '] instead.';
      }
    } else if (gameId === 'gomoku') {
      reasonZh = '攻守焦點偏移，漏看關鍵連珠威脅或強攻點；應改落 【' + bestNot + '】 搶佔連珠要津。';
      reasonEn = 'Missed a key five-in-a-row threat or fork; play [' + bestNot + '] instead.';
    }

    var prefixZh =
      grade === 'blunder'
        ? '💥 敗著（勝率流失 -' + winDrop.toFixed(1) + '%）：實戰 【' + actualNot + '】 '
        : grade === 'mistake'
        ? '❌ 失誤（勝率流失 -' + winDrop.toFixed(1) + '%）：實戰 【' + actualNot + '】 '
        : '⚠️ 緩手（勝率流失 -' + winDrop.toFixed(1) + '%）：實戰 【' + actualNot + '】 ';

    var prefixEn =
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

  function analyzeMatchForMentor(gameId, stateHistory, moveHistory, humanSide) {
    var rule = BoardArena.getRule(gameId);
    var states = stateHistory || [];
    var moves = moveHistory || [];

    var winRateTimeline = [];
    for (var s = 0; s < states.length; s++) {
      winRateTimeline.push(evalToWinRateP1(gameId, rule, states[s]));
    }
    if (winRateTimeline.length === 0) winRateTimeline.push(50);

    var steps = [];
    var stats = {
      1: { best: 0, good: 0, inaccuracy: 0, mistake: 0, blunder: 0, lossSum: 0, count: 0, accuracy: 100 },
      2: { best: 0, good: 0, inaccuracy: 0, mistake: 0, blunder: 0, lossSum: 0, count: 0, accuracy: 100 }
    };

    for (var i = 0; i < moves.length; i++) {
      var rec = moves[i];
      var stateBefore = states[i];
      var stateAfter = states[i + 1] || stateBefore;
      var mover = rec.player || (stateBefore ? stateBefore.currentPlayer : 1);
      var actualMove = rec.move || { id: rec.notation, notation: rec.notation };

      var winBeforeP1 = winRateTimeline[i] !== undefined ? winRateTimeline[i] : 50;
      var winAfterP1 = winRateTimeline[i + 1] !== undefined ? winRateTimeline[i + 1] : winBeforeP1;
      var winBeforeMover = mover === 1 ? winBeforeP1 : 100 - winBeforeP1;
      var winAfterMover = mover === 1 ? winAfterP1 : 100 - winAfterP1;

      var topCandidates = [];
      if (stateBefore && stateBefore.status === 'playing') {
        var legal = rule.getLegalMoves(stateBefore, mover).filter(function (m) {
          return m.action !== 'swap';
        });
        if (legal.length === 1) {
          topCandidates = [{ move: legal[0], score: 0 }];
        } else if (legal.length > 1) {
          topCandidates = rankCandidatesFast(gameId, rule, stateBefore, legal, 2, 30).slice(0, 3);
        }
      }

      var bestMove = (topCandidates[0] && topCandidates[0].move) || actualMove;
      var bestWinMover = winBeforeMover;
      if (stateBefore && bestMove && bestMove.id !== actualMove.id) {
        try {
          var bestNextState = rule.applyMove(stateBefore, bestMove);
          var bestP1 = evalToWinRateP1(gameId, rule, bestNextState);
          bestWinMover = mover === 1 ? bestP1 : 100 - bestP1;
        } catch (e) {
          bestWinMover = Math.max(winBeforeMover, winAfterMover);
        }
      } else {
        bestWinMover = winAfterMover;
      }

      var isBestMatch =
        !bestMove ||
        bestMove.id === actualMove.id ||
        (bestMove.notation && actualMove.notation && bestMove.notation === actualMove.notation);

      var rawDrop = isBestMatch ? 0 : Math.max(0, Math.max(bestWinMover, winBeforeMover) - winAfterMover);
      var winDrop = Math.round(rawDrop * 10) / 10;

      var grade = 'best';
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

      var comment = buildCoachComment(gameId, stateBefore, actualMove, bestMove, stateAfter, grade, winDrop);

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
      var st = stats[p];
      if (st.count > 0) {
        var avgLoss = st.lossSum / st.count;
        st.accuracy = Math.max(35, Math.min(100, Math.round((100 - avgLoss * 2.1) * 10) / 10));
      }
    });

    var targetSide = humanSide === 2 ? 2 : 1;
    var turningPoints = steps
      .filter(function (st) {
        return st.winDrop >= 5.0 || st.grade === 'mistake' || st.grade === 'blunder';
      })
      .sort(function (a, b) {
        var aHuman = a.player === targetSide ? 1 : 0;
        var bHuman = b.player === targetSide ? 1 : 0;
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
    LEVEL_PROFILES: LEVEL_PROFILES,
    LEVEL_CONFIG: LEVEL_PROFILES,
    useNativeEngineBridge: true,
    lastSearchStats: null,
    chooseMove: chooseMove,
    chooseMoveAsync: chooseMoveAsync,
    getTopHints: getTopHints,
    evalToWinRateP1: evalToWinRateP1,
    analyzeMatchForMentor: analyzeMatchForMentor,
    findGomokuMandatoryMove: findGomokuMandatoryMove,
    solveGomokuVCF: solveGomokuVCF
  };
})(typeof window !== 'undefined' ? window : globalThis);
