// "Connect devices" — pick an ecosystem and link it.

import { icon } from './icons.js';
import { esc, uid } from './util.js';
import { store } from './store.js';
import { hub } from './hub.js';
import { INTEGRATIONS } from './integrations/index.js';
import { openSheet, toast, haptic, confirmDialog } from './ui.js';

const isNative = () => !!window.Capacitor?.isNativePlatform?.();
const LOCAL = new Set(['hue', 'sonos', 'samsungtv', 'shelly', 'homeassistant', 'webhook']);

export function integrationSummary(id) {
  const st = hub.statusOf(id);
  const n = Object.values(store.state.devices).filter((d) => d.integration === id).length;
  if (st.state === 'connected') return { cls: 'ok', text: `Connected · ${n} device${n === 1 ? '' : 's'}` };
  if (st.state === 'connecting') return { cls: 'busy', text: st.message || 'Connecting…' };
  if (st.state === 'error') return { cls: 'err', text: 'Needs attention' };
  return { cls: '', text: 'Not connected' };
}

function cardHTML(id) {
  const it = INTEGRATIONS[id];
  const s = integrationSummary(id);
  return `<button class="integ" data-id="${id}" style="--c:${it.color}">
    <span class="integ-ic">${icon(it.icon)}</span>
    <span class="integ-txt"><b>${esc(it.name)}</b><small>${esc(it.tagline)}</small></span>
    <span class="pill ${s.cls}"><i></i>${esc(s.text)}</span>
    ${icon('chevronRight', 'chev')}
  </button>`;
}

export function integrationsListHTML() {
  return `<div class="integ-list">${Object.keys(INTEGRATIONS).map(cardHTML).join('')}</div>`;
}

export function wireIntegrationList(root) {
  root.addEventListener('click', (e) => {
    const b = e.target.closest('.integ');
    if (b) openIntegration(b.dataset.id);
  });
  const off = store.on('integration', (id) => {
    const el = root.querySelector(`.integ[data-id="${id}"]`);
    if (el) el.outerHTML = cardHTML(id);
  });
  return off;
}

export function openConnect() {
  const s = openSheet({
    title: 'Connect devices',
    subtitle: 'Bring every ecosystem into one place',
    className: 'connect-sheet',
    body: `<div class="connect-hero">
        <div class="orbit"><span class="o-core">${icon('hub')}</span>
          ${['bulb', 'plug', 'thermometer', 'lock', 'speaker', 'blinds'].map((n, i) => `<span class="o-sat" style="--k:${i}">${icon(n)}</span>`).join('')}
        </div>
        <p>Home Assistant alone unlocks <b>2,000+ brands</b> — Zigbee, Z-Wave, Matter, Google Nest, Tuya, IKEA, Sonos, Ring and more. Or link devices directly.</p>
      </div>
      ${integrationsListHTML()}`,
    onClose: () => off(),
  });
  const off = wireIntegrationList(s.body);
}

export function openIntegration(id) {
  const it = INTEGRATIONS[id];
  const cfg = store.state.integrations[id];
  const httpsWarn = LOCAL.has(id) && location.protocol === 'https:' && !isNative();
  const body = document.createElement('div');
  body.className = 'integ-detail';
  body.style.setProperty('--c', it.color);
  body.innerHTML = `
    <div class="integ-head"><span class="integ-ic lg">${icon(it.icon)}</span><p>${esc(it.description)}</p></div>
    <div class="status-line"></div>
    ${httpsWarn ? `<div class="note warn">${icon('alert')}<span>Your browser blocks plain <code>http://</code> devices on secure (https) sites. For local devices, open Smart Dash from your own network (e.g. <code>http://</code> on a PC) or use the Android app.</span></div>` : ''}
    ${it.help ? `<div class="note">${icon('info')}<span>${esc(it.help)}</span></div>` : ''}
    ${cfg.enabled && cfg.home != null && id === 'googlehome' ? `<div class="note">${icon('home')}<span>Google shared <b>${cfg.shared ?? 0}</b> usable device${cfg.shared === 1 ? '' : 's'} from “${esc(cfg.home)}”.${cfg.unsupported?.length ? ` Not supported yet: ${cfg.unsupported.map((u) => `<b>${esc(u.name)}</b> <code>${esc(u.types)}</code>`).join(', ')}.` : ' Nothing was skipped — if a device is missing, Google didn’t share it with apps.'}</span></div>` : ''}
    <form class="form" autocomplete="off">
      ${it.fields.map((f) => `<label class="field"><span>${esc(f.label)}</span>
        <div class="input-wrap"><input class="input" name="${f.key}" type="${f.type === 'password' ? 'password' : 'text'}" inputmode="${f.type === 'url' ? 'url' : 'text'}" placeholder="${esc(f.placeholder || '')}" value="${esc(cfg[f.key] || '')}" ${f.required ? 'required' : ''} spellcheck="false" autocapitalize="off">
        ${f.type === 'password' ? `<button type="button" class="peek" aria-label="Show">${icon('eye')}</button>` : ''}</div></label>`).join('')}
      ${it.extras ? `<div class="btn-row wrap">${it.extras.map((x, i) => `<button type="button" class="btn ghost" data-extra="${i}">${icon(x.icon)}<span>${esc(x.label)}</span></button>`).join('')}</div>` : ''}
      ${it.customDevices ? `<div class="custom-devs"></div>` : ''}
      <div class="btn-row">
        ${cfg.enabled ? `<button type="button" class="btn danger ghost" data-a="disconnect">${icon('logout')}<span>Disconnect</span></button>` : ''}
        <button class="btn primary" data-a="connect">${icon(cfg.enabled ? 'refresh' : 'link')}<span>${cfg.enabled ? 'Save & reconnect' : 'Connect'}</span></button>
      </div>
    </form>`;
  const sheet = openSheet({ title: it.name, subtitle: it.tagline, body, className: 'integ-sheet', accent: it.color, onClose: () => off() });
  const form = body.querySelector('form');

  const renderStatus = () => {
    const st = hub.statusOf(id);
    const s = integrationSummary(id);
    body.querySelector('.status-line').innerHTML = cfg.enabled || st.state !== 'off'
      ? `<span class="pill ${s.cls}"><i></i>${esc(s.text)}</span>${st.state === 'error' && st.message ? `<p class="err-msg">${esc(st.message)}</p>` : ''}`
      : '';
  };
  renderStatus();
  const off = store.on('integration', (iid) => iid === id && renderStatus());

  form.querySelectorAll('.peek').forEach((b) => b.addEventListener('click', () => {
    const inp = b.previousElementSibling;
    inp.type = inp.type === 'password' ? 'text' : 'password';
  }));

  const values = () => Object.fromEntries(it.fields.map((f) => [f.key, form.elements[f.key].value.trim()]));

  form.querySelectorAll('[data-extra]').forEach((b) => b.addEventListener('click', async () => {
    const x = it.extras[+b.dataset.extra];
    b.classList.add('loading');
    b.disabled = true;
    try {
      const res = await x.run(values());
      for (const [k, v] of Object.entries(res || {})) if (form.elements[k]) form.elements[k].value = v;
      if (res?._message) toast(res._message, { icon: 'check', type: 'success' });
    } catch (e) {
      toast(e.message || 'Something went wrong', { icon: 'alert', type: 'error' });
    } finally {
      b.classList.remove('loading');
      b.disabled = false;
    }
  }));

  // Custom HTTP device editor.
  let customDevices = [...(cfg.devices || [])];
  const renderCustom = () => {
    const el = body.querySelector('.custom-devs');
    if (!el) return;
    el.innerHTML = `
      <div class="card-head"><h4>Your HTTP devices</h4><span class="muted">${customDevices.length}</span></div>
      ${customDevices.map((d, i) => `<div class="cd-row"><span class="integ-ic sm">${icon(d.type === 'light' ? 'bulb' : d.type === 'outlet' ? 'plug' : d.type === 'fan' ? 'fan' : 'toggle')}</span>
        <span class="cd-txt"><b>${esc(d.name)}</b><small>${esc(d.onUrl)}</small></span>
        <button type="button" class="icon-btn sm" data-del="${i}" aria-label="Remove">${icon('trash')}</button></div>`).join('') || '<p class="muted small">No devices yet — add one below.</p>'}
      <details class="cd-add" ${customDevices.length ? '' : 'open'}><summary>${icon('plus')} Add HTTP device</summary>
        <div class="cd-form">
          <label class="field"><span>Name</span><input class="input" data-k="name" placeholder="Desk fan"></label>
          <label class="field"><span>Type</span><select class="input" data-k="type">${it.types.map((t) => `<option value="${t}">${t[0].toUpperCase() + t.slice(1)}</option>`).join('')}</select></label>
          <label class="field"><span>Turn-on URL</span><input class="input" data-k="onUrl" placeholder="http://192.168.1.60/cm?cmnd=Power%20On" spellcheck="false" autocapitalize="off"></label>
          <label class="field"><span>Turn-off URL</span><input class="input" data-k="offUrl" placeholder="http://192.168.1.60/cm?cmnd=Power%20Off" spellcheck="false" autocapitalize="off"></label>
          <label class="field"><span>Method</span><select class="input" data-k="method"><option>GET</option><option>POST</option><option>PUT</option></select></label>
          <button type="button" class="btn ghost" data-a="add-custom">${icon('plus')}<span>Add device</span></button>
        </div></details>`;
    el.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', () => {
      customDevices.splice(+b.dataset.del, 1);
      renderCustom();
    }));
    el.querySelector('[data-a="add-custom"]').addEventListener('click', () => {
      const get = (k) => el.querySelector(`[data-k="${k}"]`).value.trim();
      if (!get('name') || !get('onUrl')) {
        toast('Give it a name and a turn-on URL', { icon: 'alert', type: 'error' });
        return;
      }
      customDevices.push({ id: uid('http-'), name: get('name'), type: get('type'), onUrl: get('onUrl'), offUrl: get('offUrl'), method: get('method') });
      haptic(8);
      renderCustom();
    });
  };
  renderCustom();

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = form.querySelector('[data-a="connect"]');
    btn.classList.add('loading');
    btn.disabled = true;
    try {
      const v = values();
      if (it.customDevices) v.devices = customDevices;
      await hub.enable(id, v);
      haptic([10, 30, 10]);
      toast(`${it.name} connected`, { icon: 'check', type: 'success', detail: `${Object.values(store.state.devices).filter((d) => d.integration === id).length} devices ready` });
      sheet.close();
    } catch (err) {
      toast(`Couldn't connect to ${it.name}`, { icon: 'alert', type: 'error', detail: err.message });
    } finally {
      btn.classList.remove('loading');
      btn.disabled = false;
    }
  });

  form.querySelector('[data-a="disconnect"]')?.addEventListener('click', async () => {
    const ok = await confirmDialog({ title: `Disconnect ${it.name}?`, message: 'Its devices will be removed from Smart Dash. Your scenes and rooms are kept.', confirm: 'Disconnect', danger: true });
    if (!ok) return;
    await hub.disable(id);
    toast(`${it.name} disconnected`, { icon: 'logout' });
    sheet.close();
  });
}
