// ⌘K command palette — search devices, scenes, rooms and actions.

import { icon } from './icons.js';
import { esc } from './util.js';
import { store } from './store.js';
import { hub } from './hub.js';
import { devIcon, statusText, typeDef } from './devices.js';
import { openDevice } from './detail.js';
import { openConnect } from './connect.js';
import { openSheet, toast } from './ui.js';

function score(q, text) {
  if (!q) return 1;
  text = text.toLowerCase();
  if (text.startsWith(q)) return 3;
  if (text.includes(' ' + q)) return 2.5;
  if (text.includes(q)) return 2;
  // fuzzy: all chars in order
  let i = 0;
  for (const c of text) if (c === q[i]) i++;
  return i === q.length ? 1 : 0;
}

function items() {
  const out = [];
  for (const d of store.devices()) {
    const room = store.room(d.roomId)?.name || '';
    out.push({ kind: 'Device', icon: devIcon(d), title: d.name, sub: [room, statusText(d)].filter(Boolean).join(' · '), keys: `${d.name} ${room} ${typeDef(d).label}`, run: () => openDevice(d.id), alt: typeDef(d).toggle || typeDef(d).quick ? () => hub.quickToggle(d.id) : null });
  }
  for (const s of store.state.scenes) out.push({ kind: 'Scene', icon: s.icon, title: s.name, sub: 'Run scene', keys: `scene ${s.name}`, run: () => hub.runScene(s.id) });
  const lights = store.devices().filter((d) => d.type === 'light');
  out.push(
    { kind: 'Action', icon: 'moon', title: 'Turn off all lights', sub: `${lights.filter((d) => d.state.on).length} on now`, keys: 'all lights off', run: () => hub.setAll(lights.map((d) => d.id), () => ({ on: false }), 'All lights turned off').then(() => toast('All lights off', { icon: 'moon' })) },
    { kind: 'Action', icon: 'sun', title: 'Turn on all lights', keys: 'all lights on', run: () => hub.setAll(lights.map((d) => d.id), () => ({ on: true }), 'All lights turned on') },
    { kind: 'Action', icon: 'lock', title: 'Lock all doors', keys: 'lock all doors security', run: () => hub.setAll(store.devices().filter((d) => d.type === 'lock').map((d) => d.id), () => ({ locked: true }), 'All doors locked').then(() => toast('All doors locked', { icon: 'lock', type: 'success' })) },
    { kind: 'Action', icon: 'pause', title: 'Pause all media', keys: 'pause stop music media', run: () => hub.setAll(store.devices().filter((d) => d.type === 'media').map((d) => d.id), () => ({ playing: false }), 'All media paused') },
    { kind: 'Action', icon: 'plus', title: 'Connect devices', keys: 'add connect integration home assistant hue shelly', run: () => openConnect() },
    { kind: 'Go to', icon: 'home', title: 'Home', keys: 'home dashboard', run: () => (location.hash = '#/home') },
    { kind: 'Go to', icon: 'grid', title: 'Devices', keys: 'devices rooms', run: () => (location.hash = '#/devices') },
    { kind: 'Go to', icon: 'sparkles', title: 'Scenes & routines', keys: 'scenes routines automations', run: () => (location.hash = '#/scenes') },
    { kind: 'Go to', icon: 'bolt', title: 'Energy', keys: 'energy power usage', run: () => (location.hash = '#/energy') },
    { kind: 'Go to', icon: 'sliders', title: 'Settings', keys: 'settings preferences theme', run: () => (location.hash = '#/settings') },
  );
  return out;
}

export function openPalette() {
  if (document.querySelector('.palette-sheet')) return;
  const s = openSheet({
    title: 'Search',
    className: 'palette-sheet',
    body: `<div class="pal-input">${icon('search')}<input class="input" placeholder="Search devices, scenes, actions…" aria-label="Search" autocomplete="off" spellcheck="false"><kbd>esc</kbd></div>
      <ul class="pal-list" role="listbox"></ul>
      <p class="pal-hint muted small"><kbd>↑</kbd><kbd>↓</kbd> navigate · <kbd>↵</kbd> open · <kbd>⇧↵</kbd> quick toggle</p>`,
  });
  const input = s.body.querySelector('input');
  const list = s.body.querySelector('.pal-list');
  const all = items();
  let results = [];
  let sel = 0;
  const render = () => {
    const q = input.value.trim().toLowerCase();
    results = all
      .map((it) => ({ it, sc: Math.max(score(q, it.title), score(q, it.keys) * 0.9) }))
      .filter((x) => x.sc > 0)
      .sort((a, b) => b.sc - a.sc)
      .slice(0, 40)
      .map((x) => x.it);
    sel = Math.min(sel, Math.max(0, results.length - 1));
    list.innerHTML = results.length
      ? results.map((r, i) => `<li role="option" class="pal-item ${i === sel ? 'sel' : ''}" data-i="${i}" aria-selected="${i === sel}">
          <span class="pal-ic">${icon(r.icon)}</span><span class="pal-txt"><b>${esc(r.title)}</b>${r.sub ? `<small>${esc(r.sub)}</small>` : ''}</span><span class="pal-kind">${r.kind}</span></li>`).join('')
      : `<li class="pal-empty">No results for “${esc(input.value)}”</li>`;
  };
  const run = (i, alt = false) => {
    const r = results[i];
    if (!r) return;
    s.close();
    setTimeout(() => (alt && r.alt ? r.alt() : r.run()), 60);
  };
  input.addEventListener('input', () => { sel = 0; render(); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); sel = Math.min(results.length - 1, sel + 1); render(); list.querySelector('.sel')?.scrollIntoView({ block: 'nearest' }); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(0, sel - 1); render(); list.querySelector('.sel')?.scrollIntoView({ block: 'nearest' }); }
    else if (e.key === 'Enter') { e.preventDefault(); run(sel, e.shiftKey); }
  });
  list.addEventListener('click', (e) => {
    const li = e.target.closest('[data-i]');
    if (li) run(+li.dataset.i);
  });
  render();
  setTimeout(() => input.focus(), 80);
}
