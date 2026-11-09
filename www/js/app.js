// Smart Dash — application bootstrap, routing and global wiring.

import { icon, LOGO } from './icons.js';
import { $, $$ } from './util.js';
import { store } from './store.js';
import { hub } from './hub.js';
import { refreshCards } from './cards.js';
import { openDevice } from './detail.js';
import { openPalette } from './palette.js';
import { haptic, ripple, topSheet, closeAllSheets, toast } from './ui.js';
import { applyTheme } from './theme.js';
import { startEnergy } from './energy.js';
import { typeDef } from './devices.js';
import * as Home from './views/home.js';
import * as Devices from './views/devices.js';
import * as Scenes from './views/scenes.js';
import * as Music from './views/music.js';
import * as Room from './views/room.js';
import { initSpotify } from './spotify.js';
import { startPanel, panelSettings } from './panel.js';
import * as Energy from './views/energy.js';
import * as Settings from './views/settings.js';

const ROUTES = {
  home: { view: Home, label: 'Home', icon: 'home', rerenderOn: ['structure', 'scenes', 'settings'] },
  devices: { view: Devices, label: 'Devices', icon: 'grid', rerenderOn: ['structure'] },
  music: { view: Music, label: 'Music', icon: 'music', rerenderOn: [] },
  scenes: { view: Scenes, label: 'Moods', icon: 'sparkles', rerenderOn: ['scenes', 'routines'] },
  energy: { view: Energy, label: 'Energy', icon: 'bolt', rerenderOn: ['settings'] },
  room: { view: Room, label: 'Room', icon: 'home', rerenderOn: ['structure'], hidden: true, navAs: 'home' },
  settings: { view: Settings, label: 'Settings', icon: 'sliders', rerenderOn: [] },
};
const ORDER = Object.keys(ROUTES).filter((k) => !ROUTES[k].hidden);
let currentParam = null;

let current = null;
let cleanup = null;

const routeFromHash = () => {
  const [r, param] = location.hash.replace(/^#\/?/, '').split('?')[0].split('/');
  currentParam = param ? decodeURIComponent(param) : null;
  return ROUTES[r] ? r : 'home';
};

function navHTML(cls) {
  return ORDER.map((k) => `<a href="#/${k}" class="${cls}" data-route="${k}" aria-label="${ROUTES[k].label}">${icon(ROUTES[k].icon)}<span>${ROUTES[k].label}</span></a>`).join('');
}

function buildChrome() {
  $('.sidebar').innerHTML = `
    <a class="brand" href="#/home">${LOGO}<span>Smart <b>Dash</b></span></a>
    <nav class="side-nav">${navHTML('side-link')}</nav>
    <button class="side-search" data-act="search">${icon('search')}<span>Search</span><kbd>⌘K</kbd></button>
    <div class="side-status" id="side-status"></div>`;
  $('.tabbar').innerHTML = `<span class="tab-ind"></span>${navHTML('tab')}`;
  $('.sidebar [data-act="search"]').addEventListener('click', openPalette);
  updateSideStatus();
}

function updateSideStatus() {
  const el = $('#side-status');
  if (!el) return;
  const enabled = Object.entries(store.state.integrations).filter(([, c]) => c.enabled).map(([id]) => id);
  const states = enabled.map((id) => hub.statusOf(id).state);
  const err = states.includes('error');
  const busy = states.includes('connecting');
  const n = Object.keys(store.state.devices).length;
  el.innerHTML = `<span class="pill ${err ? 'err' : busy ? 'busy' : enabled.length ? 'ok' : ''}"><i></i>${err ? 'Connection issue' : busy ? 'Connecting…' : enabled.length ? `${n} devices online` : 'No services'}</span>`;
}

function setActiveNav(route) {
  route = ROUTES[route]?.navAs || route;
  $$('[data-route]').forEach((a) => {
    const on = a.dataset.route === route;
    a.classList.toggle('active', on);
    if (on) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  const tab = $(`.tab[data-route="${route}"]`);
  const ind = $('.tab-ind');
  if (tab && ind) {
    ind.style.width = `${tab.offsetWidth}px`;
    ind.style.transform = `translateX(${tab.offsetLeft}px)`;
  }
}

function render(route, { soft = false } = {}) {
  const view = $('#view');
  const prevIndex = current ? ORDER.indexOf(ROUTES[current].navAs || current) : -1;
  cleanup?.();
  cleanup = null;
  const scroll = soft ? window.scrollY : 0;
  current = route;
  view.dataset.page = route;
  cleanup = ROUTES[route].view.render(view, currentParam) || null;
  setActiveNav(route);
  view.classList.toggle('soft', soft);
  if (!soft) {
    window.scrollTo({ top: 0 });
    view.classList.remove('enter', 'from-left', 'from-right');
    void view.offsetWidth;
    const idx = route === 'room' ? ORDER.length : ORDER.indexOf(route);
    const dir = prevIndex < 0 ? '' : idx > prevIndex ? 'from-right' : idx < prevIndex ? 'from-left' : '';
    view.classList.add('enter');
    if (dir) view.classList.add(dir);
    document.title = route === 'home' ? 'Smart Dash' : `${ROUTES[route].label} · Smart Dash`;
  } else {
    window.scrollTo({ top: scroll });
  }
}

const softTimers = {};
function softRerender(evt) {
  if (!current || !ROUTES[current].rerenderOn.includes(evt)) return;
  // Don't yank the UI out from under someone typing.
  if (document.activeElement?.matches?.('#view input[type="search"], #view .search-bar input')) return;
  clearTimeout(softTimers[evt]);
  softTimers[evt] = setTimeout(() => render(current, { soft: true }), 60);
}

/* ---------------- Global interactions ---------------- */

function wireCards() {
  const view = $('#view');
  view.addEventListener('click', (e) => {
    const card = e.target.closest('.dcard');
    if (!card) return;
    const id = card.dataset.id;
    const d = store.device(id);
    if (!d) return;
    if (e.target.closest('.tgl, .dc-act')) {
      e.stopPropagation();
      const btn = e.target.closest('.tgl, .dc-act');
      ripple(e, card);
      haptic(10);
      const done = hub.quickToggle(id);
      if (!done) openDevice(id); // e.g. unlocking needs confirmation
      btn.classList.remove('bump');
      void btn.offsetWidth;
      btn.classList.add('bump');
      return;
    }
    haptic(4);
    openDevice(id);
  });
  view.addEventListener('keydown', (e) => {
    const card = e.target.closest?.('.dcard');
    if (!card || e.target !== card) return;
    if (e.key === 'Enter') { e.preventDefault(); openDevice(card.dataset.id); }
    if (e.key === ' ') {
      e.preventDefault();
      if (!hub.quickToggle(card.dataset.id)) openDevice(card.dataset.id);
    }
  });
  // Long-press anywhere on a card opens details (feels native on touch).
  let lp = null;
  view.addEventListener('pointerdown', (e) => {
    const card = e.target.closest('.dcard');
    if (!card || e.target.closest('.tgl, .dc-act')) return;
    card.classList.add('press');
    lp = setTimeout(() => { lp = null; }, 450);
  });
  const release = () => $$('.dcard.press').forEach((c) => c.classList.remove('press'));
  view.addEventListener('pointerup', release);
  view.addEventListener('pointercancel', release);
  view.addEventListener('pointerleave', release);
}

function wireKeys() {
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      openPalette();
      return;
    }
    const typing = e.target.closest?.('input, textarea, select, [contenteditable]');
    if (typing || topSheet()) return;
    if (e.key === '/') { e.preventDefault(); openPalette(); }
    const n = parseInt(e.key, 10);
    if (n >= 1 && n <= ORDER.length && !e.ctrlKey && !e.metaKey && !e.altKey) location.hash = `#/${ORDER[n - 1]}`;
  });
}

function wireNative() {
  const App = window.Capacitor?.Plugins?.App;
  App?.addListener?.('backButton', () => {
    if (topSheet()) topSheet().close();
    else if (current !== 'home') location.hash = '#/home';
    else if (!panelSettings().enabled) App.exitApp?.(); // a wall panel never closes itself
  });
  document.addEventListener('visibilitychange', () => {
    // Reconnect quickly when the app comes back to the foreground.
    if (document.visibilityState === 'visible') {
      for (const [id, c] of Object.entries(store.state.integrations)) {
        if (c.enabled && hub.statusOf(id).state === 'error') hub.connect(id).catch(() => {});
      }
    }
  });
  window.addEventListener('offline', () => toast("You're offline", { icon: 'wifi', detail: 'Local devices may still respond.' }));
  window.addEventListener('online', () => toast('Back online', { icon: 'wifi', type: 'success' }));
}

/* ---------------- Routines ---------------- */

function startRoutines() {
  const check = () => {
    const now = new Date();
    const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    const stamp = `${now.toDateString()} ${hhmm}`;
    for (const r of store.state.routines) {
      if (!r.enabled || r.time !== hhmm || !r.days.includes(now.getDay()) || r.lastRun === stamp) continue;
      r.lastRun = stamp;
      store.save();
      hub.runScene(r.sceneId, { silent: true }).then(() => toast(`Routine “${r.name}” ran`, { icon: 'clock', type: 'success' }));
    }
  };
  setInterval(check, 15000);
  check();
}

/* ---------------- Boot ---------------- */

function hideSplash() {
  const s = $('#splash');
  if (!s) return;
  s.classList.add('out');
  setTimeout(() => s.remove(), 700);
}

function boot() {
  applyTheme();
  $('#splash .splash-logo').innerHTML = LOGO;
  buildChrome();
  wireCards();
  wireKeys();
  wireNative();

  store.on('device', (id) => refreshCards(id));
  ['structure', 'scenes', 'routines', 'settings'].forEach((ev) => store.on(ev, () => softRerender(ev)));
  store.on('integration', updateSideStatus);
  store.on('structure', updateSideStatus);

  window.addEventListener('hashchange', () => {
    closeAllSheets();
    render(routeFromHash());
  });
  window.addEventListener('resize', () => setActiveNav(current));

  initSpotify(
    () => { toast('Spotify connected', { icon: 'music', type: 'success' }); if (current === 'music') render('music'); else location.hash = '#/music'; },
    (e) => toast('Spotify sign-in failed', { icon: 'alert', type: 'error', detail: e.message }),
  );
  startPanel();
  hub.start();
  startEnergy();
  startRoutines();
  render(routeFromHash());
  const t0 = performance.now();
  const minSplash = 900;
  setTimeout(hideSplash, Math.max(0, minSplash - (performance.now() - t0)));

  if (!store.state.settings.onboarded) {
    store.setSettings({ onboarded: true });
    setTimeout(() => toast('Welcome to Smart Dash', { icon: 'sparkles', detail: 'Tap + to connect your devices.', duration: 6000 }), 1600);
  }

  if ('serviceWorker' in navigator && location.protocol !== 'file:' && !window.Capacitor?.isNativePlatform?.()) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
  // Exposed for debugging from the console.
  window.smartdash = { store, hub, typeDef };
}

boot();
