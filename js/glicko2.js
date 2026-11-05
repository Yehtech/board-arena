/**
 * Classic Board Arena — Standard Glicko-2 Rating System
 * Reference: Professor Mark E. Glickman, "Example of the Glicko-2 system"
 * Defaults per Spec §3: R = 1500, RD = 350, volatility = 0.06, tau = 0.5
 */
(function (global) {
  'use strict';

  const BoardArena = (global.BoardArena = global.BoardArena || {});
  const SCALE = 173.7178;
  const DEFAULT_TAU = 0.5;
  const EPSILON = 0.000001;

  function toMu(rating) {
    return (rating - 1500) / SCALE;
  }

  function toPhi(rd) {
    return rd / SCALE;
  }

  function fromMu(mu) {
    return mu * SCALE + 1500;
  }

  function fromPhi(phi) {
    return phi * SCALE;
  }

  function gFunc(phi) {
    return 1 / Math.sqrt(1 + (3 * phi * phi) / (Math.PI * Math.PI));
  }

  function eFunc(mu, muJ, phiJ) {
    return 1 / (1 + Math.exp(-gFunc(phiJ) * (mu - muJ)));
  }

  /**
   * Compute updated Glicko-2 rating after 1 or more games.
   * @param {{rating:number, rd:number, volatility:number}} player
   * @param {Array<{opponentRating:number, opponentRd:number, score:number}>} matches score: 1=win, 0.5=draw, 0=loss
   * @param {number} [tau=0.5]
   */
  function rate(player, matches, tau) {
    const sysTau = typeof tau === 'number' ? tau : DEFAULT_TAU;
    const rating = typeof player.rating === 'number' ? player.rating : 1500;
    const rd = typeof player.rd === 'number' ? player.rd : 350;
    const sigma = typeof player.volatility === 'number' ? player.volatility : 0.06;

    const mu = toMu(rating);
    const phi = toPhi(rd);

    if (!matches || matches.length === 0) {
      const phiStar = Math.sqrt(phi * phi + sigma * sigma);
      return {
        rating: Math.round(rating * 100) / 100,
        rd: Math.min(350, Math.round(fromPhi(phiStar) * 100) / 100),
        volatility: sigma
      };
    }

    let vInv = 0;
    let deltaSum = 0;

    for (let i = 0; i < matches.length; i++) {
      const m = matches[i];
      const oppR = typeof m.opponentRating === 'number' ? m.opponentRating : m.rating;
      const oppRd = typeof m.opponentRd === 'number' ? m.opponentRd : m.rd;
      const muJ = toMu(oppR);
      const phiJ = toPhi(oppRd);
      const g = gFunc(phiJ);
      const E = eFunc(mu, muJ, phiJ);
      vInv += g * g * E * (1 - E);
      deltaSum += g * (m.score - E);
    }

    const v = 1 / vInv;
    const delta = v * deltaSum;

    // Step 5: Illinois iterative algorithm for new volatility sigma'
    const a = Math.log(sigma * sigma);
    const phiSq = phi * phi;
    const deltaSq = delta * delta;

    function f(x) {
      const ex = Math.exp(x);
      const num1 = ex * (deltaSq - phiSq - v - ex);
      const den1 = 2 * (phiSq + v + ex) * (phiSq + v + ex);
      return num1 / den1 - (x - a) / (sysTau * sysTau);
    }

    let A = a;
    let B;
    if (deltaSq > phiSq + v) {
      B = Math.log(deltaSq - phiSq - v);
    } else {
      let k = 1;
      while (f(a - k * sysTau) < 0 && k < 100) {
        k++;
      }
      B = a - k * sysTau;
    }

    let fA = f(A);
    let fB = f(B);
    let guard = 0;
    while (Math.abs(B - A) > EPSILON && guard < 120) {
      const C = A + ((A - B) * fA) / (fB - fA);
      const fC = f(C);
      if (fC * fB <= 0) {
        A = B;
        fA = fB;
      } else {
        fA = fA / 2;
      }
      B = C;
      fB = fC;
      guard++;
    }

    const sigmaPrime = Math.exp(A / 2);
    const phiStar = Math.sqrt(phiSq + sigmaPrime * sigmaPrime);
    const phiPrime = 1 / Math.sqrt(1 / (phiStar * phiStar) + 1 / v);
    const muPrime = mu + phiPrime * phiPrime * deltaSum;

    return {
      rating: Math.round(fromMu(muPrime) * 100) / 100,
      rd: Math.max(30, Math.min(350, Math.round(fromPhi(phiPrime) * 100) / 100)),
      volatility: Math.round(sigmaPrime * 1000000) / 1000000
    };
  }

  function createInitialRating() {
    return {
      rating: 1500,
      rd: 350,
      volatility: 0.06,
      gamesPlayed: 0,
      wins: 0,
      losses: 0,
      draws: 0,
      lastRatedAt: null
    };
  }

  function isLeaderboardQualified(entry) {
    return entry && entry.gamesPlayed >= 20 && entry.rd < 110;
  }

  BoardArena.Glicko2 = {
    rate,
    createInitialRating,
    isLeaderboardQualified
  };
})(typeof window !== 'undefined' ? window : globalThis);
