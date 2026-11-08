// Google Home via the official Google Home APIs (Android app only).
// Brings in the Matter lights and plugs from the user's Google Home.
// The native side lives in android/app/src/googlehome/.../GoogleHomePlugin.kt

import { hexToRgb, hsToHex, xyToHex } from '../util.js';

let api = null;
let listener = null;

const plugin = () => window.Capacitor?.Plugins?.GoogleHome;
const isNative = () => !!window.Capacitor?.isNativePlatform?.();

function hexToHs(hex) {
  const [r, g, b] = hexToRgb(hex).map((v) => v / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
  }
  h = (h * 60 + 360) % 360;
  return { hue: h, saturation: max ? (d / max) * 100 : 0 };
}

function toDevice(g) {
  const mode = String(g.colorMode || '');
  let color = null;
  let colorTemp = null;
  if (/temp/i.test(mode) && g.mireds) colorTemp = Math.round(1e6 / g.mireds);
  else if (/hue/i.test(mode) && g.hue != null) color = hsToHex(g.hue, g.saturation ?? 100);
  else if (/x/i.test(mode) && g.x != null) color = xyToHex(g.x, g.y);
  else if (g.mireds) colorTemp = Math.round(1e6 / g.mireds);
  return {
    nid: g.id,
    name: g.name || 'Google Home device',
    type: g.kind === 'outlet' ? 'outlet' : 'light',
    roomId: g.room ? api.ensureRoom(g.room) : undefined,
    attrs: {
      dimmable: !!g.dimmable,
      supportsColor: !!g.supportsColor,
      supportsTemp: !!g.supportsTemp,
      minK: g.maxMireds ? Math.round(1e6 / g.maxMireds) : 2200,
      maxK: g.minMireds ? Math.round(1e6 / g.minMireds) : 6500,
      available: g.online !== false,
      icon: g.kind === 'outlet' ? 'plug' : undefined,
    },
    state: {
      on: !!g.on,
      brightness: g.brightness ?? (g.on ? 100 : 0),
      ...(g.supportsColor || g.supportsTemp ? { color, colorTemp } : {}),
    },
  };
}

export default {
  id: 'googlehome',
  name: 'Google Home',
  icon: 'home',
  color: '#4285f4',
  tagline: 'Your Matter lights & plugs from Google Home',
  description: 'Sign in with Google and pick your home — every supported light and plug in your Google Home appears here with its room, and stays in sync both ways.',
  help: 'Needs the Smart Dash Android app built with the Google Home SDK, and a Google hub in your home (Nest Mini, Nest Audio, Nest Hub, Google TV Streamer…). See the README section “Google Home” for the one-time setup.',
  fields: [],

  async connect(cfg, a) {
    api = a;
    const p = plugin();
    if (!p) {
      throw new Error(isNative()
        ? 'This build of the app doesn’t include Google Home yet. Install the Google Home SDK on your PC and rebuild (see README → Google Home).'
        : 'Google Home only works in the Smart Dash Android app.');
    }
    await p.connect();
    const { devices = [], home } = await p.getDevices();
    api.sync(devices.map(toDevice));
    if (home) api.log(`Google Home “${home}”: ${devices.length} devices`, 'home');
    await listener?.remove?.();
    listener = await p.addListener('deviceChanged', (g) => {
      api.upsert(toDevice(g));
    });
    await p.watch();
  },

  async disconnect() {
    await listener?.remove?.();
    listener = null;
    await plugin()?.disconnect?.();
  },

  async setState(d, patch) {
    const p = plugin();
    if (!p) throw new Error('Google Home is not available in this build');
    const req = { id: d.nid };
    if ('on' in patch) req.on = !!patch.on;
    if (patch.brightness != null) {
      if (patch.brightness <= 0) req.on = false;
      else req.brightness = patch.brightness;
    }
    if (patch.colorTemp) req.mireds = Math.round(1e6 / patch.colorTemp);
    if (patch.color) Object.assign(req, hexToHs(patch.color));
    await p.setState(req);
  },
};
