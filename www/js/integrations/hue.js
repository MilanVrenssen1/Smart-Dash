// Philips Hue via the local bridge API (no cloud needed).

import { hexToXy, xyToHex, hsToHex, sleep } from '../util.js';

let api = null;
let cfg = null;
let poll = null;
const lastWrite = {};

const base = () => `http://${String(cfg.bridge).trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '')}/api/${cfg.username}`;

async function hueFetch(path, opts = {}) {
  // No custom headers: keeps the request "simple" so the bridge needs no CORS preflight.
  const res = await fetch(base() + path, opts);
  if (!res.ok) throw new Error(`Hue bridge error ${res.status}`);
  const data = await res.json();
  if (Array.isArray(data) && data[0]?.error) throw new Error(data[0].error.description);
  return data;
}

function mapLight(id, l, roomOf) {
  const s = l.state || {};
  const supportsColor = Array.isArray(s.xy) || s.hue != null;
  const supportsTemp = s.ct != null;
  let color = null;
  if (s.colormode === 'xy' && s.xy) color = xyToHex(s.xy[0], s.xy[1]);
  else if (s.colormode === 'hs' && s.hue != null) color = hsToHex((s.hue / 65535) * 360, (s.sat / 254) * 100);
  const ctK = s.colormode === 'ct' && s.ct ? Math.round(1e6 / s.ct) : null;
  const caps = l.capabilities?.control?.ct;
  return {
    nid: id,
    name: l.name,
    type: 'light',
    roomId: roomOf[id] ? api.ensureRoom(roomOf[id]) : undefined,
    attrs: {
      supportsColor, supportsTemp, dimmable: s.bri != null, available: s.reachable !== false,
      minK: caps?.max ? Math.round(1e6 / caps.max) : 2200, maxK: caps?.min ? Math.round(1e6 / caps.min) : 6500,
    },
    state: {
      on: !!s.on && s.reachable !== false,
      brightness: s.bri != null ? Math.max(1, Math.round((s.bri / 254) * 100)) : 100,
      color, colorTemp: ctK,
    },
  };
}

async function refresh(initial = false) {
  const [lights, groups] = await Promise.all([hueFetch('/lights'), hueFetch('/groups').catch(() => ({}))]);
  const roomOf = {};
  for (const g of Object.values(groups)) {
    if (g.type === 'Room' || g.type === 'Zone') for (const lid of g.lights || []) if (!roomOf[lid] || g.type === 'Room') roomOf[lid] = g.name;
  }
  const list = Object.entries(lights).map(([id, l]) => mapLight(id, l, roomOf));
  if (initial) api.sync(list);
  else
    for (const d of list) {
      if (Date.now() - (lastWrite[d.nid] || 0) < 2500) continue; // don't fight the user's slider
      if (api.get(d.nid)) api.update(d.nid, d.state);
      else api.upsert(d);
    }
  return list.length;
}

export default {
  id: 'hue',
  name: 'Philips Hue',
  icon: 'bulb',
  color: '#f6c344',
  tagline: 'Local, instant control of your Hue lights',
  description: 'Talks directly to your Hue Bridge on your Wi-Fi. Rooms and zones are imported automatically.',
  help: 'Tap “Find bridge”, then press the round link button on top of your Hue Bridge and tap “Pair” within 30 seconds.',
  fields: [
    { key: 'bridge', label: 'Bridge IP address', type: 'text', placeholder: '192.168.1.20', required: true },
    { key: 'username', label: 'App key', type: 'password', placeholder: 'Created when you pair', required: true },
  ],
  extras: [
    {
      label: 'Find bridge', icon: 'search',
      async run(values) {
        const res = await fetch('https://discovery.meethue.com/');
        const list = await res.json();
        if (!list.length) throw new Error('No bridge found on your network. Enter its IP address manually.');
        return { bridge: list[0].internalipaddress, _message: `Found bridge at ${list[0].internalipaddress}` };
      },
    },
    {
      label: 'Pair', icon: 'link',
      async run(values) {
        if (!values.bridge) throw new Error('Enter the bridge IP address first.');
        const ip = values.bridge.trim().replace(/^https?:\/\//, '');
        for (let i = 0; i < 15; i++) {
          const res = await fetch(`http://${ip}/api`, { method: 'POST', body: JSON.stringify({ devicetype: 'smartdash#app' }) });
          const data = await res.json();
          if (data[0]?.success?.username) return { username: data[0].success.username, _message: 'Paired with your Hue Bridge' };
          if (data[0]?.error?.type !== 101) throw new Error(data[0]?.error?.description || 'Pairing failed');
          await sleep(2000); // waiting for the link button
        }
        throw new Error('Press the link button on the bridge, then try again.');
      },
    },
  ],

  async connect(c, a) {
    cfg = c;
    api = a;
    if (!cfg.bridge || !cfg.username) throw new Error('Pair with your bridge first.');
    await refresh(true);
    clearInterval(poll);
    poll = setInterval(() => refresh().then(() => api.status('connected')).catch((e) => api.status('error', e.message)), 4000);
  },

  async disconnect() {
    clearInterval(poll);
    poll = null;
  },

  async setState(d, patch) {
    lastWrite[d.nid] = Date.now();
    const body = { transitiontime: 3 };
    if ('on' in patch) body.on = patch.on;
    if (patch.brightness != null) {
      if (patch.brightness <= 0) body.on = false;
      else { body.bri = Math.max(1, Math.round(patch.brightness * 2.54)); body.on = true; }
    }
    if (patch.color) { body.xy = hexToXy(patch.color); body.on = true; }
    if (patch.colorTemp) { body.ct = Math.round(1e6 / patch.colorTemp); body.on = true; }
    await hueFetch(`/lights/${d.nid}/state`, { method: 'PUT', body: JSON.stringify(body) });
  },
};
