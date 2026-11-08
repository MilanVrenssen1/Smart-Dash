import { store } from './store.js';

export const ACCENTS = {
  violet: ['#7c5cff', '#22d3ee'],
  ocean: ['#3b82f6', '#2dd4bf'],
  emerald: ['#10b981', '#a3e635'],
  sunset: ['#f97316', '#f43f5e'],
  rose: ['#ec4899', '#a855f7'],
  gold: ['#eab308', '#f97316'],
  mono: ['#a1a1aa', '#e4e4e7'],
};

export const installPrompt = { event: null };

const mq = window.matchMedia('(prefers-color-scheme: light)');

export function applyTheme() {
  const s = store.state.settings;
  const root = document.documentElement;
  const theme = s.theme === 'auto' ? (mq.matches ? 'light' : 'dark') : s.theme;
  root.dataset.theme = theme;
  const [a, b] = ACCENTS[s.accent] || ACCENTS.violet;
  root.style.setProperty('--accent', a);
  root.style.setProperty('--accent-2', b);
  root.classList.toggle('reduce-motion', !!s.reduceMotion);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = theme === 'light' ? '#f4f5fa' : '#07080d';
  // Native status bar (Capacitor) if the plugin is present.
  try {
    const SB = window.Capacitor?.Plugins?.StatusBar;
    SB?.setStyle?.({ style: theme === 'light' ? 'LIGHT' : 'DARK' });
    SB?.setBackgroundColor?.({ color: theme === 'light' ? '#f4f5fa' : '#07080d' });
  } catch { /* not native */ }
}

mq.addEventListener?.('change', () => store.state.settings.theme === 'auto' && applyTheme());

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installPrompt.event = e;
  const row = document.querySelector('.install-row');
  if (row) row.hidden = false;
});
