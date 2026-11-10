// Spotify Web API client: PKCE sign-in, playback control and Spotify Connect device switching.
// Works in the Android app (redirect via com.smartdash.app://spotify-callback) and in the
// browser when Smart Dash is opened on http://127.0.0.1 or an https address.

const KEY = 'smartdash:spotify';
const API = 'https://api.spotify.com/v1';
const SCOPES = [
  'user-read-playback-state',
  'user-modify-playback-state',
  'user-read-currently-playing',
  'playlist-read-private',
  'playlist-read-collaborative',
].join(' ');
export const NATIVE_REDIRECT = 'com.smartdash.app://spotify-callback';

const isNative = () => !!window.Capacitor?.isNativePlatform?.();
const listeners = new Set();

function load() {
  try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; }
}
let state = load();
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* storage full/blocked */ }
  listeners.forEach((fn) => fn());
}

export const onChange = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
export const clientId = () => state.clientId || '';
export const isConnected = () => !!state.refreshToken;

export function redirectUri() {
  if (isNative()) return NATIVE_REDIRECT;
  return `${location.origin}${location.pathname}`;
}

/** Spotify only allows https or loopback-IP redirects for web pages. */
export function webRedirectAllowed() {
  if (isNative()) return true;
  return location.protocol === 'https:' || ['127.0.0.1', '[::1]'].includes(location.hostname);
}

/* ---------------- PKCE sign-in ---------------- */

const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function randomString(len = 64) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const v = crypto.getRandomValues(new Uint8Array(len));
  return Array.from(v, (x) => chars[x % chars.length]).join('');
}

export async function signIn(newClientId) {
  const id = (newClientId || state.clientId || '').trim();
  if (!/^[0-9a-f]{32}$/i.test(id)) throw new Error('That doesn’t look like a Spotify Client ID (32 letters and numbers).');
  if (!webRedirectAllowed()) {
    throw new Error('Spotify only allows sign-in from the Android app, an https address, or http://127.0.0.1 — not “localhost”. Open Smart Dash at http://127.0.0.1:5173 instead.');
  }
  const verifier = randomString(64);
  const challenge = b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
  const authState = randomString(16);
  state = { ...state, clientId: id, verifier, authState };
  save();
  const url = 'https://accounts.spotify.com/authorize?' + new URLSearchParams({
    client_id: id,
    response_type: 'code',
    redirect_uri: redirectUri(),
    code_challenge_method: 'S256',
    code_challenge: challenge,
    scope: SCOPES,
    state: authState,
  });
  const Browser = window.Capacitor?.Plugins?.Browser;
  if (isNative() && Browser) await Browser.open({ url });
  else location.href = url;
}

async function tokenRequest(params) {
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: state.clientId, ...params }).toString(),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error_description || data.error || `Spotify sign-in failed (${res.status})`);
  state = {
    ...state,
    accessToken: data.access_token,
    refreshToken: data.refresh_token || state.refreshToken,
    expiresAt: Date.now() + (data.expires_in - 60) * 1000,
  };
  save();
}

/** Finish sign-in from a redirect URL (native deep link or the web page URL). Returns true if handled. */
export async function handleRedirect(url) {
  let u;
  try { u = new URL(url); } catch { return false; }
  const code = u.searchParams.get('code');
  const err = u.searchParams.get('error');
  if (!code && !err) return false;
  if (u.searchParams.get('state') !== state.authState) return false;
  const verifier = state.verifier;
  state = { ...state, verifier: null, authState: null };
  save();
  if (err) throw new Error(err === 'access_denied' ? 'You cancelled the Spotify sign-in.' : `Spotify: ${err}`);
  await tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: redirectUri(), code_verifier: verifier });
  return true;
}

export function signOut() {
  state = { clientId: state.clientId };
  save();
}

let refreshing = null;
async function accessToken() {
  if (!state.refreshToken) throw new Error('Not connected to Spotify');
  if (state.accessToken && Date.now() < state.expiresAt) return state.accessToken;
  refreshing ||= tokenRequest({ grant_type: 'refresh_token', refresh_token: state.refreshToken })
    .catch((e) => { if (/invalid_grant|revoked/i.test(e.message)) signOut(); throw e; })
    .finally(() => { refreshing = null; });
  await refreshing;
  return state.accessToken;
}

/* ---------------- Web API ---------------- */

export class SpotifyError extends Error {
  constructor(message, status, reason) { super(message); this.status = status; this.reason = reason; }
}

async function call(method, path, { query, body } = {}) {
  const url = `${API}${path}${query ? '?' + new URLSearchParams(query) : ''}`;
  const doFetch = async () => fetch(url, {
    method,
    headers: { Authorization: `Bearer ${await accessToken()}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let res = await doFetch();
  if (res.status === 401) {
    state.expiresAt = 0;
    res = await doFetch();
  }
  if (res.status === 204 || res.status === 202) return null;
  const text = await res.text();
  const data = text ? (() => { try { return JSON.parse(text); } catch { return null; } })() : null;
  if (!res.ok) {
    const reason = data?.error?.reason;
    const msg = {
      NO_ACTIVE_DEVICE: 'No device is playing. Pick a speaker below first.',
      PREMIUM_REQUIRED: 'Controlling playback needs Spotify Premium.',
      QUOTA_EXCEEDED: 'Spotify limit reached for now — try again in a little while.',
    }[reason] || (res.status === 403 ? 'Spotify refused this. Is your account added under User Management in your Spotify app settings?' : data?.error?.message || `Spotify error ${res.status}`);
    throw new SpotifyError(msg, res.status, reason);
  }
  return data;
}

export const player = () => call('GET', '/me/player', { query: { additional_types: 'episode' } });
export const devices = () => call('GET', '/me/player/devices').then((d) => d?.devices || []);
export const transfer = (deviceId, play = true) => call('PUT', '/me/player', { body: { device_ids: [deviceId], play } });
export const play = (opts = {}, deviceId) => call('PUT', '/me/player/play', { query: deviceId ? { device_id: deviceId } : undefined, body: Object.keys(opts).length ? opts : undefined });
export const pause = () => call('PUT', '/me/player/pause');
export const next = () => call('POST', '/me/player/next');
export const previous = () => call('POST', '/me/player/previous');
export const volume = (pct) => call('PUT', '/me/player/volume', { query: { volume_percent: Math.round(pct) } });
export const shuffle = (on) => call('PUT', '/me/player/shuffle', { query: { state: on } });
export const repeat = (mode) => call('PUT', '/me/player/repeat', { query: { state: mode } });
export const seek = (ms) => call('PUT', '/me/player/seek', { query: { position_ms: Math.max(0, Math.round(ms)) } });
export const playlists = () => call('GET', '/me/playlists', { query: { limit: 30 } }).then((d) => (d?.items || []).filter(Boolean));
export const search = (q) => call('GET', '/search', { query: { q, type: 'track,playlist,album', limit: 10 } });

/* ---------------- Native deep-link listener ---------------- */

export function initSpotify(onSignedIn, onError) {
  const App = window.Capacitor?.Plugins?.App;
  App?.addListener?.('appUrlOpen', async ({ url }) => {
    if (!url?.startsWith(NATIVE_REDIRECT)) return;
    try { await window.Capacitor?.Plugins?.Browser?.close?.(); } catch { /* already closed */ }
    try { if (await handleRedirect(url)) onSignedIn(); } catch (e) { onError(e); }
  });
  // Web: Spotify sends us back to this page with ?code=…
  if (!isNative() && /[?&](code|error)=/.test(location.search)) {
    const url = location.href;
    history.replaceState(null, '', location.pathname + '#/music');
    handleRedirect(url).then((ok) => ok && onSignedIn()).catch(onError);
  }
}
