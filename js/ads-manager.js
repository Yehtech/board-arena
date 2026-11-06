// ============================================
// Date: 2026-11-06
// Version: v1.2.0
// Changes: Ad copy moved to dictionaries; removed language arguments
// 修改: 廣告文案移到字典；移除語言參數
// ============================================
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

  /** 取得目前語言的文字 */
  function T(key) {
    return BoardArena.I18N.t(key);
  }
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

  function renderDisplaySlot(containerEl, placement) {
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

    const slot = placement || 'lobby';
    const sponsorCopy = { tag: T('ad.' + slot + '.tag'), title: T('ad.' + slot + '.title'), sub: T('ad.' + slot + '.sub') };

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
  function maybeShowInterstitial(onComplete) {
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
      onDone: function () {
        if (onComplete) onComplete({ shown: true });
      }
    });
  }

  /**
   * H5 Games Ads Rewarded Ad: Player explicitly clicks "Watch Ad for Master Hint" in vs-Bot mode.
   */
  function requestRewardedHint(onRewardGranted) {
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
      onDone: function (completed) {
        if (completed) {
          metrics.rewardedCompleted++;
          if (onRewardGranted) onRewardGranted();
        }
      }
    });
    return true;
  }

  function countdownText(seconds) {
    return BoardArena.I18N.t('ad.countdown', { seconds: seconds });
  }

  function showTimedOverlayModal(opts) {
    if (typeof document === 'undefined') {
      if (opts.onDone) opts.onDone(true);
      return;
    }
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
      countdownText(left) +
      '</span>' +
      '</div>' +
      '<h3>' +
      T(isRewarded ? 'ad.rewardedTitle' : 'ad.interstitialTitle') +
      '</h3>' +
      '<p>' +
      T(isRewarded ? 'ad.rewardedBody' : 'ad.interstitialBody') +
      '</p>' +
      '<div class="cba-h5ad-actions">' +
      (isRewarded
        ? '<button type="button" class="cba-btn cba-btn-ghost" id="cbaCancelRewardBtn">' +
          T('ad.cancel') +
          '</button>'
        : '') +
      '<button type="button" class="cba-btn cba-btn-gold" id="cbaFinishAdBtn" disabled>' +
      T('ad.wait') +
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
        if (countEl) countEl.textContent = T('ad.completed');
        if (finishBtn) {
          finishBtn.disabled = false;
          finishBtn.textContent = T(isRewarded ? 'ad.claimHint' : 'ad.continue');
        }
      } else if (countEl) {
        countEl.textContent = countdownText(left);
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
