// ============================================
// Date: 2026-11-05
// Version: v1.0.0
// Changes: Service worker that adds COOP/COEP headers so the multi-threaded Fairy-Stockfish WASM can run on GitHub Pages
// 修改: 新增 Service Worker，替回應補上 COOP/COEP 標頭，讓多執行緒 Fairy-Stockfish WASM 能在 GitHub Pages 執行
// ============================================
/**
 * Cross-Origin Isolation Service Worker
 *
 * GitHub Pages 無法自訂 HTTP 標頭，但 SharedArrayBuffer（多執行緒 WASM 必需）
 * 只有在頁面「跨來源隔離」（crossOriginIsolated === true）時才可用。
 * 本 Service Worker 攔截同網域請求，在回應上加入：
 *   Cross-Origin-Opener-Policy: same-origin
 *   Cross-Origin-Embedder-Policy: require-corp
 * 不做任何快取，只轉送請求並補標頭。
 */
/* eslint-env serviceworker */
'use strict';

self.addEventListener('install', function () {
  self.skipWaiting();
});

self.addEventListener('activate', function (event) {
  event.waitUntil(self.clients.claim());
});

/**
 * 複製回應並加上跨來源隔離標頭。
 * @param {Response} response 原始回應
 * @returns {Response} 加上標頭的新回應
 */
function withIsolationHeaders(response) {
  // opaque（跨網域 no-cors）回應無法改寫，原樣回傳
  if (!response || response.status === 0 || response.type === 'opaque') {
    return response;
  }
  const headers = new Headers(response.headers);
  headers.set('Cross-Origin-Opener-Policy', 'same-origin');
  headers.set('Cross-Origin-Embedder-Policy', 'require-corp');
  headers.set('Cross-Origin-Resource-Policy', 'same-origin');
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: headers
  });
}

self.addEventListener('fetch', function (event) {
  const request = event.request;
  // 只處理同網域請求；其他（例如外部連結）交給瀏覽器
  if (new URL(request.url).origin !== self.location.origin) return;
  // Chrome 已知問題：only-if-cached 搭配非 same-origin 模式會丟例外
  if (request.cache === 'only-if-cached' && request.mode !== 'same-origin') return;

  event.respondWith(
    fetch(request)
      .then(withIsolationHeaders)
      .catch(function (err) {
        console.error('[coi-sw] fetch failed:', request.url, err);
        throw err;
      })
  );
});
