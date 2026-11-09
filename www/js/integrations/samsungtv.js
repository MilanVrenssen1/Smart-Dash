// Samsung smart TVs (Tizen, 2016+) — power, remote buttons and app launching.
// Remote control uses the native SamsungTv plugin (Android app); state polling uses
// the TV's REST info endpoint on port 8001.

let api = null;
let poll = null;
let hosts = [];
const info = {};        // host -> { name, model, mac, secure }
const turningOn = {};   // host -> timestamp of last wake attempt

const plugin = () => window.Capacitor?.Plugins?.SamsungTv;
const isNative = () => !!window.Capacitor?.isNativePlatform?.();
const clean = (h) => h.trim().replace(/^https?:\/\//, '').replace(/[:/].*$/, '');

// Well-known Samsung app IDs, used when the TV won't share its installed-app list.
export const COMMON_APPS = [
  { appId: '3201907018807', name: 'Netflix' },
  { appId: '111299001912', name: 'YouTube' },
  { appId: '3201910019365', name: 'Prime Video' },
  { appId: '3201901017640', name: 'Disney+' },
  { appId: '3201606009684', name: 'Spotify' },
  { appId: '3201807016597', name: 'Apple TV' },
];

async function getJSON(url, ms = 3000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const res = await fetch(url, { signal: ctl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

/** Returns { on, name, model, mac, secure } or null when the TV is unreachable (= off). */
async function readInfo(host) {
  try {
    const d = await getJSON(`http://${host}:8001/api/v2/`);
    const dev = d.device || {};
    return {
      // PowerState exists on 2018+ models; older ones only answer when on.
      on: dev.PowerState ? dev.PowerState === 'on' : true,
      name: String(dev.name || d.name || 'Samsung TV').replace(/^\[TV\]\s*/, ''),
      model: dev.modelName || d.type || '',
      mac: dev.wifiMac || '',
      secure: dev.TokenAuthSupport === 'true' || dev.TokenAuthSupport === true,
    };
  } catch {
    return null;
  }
}

async function ensureSocket(host) {
  const p = plugin();
  if (!p) return false;
  const { connected } = await p.isConnected({ host });
  if (connected) return true;
  const cfg = api.config();
  const tokens = cfg.tokens || {};
  const secure = info[host]?.secure !== false;
  const { token } = await p.connect({ host, token: tokens[host] || '', secure });
  if (token && token !== tokens[host]) api.saveConfig({ tokens: { ...tokens, [host]: token } });
  return true;
}

async function loadApps(host) {
  try {
    const { apps } = await plugin().getApps({ host });
    if (apps?.length) {
      api.upsert({ nid: host, attrs: { apps: apps.sort((a, b) => a.name.localeCompare(b.name)) } });
    }
  } catch { /* older TVs don't support it — the common list is used instead */ }
}

async function refresh(host, initial = false) {
  const st = await readInfo(host);
  const wasOn = api.get(host)?.state.on;
  if (st) {
    info[host] = { ...info[host], ...st, mac: st.mac || info[host]?.mac || api.config().macs?.[host] || '' };
    if (st.mac && api.config().macs?.[host] !== st.mac) api.saveConfig({ macs: { ...(api.config().macs || {}), [host]: st.mac } });
  }
  const on = !!st?.on;
  const dev = {
    nid: host,
    name: info[host]?.name || 'Samsung TV',
    type: 'tv',
    attrs: { host, model: info[host]?.model || '', mac: info[host]?.mac || api.config().macs?.[host] || '', kind: 'tv' },
    state: { on, pending: turningOn[host] && Date.now() - turningOn[host] < 20000 && !on ? 'on' : null },
  };
  api.upsert(dev);
  if (on && (initial || !wasOn)) {
    delete turningOn[host];
    try {
      await ensureSocket(host);
      if (!api.get(host)?.attrs.apps) loadApps(host);
    } catch (e) {
      if (initial) throw e;
    }
  }
}

export default {
  id: 'samsungtv',
  name: 'Samsung TV',
  icon: 'tv',
  color: '#1428a0',
  tagline: 'Power, remote and apps for Samsung smart TVs',
  description: 'Turn your Samsung TV on and off, use it as a remote, and open Netflix, YouTube or any installed app straight from your phone.',
  help: 'Find the TV’s IP address on the TV: Settings → General → Network → Network Status → IP Settings. To turn the TV on from your phone, enable Settings → General → Network → Expert Settings → “Power On with Mobile”. The first time you connect, the TV asks to allow Smart Dash — choose Allow.',
  fields: [
    { key: 'hosts', label: 'TV IP address', type: 'text', placeholder: '192.168.1.30', required: true },
  ],

  async connect(cfg, a) {
    api = a;
    hosts = String(cfg.hosts || '').split(/[,\s]+/).map(clean).filter(Boolean);
    if (!hosts.length) throw new Error('Enter your TV’s IP address.');
    if (!plugin()) {
      throw new Error(isNative()
        ? 'This build doesn’t include the Samsung TV remote yet — rebuild the app in Android Studio.'
        : 'Samsung TV control only works in the Smart Dash Android app.');
    }
    // A TV that is off can't be reached; it's still added (so you can wake it) if we know its MAC.
    for (const h of hosts) {
      const st = await readInfo(h);
      if (!st && !cfg.macs?.[h]) throw new Error(`Couldn’t find a TV at ${h}. Turn the TV on, check the IP address, and try again.`);
    }
    await Promise.all(hosts.map((h) => refresh(h, true)));
    plugin().addListener?.('disconnected', ({ host }) => { if (hosts.includes(host)) setTimeout(() => refresh(host).catch(() => {}), 1500); });
    clearInterval(poll);
    poll = setInterval(() => hosts.forEach((h) => refresh(h).catch(() => {})), 5000);
  },

  async disconnect() {
    clearInterval(poll);
    poll = null;
    for (const h of hosts) await plugin()?.disconnect?.({ host: h });
  },

  async setState(d, patch) {
    if (!('on' in patch)) return;
    const host = d.attrs.host;
    const p = plugin();
    if (patch.on) {
      const live = await readInfo(host);
      if (live?.on) return;
      if (live && !live.on) {
        // 2018+ TVs in network standby still accept the power key.
        try { await ensureSocket(host); await p.sendKey({ host, key: 'KEY_POWER' }); } catch { /* fall back to WoL */ }
      }
      if (!d.attrs.mac) throw new Error('Smart Dash doesn’t know this TV’s network address yet — turn it on with the remote once while connected.');
      turningOn[host] = Date.now();
      api.update(host, { on: false, pending: 'on' });
      await p.wake({ mac: d.attrs.mac });
      // Show "Turning on…" until the TV answers (it can take 5–15 seconds).
      setTimeout(() => refresh(host).catch(() => {}), 4000);
      setTimeout(() => refresh(host).catch(() => {}), 9000);
    } else {
      await ensureSocket(host);
      await p.sendKey({ host, key: 'KEY_POWER' });
      setTimeout(() => refresh(host).catch(() => {}), 3000);
    }
  },

  async command(d, cmd, args) {
    const host = d.attrs.host;
    const p = plugin();
    if (!p) throw new Error('Samsung TV control needs the Android app');
    await ensureSocket(host);
    if (cmd === 'key') await p.sendKey({ host, key: args });
    if (cmd === 'hold') {
      await p.sendKey({ host, key: args, cmd: 'Press' });
      setTimeout(() => p.sendKey({ host, key: args, cmd: 'Release' }).catch(() => {}), 1200);
    }
    if (cmd === 'launch') await p.launchApp({ host, appId: args });
    if (cmd === 'apps') await loadApps(host);
  },
};
