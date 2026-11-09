// Offline-first service worker: app shell is cached, device APIs always go to the network.
const VERSION = 'smartdash-v2.2.0';
const SHELL = [
  './', 'index.html', 'manifest.webmanifest', 'css/app.css',
  'fonts/inter-latin-wght-normal.woff2', 'fonts/inter-latin-ext-wght-normal.woff2', 'fonts/cormorant-garamond-latin-400-normal.woff2', 'fonts/cormorant-garamond-latin-500-normal.woff2', 'fonts/cormorant-garamond-latin-500-italic.woff2',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png',
  'js/app.js', 'js/util.js', 'js/icons.js', 'js/store.js', 'js/devices.js', 'js/hub.js', 'js/ui.js',
  'js/cards.js', 'js/detail.js', 'js/energy.js', 'js/connect.js', 'js/palette.js', 'js/theme.js', 'js/panel.js',
  'js/views/home.js', 'js/views/devices.js', 'js/views/scenes.js', 'js/views/music.js', 'js/views/room.js', 'js/spotify.js', 'js/views/energy.js', 'js/views/settings.js',
  'js/integrations/index.js', 'js/integrations/homeassistant.js',
  'js/integrations/hue.js', 'js/integrations/sonos.js', 'js/integrations/samsungtv.js', 'js/integrations/googlehome.js', 'js/integrations/shelly.js', 'js/integrations/webhook.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return; // never cache device traffic
  // Stale-while-revalidate for the app shell.
  e.respondWith(
    caches.open(VERSION).then(async (cache) => {
      const cached = await cache.match(e.request, { ignoreSearch: true });
      const network = fetch(e.request).then((res) => {
        if (res.ok) cache.put(e.request, res.clone());
        return res;
      }).catch(() => cached);
      return cached || network;
    }),
  );
});
