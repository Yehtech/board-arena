// ============================================
// Date: 2026-11-06
// Version: v2.0.0
// Changes: Multi-language core (9 languages); dictionaries moved to js/i18n/*.js
// 修改: 多語系核心（9 種語言）；字典移到 js/i18n/*.js，預設繁體中文
// ============================================
// ============================================
// Date: 2026-11-05
// Version: v1.1.0
// Changes: Add freeHint label used when ads are disabled; remove third-party brand names from copy
// 修改: 新增 freeHint 文字（廣告關閉時的提示按鈕）；文案移除第三方品牌名稱
// ============================================
/**
 * Classic Board Arena — i18n core
 *
 * 字典放在 js/i18n/<語言>.js，以 BoardArena.I18N.register() 註冊。
 * 訊息可以是字串 key，或由 BoardArena.msg(key, params) 建立的物件；
 * 規則引擎只回傳訊息物件，不含任何語言文字。
 */
(function (global) {
  'use strict';

  const BoardArena = (global.BoardArena = global.BoardArena || {});
  const STORAGE_KEY_LANG = 'CBA_LANG_V1';
  const DEFAULT_LANG = 'zh-TW';

  const LANGUAGES = Object.freeze([
    { code: 'zh-TW', label: '繁體中文' },
    { code: 'zh-CN', label: '简体中文' },
    { code: 'en', label: 'English' },
    { code: 'ja', label: '日本語' },
    { code: 'ko', label: '한국어' },
    { code: 'vi', label: 'Tiếng Việt' },
    { code: 'ru', label: 'Русский' },
    { code: 'fr', label: 'Français' },
    { code: 'tr', label: 'Türkçe' }
  ]);

  const LANGUAGE_ALIASES = new Map([
    ['zh', 'zh-TW'],
    ['zh-hant', 'zh-TW'],
    ['zh-hk', 'zh-TW'],
    ['zh-mo', 'zh-TW'],
    ['zh-hans', 'zh-CN'],
    ['zh-sg', 'zh-CN']
  ]);

  const CANNED_PHRASE_IDS = Object.freeze(['P01', 'P02', 'P03', 'P04', 'P05', 'P06', 'P07', 'P08']);

  /** 棋譜中的固定英文記號 → 字典 key */
  const NOTATION_KEYS = Object.freeze({
    Pass: 'notation.pass',
    'Pass (Blocked)': 'notation.passBlocked',
    Confirm: 'notation.confirm',
    Score: 'notation.score',
    SWAP: 'notation.swap',
    'Mark Dead': 'notation.markDead'
  });

  const DEAD_STONE_NOTATION = /^Dead (\S+)$/;

  const dictionaries = Object.create(null);
  const glyphMaps = Object.create(null);

  let currentLang = DEFAULT_LANG;

  /**
   * 將語言代碼正規化成已支援的代碼。
   * @param {string} code 語言代碼（不分大小寫）
   * @returns {string|null} 支援的代碼，不支援時回傳 null
   */
  function normalizeLang(code) {
    if (typeof code !== 'string' || code === '') return null;
    if (dictionaries[code]) return code;
    const lower = code.toLowerCase();
    const listed = LANGUAGES.find((l) => l.code.toLowerCase() === lower);
    if (listed) return listed.code;
    return LANGUAGE_ALIASES.get(lower) || null;
  }

  /**
   * 解析單一參數：字串／數字直接輸出，訊息物件與棋譜物件則再翻譯一次。
   * @param {*} value 參數值
   * @returns {string|null} 文字，null 代表參數未提供
   */
  function resolveParam(value) {
    if (value === undefined) return null;
    if (value === null) return '';
    if (typeof value === 'object') {
      if (typeof value.key === 'string') return t(value.key, value.params);
      if (typeof value.notation === 'string') return notation(value.notation);
    }
    return String(value);
  }

  /**
   * 取得翻譯文字。找不到時退回繁體中文，再找不到則回傳 key。
   * @param {string} key 字典 key
   * @param {Object} [params] 佔位符參數，值可以是字串、數字或 msg() 物件
   * @returns {string} 翻譯後的文字
   */
  function t(key, params) {
    const dict = dictionaries[currentLang] || {};
    const fallback = dictionaries[DEFAULT_LANG] || {};
    const text = key in dict ? dict[key] : key in fallback ? fallback[key] : key;
    if (!params) return text;
    return text.replace(/\{(\w+)\}/g, function (whole, name) {
      const resolved = resolveParam(params[name]);
      return resolved === null ? whole : resolved;
    });
  }

  /**
   * 將棋盤字形轉成目前語言的寫法（例如簡體的「马」、日文的「歩」）。
   * @param {string} text 原始字形
   * @returns {string} 轉換後的字形
   */
  function glyphs(text) {
    const map = glyphMaps[currentLang];
    if (!map) return String(text);
    return Array.from(String(text), (ch) => map[ch] || ch).join('');
  }

  /**
   * 將規則引擎產生的棋譜字串轉成目前語言的顯示文字。
   * @param {string} text 棋譜字串
   * @returns {string} 顯示文字
   */
  function notation(text) {
    const raw = String(text);
    if (NOTATION_KEYS[raw]) return t(NOTATION_KEYS[raw]);
    const dead = DEAD_STONE_NOTATION.exec(raw);
    if (dead) return t('notation.dead', { point: dead[1] });
    return glyphs(raw);
  }

  /**
   * 註冊語言字典。
   * @param {string} code 語言代碼
   * @param {Object<string,string>} dict 字典
   * @param {{glyphs?: Object<string,string>}} [options] 棋盤字形對照
   * @returns {void}
   */
  function register(code, dict, options) {
    dictionaries[code] = Object.freeze({ ...dict });
    if (options && options.glyphs) glyphMaps[code] = Object.freeze({ ...options.glyphs });
  }

  /**
   * 切換語言；不支援的代碼會退回預設語言。
   * @param {string} code 語言代碼
   * @returns {string} 實際套用的語言代碼
   */
  function setLang(code) {
    currentLang = normalizeLang(code) || DEFAULT_LANG;
    try {
      if (global.localStorage) global.localStorage.setItem(STORAGE_KEY_LANG, currentLang);
    } catch (err) {
      console.warn('[i18n] cannot persist language:', err);
    }
    return currentLang;
  }

  /**
   * 組出某棋種的規則教學內容。
   * @param {string} gameId 棋種 id
   * @returns {{summary: string, rules: string[], strategy: string}} 教學內容
   */
  function getAcademy(gameId) {
    const prefix = 'academy.' + gameId + '.';
    const base = dictionaries[DEFAULT_LANG] || {};
    const rules = [];
    for (let i = 1; prefix + 'rule' + i in base; i++) {
      rules.push(t(prefix + 'rule' + i));
    }
    return { summary: t(prefix + 'summary'), rules: rules, strategy: t(prefix + 'strategy') };
  }

  try {
    const saved = global.localStorage && global.localStorage.getItem(STORAGE_KEY_LANG);
    currentLang = normalizeLang(saved) || DEFAULT_LANG;
  } catch (err) {
    console.warn('[i18n] cannot read saved language:', err);
  }

  BoardArena.I18N = {
    LANGUAGES: LANGUAGES,
    DEFAULT_LANG: DEFAULT_LANG,
    register: register,
    getDictionary(code) {
      return dictionaries[code] || {};
    },
    getLang() {
      return currentLang;
    },
    setLang: setLang,
    isSupported(code) {
      return normalizeLang(code) !== null;
    },
    t: t,
    render(message) {
      return message ? t(message.key, message.params) : '';
    },
    glyphs: glyphs,
    notation: notation,
    getPhrases() {
      return CANNED_PHRASE_IDS.map((id) => ({ id: id, text: t('phrase.' + id) }));
    },
    getAcademy: getAcademy
  };
})(typeof window !== 'undefined' ? window : globalThis);
