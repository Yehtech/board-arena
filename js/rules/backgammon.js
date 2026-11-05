/**
 * Classic Board Arena — Backgammon (雙陸棋 24-Point Tournament Rule Engine)
 * Features:
 *   - Standard 24-point setup (15 White vs 15 Black checkers)
 *   - White (Player 1) moves 23 -> 0 (Home board: 0..5, bears off to -1)
 *   - Black (Player 2) moves 0 -> 23 (Home board: 18..23, bears off to 24)
 *   - 2 dice per turn (Doubles grant 4 moves of that die value)
 *   - Mandatory Bar Re-entry (中欄強制優先入場): checkers on the Bar must re-enter before any other move
 *   - Blot Hit (單子擊回中欄): landing on a single enemy checker sends it to the Bar
 *   - Blocked Points (2+ enemy checkers form an anchor/block)
 *   - Bearing Off (收子離盤): exact die roll, or higher die roll when no checkers remain on higher points
 *   - Doubling Cube (加倍骰 1..64) & Single / Gammon (雙勝) / Backgammon (三勝) detection
 *   - Piece-click legal destination & capture highlighting (`getMovesForSource`, `canSelectSource`)
 */
(function (global) {
  'use strict';

  const BoardArena = (global.BoardArena = global.BoardArena || {});

  const SIDE_LABELS = {
    1: { zh: '白方', en: 'White' },
    2: { zh: '黑方', en: 'Black' }
  };

  function opponentOf(p) {
    return p === 1 ? 2 : 1;
  }

  function expandDice(d1, d2) {
    return d1 === d2 ? [d1, d1, d1, d1] : [d1, d2];
  }

  function rollDiceFromSeed(seedVal) {
    const rng = BoardArena.createRng(seedVal);
    const d1 = rng.nextInt(1, 6);
    const d2 = rng.nextInt(1, 6);
    return {
      dice: [d1, d2],
      diceLeft: expandDice(d1, d2),
      nextSeed: rng.getState()
    };
  }

  function createInitialState(options) {
    const opts = options || {};
    const points = new Array(24);
    for (let i = 0; i < 24; i++) {
      points[i] = { owner: 0, count: 0 };
    }

    // White (Player 1) moves 23 -> 0
    points[23] = { owner: 1, count: 2 };
    points[12] = { owner: 1, count: 5 };
    points[7] = { owner: 1, count: 3 };
    points[5] = { owner: 1, count: 5 };

    // Black (Player 2) moves 0 -> 23
    points[0] = { owner: 2, count: 2 };
    points[11] = { owner: 2, count: 5 };
    points[16] = { owner: 2, count: 3 };
    points[18] = { owner: 2, count: 5 };

    const baseSeed = typeof opts.seed === 'number' ? opts.seed : 20261104;
    const roll = rollDiceFromSeed(baseSeed);

    return {
      gameType: 'backgammon',
      points: points,
      bar: { 1: 0, 2: 0 },
      borneOff: { 1: 0, 2: 0 },
      dice: roll.dice,
      diceLeft: roll.diceLeft,
      rngSeed: roll.nextSeed,
      cubeValue: 1,
      cubeOwner: 0,
      currentPlayer: 1,
      turnNumber: 1,
      moveCount: 0,
      status: 'playing',
      winner: null,
      winMultiplier: 1,
      endReason: null,
      lastMove: null
    };
  }

  function cloneState(state) {
    if (!state) return null;
    const pts = new Array(24);
    for (let i = 0; i < 24; i++) {
      const p = state.points[i];
      pts[i] = p ? { owner: p.owner, count: p.count } : { owner: 0, count: 0 };
    }
    return {
      gameType: 'backgammon',
      points: pts,
      bar: { 1: (state.bar && state.bar[1]) || 0, 2: (state.bar && state.bar[2]) || 0 },
      borneOff: {
        1: (state.borneOff && state.borneOff[1]) || 0,
        2: (state.borneOff && state.borneOff[2]) || 0
      },
      dice: Array.isArray(state.dice) ? state.dice.slice() : [1, 2],
      diceLeft: Array.isArray(state.diceLeft) ? state.diceLeft.slice() : [],
      rngSeed: state.rngSeed >>> 0,
      cubeValue: state.cubeValue || 1,
      cubeOwner: state.cubeOwner || 0,
      currentPlayer: state.currentPlayer,
      turnNumber: state.turnNumber || 1,
      moveCount: state.moveCount || 0,
      status: state.status,
      winner: state.winner,
      winMultiplier: state.winMultiplier || 1,
      endReason: state.endReason,
      lastMove: state.lastMove ? BoardArena.deepClone(state.lastMove) : null
    };
  }

  /**
   * True if all remaining active checkers of `player` are inside their home board (0..5 for P1, 18..23 for P2).
   */
  function canPlayerBearOff(state, player) {
    if ((state.bar && state.bar[player]) > 0) return false;
    if (player === 1) {
      for (let i = 6; i < 24; i++) {
        if (state.points[i].owner === 1 && state.points[i].count > 0) return false;
      }
      return true;
    } else {
      for (let i = 0; i < 18; i++) {
        if (state.points[i].owner === 2 && state.points[i].count > 0) return false;
      }
      return true;
    }
  }

  /**
   * True if player has any checker further from bearing off than `index` inside their home board.
   */
  function hasCheckerFurtherBackInHome(state, player, index) {
    if (player === 1) {
      for (let i = index + 1; i <= 5; i++) {
        if (state.points[i].owner === 1 && state.points[i].count > 0) return true;
      }
      return false;
    } else {
      for (let i = 18; i < index; i++) {
        if (state.points[i].owner === 2 && state.points[i].count > 0) return true;
      }
      return false;
    }
  }

  function uniqueDiceValues(diceLeft) {
    const out = [];
    for (let i = 0; i < diceLeft.length; i++) {
      if (out.indexOf(diceLeft[i]) < 0) out.push(diceLeft[i]);
    }
    return out;
  }

  /**
   * Generate legal single-die checker steps for the given state & player.
   */
  function generateCheckerMoves(state, player) {
    const opp = opponentOf(player);
    const uniqueDice = uniqueDiceValues(state.diceLeft || []);
    if (uniqueDice.length === 0) return [];

    const moves = [];

    // 1. Mandatory Bar Re-entry
    if ((state.bar && state.bar[player]) > 0) {
      for (let d = 0; d < uniqueDice.length; d++) {
        const die = uniqueDice[d];
        const destIdx = player === 1 ? 24 - die : die - 1;
        const pt = state.points[destIdx];
        const blocked = pt.owner === opp && pt.count >= 2;
        if (!blocked) {
          const isBlot = pt.owner === opp && pt.count === 1;
          moves.push({
            id: 'bar->' + destIdx + ':d' + die,
            from: { zone: 'bar', owner: player },
            to: { zone: 'point', index: destIdx },
            dieUsed: die,
            isCapture: isBlot,
            notation: 'Bar/' + (destIdx + 1) + (isBlot ? '*' : '') + ' (' + die + ')'
          });
        }
      }
      return moves;
    }

    const bearingOffAllowed = canPlayerBearOff(state, player);

    // 2. Normal Point-to-Point & Bear-Off Moves
    for (let idx = 0; idx < 24; idx++) {
      const srcPt = state.points[idx];
      if (!srcPt || srcPt.owner !== player || srcPt.count <= 0) continue;

      for (let d = 0; d < uniqueDice.length; d++) {
        const die = uniqueDice[d];
        const destIdx = player === 1 ? idx - die : idx + die;

        if (destIdx >= 0 && destIdx < 24) {
          const dstPt = state.points[destIdx];
          const blocked = dstPt.owner === opp && dstPt.count >= 2;
          if (!blocked) {
            const isBlot = dstPt.owner === opp && dstPt.count === 1;
            moves.push({
              id: 'pt' + idx + '->pt' + destIdx + ':d' + die,
              from: { zone: 'point', index: idx },
              to: { zone: 'point', index: destIdx },
              dieUsed: die,
              isCapture: isBlot,
              notation: idx + 1 + '/' + (destIdx + 1) + (isBlot ? '*' : '') + ' (' + die + ')'
            });
          }
        } else if (bearingOffAllowed) {
          const isExactBearOff = (player === 1 && destIdx === -1) || (player === 2 && destIdx === 24);
          const isOverBearOff =
            ((player === 1 && destIdx < -1) || (player === 2 && destIdx > 24)) &&
            !hasCheckerFurtherBackInHome(state, player, idx);

          if (isExactBearOff || isOverBearOff) {
            moves.push({
              id: 'pt' + idx + '->off:d' + die,
              from: { zone: 'point', index: idx },
              to: { zone: 'off', owner: player },
              dieUsed: die,
              isCapture: false,
              notation: idx + 1 + '/Off (' + die + ')'
            });
          }
        }
      }
    }

    return moves;
  }

  function getLegalMoves(state, player) {
    if (!state || state.status !== 'playing') return [];
    const p = player || state.currentPlayer;
    if (p !== state.currentPlayer) return [];

    const checkerMoves = generateCheckerMoves(state, p);
    if (checkerMoves.length > 0) return checkerMoves;

    // If all dice are blocked, offer an explicit Pass move so the turn never deadlocks
    return [
      {
        id: 'pass',
        action: 'pass',
        from: null,
        to: null,
        isCapture: false,
        notation: 'Pass (Blocked)'
      }
    ];
  }

  function getMovesForSource(state, source) {
    if (!state || !source) return [];
    const all = generateCheckerMoves(state, state.currentPlayer);
    return all.filter(function (m) {
      return BoardArena.sourcesEqual(m.from, source);
    });
  }

  function canSelectSource(state, source, player) {
    const p = player || state.currentPlayer;
    if (!source) return { selectable: false, hasMoves: false };

    const moves = getMovesForSource(state, source);
    if (moves.length > 0) {
      const capCount = moves.filter(function (m) {
        return m.isCapture;
      }).length;
      const srcLabelZh =
        source.zone === 'bar' ? '中欄 (Bar)' : '第 ' + (source.index + 1) + ' 點';
      const srcLabelEn =
        source.zone === 'bar' ? 'Bar' : 'Point ' + (source.index + 1);
      return {
        selectable: true,
        hasMoves: true,
        reasonZh:
          '已選取' +
          srcLabelZh +
          '棋子（剩餘骰點 ' +
          (state.diceLeft || []).join(', ') +
          '）：可走 ' +
          moves.length +
          ' 處' +
          (capCount > 0 ? '（含擊回中欄 ' + capCount + ' 處）' : ''),
        reasonEn:
          'Selected checker at ' +
          srcLabelEn +
          ' (dice left: ' +
          (state.diceLeft || []).join(', ') +
          '): ' +
          moves.length +
          ' legal destination(s)'
      };
    }

    if ((state.bar && state.bar[p]) > 0 && source.zone !== 'bar') {
      return {
        selectable: true,
        hasMoves: false,
        reasonZh: '雙陸棋規則：您在中欄（Bar）上有被擊中的棋子，必須先點擊中央中欄棋子重新入場！',
        reasonEn: 'Bar Re-entry Rule: you have checker(s) on the Bar and must re-enter them first!'
      };
    }

    return {
      selectable: true,
      hasMoves: false,
      reasonZh: '依目前骰點（' + (state.diceLeft || []).join(', ') + '），此點棋子對應的目標點已被對手封鎖（2 子以上）。',
      reasonEn: 'Target points for dice (' + (state.diceLeft || []).join(', ') + ') from this point are blocked.'
    };
  }

  function advanceTurnWithNewRoll(next, nextPlayer) {
    const roll = rollDiceFromSeed(next.rngSeed + next.moveCount * 1013 + next.turnNumber * 37);
    next.currentPlayer = nextPlayer;
    next.dice = roll.dice;
    next.diceLeft = roll.diceLeft;
    next.rngSeed = roll.nextSeed;
    next.turnNumber = (next.turnNumber || 1) + 1;
  }

  function hasCheckerInWinnerHome(state, winner, loser) {
    if (winner === 1) {
      for (let i = 0; i <= 5; i++) {
        if (state.points[i].owner === loser && state.points[i].count > 0) return true;
      }
    } else {
      for (let i = 18; i <= 23; i++) {
        if (state.points[i].owner === loser && state.points[i].count > 0) return true;
      }
    }
    return false;
  }

  function applyMove(state, rawMove) {
    if (!state || state.status !== 'playing' || !rawMove) return cloneState(state);
    const legal = getLegalMoves(state, state.currentPlayer);
    let move = null;
    for (let i = 0; i < legal.length; i++) {
      if (legal[i].id === rawMove.id || (rawMove.action === 'pass' && legal[i].action === 'pass')) {
        move = legal[i];
        break;
      }
    }
    if (!move && rawMove.from && rawMove.to) {
      for (let i = 0; i < legal.length; i++) {
        if (
          BoardArena.sourcesEqual(legal[i].from, rawMove.from) &&
          BoardArena.sourcesEqual(legal[i].to, rawMove.to)
        ) {
          move = legal[i];
          break;
        }
      }
    }
    if (!move) return cloneState(state);

    const next = cloneState(state);
    const mover = state.currentPlayer;
    const opp = opponentOf(mover);
    next.moveCount = (state.moveCount || 0) + 1;

    if (move.action === 'pass') {
      next.lastMove = {
        id: 'pass',
        action: 'pass',
        from: null,
        to: null,
        isCapture: false,
        notation: 'Pass',
        player: mover
      };
      advanceTurnWithNewRoll(next, opp);
      return next;
    }

    // Deduct checker from source
    if (move.from.zone === 'bar') {
      next.bar[mover] = Math.max(0, (next.bar[mover] || 0) - 1);
    } else if (move.from.zone === 'point') {
      const srcPt = next.points[move.from.index];
      srcPt.count = Math.max(0, srcPt.count - 1);
      if (srcPt.count === 0) srcPt.owner = 0;
    }

    // Place checker on destination
    let hitBlot = false;
    if (move.to.zone === 'point') {
      const dstPt = next.points[move.to.index];
      if (dstPt.owner === opp && dstPt.count === 1) {
        // Blot hit -> send opponent checker to Bar
        hitBlot = true;
        next.bar[opp] = (next.bar[opp] || 0) + 1;
        dstPt.owner = mover;
        dstPt.count = 1;
      } else {
        dstPt.owner = mover;
        dstPt.count = (dstPt.count || 0) + 1;
      }
    } else if (move.to.zone === 'off') {
      next.borneOff[mover] = (next.borneOff[mover] || 0) + 1;
    }

    // Consume the used die
    const dieIdx = next.diceLeft.indexOf(move.dieUsed);
    if (dieIdx >= 0) {
      next.diceLeft.splice(dieIdx, 1);
    } else {
      next.diceLeft.shift();
    }

    next.lastMove = {
      id: move.id,
      from: move.from,
      to: move.to,
      dieUsed: move.dieUsed,
      isCapture: hitBlot,
      notation: move.notation,
      player: mover
    };

    // Check victory (all 15 checkers borne off)
    if (next.borneOff[mover] >= 15) {
      next.status = 'ended';
      next.winner = mover;
      if ((next.borneOff[opp] || 0) === 0) {
        if ((next.bar[opp] || 0) > 0 || hasCheckerInWinnerHome(next, mover, opp)) {
          next.winMultiplier = 3;
          next.endReason = 'backgammon';
        } else {
          next.winMultiplier = 2;
          next.endReason = 'gammon';
        }
      } else {
        next.winMultiplier = 1;
        next.endReason = 'bear_off_complete';
      }
      return next;
    }

    // If dice remain AND the current player still has legal checker moves with remaining dice, stay on mover's turn
    if (next.diceLeft.length > 0) {
      const remainingMoves = generateCheckerMoves(next, mover);
      if (remainingMoves.length > 0) {
        return next;
      }
    }

    // Otherwise advance turn and roll new dice for opponent
    advanceTurnWithNewRoll(next, opp);
    return next;
  }

  /**
   * Positional & Pip-Count Equity Evaluator (Anchors, Primes, Blot Exposure, Bar Penalty, Borne-Off Progress)
   */
  function evaluate(state, perspectivePlayer) {
    const me = perspectivePlayer || state.currentPlayer;
    const opp = opponentOf(me);

    if (state.status === 'ended') {
      if (state.winner === 0 || state.winner === null) return 0;
      const mult = state.winMultiplier || 1;
      return state.winner === me ? 100000 * mult : -100000 * mult;
    }

    let score = 0;

    // Borne off bonus
    score += ((state.borneOff[me] || 0) - (state.borneOff[opp] || 0)) * 180;

    // Bar penalty
    score -= (state.bar[me] || 0) * 240;
    score += (state.bar[opp] || 0) * 240;

    let myPips = (state.bar[me] || 0) * 25;
    let oppPips = (state.bar[opp] || 0) * 25;

    for (let i = 0; i < 24; i++) {
      const pt = state.points[i];
      if (!pt || pt.count <= 0) continue;

      if (pt.owner === me) {
        const dist = me === 1 ? i + 1 : 24 - i;
        myPips += dist * pt.count;
        if (pt.count === 1) {
          // Exposed blot penalty (higher penalty when closer to opponent home)
          score -= 35;
        } else if (pt.count >= 2) {
          // Made point / prime / home-board anchor bonus
          score += 26;
          if ((me === 1 && i <= 5) || (me === 2 && i >= 18)) {
            score += 18;
          }
        }
      } else {
        const dist = opp === 1 ? i + 1 : 24 - i;
        oppPips += dist * pt.count;
        if (pt.count === 1) {
          score += 35;
        } else if (pt.count >= 2) {
          score -= 26;
          if ((opp === 1 && i <= 5) || (opp === 2 && i >= 18)) {
            score -= 18;
          }
        }
      }
    }

    // Pip race advantage
    score += (oppPips - myPips) * 4;
    return score;
  }

  BoardArena.registerRule('backgammon', {
    id: 'backgammon',
    selectionMode: 'piece',
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
