// Device type definitions: how each kind of device looks, summarises and toggles.

import { fmtNum, fmtPower, kelvinToHex } from './util.js';
import { store } from './store.js';

const unit = () => store.state.settings.tempUnit || '°C';
const deg = (v) => (v == null ? '–' : `${fmtNum(v, Math.abs(v % 1) > 0.01 ? 1 : 0)}°`);

const MODE_LABEL = { heat: 'Heating', cool: 'Cooling', auto: 'Auto', heat_cool: 'Auto', dry: 'Drying', fan_only: 'Fan', off: 'Off' };

const SENSOR_KINDS = {
  temperature: { icon: 'thermometer', label: 'Temperature' },
  humidity: { icon: 'droplet', label: 'Humidity' },
  co2: { icon: 'air', label: 'CO₂' },
  air: { icon: 'air', label: 'Air quality' },
  power: { icon: 'bolt', label: 'Power' },
  energy: { icon: 'bolt', label: 'Energy' },
  illuminance: { icon: 'sun', label: 'Light level' },
  battery: { icon: 'battery', label: 'Battery' },
  motion: { icon: 'motion', label: 'Motion', binary: ['Motion', 'Clear'] },
  occupancy: { icon: 'user', label: 'Occupancy', binary: ['Occupied', 'Clear'] },
  door: { icon: 'door', label: 'Door', binary: ['Open', 'Closed'] },
  window: { icon: 'door', label: 'Window', binary: ['Open', 'Closed'] },
  moisture: { icon: 'droplet', label: 'Leak', binary: ['Wet', 'Dry'] },
  smoke: { icon: 'flame', label: 'Smoke', binary: ['Smoke!', 'Clear'] },
  generic: { icon: 'activity', label: 'Sensor' },
};
export const sensorKind = (s) => SENSOR_KINDS[s.kind] || SENSOR_KINDS.generic;

export function sensorText(s) {
  const k = sensorKind(s);
  if (k.binary) return s.value ? k.binary[0] : k.binary[1];
  if (typeof s.value !== 'number') return s.value == null ? '–' : String(s.value);
  if (s.kind === 'temperature') return `${fmtNum(s.value, 1)}${s.unit || unit()}`;
  const dec = Math.abs(s.value) < 10 && s.value % 1 ? 1 : 0;
  return `${fmtNum(s.value, dec)}${s.unit ? (s.unit === '%' ? '%' : ' ' + s.unit) : ''}`;
}

export const lightColor = (s) => s.color || kelvinToHex(s.colorTemp || 2900);

export const TYPES = {
  light: {
    label: 'Light', plural: 'Lights', icon: () => 'bulb', toggle: true,
    active: (s) => !!s.on,
    status: (s) => (s.on ? `${Math.round(s.brightness ?? 100)}%` : 'Off'),
    glow: (s) => lightColor(s),
    level: (s) => (s.on ? (s.brightness ?? 100) / 100 : 0),
    watts: (s, a) => (s.on ? (a.watts || 9) * (0.15 + 0.85 * (s.brightness ?? 100) / 100) : 0.3),
    quick: (s) => ({ on: !s.on }),
  },
  switch: {
    label: 'Switch', plural: 'Switches', icon: (s, a) => a.icon || 'toggle', toggle: true,
    active: (s) => !!s.on,
    status: (s) => (s.on ? (s.power != null ? fmtPower(s.power) : 'On') : 'Off'),
    glow: () => '#34d399',
    watts: (s, a) => (s.power != null ? s.power : s.on ? a.watts || 20 : 0.4),
    quick: (s) => ({ on: !s.on }),
  },
  outlet: {
    label: 'Outlet', plural: 'Outlets', icon: (s, a) => a.icon || 'plug', toggle: true,
    active: (s) => !!s.on,
    status: (s) => (s.on ? (s.power != null ? fmtPower(s.power) : 'On') : 'Off'),
    glow: () => '#34d399',
    watts: (s, a) => (s.power != null ? s.power : s.on ? a.watts || 45 : 0.4),
    quick: (s) => ({ on: !s.on }),
  },
  thermostat: {
    label: 'Climate', plural: 'Climate', icon: () => 'thermometer', toggle: false,
    active: (s) => s.mode && s.mode !== 'off',
    status: (s) => (s.mode === 'off' || !s.mode ? 'Off' : `${MODE_LABEL[s.mode] || s.mode} · ${deg(s.target)}`),
    big: (s) => deg(s.current),
    glow: (s) => (s.mode === 'cool' ? '#38bdf8' : s.mode === 'off' ? '#94a3b8' : '#fb923c'),
    watts: (s) => {
      if (!s.mode || s.mode === 'off') return 1;
      const gap = Math.abs((s.target ?? 20) - (s.current ?? 20));
      return gap > 0.3 ? 900 + gap * 200 : 60;
    },
  },
  lock: {
    label: 'Lock', plural: 'Locks', icon: (s) => (s.locked ? 'lock' : 'unlock'), toggle: false, action: true,
    active: (s) => !s.locked,
    status: (s) => (s.jammed ? 'Jammed' : s.locked ? 'Locked' : 'Unlocked'),
    glow: (s) => (s.locked ? '#34d399' : '#f87171'),
    actionIcon: (s) => (s.locked ? 'unlock' : 'lock'),
    // Unlocking always goes through the sheet (hold to confirm); locking is instant.
    quick: (s) => (s.locked ? null : { locked: true }),
    watts: () => 0,
  },
  cover: {
    label: 'Blinds', plural: 'Blinds & doors', icon: (s, a) => (a.deviceClass === 'garage' ? 'garage' : 'blinds'), toggle: false, action: true,
    active: (s) => (s.position ?? 0) > 0,
    status: (s) => {
      const p = Math.round(s.position ?? 0);
      if (s.moving) return s.moving === 'opening' ? 'Opening…' : 'Closing…';
      return p <= 0 ? 'Closed' : p >= 100 ? 'Open' : `${p}% open`;
    },
    glow: () => '#60a5fa',
    level: (s) => (s.position ?? 0) / 100,
    actionIcon: (s) => ((s.position ?? 0) > 0 ? 'chevronDown' : 'chevronUp'),
    quick: (s) => ({ position: (s.position ?? 0) > 0 ? 0 : 100 }),
    watts: (s) => (s.moving ? 60 : 0.5),
  },
  fan: {
    label: 'Fan', plural: 'Fans', icon: () => 'fan', toggle: true,
    active: (s) => !!s.on,
    status: (s) => (s.on ? `${Math.round(s.speed ?? 50)}%` : 'Off'),
    glow: () => '#22d3ee',
    level: (s) => (s.on ? (s.speed ?? 50) / 100 : 0),
    watts: (s) => (s.on ? 6 + 40 * (s.speed ?? 50) / 100 : 0.3),
    quick: (s) => ({ on: !s.on }),
  },
  media: {
    label: 'Media', plural: 'Media', icon: (s, a) => a.icon || (a.kind === 'tv' ? 'tv' : 'speaker'), toggle: false, action: true,
    active: (s) => !!s.playing,
    status: (s, a) => {
      if (a.volumeOnly) return s.volume != null ? `Volume ${Math.round(s.volume)}%` : 'Speaker';
      if (s.on === false) return 'Off';
      if (s.playing && s.title) return s.title + (s.artist ? ` · ${s.artist}` : '');
      return s.playing ? 'Playing' : 'Paused';
    },
    glow: () => '#f472b6',
    actionIcon: (s, a) => (a?.volumeOnly ? 'volume' : s.playing ? 'pause' : 'play'),
    quick: (s, a) => (a?.volumeOnly ? null : { playing: !s.playing, on: true }),
    watts: (s, a) => (s.on === false ? 0.5 : s.playing ? a.watts || (a.kind === 'tv' ? 95 : 12) : 4),
  },
  tv: {
    label: 'TV', plural: 'TVs', icon: () => 'tv', toggle: true,
    active: (s) => !!s.on || s.pending === 'on',
    status: (s) => (s.pending === 'on' && !s.on ? 'Turning on…' : s.on ? 'On' : 'Off'),
    glow: () => '#60a5fa',
    watts: (s) => (s.on ? 110 : 0.5),
    quick: (s) => ({ on: !(s.on || s.pending === 'on') }),
  },
  vacuum: {
    label: 'Vacuum', plural: 'Vacuums', icon: () => 'vacuum', toggle: false, action: true,
    active: (s) => s.status === 'cleaning' || s.status === 'returning',
    status: (s) => {
      const st = { cleaning: 'Cleaning', docked: 'Docked', returning: 'Returning to dock', paused: 'Paused', idle: 'Idle', error: 'Needs attention' }[s.status] || s.status || 'Idle';
      return s.battery != null ? `${st} · ${Math.round(s.battery)}%` : st;
    },
    glow: () => '#2dd4bf',
    actionIcon: (s) => (s.status === 'cleaning' ? 'pause' : 'play'),
    command: (s) => (s.status === 'cleaning' ? 'pause' : 'start'),
    watts: (s) => (s.status === 'cleaning' ? 35 : 2),
  },
  sensor: {
    label: 'Sensor', plural: 'Sensors', icon: (s) => sensorKind(s).icon, toggle: false,
    active: (s) => (sensorKind(s).binary ? !!s.value : false),
    status: (s) => (sensorKind(s).binary ? sensorKind(s).label : sensorKind(s).label),
    big: (s) => sensorText(s),
    glow: (s) => (s.kind === 'smoke' || s.kind === 'moisture' ? '#f87171' : '#a78bfa'),
    watts: (s) => (s.kind === 'power' && typeof s.value === 'number' ? 0 : 0),
  },
};

export const typeDef = (d) => TYPES[d.type] || TYPES.switch;
export const devIcon = (d) => typeDef(d).icon(d.state, d.attrs || {});
export const isActive = (d) => !!typeDef(d).active(d.state);
export const statusText = (d) => typeDef(d).status(d.state, d.attrs || {});
export const glowColor = (d) => typeDef(d).glow(d.state, d.attrs || {});
export const estimateWatts = (d) => {
  const def = typeDef(d);
  try { return Math.max(0, def.watts ? def.watts(d.state, d.attrs || {}) : 0); } catch { return 0; }
};

/** Filters used across the UI. */
export const CATEGORIES = [
  { id: 'all', label: 'All', icon: 'grid', match: () => true },
  { id: 'light', label: 'Lights', icon: 'bulb', match: (d) => d.type === 'light' },
  { id: 'power', label: 'Plugs & switches', icon: 'plug', match: (d) => d.type === 'switch' || d.type === 'outlet' },
  { id: 'climate', label: 'Climate', icon: 'thermometer', match: (d) => d.type === 'thermostat' || d.type === 'fan' },
  { id: 'security', label: 'Security', icon: 'shield', match: (d) => d.type === 'lock' || (d.type === 'sensor' && ['door', 'window', 'motion', 'smoke', 'moisture', 'occupancy'].includes(d.state.kind)) || (d.type === 'cover' && d.attrs?.deviceClass === 'garage') },
  { id: 'cover', label: 'Blinds', icon: 'blinds', match: (d) => d.type === 'cover' },
  { id: 'media', label: 'Media & TV', icon: 'music', match: (d) => d.type === 'media' || d.type === 'tv' },
  { id: 'sensor', label: 'Sensors', icon: 'activity', match: (d) => d.type === 'sensor' },
  { id: 'other', label: 'Other', icon: 'more', match: (d) => d.type === 'vacuum' },
];

/** Human-readable description of a state change for the activity feed. */
export function describeChange(d, patch) {
  const n = d.name;
  if ('locked' in patch) return `${n} ${patch.locked ? 'locked' : 'unlocked'}`;
  if ('on' in patch && Object.keys(patch).length <= 2 && !('brightness' in patch && patch.on)) return `${n} turned ${patch.on ? 'on' : 'off'}`;
  if ('brightness' in patch) return `${n} dimmed to ${Math.round(patch.brightness)}%`;
  if ('color' in patch) return `${n} colour changed`;
  if ('colorTemp' in patch) return `${n} set to ${patch.colorTemp}K`;
  if ('target' in patch) return `${n} set to ${patch.target}°`;
  if ('mode' in patch) return `${n} mode: ${MODE_LABEL[patch.mode] || patch.mode}`;
  if ('position' in patch) return `${n} ${patch.position >= 100 ? 'opened' : patch.position <= 0 ? 'closed' : `set to ${Math.round(patch.position)}%`}`;
  if ('speed' in patch) return `${n} speed ${Math.round(patch.speed)}%`;
  if ('playing' in patch) return `${n} ${patch.playing ? 'playing' : 'paused'}`;
  if ('volume' in patch) return `${n} volume ${Math.round(patch.volume)}%`;
  return `${n} updated`;
}

export { MODE_LABEL };
