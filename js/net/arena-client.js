// ============================================
// Date: 2026-11-06
// Version: v1.1.0
// Changes: Auth error text comes from the dictionary
// 修改: 登入錯誤訊息改用字典
// ============================================
// ============================================
// Date: 2026-11-05
// Version: v1.1.0
// Changes: Only probe local 127.0.0.1:8890 server when page itself is opened locally
// 修改: 只有本機開啟網頁時才偵測 127.0.0.1:8890 伺服器，公開網站不再嘗試
// ============================================
/**
 * Classic Board Arena — Network, Auth Gate, Matchmaking & Glicko-2 Leaderboard Client
 * Connects automatically to authoritative BoardArenaServer.exe (http://127.0.0.1:8890) when available,
 * and supports zero-server BroadcastChannel + localStorage fallback when opened directly via file://.
 *
 * STRICT INVARIANT: ALL Two-Player modes require an authenticated user (Guest is blocked).
 */
(function (global) {
  'use strict';

  const BoardArena = (global.BoardArena = global.BoardArena || {});

  const KEY_LOCAL_USER = 'CBA_AUTH_USER_V1';
  const KEY_LOCAL_TOKEN = 'CBA_AUTH_TOKEN_V1';
  const KEY_LOCAL_DB = 'CBA_LOCAL_LEDGER_V1';

  let serverBaseUrl = null;
  let serverOnline = false;
  let currentUser = null; // null or { id, displayName, email, provider, country, isGuest: false }
  let authToken = null;
  let bcChannel = null;
  const eventListeners = [];

  try {
    if (typeof BroadcastChannel !== 'undefined') {
      bcChannel = new BroadcastChannel('CBA_ARENA_SYNC_V1');
      bcChannel.onmessage = function (ev) {
        if (ev && ev.data) emitEvent(ev.data);
      };
    }
  } catch (e) {}

  function onEvent(fn) {
    eventListeners.push(fn);
  }

  function emitEvent(payload) {
    for (let i = 0; i < eventListeners.length; i++) {
      try {
        eventListeners[i](payload);
      } catch (e) {}
    }
  }

  function loadStoredAuth() {
    try {
      const raw = global.sessionStorage && global.sessionStorage.getItem(KEY_LOCAL_USER);
      const tok = global.sessionStorage && global.sessionStorage.getItem(KEY_LOCAL_TOKEN);
      if (raw) {
        currentUser = JSON.parse(raw);
        authToken = tok || null;
        return;
      }
      const rawLocal = global.localStorage && global.localStorage.getItem(KEY_LOCAL_USER);
      const tokLocal = global.localStorage && global.localStorage.getItem(KEY_LOCAL_TOKEN);
      if (rawLocal) {
        currentUser = JSON.parse(rawLocal);
        authToken = tokLocal || null;
      }
    } catch (e) {}
  }

  function persistAuth(user, token) {
    currentUser = user;
    authToken = token || null;
    try {
      if (user) {
        const s = JSON.stringify(user);
        if (global.sessionStorage) {
          global.sessionStorage.setItem(KEY_LOCAL_USER, s);
          if (token) global.sessionStorage.setItem(KEY_LOCAL_TOKEN, token);
        }
        if (global.localStorage) {
          global.localStorage.setItem(KEY_LOCAL_USER, s);
          if (token) global.localStorage.setItem(KEY_LOCAL_TOKEN, token);
        }
      } else {
        if (global.sessionStorage) {
          global.sessionStorage.removeItem(KEY_LOCAL_USER);
          global.sessionStorage.removeItem(KEY_LOCAL_TOKEN);
        }
        if (global.localStorage) {
          global.localStorage.removeItem(KEY_LOCAL_USER);
          global.localStorage.removeItem(KEY_LOCAL_TOKEN);
        }
      }
    } catch (e) {}
  }

  function sanitizeName(str) {
    const cleaned = String(str || '')
      .replace(/[<>&"'`]/g, '')
      .replace(/\b(admin|fuck|shit|scam)\b/gi, '***')
      .trim()
      .slice(0, 22);
    return cleaned || 'Player_' + Math.floor(1000 + Math.random() * 9000);
  }

  function createSeededLedger() {
    const db = {
      users: {},
      ratings: {},
      games: [],
      rooms: [],
      reports: []
    };

    const seedPlayers = [
      { id: 'u_tw_lin', name: '林書豪棋聖 (TW)', country: 'TW', base: 1965, rd: 62, gp: 84 },
      { id: 'u_jp_sato', name: '佐藤名人 (JP)', country: 'JP', base: 1920, rd: 68, gp: 71 },
      { id: 'u_tw_chen', name: '陳冠宇九段 (TW)', country: 'TW', base: 1868, rd: 74, gp: 56 },
      { id: 'u_us_anna', name: 'Anna_Staunton (US)', country: 'US', base: 1835, rd: 79, gp: 49 },
      { id: 'u_nl_jan', name: 'Jan_Draughts100 (NL)', country: 'NL', base: 1795, rd: 82, gp: 42 },
      { id: 'u_kr_park', name: 'Park_BadukPro (KR)', country: 'KR', base: 1760, rd: 85, gp: 38 },
      { id: 'u_tw_wang', name: '王楚河快刀 (TW)', country: 'TW', base: 1712, rd: 89, gp: 33 },
      { id: 'u_uk_oliver', name: 'Oliver_Cube64 (UK)', country: 'GB', base: 1675, rd: 92, gp: 29 },
      { id: 'u_tw_hsu', name: '許哲維七段 (TW)', country: 'TW', base: 1628, rd: 96, gp: 25 },
      { id: 'u_fr_claire', name: 'Claire_Reversi (FR)', country: 'FR', base: 1584, rd: 102, gp: 22 }
    ];

    const games = BoardArena.GAME_CATALOG.map(function (g) {
      return g.id;
    });
    const tcs = ['bullet', 'blitz', 'classical'];
    const rng = BoardArena.createRng(20261104);

    for (let p = 0; p < seedPlayers.length; p++) {
      const sp = seedPlayers[p];
      db.users[sp.id] = {
        id: sp.id,
        displayName: sp.name,
        country: sp.country,
        provider: 'google',
        isGuest: false
      };
      for (let g = 0; g < games.length; g++) {
        for (let t = 0; t < tcs.length; t++) {
          const key = sp.id + ':' + games[g] + ':' + tcs[t];
          const jitter = rng.nextInt(-55, 65);
          db.ratings[key] = {
            userId: sp.id,
            displayName: sp.name,
            country: sp.country,
            gameType: games[g],
            timeClass: tcs[t],
            rating: sp.base + jitter,
            rd: sp.rd + rng.nextInt(-6, 8),
            volatility: 0.06,
            gamesPlayed: sp.gp + rng.nextInt(0, 18),
            wins: Math.floor(sp.gp * 0.62),
            losses: Math.floor(sp.gp * 0.33),
            draws: Math.floor(sp.gp * 0.05),
            lastRatedAt: new Date().toISOString()
          };
        }
      }
    }

    // Seed PlayOK-style live rooms/tables for lobby realism
    for (let g = 0; g < games.length; g++) {
      const gid = games[g];
      db.rooms.push(
        {
          id: gid.toUpperCase().slice(0, 3) + '-101',
          gameType: gid,
          timeControl: '5+3',
          rated: true,
          hostName: seedPlayers[g % seedPlayers.length].name,
          hostRating: 1780 + g * 18,
          guestName: seedPlayers[(g + 3) % seedPlayers.length].name,
          guestRating: 1745 + g * 12,
          status: 'playing',
          spectators: 4 + (g % 7)
        },
        {
          id: gid.toUpperCase().slice(0, 3) + '-102',
          gameType: gid,
          timeControl: '3+2',
          rated: true,
          hostName: seedPlayers[(g + 5) % seedPlayers.length].name,
          hostRating: 1640 + g * 15,
          guestName: null,
          guestRating: null,
          status: 'waiting',
          spectators: 1
        }
      );
    }

    return db;
  }

  function getLocalDb() {
    try {
      const raw = global.localStorage && global.localStorage.getItem(KEY_LOCAL_DB);
      if (raw) return JSON.parse(raw);
    } catch (e) {}
    const fresh = createSeededLedger();
    saveLocalDb(fresh);
    return fresh;
  }

  function saveLocalDb(db) {
    try {
      if (global.localStorage) global.localStorage.setItem(KEY_LOCAL_DB, JSON.stringify(db));
    } catch (e) {}
  }

  async function apiFetch(path, options) {
    if (!serverBaseUrl) throw new Error('Offline mode');
    const headers = Object.assign({ 'Content-Type': 'application/json' }, (options && options.headers) || {});
    if (authToken) headers['X-Arena-Token'] = authToken;
    const resp = await fetch(serverBaseUrl + path, Object.assign({}, options, { headers: headers, credentials: 'include' }));
    const data = await resp.json().catch(function () {
      return {};
    });
    if (!resp.ok) {
      const err = new Error(data.message || data.error || 'HTTP ' + resp.status);
      err.status = resp.status;
      err.code = data.error || 'HTTP_ERROR';
      throw err;
    }
    return data;
  }

  async function init() {
    loadStoredAuth();
    const candidates = [];
    if (global.location && /^https?:/i.test(global.location.protocol)) {
      candidates.push(global.location.origin);
    }
    // 只有在本機開啟（file:// 或 localhost）時才嘗試連本機伺服器，
    // 避免公開網站觸發瀏覽器「存取區域網路裝置」權限提示
    const host = (global.location && global.location.hostname) || '';
    const isLocalPage =
      !global.location || global.location.protocol === 'file:' || host === 'localhost' || host === '127.0.0.1';
    if (isLocalPage) candidates.push('http://127.0.0.1:8890');

    for (let i = 0; i < candidates.length; i++) {
      try {
        const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
        const tid = ctrl ? setTimeout(function () { ctrl.abort(); }, 700) : null;
        const r = await fetch(candidates[i] + '/api/health', {
          method: 'GET',
          signal: ctrl ? ctrl.signal : undefined,
          credentials: 'include'
        });
        if (tid) clearTimeout(tid);
        if (r.ok) {
          const info = await r.json();
          if (info && info.ok) {
            serverBaseUrl = candidates[i];
            serverOnline = true;
            // Sync server session if token exists
            if (authToken) {
              try {
                const me = await apiFetch('/api/me', { method: 'GET' });
                if (me && me.user && !me.user.isGuest) {
                  currentUser = me.user;
                }
              } catch (e) {}
            }
            return { serverOnline: true, serverBaseUrl: serverBaseUrl, health: info };
          }
        }
      } catch (e) {}
    }

    serverOnline = false;
    serverBaseUrl = null;
    getLocalDb();
    return { serverOnline: false, serverBaseUrl: null };
  }

  function isLoggedIn() {
    return !!(currentUser && !currentUser.isGuest && currentUser.id);
  }

  function getCurrentUser() {
    return isLoggedIn() ? Object.assign({}, currentUser) : null;
  }

  async function login(params) {
    const cleanName = sanitizeName(params.displayName || '台灣棋士');
    const payload = {
      provider: params.provider || 'google',
      displayName: cleanName,
      email: params.email || cleanName.toLowerCase().replace(/\s+/g, '') + '@gmail.com',
      country: params.country || 'TW'
    };

    if (serverOnline) {
      const res = await apiFetch('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      persistAuth(res.user, res.token);
      emitEvent({ type: 'auth_changed', user: res.user });
      return res.user;
    }

    // Local fallback auth
    const db = getLocalDb();
    const uid = 'u_' + BoardArena.hashString(payload.provider + ':' + payload.email).toString(16);
    const user = {
      id: uid,
      displayName: cleanName,
      email: payload.email,
      provider: payload.provider,
      country: payload.country,
      isGuest: false,
      createdAt: new Date().toISOString()
    };
    db.users[uid] = user;
    saveLocalDb(db);
    persistAuth(user, 'local_tok_' + uid);
    emitEvent({ type: 'auth_changed', user: user });
    return user;
  }

  async function logout() {
    if (serverOnline) {
      try {
        await apiFetch('/api/auth/logout', { method: 'POST', body: '{}' });
      } catch (e) {}
    }
    persistAuth(null, null);
    emitEvent({ type: 'auth_changed', user: null });
  }

  async function deleteAccount() {
    if (!isLoggedIn()) return false;
    const uid = currentUser.id;
    if (serverOnline) {
      await apiFetch('/api/me', { method: 'DELETE' });
    } else {
      const db = getLocalDb();
      delete db.users[uid];
      Object.keys(db.ratings).forEach(function (k) {
        if (k.indexOf(uid + ':') === 0) delete db.ratings[k];
      });
      db.games.forEach(function (g) {
        if (g.whiteUserId === uid) g.whiteName = '[Anonymous]';
        if (g.blackUserId === uid) g.blackName = '[Anonymous]';
      });
      saveLocalDb(db);
    }
    persistAuth(null, null);
    emitEvent({ type: 'auth_changed', user: null });
    return true;
  }

  /**
   * Guard called before ANY Two-Player action (Quick Match, Room Create/Join, Local Rated 2P)
   */
  function assertPvpAuthenticated() {
    if (!isLoggedIn()) {
      const err = new Error(BoardArena.I18N.t('ui.loginRequiredBanner'));
      err.code = 'AUTH_REQUIRED_FOR_PVP';
      err.status = 401;
      throw err;
    }
  }

  async function getLobbyData(gameType) {
    if (serverOnline) {
      try {
        return await apiFetch('/api/lobby/' + encodeURIComponent(gameType), { method: 'GET' });
      } catch (e) {}
    }
    const db = getLocalDb();
    const rooms = db.rooms.filter(function (r) {
      return r.gameType === gameType;
    });
    const onlinePlayers = Object.keys(db.users)
      .slice(0, 12)
      .map(function (uid) {
        const u = db.users[uid];
        const rKey = uid + ':' + gameType + ':blitz';
        const rObj = db.ratings[rKey];
        return {
          id: u.id,
          displayName: u.displayName,
          country: u.country || 'TW',
          rating: rObj ? Math.round(rObj.rating) : 1500
        };
      });
    return { rooms: rooms, onlinePlayers: onlinePlayers };
  }

  async function createPvpRoom(gameType, timeControl) {
    assertPvpAuthenticated();
    if (serverOnline) {
      return await apiFetch('/api/rooms/create', {
        method: 'POST',
        body: JSON.stringify({ gameType: gameType, timeControl: timeControl, rated: true })
      });
    }
    const db = getLocalDb();
    const room = {
      id: gameType.toUpperCase().slice(0, 3) + '-' + Math.floor(200 + Math.random() * 799),
      gameType: gameType,
      timeControl: timeControl || '5+3',
      rated: true,
      hostId: currentUser.id,
      hostName: currentUser.displayName,
      hostRating: getPlayerRatingLocal(db, currentUser.id, gameType, timeClassOf(timeControl)).rating,
      guestId: null,
      guestName: null,
      status: 'waiting',
      spectators: 0,
      inviteUrl: global.location.href.split('#')[0] + '#room=' + encodeURIComponent(gameType + ':' + Date.now())
    };
    db.rooms.unshift(room);
    saveLocalDb(db);
    if (bcChannel) bcChannel.postMessage({ type: 'room_created', room: room });
    return { room: room };
  }

  async function joinPvpRoom(roomId) {
    assertPvpAuthenticated();
    if (serverOnline) {
      return await apiFetch('/api/rooms/join', {
        method: 'POST',
        body: JSON.stringify({ roomId: roomId })
      });
    }
    const db = getLocalDb();
    const room = db.rooms.find(function (r) {
      return r.id === roomId;
    });
    if (room) {
      room.guestId = currentUser.id;
      room.guestName = currentUser.displayName;
      room.status = 'playing';
      saveLocalDb(db);
    }
    return { room: room };
  }

  async function startLocalAuthenticatedPvp(gameType, timeControl, secondPlayerName) {
    assertPvpAuthenticated();
    const oppName = sanitizeName(secondPlayerName || '二號棋士 (P2)');
    if (serverOnline) {
      try {
        return await apiFetch('/api/games/local-pvp', {
          method: 'POST',
          body: JSON.stringify({
            gameType: gameType,
            timeControl: timeControl,
            secondPlayerName: oppName
          })
        });
      } catch (e) {}
    }
    return {
      gameId: 'pvp_' + Date.now(),
      rated: true,
      whiteName: currentUser.displayName,
      blackName: oppName
    };
  }

  function timeClassOf(tcId) {
    if (tcId === '3+2') return 'bullet';
    if (tcId === '10+5') return 'classical';
    return 'blitz';
  }

  function getPlayerRatingLocal(db, userId, gameType, timeClass) {
    const key = userId + ':' + gameType + ':' + timeClass;
    if (!db.ratings[key]) {
      const u = db.users[userId] || { displayName: 'Player', country: 'TW' };
      db.ratings[key] = {
        userId: userId,
        displayName: u.displayName,
        country: u.country || 'TW',
        gameType: gameType,
        timeClass: timeClass,
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
    return db.ratings[key];
  }

  /**
   * Record finished 2P match and update Glicko-2 leaderboard (Spec §3 & §6: Early <2 ply aborts do NOT rate)
   */
  async function recordPvpMatchResult(matchInfo) {
    assertPvpAuthenticated();
    if (matchInfo.plyCount < 2) {
      return { abortedUnrated: true };
    }

    if (serverOnline && matchInfo.serverGameId) {
      try {
        return await apiFetch('/api/games/' + encodeURIComponent(matchInfo.serverGameId) + '/move', {
          method: 'POST',
          body: JSON.stringify({
            seq: matchInfo.seq || matchInfo.plyCount,
            player: matchInfo.lastPlayer || 1,
            move: matchInfo.lastMove || { id: 'end' },
            gameEnded: true,
            winner: matchInfo.winner,
            endReason: matchInfo.endReason || 'normal'
          })
        });
      } catch (e) {}
    }

    const db = getLocalDb();
    const tc = timeClassOf(matchInfo.timeControl || '5+3');
    const p1 = getPlayerRatingLocal(db, currentUser.id, matchInfo.gameType, tc);
    const oppRating = matchInfo.opponentRating || 1520;
    const oppRd = matchInfo.opponentRd || 140;
    const score = matchInfo.winner === 1 ? 1.0 : matchInfo.winner === 0 ? 0.5 : 0.0;

    const before = p1.rating;
    const updated = BoardArena.Glicko2.rate(p1, [
      { opponentRating: oppRating, opponentRd: oppRd, score: score }
    ]);

    p1.rating = updated.rating;
    p1.rd = updated.rd;
    p1.volatility = updated.volatility;
    p1.gamesPlayed += 1;
    if (score === 1) p1.wins += 1;
    else if (score === 0) p1.losses += 1;
    else p1.draws += 1;
    p1.lastRatedAt = new Date().toISOString();

    const record = {
      id: matchInfo.gameId || 'g_' + Date.now(),
      gameType: matchInfo.gameType,
      timeControl: matchInfo.timeControl || '5+3',
      timeClass: tc,
      whiteUserId: currentUser.id,
      whiteName: currentUser.displayName,
      blackName: matchInfo.opponentName || 'P2 Challenger',
      winner: matchInfo.winner,
      endReason: matchInfo.endReason,
      ratingBefore: Math.round(before),
      ratingAfter: Math.round(updated.rating),
      moves: matchInfo.moves || [],
      endedAt: new Date().toISOString()
    };
    db.games.unshift(record);
    saveLocalDb(db);
    return {
      ratingBefore: Math.round(before),
      ratingAfter: Math.round(updated.rating),
      delta: Math.round(updated.rating - before),
      rd: Math.round(updated.rd)
    };
  }

  async function getLeaderboard(gameType, timeClass, scope) {
    const tc = timeClass || 'blitz';
    if (serverOnline) {
      try {
        const res = await apiFetch(
          '/api/leaderboards/' + encodeURIComponent(gameType) + '/' + encodeURIComponent(tc) + '?scope=' + (scope || 'all'),
          { method: 'GET' }
        );
        if (res && Array.isArray(res.entries)) return res.entries;
      } catch (e) {}
    }

    const db = getLocalDb();
    const list = [];
    Object.keys(db.ratings).forEach(function (k) {
      const r = db.ratings[k];
      if (r.gameType === gameType && r.timeClass === tc && r.gamesPlayed > 0) {
        if (scope === 'qualified' && !(r.gamesPlayed >= 20 && r.rd < 110)) return;
        list.push(Object.assign({}, r, { qualified: r.gamesPlayed >= 20 && r.rd < 110 }));
      }
    });
    list.sort(function (a, b) {
      return b.rating - a.rating;
    });
    return list;
  }

  async function getRecentGames() {
    if (serverOnline && isLoggedIn()) {
      try {
        const r = await apiFetch('/api/users/' + encodeURIComponent(currentUser.id) + '/games', { method: 'GET' });
        if (r && Array.isArray(r.games)) return r.games;
      } catch (e) {}
    }
    const db = getLocalDb();
    return (db.games || []).slice(0, 20);
  }

  async function submitReport(targetName, gameId, reason) {
    if (serverOnline && isLoggedIn()) {
      try {
        return await apiFetch('/api/reports', {
          method: 'POST',
          body: JSON.stringify({ targetUserId: targetName, gameId: gameId, reason: reason })
        });
      } catch (e) {}
    }
    const db = getLocalDb();
    db.reports.push({
      id: 'rep_' + Date.now(),
      reporter: isLoggedIn() ? currentUser.displayName : 'Guest',
      target: targetName,
      gameId: gameId,
      reason: reason,
      status: 'pending_review',
      createdAt: new Date().toISOString()
    });
    saveLocalDb(db);
    return { ok: true, status: 'pending_review' };
  }

  BoardArena.Client = {
    init: init,
    onEvent: onEvent,
    isServerOnline: function () {
      return serverOnline;
    },
    getServerUrl: function () {
      return serverBaseUrl;
    },
    isLoggedIn: isLoggedIn,
    getCurrentUser: getCurrentUser,
    login: login,
    logout: logout,
    deleteAccount: deleteAccount,
    assertPvpAuthenticated: assertPvpAuthenticated,
    getLobbyData: getLobbyData,
    createPvpRoom: createPvpRoom,
    joinPvpRoom: joinPvpRoom,
    startLocalAuthenticatedPvp: startLocalAuthenticatedPvp,
    recordPvpMatchResult: recordPvpMatchResult,
    getLeaderboard: getLeaderboard,
    getRecentGames: getRecentGames,
    submitReport: submitReport,
    broadcastMove: function (msg) {
      if (bcChannel) bcChannel.postMessage(msg);
    }
  };
})(typeof window !== 'undefined' ? window : globalThis);
