// ============================================
// Date: 2026-11-06
// Version: v1.5.0
// Changes: Replace zh/en branches with dictionary lookups; language selector with 9 languages
// 修改: 中英雙語分支全部改用字典；新增 9 種語言的語言選單
// ============================================
// ============================================
// Date: 2026-11-05
// Version: v1.4.0
// Changes: Pass match history to the engine bridge; human-readable end-reason labels in the result dialog
// 修改: 將對局歷史傳給引擎；結算畫面改顯示中英文結束原因（原本顯示程式代碼）
// ============================================
// ============================================
// Date: 2026-11-05
// Version: v1.3.0
// Changes: Pre-load Fairy-Stockfish for engine-backed matches and label the bot name
// 修改: 使用 Fairy-Stockfish 的對局於開局時預先載入引擎，並在電腦名稱標示引擎
// ============================================
// ============================================
// Date: 2026-11-05
// Version: v1.2.0
// Changes: Merge async AI move (chooseMoveAsync, native engine bridge only when local server online)
// 修改: 合併八大棋藝2 的非同步電腦走棋；只有連上本機伺服器才啟用原生引擎
// ============================================
// ============================================
// Date: 2026-11-05
// Version: v1.1.0
// Changes: Skip CMP banner / ad-free hint label when ads off; ONLINE_PVP_ENABLED flag hides login, PvP, live tables, leaderboard and fake online counts
// 修改: 廣告關閉時不顯示 Cookie 同意橫幅、提示改為免廣告；新增 ONLINE_PVP_ENABLED 開關，隱藏登入、雙人對戰、即時對局桌、排行榜與假在線人數
// ============================================
/**
 * Classic Board Arena — Main Application Controller
 * Connects PlayOK 2-Column Lobby, Gomoku.com Tactile Board Stage,
 * Piece-Click Legal-Move/Capture Highlighting, 4-Tier AI, Auth Gate,
 * Glicko-2 Leaderboard, Move Replay, Canned Chat, and AdSense/H5 Ads.
 */
(function (global) {
  'use strict';

  const BoardArena = (global.BoardArena = global.BoardArena || {});

  const stateStore = {
    currentView: 'lobby',
    selectedGameId: 'xiangqi',
    selectedAiLevel: 'normal',
    selectedHumanSide: 1,
    selectedTimeControl: '5+3',
    selectedGoSize: 9,
    gomokuSwapEnabled: true,
    leaderboardGame: 'xiangqi',
    leaderboardTimeClass: 'blitz',
    leaderboardScope: 'all',
    academyGame: 'xiangqi',

    // Active match state
    match: null,
    /*
      match = {
        id, serverGameId, mode: 'bot'|'pvp_local'|'pvp_online'|'spectate',
        gameId, rule, gameState, stateHistory: [s0, s1, ...], moveHistory: [],
        replayIndex: null, // null means live latest state
        humanSide: 1, aiLevel: 'normal', timeControl: '5+3', rated: false,
        clocksMs: { 1: 300000, 2: 300000 }, incrementMs: 3000, lastTickAt: 0,
        players: { 1: { name, rating }, 2: { name, rating } },
        selectedSource: null,
        legalMovesForSelected: [],
        hoverTarget: null,
        hints: [],
        chatLog: []
      }
    */
    aiTimer: null,
    clockInterval: null,
    queueTimer: null,
    pendingAuthCallback: null
  };

  let renderer = null;

  /**
   * 雙人連線功能開關。false = 只開放單人對電腦（隱藏登入、雙人對戰、即時對局桌、排行榜、在線人數）。
   * 等真正的連線後端（登入 + 即時同步）完成後再改成 true。
   */
  const ONLINE_PVP_ENABLED = false;

  function $(id) {
    return document.getElementById(id);
  }

  /**
   * 取得目前語言的介面文字。
   * @param {string} key 字典 key
   * @param {Object} [params] 佔位符參數
   * @returns {string} 翻譯後的文字
   */
  function T(key, params) {
    return BoardArena.I18N.t(key, params);
  }

  /**
   * 取得棋種名稱。
   * @param {string} gameId 棋種 id
   * @returns {string} 目前語言的棋種名稱
   */
  function gameName(gameId) {
    return T('game.' + gameId + '.name');
  }

  /**
   * 組出電腦對手的顯示名稱。
   * @param {string} levelId 難度 id
   * @param {boolean} usesEngine 是否使用 Fairy-Stockfish
   * @returns {string} 顯示名稱
   */
  function botDisplayName(levelId, usesEngine) {
    return T('ui.botName', { level: T('ai.' + levelId) }) + (usesEngine ? ' · Fairy-Stockfish' : '');
  }

  function getCatalogEntry(gameId) {
    return (
      BoardArena.GAME_CATALOG.find(function (g) {
        return g.id === gameId;
      }) || BoardArena.GAME_CATALOG[0]
    );
  }

  function formatClock(ms) {
    const clamped = Math.max(0, Math.floor(ms));
    const totalSec = Math.floor(clamped / 1000);
    const min = Math.floor(totalSec / 60);
    const sec = totalSec % 60;
    if (totalSec < 20) {
      const tenths = Math.floor((clamped % 1000) / 100);
      return String(min).padStart(2, '0') + ':' + String(sec).padStart(2, '0') + '.' + tenths;
    }
    return String(min).padStart(2, '0') + ':' + String(sec).padStart(2, '0');
  }

  /* =========================================================================
   * INITIALIZATION & GLOBAL UI REFRESH
   * ========================================================================= */
  /**
   * 在第一次渲染前套用網址指定的語言（?lang=），避免先閃過預設語言。
   * @returns {void}
   */
  function applyLanguageFromUrl() {
    const qLang = new URLSearchParams(global.location.search || '').get('lang');
    if (qLang && BoardArena.I18N.isSupported(qLang)) BoardArena.I18N.setLang(qLang);
  }

  async function initApp() {
    applyLanguageFromUrl();
    const canvas = $('arenaBoardCanvas');
    if (canvas) {
      renderer = BoardArena.createRenderer(canvas);
      bindCanvasEvents(canvas);
    }

    await BoardArena.Client.init();
    // 只有連上本機 BoardArenaServer 時才呼叫原生棋力引擎；公開網站直接用瀏覽器內建 AI
    BoardArena.AI.useNativeEngineBridge = BoardArena.Client.isServerOnline();
    BoardArena.Client.onEvent(function (ev) {
      if (ev.type === 'auth_changed') {
        renderHeaderAuth();
        renderLobbyGameHall();
      } else if (ev.type === 'remote_move' && stateStore.match && ev.gameId === stateStore.match.id) {
        applyMatchMoveInternal(ev.move, true);
      }
    });

    initGdprConsentBanner();
    if (!ONLINE_PVP_ENABLED) {
      const lbNav = $('nav-leaderboard');
      if (lbNav) lbNav.style.display = 'none';
    }
    applyTranslations();
    renderPlayOkDirectory();
    await renderLobbyGameHall();
    await renderLeaderboardView();
    renderAcademyView();

    BoardArena.AdsManager.renderDisplaySlot($('adSlotLobby'), 'lobby');
    BoardArena.AdsManager.renderDisplaySlot($('adSlotAcademy'), 'academy');

    stateStore.clockInterval = setInterval(tickMatchClock, 100);

    // Keyboard shortcut Ctrl+Z for Single-Player Undo
    if (typeof document !== 'undefined') {
      document.addEventListener('keydown', function (ev) {
        if ((ev.ctrlKey || ev.metaKey) && (ev.key === 'z' || ev.key === 'Z')) {
          if (stateStore.currentView === 'arena' && stateStore.match && stateStore.match.mode === 'bot') {
            ev.preventDefault();
            undoBotMove();
          }
        }
      });
    }

    // Check URL hash for direct game or shared replay
    handleUrlHash();
  }

  function handleUrlHash() {
    const h = global.location.hash || '';
    if (h.indexOf('#game=') === 0) {
      const gid = decodeURIComponent(h.slice(6));
      if (BoardArena.GAME_CATALOG.some(function (g) { return g.id === gid; })) {
        selectLobbyGame(gid);
      }
    }

    try {
      const sp = new URLSearchParams(global.location.search || '');
      const qGame = sp.get('game');
      if (qGame && BoardArena.GAME_CATALOG.some(function (g) { return g.id === qGame; })) {
        stateStore.selectedGameId = qGame;
        stateStore.leaderboardGame = qGame;
        stateStore.academyGame = qGame;
        renderPlayOkDirectory();
        renderLobbyGameHall();
      }
      const qView = sp.get('view');
      if (qView && ['lobby', 'arena', 'leaderboard', 'academy', 'legal'].indexOf(qView) >= 0) {
        switchView(qView);
      }
      const qSelect = sp.get('select');
      if (qSelect && stateStore.match) {
        if (qSelect.indexOf('pt:') === 0) {
          selectPieceSource({ zone: 'point', index: parseInt(qSelect.slice(3), 10) });
        } else if (qSelect.indexOf(',') > 0) {
          const parts = qSelect.split(',');
          selectPieceSource({ r: parseInt(parts[0], 10), c: parseInt(parts[1], 10) });
        }
      }
      if (sp.get('mentor') === 'demo' && stateStore.match) {
        runDemoMovesAndOpenMentor();
      }
      if (ONLINE_PVP_ENABLED && sp.get('auth') === 'prompt') {
        openAuthModal(true);
      }
    } catch (e) {}
  }

  function switchView(viewName) {
    if (!ONLINE_PVP_ENABLED && viewName === 'leaderboard') viewName = 'lobby';
    stateStore.currentView = viewName;
    ['lobby', 'arena', 'leaderboard', 'academy', 'legal'].forEach(function (v) {
      const el = $('view-' + v);
      const nav = $('nav-' + v);
      if (el) el.classList.toggle('active', v === viewName);
      if (nav) nav.classList.toggle('active', v === viewName);
    });

    if (viewName === 'arena') {
      if (!stateStore.match) {
        startBotMatch(stateStore.selectedGameId, stateStore.selectedAiLevel, stateStore.selectedHumanSide);
      } else {
        redrawBoard();
      }
    } else if (viewName === 'leaderboard') {
      renderLeaderboardView();
    } else if (viewName === 'academy') {
      renderAcademyView();
      BoardArena.AdsManager.renderDisplaySlot($('adSlotAcademy'), 'academy');
    } else if (viewName === 'lobby') {
      BoardArena.AdsManager.renderDisplaySlot($('adSlotLobby'), 'lobby');
      renderLobbyGameHall();
    }
  }

  /**
   * 切換語言並重繪所有畫面。
   * @param {string} code 語言代碼
   * @returns {void}
   */
  function setLanguage(code) {
    BoardArena.I18N.setLang(code);
    applyTranslations();
    renderPlayOkDirectory();
    renderLobbyGameHall();
    renderLeaderboardView();
    renderAcademyView();
    const phraseGrid = $('cannedPhraseGrid');
    if (phraseGrid) delete phraseGrid.dataset.ready;
    if (stateStore.match) refreshMatchLanguage(stateStore.match);
    BoardArena.AdsManager.renderDisplaySlot($('adSlotLobby'), 'lobby');
    BoardArena.AdsManager.renderDisplaySlot($('adSlotAcademy'), 'academy');
  }

  /**
   * 語言切換後更新進行中的對局：玩家名稱、提示列、導師面板與棋盤文字。
   * @param {Object} m 目前的對局
   * @returns {void}
   */
  function refreshMatchLanguage(m) {
    if (m.mode === 'bot') {
      const user = BoardArena.Client.getCurrentUser();
      const humanName = user ? user.displayName : T('ui.guestPlayer');
      const relabel = function (player) {
        return { ...player, name: player.isBot ? botDisplayName(m.aiLevel, m.usesEngine) : humanName };
      };
      m.players = { 1: relabel(m.players[1]), 2: relabel(m.players[2]) };
    }
    updateArenaSidePanels();
    const mentorStep = m.mentorActive && m.mentorReport ? m.mentorReport.steps[m.mentorStepIndex] : null;
    updateTacticalGuideBanner(mentorStep ? renderCoachComment(mentorStep) : null);
    if (m.mentorActive) renderMentorReviewUI();
    redrawBoard();
  }

  function toggleTheme() {
    document.body.classList.toggle('theme-light');
    applyTranslations();
  }

  function toggleSound() {
    BoardArena.SoundFX.toggle();
    applyTranslations();
  }

  function applyTranslations() {
    setText('brandTitle', T('ui.brandTitle'));
    setText('brandSubtitle', T('ui.brandSubtitle'));
    setText('backToStudioLink', T('ui.backToStudio'));
    setText('nav-lobby', T('ui.navLobby'));
    setText('nav-arena', T('ui.navArena'));
    setText('nav-leaderboard', T('ui.navLeaderboard'));
    setText('nav-academy', T('ui.navAcademy'));
    setText('nav-legal', T('ui.navLegal'));
    setText('btnSoundToggle', BoardArena.SoundFX.isEnabled() ? T('ui.soundOn') : T('ui.soundOff'));
    setText('btnThemeToggle', document.body.classList.contains('theme-light') ? T('ui.themeDark') : T('ui.themeLight'));
    applyStaticTranslations();
    setText('twRatingTitle', T('ui.twRatingTitle'));
    setText('twRatingWarning', T('ui.twRatingWarning'));
    renderHeaderAuth();
  }

  /**
   * 套用 index.html 內的靜態文字（data-i18n）、頁面語言、標題與語言選單。
   * @returns {void}
   */
  function applyStaticTranslations() {
    const I18N = BoardArena.I18N;
    document.documentElement.lang = I18N.getLang();
    document.title = T('meta.title');
    const desc = document.querySelector('meta[name="description"]');
    if (desc) desc.setAttribute('content', T('meta.description'));

    document.querySelectorAll('[data-i18n]').forEach(function (el) {
      el.textContent = T(el.getAttribute('data-i18n'));
    });
    document.querySelectorAll('[data-i18n-title]').forEach(function (el) {
      el.title = T(el.getAttribute('data-i18n-title'));
    });
    document.querySelectorAll('[data-i18n-aria]').forEach(function (el) {
      el.setAttribute('aria-label', T(el.getAttribute('data-i18n-aria')));
    });
    const contact = $('legalContactText');
    if (contact) {
      const parts = T('legal.contactBody').split('{link}');
      const link = document.createElement('a');
      link.href = 'https://github.com/Yehtech/board-arena/issues';
      link.target = '_blank';
      link.rel = 'noopener';
      link.style.color = 'var(--accent-gold)';
      link.textContent = 'GitHub Issues';
      contact.replaceChildren(parts[0] || '', link, parts[1] || '');
    }

    const select = $('langSelect');
    if (select) {
      if (select.options.length === 0) {
        I18N.LANGUAGES.forEach(function (item) {
          const opt = document.createElement('option');
          opt.value = item.code;
          opt.lang = item.code;
          opt.textContent = item.label;
          select.appendChild(opt);
        });
      }
      select.value = I18N.getLang();
    }
  }

  function setText(id, txt) {
    const el = $(id);
    if (el) el.textContent = txt;
  }

  function renderHeaderAuth() {
    const container = $('headerAuthArea');
    if (!container) return;
    if (!ONLINE_PVP_ENABLED) {
      container.innerHTML = '';
      return;
    }
    const user = BoardArena.Client.getCurrentUser();
    const serverBadge = BoardArena.Client.isServerOnline()
      ? '<span class="playok-count-pill" title="BoardArenaServer.exe">● ' + T('ui.serverOnline') + '</span>'
      : '<span class="playok-count-pill" style="color:#38bdf8;border-color:#38bdf8;">● ' + T('ui.localArena') + '</span>';

    if (user) {
      container.innerHTML =
        serverBadge +
        '<button type="button" class="cba-btn" onclick="BoardArena.App.openProfileModal()">👤 ' +
        escapeHtml(user.displayName) +
        '</button>' +
        '<button type="button" class="cba-btn cba-btn-ghost" onclick="BoardArena.App.logout()">' +
        T('ui.logoutBtn') +
        '</button>';
    } else {
      container.innerHTML =
        serverBadge +
        '<span style="font-size:12px;color:var(--text-muted);">' +
        T('ui.guestBadge') +
        '</span>' +
        '<button type="button" class="cba-btn cba-btn-gold" id="btnHeaderLogin" onclick="BoardArena.App.openAuthModal()">' +
        T('ui.loginBtn') +
        '</button>';
    }
  }

  /* =========================================================================
   * PLAYOK 2-COLUMN DIRECTORY & GAME HALL
   * ========================================================================= */
  function renderPlayOkDirectory() {
    const grid = $('playokDirectoryGrid');
    if (!grid) return;

    grid.innerHTML = BoardArena.GAME_CATALOG.map(function (g) {
      const sel = g.id === stateStore.selectedGameId ? ' selected' : '';
      const title = gameName(g.id);
      const mat = T('game.' + g.id + '.material');
      return (
        '<div class="playok-game-tile' +
        sel +
        '" data-game-tile="' +
        g.id +
        '" onclick="BoardArena.App.selectLobbyGame(\'' +
        g.id +
        '\')">' +
        '<div class="playok-tile-row1">' +
        '<span class="playok-game-link"><span>' +
        BoardArena.I18N.glyphs(g.icon) +
        '</span><span>' +
        title +
        '</span></span>' +
        (ONLINE_PVP_ENABLED ? '<span class="playok-count-pill">(' + g.baseOnline + ')</span>' : '') +
        '</div>' +
        '<div class="playok-tile-sub">' +
        T('game.' + g.id + '.grid') +
        ' · ' +
        mat +
        '</div>' +
        '</div>'
      );
    }).join('');
  }

  function selectLobbyGame(gameId) {
    stateStore.selectedGameId = gameId;
    renderPlayOkDirectory();
    renderLobbyGameHall();
  }

  async function renderLobbyGameHall() {
    const panel = $('lobbyGameHallContent');
    if (!panel) return;
    const g = getCatalogEntry(stateStore.selectedGameId);
    const title = gameName(g.id);
    const loggedIn = BoardArena.Client.isLoggedIn();
    const user = BoardArena.Client.getCurrentUser();
    const lobbyData = await BoardArena.Client.getLobbyData(g.id);

    const aiBtns = BoardArena.AI_LEVELS.map(function (lv) {
      const act = stateStore.selectedAiLevel === lv.id ? ' active' : '';
      return (
        '<button type="button" class="tier-btn' +
        act +
        '" onclick="BoardArena.App.setAiLevel(\'' +
        lv.id +
        '\')">' +
        (T('ai.' + lv.id)) +
        '<div style="font-size:10.5px;opacity:0.8;" class="cba-tabular">~' +
        lv.badgeRating +
        '</div></button>'
      );
    }).join('');

    const tcBtns = BoardArena.TIME_CONTROLS.map(function (tc) {
      const act = stateStore.selectedTimeControl === tc.id ? ' active' : '';
      return (
        '<button type="button" class="tier-btn cba-tabular' +
        act +
        '" onclick="BoardArena.App.setTimeControl(\'' +
        tc.id +
        '\')">' +
        (T('tc.' + tc.timeClass)) +
        '</button>'
      );
    }).join('');

    let extraGameOpts = '';
    if (g.id === 'go') {
      extraGameOpts =
        '<div style="display:flex;gap:6px;align-items:center;font-size:12.5px;">' +
        '<span>' +
        T('ui.boardSize') +
        '</span>' +
        [9, 13, 19]
          .map(function (sz) {
            return (
              '<button type="button" class="tier-btn cba-tabular' +
              (stateStore.selectedGoSize === sz ? ' active' : '') +
              '" style="padding:4px 10px;" onclick="BoardArena.App.setGoSize(' +
              sz +
              ')">' +
              sz +
              '×' +
              sz +
              '</button>'
            );
          })
          .join('') +
        '</div>';
    } else if (g.id === 'gomoku') {
      extraGameOpts =
        '<label style="display:flex;align-items:center;gap:6px;font-size:12.5px;cursor:pointer;">' +
        '<input type="checkbox" ' +
        (stateStore.gomokuSwapEnabled ? 'checked' : '') +
        ' onchange="BoardArena.App.toggleGomokuSwap(this.checked)" /> ' +
        T('ui.enable3StoneSwap') +
        '</label>';
    }

    const authNoticeHtml = loggedIn
      ? '<div class="auth-lock-notice" style="border-color:#22c55e;background:rgba(22,163,74,0.14);color:#86efac;">' +
        '<span>✅ ' +
        T('ui.signedAs') +
        '<b>' +
        escapeHtml(user.displayName) +
        '</b>' + T('ui.ratingEnabled') + '</span></div>'
      : '<div class="auth-lock-notice">' +
        '<span>' +
        T('ui.loginRequiredBanner') +
        '</span>' +
        '<button type="button" class="cba-btn cba-btn-gold" onclick="BoardArena.App.openAuthModal()">' +
        T('ui.loginBtn') +
        '</button></div>';

    const roomRows = (lobbyData.rooms || [])
      .map(function (rm) {
        const waiting = rm.status === 'waiting';
        return (
          '<tr>' +
          '<td class="cba-tabular"><b>#' +
          escapeHtml(rm.id) +
          '</b></td>' +
          '<td class="cba-tabular">' +
          escapeHtml(rm.timeControl) +
          '</td>' +
          '<td>' +
          escapeHtml(rm.hostName) +
          ' <span class="cba-tabular" style="color:var(--accent-gold);">(' +
          Math.round(rm.hostRating || 1500) +
          ')</span></td>' +
          '<td>' +
          (rm.guestName
            ? escapeHtml(rm.guestName) + ' <span class="cba-tabular">(' + Math.round(rm.guestRating || 1500) + ')</span>'
            : '<span style="color:#4ade80;">' + T('ui.openSeat') + '</span>') +
          '</td>' +
          '<td>' +
          (waiting
            ? '<button type="button" class="cba-btn cba-btn-emerald" style="padding:4px 10px;font-size:12px;" onclick="BoardArena.App.handleJoinRoom(\'' +
              escapeHtml(rm.id) +
              '\')">' +
              T('ui.joinLogin') +
              '</button>'
            : '<button type="button" class="cba-btn" style="padding:4px 10px;font-size:12px;" onclick="BoardArena.App.spectateDemoTable(\'' +
              g.id +
              '\')">👁️ ' +
              T('ui.watch') +
              ' (' +
              (rm.spectators || 2) +
              ')</button>') +
          '</td>' +
          '</tr>'
        );
      })
      .join('');

    panel.innerHTML =
      '<div class="cba-panel-header">' +
      '<div>' +
      '<div class="cba-panel-title">' +
      BoardArena.I18N.glyphs(g.icon) +
      ' ' +
      title +
      (ONLINE_PVP_ENABLED
        ? ' <span class="cba-tabular">(' + g.baseOnline + ' ' + T('ui.onlineUnit') + ')</span>'
        : '') +
      '</div>' +
      '<div style="font-size:12.5px;color:var(--text-muted);">' +
      (T('game.' + g.id + '.material')) +
      '</div>' +
      '</div>' +
      '<button type="button" class="cba-btn" onclick="BoardArena.App.openRulesFor(\'' +
      g.id +
      '\')">📖 ' +
      T('ui.rulesGuide') +
      '</button>' +
      '</div>' +
      '<div class="mode-launch-grid">' +
      // Single Player vs AI Box
      '<div class="mode-box">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;">' +
      '<b style="font-size:15px;">' +
      T('ui.playVsBot') +
      '</b>' +
      '<span style="font-size:11.5px;color:#4ade80;font-weight:700;">' +
      T('ui.noLoginNeeded') +
      '</span>' +
      '</div>' +
      '<div style="font-size:12px;color:var(--text-muted);">' +
      T('ui.selectComputerDifficulty4') +
      '</div>' +
      '<div class="ai-tier-group">' +
      aiBtns +
      '</div>' +
      '<div style="display:flex;gap:8px;align-items:center;justify-content:space-between;flex-wrap:wrap;">' +
      '<div style="display:flex;gap:6px;">' +
      '<button type="button" class="tier-btn' +
      (stateStore.selectedHumanSide === 1 ? ' active' : '') +
      '" style="padding:5px 10px;" onclick="BoardArena.App.setHumanSide(1)">' +
      T('ui.playFirst') +
      '</button>' +
      '<button type="button" class="tier-btn' +
      (stateStore.selectedHumanSide === 2 ? ' active' : '') +
      '" style="padding:5px 10px;" onclick="BoardArena.App.setHumanSide(2)">' +
      T('ui.playSecond') +
      '</button>' +
      '</div>' +
      extraGameOpts +
      '</div>' +
      (ONLINE_PVP_ENABLED
        ? ''
        : '<div style="font-size:12px;color:var(--text-muted);">' +
          T('ui.timeControl') +
          '</div><div class="tc-pill-group">' +
          tcBtns +
          '</div>') +
      '<button type="button" class="cba-btn cba-btn-gold" id="btnStartBotMatch" onclick="BoardArena.App.startBotFromLobby()">▶️ ' +
      T('ui.startVsComputer') +
      '</button>' +
      '</div>' +
      // PvP 區塊會自行關閉 mode-launch-grid 並接上即時對局桌；關閉時只需關閉 grid
      (ONLINE_PVP_ENABLED ? renderPvpSectionsHtml(authNoticeHtml, tcBtns, roomRows) : '</div>');
  }

  /** 雙人對戰區塊與即時對局桌列表（僅在 ONLINE_PVP_ENABLED 時顯示） */
  function renderPvpSectionsHtml(authNoticeHtml, tcBtns, roomRows) {
    return (
      // Two Player Ranked Box (Requires Login!)
      '<div class="mode-box pvp-gated">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;">' +
      '<b style="font-size:15px;">⚔️ ' +
      T('ui.twoPlayerRankedArena') +
      '</b>' +
      '<span style="font-size:11.5px;color:#38bdf8;font-weight:800;">🔒 ' +
      T('ui.loginRequired') +
      '</span>' +
      '</div>' +
      authNoticeHtml +
      '<div class="tc-pill-group">' +
      tcBtns +
      '</div>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">' +
      '<button type="button" class="cba-btn cba-btn-emerald" id="btnQuickPvp" onclick="BoardArena.App.handleQuickMatch()">' +
      T('ui.playPvpQuick') +
      '</button>' +
      '<button type="button" class="cba-btn" id="btnCreateRoom" onclick="BoardArena.App.handleCreateRoom()">' +
      T('ui.playPvpRoom') +
      '</button>' +
      '</div>' +
      '<button type="button" class="cba-btn" id="btnLocalPvp" onclick="BoardArena.App.handleStartLocalPvp()">' +
      T('ui.playPvpLocal') +
      '</button>' +
      '</div>' +
      '</div>' +
      // PlayOK Live Tables
      '<div style="margin-top:8px;">' +
      '<div style="font-weight:800;font-size:13.5px;margin-bottom:8px;color:var(--text-secondary);">📋 ' +
      T('ui.liveGameTablesRooms') +
      '</div>' +
      '<div style="overflow-x:auto;">' +
      '<table class="cba-table">' +
      '<thead><tr><th>' +
      T('ui.table') +
      '</th><th>' +
      T('ui.clock') +
      '</th><th>' +
      T('ui.seat1') +
      '</th><th>' +
      T('ui.seat2') +
      '</th><th>' +
      T('ui.action') +
      '</th></tr></thead>' +
      '<tbody>' +
      roomRows +
      '</tbody></table></div></div>'
    );
  }

  /* =========================================================================
   * MATCH CREATION & GAMEPLAY ENGINE
   * ========================================================================= */
  function startBotFromLobby() {
    startBotMatch(stateStore.selectedGameId, stateStore.selectedAiLevel, stateStore.selectedHumanSide);
  }

  function startBotMatch(gameId, aiLevel, humanSide) {
    clearTimers();
    const rule = BoardArena.getRule(gameId);
    const tcObj =
      BoardArena.TIME_CONTROLS.find(function (t) {
        return t.id === stateStore.selectedTimeControl;
      }) || BoardArena.TIME_CONTROLS[1];

    const initOpts = {
      boardSize: stateStore.selectedGoSize,
      swapRule: stateStore.gomokuSwapEnabled,
      seed: Date.now()
    };
    const initialState = rule.createInitialState(initOpts);
    const lvInfo =
      BoardArena.AI_LEVELS.find(function (x) {
        return x.id === aiLevel;
      }) || BoardArena.AI_LEVELS[1];

    const user = BoardArena.Client.getCurrentUser();
    const humanName = user ? user.displayName : T('ui.guestPlayer');
    // 西洋棋／象棋／將棋的困難與大師難度，在支援的瀏覽器改用 Fairy-Stockfish 引擎
    const usesEngine = Boolean(BoardArena.FSF && BoardArena.FSF.shouldUseEngine(gameId, lvInfo.id));
    if (usesEngine) BoardArena.FSF.warmUp(gameId, lvInfo.id);
    const botName = botDisplayName(lvInfo.id, usesEngine);

    const side = humanSide === 2 ? 2 : 1;
    stateStore.match = {
      id: 'bot_' + Date.now(),
      serverGameId: null,
      mode: 'bot',
      gameId: gameId,
      rule: rule,
      gameState: initialState,
      stateHistory: [rule.cloneState(initialState)],
      moveHistory: [],
      replayIndex: null,
      humanSide: side,
      aiLevel: lvInfo.id,
      usesEngine: usesEngine,
      timeControl: tcObj.id,
      rated: false,
      clocksMs: { 1: tcObj.initialMs, 2: tcObj.initialMs },
      incrementMs: tcObj.incrementMs,
      lastTickAt: Date.now(),
      players: {
        1: side === 1 ? { name: humanName, rating: '—', isBot: false } : { name: botName, rating: lvInfo.badgeRating, isBot: true },
        2: side === 2 ? { name: humanName, rating: '—', isBot: false } : { name: botName, rating: lvInfo.badgeRating, isBot: true }
      },
      selectedSource: null,
      legalMovesForSelected: [],
      hoverTarget: null,
      hints: [],
      mentorReport: null,
      mentorActive: false,
      mentorStepIndex: null,
      undoCount: 0,
      chatLog: []
    };

    closeMentorReview();
    BoardArena.AdsManager.setMatchLock(true);
    switchView('arena');
    updateArenaSidePanels();
    updateTacticalGuideBanner(null);
    redrawBoard();
    scheduleBotIfNeeded();
  }

  /**
   * STRICT 2-PLAYER AUTH GATE HANDLERS
   */
  function requireLoginOrRun(actionFn) {
    if (!BoardArena.Client.isLoggedIn()) {
      BoardArena.SoundFX.playIllegal();
      stateStore.pendingAuthCallback = actionFn;
      openAuthModal(true);
      return;
    }
    actionFn();
  }

  function handleQuickMatch() {
    requireLoginOrRun(function () {
      openQuickMatchQueueModal();
    });
  }

  function handleCreateRoom() {
    requireLoginOrRun(async function () {
      try {
        const res = await BoardArena.Client.createPvpRoom(stateStore.selectedGameId, stateStore.selectedTimeControl);
        await renderLobbyGameHall();
        showInviteRoomModal(res.room);
      } catch (err) {
        if (err.status === 401) openAuthModal(true);
      }
    });
  }

  function handleJoinRoom(roomId) {
    requireLoginOrRun(async function () {
      try {
        const res = await BoardArena.Client.joinPvpRoom(roomId);
        const oppName = (res.room && res.room.hostName) || T('ui.onlineChallenger');
        launchAuthenticatedPvpMatch('pvp_online', oppName, (res.room && res.room.hostRating) || 1650, res.gameId || null);
      } catch (err) {
        if (err.status === 401) openAuthModal(true);
      }
    });
  }

  function handleStartLocalPvp() {
    requireLoginOrRun(function () {
      openSecondPlayerModal();
    });
  }

  async function launchAuthenticatedPvpMatch(mode, opponentName, opponentRating, serverGameId) {
    BoardArena.Client.assertPvpAuthenticated();
    clearTimers();

    const gameId = stateStore.selectedGameId;
    const rule = BoardArena.getRule(gameId);
    const tcObj =
      BoardArena.TIME_CONTROLS.find(function (t) {
        return t.id === stateStore.selectedTimeControl;
      }) || BoardArena.TIME_CONTROLS[1];

    const initialState = rule.createInitialState({
      boardSize: stateStore.selectedGoSize,
      swapRule: stateStore.gomokuSwapEnabled,
      seed: Date.now()
    });
    const user = BoardArena.Client.getCurrentUser();

    let srvId = serverGameId;
    if (!srvId && BoardArena.Client.isServerOnline()) {
      try {
        const created = await BoardArena.Client.startLocalAuthenticatedPvp(gameId, tcObj.id, opponentName);
        if (created && created.gameId) srvId = created.gameId;
      } catch (e) {}
    }

    stateStore.match = {
      id: srvId || 'pvp_' + Date.now(),
      serverGameId: srvId || null,
      mode: mode,
      gameId: gameId,
      rule: rule,
      gameState: initialState,
      stateHistory: [rule.cloneState(initialState)],
      moveHistory: [],
      replayIndex: null,
      humanSide: 0, // both sides interactive locally / synced via BroadcastChannel
      aiLevel: null,
      timeControl: tcObj.id,
      rated: true,
      clocksMs: { 1: tcObj.initialMs, 2: tcObj.initialMs },
      incrementMs: tcObj.incrementMs,
      lastTickAt: Date.now(),
      players: {
        1: { name: user.displayName, rating: 1500, isBot: false },
        2: { name: opponentName, rating: opponentRating || 1520, isBot: false }
      },
      selectedSource: null,
      legalMovesForSelected: [],
      hoverTarget: null,
      hints: [],
      mentorReport: null,
      mentorActive: false,
      mentorStepIndex: null,
      undoCount: 0,
      chatLog: []
    };

    closeMentorReview();
    BoardArena.AdsManager.setMatchLock(true);
    switchView('arena');
    updateArenaSidePanels();
    updateTacticalGuideBanner(null);
    redrawBoard();
  }

  function spectateDemoTable(gameId) {
    startBotMatch(gameId, 'master', 1);
    addChatMessage(T('ui.chatSystem'), T('ui.enteredTableClickAny'));
  }

  /* =========================================================================
   * CANVAS INTERACTION & PIECE-CLICK LEGAL MOVE HIGHLIGHTING
   * ========================================================================= */
  function bindCanvasEvents(canvas) {
    canvas.addEventListener('mousemove', function (ev) {
      const m = stateStore.match;
      if (!m || !renderer || m.replayIndex !== null) return;
      const target = renderer.hitTest(ev.clientX, ev.clientY);
      m.hoverTarget = target;
      redrawBoard();
    });

    canvas.addEventListener('mouseleave', function () {
      const m = stateStore.match;
      if (!m) return;
      m.hoverTarget = null;
      redrawBoard();
    });

    canvas.addEventListener('click', function (ev) {
      const m = stateStore.match;
      if (!m || !renderer) return;
      if (m.replayIndex !== null) {
        m.replayIndex = null; // Exit replay scrub back to live board
        redrawBoard();
        updateArenaSidePanels();
        return;
      }
      const target = renderer.hitTest(ev.clientX, ev.clientY);
      if (!target) return;
      handleBoardClickTarget(target);
    });
  }

  function isHumanTurnNow(m) {
    if (!m || m.gameState.status === 'ended') return false;
    if (m.mode === 'bot') {
      return m.gameState.currentPlayer === m.humanSide || m.gameState.status === 'scoring';
    }
    return true;
  }

  function handleBoardClickTarget(target) {
    const m = stateStore.match;
    if (!m || !isHumanTurnNow(m)) return;
    const gs = m.gameState;
    const rule = m.rule;

    // Go Dead-Stone Marking Phase
    if (m.gameId === 'go' && gs.status === 'scoring' && target.type === 'cell') {
      if (gs.board[target.r][target.c] !== 0) {
        const toggleMove = {
          id: 'toggle_dead:' + target.r + ',' + target.c,
          action: 'toggle_dead',
          from: null,
          to: { r: target.r, c: target.c },
          isCapture: false,
          notation: 'Mark Dead'
        };
        applyMatchMoveInternal(toggleMove, false);
      }
      return;
    }

    if (gs.status !== 'playing') return;

    // 1. DROP GAMES (Othello, Gomoku, Go)
    if (rule.selectionMode === 'drop') {
      if (target.type !== 'cell') return;
      const legal = rule.getLegalMoves(gs, gs.currentPlayer);
      const found = legal.find(function (mv) {
        return mv.to && mv.to.r === target.r && mv.to.c === target.c;
      });
      if (found) {
        applyMatchMoveInternal(found, false);
      } else {
        BoardArena.SoundFX.playIllegal();
        updateTacticalGuideBanner(
          T('ui.pointNotLegalMove')
        );
      }
      return;
    }

    // 2. PIECE-SELECTION GAMES (Xiangqi, Chess, Shogi, International Draughts, Backgammon)
    // Check first if clicking one of the highlighted legal destinations for the ALREADY selected piece!
    if (m.selectedSource && m.legalMovesForSelected.length > 0) {
      const matchingDestMoves = m.legalMovesForSelected.filter(function (mv) {
        return targetMatchesMoveDest(target, mv.to);
      });
      if (matchingDestMoves.length === 1) {
        applyMatchMoveInternal(matchingDestMoves[0], false);
        return;
      } else if (matchingDestMoves.length > 1) {
        // e.g., Chess Promotion (Q/R/B/N) or Shogi Promote vs Keep!
        openMoveChoiceModal(matchingDestMoves);
        return;
      }
    }

    // Otherwise check if user clicked a friendly selectable piece / hand / bar / point!
    const candidateSource = targetToSourceDescriptor(m.gameId, gs, target);
    if (candidateSource) {
      selectPieceSource(candidateSource);
    } else {
      m.selectedSource = null;
      m.legalMovesForSelected = [];
      updateTacticalGuideBanner(null);
      redrawBoard();
    }
  }

  /**
   * Programmatic & interactive piece selection — highlights all legal moves & captures!
   */
  function selectPieceSource(sourceDesc) {
    const m = stateStore.match;
    if (!m) return [];
    const gs = m.gameState;
    const rule = m.rule;
    const moves = rule.getMovesForSource(gs, sourceDesc);

    m.selectedSource = sourceDesc;
    m.legalMovesForSelected = moves;
    BoardArena.SoundFX.playSelect();

    if (moves.length > 0) {
      const capCount = moves.filter(function (x) {
        return x.isCapture;
      }).length;
      const emptyCount = moves.length - capCount;
      updateTacticalGuideBanner(
        T('ui.pieceSelectedHint', { total: moves.length, empty: emptyCount, capture: capCount })
      );
    } else {
      let reason = T('ui.pieceCurrently0Legal');
      if (rule.canSelectSource) {
        const info = rule.canSelectSource(gs, sourceDesc, gs.currentPlayer);
        if (info && info.reason) {
          reason = '⚠️ ' + BoardArena.I18N.render(info.reason);
        }
      }
      updateTacticalGuideBanner(reason);
    }

    redrawBoard();
    return moves;
  }

  function targetMatchesMoveDest(target, to) {
    if (!target || !to) return false;
    if (target.type === 'cell' && typeof to.r === 'number') {
      return target.r === to.r && target.c === to.c;
    }
    if (target.zone === 'point' && to.zone === 'point') {
      return target.index === to.index;
    }
    if (target.zone === 'off' && to.zone === 'off') {
      return target.owner === to.owner;
    }
    return false;
  }

  function targetToSourceDescriptor(gameId, gs, target) {
    const cur = gs.currentPlayer;
    if (target.type === 'cell') {
      const p = gs.board && gs.board[target.r] && gs.board[target.r][target.c];
      if (p && p.owner === cur) {
        return { r: target.r, c: target.c };
      }
      return null;
    }
    if (gameId === 'shogi' && target.type === 'hand') {
      if (target.owner === cur && gs.hands && gs.hands[cur] && gs.hands[cur][target.piece] > 0) {
        return { zone: 'hand', owner: cur, piece: target.piece };
      }
      return null;
    }
    if (gameId === 'backgammon') {
      if (target.zone === 'bar' && target.owner === cur && gs.bar && gs.bar[cur] > 0) {
        return { zone: 'bar', owner: cur };
      }
      if (target.zone === 'point') {
        const pt = gs.points && gs.points[target.index];
        if (pt && pt.owner === cur && pt.count > 0) {
          return { zone: 'point', index: target.index };
        }
      }
    }
    return null;
  }

  function applyMatchMoveInternal(move, fromRemote) {
    const m = stateStore.match;
    if (!m) return;
    const prevPlayer = m.gameState.currentPlayer;
    const nextState = m.rule.applyMove(m.gameState, move);

    // Sound effects
    if (nextState.status === 'ended' && nextState.winner) {
      BoardArena.SoundFX.playVictory();
    } else if (nextState.inCheck && nextState.inCheck !== 0) {
      BoardArena.SoundFX.playCheck();
    } else if (move.isCapture) {
      if (m.gameId === 'othello') BoardArena.SoundFX.playFlip();
      else BoardArena.SoundFX.playCapture();
    } else if (m.gameId === 'go' || m.gameId === 'gomoku') {
      BoardArena.SoundFX.playStone();
    } else {
      BoardArena.SoundFX.playWood();
    }

    // Increment clock when turn switches
    if (nextState.currentPlayer !== prevPlayer && move.action !== 'toggle_dead') {
      m.clocksMs[prevPlayer] += m.incrementMs;
    }
    m.lastTickAt = Date.now();

    m.gameState = nextState;
    if (move.action !== 'toggle_dead') {
      m.moveHistory.push({
        seq: m.moveHistory.length + 1,
        player: prevPlayer,
        notation: move.notation || move.id,
        move: move
      });
      m.stateHistory.push(m.rule.cloneState(nextState));
    }

    // If multi-jump continues on Draughts, keep that jumping piece auto-selected!
    if (m.gameId === 'draughts' && nextState.mustContinueFrom && isHumanTurnNow(m)) {
      m.selectedSource = nextState.mustContinueFrom;
      m.legalMovesForSelected = m.rule.getMovesForSource(nextState, nextState.mustContinueFrom);
    } else {
      m.selectedSource = null;
      m.legalMovesForSelected = [];
    }
    m.hints = [];
    m.replayIndex = null;

    if (!fromRemote && m.mode !== 'bot') {
      BoardArena.Client.broadcastMove({ type: 'remote_move', gameId: m.id, move: move });
    }

    updateArenaSidePanels();
    updateTacticalGuideBanner(null);
    redrawBoard();

    if (nextState.status === 'ended') {
      onMatchEnded(nextState.winner, nextState.endReason || 'normal');
    } else {
      scheduleBotIfNeeded();
    }
  }

  function scheduleBotIfNeeded() {
    const m = stateStore.match;
    if (!m || m.mode !== 'bot' || m.gameState.status === 'ended') return;
    if (m.gameState.status === 'scoring') return;
    if (m.gameState.currentPlayer === m.humanSide) return;

    clearTimeout(stateStore.aiTimer);
    stateStore.aiTimer = setTimeout(function () {
      const curMatch = stateStore.match;
      if (!curMatch || curMatch !== m || curMatch.gameState.status !== 'playing') return;
      if (curMatch.gameState.currentPlayer === curMatch.humanSide) return;

      const snapshotSeq = curMatch.moveHistory.length;
      // 提供對局歷史給引擎（長將／千日手判斷用）；fsf-bridge 會先確認歷史與目前局面一致
      BoardArena.AI.matchHistory = {
        states: curMatch.stateHistory,
        moves: curMatch.moveHistory.map(function (h) {
          return h.move;
        })
      };
      if (typeof BoardArena.AI.chooseMoveAsync === 'function') {
        BoardArena.AI.chooseMoveAsync(curMatch.gameId, curMatch.gameState, curMatch.aiLevel, function (aiMove) {
          const liveMatch = stateStore.match;
          if (!liveMatch || liveMatch !== m || liveMatch.gameState.status !== 'playing') return;
          if (liveMatch.moveHistory.length !== snapshotSeq || liveMatch.gameState.currentPlayer === liveMatch.humanSide) return;
          if (aiMove) {
            applyMatchMoveInternal(aiMove, false);
          }
        });
      } else {
        const aiMove = BoardArena.AI.chooseMove(curMatch.gameId, curMatch.gameState, curMatch.aiLevel);
        if (aiMove) {
          applyMatchMoveInternal(aiMove, false);
        }
      }
    }, 120);
  }

  function tickMatchClock() {
    const m = stateStore.match;
    if (!m || m.gameState.status !== 'playing') return;
    const now = Date.now();
    const dt = now - m.lastTickAt;
    m.lastTickAt = now;

    const active = m.gameState.currentPlayer;
    m.clocksMs[active] = Math.max(0, m.clocksMs[active] - dt);
    updateClockDomOnly();

    if (m.clocksMs[active] <= 0) {
      const winner = active === 1 ? 2 : 1;
      m.gameState.status = 'ended';
      m.gameState.winner = winner;
      m.gameState.endReason = 'timeout';
      onMatchEnded(winner, 'timeout');
    }
  }

  function updateClockDomOnly() {
    const m = stateStore.match;
    if (!m) return;
    const c1 = $('clockDigitsP1');
    const c2 = $('clockDigitsP2');
    if (c1) {
      c1.textContent = formatClock(m.clocksMs[1]);
      c1.classList.toggle('low-time', m.clocksMs[1] < 30000);
    }
    if (c2) {
      c2.textContent = formatClock(m.clocksMs[2]);
      c2.classList.toggle('low-time', m.clocksMs[2] < 30000);
    }
  }

  async function onMatchEnded(winner, endReason) {
    clearTimers();
    BoardArena.AdsManager.setMatchLock(false);
    const m = stateStore.match;
    if (!m) return;

    let ratingDeltaInfo = null;
    if (m.rated && BoardArena.Client.isLoggedIn()) {
      try {
        ratingDeltaInfo = await BoardArena.Client.recordPvpMatchResult({
          gameId: m.id,
          serverGameId: m.serverGameId,
          gameType: m.gameId,
          timeControl: m.timeControl,
          plyCount: m.moveHistory.length,
          seq: m.moveHistory.length,
          winner: winner,
          endReason: endReason,
          opponentName: m.players[2].name,
          opponentRating: Number(m.players[2].rating) || 1520,
          moves: m.moveHistory
        });
      } catch (e) {}
    }

    updateArenaSidePanels();
    redrawBoard();
    openMatchResultModal(winner, endReason, ratingDeltaInfo);
  }

  function redrawBoard() {
    const m = stateStore.match;
    if (!m || !renderer) return;

    const displayState =
      m.replayIndex !== null && m.stateHistory[m.replayIndex]
        ? m.stateHistory[m.replayIndex]
        : m.gameState;

    const interactive = m.replayIndex === null && isHumanTurnNow(m);
    const allLegalMoves =
      interactive && displayState.status === 'playing'
        ? m.rule.getLegalMoves(displayState, displayState.currentPlayer)
        : [];

    let activeHints = m.replayIndex === null ? m.hints : [];
    let mentorComparison = null;
    if (m.mentorActive && m.mentorReport && typeof m.mentorStepIndex === 'number') {
      const step = m.mentorReport.steps[m.mentorStepIndex];
      if (step) {
        mentorComparison = {
          actualMove: step.actualMove,
          bestMove: step.bestMove,
          grade: step.grade
        };
        activeHints = step.topCandidates || [];
      }
    }

    renderer.render(m.gameId, displayState, {
      interactive: interactive,
      selectedSource: m.replayIndex === null ? m.selectedSource : null,
      legalMovesForSelected: m.replayIndex === null ? m.legalMovesForSelected : [],
      allLegalMoves: allLegalMoves,
      hoverTarget: m.hoverTarget,
      hints: activeHints,
      mentorComparison: mentorComparison
    });
  }

  function updateTacticalGuideBanner(customMsg) {
    const el = $('tacticalGuideText');
    if (!el || !stateStore.match) return;
    if (customMsg) {
      el.textContent = customMsg;
      return;
    }
    const m = stateStore.match;
    if (m.gameState.status === 'scoring') {
      el.textContent = T('ui.scoringPhaseClickDead');
      return;
    }
    if (m.gameState.inCheck) {
      el.textContent = T('ui.checkSelectPieceDefend');
      return;
    }
    el.textContent =
      m.rule.selectionMode === 'piece'
        ? T('ui.selectHintPiece')
        : T('ui.selectHintDrop');
  }

  /**
   * 將導師評語（訊息陣列）組成目前語言的文字。
   * @param {{comment: Array<Object>}} step 復盤步驟
   * @returns {string} 評語文字
   */
  function renderCoachComment(step) {
    return step.comment.map(BoardArena.I18N.render).join('');
  }

  function updateArenaSidePanels() {
    const m = stateStore.match;
    if (!m) return;
    const cat = getCatalogEntry(m.gameId);
    const gs = m.gameState;
    const side1 = m.rule.sideLabels[1];
    const side2 = m.rule.sideLabels[2];

    setText('arenaGameHeader', BoardArena.I18N.glyphs(cat.icon) + ' ' + gameName(cat.id) + ' · ' + (m.rated ? T('ui.rankedPvp') : T('ui.singlePlayer')));

    // Clock cards
    const p1Card = $('clockCardP1');
    const p2Card = $('clockCardP2');
    if (p1Card) p1Card.classList.toggle('active-turn', gs.status === 'playing' && gs.currentPlayer === 1);
    if (p2Card) p2Card.classList.toggle('active-turn', gs.status === 'playing' && gs.currentPlayer === 2);

    setText('playerNameP1', T(side1) + ' · ' + m.players[1].name);
    setText('playerNameP2', T(side2) + ' · ' + m.players[2].name);
    setText('playerRatingP1', 'Glicko-2: ' + m.players[1].rating);
    setText('playerRatingP2', 'Glicko-2: ' + m.players[2].rating);
    updateClockDomOnly();

    // Special Contextual Action Buttons (Pass for Go, Confirm Score, Gomoku Swap, Backgammon Pass/Double, Rewarded Hint)
    const specialBar = $('specialGameActions');
    if (specialBar) {
      const btns = [];
      if (m.gameId === 'go' && gs.status === 'playing') {
        btns.push(
          '<button type="button" class="cba-btn" onclick="BoardArena.App.triggerSpecialMove(\'pass\')">' +
            T('ui.passTurn') +
            '</button>'
        );
      }
      if (m.gameId === 'go' && gs.status === 'scoring') {
        btns.push(
          '<button type="button" class="cba-btn cba-btn-emerald" onclick="BoardArena.App.triggerSpecialMove(\'confirm_score\')">✅ ' +
            T('ui.confirmDeadStonesScore') +
            '</button>'
        );
      }
      if (m.gameId === 'gomoku' && gs.status === 'playing') {
        const legal = m.rule.getLegalMoves(gs, gs.currentPlayer);
        if (legal.some(function (x) { return x.action === 'swap'; })) {
          btns.push(
            '<button type="button" class="cba-btn cba-btn-gold" onclick="BoardArena.App.triggerSpecialMove(\'swap\')">' +
              T('ui.swapColors') +
              '</button>'
          );
        }
      }
      if (m.gameId === 'backgammon' && gs.status === 'playing') {
        const legal = m.rule.getLegalMoves(gs, gs.currentPlayer);
        if (legal.length === 1 && legal[0].action === 'pass') {
          btns.push(
            '<button type="button" class="cba-btn cba-btn-gold" onclick="BoardArena.App.triggerSpecialMove(\'pass\')">⏭️ ' +
              T('ui.noLegalDiceMove') +
              '</button>'
          );
        }
      }
      if (m.mode === 'bot' && gs.status === 'playing') {
        btns.push(
          '<button type="button" class="cba-btn cba-btn-gold" onclick="BoardArena.App.watchAdForHint()">' +
            T(BoardArena.AdsManager.isAdsEnabled() ? 'ui.rewardedHint' : 'ui.freeHint') +
            '</button>'
        );
      }
      specialBar.innerHTML = btns.join('');
    }

    // Single-Player Undo & AI Mentor Review Buttons
    const undoBtn = $('btnUndoBotMove');
    if (undoBtn) {
      const canUndo =
        m.mode === 'bot' &&
        m.moveHistory.some(function (x) {
          return x.player === m.humanSide;
        });
      undoBtn.disabled = !canUndo;
      undoBtn.textContent =
        T('ui.undoMove') + (m.undoCount > 0 ? ' (' + m.undoCount + ')' : '');
      undoBtn.style.display = m.mode === 'bot' ? 'inline-flex' : 'none';
    }

    const mentorBtn = $('btnMentorReview');
    if (mentorBtn) {
      mentorBtn.disabled = m.moveHistory.length === 0;
      mentorBtn.classList.toggle('active', !!m.mentorActive);
      mentorBtn.textContent = T('ui.mentorReview');
    }

    // Move List (with Mentor Grade badges when Mentor Review is active)
    const gradeIcons = {
      best: '🌟',
      good: '✅',
      inaccuracy: '⚠️',
      mistake: '❌',
      blunder: '💥'
    };
    const logEl = $('moveHistoryList');
    if (logEl) {
      logEl.innerHTML = m.moveHistory
        .map(function (item, idx) {
          const isMentorStep = m.mentorActive && m.mentorStepIndex === idx;
          const cur =
            isMentorStep ||
            (!m.mentorActive &&
              (m.replayIndex === idx + 1 || (m.replayIndex === null && idx === m.moveHistory.length - 1)));
          const stepInfo = m.mentorReport && m.mentorReport.steps && m.mentorReport.steps[idx];
          const badge = stepInfo ? ' <span title="' + stepInfo.grade + '">' + (gradeIcons[stepInfo.grade] || '') + '</span>' : '';
          const clickCall = m.mentorActive
            ? 'BoardArena.App.inspectMentorStep(' + idx + ')'
            : 'BoardArena.App.scrubReplay(' + (idx + 1) + ')';
          return (
            '<div class="move-chip' +
            (cur ? ' current' : '') +
            '" onclick="' +
            clickCall +
            '">' +
            item.seq +
            '. ' +
            escapeHtml(BoardArena.I18N.notation(item.notation)) +
            badge +
            '</div>'
          );
        })
        .join('');
      if (!m.mentorActive) {
        logEl.scrollTop = logEl.scrollHeight;
      }
    }

    // Replay Branch Bar (Resume from selected historical state in Single-Player mode)
    const branchBar = $('replayBranchBar');
    if (branchBar) {
      if (m.mode === 'bot' && m.replayIndex !== null && m.replayIndex < m.stateHistory.length - 1) {
        branchBar.style.display = 'block';
        branchBar.innerHTML =
          '<button type="button" class="cba-btn cba-btn-emerald" style="width:100%;" onclick="BoardArena.App.resumeFromReplayIndex(' +
          m.replayIndex +
          ', true)">' +
          T('ui.resumeVsAiFromMove', { move: m.replayIndex + 1 }) +
          '</button>';
      } else {
        branchBar.style.display = 'none';
        branchBar.innerHTML = '';
      }
    }

    // Canned Phrases
    const phraseGrid = $('cannedPhraseGrid');
    if (phraseGrid && !phraseGrid.dataset.ready) {
      phraseGrid.dataset.ready = '1';
      phraseGrid.innerHTML = BoardArena.I18N.getPhrases()
        .map(function (p) {
          return (
            '<button type="button" class="cba-btn" style="font-size:11.5px;padding:5px 7px;" onclick="BoardArena.App.sendCannedPhrase(\'' +
            p.id +
            '\')">' +
            escapeHtml(p.text) +
            '</button>'
          );
        })
        .join('');
    }
  }

  function triggerSpecialMove(actionName) {
    const m = stateStore.match;
    if (!m || !isHumanTurnNow(m)) return;
    if (actionName === 'confirm_score') {
      applyMatchMoveInternal({ id: 'confirm_score', action: 'confirm_score', notation: 'Score' }, false);
      return;
    }
    const legal = m.rule.getLegalMoves(m.gameState, m.gameState.currentPlayer);
    const found = legal.find(function (x) {
      return x.action === actionName || x.id === actionName;
    });
    if (found) applyMatchMoveInternal(found, false);
  }

  function watchAdForHint() {
    const m = stateStore.match;
    if (!m || m.mode !== 'bot' || m.gameState.status !== 'playing') return;
    // Temporarily release lock for explicit player-initiated Rewarded Hint in Single-Player mode (Spec §10)
    BoardArena.AdsManager.setMatchLock(false);
    BoardArena.AdsManager.requestRewardedHint(function () {
      BoardArena.AdsManager.setMatchLock(true);
      const top = BoardArena.AI.getTopHints(m.gameId, m.gameState, 3);
      m.hints = top;
      if (top.length > 0 && top[0].move.from) {
        selectPieceSource(top[0].move.from);
      } else {
        redrawBoard();
      }
      updateTacticalGuideBanner(
        T('ui.masterHintUnlocked')
      );
    });
  }

  function resignCurrentMatch() {
    const m = stateStore.match;
    if (!m || m.gameState.status === 'ended') return;
    const loser = m.mode === 'bot' ? m.humanSide : m.gameState.currentPlayer;
    const winner = loser === 1 ? 2 : 1;
    m.gameState.status = 'ended';
    m.gameState.winner = winner;
    m.gameState.endReason = 'resign';
    onMatchEnded(winner, 'resign');
  }

  function offerDrawCurrentMatch() {
    const m = stateStore.match;
    if (!m || m.gameState.status !== 'playing') return;
    if (m.mode === 'bot') {
      const evalScore = m.rule.evaluate(m.gameState, m.humanSide);
      if (Math.abs(evalScore) < 180 && m.moveHistory.length >= 10) {
        m.gameState.status = 'ended';
        m.gameState.winner = 0;
        m.gameState.endReason = 'draw_agreed';
        onMatchEnded(0, 'draw_agreed');
      } else {
        addChatMessage(T('ui.chatComputer'), T('ui.computerDeclinesDrawPlays'));
      }
      return;
    }
    m.gameState.status = 'ended';
    m.gameState.winner = 0;
    m.gameState.endReason = 'draw_agreed';
    onMatchEnded(0, 'draw_agreed');
  }

  function requestRematch() {
    const m = stateStore.match;
    if (!m) return;
    closeDynamicModal();
    BoardArena.AdsManager.maybeShowInterstitial(function () {
      if (m.mode === 'bot') {
        startBotMatch(m.gameId, m.aiLevel, m.humanSide === 1 ? 2 : 1);
      } else {
        launchAuthenticatedPvpMatch(m.mode, m.players[2].name, m.players[2].rating, null);
      }
    });
  }

  function scrubReplay(index) {
    const m = stateStore.match;
    if (!m) return;
    if (index === 'prev') {
      const cur = m.replayIndex === null ? m.stateHistory.length - 1 : m.replayIndex;
      m.replayIndex = Math.max(0, cur - 1);
    } else if (index === 'next') {
      if (m.replayIndex === null) return;
      const nxt = m.replayIndex + 1;
      m.replayIndex = nxt >= m.stateHistory.length - 1 ? null : nxt;
    } else if (index === 'live') {
      m.replayIndex = null;
      if (m.mentorActive) closeMentorReview();
    } else {
      m.replayIndex = Math.max(0, Math.min(m.stateHistory.length - 1, Number(index)));
    }
    redrawBoard();
    updateArenaSidePanels();
  }

  /* =========================================================================
   * SINGLE-PLAYER UNDO (TAKEBACK) & BRANCHING FROM ANY MOVE
   * ========================================================================= */
  function undoBotMove() {
    const m = stateStore.match;
    if (!m) return false;
    if (m.mode !== 'bot') {
      BoardArena.SoundFX.playIllegal();
      updateTacticalGuideBanner(
        T('ui.undoOnlyAvailableSingle')
      );
      return false;
    }

    clearTimeout(stateStore.aiTimer);
    stateStore.aiTimer = null;

    // Find the latest move made by the human player in moveHistory
    let targetMoveIdx = -1;
    for (let i = m.moveHistory.length - 1; i >= 0; i--) {
      if (m.moveHistory[i].player === m.humanSide) {
        targetMoveIdx = i;
        break;
      }
    }

    if (targetMoveIdx < 0) {
      BoardArena.SoundFX.playIllegal();
      updateTacticalGuideBanner(
        T('ui.noPlayerMoveUndo')
      );
      return false;
    }

    closeDynamicModal();
    closeMentorReview();

    // stateHistory[targetMoveIdx] is the exact board state right BEFORE the human made move[targetMoveIdx]
    m.gameState = m.rule.cloneState(m.stateHistory[targetMoveIdx]);
    m.stateHistory = m.stateHistory.slice(0, targetMoveIdx + 1);
    m.moveHistory = m.moveHistory.slice(0, targetMoveIdx);
    m.replayIndex = null;
    m.selectedSource = null;
    m.legalMovesForSelected = [];
    m.hints = [];
    m.undoCount = (m.undoCount || 0) + 1;
    m.lastTickAt = Date.now();

    BoardArena.AdsManager.setMatchLock(true);
    BoardArena.SoundFX.playSelect();
    updateArenaSidePanels();
    redrawBoard();
    updateTacticalGuideBanner(
      T('ui.undoDone', { move: targetMoveIdx + 1, count: m.undoCount })
    );

    if (m.gameState.currentPlayer !== m.humanSide) {
      scheduleBotIfNeeded();
    }
    return true;
  }

  function resumeFromReplayIndex(stateIdx, showBestHint) {
    const m = stateStore.match;
    if (!m || m.mode !== 'bot') return false;
    const idx = Math.max(0, Math.min(m.stateHistory.length - 1, Number(stateIdx)));
    clearTimeout(stateStore.aiTimer);
    stateStore.aiTimer = null;

    let savedHints = [];
    if (showBestHint && m.mentorReport && m.mentorReport.steps && m.mentorReport.steps[idx]) {
      savedHints = m.mentorReport.steps[idx].topCandidates || [];
    }

    closeDynamicModal();
    closeMentorReview();

    m.gameState = m.rule.cloneState(m.stateHistory[idx]);
    m.stateHistory = m.stateHistory.slice(0, idx + 1);
    m.moveHistory = m.moveHistory.slice(0, idx);
    m.replayIndex = null;
    m.selectedSource = null;
    m.legalMovesForSelected = [];
    m.hints = savedHints;
    m.undoCount = (m.undoCount || 0) + 1;
    m.lastTickAt = Date.now();

    BoardArena.AdsManager.setMatchLock(true);
    BoardArena.SoundFX.playSelect();
    updateArenaSidePanels();
    redrawBoard();
    updateTacticalGuideBanner(
      T(savedHints.length > 0 ? 'ui.resumedWithHint' : 'ui.resumed', { move: idx + 1 })
    );

    if (m.gameState.currentPlayer !== m.humanSide) {
      scheduleBotIfNeeded();
    }
    return true;
  }

  /* =========================================================================
   * 8-GAME AI MENTOR POST-GAME & LIVE REVIEW ENGINE UI
   * ========================================================================= */
  function openMentorReview(autoSelectSeq) {
    const m = stateStore.match;
    if (!m || m.moveHistory.length === 0) {
      BoardArena.SoundFX.playIllegal();
      updateTacticalGuideBanner(
        T('ui.playLeast1Move')
      );
      return null;
    }

    clearTimeout(stateStore.aiTimer);
    stateStore.aiTimer = null;
    closeDynamicModal();

    const report = BoardArena.AI.analyzeMatchForMentor(
      m.gameId,
      m.stateHistory,
      m.moveHistory,
      m.humanSide || 1
    );
    m.mentorReport = report;
    m.mentorActive = true;

    let defaultStepIdx = report.steps.length - 1;
    if (typeof autoSelectSeq === 'number' && autoSelectSeq >= 1 && autoSelectSeq <= report.steps.length) {
      defaultStepIdx = autoSelectSeq - 1;
    } else if (report.turningPoints && report.turningPoints.length > 0) {
      defaultStepIdx = report.turningPoints[0].seq - 1;
    }

    inspectMentorStep(defaultStepIdx);
    const sec = $('mentorReviewSection');
    if (sec && sec.scrollIntoView) {
      try {
        sec.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      } catch (e) {}
    }
    return report;
  }

  function closeMentorReview() {
    const m = stateStore.match;
    if (m) {
      m.mentorActive = false;
      m.mentorStepIndex = null;
      m.replayIndex = null;
    }
    const sec = $('mentorReviewSection');
    if (sec) {
      sec.style.display = 'none';
      sec.innerHTML = '';
    }
    const quick = $('mentorQuickStepCard');
    if (quick) {
      quick.style.display = 'none';
      quick.innerHTML = '';
    }
    if (m) {
      updateArenaSidePanels();
      redrawBoard();
    }
  }

  function inspectMentorStep(stepIdx) {
    const m = stateStore.match;
    if (!m || !m.mentorReport || !m.mentorReport.steps.length) return;
    const clamped = Math.max(0, Math.min(m.mentorReport.steps.length - 1, Number(stepIdx)));
    const step = m.mentorReport.steps[clamped];
    m.mentorActive = true;
    m.mentorStepIndex = clamped;
    // Set board to state BEFORE the move so user sees both Actual Move (red dashed) & Mentor Best Move (green ★正解)
    m.replayIndex = step.stateIndexBefore;
    m.selectedSource = null;
    m.legalMovesForSelected = [];

    updateArenaSidePanels();
    renderMentorReviewUI();
    redrawBoard();
    updateTacticalGuideBanner(renderCoachComment(step));
  }

  function retryFromMentorStep(stepIdx) {
    const m = stateStore.match;
    if (!m || !m.mentorReport) return false;
    const step = m.mentorReport.steps[stepIdx];
    if (!step) return false;
    return resumeFromReplayIndex(step.stateIndexBefore, true);
  }

  function renderMentorReviewUI() {
    const m = stateStore.match;
    const sec = $('mentorReviewSection');
    const quick = $('mentorQuickStepCard');
    if (!m || !m.mentorActive || !m.mentorReport || !sec) return;

    const rep = m.mentorReport;
    const step = rep.steps[m.mentorStepIndex] || rep.steps[rep.steps.length - 1];
    const side1 = m.rule.sideLabels[1];
    const side2 = m.rule.sideLabels[2];
    const st1 = rep.stats[1];
    const st2 = rep.stats[2];

    const gradeMeta = {
      best: { icon: '🌟', key: 'grade.best' },
      good: { icon: '✅', key: 'grade.good' },
      inaccuracy: { icon: '⚠️', key: 'grade.inaccuracy' },
      mistake: { icon: '❌', key: 'grade.mistake' },
      blunder: { icon: '💥', key: 'grade.blunder' }
    }[step.grade] || { icon: '✅', key: 'grade.good' };

    // 1. Right-Column Quick Step Card
    if (quick) {
      quick.style.display = 'block';
      quick.innerHTML =
        '<div class="mentor-step-card">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;gap:6px;">' +
        '<b>🎓 ' +
        T('ui.coachDiagnosis', { move: step.seq }) +
        '</b>' +
        '<span class="mentor-badge ' +
        step.grade +
        '">' +
        gradeMeta.icon +
        ' ' +
        T(gradeMeta.key) +
        '</span>' +
        '</div>' +
        '<div style="font-size:12px;color:var(--text-secondary);" class="cba-tabular">' +
        T('ui.played') +
        '<b style="color:#fca5a5;">' +
        escapeHtml(BoardArena.I18N.notation(step.notation)) +
        '</b> ｜ ' +
        T('ui.mentor1') +
        '<b style="color:#4ade80;">' +
        escapeHtml(BoardArena.I18N.notation(step.bestNotation)) +
        '</b>' +
        '</div>' +
        '<div style="line-height:1.45;">' +
        escapeHtml(renderCoachComment(step)) +
        '</div>' +
        '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:2px;">' +
        (m.mode === 'bot'
          ? '<button type="button" class="cba-btn cba-btn-emerald" style="padding:4px 9px;font-size:11.5px;flex:1;" onclick="BoardArena.App.retryFromMentorStep(' +
            m.mentorStepIndex +
            ')">🔄 ' +
            T('ui.retryFromMove', { move: step.seq }) +
            '</button>'
          : '') +
        '<button type="button" class="cba-btn cba-btn-ghost" style="padding:4px 9px;font-size:11.5px;" onclick="BoardArena.App.closeMentorReview()">✕ ' +
        T('ui.exitReview') +
        '</button>' +
        '</div>' +
        '</div>';
    }

    // 2. Build Interactive SVG Win-Rate Curve
    const svgW = 540;
    const svgH = 148;
    const padX = 34;
    const padY = 18;
    const plotW = svgW - padX * 2;
    const plotH = svgH - padY * 2;
    const pts = rep.winRateTimeline;
    const maxIdx = Math.max(1, pts.length - 1);

    const polyCoords = pts
      .map(function (v, idx) {
        const x = Math.round((padX + (idx / maxIdx) * plotW) * 10) / 10;
        const y = Math.round((padY + ((100 - v) / 100) * plotH) * 10) / 10;
        return x + ',' + y;
      })
      .join(' ');

    const areaCoords =
      padX +
      ',' +
      (padY + plotH) +
      ' ' +
      polyCoords +
      ' ' +
      Math.round(padX + plotW) +
      ',' +
      (padY + plotH);

    const stepDotsSvg = rep.steps
      .map(function (st, idx) {
        const x = Math.round((padX + ((idx + 1) / maxIdx) * plotW) * 10) / 10;
        const y = Math.round((padY + ((100 - st.winAfterP1) / 100) * plotH) * 10) / 10;
        const isCur = idx === m.mentorStepIndex;
        const dotColor =
          st.grade === 'blunder'
            ? '#ef4444'
            : st.grade === 'mistake'
            ? '#fb923c'
            : st.grade === 'inaccuracy'
            ? '#38bdf8'
            : st.grade === 'best'
            ? '#fde047'
            : '#4ade80';
        return (
          '<circle cx="' +
          x +
          '" cy="' +
          y +
          '" r="' +
          (isCur ? 6.5 : 4.2) +
          '" fill="' +
          dotColor +
          '" stroke="#0f172a" stroke-width="1.5" style="cursor:pointer;" onclick="BoardArena.App.inspectMentorStep(' +
          idx +
          ')">' +
          '<title>#' +
          st.seq +
          ' ' +
          escapeHtml(BoardArena.I18N.notation(st.notation)) +
          ' (' +
          st.winAfterP1 +
          '%)</title></circle>'
        );
      })
      .join('');

    const turningListHtml =
      rep.turningPoints.length === 0
        ? '<div style="font-size:12.5px;color:#86efac;">✨ ' +
          T('ui.zeroMajorMistakesDetected') +
          '</div>'
        : rep.turningPoints
            .map(function (tp) {
              const isAct = tp.seq - 1 === m.mentorStepIndex;
              return (
                '<div class="mentor-turning-item' +
                (isAct ? ' active' : '') +
                '" onclick="BoardArena.App.inspectMentorStep(' +
                (tp.seq - 1) +
                ')">' +
                '<div>' +
                '<span class="mentor-badge ' +
                tp.grade +
                '">#' +
                tp.seq +
                ' ' +
                escapeHtml(BoardArena.I18N.notation(tp.notation)) +
                '</span> ' +
                '<span style="font-size:11.5px;color:var(--text-secondary);">→ ' +
                T('ui.best') +
                '<b style="color:#4ade80;">' +
                escapeHtml(BoardArena.I18N.notation(tp.bestNotation)) +
                '</b></span>' +
                '</div>' +
                '<span class="cba-tabular" style="color:#f87171;font-weight:800;">-' +
                tp.winDrop.toFixed(1) +
                '%</span>' +
                '</div>'
              );
            })
            .join('');

    sec.style.display = 'block';
    sec.innerHTML =
      '<div class="cba-panel-header">' +
      '<div>' +
      '<div class="cba-panel-title">🎓 ' +
      T('ui.aiMentorPostGame') +
      '</div>' +
      '<div style="font-size:12px;color:var(--text-muted);">' +
      T('ui.greenSolidArrowBoard') +
      '</div>' +
      '</div>' +
      '<div style="display:flex;gap:8px;">' +
      '<button type="button" class="cba-btn" onclick="BoardArena.App.inspectMentorStep(' +
      Math.max(0, m.mentorStepIndex - 1) +
      ')">◀ ' +
      T('ui.prevMove') +
      '</button>' +
      '<button type="button" class="cba-btn" onclick="BoardArena.App.inspectMentorStep(' +
      Math.min(rep.steps.length - 1, m.mentorStepIndex + 1) +
      ')">' +
      T('ui.nextMove') +
      ' ▶</button>' +
      (m.mode === 'bot'
        ? '<button type="button" class="cba-btn cba-btn-emerald" id="btnMentorRetryStep" onclick="BoardArena.App.retryFromMentorStep(' +
          m.mentorStepIndex +
          ')">🔄 ' +
          T('ui.retryFromMove', { move: step.seq }) +
          '</button>'
        : '') +
      '<button type="button" class="cba-btn cba-btn-ghost" onclick="BoardArena.App.closeMentorReview()">✕ ' +
      T('ui.close') +
      '</button>' +
      '</div>' +
      '</div>' +
      '<div class="mentor-summary-grid">' +
      // Left: Player 1 & Player 2 Accuracy & Move Grade Breakdown
      '<div class="mentor-stat-card">' +
      '<div style="font-weight:800;font-size:13.5px;color:var(--accent-gold-bright);">📊 ' +
      T('ui.accuracyMoveQuality') +
      '</div>' +
      '<div style="padding:6px 8px;background:var(--bg-surface);border-radius:7px;">' +
      '<div style="display:flex;justify-content:space-between;font-size:12.5px;font-weight:800;">' +
      '<span>' +
      escapeHtml(T(side1) + ' · ' + m.players[1].name) +
      '</span>' +
      '<span class="cba-tabular" style="color:#4ade80;">' +
      T('ui.accuracy') +
      st1.accuracy +
      '%</span>' +
      '</div>' +
      '<div class="mentor-grade-pills cba-tabular" style="margin-top:4px;">' +
      '<span class="mentor-badge best">🌟 ' +
      st1.best +
      '</span>' +
      '<span class="mentor-badge good">✅ ' +
      st1.good +
      '</span>' +
      '<span class="mentor-badge inaccuracy">⚠️ ' +
      st1.inaccuracy +
      '</span>' +
      '<span class="mentor-badge mistake">❌ ' +
      st1.mistake +
      '</span>' +
      '<span class="mentor-badge blunder">💥 ' +
      st1.blunder +
      '</span>' +
      '</div>' +
      '</div>' +
      '<div style="padding:6px 8px;background:var(--bg-surface);border-radius:7px;">' +
      '<div style="display:flex;justify-content:space-between;font-size:12.5px;font-weight:800;">' +
      '<span>' +
      escapeHtml(T(side2) + ' · ' + m.players[2].name) +
      '</span>' +
      '<span class="cba-tabular" style="color:#fbbf24;">' +
      T('ui.accuracy') +
      st2.accuracy +
      '%</span>' +
      '</div>' +
      '<div class="mentor-grade-pills cba-tabular" style="margin-top:4px;">' +
      '<span class="mentor-badge best">🌟 ' +
      st2.best +
      '</span>' +
      '<span class="mentor-badge good">✅ ' +
      st2.good +
      '</span>' +
      '<span class="mentor-badge inaccuracy">⚠️ ' +
      st2.inaccuracy +
      '</span>' +
      '<span class="mentor-badge mistake">❌ ' +
      st2.mistake +
      '</span>' +
      '<span class="mentor-badge blunder">💥 ' +
      st2.blunder +
      '</span>' +
      '</div>' +
      '</div>' +
      '</div>' +
      // Center: Interactive Win-Rate Trend SVG Chart
      '<div class="mentor-stat-card">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;">' +
      '<span style="font-weight:800;font-size:13.5px;color:var(--accent-gold-bright);">📈 ' +
      T('ui.firstPlayerWinProbability') +
      '</span>' +
      '<span class="cba-tabular" style="font-size:12px;color:var(--text-muted);">' +
      T('ui.winRateAtMove', { move: step.seq }) +
      '<b style="color:#fde047;">' +
      step.winAfterP1 +
      '%</b></span>' +
      '</div>' +
      '<svg viewBox="0 0 ' +
      svgW +
      ' ' +
      svgH +
      '" style="width:100%;height:132px;background:#090d16;border-radius:8px;border:1px solid #334155;">' +
      '<line x1="' +
      padX +
      '" y1="' +
      (padY + plotH * 0.5) +
      '" x2="' +
      (padX + plotW) +
      '" y2="' +
      (padY + plotH * 0.5) +
      '" stroke="#475569" stroke-dasharray="4,4" stroke-width="1" />' +
      '<text x="6" y="' +
      (padY + 6) +
      '" fill="#94a3b8" font-size="10">100%</text>' +
      '<text x="10" y="' +
      (padY + plotH * 0.5 + 4) +
      '" fill="#94a3b8" font-size="10">50%</text>' +
      '<text x="14" y="' +
      (padY + plotH) +
      '" fill="#94a3b8" font-size="10">0%</text>' +
      '<polygon points="' +
      areaCoords +
      '" fill="rgba(251, 191, 36, 0.14)" />' +
      '<polyline fill="none" stroke="#fbbf24" stroke-width="2.5" points="' +
      polyCoords +
      '" />' +
      stepDotsSvg +
      '</svg>' +
      '</div>' +
      // Right: Key Turning Points List
      '<div class="mentor-stat-card">' +
      '<div style="font-weight:800;font-size:13.5px;color:var(--accent-gold-bright);">🔑 ' +
      T('ui.keyTurningPointsMistakes') +
      '</div>' +
      '<div style="display:flex;flex-direction:column;gap:6px;overflow-y:auto;max-height:135px;">' +
      turningListHtml +
      '</div>' +
      '</div>' +
      '</div>';
  }

  function runDemoMovesAndOpenMentor() {
    const m = stateStore.match;
    if (!m) return;
    clearTimeout(stateStore.aiTimer);
    stateStore.aiTimer = null;

    // Play 3 rapid moves: Move 1 (Best), Move 2 (AI Best), Move 3 (Suboptimal human move so Mentor highlights both red actual & green best!)
    for (let step = 0; step < 3; step++) {
      if (m.gameState.status !== 'playing') break;
      const legal = m.rule.getLegalMoves(m.gameState, m.gameState.currentPlayer);
      if (!legal || legal.length === 0) break;
      let chosen = legal[0];
      if (step < 2) {
        chosen = BoardArena.AI.chooseMove(m.gameId, m.gameState, 'master') || legal[0];
      } else {
        // Pick a non-capture edge move on step 3 so it contrasts with the Mentor's #1 move
        chosen = legal[legal.length - 1];
      }
      applyMatchMoveInternal(chosen, true);
    }
    clearTimeout(stateStore.aiTimer);
    stateStore.aiTimer = null;
    openMentorReview(3);
  }

  function copyReplayShareLink() {
    const m = stateStore.match;
    if (!m) return;
    const url = global.location.href.split('#')[0] + '#game=' + encodeURIComponent(m.gameId) + '&moves=' + m.moveHistory.length;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).catch(function () {});
    }
    addChatMessage(T('ui.chatSystem'), T('ui.copiedShareLink') + url);
  }

  function sendCannedPhrase(phraseId) {
    const m = stateStore.match;
    if (!m) return;
    const ph = BoardArena.I18N.getPhrases().find(function (x) {
      return x.id === phraseId;
    });
    if (!ph) return;
    const sender = BoardArena.Client.getCurrentUser()
      ? BoardArena.Client.getCurrentUser().displayName
      : T('ui.player');
    addChatMessage(sender, ph.text);
  }

  function addChatMessage(sender, text) {
    const box = $('cannedChatLog');
    if (!box) return;
    const line = document.createElement('div');
    line.style.padding = '3px 0';
    line.innerHTML = '<b>' + escapeHtml(sender) + ':</b> ' + escapeHtml(text);
    box.prepend(line);
  }

  /* =========================================================================
   * LEADERBOARD, ACADEMY & MODALS
   * ========================================================================= */
  async function renderLeaderboardView() {
    const container = $('leaderboardContent');
    if (!container) return;

    const entries = await BoardArena.Client.getLeaderboard(
      stateStore.leaderboardGame,
      stateStore.leaderboardTimeClass,
      stateStore.leaderboardScope
    );

    const gamePills = BoardArena.GAME_CATALOG.map(function (g) {
      const act = g.id === stateStore.leaderboardGame ? ' active' : '';
      return (
        '<button type="button" class="cba-btn' +
        act +
        '" onclick="BoardArena.App.setLeaderboardFilter(\'' +
        g.id +
        '\', null, null)">' +
        BoardArena.I18N.glyphs(g.icon) +
        ' ' +
        (gameName(g.id)) +
        '</button>'
      );
    }).join('');

    const tcPills = BoardArena.TIME_CONTROLS
      .map(function (tc) {
        const act = tc.timeClass === stateStore.leaderboardTimeClass ? ' active' : '';
        return (
          '<button type="button" class="cba-btn' +
          act +
          '" onclick="BoardArena.App.setLeaderboardFilter(null, \'' +
          tc.timeClass +
          '\', null)">' +
          T('tc.' + tc.timeClass) +
          '</button>'
        );
      })
      .join('');

    const rows = entries
      .map(function (e, idx) {
        const medal = idx === 0 ? '🥇 1' : idx === 1 ? '🥈 2' : idx === 2 ? '🥉 3' : String(idx + 1);
        return (
          '<tr>' +
          '<td class="cba-tabular"><b>' +
          medal +
          '</b></td>' +
          '<td><b>' +
          escapeHtml(e.displayName) +
          '</b> <span style="font-size:11px;color:var(--text-muted);">[' +
          escapeHtml(e.country || 'TW') +
          ']</span></td>' +
          '<td class="cba-tabular" style="color:var(--accent-gold);font-weight:900;">' +
          Math.round(e.rating) +
          '</td>' +
          '<td class="cba-tabular">±' +
          Math.round(e.rd) +
          '</td>' +
          '<td class="cba-tabular">' +
          e.gamesPlayed +
          ' (' +
          (e.wins || 0) +
          'W/' +
          (e.losses || 0) +
          'L)</td>' +
          '<td>' +
          (e.qualified
            ? '<span style="color:#4ade80;font-weight:700;">✓ ' + T('ui.lbOfficial') + '</span>'
            : '<span style="color:#fbbf24;">' + T('ui.lbProvisional') + '</span>') +
          '</td>' +
          '</tr>'
        );
      })
      .join('');

    container.innerHTML =
      '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px;">' +
      gamePills +
      '</div>' +
      '<div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;margin-bottom:12px;">' +
      '<div style="display:flex;gap:6px;">' +
      tcPills +
      '</div>' +
      '<div style="display:flex;gap:6px;">' +
      '<button type="button" class="cba-btn' +
      (stateStore.leaderboardScope === 'all' ? ' active' : '') +
      '" onclick="BoardArena.App.setLeaderboardFilter(null, null, \'all\')">' +
      T('ui.allActivePlayers') +
      '</button>' +
      '<button type="button" class="cba-btn' +
      (stateStore.leaderboardScope === 'qualified' ? ' active' : '') +
      '" onclick="BoardArena.App.setLeaderboardFilter(null, null, \'qualified\')">' +
      T('ui.official20GamesRd') +
      '</button>' +
      '</div>' +
      '</div>' +
      '<div style="overflow-x:auto;">' +
      '<table class="cba-table">' +
      '<thead><tr><th>#</th><th>' +
      T('ui.player2') +
      '</th><th>Glicko-2</th><th>RD</th><th>' +
      T('ui.games') +
      '</th><th>' +
      T('ui.status') +
      '</th></tr></thead>' +
      '<tbody>' +
      rows +
      '</tbody></table></div>';
  }

  function renderAcademyView() {
    const container = $('academyContent');
    if (!container) return;
    const g = getCatalogEntry(stateStore.academyGame);
    const doc = BoardArena.I18N.getAcademy(g.id);

    const tabs = BoardArena.GAME_CATALOG.map(function (item) {
      const act = item.id === stateStore.academyGame ? ' active' : '';
      return (
        '<button type="button" class="cba-btn' +
        act +
        '" onclick="BoardArena.App.openRulesFor(\'' +
        item.id +
        '\')">' +
        BoardArena.I18N.glyphs(item.icon) +
        ' ' +
        gameName(item.id) +
        '</button>'
      );
    }).join('');

    container.innerHTML =
      '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:14px;">' +
      tabs +
      '</div>' +
      '<div class="cba-panel" style="background:var(--bg-card);">' +
      '<h3 style="margin-bottom:8px;color:var(--accent-gold-bright);">' +
      BoardArena.I18N.glyphs(g.icon) +
      ' ' +
      (gameName(g.id)) +
      ' — ' +
      T('ui.officialRulesOpeningEndgame') +
      '</h3>' +
      '<p style="margin-bottom:12px;">' +
      escapeHtml(doc.summary) +
      '</p>' +
      '<ul style="padding-left:20px;margin-bottom:12px;display:flex;flex-direction:column;gap:6px;">' +
      doc.rules
        .map(function (r) {
          return '<li>' + escapeHtml(r) + '</li>';
        })
        .join('') +
      '</ul>' +
      '<div style="padding:10px 12px;border-left:4px solid #fbbf24;background:var(--bg-surface);border-radius:6px;margin-bottom:12px;">' +
      '<b>🎯 ' +
      T('ui.masterStrategy') +
      '</b> ' +
      escapeHtml(doc.strategy) +
      '</div>' +
      '<button type="button" class="cba-btn cba-btn-gold" onclick="BoardArena.App.startBotMatch(\'' +
      g.id +
      '\', \'normal\', 1)">▶️ ' +
      T('ui.practiceGame', { game: gameName(g.id) }) +
      '</button>' +
      '</div>';
  }

  /* =========================================================================
   * AUTHENTICATION, PROMOTION CHOICE, QUEUE & RESULT MODALS
   * ========================================================================= */
  function openAuthModal(triggeredByPvpGate) {
    if (!ONLINE_PVP_ENABLED) return;
    closeDynamicModal();
    const wrap = document.createElement('div');
    wrap.className = 'cba-modal-backdrop';
    wrap.id = 'cbaActiveModal';
    wrap.innerHTML =
      '<div class="cba-modal" role="dialog" aria-modal="true">' +
      '<h3 style="color:var(--accent-gold-bright);">🔐 ' +
      T('ui.signRequiredTwoPlayer') +
      '</h3>' +
      (triggeredByPvpGate
        ? '<div class="auth-lock-notice">' +
          T('ui.twoPlayerMatchesRequire') +
          '</div>'
        : '') +
      '<label style="font-size:12.5px;font-weight:700;">' +
      T('ui.displayNickname') +
      '</label>' +
      '<input id="authNicknameInput" class="cba-input" type="text" maxlength="22" value="台灣棋王_Lin" />' +
      '<div style="display:flex;flex-direction:column;gap:8px;margin-top:4px;">' +
      '<button type="button" class="cba-btn cba-btn-gold" id="btnGoogleSignIn" onclick="BoardArena.App.submitLogin(\'google\')">🌐 ' +
      T('ui.continueGoogleOauth2') +
      '</button>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">' +
      '<button type="button" class="cba-btn" onclick="BoardArena.App.submitLogin(\'discord\')">💬 ' + T('ui.loginWithDiscord') + '</button>' +
      '<button type="button" class="cba-btn" onclick="BoardArena.App.submitLogin(\'line\')">💚 ' + T('ui.loginWithLine') + '</button>' +
      '</div>' +
      '</div>' +
      '<div style="display:flex;justify-content:flex-end;margin-top:4px;">' +
      '<button type="button" class="cba-btn cba-btn-ghost" onclick="BoardArena.App.closeDynamicModal()">' +
      T('ui.cancel') +
      '</button>' +
      '</div>' +
      '</div>';
    document.body.appendChild(wrap);
  }

  async function submitLogin(provider) {
    const inp = $('authNicknameInput');
    const name = inp ? inp.value : '台灣棋王';
    await BoardArena.Client.login({ provider: provider, displayName: name, country: 'TW' });
    closeDynamicModal();
    renderHeaderAuth();
    await renderLobbyGameHall();
    if (stateStore.pendingAuthCallback) {
      const cb = stateStore.pendingAuthCallback;
      stateStore.pendingAuthCallback = null;
      cb();
    }
  }

  async function logout() {
    await BoardArena.Client.logout();
    renderHeaderAuth();
    renderLobbyGameHall();
  }

  function openMoveChoiceModal(moves) {
    closeDynamicModal();
    const wrap = document.createElement('div');
    wrap.className = 'cba-modal-backdrop';
    wrap.id = 'cbaActiveModal';
    wrap.innerHTML =
      '<div class="cba-modal">' +
      '<h3>✨ ' +
      T('ui.choosePromotionMoveOption') +
      '</h3>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">' +
      moves
        .map(function (mv, idx) {
          const lbl = mv.choiceLabelKey
            ? T(mv.choiceLabelKey)
            : mv.promote
            ? String(mv.promote)
            : BoardArena.I18N.notation(mv.notation);
          return (
            '<button type="button" class="cba-btn cba-btn-gold" data-choice-idx="' +
            idx +
            '">' +
            escapeHtml(lbl) +
            '</button>'
          );
        })
        .join('') +
      '</div></div>';
    document.body.appendChild(wrap);
    moves.forEach(function (mv, idx) {
      const btn = wrap.querySelector('[data-choice-idx="' + idx + '"]');
      if (btn) {
        btn.onclick = function () {
          closeDynamicModal();
          applyMatchMoveInternal(mv, false);
        };
      }
    });
  }

  function openQuickMatchQueueModal() {
    closeDynamicModal();
    let sec = 0;
    const wrap = document.createElement('div');
    wrap.className = 'cba-modal-backdrop';
    wrap.id = 'cbaActiveModal';
    wrap.innerHTML =
      '<div class="cba-modal">' +
      '<h3>⚡ ' +
      T('ui.quickMatchmakingQueue') +
      '</h3>' +
      '<p id="queueWaitStatus" class="cba-tabular">' +
      T('ui.searchingOpponentWideningGlicko') +
      '</p>' +
      '<div id="queueBotPromptArea" style="display:none;flex-direction:column;gap:8px;">' +
      '<div class="auth-lock-notice">' +
      T('ui.15sElapsedWouldLike') +
      '</div>' +
      '<button type="button" class="cba-btn cba-btn-gold" onclick="BoardArena.App.closeDynamicModal();BoardArena.App.startBotFromLobby()">🤖 ' +
      T('ui.switchComputerOpponent') +
      '</button>' +
      '</div>' +
      '<div style="display:flex;justify-content:space-between;gap:8px;">' +
      '<button type="button" class="cba-btn cba-btn-emerald" onclick="BoardArena.App.closeDynamicModal();BoardArena.App.launchAuthenticatedPvpMatch(\'pvp_online\', \'陳冠宇九段 (TW)\', 1765, null)">⚡ ' +
      T('ui.simulateInstantChallengerMatch') +
      '</button>' +
      '<button type="button" class="cba-btn cba-btn-ghost" onclick="BoardArena.App.closeDynamicModal()">' +
      T('ui.leaveQueue') +
      '</button>' +
      '</div></div>';
    document.body.appendChild(wrap);

    stateStore.queueTimer = setInterval(function () {
      sec++;
      const st = $('queueWaitStatus');
      if (st) {
        st.textContent = T('ui.queueWaiting', { sec: sec });
      }
      if (sec >= 15) {
        const promptEl = $('queueBotPromptArea');
        if (promptEl) promptEl.style.display = 'flex';
      }
    }, 1000);
  }

  function showInviteRoomModal(room) {
    closeDynamicModal();
    const wrap = document.createElement('div');
    wrap.className = 'cba-modal-backdrop';
    wrap.id = 'cbaActiveModal';
    wrap.innerHTML =
      '<div class="cba-modal">' +
      '<h3>🚪 ' +
      T('ui.roomCreated', { id: room.id }) +
      '</h3>' +
      '<p style="font-size:13px;">' +
      T('ui.shareRoomLinkFriend') +
      '</p>' +
      '<input class="cba-input cba-tabular" readonly value="' +
      escapeHtml(room.inviteUrl || global.location.href) +
      '" onclick="this.select()" />' +
      '<div style="display:flex;justify-content:flex-end;gap:8px;">' +
      '<button type="button" class="cba-btn cba-btn-emerald" onclick="BoardArena.App.closeDynamicModal();BoardArena.App.launchAuthenticatedPvpMatch(\'pvp_online\', \'受邀好友棋士\', 1540, null)">▶️ ' +
      T('ui.enterRoomBoard') +
      '</button>' +
      '<button type="button" class="cba-btn cba-btn-ghost" onclick="BoardArena.App.closeDynamicModal()">' + T('ui.close') + '</button>' +
      '</div></div>';
    document.body.appendChild(wrap);
  }

  function openSecondPlayerModal() {
    closeDynamicModal();
    const wrap = document.createElement('div');
    wrap.className = 'cba-modal-backdrop';
    wrap.id = 'cbaActiveModal';
    wrap.innerHTML =
      '<div class="cba-modal">' +
      '<h3>👥 ' +
      T('ui.authenticated2PlayerMatch') +
      '</h3>' +
      '<label style="font-size:12.5px;">' +
      T('ui.player2ChallengerNickname') +
      '</label>' +
      '<input id="p2NameInput" class="cba-input" value="王楚河快刀 (P2)" maxlength="22" />' +
      '<div style="display:flex;justify-content:flex-end;gap:8px;">' +
      '<button type="button" class="cba-btn cba-btn-ghost" onclick="BoardArena.App.closeDynamicModal()">' + T('ui.cancel') + '</button>' +
      '<button type="button" class="cba-btn cba-btn-emerald" id="btnConfirmStartPvp" onclick="BoardArena.App.confirmSecondPlayerStart()">▶️ ' +
      T('ui.startRated2pMatch') +
      '</button>' +
      '</div></div>';
    document.body.appendChild(wrap);
  }

  function confirmSecondPlayerStart() {
    const inp = $('p2NameInput');
    const name = inp ? inp.value : T('ui.player2');
    closeDynamicModal();
    launchAuthenticatedPvpMatch('pvp_local', name, 1560, null);
  }

  /**
   * 將終局原因代碼轉成顯示文字。
   * @param {string} code 終局原因代碼
   * @returns {string} 顯示文字；沒有對應翻譯時回傳代碼本身
   */
  function endReasonLabel(code) {
    const key = 'end.' + code;
    const label = T(key);
    return label === key ? code || '' : label;
  }

  function openMatchResultModal(winner, endReason, ratingDeltaInfo) {
    closeDynamicModal();
    const m = stateStore.match;
    const title =
      winner === 0
        ? T('ui.matchDrawn')
        : T('ui.playerWins', { name: winner === 1 ? m.players[1].name : m.players[2].name });

    let ratingHtml = '';
    if (ratingDeltaInfo && !ratingDeltaInfo.abortedUnrated && typeof ratingDeltaInfo.ratingAfter === 'number') {
      const sign = ratingDeltaInfo.delta >= 0 ? '+' : '';
      ratingHtml =
        '<div class="auth-lock-notice" style="border-color:#22c55e;color:#86efac;">' +
        '<span>🏆 ' + T('ui.ratingUpdate') + '<b>' +
        ratingDeltaInfo.ratingBefore +
        ' → ' +
        ratingDeltaInfo.ratingAfter +
        ' (' +
        sign +
        ratingDeltaInfo.delta +
        ')</b> · RD ±' +
        ratingDeltaInfo.rd +
        '</span></div>';
    } else if (ratingDeltaInfo && ratingDeltaInfo.abortedUnrated) {
      ratingHtml =
        '<div style="font-size:12.5px;color:var(--text-muted);">' + T('ui.matchAborted') + '</div>';
    }

    let goScoreHtml = '';
    if (m.gameId === 'go' && m.gameState.scoreSummary) {
      const sc = m.gameState.scoreSummary;
      goScoreHtml =
        '<div class="cba-tabular" style="font-size:13px;">' +
        T('ui.goScoreLine', { black: sc.blackArea, komi: sc.komi, white: sc.whiteArea }) +
        '</div>';
    }

    const wrap = document.createElement('div');
    wrap.className = 'cba-modal-backdrop';
    wrap.id = 'cbaActiveModal';
    wrap.innerHTML =
      '<div class="cba-modal">' +
      '<h3 style="color:var(--accent-gold-bright);">🎉 ' +
      escapeHtml(title) +
      '</h3>' +
      '<div style="font-size:13px;color:var(--text-secondary);">' +
      T('ui.result') +
      escapeHtml(endReasonLabel(endReason)) +
      '</div>' +
      goScoreHtml +
      ratingHtml +
      '<div id="adSlotResultModal"></div>' +
      '<div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;margin-top:4px;">' +
      '<button type="button" class="cba-btn cba-btn-gold" onclick="BoardArena.App.openMentorReview()">🎓 ' +
      T('ui.aiMentorReview') +
      '</button>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap;">' +
      (m.mode === 'bot'
        ? '<button type="button" class="cba-btn cba-btn-emerald" onclick="BoardArena.App.undoBotMove()">↩️ ' +
          T('ui.undoLastMove') +
          '</button>'
        : '<button type="button" class="cba-btn" onclick="BoardArena.App.closeDynamicModal();BoardArena.App.switchView(\'leaderboard\')">🏆 ' + T('ui.viewLeaderboard') + '</button>') +
      '<button type="button" class="cba-btn cba-btn-ghost" onclick="BoardArena.App.closeDynamicModal()">' + T('ui.viewBoard') + '</button>' +
      '<button type="button" class="cba-btn cba-btn-gold" onclick="BoardArena.App.requestRematch()">' +
      T('ui.rematch') +
      '</button>' +
      '</div></div></div>';
    document.body.appendChild(wrap);
    BoardArena.AdsManager.renderDisplaySlot($('adSlotResultModal'), 'result');
  }

  async function openProfileModal() {
    const user = BoardArena.Client.getCurrentUser();
    if (!user) return openAuthModal(false);
    const games = await BoardArena.Client.getRecentGames();
    closeDynamicModal();
    const wrap = document.createElement('div');
    wrap.className = 'cba-modal-backdrop';
    wrap.id = 'cbaActiveModal';
    wrap.innerHTML =
      '<div class="cba-modal">' +
      '<h3>👤 ' +
      escapeHtml(user.displayName) +
      ' (' +
      escapeHtml(user.provider.toUpperCase()) +
      ')</h3>' +
      '<div style="font-size:13px;color:var(--text-secondary);">' +
      T('ui.recentGames', { count: games.length }) +
      '</div>' +
      '<div style="max-height:160px;overflow-y:auto;font-size:12px;" class="cba-tabular">' +
      (games.length === 0
        ? '<div style="color:var(--text-muted);">' + T('ui.noRatedGames') + '</div>'
        : games
            .slice(0, 6)
            .map(function (g) {
              return (
                '<div style="padding:4px 0;border-bottom:1px solid var(--border-subtle);">' +
                escapeHtml(g.gameType) +
                ' · ' +
                escapeHtml(g.whiteName || '') +
                ' vs ' +
                escapeHtml(g.blackName || '') +
                ' (' +
                escapeHtml(g.endReason || '') +
                ')</div>'
              );
            })
            .join('')) +
      '</div>' +
      '<div style="display:flex;justify-content:space-between;margin-top:8px;">' +
      '<button type="button" class="cba-btn cba-btn-crimson" onclick="BoardArena.App.confirmDeleteAccount()">' +
      T('ui.deleteAccount') +
      '</button>' +
      '<button type="button" class="cba-btn" onclick="BoardArena.App.closeDynamicModal()">' + T('ui.close') + '</button>' +
      '</div></div>';
    document.body.appendChild(wrap);
  }

  async function confirmDeleteAccount() {
    await BoardArena.Client.deleteAccount();
    closeDynamicModal();
    renderHeaderAuth();
    renderLobbyGameHall();
  }

  async function reportCurrentOpponent() {
    const m = stateStore.match;
    if (!m) return;
    await BoardArena.Client.submitReport(m.players[2].name, m.id, 'suspected_engine_or_stall');
    addChatMessage(T('ui.chatSystem'), T('ui.reportSubmittedHumanReview'));
  }

  function initGdprConsentBanner() {
    // 廣告關閉時不需要廣告同意橫幅
    if (!BoardArena.AdsManager.isAdsEnabled()) return;
    const st = BoardArena.AdsManager.getConsentState();
    if (st.decided) return;
    const div = document.createElement('div');
    div.className = 'cmp-banner';
    div.id = 'cbaCmpBanner';
    div.innerHTML =
      '<div style="font-weight:800;margin-bottom:4px;">🍪 ' + T('ui.cmpTitle') + '</div>' +
      '<div style="color:#cbd5e1;margin-bottom:8px;">' + T('ui.cmpBody') + '</div>' +
      '<div style="display:flex;gap:8px;justify-content:flex-end;">' +
      '<button type="button" class="cba-btn" style="padding:4px 10px;font-size:12px;" onclick="BoardArena.App.acceptCmp(false)">' + T('ui.cmpNecessary') + '</button>' +
      '<button type="button" class="cba-btn cba-btn-gold" style="padding:4px 10px;font-size:12px;" onclick="BoardArena.App.acceptCmp(true)">' + T('ui.cmpAccept') + '</button>' +
      '</div>';
    document.body.appendChild(div);
  }

  function acceptCmp(personalized) {
    BoardArena.AdsManager.saveConsentState(personalized);
    const el = $('cbaCmpBanner');
    if (el) el.remove();
  }

  function closeDynamicModal() {
    if (stateStore.queueTimer) {
      clearInterval(stateStore.queueTimer);
      stateStore.queueTimer = null;
    }
    const el = $('cbaActiveModal');
    if (el) el.remove();
  }

  function clearTimers() {
    if (stateStore.aiTimer) {
      clearTimeout(stateStore.aiTimer);
      stateStore.aiTimer = null;
    }
    if (stateStore.queueTimer) {
      clearInterval(stateStore.queueTimer);
      stateStore.queueTimer = null;
    }
  }

  function escapeHtml(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  BoardArena.App = {
    init: initApp,
    switchView: switchView,
    setLanguage: setLanguage,
    toggleTheme: toggleTheme,
    toggleSound: toggleSound,
    selectLobbyGame: selectLobbyGame,
    setAiLevel: function (lv) {
      stateStore.selectedAiLevel = lv;
      renderLobbyGameHall();
    },
    setHumanSide: function (s) {
      stateStore.selectedHumanSide = s;
      renderLobbyGameHall();
    },
    setTimeControl: function (tc) {
      stateStore.selectedTimeControl = tc;
      renderLobbyGameHall();
    },
    setGoSize: function (sz) {
      stateStore.selectedGoSize = sz;
      renderLobbyGameHall();
    },
    toggleGomokuSwap: function (val) {
      stateStore.gomokuSwapEnabled = !!val;
    },
    startBotFromLobby: startBotFromLobby,
    startBotMatch: startBotMatch,
    handleQuickMatch: handleQuickMatch,
    handleCreateRoom: handleCreateRoom,
    handleJoinRoom: handleJoinRoom,
    handleStartLocalPvp: handleStartLocalPvp,
    launchAuthenticatedPvpMatch: launchAuthenticatedPvpMatch,
    confirmSecondPlayerStart: confirmSecondPlayerStart,
    spectateDemoTable: spectateDemoTable,
    selectPieceSource: selectPieceSource,
    triggerSpecialMove: triggerSpecialMove,
    watchAdForHint: watchAdForHint,
    resignCurrentMatch: resignCurrentMatch,
    offerDrawCurrentMatch: offerDrawCurrentMatch,
    requestRematch: requestRematch,
    undoBotMove: undoBotMove,
    resumeFromReplayIndex: resumeFromReplayIndex,
    openMentorReview: openMentorReview,
    closeMentorReview: closeMentorReview,
    inspectMentorStep: inspectMentorStep,
    retryFromMentorStep: retryFromMentorStep,
    scrubReplay: scrubReplay,
    copyReplayShareLink: copyReplayShareLink,
    sendCannedPhrase: sendCannedPhrase,
    reportCurrentOpponent: reportCurrentOpponent,
    setLeaderboardFilter: function (g, tc, sc) {
      if (g) stateStore.leaderboardGame = g;
      if (tc) stateStore.leaderboardTimeClass = tc;
      if (sc) stateStore.leaderboardScope = sc;
      renderLeaderboardView();
    },
    openRulesFor: function (gid) {
      stateStore.academyGame = gid;
      switchView('academy');
    },
    openAuthModal: openAuthModal,
    submitLogin: submitLogin,
    logout: logout,
    openProfileModal: openProfileModal,
    confirmDeleteAccount: confirmDeleteAccount,
    acceptCmp: acceptCmp,
    closeDynamicModal: closeDynamicModal,
    getStateStore: function () {
      return stateStore;
    }
  };

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', initApp);
    } else {
      initApp();
    }
  }
})(typeof window !== 'undefined' ? window : globalThis);
