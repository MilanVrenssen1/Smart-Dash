// A fully simulated home so the app is alive out of the box.

import { sleep, clamp } from '../util.js';

const ROOMS = {
  'Living Room': 'sofa', Kitchen: 'utensils', Bedroom: 'bed', Office: 'monitor',
  Bathroom: 'bath', Entrance: 'door', Garage: 'car', Garden: 'tree',
};

const DEVICES = [
  { nid: 'lr-ceiling', name: 'Ceiling Light', type: 'light', room: 'Living Room', state: { on: true, brightness: 72, colorTemp: 3000 }, attrs: { dimmable: true, supportsTemp: true, minK: 2200, maxK: 6500, watts: 12 } },
  { nid: 'lr-strip', name: 'Ambient Strip', type: 'light', room: 'Living Room', state: { on: true, brightness: 55, color: '#7c5cff' }, attrs: { dimmable: true, supportsColor: true, supportsTemp: true, minK: 2200, maxK: 6500, watts: 14 } },
  { nid: 'lr-tv', name: 'Living Room TV', type: 'media', room: 'Living Room', state: { on: true, playing: false, volume: 28, title: 'Interstellar', artist: 'Main Theme', source: 'Netflix' }, attrs: { kind: 'tv' } },
  { nid: 'lr-blinds', name: 'Window Blinds', type: 'cover', room: 'Living Room', state: { position: 65 }, attrs: {} },
  { nid: 'lr-climate', name: 'Thermostat', type: 'thermostat', room: 'Living Room', state: { mode: 'heat', target: 21.5, current: 20.6, humidity: 44 }, attrs: { modes: ['off', 'heat', 'cool', 'auto'], min: 7, max: 30, step: 0.5 } },
  { nid: 'vac', name: 'Robo Vacuum', type: 'vacuum', room: 'Living Room', state: { status: 'docked', battery: 100 }, attrs: {} },
  { nid: 'k-pendant', name: 'Kitchen Pendants', type: 'light', room: 'Kitchen', state: { on: false, brightness: 100, colorTemp: 4000 }, attrs: { dimmable: true, supportsTemp: true, minK: 2700, maxK: 6500, watts: 18 } },
  { nid: 'k-coffee', name: 'Coffee Machine', type: 'outlet', room: 'Kitchen', state: { on: false, power: 0 }, attrs: { icon: 'coffee' } },
  { nid: 'k-speaker', name: 'Kitchen Speaker', type: 'media', room: 'Kitchen', state: { on: true, playing: true, volume: 35, title: 'Midnight City', artist: 'M83' }, attrs: { kind: 'speaker' } },
  { nid: 'k-air', name: 'Air Quality', type: 'sensor', room: 'Kitchen', state: { value: 612, unit: 'ppm', kind: 'co2' } },
  { nid: 'b-lamp', name: 'Bedside Lamp', type: 'light', room: 'Bedroom', state: { on: false, brightness: 30, color: '#ff8a5b' }, attrs: { dimmable: true, supportsColor: true, supportsTemp: true, minK: 2200, maxK: 6500, watts: 8 } },
  { nid: 'b-fan', name: 'Ceiling Fan', type: 'fan', room: 'Bedroom', state: { on: false, speed: 40 } },
  { nid: 'b-temp', name: 'Bedroom Temperature', type: 'sensor', room: 'Bedroom', state: { value: 19.6, unit: '°C', kind: 'temperature' } },
  { nid: 'b-blinds', name: 'Bedroom Curtains', type: 'cover', room: 'Bedroom', state: { position: 0 }, attrs: {} },
  { nid: 'o-desk', name: 'Desk Lamp', type: 'light', room: 'Office', state: { on: true, brightness: 90, colorTemp: 5000 }, attrs: { dimmable: true, supportsTemp: true, minK: 2700, maxK: 6500, watts: 7 } },
  { nid: 'o-pc', name: 'Workstation', type: 'outlet', room: 'Office', state: { on: true, power: 142 }, attrs: { icon: 'cpu' } },
  { nid: 'o-motion', name: 'Office Motion', type: 'sensor', room: 'Office', state: { value: false, kind: 'motion' } },
  { nid: 'ba-mirror', name: 'Mirror Light', type: 'light', room: 'Bathroom', state: { on: false, brightness: 100, colorTemp: 4500 }, attrs: { dimmable: true, supportsTemp: true, minK: 2700, maxK: 6500, watts: 10 } },
  { nid: 'ba-humid', name: 'Bathroom Humidity', type: 'sensor', room: 'Bathroom', state: { value: 58, unit: '%', kind: 'humidity' } },
  { nid: 'e-lock', name: 'Front Door', type: 'lock', room: 'Entrance', state: { locked: true, battery: 86 } },
  { nid: 'e-door', name: 'Door Contact', type: 'sensor', room: 'Entrance', state: { value: false, kind: 'door' } },
  { nid: 'e-light', name: 'Porch Light', type: 'light', room: 'Entrance', state: { on: false, brightness: 100 }, attrs: { dimmable: false, watts: 6 } },
  { nid: 'g-door', name: 'Garage Door', type: 'cover', room: 'Garage', state: { position: 0 }, attrs: { deviceClass: 'garage' } },
  { nid: 'g-charger', name: 'EV Charger', type: 'outlet', room: 'Garage', state: { on: false, power: 0 }, attrs: { icon: 'car' } },
  { nid: 'gd-lights', name: 'Garden Lights', type: 'switch', room: 'Garden', state: { on: false }, attrs: { icon: 'tree', watts: 40 } },
  { nid: 'gd-sprinkler', name: 'Sprinklers', type: 'switch', room: 'Garden', state: { on: false }, attrs: { icon: 'sprinkler', watts: 8 } },
];

const TRACKS = [
  ['Midnight City', 'M83'], ['Intro', 'The xx'], ['Breathe', 'Télépopmusik'],
  ['Teardrop', 'Massive Attack'], ['Sunset Lover', 'Petit Biscuit'], ['Nightcall', 'Kavinsky'],
];
const SHOWS = [['Interstellar', 'Main Theme'], ['Blade Runner 2049', 'Netflix'], ['Planet Earth III', 'BBC'], ['Dune: Part Two', 'Max']];

const POWER = { 'k-coffee': 1350, 'o-pc': 142, 'g-charger': 7200 };

let api = null;
let timer = null;
let tick = 0;
const moveTimers = {};

function step() {
  if (!api) return;
  tick++;
  const get = (nid) => api.get(nid);
  // Thermostat drifts toward its target.
  const th = get('lr-climate');
  if (th) {
    const s = th.state;
    let cur = s.current;
    if (s.mode === 'heat' && cur < s.target) cur += 0.05;
    else if (s.mode === 'cool' && cur > s.target) cur -= 0.05;
    else if (s.mode === 'auto') cur += Math.sign(s.target - cur) * 0.04;
    else cur += (19.5 - cur) * 0.01 + (Math.random() - 0.5) * 0.02;
    api.update('lr-climate', { current: Math.round(cur * 10) / 10, humidity: clamp(Math.round(s.humidity + (Math.random() - 0.5) * 1.2), 35, 60) });
  }
  // Sensors random-walk.
  const walk = (nid, d, lo, hi, dec = 1) => {
    const x = get(nid);
    if (!x) return;
    const v = clamp(x.state.value + (Math.random() - 0.5) * d, lo, hi);
    api.update(nid, { value: Math.round(v * 10 ** dec) / 10 ** dec });
  };
  walk('k-air', 30, 420, 1100, 0);
  walk('b-temp', 0.12, 17, 24);
  walk('ba-humid', 1.5, 40, 75, 0);
  // Motion blips.
  if (tick % 7 === 0) api.update('o-motion', { value: Math.random() > 0.55 });
  // Power meters wobble.
  for (const [nid, base] of Object.entries(POWER)) {
    const x = get(nid);
    if (!x) continue;
    const p = x.state.on ? Math.round(base * (0.92 + Math.random() * 0.16)) : 0;
    api.update(nid, { power: p });
  }
  // Vacuum lifecycle.
  const v = get('vac');
  if (v) {
    const s = v.state;
    if (s.status === 'cleaning') {
      const b = s.battery - 0.8;
      api.update('vac', b < 25 ? { status: 'returning', battery: b } : { battery: Math.round(b * 10) / 10 });
    } else if (s.status === 'returning') {
      if (Math.random() > 0.6) api.update('vac', { status: 'docked' });
    } else if (s.status === 'docked' && s.battery < 100) {
      api.update('vac', { battery: Math.min(100, Math.round((s.battery + 1.5) * 10) / 10) });
    }
  }
}

function moveCover(nid, to) {
  clearInterval(moveTimers[nid]);
  const d = api.get(nid);
  if (!d) return;
  let pos = d.state.position ?? 0;
  const dir = Math.sign(to - pos);
  if (!dir) return;
  api.update(nid, { moving: dir > 0 ? 'opening' : 'closing' });
  moveTimers[nid] = setInterval(() => {
    pos += dir * 4;
    if ((dir > 0 && pos >= to) || (dir < 0 && pos <= to)) {
      pos = to;
      clearInterval(moveTimers[nid]);
      api.update(nid, { position: pos, moving: null });
    } else api.update(nid, { position: pos });
  }, 90);
}

export default {
  id: 'demo',
  name: 'Demo Home',
  icon: 'sparkles',
  color: '#a78bfa',
  tagline: 'A simulated smart home to explore the app',
  description: 'Twenty-six virtual devices across eight rooms. Everything responds like real hardware, so you can try every control before connecting your own home.',
  fields: [],

  async connect(cfg, a) {
    api = a;
    await sleep(250);
    const existing = new Set(api.devices().map((d) => d.nid));
    api.sync(
      DEVICES.map((d) => {
        const dev = { ...d, roomId: api.ensureRoom(d.room, ROOMS[d.room]) };
        // Keep the state the user left things in across reloads.
        if (existing.has(d.nid)) dev.state = d.type === 'cover' ? { moving: null } : {};
        return dev;
      }),
    );
    clearInterval(timer);
    timer = setInterval(step, 3000);
  },

  async disconnect() {
    clearInterval(timer);
    Object.values(moveTimers).forEach(clearInterval);
    timer = null;
  },

  async setState(d, patch) {
    await sleep(60 + Math.random() * 120);
    if (d.type === 'cover' && 'position' in patch) {
      // Animate the travel like a real motor. Revert the optimistic jump first.
      const target = patch.position;
      const from = d.state.position;
      api.update(d.nid, { position: from });
      moveCover(d.nid, target);
      return;
    }
    if (d.type === 'outlet' && 'on' in patch) {
      api.update(d.nid, { power: patch.on ? POWER[d.nid] || 40 : 0 });
    }
    if (d.type === 'media' && patch.playing && d.state.on === false) api.update(d.nid, { on: true });
    if (d.type === 'media' && patch.on === false) api.update(d.nid, { playing: false });
  },

  async command(d, cmd) {
    await sleep(120);
    if (d.type === 'vacuum') {
      const map = { start: 'cleaning', pause: 'paused', dock: 'returning', stop: 'idle' };
      if (map[cmd]) api.update(d.nid, { status: map[cmd] });
      if (cmd === 'dock') setTimeout(() => api.update(d.nid, { status: 'docked' }), 6000);
    }
    if (d.type === 'media' && (cmd === 'next' || cmd === 'prev')) {
      const list = d.attrs.kind === 'tv' ? SHOWS : TRACKS;
      const i = list.findIndex(([t]) => t === d.state.title);
      const j = (i + (cmd === 'next' ? 1 : -1) + list.length) % list.length;
      api.update(d.nid, { title: list[j][0], artist: list[j][1], playing: true, on: true });
    }
    if (d.type === 'cover' && cmd === 'stop') {
      clearInterval(moveTimers[d.nid]);
      api.update(d.nid, { moving: null });
    }
  },
};
