// Central state store with persistence and a tiny pub/sub.
//
// Events:
//   device (id)      – a device's live state or user overrides changed
//   structure        – devices/rooms were added, removed or re-assigned
//   settings         – user preferences changed
//   scenes, routines – scene / routine collections changed
//   integration (id) – an integration's connection status changed
//   log              – activity feed changed
//   energy           – a new energy sample was recorded

import { uid } from './util.js';

const KEY = 'smartdash:v1';

// IDs of the sample content that used to ship with the built-in demo home.
const LEGACY_DEMO_SCENES = ['scene-morning', 'scene-movie', 'scene-away', 'scene-night'];
const LEGACY_DEMO_ROUTINES = ['rt-morning', 'rt-night'];
const LEGACY_DEMO_ROOMS = ['Living Room', 'Kitchen', 'Bedroom', 'Office', 'Bathroom', 'Entrance', 'Garage', 'Garden'];

const defaults = () => ({
  version: 2,
  settings: {
    name: '',
    theme: 'dark',          // dark | light | auto
    accent: 'champagne',
    haptics: true,
    reduceMotion: false,
    price: 0.3,              // per kWh
    currency: '€',
    tempUnit: '°C',
    onboarded: false,
  },
  rooms: [],
  devices: {},
  overrides: {},
  scenes: [],
  routines: [],
  integrations: {
    googlehome: { enabled: false },
    homeassistant: { enabled: false, url: '', token: '' },
    hue: { enabled: false, bridge: '', username: '' },
    sonos: { enabled: false, hosts: '' },
    samsungtv: { enabled: false, hosts: '', tokens: {}, macs: {} },
    shelly: { enabled: false, hosts: '' },
    webhook: { enabled: false, devices: [] },
  },
  log: [],
  energy: { hours: {}, seeded: false },
});

/** Remove everything the old built-in demo home created, keeping the user's own things. */
function removeDemo(s) {
  for (const id of Object.keys(s.devices || {})) if (id.startsWith('demo:')) delete s.devices[id];
  for (const id of Object.keys(s.overrides || {})) if (id.startsWith('demo:')) delete s.overrides[id];
  s.scenes = (s.scenes || []).filter((sc) => !LEGACY_DEMO_SCENES.includes(sc.id))
    .map((sc) => ({ ...sc, actions: sc.actions.filter((a) => !a.target.startsWith('demo:')) }))
    .filter((sc) => sc.actions.length);
  s.routines = (s.routines || []).filter((r) => !LEGACY_DEMO_ROUTINES.includes(r.id) && s.scenes.some((sc) => sc.id === r.sceneId));
  const used = new Set(Object.values(s.devices || {}).map((d) => d.roomId));
  for (const o of Object.values(s.overrides || {})) if (o.roomId) used.add(o.roomId);
  s.rooms = (s.rooms || []).filter((r) => used.has(r.id) || !LEGACY_DEMO_ROOMS.includes(r.name));
  if (s.integrations) delete s.integrations.demo;
  // Energy history included simulated demo usage; start fresh.
  s.energy = { hours: {} };
  s.log = (s.log || []).filter((l) => !/demo/i.test(l.text));
  s.version = 2;
  return s;
}

function load() {
  const base = defaults();
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return base;
    let s = JSON.parse(raw);
    if ((s.version || 1) < 2) s = removeDemo(s);
    return {
      ...base,
      ...s,
      settings: { ...base.settings, ...s.settings },
      integrations: Object.fromEntries(
        Object.entries(base.integrations).map(([k, v]) => [k, { ...v, ...(s.integrations?.[k] || {}) }]),
      ),
      energy: { ...base.energy, ...s.energy },
      version: 2,
    };
  } catch (e) {
    console.warn('Could not load saved state', e);
    return base;
  }
}

const ROOM_ICONS = [
  [/living|lounge|family|tv/i, 'sofa'],
  [/bed|sleep|guest|master/i, 'bed'],
  [/kid|nursery|child/i, 'baby'],
  [/kitchen|dining/i, 'utensils'],
  [/bath|toilet|shower|wc|restroom/i, 'bath'],
  [/office|study|desk|work/i, 'monitor'],
  [/garage|car|drive/i, 'car'],
  [/garden|outdoor|outside|yard|patio|balcony|terrace|porch/i, 'tree'],
  [/hall|entr|foyer|door|corridor|stair/i, 'door'],
];
export const guessRoomIcon = (name) => ROOM_ICONS.find(([re]) => re.test(name))?.[1] || 'home';

const same = (a, b) => a === b || (typeof a === 'object' && JSON.stringify(a) === JSON.stringify(b));

export const store = {
  state: load(),
  _l: {},
  _structPending: false,

  on(ev, fn) {
    (this._l[ev] ||= new Set()).add(fn);
    return () => this._l[ev].delete(fn);
  },
  emit(ev, payload) {
    this._l[ev]?.forEach((fn) => {
      try { fn(payload); } catch (e) { console.error(e); }
    });
  },
  structure() {
    if (this._structPending) return;
    this._structPending = true;
    queueMicrotask(() => {
      this._structPending = false;
      this.emit('structure');
    });
  },
  save() {
    clearTimeout(this._t);
    this._t = setTimeout(() => {
      try { localStorage.setItem(KEY, JSON.stringify(this.state)); } catch (e) { /* quota */ }
    }, 400);
  },

  /* ---------- devices ---------- */
  device(id) {
    const d = this.state.devices[id];
    if (!d) return null;
    const o = this.state.overrides[id] || {};
    return { ...d, ...o, state: d.state, attrs: d.attrs || {} };
  },
  devices({ includeHidden = false } = {}) {
    return Object.keys(this.state.devices)
      .map((id) => this.device(id))
      .filter((d) => includeHidden || !d.hidden)
      .sort((a, b) => a.name.localeCompare(b.name));
  },
  upsertDevice(dev) {
    const ex = this.state.devices[dev.id];
    if (!ex) {
      this.state.devices[dev.id] = { attrs: {}, ...dev, state: { ...dev.state } };
      this.structure();
    } else {
      const roomChanged = dev.roomId !== undefined && dev.roomId !== ex.roomId;
      ex.name = dev.name ?? ex.name;
      ex.type = dev.type ?? ex.type;
      if (dev.roomId !== undefined) ex.roomId = dev.roomId;
      ex.attrs = { ...ex.attrs, ...(dev.attrs || {}) };
      Object.assign(ex.state, dev.state);
      if (roomChanged) this.structure();
      this.emit('device', dev.id);
    }
    this.save();
  },
  patchDevice(id, patch) {
    const d = this.state.devices[id];
    if (!d) return false;
    let changed = false;
    for (const [k, v] of Object.entries(patch)) {
      if (!same(d.state[k], v)) {
        d.state[k] = v;
        changed = true;
      }
    }
    if (changed) {
      this.emit('device', id);
      this.save();
    }
    return changed;
  },
  removeDevices(pred) {
    let n = 0;
    for (const id of Object.keys(this.state.devices)) {
      if (pred(this.state.devices[id])) {
        delete this.state.devices[id];
        n++;
      }
    }
    if (n) {
      this.structure();
      this.save();
    }
    return n;
  },
  override(id, patch) {
    const o = (this.state.overrides[id] ||= {});
    Object.assign(o, patch);
    for (const k of Object.keys(o)) if (o[k] === undefined || o[k] === null) delete o[k];
    this.emit('device', id);
    if ('roomId' in patch || 'favorite' in patch || 'hidden' in patch || 'name' in patch) this.structure();
    this.save();
  },

  /* ---------- rooms ---------- */
  room(id) {
    return this.state.rooms.find((r) => r.id === id) || null;
  },
  ensureRoom(name, icon) {
    if (!name) return null;
    const n = String(name).trim();
    const ex = this.state.rooms.find((r) => r.name.toLowerCase() === n.toLowerCase());
    if (ex) return ex.id;
    const room = { id: uid('room-'), name: n, icon: icon || guessRoomIcon(n) };
    this.state.rooms.push(room);
    this.structure();
    this.save();
    return room.id;
  },
  updateRoom(id, patch) {
    const r = this.room(id);
    if (!r) return;
    Object.assign(r, patch);
    this.structure();
    this.save();
  },
  deleteRoom(id) {
    this.state.rooms = this.state.rooms.filter((r) => r.id !== id);
    for (const d of Object.values(this.state.devices)) if (d.roomId === id) d.roomId = null;
    for (const o of Object.values(this.state.overrides)) if (o.roomId === id) delete o.roomId;
    this.structure();
    this.save();
  },
  moveRoom(id, dir) {
    const i = this.state.rooms.findIndex((r) => r.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= this.state.rooms.length) return;
    const arr = this.state.rooms;
    [arr[i], arr[j]] = [arr[j], arr[i]];
    this.structure();
    this.save();
  },

  /* ---------- misc ---------- */
  setSettings(patch) {
    Object.assign(this.state.settings, patch);
    this.emit('settings');
    this.save();
  },
  log(text, icon = 'activity') {
    this.state.log.unshift({ t: Date.now(), text, icon });
    this.state.log.length = Math.min(this.state.log.length, 80);
    this.emit('log');
    this.save();
  },
  reset() {
    localStorage.removeItem(KEY);
    location.reload();
  },
  exportJSON() {
    const { devices, ...rest } = this.state; // live device state is re-synced from integrations
    return JSON.stringify({ app: 'smart-dash', exported: new Date().toISOString(), ...rest }, null, 2);
  },
  importJSON(text) {
    const data = JSON.parse(text);
    if (data.app !== 'smart-dash') throw new Error('This file is not a Smart Dash backup.');
    delete data.app;
    delete data.exported;
    localStorage.setItem(KEY, JSON.stringify({ ...defaults(), ...data, devices: {} }));
    location.reload();
  },
};
