import { icon, LOGO } from '../icons.js';
import { esc } from '../util.js';
import { store, guessRoomIcon } from '../store.js';
import { integrationsListHTML, wireIntegrationList } from '../connect.js';
import { haptic, toast, confirmDialog, promptDialog, segmented, openSheet } from '../ui.js';
import { ACCENTS, applyTheme, installPrompt } from '../theme.js';
import { doorbellSettings, isNativeDoorbell, doorbellStatus, openDoorbellPermission, testDoorbell } from '../doorbell.js';
import { panelSettings, settingsLocked, tryUnlock, lockNow, isNativePanel, panelStatus, setHomeApp, openSystemSettings, previewClock } from '../panel.js';

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

function lockHTML() {
  return `<section class="pin-lock">
    <p class="eyebrow">Wall panel</p>
    <h1 class="title">Settings are locked</h1>
    <p class="muted">Enter the PIN to continue.</p>
    <div class="pin-dots" aria-live="polite"><i></i><i></i><i></i><i></i></div>
    <div class="pin-pad">${[1, 2, 3, 4, 5, 6, 7, 8, 9, '', 0, '⌫'].map((k) => k === '' ? '<span></span>' : `<button class="pin-k" data-k="${k}">${k}</button>`).join('')}</div>
  </section>`;
}

function renderLock(root) {
  root.innerHTML = lockHTML();
  let entry = '';
  const dots = () => root.querySelectorAll('.pin-dots i').forEach((d, i) => d.classList.toggle('on', i < entry.length));
  const onClick = (e) => {
    const k = e.target.closest('[data-k]')?.dataset.k;
    if (k == null) return;
    haptic(5);
    entry = k === '⌫' ? entry.slice(0, -1) : (entry + k).slice(0, 8);
    dots();
    if (entry.length >= 4 && tryUnlock(entry)) { root.removeEventListener('click', onClick); render(root); return; }
    if (entry.length >= panelSettings().pin.length && entry.length >= 4) {
      root.querySelector('.pin-dots').classList.add('shake');
      setTimeout(() => { entry = ''; dots(); root.querySelector('.pin-dots')?.classList.remove('shake'); }, 500);
    }
  };
  root.addEventListener('click', onClick);
  return () => root.removeEventListener('click', onClick);
}

function doorbellHTML() {
  const d = doorbellSettings();
  return `<section class="ctl-card" id="doorbell-card">
      <div class="card-head"><h4>Doorbell</h4></div>
      <p class="muted small panel-intro">Show a popup with a snapshot when your Eufy doorbell rings or sees someone — taken from the Eufy Security app’s notifications on this device.</p>
      ${isNativeDoorbell() ? `<div class="db-status" id="db-status"><span class="muted small">Checking…</span></div>` : `<p class="meta">${icon('info')} Doorbell popups work in the Android app on a device with the Eufy Security app.</p>`}
      <button class="row" data-db-opt="enabled">${icon('bell')}<span>Doorbell popups</span><span class="tgl sm ${d.enabled ? 'on' : ''}"><i></i></span></button>
      <div class="panel-opts ${d.enabled ? '' : 'off'}" id="db-opts">
        <button class="row" data-db-opt="ring">${icon('door')}<span>When someone rings</span><span class="tgl sm ${d.ring ? 'on' : ''}"><i></i></span></button>
        <button class="row" data-db-opt="person">${icon('user')}<span>When a person or package is detected</span><span class="tgl sm ${d.person ? 'on' : ''}"><i></i></span></button>
        <button class="row" data-db-opt="motion">${icon('motion')}<span>On any motion</span><span class="tgl sm ${d.motion ? 'on' : ''}"><i></i></span></button>
        <button class="row" data-db-opt="chime">${icon('volume')}<span>Soft chime when it rings</span><span class="tgl sm ${d.chime ? 'on' : ''}"><i></i></span></button>
        <button class="row" data-a="db-test">${icon('eye')}<span>Show a test popup</span>${icon('chevronRight', 'chev')}</button>
      </div>
    </section>`;
}

function panelHTML() {
  const p = panelSettings();
  const native = isNativePanel();
  return `<section class="ctl-card" id="panel-card">
      <div class="card-head"><h4>Wall panel</h4></div>
      <p class="muted small panel-intro">Turn a tablet into a dedicated control panel: always on, full screen, with a calm clock when nobody is using it.</p>
      <button class="row" data-pn="enabled">${icon('monitor')}<span>Wall panel mode</span><span class="tgl sm ${p.enabled ? 'on' : ''}"><i></i></span></button>
      <div class="panel-opts ${p.enabled ? '' : 'off'}">
        <div class="field"><span>Keep the screen on</span>
          <div class="seg" id="pn-awake"><span class="seg-pill"></span><button data-seg="always">Always</button><button data-seg="charging">While charging</button><button data-seg="never">Never</button></div></div>
        <label class="row">${icon('clock')}<span>Night clock after</span>
          <select class="row-select" data-pn-select="clockAfter">${[[0, 'Never'], [1, '1 minute'], [2, '2 minutes'], [5, '5 minutes'], [10, '10 minutes'], [30, '30 minutes']].map(([v, l]) => `<option value="${v}" ${+p.clockAfter === v ? 'selected' : ''}>${l}</option>`).join('')}</select>${icon('chevronDown', 'chev')}</label>
        <button class="row" data-pn="dim">${icon('moon')}<span>Dim the screen with the clock</span><span class="tgl sm ${p.dim ? 'on' : ''}"><i></i></span></button>
        <button class="row" data-pn="fullscreen">${icon('layers')}<span>Full screen (hide Android bars)</span><span class="tgl sm ${p.fullscreen ? 'on' : ''}"><i></i></span></button>
        <button class="row" data-a="pin">${icon('lock')}<span>PIN for Settings</span><b class="row-v">${p.pin ? 'On' : 'Off'}</b>${icon('chevronRight', 'chev')}</button>
        <button class="row" data-a="preview-clock">${icon('eye')}<span>Show the night clock now</span>${icon('chevronRight', 'chev')}</button>
        ${native ? `<button class="row" data-a="home-app">${icon('home')}<span>Use as the tablet’s home screen</span><b class="row-v" id="home-state">…</b>${icon('chevronRight', 'chev')}</button>
        <button class="row" data-a="android-settings">${icon('sliders')}<span>Open Android settings</span>${icon('chevronRight', 'chev')}</button>`
        : `<p class="meta">${icon('info')} Screen-on, full screen and home-screen options work in the Android app.</p>`}
      </div>
    </section>`;
}

export function render(root) {
  if (settingsLocked()) return renderLock(root);
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

    ${panelHTML()}

    ${doorbellHTML()}

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

  const savePanel = (patch) => store.setSettings({ panel: { ...panelSettings(), ...patch } });
  const awakeSeg = root.querySelector('#pn-awake');
  if (awakeSeg) segmented(awakeSeg, panelSettings().awake, (v) => savePanel({ awake: v }));
  root.querySelector('[data-pn-select="clockAfter"]')?.addEventListener('change', (e) => savePanel({ clockAfter: +e.target.value }));
  const refreshDoorbell = () => doorbellStatus().then((st) => {
    const el = root.querySelector('#db-status');
    if (!el) return;
    el.innerHTML = `
      <div class="db-check ${st.eufyInstalled ? 'ok' : 'bad'}">${icon(st.eufyInstalled ? 'check' : 'alert')}<span>${st.eufyInstalled ? 'Eufy Security app found' : 'Install and sign in to the Eufy Security app on this device'}</span></div>
      <div class="db-check ${st.permission ? 'ok' : 'bad'}">${icon(st.permission ? 'check' : 'alert')}<span>${st.permission ? 'Notification access granted' : 'Smart Dash needs notification access'}</span>
        ${st.permission ? '' : '<button class="btn ghost sm-btn" data-a="db-perm">Grant</button>'}</div>
      ${st.lastDebug ? `<details class="db-debug"><summary>Last Eufy notification</summary><code>${esc(st.lastDebug)}</code></details>` : ''}`;
  }).catch(() => {});
  refreshDoorbell();
  const refreshHome = () => panelStatus().then((st) => {
    const el = root.querySelector('#home-state');
    if (el) el.textContent = st.isHome ? 'On' : st.homeEnabled ? 'Choose in Android' : 'Off';
  }).catch(() => {});
  refreshHome();
  const onVis = () => { if (document.visibilityState === 'visible') { refreshHome(); refreshDoorbell(); } };
  document.addEventListener('visibilitychange', onVis);

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
    const pn = e.target.closest('[data-pn]');
    if (pn) {
      const k = pn.dataset.pn;
      const v = !panelSettings()[k];
      savePanel({ [k]: v });
      pn.querySelector('.tgl').classList.toggle('on', v);
      if (k === 'enabled') {
        root.querySelector('.panel-opts').classList.toggle('off', !v);
        toast(v ? 'Wall panel mode on' : 'Wall panel mode off', { icon: 'monitor', detail: v ? 'The screen stays on while charging. Tip: also set Smart Dash as the home screen.' : '' });
      }
      haptic(6);
      return;
    }
    const dbo = e.target.closest('[data-db-opt]');
    if (dbo) {
      const k = dbo.dataset.dbOpt;
      const v = !doorbellSettings()[k];
      store.setSettings({ doorbell: { ...doorbellSettings(), [k]: v } });
      dbo.querySelector('.tgl').classList.toggle('on', v);
      if (k === 'enabled') root.querySelector('#db-opts').classList.toggle('off', !v);
      haptic(6);
      return;
    }
    const pa = e.target.closest('[data-a]')?.dataset.a;
    if (pa === 'db-test') { testDoorbell(); return; }
    if (pa === 'db-perm') { openDoorbellPermission(); toast('Turn on “Smart Dash”', { icon: 'bell', detail: 'Android will warn that it can read notifications — Smart Dash only looks at Eufy’s.', duration: 6000 }); return; }
    if (pa === 'pin') {
      const cur = panelSettings().pin;
      const val = await promptDialog({ title: cur ? 'Change or remove PIN' : 'Set a PIN', label: 'PIN for Settings (4–8 digits, leave empty to remove)', value: '', placeholder: '••••', confirm: 'Save' });
      if (val == null) return;
      if (val && !/^\d{4,8}$/.test(val)) { toast('Use 4 to 8 digits', { icon: 'alert', type: 'error' }); return; }
      savePanel({ pin: val });
      lockNow();
      if (val) tryUnlock(val);
      root.querySelector('[data-a="pin"] .row-v').textContent = val ? 'On' : 'Off';
      toast(val ? 'PIN set — Settings will ask for it' : 'PIN removed', { icon: 'lock' });
      return;
    }
    if (pa === 'preview-clock') { setTimeout(previewClock, 200); return; }
    if (pa === 'home-app') {
      const st = await panelStatus();
      if (st.isHome && !(await confirmDialog({ title: 'Stop using Smart Dash as home screen?', message: 'Android will ask which home app to use instead.', confirm: 'Stop' }))) return;
      await setHomeApp(!st.isHome);
      if (!st.isHome) toast('Choose “Smart Dash” as the home app', { icon: 'home', detail: 'Then pressing Home or restarting the tablet always opens Smart Dash.', duration: 6000 });
      return;
    }
    if (pa === 'android-settings') { openSystemSettings(); return; }
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
  return () => { root.removeEventListener('click', onClick); offInteg(); offS(); document.removeEventListener('visibilitychange', onVis); };
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
