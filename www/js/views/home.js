import { icon } from '../icons.js';
import { esc, fmtNum, relTime } from '../util.js';
import { store } from '../store.js';
import { hub } from '../hub.js';
import { cardHTML } from '../cards.js';
import { totalWatts, todayKWh } from '../energy.js';
import { countTo, haptic, ripple } from '../ui.js';
import { openConnect } from '../connect.js';
import { openPalette } from '../palette.js';
import { setDeviceFilter } from './devices.js';

let roomFilter = null; // null = auto (favourites if any, else all)

function greeting() {
  const h = new Date().getHours();
  if (h < 5) return 'Good night';
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

function summary() {
  const devs = store.devices();
  const lights = devs.filter((d) => d.type === 'light');
  const on = lights.filter((d) => d.state.on).length;
  const temps = [
    ...devs.filter((d) => d.type === 'thermostat' && typeof d.state.current === 'number').map((d) => d.state.current),
    ...devs.filter((d) => d.type === 'sensor' && d.state.kind === 'temperature' && typeof d.state.value === 'number').map((d) => d.state.value),
  ];
  const avg = temps.length ? temps.reduce((a, b) => a + b, 0) / temps.length : null;
  const th = devs.find((d) => d.type === 'thermostat');
  const locks = devs.filter((d) => d.type === 'lock');
  const unlocked = locks.filter((d) => !d.state.locked).length;
  const open = devs.filter((d) => d.type === 'sensor' && ['door', 'window'].includes(d.state.kind) && d.state.value).length
    + devs.filter((d) => d.type === 'cover' && d.attrs.deviceClass === 'garage' && d.state.position > 0).length;
  const alarms = devs.filter((d) => d.type === 'sensor' && ['smoke', 'moisture'].includes(d.state.kind) && d.state.value).length;
  const secure = !unlocked && !open && !alarms;
  return {
    lights: { on, total: lights.length },
    temp: { avg, th },
    security: { secure, unlocked, open, alarms, any: locks.length > 0 || open > 0 },
    watts: totalWatts(),
    kwh: todayKWh(),
  };
}

function tilesHTML() {
  const s = summary();
  const sec = s.security;
  const secText = sec.alarms ? `${sec.alarms} alert${sec.alarms > 1 ? 's' : ''}` : sec.unlocked ? `${sec.unlocked} unlocked` : sec.open ? `${sec.open} open` : 'Secured';
  return `
    <button class="tile t-light ${s.lights.on ? 'on' : ''}" data-go="light">
      <span class="tile-ic">${icon('bulb')}</span>
      <span class="tile-v"><b data-count="${s.lights.on}">${s.lights.on}</b><small>on</small></span>
      <span class="tile-l">${s.lights.total ? `of ${s.lights.total} lights` : 'No lights yet'}</span>
    </button>
    <button class="tile t-temp" data-go="climate">
      <span class="tile-ic">${icon('thermometer')}</span>
      <span class="tile-v"><b>${s.temp.avg != null ? fmtNum(s.temp.avg, 1) : '–'}</b><small>°</small></span>
      <span class="tile-l">${s.temp.th && s.temp.th.state.mode !== 'off' ? `Target ${fmtNum(s.temp.th.state.target, 1)}°` : 'Inside'}</span>
    </button>
    <button class="tile t-sec ${sec.secure ? 'ok' : 'warn'}" data-go="security">
      <span class="tile-ic">${icon(sec.secure ? 'shield' : 'shieldAlert')}</span>
      <span class="tile-v"><b class="sm">${secText}</b></span>
      <span class="tile-l">Security</span>
    </button>
    <button class="tile t-energy" data-href="#/energy">
      <span class="tile-ic">${icon('bolt')}</span>
      <span class="tile-v"><b class="w-now" data-v="${Math.round(s.watts)}">${fmtNum(s.watts)}</b><small>W</small></span>
      <span class="tile-l">${fmtNum(s.kwh, 1)} kWh today</span>
    </button>`;
}

function sceneChip(sc, i) {
  return `<button class="scene-chip" data-scene="${esc(sc.id)}" style="--a:${sc.gradient?.[0] || 'var(--accent)'};--b:${sc.gradient?.[1] || 'var(--accent-2)'};--i:${i}">
    <span class="sc-ic">${icon(sc.icon)}</span><span>${esc(sc.name)}</span></button>`;
}

function roomsChips(devs) {
  const favs = devs.filter((d) => d.favorite).length;
  const rooms = store.state.rooms.filter((r) => devs.some((d) => d.roomId === r.id));
  const active = currentFilter(devs);
  const chip = (id, label, ic, n) => `<button class="chip ${active === id ? 'on' : ''}" data-room="${esc(id)}">${icon(ic)}<span>${esc(label)}</span>${n != null ? `<em>${n}</em>` : ''}</button>`;
  return [
    favs ? chip('fav', 'Favourites', 'star', favs) : '',
    chip('all', 'All', 'grid', devs.length),
    ...rooms.map((r) => chip(r.id, r.name, r.icon, devs.filter((d) => d.roomId === r.id).length)),
  ].join('');
}

function currentFilter(devs) {
  if (roomFilter === 'fav' && !devs.some((d) => d.favorite)) return 'all';
  if (roomFilter && roomFilter !== 'fav' && roomFilter !== 'all' && !store.room(roomFilter)) return 'all';
  return roomFilter || (devs.some((d) => d.favorite) ? 'fav' : 'all');
}

function gridHTML(devs) {
  const f = currentFilter(devs);
  const roomIdx = (d) => { const i = store.state.rooms.findIndex((r) => r.id === d.roomId); return i < 0 ? 999 : i; };
  const SENSOR_LAST = (d) => (d.type === 'sensor' ? 1 : 0);
  const byRoom = [...devs].sort((a, b) => roomIdx(a) - roomIdx(b) || SENSOR_LAST(a) - SENSOR_LAST(b) || a.name.localeCompare(b.name));
  const list = f === 'fav' ? byRoom.filter((d) => d.favorite) : f === 'all' ? byRoom : byRoom.filter((d) => d.roomId === f);
  return list.map((d, i) => cardHTML(d, { showRoom: f !== 'all' ? f === 'fav' : true, index: i })).join('');
}

function activityHTML() {
  const log = store.state.log.slice(0, 6);
  if (!log.length) return '<li class="muted small empty-line">Things you do will show up here.</li>';
  return log.map((l) => `<li><span class="act-ic">${icon(l.icon)}</span><span class="act-t">${esc(l.text)}</span><time>${relTime(l.t)}</time></li>`).join('');
}

function emptyHTML() {
  return `<div class="empty-hero">
    <div class="orbit big"><span class="o-core">${icon('hub')}</span>
      ${['bulb', 'plug', 'thermometer', 'lock', 'speaker', 'blinds'].map((n, i) => `<span class="o-sat" style="--k:${i}">${icon(n)}</span>`).join('')}</div>
    <h2>Your home, in one place</h2>
    <p class="muted">Connect Home Assistant, Philips Hue, Shelly or any HTTP device to start controlling everything from here.</p>
    <div class="btn-row center"><button class="btn primary lg" data-act="add">${icon('plus')}<span>Connect devices</span></button>
    <button class="btn ghost lg" data-act="demo">${icon('sparkles')}<span>Try the demo home</span></button></div>
  </div>`;
}

export function render(root) {
  const devs = store.devices();
  const name = store.state.settings.name;
  const date = new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
  root.innerHTML = `
    <header class="page-head">
      <div>
        <p class="eyebrow">${esc(date)}</p>
        <h1 class="title">${greeting()}${name ? `, <span class="grad">${esc(name)}</span>` : ''}</h1>
      </div>
      <div class="head-actions">
        <button class="icon-btn" data-act="search" aria-label="Search (Ctrl K)">${icon('search')}</button>
        <button class="icon-btn accent" data-act="add" aria-label="Connect devices">${icon('plus')}</button>
      </div>
    </header>
    ${devs.length ? `
    <section class="tiles stagger" id="tiles">${tilesHTML()}</section>
    ${store.state.scenes.length ? `<section class="section">
      <div class="section-head"><h2>Scenes</h2><a href="#/scenes" class="link">All scenes ${icon('chevronRight')}</a></div>
      <div class="scene-strip hscroll">${store.state.scenes.map(sceneChip).join('')}</div>
    </section>` : ''}
    <section class="section">
      <div class="section-head"><h2>Devices</h2><a href="#/devices" class="link">Manage ${icon('chevronRight')}</a></div>
      <div class="chips hscroll" id="room-chips">${roomsChips(devs)}</div>
      <div class="grid" id="home-grid">${gridHTML(devs)}</div>
    </section>
    <section class="section">
      <div class="section-head"><h2>Activity</h2></div>
      <ul class="activity" id="activity">${activityHTML()}</ul>
    </section>` : emptyHTML()}`;

  const onClick = (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'search') openPalette();
    if (act === 'add') openConnect();
    if (act === 'demo') hub.enable('demo').catch(() => {});
    const chip = e.target.closest('[data-room]');
    if (chip) {
      roomFilter = chip.dataset.room;
      haptic(5);
      root.querySelectorAll('#room-chips .chip').forEach((c) => c.classList.toggle('on', c === chip));
      const g = root.querySelector('#home-grid');
      g.innerHTML = gridHTML(store.devices());
      g.classList.remove('reflow');
      void g.offsetWidth;
      g.classList.add('reflow');
    }
    const sc = e.target.closest('[data-scene]');
    if (sc) {
      ripple(e, sc);
      haptic([8, 30, 8]);
      sc.classList.add('fired');
      setTimeout(() => sc.classList.remove('fired'), 900);
      hub.runScene(sc.dataset.scene);
    }
    const tile = e.target.closest('.tile');
    if (tile) {
      if (tile.dataset.href) location.hash = tile.dataset.href;
      else { setDeviceFilter(tile.dataset.go); location.hash = '#/devices'; }
    }
  };
  root.addEventListener('click', onClick);

  const refreshTiles = () => {
    const t = root.querySelector('#tiles');
    if (!t) return;
    const prevW = t.querySelector('.w-now');
    const from = prevW ? +prevW.dataset.v : 0;
    t.innerHTML = tilesHTML();
    const w = t.querySelector('.w-now');
    if (w) {
      const to = +w.dataset.v;
      w.dataset.v = from;
      countTo(w, to);
    }
  };
  let tilesQueued = false;
  const queueTiles = () => {
    if (tilesQueued) return;
    tilesQueued = true;
    requestAnimationFrame(() => { tilesQueued = false; refreshTiles(); });
  };
  const offs = [
    store.on('device', queueTiles),
    store.on('energy', queueTiles),
    store.on('log', () => { const a = root.querySelector('#activity'); if (a) a.innerHTML = activityHTML(); }),
  ];
  const timer = setInterval(() => { const a = root.querySelector('#activity'); if (a) a.innerHTML = activityHTML(); }, 30000);
  return () => {
    root.removeEventListener('click', onClick);
    offs.forEach((f) => f());
    clearInterval(timer);
  };
}
