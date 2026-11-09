// Wall panel mode: always-on screen, full screen, a calm night clock after inactivity,
// and an optional PIN in front of Settings. Native bits come from the Panel plugin.

import { store } from './store.js';
import { esc, fmtNum } from './util.js';

const plugin = () => window.Capacitor?.Plugins?.Panel;
export const isNativePanel = () => !!plugin();

export const PANEL_DEFAULTS = { enabled: false, awake: 'charging', clockAfter: 2, dim: true, fullscreen: true, pin: '' };
export const panelSettings = () => ({ ...PANEL_DEFAULTS, ...(store.state.settings.panel || {}) });

let charging = false;
let idleTimer = null;
let clockEl = null;
let clockTick = null;
let unlockedUntil = 0;

/* ---------------- PIN ---------------- */
export const settingsLocked = () => {
  const p = panelSettings();
  return p.enabled && !!p.pin && Date.now() > unlockedUntil;
};
export function tryUnlock(pin) {
  if (pin !== panelSettings().pin) return false;
  unlockedUntil = Date.now() + 5 * 60 * 1000;
  return true;
}
export const lockNow = () => { unlockedUntil = 0; };

/* ---------------- Screen ---------------- */
function applyAwake() {
  const p = panelSettings();
  const on = p.enabled && (p.awake === 'always' || (p.awake === 'charging' && charging));
  plugin()?.keepAwake({ on }).catch?.(() => {});
}

function applyFullscreen() {
  const p = panelSettings();
  plugin()?.fullscreen({ on: p.enabled && p.fullscreen }).catch?.(() => {});
}

/* ---------------- Night clock ---------------- */
function clockHTML() {
  const now = new Date();
  const parts = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).formatToParts(now);
  const time = parts.filter((x) => x.type !== 'dayPeriod').map((x) => x.value).join('').trim();
  const period = parts.find((x) => x.type === 'dayPeriod')?.value;
  const date = now.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
  const devs = store.devices();
  const lights = devs.filter((d) => d.type === 'light' && d.state.on).length;
  const t = devs.find((d) => d.type === 'thermostat' && d.state.current != null)?.state.current
    ?? devs.find((d) => d.type === 'sensor' && d.state.kind === 'temperature')?.state.value;
  const line = [t != null ? `${fmtNum(t, 1)}° inside` : '', lights ? `${lights} light${lights === 1 ? '' : 's'} on` : 'All lights off'].filter(Boolean).join('  ·  ');
  return `<div class="nc-inner" style="--dx:${(now.getMinutes() % 7) - 3}vw;--dy:${(now.getMinutes() % 5) - 2}vh">
      <div class="nc-time">${esc(time)}${period ? `<small>${esc(period.toLowerCase())}</small>` : ''}</div>
      <div class="nc-date">${esc(date)}</div>
      ${devs.length ? `<div class="nc-line">${esc(line)}</div>` : ''}
    </div>`;
}

function showClock() {
  if (clockEl) return;
  clockEl = document.createElement('div');
  clockEl.className = 'nightclock';
  clockEl.setAttribute('role', 'button');
  clockEl.setAttribute('aria-label', 'Tap to wake');
  clockEl.innerHTML = clockHTML();
  document.body.appendChild(clockEl);
  requestAnimationFrame(() => clockEl?.classList.add('in'));
  clockTick = setInterval(() => { if (clockEl) clockEl.innerHTML = clockHTML(); }, 20000);
  if (panelSettings().dim) plugin()?.brightness({ level: 0.04 }).catch?.(() => {});
  // The tap that wakes the panel must not also press whatever is underneath.
  const wake = (e) => { e.preventDefault(); e.stopPropagation(); hideClock(); };
  clockEl.addEventListener('pointerdown', wake, { once: true });
}

function hideClock() {
  if (!clockEl) return;
  const el = clockEl;
  clockEl = null;
  clearInterval(clockTick);
  el.classList.remove('in');
  setTimeout(() => el.remove(), 500);
  plugin()?.brightness({ level: -1 }).catch?.(() => {});
  armIdle();
}

function armIdle() {
  clearTimeout(idleTimer);
  const p = panelSettings();
  if (!p.enabled || !p.clockAfter) return;
  idleTimer = setTimeout(() => {
    // Don't cover an open control panel or dialog someone is using.
    if (document.body.classList.contains('has-sheet')) { armIdle(); return; }
    showClock();
  }, p.clockAfter * 60 * 1000);
}

/* ---------------- Wiring ---------------- */
export function applyPanel() {
  applyAwake();
  applyFullscreen();
  if (!panelSettings().enabled) hideClock();
  document.documentElement.classList.toggle('panel-mode', panelSettings().enabled);
  armIdle();
}

export function startPanel() {
  ['pointerdown', 'keydown', 'wheel'].forEach((ev) => document.addEventListener(ev, () => { if (!clockEl) armIdle(); }, { passive: true, capture: true }));
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') applyPanel(); });
  const p = plugin();
  if (p) {
    p.status().then((s) => { charging = !!s.charging; applyAwake(); }).catch(() => {});
    p.addListener?.('power', (ev) => { charging = !!ev.charging; applyAwake(); });
  }
  store.on('settings', applyPanel);
  applyPanel();
}

export const panelStatus = () => plugin()?.status?.() ?? Promise.resolve({ charging: false, homeEnabled: false, isHome: false });
export const setHomeApp = (enabled) => plugin()?.setHomeApp({ enabled });
export const openSystemSettings = () => plugin()?.openSystemSettings();
export const previewClock = () => showClock();
