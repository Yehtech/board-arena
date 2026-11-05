/**
 * Classic Board Arena — Unified Rule Registry & Deterministic Helpers
 * Works seamlessly on both file:// (offline) and http(s):// (authoritative server).
 */
(function (global) {
  'use strict';

  const BoardArena = (global.BoardArena = global.BoardArena || {});
  const registry = Object.create(null);

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
      zh: '黑白棋',
      en: 'Othello',
      baseOnline: 39,
      selectionMode: 'drop',
      gridLabel: '8×8',
      boardMaterialZh: '錦標賽深綠絨布 × 雙色立體翻轉棋',
      boardMaterialEn: 'Tournament Baize Felt × 3D Flip Discs',
      icon: '⚫'
    },
    {
      id: 'xiangqi',
      zh: '中國象棋',
      en: 'Xiangqi',
      baseOnline: 448,
      selectionMode: 'piece',
      gridLabel: '9×10',
      boardMaterialZh: '花梨木楚河漢界 × 立體木雕漢字棋',
      boardMaterialEn: 'Carved Rosewood × Traditional Hanzi Pieces',
      icon: '帥'
    },
    {
      id: 'go',
      zh: '圍棋',
      en: 'Go (Weiqi)',
      baseOnline: 228,
      selectionMode: 'drop',
      gridLabel: '9/13/19路',
      boardMaterialZh: '日本本榧木盤 × 那智黑與日向蛤碁石',
      boardMaterialEn: 'Japanese Kaya Goban × Slate & Clamshell Stones',
      icon: '☯'
    },
    {
      id: 'gomoku',
      zh: '五子棋',
      en: 'Gomoku',
      baseOnline: 33,
      selectionMode: 'drop',
      gridLabel: '15×15',
      boardMaterialZh: '現代溫潤淺榧木 × 高光立體雙色碁石',
      boardMaterialEn: 'Modern Light Kaya × Glossy Stones',
      icon: '◉'
    },
    {
      id: 'draughts',
      zh: '國際跳棋',
      en: 'Intl. Draughts',
      baseOnline: 290,
      selectionMode: 'piece',
      gridLabel: '10×10',
      boardMaterialZh: 'FMJD 楓木胡桃木百格盤 × 加冕飛行王棋',
      boardMaterialEn: '10×10 Maple & Walnut × Crowned Flying Kings',
      icon: '⛃'
    },
    {
      id: 'chess',
      zh: '西洋棋',
      en: 'Chess',
      baseOnline: 583,
      selectionMode: 'piece',
      gridLabel: '8×8',
      boardMaterialZh: '鑲嵌胡桃木盤 × 史湯頓錦標賽立體雕花棋',
      boardMaterialEn: 'Inlaid Walnut × Staunton Tournament Pieces',
      icon: '♞'
    },
    {
      id: 'shogi',
      zh: '日本將棋',
      en: 'Shogi',
      baseOnline: 8,
      selectionMode: 'piece',
      gridLabel: '9×9 + 駒台',
      boardMaterialZh: '日本榧木將棋盤 × 五角楔形木駒與雙側駒台',
      boardMaterialEn: '9×9 Kaya Shogiban × Wedge Koma & Komadai',
      icon: '☗'
    },
    {
      id: 'backgammon',
      zh: '雙陸棋',
      en: 'Backgammon',
      baseOnline: 556,
      selectionMode: 'piece',
      gridLabel: '24點 + 雙骰',
      boardMaterialZh: '精裝皮革鑲木摺疊盒 × 立體雙骰與加倍骰',
      boardMaterialEn: 'Luxury Leather Attaché × 3D Dice & Doubling Cube',
      icon: '🎲'
    }
  ];

  BoardArena.TIME_CONTROLS = [
    { id: '3+2', timeClass: 'bullet', initialMs: 180000, incrementMs: 2000, zh: '3+2 超快棋', en: '3+2 Bullet' },
    { id: '5+3', timeClass: 'blitz', initialMs: 300000, incrementMs: 3000, zh: '5+3 快棋', en: '5+3 Blitz' },
    { id: '10+5', timeClass: 'classical', initialMs: 600000, incrementMs: 5000, zh: '10+5 慢棋', en: '10+5 Rapid/Classical' }
  ];

  BoardArena.AI_LEVELS = [
    { id: 'easy', zh: '簡單', en: 'Easy', badgeRating: 1350, descZh: '穩健初段（識破連珠與基礎戰術）', descEn: 'Club Novice (Tactical Floor)' },
    { id: 'normal', zh: '普通', en: 'Normal', badgeRating: 1650, descZh: '中堅棋士（雙活三／吃子延伸搜尋）', descEn: 'Club Tactical (3-Ply + Quiescence)' },
    { id: 'hard', zh: '困難', en: 'Hard', badgeRating: 1950, descZh: '高段名手（開局庫＋VCF算殺＋深層讀秒）', descEn: 'Expert (Opening Book + VCF + Deep Search)' },
    { id: 'master', zh: '大師', en: 'Master', badgeRating: 2250, descZh: '宗師引擎（PVS迭代加深＋10層算殺＋終局解算）', descEn: 'Grandmaster (PVS + 10-Ply VCF + Endgame Solver)' }
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
