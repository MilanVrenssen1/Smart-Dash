// Doorbell popups built from Eufy Security notifications (read by the native Doorbell plugin).

import { icon } from './icons.js';
import { esc } from './util.js';
import { store } from './store.js';
import { haptic, toast } from './ui.js';

const plugin = () => window.Capacitor?.Plugins?.Doorbell;
export const isNativeDoorbell = () => !!plugin();

export const DOORBELL_DEFAULTS = { enabled: true, ring: true, motion: true, person: true, chime: true };
export const doorbellSettings = () => ({ ...DOORBELL_DEFAULTS, ...(store.state.settings.doorbell || {}) });

// Eufy wording varies by language and model; match the common phrases (English + Dutch).
const RING = /\b(ring|rang|ringing|doorbell|door\s?bell|at (your|the) (front )?door|visitor|aangebeld|belt aan|deurbel|bezoeker)\b/i;
const PERSON = /\b(person|people|someone|human|face|persoon|iemand|gezicht|mens)\b/i;
const MOTION = /\b(motion|movement|moving|detected|beweging|gedetecteerd|activiteit)\b/i;
const PACKAGE = /\b(package|parcel|delivery|pakket|bezorging)\b/i;

export function classify(ev) {
  const t = `${ev.title} ${ev.text} ${ev.sub}`;
  if (RING.test(t)) return 'ring';
  if (PACKAGE.test(t)) return 'package';
  if (PERSON.test(t)) return 'person';
  if (MOTION.test(t)) return 'motion';
  return 'other';
}

const HEAD = {
  ring: 'Someone is at the door',
  person: 'Someone is outside',
  motion: 'Motion at the door',
  package: 'A package has arrived',
  other: 'Doorbell',
};

let current = null;
const seen = new Map(); // dedupe: key -> time

function chime() {
  if (!doorbellSettings().chime) return;
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    // Two soft bell tones, the classic "ding-dong".
    [[659.25, 0], [523.25, 0.42]].forEach(([f, at]) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'sine';
      o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, ctx.currentTime + at);
      g.gain.exponentialRampToValueAtTime(0.22, ctx.currentTime + at + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + at + 1.3);
      o.connect(g).connect(ctx.destination);
      o.start(ctx.currentTime + at);
      o.stop(ctx.currentTime + at + 1.4);
    });
    setTimeout(() => ctx.close(), 2200);
  } catch { /* audio unavailable */ }
}

function close() {
  if (!current) return;
  const el = current.el;
  clearTimeout(current.timer);
  current = null;
  el.classList.remove('in');
  setTimeout(() => el.remove(), 500);
}

export function showDoorbell(ev, kind = classify(ev)) {
  const s = doorbellSettings();
  if (!s.enabled) return;
  if (kind === 'ring' && !s.ring) return;
  if ((kind === 'motion' || kind === 'other') && !s.motion) return;
  if ((kind === 'person' || kind === 'package') && !s.person) return;

  // Wake the wall panel's night clock.
  document.querySelector('.nightclock')?.dispatchEvent(new PointerEvent('pointerdown'));

  close();
  const time = new Date(ev.time || Date.now()).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  const detail = [ev.title, ev.text].filter(Boolean).join(' — ');
  const el = document.createElement('div');
  el.className = `doorbell-pop k-${kind}`;
  el.setAttribute('role', 'alertdialog');
  el.setAttribute('aria-label', HEAD[kind]);
  el.innerHTML = `
    <div class="db-card">
      <div class="db-media ${ev.image ? '' : 'empty'}">
        ${ev.image ? `<img src="${ev.image}" alt="Doorbell snapshot">` : `<span class="db-ph">${icon('door')}</span>`}
        <span class="db-live"><i></i>${kind === 'ring' ? 'Ringing' : 'Detected'} · ${esc(time)}</span>
      </div>
      <div class="db-body">
        <p class="eyebrow">Front door</p>
        <h2 class="db-title">${esc(HEAD[kind])}</h2>
        ${detail ? `<p class="db-detail">${esc(detail)}</p>` : ''}
        <div class="db-actions">
          ${isNativeDoorbell() ? `<button class="btn primary" data-db="open">${icon('eye')}<span>Open Eufy</span></button>` : ''}
          <button class="btn ghost" data-db="close">${icon('x')}<span>Dismiss</span></button>
        </div>
      </div>
      <span class="db-timer"><i></i></span>
    </div>`;
  document.body.appendChild(el);
  const ttl = kind === 'ring' ? 60000 : 25000;
  el.style.setProperty('--ttl', `${ttl}ms`);
  requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('in')));
  current = { el, timer: setTimeout(close, ttl) };
  el.addEventListener('click', (e) => {
    const a = e.target.closest('[data-db]')?.dataset.db;
    if (a === 'close' || e.target === el) close();
    if (a === 'open') { plugin()?.openEufy().catch((err) => toast(err.message || 'Couldn’t open Eufy', { icon: 'alert', type: 'error' })); close(); }
  });
  if (kind === 'ring') { haptic([30, 60, 30]); chime(); } else haptic(12);
  store.log(kind === 'ring' ? 'Doorbell rang' : `${HEAD[kind]}`, kind === 'ring' ? 'bell' : 'motion');
}

export function startDoorbell() {
  const p = plugin();
  if (!p) return;
  p.addListener('event', (ev) => {
    // Eufy often updates the same notification (e.g. to add the picture) — show the richest version once.
    const prev = seen.get(ev.key);
    const now = Date.now();
    if (prev && now - prev.at < 15000) {
      if (ev.image && !prev.image && current) showDoorbell(ev, prev.kind);
      return;
    }
    const kind = classify(ev);
    seen.set(ev.key, { at: now, image: !!ev.image, kind });
    for (const [k, v] of seen) if (now - v.at > 60000) seen.delete(k);
    showDoorbell(ev, kind);
  });
}

export const doorbellStatus = () => plugin()?.status?.() ?? Promise.resolve({ permission: false, eufyInstalled: false });
export const openDoorbellPermission = () => plugin()?.openPermissionSettings?.();

/** A sample popup so the look can be checked without anyone at the door. */
export function testDoorbell() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 400"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3a352d"/><stop offset="1" stop-color="#14120f"/></linearGradient></defs><rect width="640" height="400" fill="url(#g)"/><rect x="230" y="40" width="180" height="360" rx="6" fill="#211e19" stroke="#5a5146" stroke-width="4"/><circle cx="320" cy="170" r="46" fill="#4b443a"/><path d="M230 400c10-90 50-140 90-140s80 50 90 140z" fill="#4b443a"/><circle cx="392" cy="230" r="5" fill="#c9ab72"/></svg>`;
  showDoorbell({ key: 'test', title: 'Front Door', text: 'Someone is ringing the doorbell.', sub: '', image: `data:image/svg+xml;base64,${btoa(svg)}`, time: Date.now() }, 'ring');
}
