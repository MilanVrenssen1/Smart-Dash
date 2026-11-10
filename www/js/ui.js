// Reusable UI primitives: toasts, bottom sheets, dialogs, haptics, ripples.

import { icon } from './icons.js';
import { esc, prefersReducedMotion } from './util.js';
import { store } from './store.js';

export function haptic(pattern = 8) {
  if (!store.state.settings.haptics) return;
  try { navigator.vibrate?.(pattern); } catch { /* unsupported */ }
}

/* ---------------- Toasts ---------------- */
export function toast(message, { icon: ic = 'info', type = '', detail = '', action, duration = 3200 } = {}) {
  const root = document.getElementById('toasts');
  if (!root) return;
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.setAttribute('role', 'status');
  el.innerHTML = `<span class="toast-ic">${icon(ic)}</span>
    <span class="toast-txt"><b>${esc(message)}</b>${detail ? `<small>${esc(detail)}</small>` : ''}</span>
    ${action ? `<button class="toast-act">${esc(action.label)}</button>` : ''}`;
  if (action) el.querySelector('.toast-act').onclick = () => { action.run(); dismiss(); };
  root.appendChild(el);
  while (root.children.length > 3) root.firstElementChild.remove();
  requestAnimationFrame(() => el.classList.add('in'));
  let gone = false;
  function dismiss() {
    if (gone) return;
    gone = true;
    el.classList.remove('in');
    el.classList.add('out');
    setTimeout(() => el.remove(), 350);
  }
  el.addEventListener('click', (e) => { if (!e.target.closest('.toast-act')) dismiss(); });
  setTimeout(dismiss, duration);
  return dismiss;
}

/* ---------------- Sheets ---------------- */
const stack = [];

/**
 * Open a sheet (bottom sheet on phones, floating panel on larger screens).
 * Returns { el, body, close, setTitle }.
 */
export function openSheet({ title = '', subtitle = '', body = '', className = '', onClose, headerExtra = '', accent } = {}) {
  const root = document.getElementById('overlay-root');
  const wrap = document.createElement('div');
  wrap.className = `sheet-wrap ${className}`;
  wrap.innerHTML = `
    <div class="sheet-backdrop"></div>
    <section class="sheet" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <div class="sheet-grab" aria-hidden="true"><span></span></div>
      <header class="sheet-head">
        <div class="sheet-titles">
          <h2 class="sheet-title">${esc(title)}</h2>
          ${subtitle ? `<p class="sheet-sub">${esc(subtitle)}</p>` : '<p class="sheet-sub"></p>'}
        </div>
        <div class="sheet-head-extra">${headerExtra}</div>
        <button class="icon-btn sheet-close" aria-label="Close">${icon('x')}</button>
      </header>
      <div class="sheet-body"></div>
    </section>`;
  if (accent) wrap.style.setProperty('--sheet-accent', accent);
  const sheet = wrap.querySelector('.sheet');
  const bodyEl = wrap.querySelector('.sheet-body');
  if (typeof body === 'string') bodyEl.innerHTML = body;
  else if (body) bodyEl.appendChild(body);
  root.appendChild(wrap);
  document.body.classList.add('has-sheet');
  const prevFocus = document.activeElement;

  let closed = false;
  const api = {
    el: wrap,
    sheet,
    body: bodyEl,
    close,
    setTitle(t, sub) {
      wrap.querySelector('.sheet-title').textContent = t;
      if (sub != null) wrap.querySelector('.sheet-sub').textContent = sub;
    },
  };
  function close() {
    if (closed) return;
    closed = true;
    const i = stack.indexOf(api);
    if (i >= 0) stack.splice(i, 1);
    wrap.classList.remove('open');
    wrap.classList.add('closing');
    sheet.style.transform = '';
    setTimeout(() => {
      wrap.remove();
      if (!stack.length) document.body.classList.remove('has-sheet');
    }, prefersReducedMotion() ? 0 : 380);
    onClose?.();
    try { prevFocus?.focus?.({ preventScroll: true }); } catch { /* ignore */ }
  }
  wrap.querySelector('.sheet-backdrop').addEventListener('click', close);
  wrap.querySelector('.sheet-close').addEventListener('click', close);

  // Drag down to dismiss (on the grab handle / header).
  const handle = [wrap.querySelector('.sheet-grab'), wrap.querySelector('.sheet-head')];
  let startY = 0, dy = 0, dragging = false, t0 = 0;
  const onDown = (e) => {
    if (e.target.closest('button, input, select, a')) return;
    if (window.innerWidth > 760) return;
    dragging = true;
    startY = e.clientY;
    t0 = performance.now();
    dy = 0;
    sheet.style.transition = 'none';
    sheet.setPointerCapture?.(e.pointerId);
  };
  const onMove = (e) => {
    if (!dragging) return;
    dy = Math.max(0, e.clientY - startY);
    sheet.style.transform = `translateY(${dy}px)`;
  };
  const onUp = () => {
    if (!dragging) return;
    dragging = false;
    sheet.style.transition = '';
    const v = dy / Math.max(1, performance.now() - t0);
    if (dy > 140 || v > 0.6) close();
    else sheet.style.transform = '';
  };
  handle.forEach((h) => h.addEventListener('pointerdown', onDown));
  sheet.addEventListener('pointermove', onMove);
  sheet.addEventListener('pointerup', onUp);
  sheet.addEventListener('pointercancel', onUp);

  stack.push(api);
  requestAnimationFrame(() => requestAnimationFrame(() => wrap.classList.add('open')));
  setTimeout(() => sheet.focus?.({ preventScroll: true }), 50);
  sheet.tabIndex = -1;
  return api;
}

export const topSheet = () => stack[stack.length - 1] || null;
export const closeAllSheets = () => [...stack].reverse().forEach((s) => s.close());

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && stack.length) {
    e.preventDefault();
    topSheet().close();
  }
});

/* ---------------- Dialog ---------------- */
export function confirmDialog({ title, message = '', confirm = 'Confirm', danger = false }) {
  return new Promise((resolve) => {
    let answered = false;
    const s = openSheet({
      title,
      className: 'dialog',
      body: `<p class="dialog-msg">${esc(message)}</p>
        <div class="btn-row">
          <button class="btn ghost" data-a="no">Cancel</button>
          <button class="btn ${danger ? 'danger' : 'primary'}" data-a="yes">${esc(confirm)}</button>
        </div>`,
      onClose: () => { if (!answered) resolve(false); },
    });
    s.body.addEventListener('click', (e) => {
      const a = e.target.closest('[data-a]')?.dataset.a;
      if (!a) return;
      answered = true;
      resolve(a === 'yes');
      s.close();
    });
  });
}

export function promptDialog({ title, label = '', value = '', placeholder = '', confirm = 'Save' }) {
  return new Promise((resolve) => {
    let answered = false;
    const s = openSheet({
      title,
      className: 'dialog',
      body: `<form class="form">
          <label class="field"><span>${esc(label)}</span>
          <input class="input" name="v" value="${esc(value)}" placeholder="${esc(placeholder)}" autocomplete="off" required></label>
          <div class="btn-row">
            <button type="button" class="btn ghost" data-a="no">Cancel</button>
            <button class="btn primary">${esc(confirm)}</button>
          </div></form>`,
      onClose: () => { if (!answered) resolve(null); },
    });
    const form = s.body.querySelector('form');
    const input = form.querySelector('input');
    setTimeout(() => { input.focus(); input.select(); }, 120);
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      answered = true;
      resolve(input.value.trim());
      s.close();
    });
    form.querySelector('[data-a="no"]').onclick = () => s.close();
  });
}

/* ---------------- Effects ---------------- */
export function ripple(e, el) {
  if (prefersReducedMotion()) return;
  const r = el.getBoundingClientRect();
  const size = Math.max(r.width, r.height) * 2.2;
  const s = document.createElement('span');
  s.className = 'ripple';
  s.style.width = s.style.height = `${size}px`;
  s.style.left = `${(e.clientX ?? r.left + r.width / 2) - r.left - size / 2}px`;
  s.style.top = `${(e.clientY ?? r.top + r.height / 2) - r.top - size / 2}px`;
  el.appendChild(s);
  setTimeout(() => s.remove(), 650);
}

/** Smoothly count a number element to a new value. */
export function countTo(el, to, { decimals = 0, duration = 700, format } = {}) {
  if (!el) return;
  const from = parseFloat(el.dataset.v ?? to) || 0;
  el.dataset.v = to;
  const fmt = format || ((v) => v.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals }));
  if (prefersReducedMotion() || from === to) {
    el.textContent = fmt(to);
    return;
  }
  const t0 = performance.now();
  cancelAnimationFrame(el._raf);
  const tick = (t) => {
    const p = Math.min(1, (t - t0) / duration);
    const e = 1 - Math.pow(1 - p, 3);
    el.textContent = fmt(from + (to - from) * e);
    if (p < 1) el._raf = requestAnimationFrame(tick);
  };
  el._raf = requestAnimationFrame(tick);
}

/** Wire a set of [data-seg] buttons as a segmented control. */
export function segmented(container, value, onChange) {
  const set = (v) => {
    container.querySelectorAll('[data-seg]').forEach((b) => {
      const on = b.dataset.seg === String(v);
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', on);
    });
    const active = container.querySelector('[data-seg].on');
    const pill = container.querySelector('.seg-pill');
    if (active && pill) {
      pill.style.width = `${active.offsetWidth}px`;
      pill.style.transform = `translateX(${active.offsetLeft - 4}px)`;
    }
  };
  container.addEventListener('click', (e) => {
    const b = e.target.closest('[data-seg]');
    if (!b) return;
    haptic(6);
    set(b.dataset.seg);
    onChange(b.dataset.seg);
  });
  requestAnimationFrame(() => set(value));
  return { set };
}
