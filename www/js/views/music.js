// Music: Spotify player with "play on" device switching (phone, TV, Nest, SYMFONISK…).

import { icon } from '../icons.js';
import { esc, debounce } from '../util.js';
import * as sp from '../spotify.js';
import { toast, haptic, confirmDialog } from '../ui.js';

const DEVICE_ICON = { Smartphone: 'smartphone', Tablet: 'smartphone', TV: 'tv', CastVideo: 'tv', Computer: 'monitor', Speaker: 'speaker', CastAudio: 'speaker', AVR: 'speaker', STB: 'tv', GameConsole: 'tv', Automobile: 'car' };
const fmtTime = (ms) => { const s = Math.max(0, Math.floor(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const img = (images) => (Array.isArray(images) ? images : [])[0]?.url || '';

let preferredDevice = null; // device chosen by the user when nothing is active

/* ---------------- Setup (not connected) ---------------- */

function setupHTML() {
  const redirect = sp.redirectUri();
  const blocked = !sp.webRedirectAllowed();
  return `
    <section class="sp-setup">
      <div class="sp-logo">${icon('music')}</div>
      <h2>Connect Spotify</h2>
      <p class="muted">Play music and send it to any speaker or screen in your home — your phone, TV, Google Nest Mini or SYMFONISK.</p>
      ${blocked ? `<div class="note warn">${icon('alert')}<span>Spotify only allows sign-in from the Android app, an https address, or <code>http://127.0.0.1</code>. Open Smart Dash at <code>http://127.0.0.1:${location.port || 80}</code> instead of “localhost”.</span></div>` : ''}
      <ol class="sp-steps">
        <li>Open <a href="https://developer.spotify.com/dashboard" target="_blank" rel="noopener">developer.spotify.com/dashboard</a>, sign in, and tap <b>Create app</b>.</li>
        <li>Name it <b>Smart Dash</b>, tick <b>Web API</b>, and add this <b>Redirect URI</b>:
          <div class="copy-row"><code class="sp-redirect">${esc(redirect)}</code><button class="icon-btn sm" data-a="copy" aria-label="Copy redirect URI">${icon('copy')}</button></div></li>
        <li>Save, open the app’s <b>Settings</b> and copy the <b>Client ID</b>.</li>
        <li>Under <b>User Management</b>, add the email address of your Spotify account.</li>
      </ol>
      <label class="field"><span>Client ID</span><input class="input" id="sp-client" placeholder="32 letters and numbers" value="${esc(sp.clientId())}" spellcheck="false" autocapitalize="off" autocomplete="off"></label>
      <button class="btn primary lg sp-connect" data-a="connect">${icon('link')}<span>Connect Spotify</span></button>
      <p class="muted small">Requires Spotify Premium. Your login happens on Spotify’s own page — Smart Dash never sees your password.</p>
    </section>`;
}

/* ---------------- Player (connected) ---------------- */

function playerHTML() {
  return `
    <section class="sp-now" id="sp-now">
      <div class="sp-bg"></div>
      <div class="sp-art"><div class="sp-art-img"></div><div class="eq"><i></i><i></i><i></i><i></i><i></i></div></div>
      <div class="sp-meta"><b class="sp-title">Nothing playing</b><span class="sp-artist muted">Pick a playlist or search below</span></div>
      <div class="sp-progress"><input type="range" class="range sp-seek" min="0" max="1000" value="0" aria-label="Position"><div class="sp-times"><span class="sp-pos">0:00</span><span class="sp-dur">0:00</span></div></div>
      <div class="sp-ctl">
        <button class="round-btn ghost sp-shuffle" data-a="shuffle" aria-label="Shuffle">${icon('shuffle')}</button>
        <button class="round-btn ghost" data-a="prev" aria-label="Previous">${icon('prev')}</button>
        <button class="play-btn sp-play" data-a="play" aria-label="Play or pause">${icon('play')}</button>
        <button class="round-btn ghost" data-a="next" aria-label="Next">${icon('next')}</button>
        <button class="round-btn ghost sp-repeat" data-a="repeat" aria-label="Repeat">${icon('repeat')}</button>
      </div>
      <div class="vol-row">${icon('volume')}<input type="range" class="range vol sp-vol" min="0" max="100" step="1" aria-label="Volume"><b class="vol-v sp-vol-v">–</b></div>
      <button class="sp-on" data-a="jump-devices"><span class="sp-on-ic">${icon('speaker')}</span><span class="sp-on-txt">Choose a speaker</span>${icon('chevronDown', 'chev')}</button>
    </section>

    <section class="section" id="sp-devices-sec">
      <div class="section-head"><h2>Play on</h2><button class="link" data-a="refresh-devices">${icon('refresh')} Refresh</button></div>
      <div class="sp-devices" id="sp-devices"><p class="muted small">Looking for speakers…</p></div>
      <p class="muted small sub-note">${icon('info')} Don’t see your Nest Mini or TV? Spotify only lists devices it has seen recently — open the Spotify app once and play to that speaker, then tap Refresh.</p>
    </section>

    <section class="section">
      <div class="search-bar">${icon('search')}<input class="input" type="search" id="sp-q" placeholder="Search songs, albums, playlists" aria-label="Search Spotify"></div>
      <div id="sp-results"></div>
    </section>

    <section class="section">
      <div class="section-head"><h2>Your playlists</h2></div>
      <div class="sp-lists" id="sp-lists"><p class="muted small">Loading…</p></div>
    </section>

    <p class="sp-foot"><button class="link" data-a="signout">${icon('logout')} Disconnect Spotify</button></p>`;
}

function deviceCard(d) {
  return `<button class="sp-dev ${d.is_active ? 'on' : ''} ${preferredDevice === d.id && !d.is_active ? 'picked' : ''}" data-dev="${esc(d.id || '')}" ${d.is_restricted || !d.id ? 'disabled' : ''}>
    <span class="sp-dev-ic">${icon(DEVICE_ICON[d.type] || 'speaker')}</span>
    <span class="sp-dev-txt"><b>${esc(d.name)}</b><small>${d.is_active ? 'Playing here' : esc(d.type === 'CastAudio' || d.type === 'CastVideo' ? 'Google Cast' : d.type)}</small></span>
    ${d.is_active ? '<span class="sp-dev-eq"><i></i><i></i><i></i></span>' : ''}
  </button>`;
}

function itemRow(kind, it) {
  if (!it) return '';
  const art = kind === 'track' ? img(it.album?.images) : img(it.images);
  const sub = kind === 'track' ? (it.artists || []).map((a) => a.name).join(', ')
    : kind === 'album' ? `Album · ${(it.artists || []).map((a) => a.name).join(', ')}`
    : `Playlist${it.owner?.display_name ? ' · ' + it.owner.display_name : ''}`;
  return `<button class="sp-row" data-play-kind="${kind}" data-uri="${esc(it.uri)}">
    <span class="sp-thumb" ${art ? `style="background-image:url('${esc(art)}')"` : ''}>${art ? '' : icon('music')}</span>
    <span class="sp-row-txt"><b>${esc(it.name)}</b><small>${esc(sub)}</small></span>${icon('play', 'sp-row-play')}</button>`;
}

export function render(root) {
  if (!sp.isConnected()) return renderSetup(root);

  root.innerHTML = `
    <header class="page-head"><div><p class="eyebrow">Spotify</p><h1 class="title">Music</h1></div></header>
    ${playerHTML()}`;

  let pb = null; // last /me/player result
  let pbAt = 0;
  let seeking = false;
  let volBusy = 0;
  let alive = true;
  const $ = (s) => root.querySelector(s);

  const fail = (e) => toast(e.message || 'Spotify error', { icon: 'alert', type: 'error' });

  function paint() {
    const now = $('#sp-now');
    const item = pb?.item;
    const playing = !!pb?.is_playing;
    now.classList.toggle('playing', playing);
    const art = item ? img(item.album?.images || item.images || item.show?.images) : '';
    $('.sp-art-img').style.backgroundImage = art ? `url("${art}")` : '';
    $('.sp-bg').style.backgroundImage = art ? `url("${art}")` : '';
    $('.sp-title').textContent = item?.name || 'Nothing playing';
    $('.sp-artist').textContent = item ? (item.artists || []).map((a) => a.name).join(', ') || item.show?.name || '' : 'Pick a playlist or search below';
    $('.sp-play').innerHTML = icon(playing ? 'pause' : 'play');
    $('.sp-shuffle').classList.toggle('on', !!pb?.shuffle_state);
    const rep = pb?.repeat_state || 'off';
    $('.sp-repeat').classList.toggle('on', rep !== 'off');
    $('.sp-repeat').dataset.mode = rep;
    const dev = pb?.device;
    $('.sp-on-txt').innerHTML = dev ? `Playing on <b>${esc(dev.name)}</b>` : 'Choose a speaker';
    $('.sp-on-ic').innerHTML = icon(DEVICE_ICON[dev?.type] || 'speaker');
    if (dev && Date.now() - volBusy > 2500) {
      const v = $('.sp-vol');
      if (dev.volume_percent != null) { v.value = dev.volume_percent; v.style.setProperty('--f', dev.volume_percent / 100); $('.sp-vol-v').textContent = dev.volume_percent; }
      v.disabled = dev.supports_volume === false;
    }
    tick();
  }

  function tick() {
    if (seeking) return;
    const item = pb?.item;
    const dur = item?.duration_ms || 0;
    let pos = pb?.progress_ms || 0;
    if (pb?.is_playing) pos += Date.now() - pbAt;
    pos = Math.min(pos, dur);
    $('.sp-seek').value = dur ? Math.round((pos / dur) * 1000) : 0;
    $('.sp-seek').style.setProperty('--f', dur ? pos / dur : 0);
    $('.sp-pos').textContent = fmtTime(pos);
    $('.sp-dur').textContent = fmtTime(dur);
  }

  async function refreshPlayer() {
    try {
      pb = await sp.player();
      pbAt = Date.now();
      if (alive) paint();
    } catch (e) {
      if (e.status === 401 || /Not connected/.test(e.message)) { render(root); return; }
      console.warn(e);
    }
  }

  async function refreshDevices() {
    try {
      const list = await sp.devices();
      const el = $('#sp-devices');
      if (!el) return;
      el.innerHTML = list.length ? list.map(deviceCard).join('')
        : `<p class="muted small">No speakers found. Open Spotify on your phone, TV or computer, then tap Refresh.</p>`;
    } catch (e) { fail(e); }
  }

  async function loadPlaylists() {
    try {
      const lists = await sp.playlists();
      $('#sp-lists').innerHTML = lists.length ? lists.map((p) => `<button class="sp-pl" data-play-kind="playlist" data-uri="${esc(p.uri)}">
          <span class="sp-pl-art" ${img(p.images) ? `style="background-image:url('${esc(img(p.images))}')"` : ''}>${img(p.images) ? '' : icon('music')}</span>
          <b>${esc(p.name)}</b></button>`).join('')
        : '<p class="muted small">No playlists yet.</p>';
    } catch (e) { $('#sp-lists').innerHTML = `<p class="muted small">${esc(e.message)}</p>`; }
  }

  /** Run a playback command; if no device is active, start on the chosen speaker. */
  async function withDevice(fn) {
    try {
      await fn(pb?.device ? undefined : preferredDevice || undefined);
    } catch (e) {
      if (e.reason === 'NO_ACTIVE_DEVICE' || e.status === 404) {
        const list = await sp.devices().catch(() => []);
        const target = list.find((d) => d.id === preferredDevice) || list[0];
        if (!target) { toast('No speaker available', { icon: 'speaker', detail: 'Open Spotify on a phone, TV or speaker first, then tap Refresh.' }); return; }
        try { await fn(target.id); } catch (e2) { fail(e2); return; }
      } else { fail(e); return; }
    }
    setTimeout(refreshPlayer, 450);
    setTimeout(refreshDevices, 900);
  }

  const onClick = async (e) => {
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (a) haptic(6);
    if (a === 'play') {
      const playing = pb?.is_playing;
      if (pb) { pb.is_playing = !playing; pb.progress_ms += Date.now() - pbAt; pbAt = Date.now(); paint(); }
      return withDevice((dev) => (playing ? sp.pause() : sp.play({}, dev)));
    }
    if (a === 'next') return withDevice(() => sp.next());
    if (a === 'prev') return withDevice(() => sp.previous());
    if (a === 'shuffle') return withDevice(() => sp.shuffle(!pb?.shuffle_state));
    if (a === 'repeat') {
      const order = ['off', 'context', 'track'];
      const nextMode = order[(order.indexOf(pb?.repeat_state || 'off') + 1) % 3];
      toast(`Repeat: ${{ off: 'off', context: 'all', track: 'this song' }[nextMode]}`, { icon: 'repeat', duration: 1400 });
      return withDevice(() => sp.repeat(nextMode));
    }
    if (a === 'refresh-devices') return refreshDevices();
    if (a === 'jump-devices') return $('#sp-devices-sec').scrollIntoView({ behavior: 'smooth', block: 'start' });
    if (a === 'signout') {
      if (await confirmDialog({ title: 'Disconnect Spotify?', message: 'You can connect again any time.', confirm: 'Disconnect' })) { sp.signOut(); render(root); }
      return;
    }
    const dev = e.target.closest('[data-dev]');
    if (dev && dev.dataset.dev) {
      haptic(10);
      preferredDevice = dev.dataset.dev;
      root.querySelectorAll('.sp-dev').forEach((b) => b.classList.toggle('picked', b === dev));
      if (pb?.item) {
        try {
          await sp.transfer(dev.dataset.dev, true);
          toast(`Playing on ${dev.querySelector('b').textContent}`, { icon: 'speaker', type: 'success' });
        } catch (err) { fail(err); }
        setTimeout(refreshPlayer, 700);
        setTimeout(refreshDevices, 1200);
      } else {
        toast(`${dev.querySelector('b').textContent} selected`, { icon: 'speaker', detail: 'Now pick something to play.' });
      }
      return;
    }
    const row = e.target.closest('[data-play-kind]');
    if (row) {
      haptic(10);
      const kind = row.dataset.playKind;
      const uri = row.dataset.uri;
      const body = kind === 'track' ? { uris: [uri] } : { context_uri: uri };
      row.classList.add('pressed');
      setTimeout(() => row.classList.remove('pressed'), 500);
      return withDevice((devId) => sp.play(body, devId || pb?.device?.id));
    }
  };
  root.addEventListener('click', onClick);

  const seek = $('.sp-seek');
  seek.addEventListener('input', () => {
    seeking = true;
    const dur = pb?.item?.duration_ms || 0;
    $('.sp-pos').textContent = fmtTime((seek.value / 1000) * dur);
    seek.style.setProperty('--f', seek.value / 1000);
  });
  seek.addEventListener('change', async () => {
    const dur = pb?.item?.duration_ms || 0;
    const ms = (seek.value / 1000) * dur;
    if (pb) { pb.progress_ms = ms; pbAt = Date.now(); }
    seeking = false;
    try { await sp.seek(ms); } catch (e) { fail(e); }
  });

  const vol = $('.sp-vol');
  const sendVol = debounce((v) => sp.volume(v).catch(fail), 250);
  vol.addEventListener('input', () => {
    volBusy = Date.now();
    vol.style.setProperty('--f', vol.value / 100);
    $('.sp-vol-v').textContent = vol.value;
    sendVol(+vol.value);
  });

  const q = $('#sp-q');
  const doSearch = debounce(async () => {
    const term = q.value.trim();
    const out = $('#sp-results');
    if (!term) { out.innerHTML = ''; return; }
    try {
      const r = await sp.search(term);
      const rows = [
        ...(r.tracks?.items || []).slice(0, 6).map((t) => itemRow('track', t)),
        ...(r.playlists?.items || []).filter(Boolean).slice(0, 3).map((p) => itemRow('playlist', p)),
        ...(r.albums?.items || []).filter(Boolean).slice(0, 3).map((a) => itemRow('album', a)),
      ].join('');
      out.innerHTML = rows ? `<div class="sp-results">${rows}</div>` : `<p class="muted small">Nothing found for “${esc(term)}”.</p>`;
    } catch (e) { out.innerHTML = `<p class="muted small">${esc(e.message)}</p>`; }
  }, 350);
  q.addEventListener('input', doSearch);

  refreshPlayer();
  refreshDevices();
  loadPlaylists();
  const poll = setInterval(() => { if (!document.hidden) refreshPlayer(); }, 4000);
  const devPoll = setInterval(() => { if (!document.hidden) refreshDevices(); }, 15000);
  const ticker = setInterval(() => { if (pb?.is_playing) tick(); }, 1000);
  return () => {
    alive = false;
    clearInterval(poll); clearInterval(devPoll); clearInterval(ticker);
    root.removeEventListener('click', onClick);
  };
}

function renderSetup(root) {
  root.innerHTML = `<header class="page-head"><div><p class="eyebrow">Spotify</p><h1 class="title">Music</h1></div></header>${setupHTML()}`;
  const onClick = async (e) => {
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (a === 'copy') {
      try { await navigator.clipboard.writeText(sp.redirectUri()); toast('Redirect URI copied', { icon: 'check', type: 'success' }); }
      catch { toast('Select and copy it manually', { icon: 'info' }); }
    }
    if (a === 'connect') {
      const btn = e.target.closest('button');
      btn.classList.add('loading');
      try { await sp.signIn(root.querySelector('#sp-client').value); }
      catch (err) { toast('Couldn’t start Spotify sign-in', { icon: 'alert', type: 'error', detail: err.message }); }
      finally { setTimeout(() => btn.classList.remove('loading'), 1500); }
    }
  };
  root.addEventListener('click', onClick);
  return () => root.removeEventListener('click', onClick);
}
