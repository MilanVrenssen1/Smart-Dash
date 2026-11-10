// Sonos speakers (incl. IKEA SYMFONISK) over the local UPnP/SOAP API on port 1400.
// Works in the Android app (native HTTP bypasses CORS). Browsers block it because
// Sonos speakers don't send CORS headers.

let api = null;
let poll = null;
let hosts = [];
const lastWrite = {};

const clean = (h) => h.trim().replace(/^https?:\/\//, '').replace(/[:/].*$/, '');
const base = (host) => `http://${host}:1400`;

const SERVICES = {
  av: { path: '/MediaRenderer/AVTransport/Control', urn: 'urn:schemas-upnp-org:service:AVTransport:1' },
  rc: { path: '/MediaRenderer/RenderingControl/Control', urn: 'urn:schemas-upnp-org:service:RenderingControl:1' },
};

async function withTimeout(promise, ms = 5000) {
  let t;
  const timeout = new Promise((_, rej) => { t = setTimeout(() => rej(new Error('Speaker did not respond')), ms); });
  try { return await Promise.race([promise, timeout]); } finally { clearTimeout(t); }
}

function xml(text) {
  return new DOMParser().parseFromString(text, 'text/xml');
}
const tag = (doc, name) => doc.getElementsByTagName(name)[0]?.textContent ?? null;

async function soap(host, svc, action, args = {}) {
  const s = SERVICES[svc];
  const body = Object.entries({ InstanceID: 0, ...args }).map(([k, v]) => `<${k}>${v}</${k}>`).join('');
  const envelope = `<?xml version="1.0" encoding="utf-8"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"><s:Body><u:${action} xmlns:u="${s.urn}">${body}</u:${action}></s:Body></s:Envelope>`;
  const res = await withTimeout(fetch(base(host) + s.path, {
    method: 'POST',
    headers: { 'Content-Type': 'text/xml; charset="utf-8"', SOAPACTION: `"${s.urn}#${action}"` },
    body: envelope,
  }));
  const text = await res.text();
  if (!res.ok) {
    // 701 = transition not available (e.g. nothing queued), 800 = speaker is grouped (not the coordinator)
    const code = tag(xml(text), 'errorCode');
    const msg = code === '800' || code === '701' ? 'This speaker is grouped or has nothing to play — control it from the group leader.' : `Sonos error ${code || res.status}`;
    throw new Error(msg);
  }
  return xml(text);
}

async function describe(host) {
  const res = await withTimeout(fetch(base(host) + '/xml/device_description.xml'));
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const d = xml(await res.text());
  return { room: tag(d, 'roomName') || host, model: tag(d, 'modelName') || 'Sonos', uuid: (tag(d, 'UDN') || host).replace('uuid:', '') };
}

async function readState(host) {
  const [ti, pi, vol] = await Promise.all([
    soap(host, 'av', 'GetTransportInfo'),
    soap(host, 'av', 'GetPositionInfo').catch(() => null),
    soap(host, 'rc', 'GetVolume', { Channel: 'Master' }).catch(() => null),
  ]);
  const transport = tag(ti, 'CurrentTransportState');
  let title = null, artist = null, art = null;
  const meta = pi && tag(pi, 'TrackMetaData');
  if (meta && meta !== 'NOT_IMPLEMENTED') {
    const m = xml(meta);
    title = tag(m, 'dc:title');
    artist = tag(m, 'dc:creator') || tag(m, 'upnp:album');
    const radio = tag(m, 'r:streamContent');
    if (radio) { artist = title; title = radio; }
    art = tag(m, 'upnp:albumArtURI');
    if (art && art.startsWith('/')) art = base(host) + art;
  }
  return {
    on: true,
    playing: transport === 'PLAYING' || transport === 'TRANSITIONING',
    volume: vol ? parseInt(tag(vol, 'CurrentVolume'), 10) : null,
    title, artist, art,
  };
}

const info = {}; // host -> description

async function refreshAll(initial) {
  const results = await Promise.allSettled(hosts.map(async (h) => {
    if (!info[h]) info[h] = await describe(h);
    const state = await readState(h);
    const isSymfonisk = /symfonisk/i.test(info[h].model);
    return {
      nid: h,
      name: `${info[h].room} ${isSymfonisk ? 'SYMFONISK' : 'Sonos'}`,
      type: 'media',
      roomId: api.ensureRoom(info[h].room),
      attrs: { host: h, model: info[h].model, kind: 'speaker' },
      state,
    };
  }));
  const ok = results.filter((r) => r.status === 'fulfilled').map((r) => r.value);
  const failed = results.map((r, i) => (r.status === 'rejected' ? hosts[i] : null)).filter(Boolean);
  if (initial) {
    if (!ok.length) {
      const native = !!window.Capacitor?.isNativePlatform?.();
      throw new Error(native
        ? `Couldn't reach ${failed.join(', ')}. Check the IP address in the Sonos app (Settings → System → About My System).`
        : 'Sonos speakers can only be controlled from the Smart Dash Android app — browsers block them.');
    }
    // Keep the room the speaker reports only the first time; user room changes are stored separately.
    api.sync(ok);
  } else {
    for (const d of ok) {
      if (Date.now() - (lastWrite[d.nid] || 0) < 2500) continue;
      if (api.get(d.nid)) api.update(d.nid, d.state);
      else api.upsert(d);
    }
  }
  return { failed };
}

export default {
  id: 'sonos',
  name: 'Sonos',
  icon: 'speaker',
  color: '#f97316',
  tagline: 'Sonos & IKEA SYMFONISK speakers on your Wi-Fi',
  description: 'Play, pause, skip and set the volume of your Sonos and IKEA SYMFONISK speakers directly over your home network — with live “now playing” info and album art.',
  help: 'Find each speaker’s IP address in the Sonos app: Settings → System → About My System (look for “IP Address”). Separate several with commas. Works in the Smart Dash Android app.',
  fields: [
    { key: 'hosts', label: 'Speaker IP addresses', type: 'text', placeholder: '192.168.1.50', required: true },
  ],

  async connect(c, a) {
    api = a;
    hosts = String(c.hosts || '').split(/[,\s]+/).map(clean).filter(Boolean);
    if (!hosts.length) throw new Error('Enter the IP address of at least one speaker.');
    const { failed } = await refreshAll(true);
    clearInterval(poll);
    poll = setInterval(() => refreshAll(false)
      .then(({ failed: f }) => api.status(f.length ? 'error' : 'connected', f.length ? `Unreachable: ${f.join(', ')}` : ''))
      .catch(() => {}), 4000);
    if (failed.length) setTimeout(() => api.status('error', `Unreachable: ${failed.join(', ')}`), 0);
  },

  async disconnect() {
    clearInterval(poll);
    poll = null;
  },

  async setState(d, patch) {
    lastWrite[d.nid] = Date.now();
    const host = d.attrs.host;
    if (patch.volume != null) await soap(host, 'rc', 'SetVolume', { Channel: 'Master', DesiredVolume: Math.round(patch.volume) });
    if (patch.playing === true) await soap(host, 'av', 'Play', { Speed: 1 });
    if (patch.playing === false || patch.on === false) await soap(host, 'av', 'Pause');
  },

  async command(d, cmd) {
    lastWrite[d.nid] = Date.now();
    const host = d.attrs.host;
    if (cmd === 'next') await soap(host, 'av', 'Next');
    if (cmd === 'prev') await soap(host, 'av', 'Previous');
    // Refresh “now playing” shortly after skipping.
    setTimeout(() => readState(host).then((s) => api.update(d.nid, s)).catch(() => {}), 800);
  },
};
