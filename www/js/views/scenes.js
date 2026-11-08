import { icon } from '../icons.js';
import { esc, uid } from '../util.js';
import { store } from '../store.js';
import { hub } from '../hub.js';
import { devIcon, typeDef } from '../devices.js';
import { openSheet, haptic, ripple, toast, confirmDialog } from '../ui.js';

const GRADIENTS = [
  ['#ffb457', '#ff6b8b'], ['#7c5cff', '#e14bd4'], ['#14b8a6', '#3b82f6'], ['#3b4cff', '#1e1b4b'],
  ['#22c55e', '#14b8a6'], ['#f43f5e', '#f97316'], ['#06b6d4', '#8b5cf6'], ['#64748b', '#0f172a'],
];
const SCENE_ICONS = ['sparkles', 'sunrise', 'sun', 'moon', 'film', 'music', 'coffee', 'bed', 'sofa', 'away', 'home', 'heart', 'utensils', 'bath', 'monitor', 'leaf'];
const DAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function targetLabel(t) {
  if (t.startsWith('type:')) return `All ${typeDef({ type: t.slice(5) }).plural.toLowerCase()}`;
  if (t.startsWith('room:')) return `Everything in ${store.room(t.slice(5))?.name || 'room'}`;
  return store.device(t)?.name || null;
}

function patchLabel(a) {
  if (a.cmd) return { start: 'Start cleaning', pause: 'Pause', dock: 'Return to dock', stop: 'Stop' }[a.cmd] || a.cmd;
  const p = a.patch || {};
  const bits = [];
  if ('on' in p) bits.push(p.on ? 'On' : 'Off');
  if (p.brightness != null) bits.push(`${Math.round(p.brightness)}%`);
  if (p.color) bits.push('Colour');
  if (p.colorTemp) bits.push(`${p.colorTemp}K`);
  if ('locked' in p) bits.push(p.locked ? 'Lock' : 'Unlock');
  if (p.position != null) bits.push(p.position >= 100 ? 'Open' : p.position <= 0 ? 'Close' : `${p.position}%`);
  if (p.mode) bits.push(p.mode);
  if (p.target != null) bits.push(`${p.target}°`);
  if ('playing' in p) bits.push(p.playing ? 'Play' : 'Pause');
  if (p.volume != null) bits.push(`Vol ${p.volume}`);
  if (p.speed != null) bits.push(`Speed ${p.speed}%`);
  return bits.join(' · ');
}

const liveActions = (sc) => sc.actions.filter((a) => hub.resolve(a.target).length);

function sceneTile(sc, i) {
  const n = liveActions(sc).length;
  return `<div class="scene-tile" style="--a:${sc.gradient?.[0]};--b:${sc.gradient?.[1]};--i:${i}" data-scene="${esc(sc.id)}" role="button" tabindex="0" aria-label="Run ${esc(sc.name)}">
    <span class="st-ic">${icon(sc.icon)}</span>
    <div class="st-txt"><b>${esc(sc.name)}</b><small>${n} action${n === 1 ? '' : 's'}</small></div>
    <button class="icon-btn sm st-edit" data-edit="${esc(sc.id)}" aria-label="Edit ${esc(sc.name)}">${icon('edit')}</button>
    <span class="st-done">${icon('check')}</span>
  </div>`;
}

function routineRow(r) {
  const sc = store.state.scenes.find((s) => s.id === r.sceneId);
  const days = r.days.length === 7 ? 'Every day' : r.days.length === 5 && !r.days.includes(0) && !r.days.includes(6) ? 'Weekdays' : r.days.length === 2 && r.days.includes(0) && r.days.includes(6) ? 'Weekends' : r.days.map((d) => DAY_NAMES[d]).join(', ');
  return `<div class="routine ${r.enabled ? 'on' : ''}" data-rt="${esc(r.id)}">
    <span class="rt-time">${esc(r.time)}</span>
    <div class="rt-txt" data-edit-rt="${esc(r.id)}"><b>${esc(r.name)}</b><small>${esc(days)} · ${esc(sc?.name || 'Missing scene')}</small></div>
    <button class="tgl ${r.enabled ? 'on' : ''}" data-tg-rt="${esc(r.id)}" role="switch" aria-checked="${r.enabled}" aria-label="Enable ${esc(r.name)}"><i></i></button>
  </div>`;
}

export function render(root) {
  const scenes = store.state.scenes;
  root.innerHTML = `
    <header class="page-head">
      <div><p class="eyebrow">One tap, whole home</p><h1 class="title">Scenes</h1></div>
      <div class="head-actions"><button class="icon-btn accent" data-act="new-scene" aria-label="New scene">${icon('plus')}</button></div>
    </header>
    <section class="scene-grid stagger">
      ${scenes.map(sceneTile).join('')}
      <button class="scene-tile new" data-act="new-scene"><span class="st-ic">${icon('plus')}</span><div class="st-txt"><b>New scene</b><small>Capture how things are now</small></div></button>
    </section>
    <section class="section">
      <div class="section-head"><h2>Routines</h2><button class="link" data-act="new-rt">${icon('plus')} Add routine</button></div>
      <p class="muted small sub-note">${icon('clock')} Routines run scenes at a set time while Smart Dash is open on any of your devices.</p>
      <div class="routines">${store.state.routines.map(routineRow).join('') || '<p class="muted empty-line">No routines yet.</p>'}</div>
    </section>`;

  const onClick = (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'new-scene') return editScene(null);
    if (act === 'new-rt') return editRoutine(null);
    const ed = e.target.closest('[data-edit]');
    if (ed) { e.stopPropagation(); return editScene(ed.dataset.edit); }
    const tile = e.target.closest('.scene-tile[data-scene]');
    if (tile) {
      ripple(e, tile);
      haptic([8, 30, 8]);
      tile.classList.add('fired');
      setTimeout(() => tile.classList.remove('fired'), 1200);
      hub.runScene(tile.dataset.scene);
      return;
    }
    const tg = e.target.closest('[data-tg-rt]');
    if (tg) {
      const r = store.state.routines.find((x) => x.id === tg.dataset.tgRt);
      r.enabled = !r.enabled;
      haptic(6);
      tg.classList.toggle('on', r.enabled);
      tg.closest('.routine').classList.toggle('on', r.enabled);
      store.save();
      if (r.enabled) toast(`“${r.name}” will run at ${r.time}`, { icon: 'clock' });
      return;
    }
    const er = e.target.closest('[data-edit-rt]');
    if (er) editRoutine(er.dataset.editRt);
  };
  root.addEventListener('click', onClick);
  const onKey = (e) => {
    if (e.key === 'Enter' && e.target.matches('.scene-tile[data-scene]')) e.target.click();
  };
  root.addEventListener('keydown', onKey);
  return () => { root.removeEventListener('click', onClick); root.removeEventListener('keydown', onKey); };
}

function captureState(d) {
  const s = d.state;
  switch (d.type) {
    case 'light': return s.on ? { on: true, brightness: s.brightness, ...(s.color ? { color: s.color } : s.colorTemp ? { colorTemp: s.colorTemp } : {}) } : { on: false };
    case 'switch': case 'outlet': return { on: !!s.on };
    case 'fan': return s.on ? { on: true, speed: s.speed } : { on: false };
    case 'thermostat': return { mode: s.mode, target: s.target };
    case 'lock': return { locked: !!s.locked };
    case 'cover': return { position: s.position };
    case 'media': return { playing: !!s.playing, ...(s.volume != null ? { volume: s.volume } : {}) };
    default: return null;
  }
}

function editScene(id) {
  const existing = store.state.scenes.find((s) => s.id === id);
  const draft = existing ? JSON.parse(JSON.stringify(existing)) : { id: uid('scene-'), name: '', icon: 'sparkles', gradient: GRADIENTS[6], actions: [] };
  const devs = store.devices().filter((d) => captureState(d));
  const body = document.createElement('div');
  body.className = 'scene-editor';
  const renderActions = () => draft.actions.map((a, i) => {
    const label = targetLabel(a.target);
    if (!label) return '';
    return `<div class="act-row"><span class="act-ic">${icon(a.target.startsWith('type:') ? 'layers' : devIcon(store.device(a.target) || { type: 'switch', state: {}, attrs: {} }))}</span>
      <span class="act-txt"><b>${esc(label)}</b><small>${esc(patchLabel(a))}</small></span>
      <button type="button" class="icon-btn sm" data-rm="${i}" aria-label="Remove">${icon('x')}</button></div>`;
  }).join('') || '<p class="muted small">No actions yet.</p>';
  body.innerHTML = `
    <div class="scene-preview" style="--a:${draft.gradient[0]};--b:${draft.gradient[1]}"><span class="st-ic">${icon(draft.icon)}</span><b class="sp-name">${esc(draft.name || 'New scene')}</b></div>
    <label class="field"><span>Name</span><input class="input" name="name" value="${esc(draft.name)}" placeholder="e.g. Dinner party" maxlength="40"></label>
    <div class="field"><span>Icon</span><div class="icon-pick">${SCENE_ICONS.map((n) => `<button type="button" class="ip ${n === draft.icon ? 'on' : ''}" data-ic="${n}" aria-label="${n}">${icon(n)}</button>`).join('')}</div></div>
    <div class="field"><span>Colour</span><div class="grad-pick">${GRADIENTS.map((g, i) => `<button type="button" class="gp ${g[0] === draft.gradient[0] ? 'on' : ''}" data-g="${i}" style="--a:${g[0]};--b:${g[1]}" aria-label="Gradient ${i + 1}"></button>`).join('')}</div></div>
    <div class="field"><span>Actions</span><div class="act-list">${renderActions()}</div></div>
    <details class="cd-add" ${draft.actions.length ? '' : 'open'}><summary>${icon('plus')} Capture devices as they are now</summary>
      <p class="muted small">Set your devices the way you like, then tick them here. Their current state is saved into the scene.</p>
      <div class="dev-pick">${devs.map((d) => `<label class="dp"><input type="checkbox" value="${esc(d.id)}"><span class="dp-ic">${icon(devIcon(d))}</span><span class="dp-txt"><b>${esc(d.name)}</b><small>${esc(store.room(d.roomId)?.name || '')}</small></span><span class="dp-check">${icon('check')}</span></label>`).join('')}</div>
    </details>
    <div class="btn-row">
      ${existing ? `<button type="button" class="btn danger ghost" data-a="delete">${icon('trash')}<span>Delete</span></button>` : ''}
      <button type="button" class="btn primary" data-a="save">${icon('check')}<span>Save scene</span></button>
    </div>`;
  const sheet = openSheet({ title: existing ? 'Edit scene' : 'New scene', body, className: 'scene-sheet' });
  const preview = body.querySelector('.scene-preview');
  body.querySelector('[name="name"]').addEventListener('input', (e) => { body.querySelector('.sp-name').textContent = e.target.value || 'New scene'; });
  body.addEventListener('click', async (e) => {
    const ic = e.target.closest('[data-ic]');
    if (ic) {
      draft.icon = ic.dataset.ic;
      body.querySelectorAll('.ip').forEach((b) => b.classList.toggle('on', b === ic));
      preview.querySelector('.st-ic').innerHTML = icon(draft.icon);
    }
    const g = e.target.closest('[data-g]');
    if (g) {
      draft.gradient = GRADIENTS[+g.dataset.g];
      body.querySelectorAll('.gp').forEach((b) => b.classList.toggle('on', b === g));
      preview.style.setProperty('--a', draft.gradient[0]);
      preview.style.setProperty('--b', draft.gradient[1]);
    }
    const rm = e.target.closest('[data-rm]');
    if (rm) {
      draft.actions.splice(+rm.dataset.rm, 1);
      body.querySelector('.act-list').innerHTML = renderActions();
    }
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (a === 'save') {
      draft.name = body.querySelector('[name="name"]').value.trim();
      if (!draft.name) { toast('Give your scene a name', { icon: 'alert', type: 'error' }); return; }
      for (const cb of body.querySelectorAll('.dev-pick input:checked')) {
        const d = store.device(cb.value);
        const patch = d && captureState(d);
        if (!patch) continue;
        draft.actions = draft.actions.filter((x) => x.target !== d.id);
        draft.actions.push({ target: d.id, patch });
      }
      if (!draft.actions.length) { toast('Add at least one device', { icon: 'alert', type: 'error' }); return; }
      const i = store.state.scenes.findIndex((s) => s.id === draft.id);
      if (i >= 0) store.state.scenes[i] = draft;
      else store.state.scenes.push(draft);
      store.save();
      store.emit('scenes');
      toast(`Scene “${draft.name}” saved`, { icon: draft.icon, type: 'success' });
      sheet.close();
    }
    if (a === 'delete') {
      if (!(await confirmDialog({ title: `Delete “${draft.name}”?`, confirm: 'Delete', danger: true }))) return;
      store.state.scenes = store.state.scenes.filter((s) => s.id !== draft.id);
      store.save();
      store.emit('scenes');
      sheet.close();
    }
  });
}

function editRoutine(id) {
  const existing = store.state.routines.find((r) => r.id === id);
  const scenes = store.state.scenes;
  if (!scenes.length) { toast('Create a scene first', { icon: 'info' }); return; }
  const draft = existing ? { ...existing, days: [...existing.days] } : { id: uid('rt-'), name: '', time: '07:00', days: [1, 2, 3, 4, 5], sceneId: scenes[0].id, enabled: true, lastRun: null };
  const body = document.createElement('div');
  body.className = 'form';
  body.innerHTML = `
    <label class="field"><span>Name</span><input class="input" name="name" value="${esc(draft.name)}" placeholder="e.g. Wake up"></label>
    <label class="field"><span>Time</span><input class="input time" type="time" name="time" value="${esc(draft.time)}"></label>
    <div class="field"><span>Repeat</span><div class="days">${DAYS.map((d, i) => `<button type="button" class="day ${draft.days.includes(i) ? 'on' : ''}" data-day="${i}" aria-label="${DAY_NAMES[i]}">${d}</button>`).join('')}</div></div>
    <label class="field"><span>Run scene</span><select class="input" name="scene">${scenes.map((s) => `<option value="${esc(s.id)}" ${s.id === draft.sceneId ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select></label>
    <div class="btn-row">
      ${existing ? `<button type="button" class="btn danger ghost" data-a="delete">${icon('trash')}<span>Delete</span></button>` : ''}
      <button type="button" class="btn primary" data-a="save">${icon('check')}<span>Save routine</span></button>
    </div>`;
  const sheet = openSheet({ title: existing ? 'Edit routine' : 'New routine', body });
  body.addEventListener('click', async (e) => {
    const day = e.target.closest('[data-day]');
    if (day) {
      const d = +day.dataset.day;
      draft.days = draft.days.includes(d) ? draft.days.filter((x) => x !== d) : [...draft.days, d].sort();
      day.classList.toggle('on');
      haptic(4);
    }
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (a === 'save') {
      draft.name = body.querySelector('[name="name"]').value.trim() || 'Routine';
      draft.time = body.querySelector('[name="time"]').value || '07:00';
      draft.sceneId = body.querySelector('[name="scene"]').value;
      if (!draft.days.length) { toast('Pick at least one day', { icon: 'alert', type: 'error' }); return; }
      const i = store.state.routines.findIndex((r) => r.id === draft.id);
      if (i >= 0) store.state.routines[i] = draft;
      else store.state.routines.push(draft);
      store.save();
      store.emit('routines');
      sheet.close();
    }
    if (a === 'delete') {
      if (!(await confirmDialog({ title: 'Delete routine?', confirm: 'Delete', danger: true }))) return;
      store.state.routines = store.state.routines.filter((r) => r.id !== draft.id);
      store.save();
      store.emit('routines');
      sheet.close();
    }
  });
}
