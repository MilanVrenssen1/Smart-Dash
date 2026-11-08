// Energy estimation and short-term history for charts and sparklines.

import { store } from './store.js';
import { estimateWatts } from './devices.js';

const SAMPLE_MS = 5000;
export const live = []; // [{t, w}] last ~10 minutes
const sensorHist = new Map(); // id -> [{t, v}]
let last = Date.now();

const hourKey = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}T${String(d.getHours()).padStart(2, '0')}`;

export function breakdown() {
  return store
    .devices()
    .filter((d) => d.type !== 'sensor')
    .map((d) => ({ d, w: estimateWatts(d) }))
    .sort((a, b) => b.w - a.w);
}

export const totalWatts = () => breakdown().reduce((s, x) => s + x.w, 0);

export function todayKWh() {
  const prefix = hourKey().slice(0, 10);
  let wh = 0;
  for (const [k, v] of Object.entries(store.state.energy.hours)) if (k.startsWith(prefix)) wh += v;
  return wh / 1000;
}

/** Last 24 hourly buckets, oldest first: [{key, label, kwh, current}] */
export function last24() {
  const out = [];
  const now = new Date();
  for (let i = 23; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 3600e3);
    const k = hourKey(d);
    out.push({ key: k, hour: d.getHours(), kwh: (store.state.energy.hours[k] || 0) / 1000, current: i === 0 });
  }
  return out;
}

export const sensorHistory = (id) => sensorHist.get(id) || [];

function sample() {
  const now = Date.now();
  const dt = Math.min(now - last, 60000) / 1000;
  last = now;
  const w = totalWatts();
  if (!live.length) for (let i = 8; i > 0; i--) live.push({ t: now - i * SAMPLE_MS, w });
  live.push({ t: now, w });
  while (live.length > 120) live.shift();
  const k = hourKey();
  const hours = store.state.energy.hours;
  hours[k] = (hours[k] || 0) + (w * dt) / 3600;
  // prune > 48h
  const cutoff = hourKey(new Date(now - 48 * 3600e3));
  for (const key of Object.keys(hours)) if (key < cutoff) delete hours[key];

  for (const d of store.devices()) {
    let v = null;
    if (d.type === 'sensor' && typeof d.state.value === 'number') v = d.state.value;
    else if (d.type === 'thermostat' && typeof d.state.current === 'number') v = d.state.current;
    else if ((d.type === 'outlet' || d.type === 'switch') && typeof d.state.power === 'number') v = d.state.power;
    if (v == null) continue;
    const arr = sensorHist.get(d.id) || [];
    arr.push({ t: now, v });
    while (arr.length > 90) arr.shift();
    sensorHist.set(d.id, arr);
  }
  store.save();
  store.emit('energy');
}

/** Give the demo home a believable past so the charts aren't empty on first launch. */
function seedDemo() {
  const e = store.state.energy;
  if (e.seeded || !store.state.integrations.demo.enabled) return;
  const now = new Date();
  for (let i = 23; i >= 1; i--) {
    const d = new Date(now.getTime() - i * 3600e3);
    const h = d.getHours();
    const base = 180;
    const morning = h >= 6 && h <= 9 ? 650 : 0;
    const evening = h >= 17 && h <= 22 ? 900 : 0;
    const night = h < 6 ? -60 : 0;
    const wh = base + morning + evening + night + Math.random() * 120;
    e.hours[hourKey(d)] = (e.hours[hourKey(d)] || 0) + wh;
  }
  e.seeded = true;
  store.save();
}

export function startEnergy() {
  seedDemo();
  setTimeout(sample, 1500);
  setInterval(sample, SAMPLE_MS);
}
