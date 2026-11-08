// Custom HTTP devices: anything that can be switched with a URL —
// Tasmota, ESPHome, WLED, IFTTT/Make/Zapier webhooks, Node-RED, Homebridge, etc.

let api = null;

const TYPES = ['switch', 'outlet', 'light', 'fan'];

async function hit(url, method = 'GET', body) {
  if (!url) return;
  const opts = { method, mode: 'no-cors' };
  if (body && method !== 'GET') opts.body = body;
  // `no-cors` lets the request go out even if the device sends no CORS headers.
  await fetch(url, opts);
}

export default {
  id: 'webhook',
  name: 'Custom HTTP',
  icon: 'link',
  color: '#34d399',
  tagline: 'Tasmota, ESPHome, WLED, IFTTT & any webhook',
  description: 'Turn any URL into a device. Perfect for Tasmota or ESPHome firmware, IFTTT / Make / Zapier webhooks, Node-RED flows and DIY gadgets.',
  help: 'Examples — Tasmota: http://192.168.1.60/cm?cmnd=Power%20On · WLED: http://192.168.1.61/win&T=1 · IFTTT: https://maker.ifttt.com/trigger/lamp_on/with/key/YOUR_KEY',
  fields: [],
  customDevices: true,
  types: TYPES,

  async connect(c, a) {
    api = a;
    api.sync(
      (c.devices || []).map((d) => ({
        nid: d.id,
        name: d.name || 'HTTP device',
        type: TYPES.includes(d.type) ? d.type : 'switch',
        roomId: d.roomId || undefined,
        attrs: { onUrl: d.onUrl, offUrl: d.offUrl, method: d.method || 'GET', body: d.body || '', dimmable: false, optimistic: true },
        state: {},
      })),
    );
    // Default to off for newly-created devices.
    for (const d of api.devices()) if (d.state.on === undefined) api.update(d.nid, { on: false });
  },

  async setState(d, patch) {
    if (!('on' in patch)) return;
    await hit(patch.on ? d.attrs.onUrl : d.attrs.offUrl, d.attrs.method, d.attrs.body);
  },
};
