// Home Assistant via its WebSocket API. Home Assistant bridges thousands of
// brands (Zigbee, Z-Wave, Matter, Google/Nest, Tuya, Sonos, Ring, ...), so this
// one integration lets Smart Dash control nearly anything.

import { hexToRgb, rgbToHex } from '../util.js';

let ws = null;
let api = null;
let cfg = null;
let msgId = 1;
let pending = new Map();
let stateSubId = null;
let reconnectTimer = null;
let closedByUser = false;
let backoff = 1000;
let areaOf = new Map(); // entity_id -> area name
let entityMeta = new Map(); // entity_id -> registry entry

const SENSOR_CLASSES = new Set(['temperature', 'humidity', 'power', 'energy', 'carbon_dioxide', 'pm25', 'illuminance', 'battery', 'aqi', 'volatile_organic_compounds']);
const BINARY_CLASSES = new Set(['motion', 'occupancy', 'presence', 'door', 'garage_door', 'window', 'opening', 'moisture', 'smoke', 'gas']);
const KIND = { carbon_dioxide: 'co2', pm25: 'air', aqi: 'air', volatile_organic_compounds: 'air', presence: 'occupancy', garage_door: 'door', opening: 'door', gas: 'smoke' };

function baseUrl() {
  let u = String(cfg.url || '').trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(u)) u = 'http://' + u;
  return u;
}

function send(msg) {
  return new Promise((resolve, reject) => {
    if (!ws || ws.readyState !== 1) return reject(new Error('Not connected to Home Assistant'));
    const id = msgId++;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, ...msg }));
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        reject(new Error('Home Assistant did not respond'));
      }
    }, 15000);
  });
}

const callService = (domain, service, entity_id, data = {}) =>
  send({ type: 'call_service', domain, service, service_data: data, target: { entity_id } });

function mapEntity(st) {
  const [domain] = st.entity_id.split('.');
  const a = st.attributes || {};
  const meta = entityMeta.get(st.entity_id);
  if (meta && (meta.hidden_by || meta.disabled_by || meta.entity_category)) return null;
  if (st.state === 'unavailable' && domain === 'sensor') return null;
  const name = a.friendly_name || st.entity_id;
  const base = { nid: st.entity_id, name, attrs: { domain, entityId: st.entity_id, available: st.state !== 'unavailable' } };
  const area = areaOf.get(st.entity_id);
  if (area) base.roomId = api.ensureRoom(area);

  switch (domain) {
    case 'light': {
      const modes = a.supported_color_modes || [];
      const color = modes.some((m) => ['hs', 'xy', 'rgb', 'rgbw', 'rgbww'].includes(m));
      const temp = modes.includes('color_temp');
      const dimmable = !(modes.length === 1 && modes[0] === 'onoff');
      const on = st.state === 'on';
      return {
        ...base, type: 'light',
        attrs: { ...base.attrs, supportsColor: color, supportsTemp: temp, dimmable, minK: a.min_color_temp_kelvin || 2200, maxK: a.max_color_temp_kelvin || 6500 },
        state: {
          on,
          brightness: a.brightness != null ? Math.max(1, Math.round((a.brightness / 255) * 100)) : on ? 100 : 0,
          color: a.color_mode && a.color_mode !== 'color_temp' && a.rgb_color ? rgbToHex(...a.rgb_color) : null,
          colorTemp: a.color_mode === 'color_temp' ? a.color_temp_kelvin : null,
        },
      };
    }
    case 'switch':
    case 'input_boolean':
      return { ...base, type: a.device_class === 'outlet' ? 'outlet' : 'switch', state: { on: st.state === 'on' } };
    case 'fan':
      return { ...base, type: 'fan', state: { on: st.state === 'on', speed: a.percentage ?? (st.state === 'on' ? 100 : 0) } };
    case 'cover': {
      const pos = a.current_position ?? (st.state === 'open' ? 100 : 0);
      return {
        ...base, type: 'cover',
        attrs: { ...base.attrs, deviceClass: a.device_class === 'garage' ? 'garage' : a.device_class, positionable: a.current_position != null },
        state: { position: pos, moving: st.state === 'opening' ? 'opening' : st.state === 'closing' ? 'closing' : null },
      };
    }
    case 'climate':
      return {
        ...base, type: 'thermostat',
        attrs: { ...base.attrs, modes: a.hvac_modes || ['off', 'heat'], min: a.min_temp ?? 7, max: a.max_temp ?? 30, step: a.target_temp_step || 0.5 },
        state: { mode: st.state, target: a.temperature ?? a.target_temp_high ?? null, current: a.current_temperature ?? null, humidity: a.current_humidity ?? null },
      };
    case 'lock':
      return { ...base, type: 'lock', state: { locked: st.state === 'locked', jammed: st.state === 'jammed' } };
    case 'media_player': {
      let art = a.entity_picture || null;
      if (art && art.startsWith('/')) art = baseUrl() + art;
      return {
        ...base, type: 'media',
        attrs: { ...base.attrs, kind: a.device_class === 'tv' ? 'tv' : 'speaker' },
        state: {
          on: !['off', 'unavailable', 'standby'].includes(st.state),
          playing: st.state === 'playing',
          volume: a.volume_level != null ? Math.round(a.volume_level * 100) : null,
          title: a.media_title || null, artist: a.media_artist || a.app_name || null, art,
        },
      };
    }
    case 'vacuum':
      return { ...base, type: 'vacuum', state: { status: st.state, battery: a.battery_level ?? null } };
    case 'sensor': {
      if (!SENSOR_CLASSES.has(a.device_class)) return null;
      const v = parseFloat(st.state);
      if (Number.isNaN(v)) return null;
      return { ...base, type: 'sensor', state: { value: v, unit: a.unit_of_measurement || '', kind: KIND[a.device_class] || a.device_class } };
    }
    case 'binary_sensor': {
      if (!BINARY_CLASSES.has(a.device_class)) return null;
      return { ...base, type: 'sensor', state: { value: st.state === 'on', kind: KIND[a.device_class] || a.device_class } };
    }
    default:
      return null;
  }
}

async function loadEverything() {
  const safe = (p) => p.catch(() => []);
  const [areas, entities, devices, states] = await Promise.all([
    safe(send({ type: 'config/area_registry/list' })),
    safe(send({ type: 'config/entity_registry/list' })),
    safe(send({ type: 'config/device_registry/list' })),
    send({ type: 'get_states' }),
  ]);
  const areaName = new Map(areas.map((a) => [a.area_id, a.name]));
  const devArea = new Map(devices.map((d) => [d.id, d.area_id]));
  entityMeta = new Map(entities.map((e) => [e.entity_id, e]));
  areaOf = new Map();
  for (const e of entities) {
    const aid = e.area_id || devArea.get(e.device_id);
    if (aid && areaName.has(aid)) areaOf.set(e.entity_id, areaName.get(aid));
  }
  const list = states.map(mapEntity).filter(Boolean);
  api.sync(list);
  const sub = await send({ type: 'subscribe_events', event_type: 'state_changed' }).catch(() => null);
  return list.length;
}

function onMessage(ev) {
  let msg;
  try { msg = JSON.parse(ev.data); } catch { return; }
  if (msg.type === 'result' && pending.has(msg.id)) {
    const p = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.success) p.resolve(msg.result);
    else p.reject(new Error(msg.error?.message || 'Home Assistant error'));
    return;
  }
  if (msg.type === 'event' && msg.event?.event_type === 'state_changed') {
    const ns = msg.event.data?.new_state;
    if (!ns) {
      api.remove(msg.event.data?.entity_id);
      return;
    }
    const dev = mapEntity(ns);
    if (!dev) return;
    if (api.get(dev.nid)) api.update(dev.nid, dev.state);
    else api.upsert(dev);
  }
}

function open() {
  return new Promise((resolve, reject) => {
    const url = baseUrl().replace(/^http/i, 'ws') + '/api/websocket';
    let settled = false;
    try {
      ws = new WebSocket(url);
    } catch (e) {
      return reject(new Error('Invalid Home Assistant URL'));
    }
    const fail = (err) => {
      if (!settled) { settled = true; reject(err); }
    };
    const timeout = setTimeout(() => fail(new Error('Timed out connecting to Home Assistant. Check the URL and that this device is on the same network.')), 12000);
    ws.onmessage = async (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      if (msg.type === 'auth_required') {
        ws.send(JSON.stringify({ type: 'auth', access_token: cfg.token }));
      } else if (msg.type === 'auth_invalid') {
        clearTimeout(timeout);
        closedByUser = true;
        fail(new Error('Home Assistant rejected the access token.'));
        ws.close();
      } else if (msg.type === 'auth_ok') {
        clearTimeout(timeout);
        ws.onmessage = onMessage;
        try {
          const n = await loadEverything();
          backoff = 1000;
          settled = true;
          resolve(n);
        } catch (e) {
          fail(e);
        }
      }
    };
    ws.onerror = () => {
      clearTimeout(timeout);
      fail(new Error(location.protocol === 'https:' && url.startsWith('ws:')
        ? 'Browsers block insecure ws:// from an https page. Use your https:// Home Assistant URL (e.g. Nabu Casa) or the Android app.'
        : 'Could not reach Home Assistant at that address.'));
    };
    ws.onclose = () => {
      pending.forEach((p) => p.reject(new Error('Connection closed')));
      pending.clear();
      if (!closedByUser && settled) scheduleReconnect();
    };
  });
}

function scheduleReconnect() {
  clearTimeout(reconnectTimer);
  api?.status('connecting', 'Reconnecting…');
  reconnectTimer = setTimeout(async () => {
    try {
      await open();
      api.status('connected');
    } catch (e) {
      backoff = Math.min(backoff * 2, 30000);
      api.status('error', e.message);
      scheduleReconnect();
    }
  }, backoff);
}

export default {
  id: 'homeassistant',
  name: 'Home Assistant',
  icon: 'hub',
  color: '#41bdf5',
  tagline: 'Zigbee, Z-Wave, Matter, Nest, Tuya, Sonos & 2,000+ more',
  description: 'Connect your Home Assistant server and every device it knows about appears here automatically — with rooms imported from your areas and live, two-way updates.',
  help: 'In Home Assistant open your profile → Security → Long-lived access tokens → Create token. Use the same URL you open Home Assistant with (e.g. http://homeassistant.local:8123 or your Nabu Casa https address).',
  fields: [
    { key: 'url', label: 'Server URL', type: 'url', placeholder: 'http://homeassistant.local:8123', required: true },
    { key: 'token', label: 'Long-lived access token', type: 'password', placeholder: 'eyJhbGciOi…', required: true },
  ],

  async connect(c, a) {
    cfg = c;
    api = a;
    closedByUser = false;
    if (!cfg.url || !cfg.token) throw new Error('Enter your server URL and an access token.');
    await open();
  },

  async disconnect() {
    closedByUser = true;
    clearTimeout(reconnectTimer);
    try { ws?.close(); } catch { /* ignore */ }
    ws = null;
  },

  async setState(d, patch) {
    const id = d.attrs.entityId || d.nid;
    const domain = d.attrs.domain;
    switch (d.type) {
      case 'light': {
        if (patch.on === false || patch.brightness === 0) return callService('light', 'turn_off', id);
        const data = {};
        if (patch.brightness != null) data.brightness_pct = Math.round(patch.brightness);
        if (patch.color) data.rgb_color = hexToRgb(patch.color);
        if (patch.colorTemp) data.color_temp_kelvin = Math.round(patch.colorTemp);
        return callService('light', 'turn_on', id, data);
      }
      case 'switch':
      case 'outlet':
        return callService(domain || 'switch', patch.on ? 'turn_on' : 'turn_off', id);
      case 'fan':
        if (patch.on === false) return callService('fan', 'turn_off', id);
        if (patch.speed != null) return callService('fan', 'set_percentage', id, { percentage: Math.round(patch.speed) });
        return callService('fan', 'turn_on', id);
      case 'cover':
        if (patch.position != null) {
          if (d.attrs.positionable) return callService('cover', 'set_cover_position', id, { position: Math.round(patch.position) });
          return callService('cover', patch.position > 0 ? 'open_cover' : 'close_cover', id);
        }
        return;
      case 'thermostat':
        if (patch.mode) await callService('climate', 'set_hvac_mode', id, { hvac_mode: patch.mode });
        if (patch.target != null) await callService('climate', 'set_temperature', id, { temperature: patch.target });
        return;
      case 'lock':
        return callService('lock', patch.locked ? 'lock' : 'unlock', id);
      case 'media':
        if (patch.on === false) return callService('media_player', 'turn_off', id);
        if (patch.volume != null) await callService('media_player', 'volume_set', id, { volume_level: patch.volume / 100 });
        if (patch.playing != null) await callService('media_player', patch.playing ? 'media_play' : 'media_pause', id);
        return;
      default:
    }
  },

  async command(d, cmd) {
    const id = d.attrs.entityId || d.nid;
    if (d.type === 'vacuum') {
      const svc = { start: 'start', pause: 'pause', dock: 'return_to_base', stop: 'stop' }[cmd];
      if (svc) return callService('vacuum', svc, id);
    }
    if (d.type === 'media') {
      const svc = { next: 'media_next_track', prev: 'media_previous_track' }[cmd];
      if (svc) return callService('media_player', svc, id);
    }
    if (d.type === 'cover' && cmd === 'stop') return callService('cover', 'stop_cover', id);
  },
};
