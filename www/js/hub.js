// The hub routes user intent to the right integration and keeps the store in sync.

import { store } from './store.js';
import { INTEGRATIONS } from './integrations/index.js';
import { describeChange, typeDef } from './devices.js';
import { toast } from './ui.js';

const status = {}; // integrationId -> { state, message }
const throttles = {}; // deviceId -> { timer, patch, last }

function setStatus(id, state, message = '') {
  status[id] = { state, message, at: Date.now() };
  store.emit('integration', id);
}

function apiFor(integId) {
  const fullId = (nid) => `${integId}:${nid}`;
  return {
    id: integId,
    upsert(dev) {
      store.upsertDevice({ ...dev, id: fullId(dev.nid), integration: integId });
    },
    /** Upsert a full list and drop devices of this integration that disappeared. */
    sync(list) {
      const keep = new Set(list.map((d) => fullId(d.nid)));
      list.forEach((d) => this.upsert(d));
      store.removeDevices((d) => d.integration === integId && !keep.has(d.id));
    },
    update(nid, patch) {
      store.patchDevice(fullId(nid), patch);
    },
    remove(nid) {
      store.removeDevices((d) => d.id === fullId(nid));
    },
    get(nid) {
      return store.device(fullId(nid));
    },
    devices() {
      return store.devices({ includeHidden: true }).filter((d) => d.integration === integId);
    },
    ensureRoom: (name, icon) => store.ensureRoom(name, icon),
    log: (text, icon) => store.log(text, icon),
    status: (state, message) => setStatus(integId, state, message),
    config: () => store.state.integrations[integId],
    saveConfig(patch) {
      Object.assign(store.state.integrations[integId], patch);
      store.save();
    },
  };
}

export const hub = {
  status,
  statusOf: (id) => status[id] || { state: store.state.integrations[id]?.enabled ? 'connecting' : 'off' },

  start() {
    for (const id of Object.keys(INTEGRATIONS)) {
      if (store.state.integrations[id]?.enabled) this.connect(id).catch(() => {});
      else setStatus(id, 'off');
    }
  },

  async connect(id) {
    const integ = INTEGRATIONS[id];
    if (!integ) throw new Error(`Unknown integration ${id}`);
    try { await integ.disconnect?.(); } catch { /* ignore */ }
    setStatus(id, 'connecting');
    try {
      await integ.connect(store.state.integrations[id], apiFor(id));
      setStatus(id, 'connected');
    } catch (e) {
      console.warn(`[${id}]`, e);
      setStatus(id, 'error', e?.message || String(e));
      throw e;
    }
  },

  async enable(id, config = {}) {
    Object.assign(store.state.integrations[id], config, { enabled: true });
    store.save();
    await this.connect(id);
    store.log(`${INTEGRATIONS[id].name} connected`, INTEGRATIONS[id].icon);
  },

  async disable(id) {
    try { await INTEGRATIONS[id].disconnect?.(); } catch { /* ignore */ }
    store.state.integrations[id].enabled = false;
    store.save();
    store.removeDevices((d) => d.integration === id);
    setStatus(id, 'off');
    store.log(`${INTEGRATIONS[id].name} disconnected`, 'link');
  },

  /** Apply a state patch to a device: optimistic UI, then the integration call. */
  async set(id, patch, { log = true, silent = false } = {}) {
    const d = store.device(id);
    if (!d) return false;
    const integ = INTEGRATIONS[d.integration];
    const prev = { ...d.state };
    store.patchDevice(id, patch);
    try {
      await integ?.setState?.(d, patch, prev);
      if (log) store.log(describeChange(d, patch), typeDef(d).icon(d.state, d.attrs));
      return true;
    } catch (e) {
      console.warn('setState failed', e);
      const revert = {};
      for (const k of Object.keys(patch)) revert[k] = prev[k];
      store.patchDevice(id, revert);
      if (!silent) toast(`Couldn't reach ${d.name}`, { icon: 'alert', type: 'error', detail: e?.message });
      return false;
    }
  },

  /** For sliders: update UI instantly, send to the device at most every ~140ms. */
  setThrottled(id, patch, { final = false } = {}) {
    const t = (throttles[id] ||= { timer: null, patch: {}, last: 0 });
    Object.assign(t.patch, patch);
    const d = store.device(id);
    if (d) store.patchDevice(id, patch);
    const flush = () => {
      clearTimeout(t.timer);
      t.timer = null;
      const p = t.patch;
      t.patch = {};
      t.last = Date.now();
      const dev = store.device(id);
      if (!dev || !Object.keys(p).length) return;
      INTEGRATIONS[dev.integration]?.setState?.(dev, p, {})?.catch?.((e) => console.warn(e));
    };
    if (final) {
      flush();
      if (d) store.log(describeChange(d, patch), typeDef(d).icon(d.state, d.attrs));
      return;
    }
    const wait = 140 - (Date.now() - t.last);
    if (wait <= 0) flush();
    else if (!t.timer) t.timer = setTimeout(flush, wait);
  },

  async command(id, cmd, args) {
    const d = store.device(id);
    if (!d) return;
    const integ = INTEGRATIONS[d.integration];
    try {
      await integ?.command?.(d, cmd, args);
    } catch (e) {
      toast(`Couldn't reach ${d.name}`, { icon: 'alert', type: 'error', detail: e?.message });
    }
  },

  quickToggle(id) {
    const d = store.device(id);
    if (!d) return null;
    const def = typeDef(d);
    if (def.command) {
      this.command(id, def.command(d.state));
      return true;
    }
    const patch = def.quick?.(d.state);
    if (!patch) return null;
    this.set(id, patch);
    return true;
  },

  /** Resolve a scene/routine target ('homeassistant:light.x', 'type:light', 'room:<id>') to device ids. */
  resolve(target) {
    if (target.startsWith('type:')) {
      const t = target.slice(5);
      return store.devices().filter((d) => d.type === t).map((d) => d.id);
    }
    if (target.startsWith('room:')) {
      const r = target.slice(5);
      return store.devices().filter((d) => d.roomId === r).map((d) => d.id);
    }
    return store.state.devices[target] ? [target] : [];
  },

  async runScene(sceneId, { silent = false } = {}) {
    const scene = store.state.scenes.find((s) => s.id === sceneId);
    if (!scene) return;
    const jobs = [];
    for (const a of scene.actions) {
      for (const id of this.resolve(a.target)) {
        const d = store.device(id);
        if (!d) continue;
        if (a.cmd) jobs.push(this.command(id, a.cmd));
        if (a.patch) {
          // Only send keys that make sense for this device type.
          const patch = filterPatch(d, a.patch);
          if (Object.keys(patch).length) jobs.push(this.set(id, patch, { log: false, silent: true }));
        }
      }
    }
    await Promise.allSettled(jobs);
    store.log(`Scene “${scene.name}” activated`, scene.icon);
    if (!silent) toast(`${scene.name} activated`, { icon: scene.icon, type: 'success' });
  },

  async setAll(ids, patchFn, label) {
    const jobs = ids.map((id) => {
      const d = store.device(id);
      const patch = d && patchFn(d);
      return patch ? this.set(id, patch, { log: false, silent: true }) : null;
    });
    await Promise.allSettled(jobs.filter(Boolean));
    if (label) store.log(label, 'sparkles');
  },
};

const ALLOWED = {
  light: ['on', 'brightness', 'color', 'colorTemp'],
  switch: ['on'], outlet: ['on'], fan: ['on', 'speed'],
  thermostat: ['mode', 'target'], lock: ['locked'], cover: ['position'],
  media: ['on', 'playing', 'volume'], vacuum: [], sensor: [],
};
function filterPatch(d, patch) {
  const allow = ALLOWED[d.type] || [];
  const out = {};
  for (const [k, v] of Object.entries(patch)) if (allow.includes(k)) out[k] = v;
  if (d.type === 'light') {
    if (out.color && !d.attrs.supportsColor) delete out.color;
    if (out.colorTemp && !d.attrs.supportsTemp) delete out.colorTemp;
    if (out.on === false) return { on: false };
  }
  if (d.type === 'thermostat' && out.mode && d.attrs.modes && !d.attrs.modes.includes(out.mode)) delete out.mode;
  return out;
}
