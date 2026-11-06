// ============================================
// Date: 2026-11-06
// Version: v1.1.0
// Changes: Add language-neutral message helper; catalog text moved to dictionaries
// 修改: 新增語言中立的訊息函式；棋種名稱等文字移到字典
// ============================================
/**
 * Classic Board Arena — Unified Rule Registry & Deterministic Helpers
 * Works seamlessly on both file:// (offline) and http(s):// (authoritative server).
 */
(function (global) {
  'use strict';

  const BoardArena = (global.BoardArena = global.BoardArena || {});
  const registry = Object.create(null);

  /**
   * 建立語言中立的訊息，由 BoardArena.I18N 轉成文字。規則引擎與 AI 只回傳訊息，不含語言文字。
   * @param {string} key 字典 key
   * @param {Object} [params] 佔位符參數，值可以是字串、數字或另一個訊息
   * @returns {{key: string, params: (Object|undefined)}} 訊息物件
   */
  BoardArena.msg = function msg(key, params) {
    return { key: key, params: params };
  };

  /**
   * PlayOK-authentic 2-column 8-game directory with reference player counts:
   * 黑白棋 (39)    中國象棋 (448)
   * 圍棋 (228)     五子棋 (33)
   * 國際跳棋 (290)  西洋棋 (583)
   * 日本將棋 (8)    雙陸棋 (556)
   */
  BoardArena.GAME_CATALOG = [
    {
      id: 'othello',
      baseOnline: 39,
      selectionMode: 'drop',
      icon: '⚫'
    },
    {
      id: 'xiangqi',
      baseOnline: 448,
      selectionMode: 'piece',
      icon: '帥'
    },
    {
      id: 'go',
      baseOnline: 228,
      selectionMode: 'drop',
      icon: '☯'
    },
    {
      id: 'gomoku',
      baseOnline: 33,
      selectionMode: 'drop',
      icon: '◉'
    },
    {
      id: 'draughts',
      baseOnline: 290,
      selectionMode: 'piece',
      icon: '⛃'
    },
    {
      id: 'chess',
      baseOnline: 583,
      selectionMode: 'piece',
      icon: '♞'
    },
    {
      id: 'shogi',
      baseOnline: 8,
      selectionMode: 'piece',
      icon: '☗'
    },
    {
      id: 'backgammon',
      baseOnline: 556,
      selectionMode: 'piece',
      icon: '🎲'
    }
  ];

  BoardArena.TIME_CONTROLS = [
    { id: '3+2', timeClass: 'bullet', initialMs: 180000, incrementMs: 2000 },
    { id: '5+3', timeClass: 'blitz', initialMs: 300000, incrementMs: 3000 },
    { id: '10+5', timeClass: 'classical', initialMs: 600000, incrementMs: 5000 }
  ];

  BoardArena.AI_LEVELS = [
    { id: 'easy', badgeRating: 1350 },
    { id: 'normal', badgeRating: 1650 },
    { id: 'hard', badgeRating: 1950 },
    { id: 'master', badgeRating: 2250 }
  ];

  /**
   * Deterministic Mulberry32 PRNG for reproducible dice / AI tie-breaks / replays
   */
  BoardArena.createRng = function createRng(seed) {
    let s = (typeof seed === 'number' ? seed : hashString(String(seed || Date.now()))) >>> 0;
    return {
      nextFloat() {
        s = (s + 0x6d2b79f5) >>> 0;
        let t = Math.imul(s ^ (s >>> 15), 1 | s);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      },
      nextInt(minIncl, maxIncl) {
        return minIncl + Math.floor(this.nextFloat() * (maxIncl - minIncl + 1));
      },
      getState() {
        return s >>> 0;
      }
    };
  };

  function hashString(str) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  BoardArena.hashString = hashString;

  BoardArena.deepClone = function deepClone(obj) {
    if (obj === null || typeof obj !== 'object') return obj;
    if (Array.isArray(obj)) {
      const out = new Array(obj.length);
      for (let i = 0; i < obj.length; i++) out[i] = deepClone(obj[i]);
      return out;
    }
    const out = {};
    const keys = Object.keys(obj);
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i];
      out[k] = deepClone(obj[k]);
    }
    return out;
  };

  BoardArena.sourcesEqual = function sourcesEqual(a, b) {
    if (!a || !b) return false;
    if (typeof a.r === 'number' && typeof b.r === 'number') {
      return a.r === b.r && a.c === b.c;
    }
    if (a.zone && b.zone) {
      if (a.zone !== b.zone) return false;
      if (a.zone === 'hand') return a.owner === b.owner && a.piece === b.piece;
      if (a.zone === 'bar') return a.owner === b.owner;
      if (a.zone === 'point') return a.index === b.index;
      if (a.zone === 'off') return a.owner === b.owner;
    }
    return false;
  };

  BoardArena.registerRule = function registerRule(id, impl) {
    if (!id || !impl) throw new Error('Invalid rule registration');
    if (!impl.cloneState) {
      impl.cloneState = BoardArena.deepClone;
    }
    if (!impl.getMovesForSource) {
      impl.getMovesForSource = function defaultGetMovesForSource(state, source) {
        if (!source) return [];
        const all = impl.getLegalMoves(state, state.currentPlayer);
        return all.filter((m) => BoardArena.sourcesEqual(m.from, source));
      };
    }
    registry[id] = impl;
  };

  BoardArena.getRule = function getRule(id) {
    const r = registry[id];
    if (!r) throw new Error('Rule module not registered: ' + id);
    return r;
  };

  BoardArena.getAllRules = function getAllRules() {
    return Object.assign({}, registry);
  };
})(typeof window !== 'undefined' ? window : globalThis);
