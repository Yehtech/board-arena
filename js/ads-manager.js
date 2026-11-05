// ============================================
// Date: 2026-11-05
// Version: v1.1.0
// Changes: Add ADS_MASTER_SWITCH kill switch (default off); overrides stored config, rewarded hint granted without ad when off
// 修改: 新增廣告總開關 ADS_MASTER_SWITCH（預設關閉），覆蓋 localStorage 設定；關閉時大師提示直接給、不播廣告
// ============================================
/**
 * Classic Board Arena — AdSense & H5 Games Ads Manager + GDPR CMP
 * Implements Spec §10:
 * - Display slots: Lobby/Leaderboard, Academy/Rules, Game-Result modal
 * - H5 Interstitial: Between games on "Rematch" with strict 180s frequency cap
 * - H5 Rewarded Ad: Player-initiated "Watch Ad for Master AI Top-3 Hints" in bot mode
 * - HARD GUARANTEE: Active matches NEVER display board-covering or full-screen ads.
 */
(function (global) {
  'use strict';

  const BoardArena = (global.BoardArena = global.BoardArena || {});
  const STORAGE_KEY_CMP = 'CBA_GDPR_CMP_V1';
  const STORAGE_KEY_CFG = 'CBA_AD_REMOTE_CONFIG_V1';

  /**
   * 廣告總開關。false = 全站不顯示任何廣告（橫幅、插頁、獎勵廣告、Cookie 同意橫幅）。
   * 之後要開廣告：改成 true，並把 publisherId 換成正式的 AdSense ID。
   * 此開關優先於 localStorage 內任何舊設定。
   */
  const ADS_MASTER_SWITCH = false;

  const defaultRemoteConfig = {
    adsEnabled: true,
    publisherId: 'ca-pub-0000000000000000', // Replaceable via remote config / env
    lobbyBannerEnabled: true,
    academyBannerEnabled: true,
    resultBannerEnabled: true,
    interstitialEnabled: true,
    interstitialCooldownSec: 180,
    rewardedHintEnabled: true,
    adFreeSubscriber: false
  };

  let config = Object.assign({}, defaultRemoteConfig);
  try {
    const raw = global.localStorage && global.localStorage.getItem(STORAGE_KEY_CFG);
    if (raw) Object.assign(config, JSON.parse(raw));
  } catch (e) {}
  if (!ADS_MASTER_SWITCH) config.adsEnabled = false;

  function isAdsEnabled() {
    return ADS_MASTER_SWITCH && !!config.adsEnabled && !config.adFreeSubscriber;
  }

  let lastInterstitialAt = 0;
  let activeRatedMatchLocked = false;
  let metrics = {
    displayImpressions: 0,
    interstitialShown: 0,
    interstitialSkippedByCap: 0,
    rewardedCompleted: 0,
    blockedDuringActiveMatch: 0
  };

  function getConsentState() {
    try {
      const saved = global.localStorage && global.localStorage.getItem(STORAGE_KEY_CMP);
      if (saved) return JSON.parse(saved);
    } catch (e) {}
    return { decided: false, personalized: false, updatedAt: null };
  }

  function saveConsentState(personalized) {
    const state = {
      decided: true,
      personalized: !!personalized,
      updatedAt: new Date().toISOString()
    };
    try {
      if (global.localStorage) global.localStorage.setItem(STORAGE_KEY_CMP, JSON.stringify(state));
    } catch (e) {}
    return state;
  }

  function setMatchLock(isPlayingMatch) {
    activeRatedMatchLocked = !!isPlayingMatch;
  }

  function renderDisplaySlot(containerEl, placement, lang) {
    if (!containerEl) return;
    if (!isAdsEnabled()) {
      containerEl.innerHTML = '';
      containerEl.style.display = 'none';
      return;
    }
    if (
      (placement === 'lobby' && !config.lobbyBannerEnabled) ||
      (placement === 'academy' && !config.academyBannerEnabled) ||
      (placement === 'result' && !config.resultBannerEnabled)
    ) {
      containerEl.style.display = 'none';
      return;
    }

    containerEl.style.display = 'block';
    metrics.displayImpressions++;

    const isEn = lang === 'en';
    const sponsorCopy = {
      lobby: isEn
        ? {
            tag: 'AdSense Display · Lobby Slot (728×90)',
            title: 'Master Kaya Wood Goban & Staunton Chess Craftsmanship',
            sub: 'Non-intrusive sponsor slot · Zero popups during active matches · Supports free global servers'
          }
        : {
            tag: 'Google AdSense 展示廣告版位 · 大廳橫幅 (728×90)',
            title: '【棋藝贊助版位】百年本榧木棋盤與史湯頓實木西洋棋具工坊・全球免運',
            sub: '非干擾式廣告元件（遠端開關可控・對局進行中絕不遮擋棋盤）'
          },
      academy: isEn
        ? {
            tag: 'AdSense Display · Academy Content Slot',
            title: 'Interactive Xiangqi, Shogi & Go Endgame Masterclass',
            sub: 'Ad slot rendered only on rules & tutorial pages'
          }
        : {
            tag: 'Google AdSense 展示廣告版位 · 規則與教學專欄',
            title: '【線上棋院專欄贊助】象棋殘局殺法、將棋詰將棋與圍棋死活題系統課',
            sub: '僅顯示於規則與教學內容頁，支援 Google AdSense <ins class="adsbygoogle"> 即插即換'
          },
      result: isEn
        ? {
            tag: 'AdSense Display · Post-Match Result Slot',
            title: 'Upgrade to Pro Ad-Free & Post-Game Engine Analysis',
            sub: 'Shown only after GameEnded — never interrupts clock or board'
          }
        : {
            tag: 'Google AdSense 展示廣告版位 · 賽後結算橫幅',
            title: '【賽後版位】預留 AdSense / 棋社贊助橫幅（僅於對局結束後顯示）',
            sub: '嚴守規格書第 10 節：計分對局進行中零全版與零遮擋廣告'
          }
    }[placement || 'lobby'];

    containerEl.innerHTML =
      '<div class="cba-ad-slot" data-ad-client="' +
      config.publisherId +
      '" data-ad-placement="' +
      placement +
      '">' +
      '<div class="cba-ad-meta">' +
      '<span class="cba-ad-badge">AD</span>' +
      '<span>' +
      sponsorCopy.tag +
      '</span>' +
      '</div>' +
      '<div class="cba-ad-body">' +
      '<div class="cba-ad-headline">' +
      sponsorCopy.title +
      '</div>' +
      '<div class="cba-ad-sub">' +
      sponsorCopy.sub +
      '</div>' +
      '</div>' +
      '</div>';
  }

  /**
   * H5 Games Ads Interstitial between two games ("Rematch"), enforcing cooldown cap
   * and NEVER firing while a match is actively in progress.
   */
  function maybeShowInterstitial(lang, onComplete) {
    if (activeRatedMatchLocked) {
      metrics.blockedDuringActiveMatch++;
      if (onComplete) onComplete({ shown: false, reason: 'blocked_active_match' });
      return;
    }
    if (!isAdsEnabled() || !config.interstitialEnabled) {
      if (onComplete) onComplete({ shown: false, reason: 'disabled' });
      return;
    }
    const now = Date.now();
    const elapsedSec = (now - lastInterstitialAt) / 1000;
    if (lastInterstitialAt > 0 && elapsedSec < config.interstitialCooldownSec) {
      metrics.interstitialSkippedByCap++;
      if (onComplete) onComplete({ shown: false, reason: 'frequency_cap', remainingSec: Math.ceil(config.interstitialCooldownSec - elapsedSec) });
      return;
    }

    lastInterstitialAt = now;
    metrics.interstitialShown++;
    showTimedOverlayModal({
      mode: 'interstitial',
      seconds: 2,
      lang: lang,
      onDone: function () {
        if (onComplete) onComplete({ shown: true });
      }
    });
  }

  /**
   * H5 Games Ads Rewarded Ad: Player explicitly clicks "Watch Ad for Master Hint" in vs-Bot mode.
   */
  function requestRewardedHint(lang, onRewardGranted) {
    if (!isAdsEnabled() || !config.rewardedHintEnabled) {
      // 廣告關閉時直接給提示，不播放廣告
      if (onRewardGranted) onRewardGranted();
      return true;
    }
    if (activeRatedMatchLocked) {
      metrics.blockedDuringActiveMatch++;
      return false;
    }
    showTimedOverlayModal({
      mode: 'rewarded',
      seconds: 2,
      lang: lang,
      onDone: function (completed) {
        if (completed) {
          metrics.rewardedCompleted++;
          if (onRewardGranted) onRewardGranted();
        }
      }
    });
    return true;
  }

  function showTimedOverlayModal(opts) {
    if (typeof document === 'undefined') {
      if (opts.onDone) opts.onDone(true);
      return;
    }
    const isEn = opts.lang === 'en';
    const isRewarded = opts.mode === 'rewarded';
    const overlay = document.createElement('div');
    overlay.className = 'cba-h5ad-overlay';

    let left = opts.seconds || 2;
    overlay.innerHTML =
      '<div class="cba-h5ad-dialog">' +
      '<div class="cba-h5ad-top">' +
      '<span class="cba-ad-badge">' +
      (isRewarded ? 'H5 REWARDED AD' : 'H5 INTERSTITIAL AD') +
      '</span>' +
      '<span id="cbaAdCountdown" class="cba-tabular">' +
      (isEn ? 'Ready in ' + left + 's' : '倒數 ' + left + ' 秒') +
      '</span>' +
      '</div>' +
      '<h3>' +
      (isRewarded
        ? isEn
          ? 'Unlock Master AI Top-3 Tactical Hint'
          : '觀看 H5 獎勵廣告・解鎖【大師級 AI 最佳三選點提示】'
        : isEn
        ? 'Between-Games Sponsor Break (Frequency Capped)'
        : '兩盤之間插頁廣告（具備 180 秒頻率上限保護）') +
      '</h3>' +
      '<p>' +
      (isRewarded
        ? isEn
          ? 'Google H5 Games Ads adBreak({ type: "reward" }) compatible hook.'
          : '已串接標準 Google H5 Games Ads adBreak({ type: "reward" }) 介面，僅於單人電腦模式主動點擊時觸發。'
        : isEn
        ? 'Google H5 Games Ads adBreak({ type: "next" }) compatible hook between rematches.'
        : '已串接標準 Google H5 Games Ads adBreak({ type: "next" }) 介面，計分對局進行中絕不彈出。') +
      '</p>' +
      '<div class="cba-h5ad-actions">' +
      (isRewarded
        ? '<button type="button" class="cba-btn cba-btn-ghost" id="cbaCancelRewardBtn">' +
          (isEn ? 'Cancel' : '取消觀看') +
          '</button>'
        : '') +
      '<button type="button" class="cba-btn cba-btn-gold" id="cbaFinishAdBtn" disabled>' +
      (isEn ? 'Please wait...' : '請稍候...') +
      '</button>' +
      '</div>' +
      '</div>';

    document.body.appendChild(overlay);
    const countEl = overlay.querySelector('#cbaAdCountdown');
    const finishBtn = overlay.querySelector('#cbaFinishAdBtn');
    const cancelBtn = overlay.querySelector('#cbaCancelRewardBtn');

    const timer = setInterval(function () {
      left--;
      if (left <= 0) {
        clearInterval(timer);
        if (countEl) countEl.textContent = isEn ? 'Completed ✓' : '可關閉 ✓';
        if (finishBtn) {
          finishBtn.disabled = false;
          finishBtn.textContent = isRewarded
            ? isEn
              ? 'Claim Master Hint →'
              : '領取大師提示 →'
            : isEn
            ? 'Continue to Match →'
            : '繼續下一盤 →';
        }
      } else if (countEl) {
        countEl.textContent = isEn ? 'Ready in ' + left + 's' : '倒數 ' + left + ' 秒';
      }
    }, 650);

    if (cancelBtn) {
      cancelBtn.onclick = function () {
        clearInterval(timer);
        overlay.remove();
        if (opts.onDone) opts.onDone(false);
      };
    }
    if (finishBtn) {
      finishBtn.onclick = function () {
        clearInterval(timer);
        overlay.remove();
        if (opts.onDone) opts.onDone(true);
      };
    }
  }

  function updateConfig(patch) {
    Object.assign(config, patch || {});
    if (!ADS_MASTER_SWITCH) config.adsEnabled = false;
    try {
      if (global.localStorage) global.localStorage.setItem(STORAGE_KEY_CFG, JSON.stringify(config));
    } catch (e) {}
    return Object.assign({}, config);
  }

  BoardArena.AdsManager = {
    getConfig() {
      return Object.assign({}, config);
    },
    updateConfig,
    isAdsEnabled,
    getMetrics() {
      return Object.assign({}, metrics);
    },
    getConsentState,
    saveConsentState,
    setMatchLock,
    isMatchLocked() {
      return activeRatedMatchLocked;
    },
    renderDisplaySlot,
    maybeShowInterstitial,
    requestRewardedHint
  };
})(typeof window !== 'undefined' ? window : globalThis);
