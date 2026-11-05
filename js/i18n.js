// ============================================
// Date: 2026-11-05
// Version: v1.1.0
// Changes: Add freeHint label used when ads are disabled; remove third-party brand names from copy
// 修改: 新增 freeHint 文字（廣告關閉時的提示按鈕）；文案移除第三方品牌名稱
// ============================================
/**
 * Classic Board Arena — Bilingual Dictionary (zh-TW / en), Canned Phrases & 8-Game Academy
 */
(function (global) {
  'use strict';

  const BoardArena = (global.BoardArena = global.BoardArena || {});
  const STORAGE_KEY_LANG = 'CBA_LANG_V1';

  const CANNED_PHRASES = [
    { id: 'P01', zh: '您好，請多指教！', en: 'Hello, have a great game!' },
    { id: 'P02', zh: '好棋！真是精彩的一手！', en: 'Nice move! Well played!' },
    { id: 'P03', zh: '容我長考一下…', en: 'Let me think for a moment...' },
    { id: 'P04', zh: '時間緊迫，刺激了！', en: 'Time is getting tight!' },
    { id: 'P05', zh: '承讓了，謝謝對局！', en: 'Good game, thank you!' },
    { id: 'P06', zh: '要再來一盤嗎？', en: 'Would you like a rematch?' },
    { id: 'P07', zh: '糟了，剛才手滑失誤！', en: 'Oops, that was a slip!' },
    { id: 'P08', zh: '祝您旗開得勝！', en: 'Best of luck!' }
  ];

  const GAME_ACADEMY = {
    othello: {
      zh: {
        summary: '8×8 錦標賽綠絨棋盤，雙方輪流落子夾吃對手棋子並翻面，終局以盤面棋子數多者獲勝。',
        rules: [
          '開局中央 4 格斜向交錯放置 2 黑 2 白，黑方先行。',
          '每手必須落在能於橫、直、斜八方向「夾住」至少一顆敵子之空位，被夾住的敵子全部翻轉為己方顏色。',
          '若輪到某方時全盤無合法夾吃點，必須自動跳過（Pass）由對手繼續；雙方皆無合法步或 64 格滿盤時終局點子。'
        ],
        strategy: '搶佔四個角落（A1, A8, H1, H8）永不被翻，避免過早踏入角落旁的 X 位（B2, G2, B7, G7），中盤優先維持對手無處可下的「行動力優勢」。'
      },
      en: {
        summary: 'Played on an 8×8 green baize board. Outflank opponent discs horizontally, vertically, or diagonally to flip them.',
        rules: [
          'Starts with 2 black and 2 white discs in the center; Black moves first.',
          'Every move must outflank at least one opponent disc, flipping all bracketed discs.',
          'If a player has no legal move, their turn automatically passes. Game ends when neither side can move.'
        ],
        strategy: 'Corners (A1, A8, H1, H8) can never be flipped. Avoid X-squares adjacent to empty corners and maximize mobility.'
      }
    },
    xiangqi: {
      zh: {
        summary: '9×10 花梨木楚河漢界棋盤。點擊任一己方棋子，盤面即時以綠點顯示合法走位、紅準星標示可吃敵子。',
        rules: [
          '紅方先行。帥（將）與仕（士）限於九宮內活動，且雙方帥將不可在同一直線無遮擋直接照面（飛將／王不見王）。',
          '相（象）走田字不過河，田心有子則「塞象眼」；傌（馬）走日字，鄰格有子則「蹩馬腿」；炮（砲）平走同車、吃子須「隔山打牛」。',
          '被將軍時必須立即應將；輪到己方卻無任何合法棋步可走時稱為「困斃」，依象棋規則直接判負（非和棋）。'
        ],
        strategy: '開局講究「中炮對屏風馬」快速出動大子（車馬炮），中盤爭奪肋道與河口要津，殘局善用「馬後炮」、「雙車錯」與「海底撈月」。'
      },
      en: {
        summary: '9×10 Rosewood river board. Clicking any friendly piece highlights all legal empty intersections (green) and capturable targets (red).',
        rules: [
          'Red moves first. Generals stay inside the 3×3 palace and may never face each other directly on an open file (Flying General).',
          'Elephants move 2 points diagonally without crossing the river (blocked at the eye); Horses jump L-shapes (blocked at the orthogonal leg); Cannons jump exactly one screen piece to capture.',
          'Stalemate (having zero legal moves) is a loss in Xiangqi.'
        ],
        strategy: 'Develop Chariots early along open files, coordinate Horse-Cannon batteries, and guard the central palace file.'
      }
    },
    go: {
      zh: {
        summary: '日本本榧木紋與那智黑／日向蛤碁石，支援 9×9 快棋、13×13 中盤與 19×19 標準大盤切換。',
        rules: [
          '黑先白後落於交叉點。相連同色棋子共用「氣」（相鄰空點），氣數歸零時立即被對手從盤上提走（提子）。',
          '禁止下入氣數為零且無法提掉敵子的「禁入自殺點」；禁止立即回提造成全局同形重複的「打劫（Ko）」。',
          '雙方連續選擇「虛手（Pass）」後進入終局點目，可點選確認盤上死子，採用中國數子法（黑貼 7.5 目／9路貼 5.5 目）判定勝負。'
        ],
        strategy: '遵循「金角銀邊草肚皮」，確保孤棋做出「兩隻真眼」活棋，善用徵子、枷吃、撲與棄子爭先。'
      },
      en: {
        summary: 'Authentic Kaya wood Goban with slate & clamshell stones. Supports 9×9, 13×13, and 19×19 boards.',
        rules: [
          'Connected stones share liberties. Groups reduced to zero liberties are captured.',
          'Suicide is forbidden unless capturing enemy stones; Positional Ko forbids repeating the previous board state.',
          'Two consecutive Passes enter Dead-Stone Confirmation & Chinese Area Scoring (Komi 7.5 on 19×19, 5.5 on 9×9).'
        ],
        strategy: 'Secure corners first,then sides, then center. Form two independent eyes to make groups unconditionally alive.'
      }
    },
    gomoku: {
      zh: {
        summary: '15×15 現代溫潤淺榧木棋盤，支援標準規則與平衡先手優勢的「三手交換（Swap）」選項。',
        rules: [
          '黑方先行，雙方輪流於 15×15 交叉點落子，率先於橫、直、斜任一方向連成連續 5 子（或以上）者獲勝。',
          '開啟「交換規則（Swap）」時，假先方下完前 3 手（2 黑 1 白）後，對手可選擇執黑續弈或交換執白，徹底消除必勝開局。'
        ],
        strategy: '善用「活三」、「衝四活三（四三雙殺）」與「雙活三」連續製造對手無法同時防守的雙重威脅。'
      },
      en: {
        summary: '15×15 modern Kaya board featuring optional Swap opening balance.',
        rules: [
          'Black plays first on a 15×15 grid. First player to form 5 contiguous stones horizontally, vertically, or diagonally wins.',
          'With Swap enabled, after the opening 3 stones, Player 2 may choose whether to keep White or swap to Black.'
        ],
        strategy: 'Build intersecting Open Threes and Four-Three forks rather than isolated single threats.'
      }
    },
    draughts: {
      zh: {
        summary: 'FMJD 國際標準 10×10 百格跳棋（雙邊各 20 枚棋子），具備「強制吃子」與遠距「飛行王棋」高張力戰術。',
        rules: [
          '棋子置於深色格，白方先行。普通兵每次向前斜走 1 格，但「跳吃」時可向前或向後四個斜角跳過敵子落入後方空格。',
          '【有吃必吃】場上有跳吃機會時強制必須吃子；跳吃後若同一枚棋子仍可繼續跳吃，必須連續完成多連跳！',
          '普通兵停留在敵方底線時加冕升變為「飛行王棋（Flying King）」，可沿對角線任意遠距滑行與遠距跳吃。'
        ],
        strategy: '控制棋盤中央第 27、28、32、33 樞紐格，利用棄一換三的「組合連跳（Shot）」一舉突破防線升王。'
      },
      en: {
        summary: 'FMJD 10×10 International Draughts (20 pieces per side) with mandatory multi-jumps and Flying Kings.',
        rules: [
          'White moves first on dark squares. Men move 1 square diagonally forward, but capture both forward and backward.',
          'Captures are mandatory! Multi-jump sequences must be continued as long as the jumping piece has further captures.',
          'Reaching the far rank crowns a Flying King capable of sliding and capturing at any distance along clear diagonals.'
        ],
        strategy: 'Control central squares and set tactical sacrifice combinations to force devastating 3-for-1 multi-jumps.'
      }
    },
    chess: {
      zh: {
        summary: '8×8 史湯頓（Staunton）錦標賽鑲嵌木盤，完整實作 FIDE 國際棋聯特殊規則與三次重複／50 步和棋。',
        rules: [
          '白方先行。支援短易位（O-O）與長易位（O-O-O）：王與車均未移動、中間無阻擋，且王未受將軍亦不穿越受攻擊格。',
          '支援「吃過路兵（En Passant）」：敵兵首步前進兩格擦過己方第五橫排兵旁時，下一手可立即斜吃之。',
          '兵抵達底線可選擇升變為后（Q）、車（R）、象（B）或馬（N）；包含將死、無子可動逼和（Stalemate）、50 步規則與三次重複局面。'
        ],
        strategy: '開局爭奪中心（d4, e4, d5, e5）、儘早完成王車易位保護國王，殘局活化國王護送通路兵升變。'
      },
      en: {
        summary: '8×8 Staunton inlaid walnut board with complete FIDE rules: Castling, En Passant, Promotion, 50-Move & Threefold Repetition.',
        rules: [
          'White moves first. Supports Kingside (O-O) and Queenside (O-O-O) castling when unmoved, clear, and not in/through check.',
          'Supports En Passant pawn captures immediately following an enemy two-square pawn advance.',
          'Pawns reaching the 8th/1st rank promote to Queen, Rook, Bishop, or Knight.'
        ],
        strategy: 'Control the center, castle early, connect your Rooks, and create passed pawns in the endgame.'
      }
    },
    shogi: {
      zh: {
        summary: '9×9 日本榧木將棋盤搭配雙側「駒台（持駒架）」，吃掉的敵棋可化為己方援軍隨時「打入」空位！',
        rules: [
          '先手（☗ 下方）先行。吃掉敵方棋子後（若已升變則還原正面）收入己方右側「駒台」，輪到自己時可選取駒台棋子「打入」盤面空格。',
          '棋子進入、移出或在敵陣三段（最上方／最下方 3 排）內移動時，可選擇翻面升變（成り，朱紅字：飛→龍王、角→龍馬、銀/桂/香/步→金將走法）；走到無路可退之底線時強制升變。',
          '【二步禁手】同一縱筋已有己方未升變之「步兵」時，禁止於該筋再打入步兵；亦禁止將步、香、桂打在無法再移動的死格。'
        ],
        strategy: '開局先築「美濃圍」或「矢倉圍」保護玉將，交換大駒後看準對手陣型破綻，直接將飛車或金銀打入敵玉腹地詰殺。'
      },
      en: {
        summary: '9×9 Japanese Kaya Shogiban with Wedge Koma and dual Komadai stands — captured pieces can be dropped back onto the board!',
        rules: [
          'Sente (☗) moves first. Captured pieces demote and join your Komadai hand; on any turn you may drop a captured piece onto an empty square.',
          'Moving into, within, or out of the farthest 3 ranks allows Promotion (Rook→Dragon, Bishop→Horse, Silver/Knight/Lance/Pawn→Gold movement).',
          'Nifu Rule: You may never drop an unpromoted Pawn onto a file that already contains your unpromoted Pawn.'
        ],
        strategy: 'Build a castle (Mino or Yagura) around your King before trading pieces, as traded pieces fuel dangerous drops.'
      }
    },
    backgammon: {
      zh: {
        summary: '24 三角點精裝皮革鑲木摺疊盒，結合雙骰機率、單子擊回中欄（Bar）、連牆封鎖與加倍骰策略。',
        rules: [
          '雙方各 15 枚棋子依國際標準開局配置（白子由 24 點往 1 點推進，黑子由 1 點往 24 點推進）。每回合擲 2 顆骰子；若擲出「對子（如 6-6）」可走 4 步該點數！',
          '敵方佔有 2 子（含）以上的三角點為「封鎖點」不可落入；若敵方某點僅有 1 枚孤子（Blot），落入該點即可將其擊回中央「中欄（Bar）」。',
          '中欄有子時必須優先依骰點由敵方本陣重新入場，未全數入場前不可移動盤上其他棋子；當己方 15 子全數進入本陣（1–6 點）即可開始「收子離盤（Bear Off）」，率先收完 15 子者獲勝（對手未收任何子為雙倍勝 Gammon！）。'
        ],
        strategy: '善用 2 顆棋子佔據關鍵「安全錨點（如第 5 點黃金點）」，建立連續 5–6 點的「封鎖牆（Prime）」困住敵軍，並減少暴露孤子。'
      },
      en: {
        summary: '24-point luxury leather & wood attaché board with 3D dice, central Bar, Blot hitting, Bearing Off, and Doubling Cube.',
        rules: [
          '15 checkers per side move in opposite directions. Roll 2 dice per turn; doubles grant 4 moves of that value!',
          'Points with 2+ enemy checkers are blocked. Landing on a single enemy checker (Blot) hits it onto the central Bar.',
          'Checkers on the Bar must re-enter before any other move. Once all 15 checkers reach your home board, bear them off to win.'
        ],
        strategy: 'Secure the Golden 5-Point, build consecutive primes to trap opponent runners, and minimize exposed blots.'
      }
    }
  };

  const UI_STRINGS = {
    'zh-TW': {
      brandTitle: '世界八大經典棋藝對戰館',
      brandSubtitle: '擬真材質棋盤 · 單人四階電腦對手 · 免登入直接玩',
      backToStudio: '← 返回 Game Studios 總部',
      navLobby: '🏛️ 八大棋種大廳',
      navArena: '♟️ 對局舞台',
      navLeaderboard: '🏆 Glicko-2 排行榜',
      navAcademy: '📖 規則與每日殘局',
      navLegal: '⚖️ 分級與條款',
      soundOn: '🔊 擬真音效',
      soundOff: '🔇 靜音',
      themeDark: '🌙 深色競技場',
      themeLight: '☀️ 經典淺色',
      loginBtn: '🔐 登入 / 註冊',
      logoutBtn: '登出',
      profileBtn: '個人戰績',
      guestBadge: '訪客（單人免登入／雙人需登入）',
      onlineUnit: '人在線',
      playVsBot: '🤖 單人對戰電腦',
      playPvpQuick: '⚡ 雙人快速配對',
      playPvpRoom: '🚪 開桌 / 好友邀請房',
      playPvpLocal: '👥 同機雙人計分對戰',
      loginRequiredBanner: '🔒 雙人模式需要登入帳號才能遊玩並計算 Glicko-2 排行榜積分！',
      selectHintPiece: '💡 點擊任一己方棋子，棋盤將即時標示【翠綠圓點＝可走空位】與【鮮紅準星＝可吃敵子】',
      selectHintDrop: '💡 直接點擊棋盤合法位置落子（支援懸停預覽與戰術提示）',
      resign: '🏳️ 認輸',
      offerDraw: '🤝 提和',
      rematch: '🔄 再來一盤',
      undoMove: '↩️ 單人悔棋',
      mentorReview: '🎓 導師復盤分析',
      resumeFromHere: '🔀 從此手繼續下',
      passTurn: '⏭️ 虛手 Pass',
      rollDice: '🎲 擲雙骰',
      doubleCube: '✖2 提出加倍',
      swapColors: '⇄ 執行三手交換',
      rewardedHint: '🎬 看廣告獲大師提示',
      freeHint: '🎯 大師提示',
      replayTitle: '📜 即時棋譜與回放分享',
      copyShareLink: '🔗 複製棋譜分享連結',
      reportPlayer: '🚩 檢舉對手',
      deleteAccount: '🗑️ 刪除帳號（對局匿名化）',
      twRatingTitle: '普遍級 (0+) · 遊戲軟體分級管理辦法標示',
      twRatingWarning: '注意使用時間，避免沉迷於遊戲。本平台僅計競技等級分（Glicko-2），不提供任何真錢、虛擬遊戲幣或賭博行為。'
    },
    en: {
      brandTitle: 'World Classic 8-Board Arena',
      brandSubtitle: 'Tactile Realistic Boards · 4-Tier Computer Opponents · No Sign-In Needed',
      backToStudio: '← Studio Hub',
      navLobby: '🏛️ 8-Game Lobby',
      navArena: '♟️ Board Stage',
      navLeaderboard: '🏆 Glicko-2 Rankings',
      navAcademy: '📖 Rules & Daily Puzzle',
      navLegal: '⚖️ Rating & Legal',
      soundOn: '🔊 Realistic SFX',
      soundOff: '🔇 Muted',
      themeDark: '🌙 Dark Arena',
      themeLight: '☀️ Classic Light',
      loginBtn: '🔐 Sign In',
      logoutBtn: 'Sign Out',
      profileBtn: 'Profile',
      guestBadge: 'Guest (Bot Free / Login for 2P)',
      onlineUnit: 'online',
      playVsBot: '🤖 Single Player vs AI',
      playPvpQuick: '⚡ 2P Quick Match',
      playPvpRoom: '🚪 Create / Invite Room',
      playPvpLocal: '👥 2P Pass & Play (Auth)',
      loginRequiredBanner: '🔒 Sign-in is required to play Two-Player modes and record Glicko-2 leaderboard ratings!',
      selectHintPiece: '💡 Click any friendly piece to highlight Legal Moves (emerald dots) & Captures (crimson reticles)',
      selectHintDrop: '💡 Click any legal board coordinate to place your stone/disc',
      resign: '🏳️ Resign',
      offerDraw: '🤝 Offer Draw',
      rematch: '🔄 Rematch',
      undoMove: '↩️ Undo Move',
      mentorReview: '🎓 AI Mentor Review',
      resumeFromHere: '🔀 Resume From Here',
      passTurn: '⏭️ Pass Turn',
      rollDice: '🎲 Roll Dice',
      doubleCube: '✖2 Offer Double',
      swapColors: '⇄ Invoke Swap Rule',
      rewardedHint: '🎬 Watch Ad: Master Hint',
      freeHint: '🎯 Master Hint',
      replayTitle: '📜 Move List & Replay',
      copyShareLink: '🔗 Share Replay Link',
      reportPlayer: '🚩 Report Player',
      deleteAccount: '🗑️ Delete Account (Anonymize)',
      twRatingTitle: 'General Audience (0+) · Taiwan Game Rating',
      twRatingWarning: 'Please be mindful of play time and avoid addiction. Ratings only (Glicko-2); strictly no real-money or virtual currency wagering.'
    }
  };

  let currentLang = 'zh-TW';
  try {
    const saved = global.localStorage && global.localStorage.getItem(STORAGE_KEY_LANG);
    if (saved === 'en' || saved === 'zh-TW') currentLang = saved;
  } catch (e) {}

  BoardArena.I18N = {
    getLang() {
      return currentLang;
    },
    setLang(lang) {
      currentLang = lang === 'en' ? 'en' : 'zh-TW';
      try {
        if (global.localStorage) global.localStorage.setItem(STORAGE_KEY_LANG, currentLang);
      } catch (e) {}
      return currentLang;
    },
    t(key) {
      const dict = UI_STRINGS[currentLang] || UI_STRINGS['zh-TW'];
      return dict[key] || UI_STRINGS['zh-TW'][key] || key;
    },
    getPhrases() {
      return CANNED_PHRASES.slice();
    },
    getAcademy(gameId) {
      const g = GAME_ACADEMY[gameId] || GAME_ACADEMY.gomoku;
      return currentLang === 'en' ? g.en : g.zh;
    }
  };
})(typeof window !== 'undefined' ? window : globalThis);
