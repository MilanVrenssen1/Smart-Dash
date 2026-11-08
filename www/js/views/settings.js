import { icon, LOGO } from '../icons.js';
import { esc } from '../util.js';
import { store, guessRoomIcon } from '../store.js';
import { integrationsListHTML, wireIntegrationList } from '../connect.js';
import { haptic, toast, confirmDialog, promptDialog, segmented, openSheet } from '../ui.js';
import { ACCENTS, applyTheme, installPrompt } from '../theme.js';

const ROOM_ICONS = ['sofa', 'bed', 'baby', 'utensils', 'bath', 'monitor', 'car', 'tree', 'door', 'home', 'layers', 'heart'];

function roomsHTML() {
  const rooms = store.state.rooms;
  if (!rooms.length) return '<p class="muted small">No rooms yet.</p>';
  return rooms.map((r, i) => {
    const n = store.devices({ includeHidden: true }).filter((d) => d.roomId === r.id).length;
    return `<div class="room-row" data-id="${esc(r.id)}">
      <button class="room-ic btn-ic" data-a="icon" aria-label="Change icon">${icon(r.icon)}</button>
      <span class="rr-txt"><b>${esc(r.name)}</b><small>${n} device${n === 1 ? '' : 's'}</small></span>
      <button class="icon-btn sm" data-a="up" ${i === 0 ? 'disabled' : ''} aria-label="Move up">${icon('chevronUp')}</button>
      <button class="icon-btn sm" data-a="rename" aria-label="Rename">${icon('edit')}</button>
      <button class="icon-btn sm" data-a="del" aria-label="Delete">${icon('trash')}</button>
    </div>`;
  }).join('');
}

function hiddenHTML() {
  const hidden = store.devices({ includeHidden: true }).filter((d) => d.hidden);
  if (!hidden.length) return '';
  return `<section class="ctl-card">
    <div class="card-head"><h4>Hidden devices</h4><span class="muted small">${hidden.length}</span></div>
    ${hidden.map((d) => `<div class="room-row"><span class="rr-txt"><b>${esc(d.name)}</b><small>${esc(store.room(d.roomId)?.name || '')}</small></span><button class="chip sm" data-unhide="${esc(d.id)}">${icon('eye')}<span>Show</span></button></div>`).join('')}
  </section>`;
}

export function render(root) {
  const s = store.state.settings;
  root.innerHTML = `
    <header class="page-head"><div><p class="eyebrow">Make it yours</p><h1 class="title">Settings</h1></div></header>

    <section class="ctl-card profile">
      <div class="profile-row">${LOGO}<div><b>Smart Dash</b><small class="muted">Your home, one place</small></div></div>
      <label class="field"><span>Your name</span><input class="input" id="s-name" value="${esc(s.name)}" placeholder="Used in your greeting" maxlength="30"></label>
    </section>

    <section class="ctl-card">
      <div class="card-head"><h4>Connected services</h4></div>
      <div id="integ-list">${integrationsListHTML()}</div>
    </section>

    <section class="ctl-card">
      <div class="card-head"><h4>Appearance</h4></div>
      <div class="field"><span>Theme</span>
        <div class="seg" id="s-theme"><span class="seg-pill"></span><button data-seg="dark">${icon('moon')}<span>Dark</span></button><button data-seg="light">${icon('sun')}<span>Light</span></button><button data-seg="auto">${icon('auto')}<span>Auto</span></button></div>
      </div>
      <div class="field"><span>Accent</span>
        <div class="accents">${Object.entries(ACCENTS).map(([k, v]) => `<button class="acc ${k === s.accent ? 'on' : ''}" data-acc="${k}" style="--a:${v[0]};--b:${v[1]}" aria-label="${k}"></button>`).join('')}</div>
      </div>
      <button class="row" data-tg="reduceMotion">${icon('sparkles')}<span>Reduce motion</span><span class="tgl sm ${s.reduceMotion ? 'on' : ''}"><i></i></span></button>
      <button class="row" data-tg="haptics">${icon('smartphone')}<span>Haptic feedback</span><span class="tgl sm ${s.haptics ? 'on' : ''}"><i></i></span></button>
    </section>

    <section class="ctl-card">
      <div class="card-head"><h4>Rooms</h4><button class="link" data-a="add-room">${icon('plus')} Add room</button></div>
      <div id="rooms">${roomsHTML()}</div>
    </section>

    <div id="hidden-slot">${hiddenHTML()}</div>

    <section class="ctl-card">
      <div class="card-head"><h4>Energy & units</h4></div>
      <div class="field-row">
        <label class="field"><span>Price per kWh</span><input class="input" id="s-price" type="number" step="0.01" min="0" value="${s.price}"></label>
        <label class="field"><span>Currency</span><input class="input" id="s-cur" value="${esc(s.currency)}" maxlength="3"></label>
        <label class="field"><span>Temperature</span><select class="input" id="s-unit"><option ${s.tempUnit === '°C' ? 'selected' : ''}>°C</option><option ${s.tempUnit === '°F' ? 'selected' : ''}>°F</option></select></label>
      </div>
    </section>

    <section class="ctl-card">
      <div class="card-head"><h4>App</h4></div>
      <button class="row install-row" data-a="install" hidden>${icon('download')}<span>Install Smart Dash</span>${icon('chevronRight', 'chev')}</button>
      <button class="row" data-a="export">${icon('download')}<span>Back up settings</span>${icon('chevronRight', 'chev')}</button>
      <label class="row">${icon('upload')}<span>Restore from backup</span><input type="file" accept="application/json,.json" id="s-import" hidden>${icon('chevronRight', 'chev')}</label>
      <button class="row" data-a="shortcuts">${icon('command')}<span>Keyboard shortcuts</span>${icon('chevronRight', 'chev')}</button>
      <button class="row danger" data-a="reset">${icon('refresh')}<span>Reset everything</span>${icon('chevronRight', 'chev')}</button>
      <p class="meta">Smart Dash 1.0 · Your data stays on this device.</p>
    </section>`;

  const offInteg = wireIntegrationList(root.querySelector('#integ-list'));

  root.querySelector('#s-name').addEventListener('change', (e) => store.setSettings({ name: e.target.value.trim() }));
  root.querySelector('#s-price').addEventListener('change', (e) => store.setSettings({ price: Math.max(0, parseFloat(e.target.value) || 0) }));
  root.querySelector('#s-cur').addEventListener('change', (e) => store.setSettings({ currency: e.target.value.trim() || '€' }));
  root.querySelector('#s-unit').addEventListener('change', (e) => store.setSettings({ tempUnit: e.target.value }));
  segmented(root.querySelector('#s-theme'), s.theme, (v) => { store.setSettings({ theme: v }); applyTheme(); });

  const install = root.querySelector('.install-row');
  if (installPrompt.event) install.hidden = false;

  root.querySelector('#s-import').addEventListener('change', async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    try {
      const text = await f.text();
      if (!(await confirmDialog({ title: 'Restore backup?', message: 'This replaces your current rooms, scenes, routines and connections.', confirm: 'Restore' }))) return;
      store.importJSON(text);
    } catch (err) {
      toast('That backup could not be read', { icon: 'alert', type: 'error', detail: err.message });
    }
  });

  const onClick = async (e) => {
    const acc = e.target.closest('[data-acc]');
    if (acc) {
      haptic(5);
      store.setSettings({ accent: acc.dataset.acc });
      applyTheme();
      root.querySelectorAll('.acc').forEach((b) => b.classList.toggle('on', b === acc));
      return;
    }
    const tg = e.target.closest('[data-tg]');
    if (tg) {
      const k = tg.dataset.tg;
      store.setSettings({ [k]: !store.state.settings[k] });
      tg.querySelector('.tgl').classList.toggle('on', store.state.settings[k]);
      applyTheme();
      haptic(6);
      return;
    }
    const un = e.target.closest('[data-unhide]');
    if (un) {
      store.override(un.dataset.unhide, { hidden: undefined });
      root.querySelector('#hidden-slot').innerHTML = hiddenHTML();
      return;
    }
    const row = e.target.closest('.room-row[data-id]');
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (row && a) {
      const id = row.dataset.id;
      const r = store.room(id);
      if (a === 'up') store.moveRoom(id, -1);
      if (a === 'rename') {
        const name = await promptDialog({ title: 'Rename room', label: 'Name', value: r.name });
        if (name) store.updateRoom(id, { name });
      }
      if (a === 'icon') pickRoomIcon(r);
      if (a === 'del') {
        if (await confirmDialog({ title: `Delete ${r.name}?`, message: 'Devices in this room will become unassigned.', confirm: 'Delete', danger: true })) store.deleteRoom(id);
      }
      return;
    }
    if (a === 'add-room') {
      const name = await promptDialog({ title: 'New room', label: 'Room name', placeholder: 'e.g. Guest room', confirm: 'Create' });
      if (name) { store.ensureRoom(name, guessRoomIcon(name)); toast(`${name} added`, { icon: guessRoomIcon(name) }); }
    }
    if (a === 'export') {
      const blob = new Blob([store.exportJSON()], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `smart-dash-backup-${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast('Backup downloaded', { icon: 'check', type: 'success', detail: 'It contains your access tokens — keep it private.' });
    }
    if (a === 'install' && installPrompt.event) {
      installPrompt.event.prompt();
      installPrompt.event = null;
      install.hidden = true;
    }
    if (a === 'shortcuts') {
      openSheet({ title: 'Keyboard shortcuts', className: 'dialog', body: `<div class="shortcuts">
        ${[['Ctrl / ⌘ + K', 'Search & commands'], ['/', 'Search'], ['1 – 5', 'Switch tabs'], ['Esc', 'Close panel'], ['Shift + Enter', 'Quick toggle in search']].map(([k, v]) => `<div><kbd>${k}</kbd><span>${v}</span></div>`).join('')}</div>` });
    }
    if (a === 'reset') {
      if (await confirmDialog({ title: 'Reset Smart Dash?', message: 'All rooms, scenes, routines and connections on this device will be erased.', confirm: 'Reset', danger: true })) store.reset();
    }
  };
  root.addEventListener('click', onClick);
  const offS = store.on('structure', () => {
    const r = root.querySelector('#rooms');
    if (r) r.innerHTML = roomsHTML();
    const h = root.querySelector('#hidden-slot');
    if (h) h.innerHTML = hiddenHTML();
  });
  return () => { root.removeEventListener('click', onClick); offInteg(); offS(); };
}

function pickRoomIcon(r) {
  const s = openSheet({
    title: `Icon for ${r.name}`,
    className: 'dialog',
    body: `<div class="icon-pick big">${ROOM_ICONS.map((n) => `<button class="ip ${n === r.icon ? 'on' : ''}" data-ic="${n}" aria-label="${n}">${icon(n)}</button>`).join('')}</div>`,
  });
  s.body.addEventListener('click', (e) => {
    const b = e.target.closest('[data-ic]');
    if (!b) return;
    store.updateRoom(r.id, { icon: b.dataset.ic });
    s.close();
  });
}
