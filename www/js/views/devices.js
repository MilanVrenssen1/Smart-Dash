import { icon } from '../icons.js';
import { esc } from '../util.js';
import { store } from '../store.js';
import { hub } from '../hub.js';
import { cardHTML } from '../cards.js';
import { CATEGORIES, isActive, typeDef } from '../devices.js';
import { haptic, toast } from '../ui.js';
import { openConnect } from '../connect.js';

let filter = 'all';
let query = '';

export function setDeviceFilter(f) {
  filter = CATEGORIES.some((c) => c.id === f) ? f : 'all';
  query = '';
}

function groups() {
  const cat = CATEGORIES.find((c) => c.id === filter) || CATEGORIES[0];
  const q = query.toLowerCase();
  const devs = store.devices().filter((d) => cat.match(d) && (!q || d.name.toLowerCase().includes(q) || (store.room(d.roomId)?.name || '').toLowerCase().includes(q)));
  const out = store.state.rooms.map((r) => ({ room: r, devs: devs.filter((d) => d.roomId === r.id) })).filter((g) => g.devs.length);
  const none = devs.filter((d) => !d.roomId || !store.room(d.roomId));
  if (none.length) out.push({ room: { id: '', name: 'Unassigned', icon: 'layers' }, devs: none });
  return { out, count: devs.length };
}

const toggleable = (d) => ['light', 'switch', 'outlet', 'fan'].includes(d.type);

function bodyHTML() {
  const { out, count } = groups();
  if (!count) return `<div class="empty-line big muted">${query ? `Nothing matches “${esc(query)}”.` : 'No devices in this category yet.'}</div>`;
  let i = 0;
  return out.map(({ room, devs }) => {
    const tg = devs.filter(toggleable);
    const anyOn = tg.some((d) => isActive(d));
    return `<section class="room-group" data-room="${esc(room.id)}">
      <div class="room-head">
        <div><h2>${room.id ? `<a href="#/room/${esc(room.id)}">${esc(room.name)}</a>` : esc(room.name)}</h2><p class="muted small">${devs.length} device${devs.length > 1 ? 's' : ''}${tg.length ? ` · ${tg.filter(isActive).length} on` : ''}</p></div>
        ${tg.length ? `<button class="chip sm room-all ${anyOn ? 'on' : ''}" data-all="${esc(room.id)}">${icon('power')}<span>${anyOn ? 'All off' : 'All on'}</span></button>` : ''}
      </div>
      <div class="list">${devs.map((d) => cardHTML(d, { showRoom: false, index: i++, variant: 'row' })).join('')}</div>
    </section>`;
  }).join('');
}

export function render(root) {
  const total = store.devices().length;
  root.innerHTML = `
    <header class="page-head">
      <div><p class="eyebrow">${total} devices · ${store.state.rooms.length} rooms</p><h1 class="title">Devices</h1></div>
      <div class="head-actions"><button class="icon-btn accent" data-act="add" aria-label="Connect devices">${icon('plus')}</button></div>
    </header>
    <div class="search-bar">${icon('search')}<input class="input" type="search" placeholder="Search devices or rooms" value="${esc(query)}" aria-label="Search devices"></div>
    <div class="chips hscroll" id="cat-chips">${CATEGORIES.map((c) => `<button class="chip ${c.id === filter ? 'on' : ''}" data-cat="${c.id}">${icon(c.icon)}<span>${c.label}</span></button>`).join('')}</div>
    <div id="dev-body">${bodyHTML()}</div>`;
  const body = root.querySelector('#dev-body');
  const rerender = () => {
    body.innerHTML = bodyHTML();
    body.classList.remove('reflow');
    void body.offsetWidth;
    body.classList.add('reflow');
  };
  root.querySelector('.search-bar input').addEventListener('input', (e) => {
    query = e.target.value;
    rerender();
  });
  const onClick = (e) => {
    if (e.target.closest('[data-act="add"]')) openConnect();
    const c = e.target.closest('[data-cat]');
    if (c) {
      filter = c.dataset.cat;
      haptic(5);
      root.querySelectorAll('#cat-chips .chip').forEach((x) => x.classList.toggle('on', x === c));
      rerender();
    }
    const all = e.target.closest('[data-all]');
    if (all) {
      const rid = all.dataset.all;
      const devs = store.devices().filter((d) => (rid ? d.roomId === rid : !d.roomId) && toggleable(d));
      const turnOn = !devs.some(isActive);
      haptic(10);
      hub.setAll(devs.map((d) => d.id), () => ({ on: turnOn }), `${store.room(rid)?.name || 'Unassigned'}: everything ${turnOn ? 'on' : 'off'}`);
      toast(`${store.room(rid)?.name || 'Unassigned'} ${turnOn ? 'on' : 'off'}`, { icon: 'power' });
    }
  };
  root.addEventListener('click', onClick);
  // Keep room "All on/off" chips accurate.
  const off = store.on('device', () => {
    root.querySelectorAll('.room-group').forEach((g) => {
      const rid = g.dataset.room;
      const tg = store.devices().filter((d) => (rid ? d.roomId === rid : !d.roomId) && toggleable(d));
      const anyOn = tg.some(isActive);
      const chip = g.querySelector('.room-all');
      if (chip) {
        chip.classList.toggle('on', anyOn);
        chip.querySelector('span').textContent = anyOn ? 'All off' : 'All on';
      }
      const p = g.querySelector('.room-head p');
      if (p && tg.length) p.textContent = `${g.querySelectorAll('.dcard').length} device${g.querySelectorAll('.dcard').length > 1 ? 's' : ''} · ${tg.filter(isActive).length} on`;
    });
  });
  return () => { root.removeEventListener('click', onClick); off(); };
}
