// Full-screen device control sheets — one tailored control surface per device type.

import { icon } from './icons.js';
import { esc, clamp, fmtNum, fmtPower, kelvinToHex, round } from './util.js';
import { store } from './store.js';
import { hub } from './hub.js';
import { INTEGRATIONS } from './integrations/index.js';
import { typeDef, statusText, glowColor, lightColor, sensorKind, sensorText, MODE_LABEL, devIcon } from './devices.js';
import { openSheet, haptic, segmented, promptDialog, confirmDialog, toast } from './ui.js';
import { sensorHistory } from './energy.js';
import { COMMON_APPS, tvIcon, brandIcon, iconInfo } from './integrations/samsungtv.js';

const SWATCHES = ['#ff5f5f', '#ff9f43', '#ffd166', '#a3e635', '#34d399', '#22d3ee', '#3b82f6', '#6366f1', '#7c5cff', '#c084fc', '#f472b6', '#ffe4c4'];

/* ============ Reusable controls ============ */

/** Big vertical "pill" slider, delta-based like a phone's control centre. */
function vslider({ value = 0, min = 0, max = 100, step = 1, label = 'Level', iconName = 'sun', format = (v) => `${Math.round(v)}<small>%</small>`, onInput, onChange }) {
  const el = document.createElement('div');
  el.className = 'vslider';
  el.tabIndex = 0;
  el.setAttribute('role', 'slider');
  el.setAttribute('aria-label', label);
  el.setAttribute('aria-valuemin', min);
  el.setAttribute('aria-valuemax', max);
  el.innerHTML = `<div class="vs-fill"></div><div class="vs-val"></div><span class="vs-ic">${icon(iconName)}</span>`;
  let v = value;
  let dragging = false;
  const render = () => {
    const f = (v - min) / (max - min);
    el.style.setProperty('--f', f);
    el.querySelector('.vs-val').innerHTML = format(v);
    el.setAttribute('aria-valuenow', Math.round(v));
  };
  let startY = 0, startV = 0, lastHaptic = 0, moved = false;
  el.addEventListener('pointerdown', (e) => {
    dragging = true;
    moved = false;
    startY = e.clientY;
    startV = v;
    el.setPointerCapture(e.pointerId);
    el.classList.add('drag');
  });
  el.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const h = el.clientHeight;
    const nv = clamp(round(startV + ((startY - e.clientY) / h) * (max - min) * 1.15, step), min, max);
    if (Math.abs(startY - e.clientY) > 3) moved = true;
    if (nv !== v) {
      v = nv;
      render();
      if ((v === min || v === max || Math.abs(v - lastHaptic) >= 10)) { haptic(4); lastHaptic = v; }
      onInput?.(v);
    }
  });
  const end = (e) => {
    if (!dragging) return;
    dragging = false;
    el.classList.remove('drag');
    if (!moved) {
      // Tap: jump to the tapped position.
      const r = el.getBoundingClientRect();
      v = clamp(round(min + (1 - (e.clientY - r.top) / r.height) * (max - min), step), min, max);
      render();
      onInput?.(v);
    }
    onChange?.(v);
  };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
  el.addEventListener('keydown', (e) => {
    const d = { ArrowUp: step * 5, ArrowRight: step * 5, ArrowDown: -step * 5, ArrowLeft: -step * 5 }[e.key];
    if (d == null) return;
    e.preventDefault();
    v = clamp(v + d, min, max);
    render();
    onInput?.(v);
    onChange?.(v);
  });
  render();
  return {
    el,
    set(nv) { if (!dragging) { v = nv; render(); } },
    get dragging() { return dragging; },
  };
}

function powerOrb(on, label = 'Power') {
  return `<button class="orb ${on ? 'on' : ''}" data-a="power" aria-pressed="${!!on}" aria-label="${label}">
    <span class="orb-halo"></span><span class="orb-ring"></span><span class="orb-core">${icon('power')}</span></button>`;
}

function sparkline(points, { w = 320, h = 80 } = {}) {
  if (points.length < 2) return `<div class="spark-empty">Collecting history…</div>`;
  const vs = points.map((p) => p.v);
  let lo = Math.min(...vs), hi = Math.max(...vs);
  if (hi - lo < 1e-6) { hi += 1; lo -= 1; }
  const x = (i) => (i / (points.length - 1)) * w;
  const y = (v) => h - 6 - ((v - lo) / (hi - lo)) * (h - 12);
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ');
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true">
    <defs><linearGradient id="sg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--sheet-accent)" stop-opacity=".35"/><stop offset="1" stop-color="var(--sheet-accent)" stop-opacity="0"/></linearGradient></defs>
    <path d="${d} L${w},${h} L0,${h} Z" fill="url(#sg)"/>
    <path d="${d}" fill="none" stroke="var(--sheet-accent)" stroke-width="2" vector-effect="non-scaling-stroke" stroke-linejoin="round" stroke-linecap="round"/>
  </svg>`;
}

function historyCard(d, title, fmt) {
  const pts = sensorHistory(d.id);
  const vs = pts.map((p) => p.v);
  const stats = vs.length ? `<div class="hist-stats"><span>Min <b>${fmt(Math.min(...vs))}</b></span><span>Max <b>${fmt(Math.max(...vs))}</b></span></div>` : '';
  return `<div class="ctl-card hist"><div class="card-head"><h4>${title}</h4><span class="muted">Last ${Math.max(1, Math.round((pts.length * 5) / 60))} min</span></div>
    <div class="hist-chart">${sparkline(pts)}</div>${stats}</div>`;
}

/* ============ Builders per type ============ */

function buildLight(d, root) {
  const id = d.id;
  const a = d.attrs;
  const dimmable = a.dimmable !== false;
  root.innerHTML = `
    <div class="ctl-hero light-hero">
      <div class="hero-slot"></div>
      <div class="hero-side">
        <button class="round-btn" data-a="power" aria-label="Toggle power">${icon('power')}</button>
        <span class="muted small power-lbl"></span>
      </div>
    </div>
    ${a.supportsTemp || a.supportsColor ? `<div class="ctl-card">
      ${a.supportsTemp && a.supportsColor ? `<div class="seg" role="group" aria-label="Light mode"><span class="seg-pill"></span><button data-seg="white">White</button><button data-seg="color">Colour</button></div>` : ''}
      ${a.supportsTemp ? `<div class="pane" data-pane="white">
        <div class="range-head"><span>Warm</span><b class="kv"></b><span>Daylight</span></div>
        <input type="range" class="range kelvin" min="${a.minK || 2200}" max="${a.maxK || 6500}" step="50" aria-label="Colour temperature">
        <div class="presets">${[['Candle', 2200], ['Warm', 2700], ['Soft', 3500], ['Neutral', 4200], ['Day', 5500]].filter(([, k]) => k >= (a.minK || 2200) - 1 && k <= (a.maxK || 6500)).map(([n, k]) => `<button class="chip sm" data-k="${k}"><i style="background:${kelvinToHex(k)}"></i>${n}</button>`).join('')}</div>
      </div>` : ''}
      ${a.supportsColor ? `<div class="pane" data-pane="color">
        <div class="swatches">${SWATCHES.map((c) => `<button class="sw" style="--c:${c}" data-c="${c}" aria-label="Colour ${c}"></button>`).join('')}
          <label class="sw custom" aria-label="Custom colour">${icon('palette')}<input type="color" value="#7c5cff"></label></div>
      </div>` : ''}
    </div>` : ''}`;

  const slot = root.querySelector('.hero-slot');
  let vs = null;
  if (dimmable) {
    vs = vslider({
      value: d.state.on ? d.state.brightness ?? 100 : 0, label: 'Brightness', iconName: 'sun',
      onInput: (v) => hub.setThrottled(id, v > 0 ? { on: true, brightness: v } : { on: false }),
      onChange: (v) => hub.setThrottled(id, v > 0 ? { on: true, brightness: v } : { on: false }, { final: true }),
    });
    slot.appendChild(vs.el);
  } else {
    slot.innerHTML = powerOrb(d.state.on);
  }
  root.querySelectorAll('[data-a="power"]').forEach((b) => b.addEventListener('click', () => {
    haptic(10);
    const cur = store.device(id);
    hub.set(id, { on: !cur.state.on });
  }));

  const segEl = root.querySelector('.seg');
  const showPane = (m) => root.querySelectorAll('.pane').forEach((p) => p.classList.toggle('show', p.dataset.pane === m || !segEl));
  const initMode = d.state.color && a.supportsColor ? 'color' : a.supportsTemp ? 'white' : 'color';
  if (segEl) segmented(segEl, initMode, showPane);
  showPane(initMode);

  const k = root.querySelector('.kelvin');
  if (k) {
    k.addEventListener('input', () => {
      root.querySelector('.kv').textContent = `${k.value}K`;
      hub.setThrottled(id, { colorTemp: +k.value, color: null, on: true });
    });
    k.addEventListener('change', () => hub.setThrottled(id, { colorTemp: +k.value, color: null, on: true }, { final: true }));
  }
  root.querySelectorAll('[data-k]').forEach((b) => b.addEventListener('click', () => {
    haptic(6);
    hub.set(id, { colorTemp: +b.dataset.k, color: null, on: true });
  }));
  root.querySelectorAll('.sw[data-c]').forEach((b) => b.addEventListener('click', () => {
    haptic(6);
    hub.set(id, { color: b.dataset.c, colorTemp: null, on: true });
  }));
  const ci = root.querySelector('.sw.custom input');
  if (ci) {
    ci.addEventListener('input', () => hub.setThrottled(id, { color: ci.value, colorTemp: null, on: true }));
    ci.addEventListener('change', () => hub.setThrottled(id, { color: ci.value, colorTemp: null, on: true }, { final: true }));
  }

  const update = (d) => {
    const s = d.state;
    root.style.setProperty('--light', lightColor(s));
    root.classList.toggle('is-on', !!s.on);
    vs?.set(s.on ? s.brightness ?? 100 : 0);
    root.querySelector('.orb')?.classList.toggle('on', !!s.on);
    root.querySelector('.round-btn[data-a="power"]').classList.toggle('on', !!s.on);
    root.querySelector('.power-lbl').textContent = s.on ? 'On' : 'Off';
    if (k && document.activeElement !== k) {
      k.value = s.colorTemp || 3000;
      root.querySelector('.kv').textContent = s.colorTemp ? `${s.colorTemp}K` : '—';
    }
    root.querySelectorAll('[data-k]').forEach((b) => b.classList.toggle('on', !s.color && Math.abs((s.colorTemp || 0) - +b.dataset.k) < 60));
    root.querySelectorAll('.sw[data-c]').forEach((b) => b.classList.toggle('on', s.color?.toLowerCase() === b.dataset.c.toLowerCase()));
  };
  update(d);
  return { update };
}

function buildSwitch(d, root) {
  const id = d.id;
  const hasPower = d.state.power != null;
  root.innerHTML = `
    <div class="ctl-hero col">
      ${powerOrb(d.state.on)}
      <p class="hero-caption"></p>
    </div>
    ${hasPower ? `<div class="stat-row"><div class="stat"><span class="muted">Power now</span><b class="pw"></b></div><div class="stat"><span class="muted">Estimated per day</span><b class="pd"></b></div></div>` : ''}
    ${hasPower ? `<div class="hist-slot"></div>` : ''}`;
  root.querySelector('[data-a="power"]').addEventListener('click', () => {
    haptic(12);
    hub.set(id, { on: !store.device(id).state.on });
  });
  const update = (d) => {
    const s = d.state;
    root.querySelector('.orb').classList.toggle('on', !!s.on);
    root.querySelector('.orb').setAttribute('aria-pressed', !!s.on);
    root.querySelector('.hero-caption').textContent = s.on ? 'On' : 'Off';
    if (hasPower) {
      root.querySelector('.pw').textContent = fmtPower(s.power || 0);
      root.querySelector('.pd').textContent = `${fmtNum(((s.power || 0) * 24) / 1000, 2)} kWh`;
      root.querySelector('.hist-slot').innerHTML = historyCard(d, 'Power', (v) => fmtPower(v));
    }
  };
  update(d);
  return { update };
}

function buildThermostat(d, root) {
  const id = d.id;
  const a = d.attrs;
  const min = a.min ?? 7, max = a.max ?? 30, step = a.step ?? 0.5;
  const C = 130, R = 104;
  const pt = (deg) => [C + R * Math.cos((deg * Math.PI) / 180), C + R * Math.sin((deg * Math.PI) / 180)];
  const [sx, sy] = pt(135), [ex, ey] = pt(45);
  const arc = `M${sx},${sy} A${R},${R} 0 1 1 ${ex},${ey}`;
  const ticks = Array.from({ length: 55 }, (_, i) => {
    const deg = 135 + (i / 54) * 270;
    const r1 = R - 22, r2 = R - (i % 9 === 0 ? 30 : 26);
    const c = Math.cos((deg * Math.PI) / 180), s = Math.sin((deg * Math.PI) / 180);
    return `<line x1="${C + r1 * c}" y1="${C + r1 * s}" x2="${C + r2 * c}" y2="${C + r2 * s}"/>`;
  }).join('');
  const modes = a.modes || ['off', 'heat'];
  const MODE_IC = { off: 'power', heat: 'flame', cool: 'snow', auto: 'auto', heat_cool: 'auto', dry: 'droplet', fan_only: 'fan' };
  root.innerHTML = `
    <div class="dial-wrap">
      <svg class="dial" viewBox="0 0 260 260" role="slider" tabindex="0" aria-label="Target temperature" aria-valuemin="${min}" aria-valuemax="${max}">
        <defs><linearGradient id="dialg" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="var(--dial-a)"/><stop offset="1" stop-color="var(--dial-b)"/></linearGradient></defs>
        <g class="dial-ticks">${ticks}</g>
        <path class="dial-track" d="${arc}" pathLength="100"/>
        <path class="dial-prog" d="${arc}" pathLength="100"/>
        <circle class="dial-cur" r="4"/>
        <circle class="dial-knob" r="13"/>
      </svg>
      <div class="dial-center">
        <span class="dial-mode"></span>
        <div class="dial-target"><b></b><span>°</span></div>
        <span class="dial-now"></span>
      </div>
    </div>
    <div class="ctl-row center gap">
      <button class="round-btn" data-step="-1" aria-label="Lower">${icon('minus')}</button>
      <button class="round-btn" data-step="1" aria-label="Raise">${icon('plus')}</button>
    </div>
    <div class="seg modes" role="group" aria-label="Mode"><span class="seg-pill"></span>${modes.map((m) => `<button data-seg="${m}">${icon(MODE_IC[m] || 'auto')}<span>${MODE_LABEL[m] || m}</span></button>`).join('')}</div>
    <div class="stat-row"><div class="stat"><span class="muted">Inside</span><b class="st-cur"></b></div><div class="stat"><span class="muted">Humidity</span><b class="st-hum"></b></div></div>
    <div class="hist-slot"></div>`;

  const svg = root.querySelector('.dial');
  const prog = root.querySelector('.dial-prog');
  const knob = root.querySelector('.dial-knob');
  const curDot = root.querySelector('.dial-cur');
  let target = d.state.target ?? 20;
  let dragging = false;

  const placeAt = (el, frac, r = R) => {
    const deg = 135 + frac * 270;
    el.setAttribute('cx', C + r * Math.cos((deg * Math.PI) / 180));
    el.setAttribute('cy', C + r * Math.sin((deg * Math.PI) / 180));
  };
  const render = (s) => {
    const f = clamp((target - min) / (max - min), 0, 1);
    prog.style.strokeDasharray = `${f * 100} 100`;
    placeAt(knob, f);
    if (s.current != null) placeAt(curDot, clamp((s.current - min) / (max - min), 0, 1), R - 14);
    root.querySelector('.dial-target b').textContent = fmtNum(target, step < 1 ? 1 : 0);
    svg.setAttribute('aria-valuenow', target);
  };
  const fromPointer = (e) => {
    const r = svg.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * 260 - C;
    const y = ((e.clientY - r.top) / r.height) * 260 - C;
    let deg = (Math.atan2(y, x) * 180) / Math.PI;
    let rel = (deg - 135 + 720) % 360;
    if (rel > 270) rel = rel > 315 ? 0 : 270;
    return clamp(round(min + (rel / 270) * (max - min), step), min, max);
  };
  const commit = (final) => {
    if (final) hub.setThrottled(id, { target }, { final: true });
    else hub.setThrottled(id, { target });
  };
  svg.addEventListener('pointerdown', (e) => {
    dragging = true;
    svg.setPointerCapture(e.pointerId);
    root.classList.add('dragging');
    const v = fromPointer(e);
    if (v !== target) { target = v; render(store.device(id).state); commit(false); }
  });
  svg.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const v = fromPointer(e);
    if (v !== target) { target = v; haptic(3); render(store.device(id).state); commit(false); }
  });
  const end = () => { if (dragging) { dragging = false; root.classList.remove('dragging'); commit(true); } };
  svg.addEventListener('pointerup', end);
  svg.addEventListener('pointercancel', end);
  svg.addEventListener('keydown', (e) => {
    const dv = { ArrowUp: step, ArrowRight: step, ArrowDown: -step, ArrowLeft: -step }[e.key];
    if (!dv) return;
    e.preventDefault();
    target = clamp(target + dv, min, max);
    render(store.device(id).state);
    commit(true);
  });
  root.querySelectorAll('[data-step]').forEach((b) => b.addEventListener('click', () => {
    haptic(6);
    target = clamp(round(target + step * +b.dataset.step, step), min, max);
    render(store.device(id).state);
    commit(true);
  }));
  const seg = segmented(root.querySelector('.seg'), d.state.mode, (m) => hub.set(id, { mode: m }));

  const update = (d) => {
    const s = d.state;
    if (!dragging && s.target != null) target = s.target;
    const mode = s.mode || 'off';
    root.dataset.mode = mode;
    root.querySelector('.dial-mode').innerHTML = `${icon(MODE_IC[mode] || 'auto')} ${esc(MODE_LABEL[mode] || mode)}`;
    root.querySelector('.dial-now').textContent = s.current != null ? `Now ${fmtNum(s.current, 1)}°` : '';
    root.querySelector('.st-cur').textContent = s.current != null ? `${fmtNum(s.current, 1)}°` : '–';
    root.querySelector('.st-hum').textContent = s.humidity != null ? `${Math.round(s.humidity)}%` : '–';
    seg.set(mode);
    render(s);
    root.querySelector('.hist-slot').innerHTML = historyCard(d, 'Temperature', (v) => `${fmtNum(v, 1)}°`);
  };
  update(d);
  return { update };
}

function buildLock(d, root) {
  const id = d.id;
  root.innerHTML = `
    <div class="ctl-hero col">
      <button class="lock-btn" aria-label="Lock or unlock">
        <svg class="lock-ring" viewBox="0 0 200 200" aria-hidden="true"><circle cx="100" cy="100" r="92" pathLength="100"/></svg>
        <span class="lock-ic"></span>
      </button>
      <p class="hero-caption"></p>
      <p class="muted small lock-hint"></p>
    </div>
    ${d.state.battery != null ? `<div class="stat-row"><div class="stat"><span class="muted">Battery</span><b class="bat"></b></div><div class="stat"><span class="muted">Last change</span><b class="lc">–</b></div></div>` : ''}`;
  const btn = root.querySelector('.lock-btn');
  let holdTimer = null;
  let suppressUntil = 0; // ignore the click that ends a successful hold
  const HOLD = 800;
  const cancel = () => {
    clearTimeout(holdTimer);
    holdTimer = null;
    btn.classList.remove('holding');
  };
  btn.addEventListener('pointerdown', () => {
    const s = store.device(id).state;
    if (!s.locked) return; // locking happens on click
    btn.classList.add('holding');
    haptic(5);
    holdTimer = setTimeout(() => {
      btn.classList.remove('holding');
      holdTimer = null;
      suppressUntil = Date.now() + 700;
      haptic([10, 40, 20]);
      hub.set(id, { locked: false });
    }, HOLD);
  });
  ['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => btn.addEventListener(ev, cancel));
  btn.addEventListener('click', () => {
    if (Date.now() < suppressUntil) return;
    const s = store.device(id).state;
    if (!s.locked) {
      haptic(15);
      hub.set(id, { locked: true });
    }
  });
  btn.addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && store.device(id).state.locked) {
      e.preventDefault();
      confirmDialog({ title: `Unlock ${d.name}?`, confirm: 'Unlock', danger: true }).then((ok) => ok && hub.set(id, { locked: false }));
    }
  });
  let lastLocked = d.state.locked;
  const update = (d) => {
    const s = d.state;
    root.classList.toggle('unlocked', !s.locked);
    root.querySelector('.lock-ic').innerHTML = icon(s.locked ? 'lock' : 'unlock');
    root.querySelector('.hero-caption').textContent = s.jammed ? 'Jammed' : s.locked ? 'Locked' : 'Unlocked';
    root.querySelector('.lock-hint').textContent = s.locked ? 'Press and hold to unlock' : 'Tap to lock';
    if (s.locked !== lastLocked) {
      lastLocked = s.locked;
      btn.classList.remove('pop');
      void btn.offsetWidth;
      btn.classList.add('pop');
      const lc = root.querySelector('.lc');
      if (lc) lc.textContent = 'Just now';
    }
    const bat = root.querySelector('.bat');
    if (bat) bat.textContent = `${Math.round(s.battery)}%`;
  };
  update(d);
  return { update };
}

function buildCover(d, root) {
  const id = d.id;
  const garage = d.attrs.deviceClass === 'garage';
  root.innerHTML = `
    <div class="ctl-hero">
      <div class="window ${garage ? 'garage' : ''}" role="slider" tabindex="0" aria-label="Position" aria-valuemin="0" aria-valuemax="100">
        <div class="win-sky"><span class="sun"></span></div>
        <div class="win-blind"><span class="win-bar"></span></div>
        <div class="win-val"></div>
      </div>
    </div>
    <div class="ctl-row center gap">
      <button class="pill-btn" data-pos="100">${icon('chevronUp')}<span>Open</span></button>
      <button class="pill-btn" data-cmd="stop">${icon('stop')}<span>Stop</span></button>
      <button class="pill-btn" data-pos="0">${icon('chevronDown')}<span>Close</span></button>
    </div>
    ${d.attrs.positionable !== false && !garage ? `<div class="presets center">${[25, 50, 75].map((p) => `<button class="chip sm" data-pos="${p}">${p}%</button>`).join('')}</div>` : ''}`;
  const win = root.querySelector('.window');
  let pos = d.state.position ?? 0;
  let dragging = false, startY = 0, startP = 0, moved = false;
  const render = () => {
    win.style.setProperty('--p', pos / 100);
    root.querySelector('.win-val').textContent = `${Math.round(pos)}%`;
    win.setAttribute('aria-valuenow', Math.round(pos));
  };
  win.addEventListener('pointerdown', (e) => {
    if (d.attrs.positionable === false) return;
    dragging = true; moved = false; startY = e.clientY; startP = pos;
    win.setPointerCapture(e.pointerId);
    win.classList.add('drag');
  });
  win.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    if (Math.abs(e.clientY - startY) > 3) moved = true;
    pos = clamp(Math.round(startP - ((e.clientY - startY) / win.clientHeight) * 100), 0, 100);
    render();
  });
  const end = () => {
    if (!dragging) return;
    dragging = false;
    win.classList.remove('drag');
    if (moved) hub.set(id, { position: pos });
  };
  win.addEventListener('pointerup', end);
  win.addEventListener('pointercancel', end);
  win.addEventListener('keydown', (e) => {
    const dv = { ArrowUp: 10, ArrowDown: -10 }[e.key];
    if (!dv) return;
    e.preventDefault();
    pos = clamp(pos + dv, 0, 100);
    render();
    hub.set(id, { position: pos });
  });
  root.querySelectorAll('[data-pos]').forEach((b) => b.addEventListener('click', () => {
    haptic(8);
    hub.set(id, { position: +b.dataset.pos });
  }));
  root.querySelector('[data-cmd="stop"]').addEventListener('click', () => { haptic(8); hub.command(id, 'stop'); });
  const update = (d) => {
    if (!dragging) pos = d.state.position ?? 0;
    root.classList.toggle('moving', !!d.state.moving);
    render();
  };
  update(d);
  return { update };
}

function buildFan(d, root) {
  const id = d.id;
  root.innerHTML = `
    <div class="ctl-hero light-hero">
      <div class="hero-slot"></div>
      <div class="hero-side">
        <div class="fan-spin">${icon('fan')}</div>
        <button class="round-btn" data-a="power" aria-label="Toggle power">${icon('power')}</button>
      </div>
    </div>
    <div class="presets center">${[['Low', 25], ['Medium', 50], ['High', 75], ['Max', 100]].map(([n, v]) => `<button class="chip sm" data-sp="${v}">${n}</button>`).join('')}</div>`;
  const vs = vslider({
    value: d.state.on ? d.state.speed ?? 50 : 0, label: 'Speed', iconName: 'air',
    onInput: (v) => hub.setThrottled(id, v > 0 ? { on: true, speed: v } : { on: false }),
    onChange: (v) => hub.setThrottled(id, v > 0 ? { on: true, speed: v } : { on: false }, { final: true }),
  });
  root.querySelector('.hero-slot').appendChild(vs.el);
  root.querySelector('[data-a="power"]').addEventListener('click', () => { haptic(10); hub.set(id, { on: !store.device(id).state.on }); });
  root.querySelectorAll('[data-sp]').forEach((b) => b.addEventListener('click', () => { haptic(6); hub.set(id, { on: true, speed: +b.dataset.sp }); }));
  const update = (d) => {
    const s = d.state;
    vs.set(s.on ? s.speed ?? 50 : 0);
    root.querySelector('[data-a="power"]').classList.toggle('on', !!s.on);
    const sp = s.on ? s.speed ?? 50 : 0;
    root.style.setProperty('--spin', sp ? `${(2.2 - (sp / 100) * 1.9).toFixed(2)}s` : '0s');
    root.classList.toggle('spinning', sp > 0);
    root.querySelectorAll('[data-sp]').forEach((b) => b.classList.toggle('on', s.on && Math.abs(sp - b.dataset.sp) < 5));
  };
  update(d);
  return { update };
}

function buildMedia(d, root) {
  const id = d.id;
  if (d.attrs.volumeOnly) return buildSpeakerVolume(d, root);
  root.innerHTML = `
    <div class="media-card">
      <div class="art"><div class="art-img"></div><div class="eq"><i></i><i></i><i></i><i></i><i></i></div></div>
      <div class="media-meta"><b class="m-title"></b><span class="m-artist muted"></span></div>
      <div class="media-ctl">
        <button class="round-btn ghost" data-cmd="prev" aria-label="Previous">${icon('prev')}</button>
        <button class="play-btn" data-a="play" aria-label="Play or pause"></button>
        <button class="round-btn ghost" data-cmd="next" aria-label="Next">${icon('next')}</button>
      </div>
      <div class="vol-row">${icon('volume')}<input type="range" class="range vol" min="0" max="100" step="1" aria-label="Volume"><b class="vol-v"></b></div>
    </div>
    <div class="ctl-row center"><button class="pill-btn" data-a="power">${icon('power')}<span class="pw-l"></span></button></div>`;
  root.querySelector('[data-a="play"]').addEventListener('click', () => {
    haptic(10);
    const s = store.device(id).state;
    hub.set(id, { playing: !s.playing, on: true });
  });
  root.querySelectorAll('[data-cmd]').forEach((b) => b.addEventListener('click', () => { haptic(6); hub.command(id, b.dataset.cmd); }));
  root.querySelector('[data-a="power"]').addEventListener('click', () => {
    const s = store.device(id).state;
    hub.set(id, s.on === false ? { on: true } : { on: false, playing: false });
  });
  const vol = root.querySelector('.vol');
  vol.addEventListener('input', () => {
    root.querySelector('.vol-v').textContent = vol.value;
    vol.style.setProperty('--f', vol.value / 100);
    hub.setThrottled(id, { volume: +vol.value });
  });
  vol.addEventListener('change', () => hub.setThrottled(id, { volume: +vol.value }, { final: true }));
  const update = (d) => {
    const s = d.state;
    root.classList.toggle('playing', !!s.playing);
    root.classList.toggle('off', s.on === false);
    root.querySelector('.m-title').textContent = s.on === false ? 'Off' : s.title || (s.playing ? 'Playing' : 'Nothing playing');
    root.querySelector('.m-artist').textContent = s.on === false ? '' : s.artist || s.source || '';
    root.querySelector('.play-btn').innerHTML = icon(s.playing ? 'pause' : 'play');
    root.querySelector('.pw-l').textContent = s.on === false ? 'Turn on' : 'Turn off';
    const art = root.querySelector('.art-img');
    if (s.art) art.style.backgroundImage = `url("${s.art.replace(/"/g, '%22')}")`;
    else art.style.backgroundImage = '';
    art.classList.toggle('has-img', !!s.art);
    art.dataset.letter = (s.title || d.name).slice(0, 1).toUpperCase();
    if (document.activeElement !== vol && s.volume != null) {
      vol.value = s.volume;
      vol.style.setProperty('--f', s.volume / 100);
      root.querySelector('.vol-v').textContent = Math.round(s.volume);
    }
  };
  update(d);
  return { update };
}

/** Speakers where only the volume can be controlled (e.g. Google Nest via the Home APIs). */
function buildSpeakerVolume(d, root) {
  const id = d.id;
  root.innerHTML = `
    <div class="ctl-hero light-hero">
      <div class="hero-slot"></div>
      <div class="hero-side"><div class="fan-spin">${icon('speaker')}</div></div>
    </div>
    <div class="note">${icon('info')}<span>Google lets apps change the volume of Nest speakers. To play music on it, use the <b>Music</b> tab and pick this speaker under “Play on”.</span></div>
    <div class="ctl-row center"><a class="pill-btn" href="#/music">${icon('music')}<span>Open Music</span></a></div>`;
  const vs = vslider({
    value: d.state.volume ?? 0, label: 'Volume', iconName: 'volume',
    onInput: (v) => hub.setThrottled(id, { volume: v }),
    onChange: (v) => hub.setThrottled(id, { volume: v }, { final: true }),
  });
  root.querySelector('.hero-slot').appendChild(vs.el);
  const update = (d) => vs.set(d.state.volume ?? 0);
  return { update };
}

function buildVacuum(d, root) {
  const id = d.id;
  root.innerHTML = `
    <div class="ctl-hero">
      <div class="floor"><div class="robot"><span></span></div><div class="dock"></div></div>
    </div>
    <div class="stat-row"><div class="stat"><span class="muted">Status</span><b class="vs-st"></b></div><div class="stat"><span class="muted">Battery</span><b class="vs-bat"></b><div class="batbar"><i></i></div></div></div>
    <div class="ctl-row center gap">
      <button class="pill-btn" data-cmd="start">${icon('play')}<span>Clean</span></button>
      <button class="pill-btn" data-cmd="pause">${icon('pause')}<span>Pause</span></button>
      <button class="pill-btn" data-cmd="dock">${icon('home')}<span>Dock</span></button>
    </div>`;
  root.querySelectorAll('[data-cmd]').forEach((b) => b.addEventListener('click', () => { haptic(8); hub.command(id, b.dataset.cmd); }));
  const update = (d) => {
    const s = d.state;
    root.dataset.status = s.status;
    root.querySelector('.vs-st').textContent = statusText(d).split(' · ')[0];
    root.querySelector('.vs-bat').textContent = s.battery != null ? `${Math.round(s.battery)}%` : '–';
    root.style.setProperty('--bat', (s.battery ?? 0) / 100);
  };
  update(d);
  return { update };
}

function buildSensor(d, root) {
  const k = sensorKind(d.state);
  root.innerHTML = `
    <div class="ctl-hero col sensor-hero">
      <div class="sensor-orb"><span class="so-ic">${icon(k.icon)}</span></div>
      <div class="sensor-val"></div>
      <p class="muted">${esc(k.label)}</p>
    </div>
    ${k.binary ? '' : '<div class="hist-slot"></div>'}`;
  const update = (d) => {
    root.querySelector('.sensor-val').textContent = sensorText(d.state);
    root.classList.toggle('alert', !!(k.binary && d.state.value));
    const h = root.querySelector('.hist-slot');
    if (h) h.innerHTML = historyCard(d, 'History', (v) => sensorText({ ...d.state, value: v }));
  };
  update(d);
  return { update };
}


const APP_COLORS = { Netflix: '#e50914', YouTube: '#ff0000', 'Prime Video': '#00a8e1', 'Disney+': '#113ccf', Spotify: '#1ed760', 'Apple TV': '#222', Videoland: '#ff0b4d', 'NPO Start': '#ff6d00', Plex: '#e5a00d', Twitch: '#9146ff' };
const appColor = (name) => APP_COLORS[name] || `hsl(${[...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7)} 55% 42%)`;

function buildTv(d, root) {
  const id = d.id;
  const key = (k) => { haptic(6); hub.command(id, 'key', k); };
  root.innerHTML = `
    <div class="ctl-hero col">
      ${powerOrb(d.state.on, 'TV power')}
      <p class="hero-caption"></p>
      <p class="muted small tv-hint"></p>
    </div>
    <div class="tv-remote">
      <div class="tv-side">
        <button class="tv-key" data-k="KEY_VOLUP" aria-label="Volume up">${icon('plus')}</button>
        <span class="tv-lbl">VOL</span>
        <button class="tv-key" data-k="KEY_VOLDOWN" aria-label="Volume down">${icon('minus')}</button>
      </div>
      <div class="dpad">
        <button class="dp-k up" data-k="KEY_UP" aria-label="Up">${icon('chevronUp')}</button>
        <button class="dp-k left" data-k="KEY_LEFT" aria-label="Left">${icon('chevronLeft')}</button>
        <button class="dp-ok" data-k="KEY_ENTER" aria-label="OK">OK</button>
        <button class="dp-k right" data-k="KEY_RIGHT" aria-label="Right">${icon('chevronRight')}</button>
        <button class="dp-k down" data-k="KEY_DOWN" aria-label="Down">${icon('chevronDown')}</button>
      </div>
      <div class="tv-side">
        <button class="tv-key" data-k="KEY_CHUP" aria-label="Channel up">${icon('chevronUp')}</button>
        <span class="tv-lbl">CH</span>
        <button class="tv-key" data-k="KEY_CHDOWN" aria-label="Channel down">${icon('chevronDown')}</button>
      </div>
    </div>
    <div class="tv-row">
      <button class="tv-pill" data-k="KEY_RETURN">${icon('chevronLeft')}<span>Back</span></button>
      <button class="tv-pill" data-k="KEY_HOME">${icon('home')}<span>Home</span></button>
      <button class="tv-pill" data-k="KEY_PLAY">${icon('play')}<span>Play</span></button>
      <button class="tv-pill" data-k="KEY_PAUSE">${icon('pause')}<span>Pause</span></button>
      <button class="tv-pill" data-k="KEY_MUTE">${icon('volume')}<span>Mute</span></button>
      <button class="tv-pill" data-k="KEY_SOURCE">${icon('layers')}<span>Source</span></button>
    </div>
    <div class="ctl-card">
      <div class="card-head"><h4>Apps</h4><button class="link" data-a="reload-apps">${icon('refresh')} Refresh</button></div>
      <div class="tv-apps"></div>
      <p class="muted small tv-icon-info"></p>
    </div>`;

  root.querySelector('[data-a="power"]').addEventListener('click', () => {
    haptic(12);
    const s = store.device(id).state;
    hub.set(id, { on: !(s.on || s.pending === 'on') });
  });
  root.addEventListener('click', (e) => {
    const k = e.target.closest('[data-k]');
    if (k) {
      k.classList.remove('hit'); void k.offsetWidth; k.classList.add('hit');
      key(k.dataset.k);
    }
    const app = e.target.closest('[data-app]');
    if (app) {
      haptic([8, 30, 8]);
      app.classList.add('launching');
      setTimeout(() => app.classList.remove('launching'), 900);
      hub.command(id, 'launch', app.dataset.app);
      toast(`Opening ${app.dataset.name}`, { icon: 'tv' });
    }
    if (e.target.closest('[data-a="reload-apps"]')) hub.command(id, 'apps');
  });

  const update = (d) => {
    const s = d.state;
    const on = !!s.on;
    const starting = s.pending === 'on' && !on;
    root.classList.toggle('tv-off', !on);
    const orb = root.querySelector('.orb');
    orb.classList.toggle('on', on);
    orb.classList.toggle('starting', starting);
    root.querySelector('.hero-caption').textContent = starting ? 'Turning on…' : on ? 'On' : 'Off';
    root.querySelector('.tv-hint').textContent = starting ? 'This can take up to 15 seconds' : on ? '' : (d.attrs.mac ? 'Tap to turn on' : 'Turn the TV on with its remote once so Smart Dash learns how to wake it');
    const apps = d.attrs.apps?.length ? d.attrs.apps : COMMON_APPS;
    const sig = apps.map((a) => a.appId).join() + (d.attrs.iconsVersion || '');
    const grid = root.querySelector('.tv-apps');
    if (grid.dataset.sig !== sig) {
      grid.dataset.sig = sig;
      const pinned = COMMON_APPS.map((c) => c.name);
      const sorted = [...apps].sort((a, b) => (pinned.indexOf(a.name) + 1 || 99) - (pinned.indexOf(b.name) + 1 || 99) || a.name.localeCompare(b.name));
      grid.innerHTML = sorted.map((a, i) => `<button class="tv-app" data-app="${esc(a.appId)}" data-name="${esc(a.name)}" style="--c:${appColor(a.name)};--i:${i}">
        ${tvIcon(a.appId) ? `<span class="tv-app-ic has-img"><img src="${tvIcon(a.appId)}" alt=""></span>`
          : `<span class="tv-app-ic ${brandIcon(a.name) ? 'has-logo' : ''}"><em>${esc(a.name.replace(/[^A-Za-z0-9+]/g, '').slice(0, 2) || '?')}</em>${brandIcon(a.name) ? `<img src="${brandIcon(a.name)}" alt="" loading="lazy" onerror="this.parentNode.classList.remove('has-logo');this.remove()">` : ''}</span>`}<span class="tv-app-n">${esc(a.name)}</span></button>`).join('');
      const info = root.querySelector('.tv-icon-info');
      if (info) {
        const fromTv = apps.filter((a) => tvIcon(a.appId)).length;
        info.textContent = !d.attrs.apps?.length ? 'The TV hasn’t shared its app list yet — showing popular apps. Tap Refresh while the TV is on.'
          : fromTv === apps.length ? ''
          : iconInfo.withPath === 0 && iconInfo.total ? 'Your TV doesn’t share app icons, so logos come from the web where known.'
          : iconInfo.failed ? `Icons from the TV: ${fromTv} of ${apps.length}. Last problem: ${iconInfo.lastError}.`
          : '';
      }
    }
  };
  update(d);
  return { update };
}

const BUILDERS = {
  light: buildLight, switch: buildSwitch, outlet: buildSwitch, thermostat: buildThermostat,
  lock: buildLock, cover: buildCover, fan: buildFan, media: buildMedia, tv: buildTv, vacuum: buildVacuum, sensor: buildSensor,
};

/* ============ Device settings ============ */

function settingsHTML(d) {
  const integ = INTEGRATIONS[d.integration];
  const rooms = store.state.rooms;
  return `<div class="ctl-card dev-settings">
    <div class="card-head"><h4>Device</h4></div>
    <button class="row" data-a="rename">${icon('edit')}<span>Name</span><b class="row-v">${esc(d.name)}</b>${icon('chevronRight', 'chev')}</button>
    <label class="row">${icon('home')}<span>Room</span>
      <select class="row-select" data-a="room">
        <option value="">No room</option>
        ${rooms.map((r) => `<option value="${esc(r.id)}" ${r.id === d.roomId ? 'selected' : ''}>${esc(r.name)}</option>`).join('')}
        <option value="__new">+ New room…</option>
      </select>${icon('chevronDown', 'chev')}</label>
    <button class="row" data-a="fav">${icon('star')}<span>Favourite</span><span class="tgl sm ${d.favorite ? 'on' : ''}"><i></i></span></button>
    <button class="row" data-a="hide">${icon('eye')}<span>Show on dashboard</span><span class="tgl sm ${d.hidden ? '' : 'on'}"><i></i></span></button>
    <p class="meta">${icon(integ?.icon || 'link')} Connected via ${esc(integ?.name || d.integration)}${d.attrs.entityId ? ` · <code>${esc(d.attrs.entityId)}</code>` : ''}</p>
  </div>`;
}

function wireSettings(d, el, sheet) {
  const id = d.id;
  el.addEventListener('click', async (e) => {
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (a === 'rename') {
      const cur = store.device(id);
      const name = await promptDialog({ title: 'Rename device', label: 'Name', value: cur.name });
      if (name) {
        store.override(id, { name });
        el.querySelector('.row-v').textContent = name;
      }
    } else if (a === 'fav') {
      const fav = !store.device(id).favorite;
      store.override(id, { favorite: fav || undefined });
      el.querySelector('[data-a="fav"] .tgl').classList.toggle('on', fav);
      haptic(6);
      toast(fav ? 'Added to favourites' : 'Removed from favourites', { icon: 'star' });
    } else if (a === 'hide') {
      const hidden = !store.device(id).hidden;
      store.override(id, { hidden: hidden || undefined });
      el.querySelector('[data-a="hide"] .tgl').classList.toggle('on', !hidden);
      if (hidden) toast('Hidden from dashboard', { icon: 'eye', detail: 'Show it again from Settings → Hidden devices' });
    }
  });
  el.querySelector('[data-a="room"]').addEventListener('change', async (e) => {
    let v = e.target.value;
    if (v === '__new') {
      const name = await promptDialog({ title: 'New room', label: 'Room name', placeholder: 'e.g. Living Room', confirm: 'Create' });
      if (!name) { e.target.value = store.device(id).roomId || ''; return; }
      v = store.ensureRoom(name);
      const opt = document.createElement('option');
      opt.value = v;
      opt.textContent = name;
      e.target.insertBefore(opt, e.target.lastElementChild);
      e.target.value = v;
    }
    store.override(id, { roomId: v || null });
  });
}

/* ============ Entry point ============ */

export function openDevice(id) {
  const d = store.device(id);
  if (!d) return;
  const subtitle = (d) => `${store.room(d.roomId)?.name || 'No room'} · ${d.attrs?.available === false ? 'Unavailable' : statusText(d)}`;
  const cleanups = [];
  const body = document.createElement('div');
  body.className = 'detail';
  const ctlEl = document.createElement('div');
  ctlEl.className = `ctl t-${d.type}`;
  body.appendChild(ctlEl);
  const sheet = openSheet({
    title: d.name,
    subtitle: subtitle(d),
    body,
    className: 'device-sheet',
    accent: glowColor(d),
    headerExtra: `<span class="sheet-ic">${icon(devIcon(d))}</span>`,
    onClose: () => cleanups.forEach((f) => f()),
  });
  const ctl = (BUILDERS[d.type] || buildSwitch)(d, ctlEl);
  const set = document.createElement('div');
  set.innerHTML = settingsHTML(d);
  const setEl = set.firstElementChild;
  body.appendChild(setEl);
  wireSettings(d, setEl, sheet);

  cleanups.push(store.on('device', (did) => {
    if (did !== id) return;
    const nd = store.device(id);
    if (!nd) return;
    sheet.el.style.setProperty('--sheet-accent', glowColor(nd));
    sheet.setTitle(nd.name, subtitle(nd));
    sheet.el.querySelector('.sheet-ic').innerHTML = icon(devIcon(nd));
    ctl.update(nd);
  }));
  cleanups.push(store.on('energy', () => {
    const nd = store.device(id);
    if (nd && ['sensor', 'thermostat', 'outlet', 'switch'].includes(nd.type)) ctl.update(nd);
  }));
  cleanups.push(store.on('structure', () => { if (!store.device(id)) sheet.close(); }));
  return sheet;
}
