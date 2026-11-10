// A single room, presented like a page in a brochure.

import { icon } from '../icons.js';
import { esc, fmtNum } from '../util.js';
import { store } from '../store.js';
import { hub } from '../hub.js';
import { cardHTML } from '../cards.js';
import { isActive, typeDef } from '../devices.js';
import { haptic } from '../ui.js';

const toggleable = (d) => ['light', 'switch', 'outlet', 'fan', 'tv'].includes(d.type);
const GROUPS = [
  ['Lighting', (d) => d.type === 'light'],
  ['Climate', (d) => d.type === 'thermostat' || d.type === 'fan' || (d.type === 'sensor' && ['temperature', 'humidity', 'co2', 'air'].includes(d.state.kind))],
  ['Entertainment', (d) => d.type === 'media' || d.type === 'tv'],
  ['Windows & doors', (d) => d.type === 'cover' || d.type === 'lock' || (d.type === 'sensor' && ['door', 'window', 'motion', 'occupancy'].includes(d.state.kind))],
  ['Everything else', () => true],
];

function subline(devs) {
  const tg = devs.filter(toggleable);
  const on = tg.filter(isActive).length;
  const t = devs.find((d) => d.type === 'thermostat' && d.state.current != null)?.state.current
    ?? devs.find((d) => d.type === 'sensor' && d.state.kind === 'temperature')?.state.value;
  return [`${devs.length} device${devs.length === 1 ? '' : 's'}`, tg.length ? `${on} on` : '', t != null ? `${fmtNum(t, 1)}°` : ''].filter(Boolean).join(' · ');
}

export function render(root, roomId) {
  const room = store.room(roomId);
  if (!room) { location.hash = '#/home'; return; }
  const devs = store.devices().filter((d) => d.roomId === roomId);
  const used = new Set();
  const groups = GROUPS.map(([label, fn]) => {
    const list = devs.filter((d) => !used.has(d.id) && fn(d));
    list.forEach((d) => used.add(d.id));
    return [label, list];
  }).filter(([, l]) => l.length);
  const tg = devs.filter(toggleable);
  const anyOn = tg.some(isActive);
  let i = 0;
  root.innerHTML = `
    <header class="masthead">
      <a class="back" href="#/home">${icon('chevronLeft')}<span>Home</span></a>
      ${tg.length ? `<button class="chip room-master ${anyOn ? 'on' : ''}" data-act="all">${icon('power')}<span>${anyOn ? 'All off' : 'All on'}</span></button>` : ''}
    </header>
    <section class="room-hero">
      <span class="room-hero-ic">${icon(room.icon)}</span>
      <h1 class="title">${esc(room.name)}</h1>
      <p class="room-sub" id="room-sub">${esc(subline(devs))}</p>
    </section>
    ${groups.map(([label, list]) => `<section class="section">
        <div class="section-head"><h2>${label}</h2><span class="muted small">${list.length}</span></div>
        <div class="list">${list.map((d) => cardHTML(d, { showRoom: false, index: i++, variant: 'row' })).join('')}</div>
      </section>`).join('') || '<p class="muted empty-line big">No devices in this room yet.</p>'}`;

  const onClick = (e) => {
    if (e.target.closest('[data-act="all"]')) {
      haptic(10);
      const list = store.devices().filter((d) => d.roomId === roomId && toggleable(d));
      const turnOn = !list.some(isActive);
      hub.setAll(list.map((d) => d.id), () => ({ on: turnOn }), `${room.name}: ${turnOn ? 'on' : 'off'}`);
    }
  };
  root.addEventListener('click', onClick);
  const off = store.on('device', () => {
    const list = store.devices().filter((d) => d.roomId === roomId);
    const sub = root.querySelector('#room-sub');
    if (sub) sub.textContent = subline(list);
    const m = root.querySelector('.room-master');
    if (m) {
      const on = list.filter(toggleable).some(isActive);
      m.classList.toggle('on', on);
      m.querySelector('span').textContent = on ? 'All off' : 'All on';
    }
  });
  return () => { root.removeEventListener('click', onClick); off(); };
}
