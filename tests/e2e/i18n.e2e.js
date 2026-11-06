// ============================================
// Date: 2026-11-06
// Version: v1.0.0
// Changes: Browser test for all 9 languages (labels, leftovers, overflow, live switching)
// 修改: 9 種語言的瀏覽器測試（文字、殘留中文、版面溢出、對局中切換語言）
// ============================================
/**
 * 多語系瀏覽器測試（使用本機 Chrome）
 *
 * 執行：
 *   npm i --no-save playwright-core
 *   node tests/e2e/i18n.e2e.js [截圖輸出目錄]
 */
'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');
const { chromium } = require('playwright-core');

const ROOT = path.join(__dirname, '..', '..');
const SHOT_DIR = process.argv[2] || null;
const LANGS = ['zh-TW', 'zh-CN', 'en', 'ja', 'ko', 'vi', 'ru', 'fr', 'tr'];
const NO_HAN_LANGS = new Set(['en', 'ko', 'vi', 'ru', 'fr', 'tr']);
const VIEWPORTS = [
  { name: 'desktop', width: 1366, height: 800 },
  { name: 'phone', width: 390, height: 844 }
];
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.wasm': 'application/wasm' };
/** 允許保留的漢字：台灣分級標誌「普」、象棋／將棋圖示與棋譜 */
const ALLOWED_HAN = /[普帥]/g;
const HAN = /[㐀-鿿]/;
/** 網站沒有 favicon；本機對戰伺服器未啟動時，/api/health 探測失敗屬正常情況 */
const EXPECTED_MISSING = /\/favicon\.ico$|\/api\//;

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
 * 啟動靜態檔案伺服器。
 * @returns {Promise<{server: http.Server, base: string}>} 伺服器與網址
 */
function startServer() {
  const server = http.createServer(function (req, res) {
    const url = decodeURIComponent(req.url.split('?')[0]);
    const file = path.join(ROOT, url === '/' ? 'index.html' : url);
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404);
      res.end();
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise(function (resolve) {
    server.listen(0, '127.0.0.1', function () {
      resolve({ server: server, base: 'http://127.0.0.1:' + server.address().port + '/' });
    });
  });
}

/**
 * 回傳目前畫面可見文字中不該出現的漢字片段。
 * @param {import('playwright-core').Page} page 頁面
 * @returns {Promise<string[]>} 含漢字的片段
 */
async function visibleHan(page) {
  // 語言選單的選項是各語言的自稱，本來就含漢字，不列入檢查
  const text = await page.evaluate(function () {
    const select = document.getElementById('langSelect');
    select.style.display = 'none';
    const visible = document.body.innerText;
    select.style.display = '';
    return visible;
  });
  return text.split('\n').filter((line) => HAN.test(line.replace(ALLOWED_HAN, '')));
}

/**
 * 檢查頁面沒有水平捲動。
 * @param {import('playwright-core').Page} page 頁面
 * @returns {Promise<number>} 超出寬度的像素
 */
async function horizontalOverflow(page) {
  return page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
}

/**
 * 等待語言與大廳內容就緒。
 * @param {import('playwright-core').Page} page 頁面
 * @returns {Promise<void>}
 */
async function waitReady(page) {
  await page.waitForFunction(() => window.BoardArena && BoardArena.App && document.querySelector('#langSelect option'));
  await page.waitForFunction(() => document.querySelector('.playok-game-tile'));
}

/**
 * 逐語言檢查各畫面。
 * @param {import('playwright-core').Browser} browser 瀏覽器
 * @param {string} base 網址
 * @param {string} lang 語言代碼
 * @param {{name: string, width: number, height: number}} vp 視窗
 * @returns {Promise<void>}
 */
async function checkLanguage(browser, base, lang, vp) {
  const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
  const page = await context.newPage();
  const label = lang + '/' + vp.name + ': ';
  const errors = [];
  page.on('pageerror', (err) => errors.push(err.message));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text());
  });
  page.on('requestfailed', (req) => {
    if (!EXPECTED_MISSING.test(req.url())) errors.push('request failed: ' + req.url());
  });
  page.on('response', (res) => {
    if (res.status() >= 400 && !EXPECTED_MISSING.test(res.url())) errors.push(res.status() + ' ' + res.url());
  });

  await page.goto(base + '?lang=' + lang, { waitUntil: 'load' });
  await waitReady(page);
  await page.waitForFunction((code) => document.documentElement.lang === code, lang);
  check((await page.$eval('#langSelect', (el) => el.value)) === lang, label + 'selector shows the language');
  check((await page.title()) === (await page.evaluate(() => BoardArena.I18N.t('meta.title'))), label + 'document title translated');

  const shot = async (name) => {
    if (SHOT_DIR) await page.screenshot({ path: path.join(SHOT_DIR, lang + '-' + vp.name + '-' + name + '.png') });
  };
  const inspect = async (name) => {
    check((await horizontalOverflow(page)) <= 0, label + name + ' overflows horizontally');
    if (NO_HAN_LANGS.has(lang)) {
      const han = await visibleHan(page);
      check(han.length === 0, label + name + ' still shows Chinese: ' + han.slice(0, 3).join(' | '));
    }
    const raw = await page.evaluate(() => document.body.innerText);
    const leaked = raw.match(/\b(?:ui|rule|coach|board|side|game|ai|tc|end|grade|choice|piece|legal|meta|ad|academy|notation)\.[a-zA-Z0-9.]+\b/g) || [];
    const realLeaks = leaked.filter((k) => !/\.(com|io|org|net)$/.test(k));
    check(realLeaks.length === 0, label + name + ' shows raw keys: ' + realLeaks.slice(0, 3).join(', '));
    const unfilled = raw.match(/\{[a-zA-Z]+\}/g) || [];
    check(unfilled.length === 0, label + name + ' shows unfilled placeholders: ' + unfilled.join(', '));
    await shot(name);
  };

  await inspect('lobby');
  await page.evaluate(() => BoardArena.App.switchView('academy'));
  await inspect('academy');
  await page.evaluate(() => BoardArena.App.switchView('legal'));
  await inspect('legal');

  for (const gameId of ['chess', 'shogi', 'backgammon', 'go']) {
    await page.evaluate((id) => {
      BoardArena.App.selectLobbyGame(id);
      BoardArena.App.startBotMatch(id, 'easy', 1);
    }, gameId);
    await page.waitForFunction(() => document.querySelector('#moveHistoryList'));
    await page.waitForTimeout(150);
    await inspect('arena-' + gameId);
  }
  check(errors.length === 0, label + 'console errors: ' + errors.slice(0, 3).join(' | '));
  await context.close();
}

/**
 * 檢查預設語言、記憶語言與對局中切換。
 * @param {import('playwright-core').Browser} browser 瀏覽器
 * @param {string} base 網址
 * @returns {Promise<void>}
 */
async function checkBehaviour(browser, base) {
  const context = await browser.newContext({ locale: 'fr-FR', viewport: { width: 1366, height: 800 } });
  const page = await context.newPage();
  await page.goto(base, { waitUntil: 'load' });
  await waitReady(page);
  check((await page.evaluate(() => BoardArena.I18N.getLang())) === 'zh-TW', 'default stays zh-TW for a French browser');

  await page.evaluate(() => BoardArena.App.startBotMatch('xiangqi', 'easy', 1));
  await page.selectOption('#langSelect', 'ru');
  await page.waitForFunction(() => document.documentElement.lang === 'ru');
  const names = await page.$eval('#playerNameP1', (el) => el.textContent);
  check(names.indexOf('Красные') >= 0, 'player label follows the language during a match: ' + names);
  const header = await page.$eval('#arenaGameHeader', (el) => el.textContent);
  check(header.indexOf('Сянци') >= 0, 'match header follows the language: ' + header);
  const phrases = await page.$eval('#cannedPhraseGrid', (el) => el.textContent);
  check(!HAN.test(phrases), 'canned phrases follow the language: ' + phrases.slice(0, 40));
  const banner = await page.evaluate(() => {
    BoardArena.App.selectPieceSource({ r: 9, c: 1 });
    return document.getElementById('tacticalGuideText').textContent;
  });
  check(!HAN.test(banner), 'selection hint follows the language: ' + banner);

  await page.reload({ waitUntil: 'load' });
  await waitReady(page);
  check((await page.evaluate(() => BoardArena.I18N.getLang())) === 'ru', 'language is remembered after reload');

  await page.goto(base + '?lang=xx', { waitUntil: 'load' });
  await waitReady(page);
  check((await page.evaluate(() => BoardArena.I18N.getLang())) === 'ru', 'invalid ?lang keeps the saved language');
  await context.close();
}

/**
 * 主流程。
 * @returns {Promise<void>}
 */
async function main() {
  if (SHOT_DIR) fs.mkdirSync(SHOT_DIR, { recursive: true });
  const { server, base } = await startServer();
  const browser = await chromium.launch({ channel: 'chrome' });
  try {
    await checkBehaviour(browser, base);
    for (const lang of LANGS) {
      for (const vp of VIEWPORTS) {
        await checkLanguage(browser, base, lang, vp);
      }
      console.log('checked ' + lang);
    }
  } finally {
    await browser.close();
    server.close();
  }
  console.log(failures === 0 ? '\nALL PASS (' + checks + ' checks)' : '\n' + failures + ' FAILED of ' + checks);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(function (err) {
  console.error(err);
  process.exit(1);
});
