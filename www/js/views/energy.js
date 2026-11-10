import { icon } from '../icons.js';
import { esc, fmtNum, fmtPower } from '../util.js';
import { store } from '../store.js';
import { devIcon } from '../devices.js';
import { live, last24, todayKWh, breakdown, totalWatts } from '../energy.js';
import { countTo } from '../ui.js';
import { openDevice } from '../detail.js';

const W = 640, H = 200, PAD_L = 34, PAD_B = 22, PAD_T = 10;

function niceMax(v) {
  if (v <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
}

function barsSVG(data, grow = false) {
  const max = niceMax(Math.max(...data.map((d) => d.kwh), 0.1));
  const iw = W - PAD_L - 4, ih = H - PAD_B - PAD_T;
  const slot = iw / data.length;
  const bw = Math.max(4, slot - 4);
  const grid = [0, 0.5, 1].map((f) => {
    const y = PAD_T + ih - f * ih;
    return `<line x1="${PAD_L}" x2="${W}" y1="${y}" y2="${y}" class="gl"/><text x="${PAD_L - 6}" y="${y + 4}" class="ax" text-anchor="end">${fmtNum(max * f, max < 10 ? 1 : 0)}</text>`;
  }).join('');
  const bars = data.map((d, i) => {
    const h = Math.max(d.kwh > 0 ? 3 : 0, (d.kwh / max) * ih);
    const x = PAD_L + i * slot + (slot - bw) / 2;
    const y = PAD_T + ih - h;
    const r = Math.min(4, bw / 2, h);
    const path = h > 0 ? `M${x},${y + h} V${y + r} Q${x},${y} ${x + r},${y} H${x + bw - r} Q${x + bw},${y} ${x + bw},${y + r} V${y + h} Z` : '';
    const label = d.hour % 6 === 0 ? `<text x="${x + bw / 2}" y="${H - 6}" class="ax" text-anchor="middle">${String(d.hour).padStart(2, '0')}:00</text>` : '';
    return `<g class="bar ${d.current ? 'cur' : ''}" data-i="${i}">
      <rect class="hit" x="${PAD_L + i * slot}" y="${PAD_T}" width="${slot}" height="${ih}" fill="transparent"/>
      ${path ? `<path d="${path}" style="--i:${i}"/>` : ''}${label}</g>`;
  }).join('');
  return `<svg viewBox="0 0 ${W} ${H}" class="chart bars ${grow ? 'grow' : ''}" role="img" aria-label="Energy use per hour, last 24 hours">${grid}${bars}</svg>`;
}

function lineSVG(points) {
  const w = W, h = 120;
  if (points.length < 2) return '';
  const vs = points.map((p) => p.w);
  const max = niceMax(Math.max(...vs) * 1.1);
  const t0 = points[0].t, t1 = points[points.length - 1].t;
  const x = (t) => ((t - t0) / Math.max(1, t1 - t0)) * (w - 8) + 4;
  const y = (v) => h - 8 - (v / max) * (h - 20);
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(p.w).toFixed(1)}`).join(' ');
  const lp = points[points.length - 1];
  return `<svg viewBox="0 0 ${w} ${h}" class="chart line" preserveAspectRatio="none" role="img" aria-label="Live power, last ${Math.round((t1 - t0) / 60000) || 1} minutes">
    <defs><linearGradient id="lgE" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--accent)" stop-opacity=".32"/><stop offset="1" stop-color="var(--accent)" stop-opacity="0"/></linearGradient></defs>
    <line x1="0" x2="${w}" y1="${y(max / 2)}" y2="${y(max / 2)}" class="gl"/>
    <path d="${d} L${x(t1)},${h} L${x(t0)},${h} Z" fill="url(#lgE)"/>
    <path d="${d}" class="ln" vector-effect="non-scaling-stroke"/>
    <circle cx="${x(lp.t)}" cy="${y(lp.w)}" r="4" class="ln-dot"/>
  </svg>`;
}

function consumersHTML() {
  const list = breakdown().filter((x) => x.w >= 1).slice(0, 8);
  if (!list.length) return '<p class="muted empty-line">Nothing is drawing power right now.</p>';
  const max = list[0].w;
  return list.map(({ d, w }) => `<button class="cons" data-dev="${esc(d.id)}">
      <span class="cons-ic">${icon(devIcon(d))}</span>
      <span class="cons-main"><span class="cons-top"><b>${esc(d.name)}</b><span>${fmtPower(w)}</span></span>
      <span class="cons-bar"><i style="width:${Math.max(2, (w / max) * 100)}%"></i></span></span>
    </button>`).join('');
}

export function render(root) {
  const s = store.state.settings;
  const kwh = todayKWh();
  root.innerHTML = `
    <header class="page-head">
      <div><p class="eyebrow">Estimated from your devices</p><h1 class="title">Energy</h1></div>
    </header>
    <section class="energy-hero">
      <div class="eh-main">
        <span class="muted">Using now</span>
        <div class="eh-big"><b id="e-now" data-v="0">0</b><small>W</small></div>
        <div class="pulse-dot"><i></i>Live</div>
      </div>
      <div class="eh-stats">
        <div class="stat"><span class="muted">Today</span><b id="e-today">${fmtNum(kwh, 2)} kWh</b></div>
        <div class="stat"><span class="muted">Cost today</span><b id="e-cost">${esc(s.currency)}${fmtNum(kwh * s.price, 2)}</b></div>
        <div class="stat"><span class="muted">Projected / month</span><b id="e-month">${esc(s.currency)}${fmtNum(((totalWatts() * 24) / 1000) * 30 * s.price, 0)}</b></div>
      </div>
    </section>
    <section class="ctl-card chart-card">
      <div class="card-head"><h4>Live power</h4><span class="muted small" id="live-range">Last few minutes</span></div>
      <div class="chart-wrap" id="live-chart">${lineSVG(live)}</div>
    </section>
    <section class="ctl-card chart-card">
      <div class="card-head"><h4>Last 24 hours</h4><span class="muted small">kWh per hour</span></div>
      <div class="chart-wrap" id="bars-chart">${barsSVG(last24(), true)}<div class="tip" hidden></div></div>
    </section>
    <section class="ctl-card">
      <div class="card-head"><h4>Top consumers</h4><span class="muted small">right now</span></div>
      <div id="consumers">${consumersHTML()}</div>
    </section>
    <p class="muted small sub-note">${icon('info')} Figures are estimates based on device state and typical wattage, plus real readings from plugs with power metering. Set your electricity price in Settings.</p>`;

  const now = root.querySelector('#e-now');
  countTo(now, Math.round(totalWatts()), { duration: 1200 });

  const bars = root.querySelector('#bars-chart');
  const tip = bars.querySelector('.tip');
  const showTip = (e) => {
    const g = e.target.closest('.bar');
    if (!g) { tip.hidden = true; return; }
    const d = last24()[+g.dataset.i];
    const r = bars.getBoundingClientRect();
    const gr = g.querySelector('.hit').getBoundingClientRect();
    tip.hidden = false;
    tip.innerHTML = `<b>${fmtNum(d.kwh, 2)} kWh</b><span>${String(d.hour).padStart(2, '0')}:00–${String((d.hour + 1) % 24).padStart(2, '0')}:00${d.current ? ' · so far' : ''}</span>`;
    tip.style.left = `${Math.min(r.width - 90, Math.max(60, gr.left - r.left + gr.width / 2))}px`;
    bars.querySelectorAll('.bar').forEach((b) => b.classList.toggle('hl', b === g));
  };
  bars.addEventListener('pointermove', showTip);
  bars.addEventListener('pointerdown', showTip);
  bars.addEventListener('pointerleave', () => { tip.hidden = true; bars.querySelectorAll('.bar.hl').forEach((b) => b.classList.remove('hl')); });

  const onClick = (e) => {
    const c = e.target.closest('[data-dev]');
    if (c) openDevice(c.dataset.dev);
  };
  root.addEventListener('click', onClick);

  const off = store.on('energy', () => {
    const k = todayKWh();
    countTo(now, Math.round(totalWatts()));
    root.querySelector('#e-today').textContent = `${fmtNum(k, 2)} kWh`;
    root.querySelector('#e-cost').textContent = `${s.currency}${fmtNum(k * s.price, 2)}`;
    root.querySelector('#e-month').textContent = `${s.currency}${fmtNum(((totalWatts() * 24) / 1000) * 30 * s.price, 0)}`;
    root.querySelector('#live-chart').innerHTML = lineSVG(live);
    const mins = live.length > 1 ? Math.round((live[live.length - 1].t - live[0].t) / 60000) : 0;
    root.querySelector('#live-range').textContent = mins ? `Last ${mins} min` : 'Just started';
    const svg = bars.querySelector('svg');
    if (tip.hidden) svg.outerHTML = barsSVG(last24());
    root.querySelector('#consumers').innerHTML = consumersHTML();
  });
  return () => { off(); root.removeEventListener('click', onClick); };
}
