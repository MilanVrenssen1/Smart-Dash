// Small, dependency-free helpers shared across the app.

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

export const uid = (p = '') =>
  p + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
export const round = (v, step = 1) => Math.round(v / step) * step;

export function fmtNum(v, decimals = 0) {
  if (v == null || Number.isNaN(+v)) return '–';
  return (+v).toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

export function fmtPower(w) {
  if (w == null) return '–';
  if (w >= 1000) return `${fmtNum(w / 1000, 2)} kW`;
  return `${fmtNum(w, w < 10 ? 1 : 0)} W`;
}

export function debounce(fn, ms = 200) {
  let t;
  return (...a) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
}

export function relTime(t) {
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 10) return 'just now';
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return new Date(t).toLocaleDateString();
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const prefersReducedMotion = () =>
  document.documentElement.classList.contains('reduce-motion') ||
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ---------------- Color helpers ---------------- */

export function hexToRgb(hex) {
  let h = String(hex || '').replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h, 16);
  if (Number.isNaN(n)) return [255, 255, 255];
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export const rgbToHex = (r, g, b) =>
  '#' + [r, g, b].map((v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join('');

/** Approximate colour of a black body at the given kelvin temperature. */
export function kelvinToHex(k) {
  const t = clamp(k, 1000, 40000) / 100;
  let r, g, b;
  if (t <= 66) {
    r = 255;
    g = 99.4708025861 * Math.log(t) - 161.1195681661;
    b = t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  } else {
    r = 329.698727446 * Math.pow(t - 60, -0.1332047592);
    g = 288.1221695283 * Math.pow(t - 60, -0.0755148492);
    b = 255;
  }
  return rgbToHex(r, g, b);
}

/** sRGB hex -> CIE xy (as used by the Philips Hue API). */
export function hexToXy(hex) {
  const lin = (c) => {
    c /= 255;
    return c > 0.04045 ? Math.pow((c + 0.055) / 1.055, 2.4) : c / 12.92;
  };
  const [r, g, b] = hexToRgb(hex).map(lin);
  const X = r * 0.4124 + g * 0.3576 + b * 0.1805;
  const Y = r * 0.2126 + g * 0.7152 + b * 0.0722;
  const Z = r * 0.0193 + g * 0.1192 + b * 0.9505;
  const sum = X + Y + Z || 1;
  return [+(X / sum).toFixed(4), +(Y / sum).toFixed(4)];
}

/** CIE xy -> sRGB hex at full brightness. */
export function xyToHex(x, y) {
  const z = 1 - x - y;
  const Y = 1;
  const X = (Y / (y || 0.0001)) * x;
  const Z = (Y / (y || 0.0001)) * z;
  let r = X * 3.2406 - Y * 1.5372 - Z * 0.4986;
  let g = -X * 0.9689 + Y * 1.8758 + Z * 0.0415;
  let b = X * 0.0557 - Y * 0.204 + Z * 1.057;
  const gamma = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);
  [r, g, b] = [r, g, b].map((c) => Math.max(0, gamma(c)));
  const m = Math.max(r, g, b, 1e-6);
  return rgbToHex((r / m) * 255, (g / m) * 255, (b / m) * 255);
}

export function hsToHex(h, s) {
  // h: 0-360, s: 0-100, v = 100
  s /= 100;
  const f = (n) => {
    const k = (n + h / 60) % 6;
    return 255 * (1 - s * Math.max(0, Math.min(k, 4 - k, 1)));
  };
  return rgbToHex(f(5), f(3), f(1));
}
