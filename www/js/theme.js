import { store } from './store.js';

// Metals. [dark-theme tone, highlight]; light theme uses deeper tones for contrast.
export const ACCENTS = {
  champagne: ['#c9ab72', '#e4cf9f'],
  platinum: ['#c3c6ca', '#e7e8ea'],
  rosegold: ['#c9977f', '#e9c6b4'],
  bronze: ['#b08157', '#d6ae84'],
  sage: ['#a3b49c', '#cfd9c9'],
};
const ACCENTS_LIGHT = {
  champagne: ['#94743a', '#b8975a'],
  platinum: ['#6f747b', '#9a9fa6'],
  rosegold: ['#9c6550', '#c08b75'],
  bronze: ['#82582f', '#a87a4f'],
  sage: ['#5f7559', '#87a07f'],
};

export const installPrompt = { event: null };

const mq = window.matchMedia('(prefers-color-scheme: light)');

export function applyTheme() {
  const s = store.state.settings;
  const root = document.documentElement;
  const theme = s.theme === 'auto' ? (mq.matches ? 'light' : 'dark') : s.theme;
  root.dataset.theme = theme;
  const key = ACCENTS[s.accent] ? s.accent : 'champagne';
  const [a, b] = (theme === 'light' ? ACCENTS_LIGHT : ACCENTS)[key];
  root.style.setProperty('--accent', a);
  root.style.setProperty('--accent-2', b);
  root.classList.toggle('reduce-motion', !!s.reduceMotion);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = theme === 'light' ? '#f4f1eb' : '#0b0b0c';
  // Native status bar (Capacitor) if the plugin is present.
  try {
    const SB = window.Capacitor?.Plugins?.StatusBar;
    SB?.setStyle?.({ style: theme === 'light' ? 'LIGHT' : 'DARK' });
    SB?.setBackgroundColor?.({ color: theme === 'light' ? '#f4f1eb' : '#0b0b0c' });
  } catch { /* not native */ }
}

mq.addEventListener?.('change', () => store.state.settings.theme === 'auto' && applyTheme());

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installPrompt.event = e;
  const row = document.querySelector('.install-row');
  if (row) row.hidden = false;
});
