// Home — an editorial overview: the time, a sentence about the house, moods, rooms.

import { icon } from '../icons.js';
import { esc, fmtNum, relTime } from '../util.js';
import { store } from '../store.js';
import { hub } from '../hub.js';
import { cardHTML } from '../cards.js';
import { totalWatts } from '../energy.js';
import { haptic } from '../ui.js';
import { openConnect } from '../connect.js';
import { openPalette } from '../palette.js';
import { isActive } from '../devices.js';

const NUM = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve'];
const word = (n) => NUM[n] || String(n);
const toggleable = (d) => ['light', 'switch', 'outlet', 'fan', 'tv'].includes(d.type);

function greeting() {
  const h = new Date().getHours();
  if (h < 5) return 'Good night';
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

/** "9:44" with a small "pm" (or 24-hour time where that's the local habit). */
function clock() {
  const parts = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).formatToParts(new Date());
  const main = parts.filter((p) => p.type !== 'dayPeriod').map((p) => p.value).join('').trim();
  const period = parts.find((p) => p.type === 'dayPeriod')?.value;
  return `${esc(main)}${period ? `<small>${esc(period.toLowerCase())}</small>` : ''}`;
}

/** The house, described in a few calm sentences. */
function summaryHTML() {
  const devs = store.devices();
  if (!devs.length) return '';
  const parts = [];
  const lights = devs.filter((d) => d.type === 'light');
  if (lights.length) {
    const on = lights.filter((d) => d.state.on).length;
    parts.push(on ? `<em>${word(on)}</em> ${on === 1 ? 'light is' : 'lights are'} on.` : 'All lights are <em>off</em>.');
  }
  const th = devs.find((d) => d.type === 'thermostat');
  const temps = [
    ...devs.filter((d) => d.type === 'thermostat' && typeof d.state.current === 'number').map((d) => d.state.current),
    ...devs.filter((d) => d.type === 'sensor' && d.state.kind === 'temperature' && typeof d.state.value === 'number').map((d) => d.state.value),
  ];
  if (temps.length) {
    const avg = temps.reduce((a, b) => a + b, 0) / temps.length;
    let t = `It is <em>${fmtNum(avg, 1)}°</em> inside`;
    if (th && th.state.mode && th.state.mode !== 'off' && th.state.target != null) {
      t += Math.abs(th.state.target - (th.state.current ?? avg)) > 0.3
        ? `, ${th.state.target > (th.state.current ?? avg) ? 'warming' : 'cooling'} to <em>${fmtNum(th.state.target, 1)}°</em>` : '';
    }
    parts.push(t + '.');
  }
  const playing = devs.find((d) => d.type === 'media' && d.state.playing && d.state.title);
  if (playing) parts.push(`<em>${esc(playing.state.title)}</em> is playing in the ${esc(store.room(playing.roomId)?.name?.toLowerCase() || playing.name)}.`);
  const locks = devs.filter((d) => d.type === 'lock');
  const open = devs.filter((d) => (d.type === 'lock' && !d.state.locked) || (d.type === 'sensor' && ['door', 'window'].includes(d.state.kind) && d.state.value));
  const alarms = devs.filter((d) => d.type === 'sensor' && ['smoke', 'moisture'].includes(d.state.kind) && d.state.value);
  if (alarms.length) parts.push(`<em class="warn">${esc(alarms[0].name)}</em> needs attention.`);
  else if (open.length) parts.push(`The <em class="warn">${esc(open[0].name.toLowerCase())}</em> is open.`);
  else if (locks.length) parts.push('The house is <em>secure</em>.');
  const w = totalWatts();
  if (w > 0) parts.push(`Using <em>${fmtNum(w)} W</em>.`);
  return parts.join(' ');
}

function moodsHTML() {
  const scenes = store.state.scenes;
  if (!scenes.length) return '';
  return `<section class="section moods-sec">
      <div class="section-head"><h2>Moods</h2><a href="#/scenes" class="link">Edit</a></div>
      <div class="moods hscroll">${scenes.map((sc, i) => `<button class="mood" data-scene="${esc(sc.id)}" style="--i:${i}">
          <span class="mood-n">${String(i + 1).padStart(2, '0')}</span><span class="mood-name">${esc(sc.name)}</span></button>`).join('')}</div>
    </section>`;
}

function roomCard(r, devs, i) {
  const inRoom = devs.filter((d) => d.roomId === r.id);
  const tg = inRoom.filter(toggleable);
  const on = tg.filter(isActive).length;
  const temp = inRoom.find((d) => d.type === 'thermostat' && d.state.current != null)?.state.current
    ?? inRoom.find((d) => d.type === 'sensor' && d.state.kind === 'temperature')?.state.value;
  const line = [tg.length ? (on ? `${on} of ${tg.length} on` : 'All off') : `${inRoom.length} device${inRoom.length === 1 ? '' : 's'}`, temp != null ? `${fmtNum(temp, 1)}°` : ''].filter(Boolean).join(' · ');
  return `<a class="room-card ${on ? 'lit' : ''}" href="#/room/${esc(r.id)}" style="--i:${i}" data-room-card="${esc(r.id)}">
    <div class="rc-top">
      <span class="rc-ic">${icon(r.icon)}</span>
      ${tg.length ? `<button class="rc-power ${on ? 'on' : ''}" data-room-power="${esc(r.id)}" aria-label="${on ? 'Turn off' : 'Turn on'} ${esc(r.name)}">${icon('power')}</button>` : ''}
    </div>
    <div class="rc-bottom">
      <span class="rc-count">${String(i + 1).padStart(2, '0')}</span>
      <h3 class="rc-name">${esc(r.name)}</h3>
      <p class="rc-line">${esc(line)}</p>
    </div>
  </a>`;
}

function roomsHTML(devs) {
  const rooms = store.state.rooms.filter((r) => devs.some((d) => d.roomId === r.id));
  if (!rooms.length) return '';
  return `<section class="section rooms-sec">
      <div class="section-head"><h2>Rooms</h2><a href="#/devices" class="link">All devices</a></div>
      <div class="rooms hscroll" id="rooms">${rooms.map((r, i) => roomCard(r, devs, i)).join('')}</div>
    </section>`;
}

function favouritesHTML(devs) {
  const favs = devs.filter((d) => d.favorite);
  const list = favs.length ? favs : devs.filter((d) => isActive(d)).slice(0, 6);
  if (!list.length) return '';
  return `<section class="section favs-sec">
      <div class="section-head"><h2>${favs.length ? 'Favourites' : 'Active now'}</h2></div>
      <div class="list" id="home-list">${list.map((d, i) => cardHTML(d, { index: i, variant: 'row' })).join('')}</div>
    </section>`;
}

function activityHTML() {
  const log = store.state.log.slice(0, 4);
  if (!log.length) return '';
  return `<section class="section act-sec"><div class="section-head"><h2>Recently</h2></div>
    <ul class="activity" id="activity">${log.map((l) => `<li><span class="act-t">${esc(l.text)}</span><time>${relTime(l.t)}</time></li>`).join('')}</ul></section>`;
}

function emptyHTML() {
  return `<div class="empty-hero">
    <h2>Your home, in one place.</h2>
    <p class="muted">Connect Google Home, Sonos, Samsung TV, Home Assistant, Philips Hue, Shelly or any HTTP device.</p>
    <div class="btn-row center"><button class="btn primary lg" data-act="add">${icon('plus')}<span>Connect devices</span></button></div>
  </div>`;
}

export function render(root) {
  const devs = store.devices();
  const name = store.state.settings.name;
  const date = new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
  root.innerHTML = `
    <header class="masthead">
      <span class="eyebrow">${esc(date)}</span>
      <div class="head-actions">
        <button class="icon-btn ghost-btn" data-act="search" aria-label="Search">${icon('search')}</button>
        <button class="icon-btn ghost-btn" data-act="add" aria-label="Connect devices">${icon('plus')}</button>
      </div>
    </header>
    <section class="hero">
      <div class="hero-time" id="hero-time">${clock()}</div>
      <h1 class="hero-greet">${greeting()}${name ? `, <span class="grad">${esc(name)}</span>` : ''}.</h1>
      <p class="hero-summary" id="hero-summary">${summaryHTML()}</p>
    </section>
    ${devs.length ? `${moodsHTML()}${roomsHTML(devs)}${favouritesHTML(devs)}${activityHTML()}` : emptyHTML()}`;

  const onClick = (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'search') openPalette();
    if (act === 'add') openConnect();
    const mood = e.target.closest('[data-scene]');
    if (mood) {
      haptic([8, 30, 8]);
      root.querySelectorAll('.mood').forEach((m) => m.classList.toggle('active', m === mood));
      mood.classList.remove('fired'); void mood.offsetWidth; mood.classList.add('fired');
      hub.runScene(mood.dataset.scene);
    }
    const power = e.target.closest('[data-room-power]');
    if (power) {
      e.preventDefault();
      e.stopPropagation();
      haptic(10);
      const rid = power.dataset.roomPower;
      const tg = store.devices().filter((d) => d.roomId === rid && toggleable(d));
      const turnOn = !tg.some(isActive);
      hub.setAll(tg.map((d) => d.id), () => ({ on: turnOn }), `${store.room(rid)?.name}: ${turnOn ? 'on' : 'off'}`);
    }
  };
  root.addEventListener('click', onClick);

  // Keep the sentence, the clock and the room cards current without re-rendering the page.
  let queued = false;
  const refresh = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      const s = root.querySelector('#hero-summary');
      if (s) s.innerHTML = summaryHTML();
      const rooms = root.querySelector('#rooms');
      if (rooms) {
        const all = store.devices();
        rooms.querySelectorAll('[data-room-card]').forEach((el, i) => {
          const r = store.room(el.dataset.roomCard);
          if (!r) return;
          const tmp = document.createElement('div');
          tmp.innerHTML = roomCard(r, all, i);
          const fresh = tmp.firstElementChild;
          el.className = fresh.className;
          el.querySelector('.rc-line').textContent = fresh.querySelector('.rc-line').textContent;
          const p = el.querySelector('.rc-power');
          if (p) p.classList.toggle('on', fresh.querySelector('.rc-power')?.classList.contains('on'));
        });
      }
    });
  };
  const offs = [store.on('device', refresh), store.on('energy', refresh)];
  const timer = setInterval(() => { const t = root.querySelector('#hero-time'); if (t) t.innerHTML = clock(); }, 10000);
  return () => {
    root.removeEventListener('click', onClick);
    offs.forEach((f) => f());
    clearInterval(timer);
  };
}
