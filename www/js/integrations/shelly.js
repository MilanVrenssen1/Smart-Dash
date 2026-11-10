// Shelly relays, plugs, dimmers and roller shutters over the local HTTP API.
// Supports Gen 1 and Gen 2/3/4 (RPC) devices.

let api = null;
let poll = null;
let hosts = [];
const info = {}; // host -> { gen, name }
const lastWrite = {};

const clean = (h) => h.trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '');

async function getJSON(url, ms = 5000) {
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

async function probe(host) {
  const s = await getJSON(`http://${host}/shelly`);
  const gen = s.gen || 1;
  let name = s.name || null;
  if (!name && gen >= 2) {
    const c = await getJSON(`http://${host}/rpc/Sys.GetConfig`).catch(() => null);
    name = c?.device?.name || null;
  }
  info[host] = { gen, name: name || s.type || s.model || host };
}

async function readHost(host) {
  const { gen, name } = info[host];
  const out = [];
  if (gen >= 2) {
    const st = await getJSON(`http://${host}/rpc/Shelly.GetStatus`);
    for (const [key, v] of Object.entries(st)) {
      const [kind, idx] = key.split(':');
      const nid = `${host}|${kind}|${idx}`;
      const label = (n) => (Object.keys(st).filter((k) => k.startsWith(kind + ':')).length > 1 ? `${name} ${n}` : name);
      if (kind === 'switch') out.push({ nid, name: label(+idx + 1), type: v.apower != null ? 'outlet' : 'switch', attrs: { host, gen, kind, idx: +idx }, state: { on: !!v.output, power: v.apower ?? null } });
      if (kind === 'light') out.push({ nid, name: label(+idx + 1), type: 'light', attrs: { host, gen, kind, idx: +idx, dimmable: true }, state: { on: !!v.output, brightness: v.brightness ?? 100 } });
      if (kind === 'cover') out.push({ nid, name: label(+idx + 1), type: 'cover', attrs: { host, gen, kind, idx: +idx, positionable: v.current_pos != null }, state: { position: v.current_pos ?? (v.state === 'open' ? 100 : 0), moving: v.state === 'opening' ? 'opening' : v.state === 'closing' ? 'closing' : null } });
    }
  } else {
    const st = await getJSON(`http://${host}/status`);
    (st.relays || []).forEach((r, i) => {
      const p = st.meters?.[i]?.power;
      out.push({ nid: `${host}|relay|${i}`, name: st.relays.length > 1 ? `${name} ${i + 1}` : name, type: p != null ? 'outlet' : 'switch', attrs: { host, gen, kind: 'relay', idx: i }, state: { on: !!r.ison, power: p ?? null } });
    });
    (st.lights || []).forEach((l, i) => {
      out.push({ nid: `${host}|light|${i}`, name, type: 'light', attrs: { host, gen, kind: 'light', idx: i, dimmable: l.brightness != null }, state: { on: !!l.ison, brightness: l.brightness ?? 100 } });
    });
    (st.rollers || []).forEach((r, i) => {
      out.push({ nid: `${host}|roller|${i}`, name, type: 'cover', attrs: { host, gen, kind: 'roller', idx: i, positionable: r.positioning }, state: { position: r.current_pos ?? 0 } });
    });
  }
  return out;
}

async function refreshAll(initial) {
  const results = await Promise.allSettled(hosts.map(async (h) => {
    if (!info[h]) await probe(h);
    return readHost(h);
  }));
  const ok = results.filter((r) => r.status === 'fulfilled').flatMap((r) => r.value);
  const failed = results.map((r, i) => (r.status === 'rejected' ? hosts[i] : null)).filter(Boolean);
  if (initial) {
    if (!ok.length && failed.length) throw new Error(`Couldn't reach ${failed.join(', ')}. Check the IP address and that the device is on your Wi-Fi.`);
    api.sync(ok);
  } else {
    for (const d of ok) {
      if (Date.now() - (lastWrite[d.nid] || 0) < 2500) continue;
      if (api.get(d.nid)) api.update(d.nid, d.state);
      else api.upsert(d);
    }
  }
  return { ok: ok.length, failed };
}

export default {
  id: 'shelly',
  name: 'Shelly',
  icon: 'toggle',
  color: '#3b82f6',
  tagline: 'Relays, plugs, dimmers & shutters on your LAN',
  description: 'Direct local control of Shelly Gen 1 and Plus/Pro/Gen 3/Gen 4 devices, including live power metering.',
  help: 'Enter the IP address of each Shelly device, separated by commas. You can find them in the Shelly app under Device → Settings → Device information.',
  fields: [
    { key: 'hosts', label: 'Device IP addresses', type: 'text', placeholder: '192.168.1.40, 192.168.1.41', required: true },
  ],

  async connect(c, a) {
    api = a;
    hosts = String(c.hosts || '').split(/[,\s]+/).map(clean).filter(Boolean);
    if (!hosts.length) throw new Error('Add at least one device IP address.');
    const { failed } = await refreshAll(true);
    clearInterval(poll);
    poll = setInterval(() => refreshAll(false).then(({ failed: f }) => api.status(f.length ? 'error' : 'connected', f.length ? `Unreachable: ${f.join(', ')}` : '')).catch(() => {}), 5000);
    if (failed.length) setTimeout(() => api.status('error', `Unreachable: ${failed.join(', ')}`), 0);
  },

  async disconnect() {
    clearInterval(poll);
    poll = null;
  },

  async setState(d, patch) {
    lastWrite[d.nid] = Date.now();
    const { host, gen, kind, idx } = d.attrs;
    if (gen >= 2) {
      if (kind === 'switch') return getJSON(`http://${host}/rpc/Switch.Set?id=${idx}&on=${!!patch.on}`);
      if (kind === 'light') {
        const q = new URLSearchParams({ id: idx });
        if ('on' in patch) q.set('on', !!patch.on);
        if (patch.brightness != null) { q.set('brightness', Math.round(patch.brightness)); q.set('on', 'true'); }
        return getJSON(`http://${host}/rpc/Light.Set?${q}`);
      }
      if (kind === 'cover') {
        if (d.attrs.positionable) return getJSON(`http://${host}/rpc/Cover.GoToPosition?id=${idx}&pos=${Math.round(patch.position)}`);
        return getJSON(`http://${host}/rpc/Cover.${patch.position > 0 ? 'Open' : 'Close'}?id=${idx}`);
      }
    } else {
      if (kind === 'relay') return getJSON(`http://${host}/relay/${idx}?turn=${patch.on ? 'on' : 'off'}`);
      if (kind === 'light') {
        const q = new URLSearchParams();
        if ('on' in patch) q.set('turn', patch.on ? 'on' : 'off');
        if (patch.brightness != null) { q.set('brightness', Math.round(patch.brightness)); q.set('turn', 'on'); }
        return getJSON(`http://${host}/light/${idx}?${q}`);
      }
      if (kind === 'roller') {
        if (d.attrs.positionable) return getJSON(`http://${host}/roller/${idx}?go=to_pos&roller_pos=${Math.round(patch.position)}`);
        return getJSON(`http://${host}/roller/${idx}?go=${patch.position > 0 ? 'open' : 'close'}`);
      }
    }
  },

  async command(d, cmd) {
    const { host, gen, kind, idx } = d.attrs;
    if (d.type === 'cover' && cmd === 'stop') {
      if (gen >= 2) return getJSON(`http://${host}/rpc/Cover.Stop?id=${idx}`);
      return getJSON(`http://${host}/roller/${idx}?go=stop`);
    }
  },
};
