// ============================================
// Date: 2026-11-05
// Version: v1.0.0
// Changes: In-browser Fairy-Stockfish (WASM) bridge for chess / xiangqi / shogi Hard & Master levels, with JS AI fallback
// 修改: 新增瀏覽器內 Fairy-Stockfish（WASM）串接，西洋棋／象棋／將棋的困難與大師難度改由引擎下棋，失敗時自動退回 JS AI
// ============================================
/**
 * Classic Board Arena — Fairy-Stockfish WASM Bridge
 *
 * - 引擎檔案：js/vendor/fairy-stockfish/（GPL-3.0，授權見同目錄 Copying.txt）
 * - 需要 crossOriginIsolated（由 coi-sw.js 提供），否則自動停用並使用 JS AI。
 * - 包裝 BoardArena.AI.chooseMoveAsync：符合條件時改問引擎，任何錯誤或逾時都退回原本的 AI。
 * - 若已連上本機 BoardArenaServer（AI.useNativeEngineBridge），優先使用本機原生引擎。
 */
(function (global) {
  'use strict';

  const BoardArena = (global.BoardArena = global.BoardArena || {});

  /** 交給引擎的棋種（棋種代碼 → Fairy-Stockfish UCI_Variant 名稱） */
  const ENGINE_VARIANTS = { chess: 'chess', xiangqi: 'xiangqi', shogi: 'shogi' };

  /** 各難度的引擎設定（easy / normal 仍使用 JS AI） */
  const LEVEL_SETTINGS = {
    hard: { skill: 8, movetimeMs: 400 },
    master: { skill: 20, movetimeMs: 1000 }
  };

  const FIRST_LOAD_TIMEOUT_MS = 15000;
  const SEARCH_GRACE_MS = 4000;
  const MAX_CONSECUTIVE_FAILURES = 2;

  let enginePromise = null;
  let engineModule = null;
  let activeVariant = null;
  let searchQueue = Promise.resolve();
  let consecutiveFailures = 0;
  const lineWaiters = [];

  /* =========================================================================
   * 1. 純函式：狀態 → FEN、引擎走法 → 合法走法（可單獨測試）
   * ========================================================================= */

  /**
   * 棋盤列 → FEN 片段（連續空格以數字表示）。
   * @param {Array<Object|null>} row 一列棋格
   * @param {function(Object): string} pieceToChar 棋子轉字元
   * @returns {string}
   */
  function rowToFen(row, pieceToChar) {
    let out = '';
    let empty = 0;
    for (let c = 0; c < row.length; c++) {
      const cell = row[c];
      if (!cell) {
        empty++;
        continue;
      }
      if (empty > 0) {
        out += empty;
        empty = 0;
      }
      out += pieceToChar(cell);
    }
    return empty > 0 ? out + empty : out;
  }

  function caseFor(owner, letter) {
    return owner === 1 ? letter.toUpperCase() : letter.toLowerCase();
  }

  function squareName(r, c, rows) {
    return String.fromCharCode(97 + c) + (rows - r);
  }

  function chessFen(state) {
    const board = state.board.map(function (row) {
      return rowToFen(row, function (p) {
        return caseFor(p.owner, p.type);
      });
    });
    const cr = state.castling || {};
    let castling = '';
    if (cr[1] && cr[1].k) castling += 'K';
    if (cr[1] && cr[1].q) castling += 'Q';
    if (cr[2] && cr[2].k) castling += 'k';
    if (cr[2] && cr[2].q) castling += 'q';
    const ep = state.enPassant ? squareName(state.enPassant.r, state.enPassant.c, 8) : '-';
    return (
      board.join('/') +
      (state.currentPlayer === 1 ? ' w ' : ' b ') +
      (castling || '-') +
      ' ' +
      ep +
      ' ' +
      Math.max(0, state.halfMoveClock || 0) +
      ' ' +
      Math.max(1, state.turnNumber || 1)
    );
  }

  /** 象棋：本專案 H=馬、E=象，Fairy-Stockfish 使用 N、B */
  const XIANGQI_LETTER = { K: 'K', A: 'A', E: 'B', H: 'N', R: 'R', C: 'C', P: 'P' };

  function xiangqiFen(state) {
    const board = state.board.map(function (row) {
      return rowToFen(row, function (p) {
        return caseFor(p.owner, XIANGQI_LETTER[p.type] || p.type);
      });
    });
    return board.join('/') + (state.currentPlayer === 1 ? ' w' : ' b') + ' - - 0 1';
  }

  const SHOGI_HAND_ORDER = ['R', 'B', 'G', 'S', 'N', 'L', 'P'];

  function shogiHand(hand, owner) {
    let out = '';
    if (!hand) return out;
    for (let i = 0; i < SHOGI_HAND_ORDER.length; i++) {
      const t = SHOGI_HAND_ORDER[i];
      const n = hand[t] || 0;
      for (let k = 0; k < n; k++) out += caseFor(owner, t);
    }
    return out;
  }

  function shogiFen(state) {
    const board = state.board.map(function (row) {
      return rowToFen(row, function (p) {
        return (p.promoted ? '+' : '') + caseFor(p.owner, p.type);
      });
    });
    const hands = state.hands || {};
    const pocket = shogiHand(hands[1], 1) + shogiHand(hands[2], 2);
    return board.join('/') + '[' + (pocket || '-') + ']' + (state.currentPlayer === 1 ? ' w' : ' b') + ' 0 1';
  }

  /**
   * 將遊戲狀態轉為 Fairy-Stockfish 可讀的 FEN。
   * @param {string} gameId 棋種
   * @param {Object} state 遊戲狀態
   * @returns {string|null} 不支援的棋種回傳 null
   */
  function buildFen(gameId, state) {
    if (!state || !state.board) return null;
    if (gameId === 'chess') return chessFen(state);
    if (gameId === 'xiangqi') return xiangqiFen(state);
    if (gameId === 'shogi') return shogiFen(state);
    return null;
  }

  /**
   * 解析引擎走法字串（例：e2e4、e7e8q、h3e3、b10c8、P@e5、b2h8+）。
   * @param {string} gameId 棋種
   * @param {string} uci 引擎輸出的走法
   * @returns {Object|null} { from, to, drop, promote, promoteType }
   */
  function parseEngineMove(gameId, uci) {
    if (!uci || uci === '(none)' || uci === '0000') return null;
    const rows = gameId === 'xiangqi' ? 10 : gameId === 'shogi' ? 9 : 8;
    const drop = /^([A-Za-z])@([a-i])(\d{1,2})$/.exec(uci);
    if (drop) {
      return {
        drop: drop[1].toUpperCase(),
        to: { r: rows - parseInt(drop[3], 10), c: drop[2].charCodeAt(0) - 97 }
      };
    }
    const m = /^([a-i])(\d{1,2})([a-i])(\d{1,2})([a-z+=]?)$/.exec(uci);
    if (!m) return null;
    const suffix = m[5] || '';
    return {
      from: { r: rows - parseInt(m[2], 10), c: m[1].charCodeAt(0) - 97 },
      to: { r: rows - parseInt(m[4], 10), c: m[3].charCodeAt(0) - 97 },
      promote: suffix === '+',
      promoteType: /^[a-z]$/.test(suffix) ? suffix.toUpperCase() : null
    };
  }

  function sameSquare(a, b) {
    return Boolean(a && b && a.r === b.r && a.c === b.c);
  }

  /**
   * 在合法走法中找出與引擎走法相符者。
   * @param {string} gameId 棋種
   * @param {Array<Object>} legalMoves 規則引擎產生的合法走法
   * @param {Object} parsed parseEngineMove 的結果
   * @returns {Object|null}
   */
  function matchLegalMove(gameId, legalMoves, parsed) {
    if (!parsed || !legalMoves) return null;
    for (let i = 0; i < legalMoves.length; i++) {
      const lm = legalMoves[i];
      if (!sameSquare(lm.to, parsed.to)) continue;
      if (parsed.drop) {
        if (lm.isDrop && lm.piece === parsed.drop) return lm;
        continue;
      }
      if (lm.isDrop || !sameSquare(lm.from, parsed.from)) continue;
      if (gameId === 'chess') {
        const lmPromo = lm.promote ? String(lm.promote).toUpperCase() : null;
        if (lmPromo !== parsed.promoteType) continue;
      } else if (gameId === 'shogi') {
        if (Boolean(lm.promote) !== parsed.promote) continue;
      }
      return lm;
    }
    return null;
  }

  /* =========================================================================
   * 2. 引擎載入、UCI 溝通與佇列
   * ========================================================================= */

  function isSupportedEnvironment() {
    return (
      global.crossOriginIsolated === true &&
      typeof global.SharedArrayBuffer === 'function' &&
      typeof global.WebAssembly === 'object' &&
      typeof document !== 'undefined'
    );
  }

  function engineBaseUrl() {
    return new URL('js/vendor/fairy-stockfish/', document.baseURI).href;
  }

  function onEngineLine(line) {
    for (let i = lineWaiters.length - 1; i >= 0; i--) {
      const w = lineWaiters[i];
      if (w.match(line)) {
        lineWaiters.splice(i, 1);
        clearTimeout(w.timer);
        w.resolve(line);
      }
    }
  }

  /**
   * 等待符合條件的引擎輸出行。
   * @param {function(string): boolean} match 條件
   * @param {number} timeoutMs 逾時毫秒
   * @returns {Promise<string>}
   */
  function waitForLine(match, timeoutMs) {
    return new Promise(function (resolve, reject) {
      const waiter = { match: match, resolve: resolve, timer: null };
      waiter.timer = setTimeout(function () {
        const idx = lineWaiters.indexOf(waiter);
        if (idx >= 0) lineWaiters.splice(idx, 1);
        reject(new Error('Engine timeout waiting for response'));
      }, timeoutMs);
      lineWaiters.push(waiter);
    });
  }

  function send(cmd) {
    engineModule.postMessage(cmd);
  }

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      const s = document.createElement('script');
      s.src = src;
      s.async = true;
      s.onload = resolve;
      s.onerror = function () {
        reject(new Error('Failed to load ' + src));
      };
      document.head.appendChild(s);
    });
  }

  /**
   * 載入並初始化引擎（只執行一次）。
   * @returns {Promise<Object>} Emscripten 模組
   */
  function loadEngine() {
    if (enginePromise) return enginePromise;
    const base = engineBaseUrl();
    enginePromise = loadScript(base + 'stockfish.js')
      .then(function () {
        if (typeof global.Stockfish !== 'function') throw new Error('Stockfish factory missing');
        return global.Stockfish({
          locateFile: function (path) {
            return base + path;
          },
          mainScriptUrlOrBlob: base + 'stockfish.js'
        });
      })
      .then(function (mod) {
        engineModule = mod;
        mod.addMessageListener(onEngineLine);
        const uciOk = waitForLine(function (l) {
          return l === 'uciok';
        }, 10000);
        send('uci');
        return uciOk;
      })
      .then(function () {
        const cores = (global.navigator && global.navigator.hardwareConcurrency) || 2;
        send('setoption name Threads value ' + Math.max(1, Math.min(4, cores - 1)));
        send('setoption name Hash value 32');
        const ready = waitForLine(function (l) {
          return l === 'readyok';
        }, 10000);
        send('isready');
        return ready;
      })
      .then(function () {
        return engineModule;
      });
    enginePromise.catch(function (err) {
      console.warn('[FSF] engine load failed, using built-in AI:', err);
      consecutiveFailures = MAX_CONSECUTIVE_FAILURES;
    });
    return enginePromise;
  }

  /**
   * 送出一次搜尋並等待 bestmove。
   * @returns {Promise<{raw: string, info: Object}>}
   */
  function runSearch(variant, fen, settings) {
    const info = { depth: 0, nodes: 0, score: 0 };
    const infoListener = function (line) {
      const d = /\bdepth (\d+)/.exec(line);
      const n = /\bnodes (\d+)/.exec(line);
      const s = /\bscore cp (-?\d+)/.exec(line);
      if (line.indexOf('info ') === 0) {
        if (d) info.depth = parseInt(d[1], 10);
        if (n) info.nodes = parseInt(n[1], 10);
        if (s) info.score = parseInt(s[1], 10);
      }
    };
    engineModule.addMessageListener(infoListener);

    let chain = Promise.resolve();
    if (activeVariant !== variant) {
      chain = chain.then(function () {
        send('setoption name UCI_Variant value ' + variant);
        send('ucinewgame');
        activeVariant = variant;
      });
    }
    return chain
      .then(function () {
        send('setoption name Skill Level value ' + settings.skill);
        const ready = waitForLine(function (l) {
          return l === 'readyok';
        }, 5000);
        send('isready');
        return ready;
      })
      .then(function () {
        const best = waitForLine(function (l) {
          return l.indexOf('bestmove') === 0;
        }, settings.movetimeMs + SEARCH_GRACE_MS);
        send('position fen ' + fen);
        send('go movetime ' + settings.movetimeMs);
        return best;
      })
      .then(
        function (line) {
          engineModule.removeMessageListener(infoListener);
          return { raw: line.split(/\s+/)[1] || '', info: info };
        },
        function (err) {
          engineModule.removeMessageListener(infoListener);
          throw err;
        }
      );
  }

  function shouldUseEngine(gameId, levelKey) {
    const AI = BoardArena.AI;
    return Boolean(
      ENGINE_VARIANTS[gameId] &&
        LEVEL_SETTINGS[levelKey] &&
        !(AI && AI.useNativeEngineBridge) &&
        consecutiveFailures < MAX_CONSECUTIVE_FAILURES &&
        isSupportedEnvironment()
    );
  }

  /**
   * 向引擎詢問一步棋。
   * @returns {Promise<{move: Object, stats: Object}|null>} 找不到合法對應時回傳 null
   */
  function requestMove(gameId, state, levelKey) {
    const fen = buildFen(gameId, state);
    const rule = BoardArena.getRule && BoardArena.getRule(gameId);
    if (!fen || !rule) return Promise.resolve(null);
    const settings = LEVEL_SETTINGS[levelKey];
    const started = Date.now();

    const job = searchQueue.then(function () {
      return loadEngine().then(function () {
        return runSearch(ENGINE_VARIANTS[gameId], fen, settings);
      });
    });
    // 佇列不因單次失敗而中斷
    searchQueue = job.catch(function () {});

    return job.then(function (result) {
      const legal = rule.getLegalMoves(state, state.currentPlayer);
      const move = matchLegalMove(gameId, legal, parseEngineMove(gameId, result.raw));
      if (!move) {
        console.warn('[FSF] engine move not matched:', result.raw, 'fen:', fen);
        return null;
      }
      return {
        move: move,
        stats: {
          gameId: gameId,
          levelKey: levelKey,
          depthReached: result.info.depth,
          nodes: result.info.nodes,
          elapsedMs: Date.now() - started,
          bestScore: result.info.score,
          source: 'fairy-stockfish-wasm',
          rawMove: result.raw
        }
      };
    });
  }

  /* =========================================================================
   * 3. 包裝 AI.chooseMoveAsync
   * ========================================================================= */

  function installHook() {
    const AI = BoardArena.AI;
    if (!AI || typeof AI.chooseMoveAsync !== 'function' || AI.chooseMoveAsync.__fsfWrapped) return;
    const original = AI.chooseMoveAsync;

    const wrapped = function (gameId, state, levelKey, callback) {
      if (!shouldUseEngine(gameId, levelKey)) {
        return original.call(AI, gameId, state, levelKey, callback);
      }
      const done = typeof callback === 'function' ? callback : function () {};
      let settled = false;
      const fallback = function (reason) {
        if (settled) return;
        settled = true;
        if (reason) console.warn('[FSF] fallback to built-in AI:', reason);
        original.call(AI, gameId, state, levelKey, done);
      };
      const limit = engineModule ? LEVEL_SETTINGS[levelKey].movetimeMs + SEARCH_GRACE_MS * 2 : FIRST_LOAD_TIMEOUT_MS;
      const guard = setTimeout(function () {
        fallback('timeout');
      }, limit);

      requestMove(gameId, state, levelKey).then(
        function (res) {
          clearTimeout(guard);
          if (!res) {
            consecutiveFailures++;
            fallback('no matching legal move');
            return;
          }
          consecutiveFailures = 0;
          if (settled) return;
          settled = true;
          AI.lastSearchStats = res.stats;
          done(res.move, res.stats);
        },
        function (err) {
          clearTimeout(guard);
          consecutiveFailures++;
          fallback(err && err.message);
        }
      );
    };
    wrapped.__fsfWrapped = true;
    AI.chooseMoveAsync = wrapped;
  }

  /**
   * 預先載入引擎（開局時呼叫，讓電腦第一步不用等下載）。
   * @param {string} gameId 棋種
   * @param {string} levelKey 難度
   */
  function warmUp(gameId, levelKey) {
    if (shouldUseEngine(gameId, levelKey)) loadEngine();
  }

  installHook();

  BoardArena.FSF = {
    buildFen: buildFen,
    parseEngineMove: parseEngineMove,
    matchLegalMove: matchLegalMove,
    isSupportedEnvironment: isSupportedEnvironment,
    shouldUseEngine: shouldUseEngine,
    warmUp: warmUp,
    requestMove: requestMove
  };
})(typeof window !== 'undefined' ? window : globalThis);
