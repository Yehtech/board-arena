// ============================================
// Date: 2026-11-06
// Version: v1.0.0
// Changes: i18n tests (9-language key and placeholder parity, no hardcoded UI text)
// 修改: 多語系測試（9 語言 key 與佔位符一致、程式碼不得寫死介面文字）
// ============================================
/**
 * 多語系測試（不需要瀏覽器）
 *
 * 執行：node tests/node/i18n.test.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const LANG_CODES = ['zh-TW', 'zh-CN', 'en', 'ja', 'ko', 'vi', 'ru', 'fr', 'tr'];
const GAME_IDS = ['othello', 'xiangqi', 'go', 'gomoku', 'draughts', 'chess', 'shogi', 'backgammon'];
const HAN = /[㐀-鿿]/;
/** 簡體文字中不應出現的繁體字（抽樣最常見者） */
const TRADITIONAL_ONLY = /[盤對將帥馬車砲龍飛銀進點語與為這個時間開關選單電腦勝負雙級機動戰術]/;
/** 這些字串可以留在程式碼內：棋子字形、棋譜記號等，不是介面句子 */
const MAX_HAN_IN_GLYPH_LITERAL = 3;

let failures = 0;
let checks = 0;

/**
 * 記錄一項檢查結果。
 * @param {boolean} ok 是否通過
 * @param {string} label 檢查名稱
 * @returns {void}
 */
function check(ok, label) {
  checks++;
  if (!ok) {
    failures++;
    console.log('  FAIL ' + label);
  }
}

/**
 * 依序載入瀏覽器腳本到 globalThis。
 * @param {string[]} files 相對於專案根目錄的檔案
 * @returns {void}
 */
function loadScripts(files) {
  files.forEach(function (rel) {
    require(path.join(ROOT, rel));
  });
}

/**
 * 去除 JS 註解，避免掃描到修改紀錄與說明文字。
 * @param {string} src 原始碼
 * @returns {string} 去除註解後的原始碼
 */
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/([;,{}()\s])\/\/ .*$/gm, '$1');
}

/**
 * 取出佔位符名稱（排序後），用於比對各語言是否一致。
 * @param {string} text 翻譯字串
 * @returns {string} 以逗號串接的佔位符
 */
function placeholders(text) {
  return (String(text).match(/\{\w+\}/g) || []).slice().sort().join(',');
}

globalThis.localStorage = (function () {
  const store = Object.create(null);
  return {
    getItem: function (k) {
      return k in store ? store[k] : null;
    },
    setItem: function (k, v) {
      store[k] = String(v);
    }
  };
})();

loadScripts(['js/rules/rules-core.js', 'js/i18n.js'].concat(LANG_CODES.map((c) => 'js/i18n/' + c + '.js')));
const BoardArena = globalThis.BoardArena;
const I18N = BoardArena.I18N;

console.log('== core API');
check(I18N.getLang() === 'zh-TW', 'default language is zh-TW');
check(JSON.stringify(I18N.LANGUAGES.map((l) => l.code)) === JSON.stringify(LANG_CODES), 'LANGUAGES order');
check(I18N.setLang('ja') === 'ja', 'setLang accepts a supported language');
check(I18N.getLang() === 'ja', 'getLang follows setLang');
check(globalThis.localStorage.getItem('CBA_LANG_V1') === 'ja', 'language is persisted');
check(I18N.setLang('xx') === 'zh-TW', 'unsupported language falls back to the default');
check(I18N.setLang('ZH-cn') === 'zh-CN', 'language codes are case-insensitive');
check(I18N.setLang('zh-Hant') === 'zh-TW', 'zh-Hant maps to zh-TW');
check(I18N.setLang('zh-Hans') === 'zh-CN', 'zh-Hans maps to zh-CN');
check(I18N.t('no.such.key') === 'no.such.key', 'missing key returns the key');
['constructor', 'toString', 'valueOf', '__proto__'].forEach(function (name) {
  check(I18N.isSupported(name) === false, 'inherited property is not a language: ' + name);
  check(I18N.setLang(name) === 'zh-TW', 'inherited property falls back to the default: ' + name);
});
I18N.setLang('zh-TW');

console.log('== parameters');
I18N.register('__probe', { 'p.a': '{x}/{y}', 'p.inner': 'in:{v}' });
I18N.setLang('__probe');
check(I18N.getLang() === '__probe', 'registered dictionaries are selectable');
check(I18N.t('p.a', { x: 1, y: 'b' }) === '1/b', 'parameters are substituted');
check(I18N.t('p.a', { x: 0 }) === '0/{y}', 'unknown parameters stay visible');
check(I18N.t('p.a', { x: BoardArena.msg('p.inner', { v: 2 }), y: '' }) === 'in:2/', 'nested messages resolve');
check(I18N.render(BoardArena.msg('p.inner', { v: 3 })) === 'in:3', 'render accepts a message');
check(I18N.render(null) === '', 'render tolerates null');
check(I18N.t('brandTitle') !== 'brandTitle' || I18N.t('ui.brandTitle') !== 'ui.brandTitle', 'falls back to zh-TW');
I18N.setLang('zh-TW');

console.log('== dictionary parity');
const base = I18N.getDictionary('zh-TW');
const baseKeys = Object.keys(base).sort();
check(baseKeys.length > 200, 'zh-TW dictionary is populated (' + baseKeys.length + ' keys)');
LANG_CODES.forEach(function (code) {
  const dict = I18N.getDictionary(code);
  const keys = Object.keys(dict);
  const missing = baseKeys.filter((k) => !(k in dict));
  const extra = keys.filter((k) => !(k in base));
  check(missing.length === 0, code + ' missing keys: ' + missing.slice(0, 8).join(', '));
  check(extra.length === 0, code + ' extra keys: ' + extra.slice(0, 8).join(', '));
  keys.forEach(function (k) {
    check(typeof dict[k] === 'string' && dict[k].trim() !== '', code + ' empty value: ' + k);
    if (k in base) {
      check(placeholders(dict[k]) === placeholders(base[k]), code + ' placeholders differ: ' + k);
    }
  });
});

console.log('== script purity');
['en', 'vi', 'ru', 'fr', 'tr', 'ko'].forEach(function (code) {
  const dict = I18N.getDictionary(code);
  Object.keys(dict).forEach(function (k) {
    check(!HAN.test(dict[k]), code + ' contains Han characters: ' + k + ' = ' + dict[k]);
  });
});
['ja', 'ko', 'vi', 'ru', 'fr', 'tr'].forEach(function (code) {
  const dict = I18N.getDictionary(code);
  const same = Object.keys(dict).filter((k) => HAN.test(dict[k]) && dict[k] === base[k] && dict[k].length > 8);
  check(same.length === 0, code + ' left untranslated: ' + same.slice(0, 5).join(', '));
});
Object.entries(I18N.getDictionary('zh-CN')).forEach(function (entry) {
  check(!TRADITIONAL_ONLY.test(entry[1]), 'zh-CN uses traditional characters: ' + entry[0] + ' = ' + entry[1]);
});

console.log('== required keys');
const required = [];
GAME_IDS.forEach(function (id) {
  required.push('game.' + id + '.name', 'game.' + id + '.material', 'game.' + id + '.grid');
  required.push('academy.' + id + '.summary', 'academy.' + id + '.rule1', 'academy.' + id + '.strategy');
});
['easy', 'normal', 'hard', 'master'].forEach((id) => required.push('ai.' + id));
['bullet', 'blitz', 'classical'].forEach((id) => required.push('tc.' + id));
['P01', 'P02', 'P03', 'P04', 'P05', 'P06', 'P07', 'P08'].forEach((id) => required.push('phrase.' + id));
['black', 'white', 'red', 'sente', 'gote'].forEach((id) => required.push('side.' + id));
['title', 'description'].forEach((id) => required.push('meta.' + id));
required.forEach(function (k) {
  check(k in base, 'required key missing: ' + k);
});
GAME_IDS.forEach(function (id) {
  LANG_CODES.forEach(function (code) {
    I18N.setLang(code);
    const a = I18N.getAcademy(id);
    check(Boolean(a.summary && a.strategy && a.rules.length >= 2), code + ' academy incomplete: ' + id);
  });
});
LANG_CODES.forEach(function (code) {
  I18N.setLang(code);
  const phrases = I18N.getPhrases();
  check(phrases.length === 8 && phrases.every((p) => p.id && p.text), code + ' phrases incomplete');
});
I18N.setLang('zh-TW');

console.log('== board glyphs');
I18N.setLang('zh-CN');
check(I18N.glyphs('帥傌俥') === '帅马车', 'zh-CN uses simplified board glyphs');
check(I18N.glyphs('炮二平五') === '炮二平五', 'zh-CN keeps unchanged glyphs');
I18N.setLang('ja');
check(I18N.glyphs('王將步兵龍王') === '王将歩兵竜王', 'ja uses Japanese kanji forms');
I18N.setLang('en');
check(I18N.glyphs('帥') === '帥', 'other languages keep authentic glyphs');
I18N.setLang('zh-TW');

console.log('== notation');
I18N.setLang('en');
check(I18N.notation('Pass') === I18N.t('notation.pass'), 'pass notation');
check(I18N.notation('Dead C4') === I18N.t('notation.dead', { point: 'C4' }), 'dead stone notation');
check(I18N.notation('e2e4') === 'e2e4', 'plain notation unchanged');
I18N.setLang('zh-CN');
check(I18N.notation('傌二進三') === '马二进三', 'zh-CN notation uses simplified glyphs');
I18N.setLang('zh-TW');
Object.entries(I18N.getDictionary('ja')).forEach(function (entry) {
  check(!/[將步龍]/.test(entry[1]), 'ja uses non-Japanese kanji forms: ' + entry[0] + ' = ' + entry[1]);
});

console.log('== source scan');
const SOURCES = ['js/app.js', 'js/ads-manager.js', 'js/ai/ai-engine.js', 'js/render/board-renderer.js', 'js/net/arena-client.js']
  .concat(fs.readdirSync(path.join(ROOT, 'js/rules')).map((f) => 'js/rules/' + f));
const usedKeys = new Set();
SOURCES.forEach(function (rel) {
  const code = stripComments(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
  check(!/\bisEn\b/.test(code), rel + ' still branches on isEn');
  check(!/\breason(Zh|En)\b|\bcomment(Zh|En)\b|\bboardMaterial(Zh|En)\b|\bdesc(Zh|En)\b/.test(code), rel + ' still has per-language fields');
  check(!/\b(zh|en):\s*['"`]/.test(code), rel + ' still has zh/en string fields');
  const literals = code.match(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`[^`]*`/g) || [];
  literals.forEach(function (lit) {
    const hanCount = (lit.match(new RegExp(HAN.source, 'g')) || []).length;
    const isMockData = rel === 'js/net/arena-client.js' || (rel === 'js/app.js' && /\(P2\)|\(TW\)|棋王|受邀好友|PLAYER_NAME/.test(lit));
    if (hanCount > MAX_HAN_IN_GLYPH_LITERAL && !isMockData) {
      check(false, rel + ' hardcoded text: ' + lit.slice(0, 60));
    }
  });
  const keyRe = /'((?:ui|rule|coach|board|notation|side|choice|grade|legal|meta|ad|piece|end|phrase)\.[A-Za-z0-9_.]*[A-Za-z0-9_])'/g;
  let hit;
  while ((hit = keyRe.exec(code))) usedKeys.add(hit[1]);
  check(!/I18N\.t\(\s*[^k'A-Z]/.test(code), rel + ' calls I18N.t with a non-key argument');
});
usedKeys.forEach(function (k) {
  check(k in base, 'code references an unknown key: ' + k);
});
check(usedKeys.size > 150, 'source scan found the keys in use (' + usedKeys.size + ')');

const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const htmlKeys = (html.match(/data-i18n(?:-title|-html|-aria)?="[^"]+"/g) || []).map((s) => s.replace(/.*="|"$/g, ''));
check(htmlKeys.length > 30, 'index.html uses data-i18n (' + htmlKeys.length + ')');
htmlKeys.forEach(function (k) {
  check(k in base, 'index.html references an unknown key: ' + k);
});
LANG_CODES.forEach(function (code) {
  check(html.indexOf('hreflang="' + code + '"') >= 0, 'hreflang missing: ' + code);
  check(html.indexOf('js/i18n/' + code + '.js') >= 0, 'dictionary script missing: ' + code);
});
check(html.indexOf('hreflang="x-default"') >= 0, 'hreflang x-default missing');
check(html.indexOf('id="langSelect"') >= 0, 'language selector missing');
check(html.indexOf('btnLangToggle') < 0, 'old language toggle removed');

console.log(failures === 0 ? '\nALL PASS (' + checks + ' checks)' : '\n' + failures + ' FAILED of ' + checks);
process.exit(failures === 0 ? 0 : 1);
