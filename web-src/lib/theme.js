import { createSignal, createEffect, createRoot } from 'solid-js';

const STORAGE_KEY = 'lyrics-visualizer:theme';

function detectInitial() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'light' || stored === 'dark') return stored;
  } catch { /* localStorage unavailable */ }
  return window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

// Module-level singleton, not per-component: the theme is app-global (also
// read by the inline FOUC-guard script in index.html, which sets the same
// data-theme attribute/localStorage key before Solid even mounts).
const { theme, toggleTheme } = createRoot(() => {
  const [theme, setTheme] = createSignal(detectInitial());

  createEffect(() => {
    document.documentElement.dataset.theme = theme();
    try { localStorage.setItem(STORAGE_KEY, theme()); } catch { /* ignore */ }
  });

  function toggleTheme() {
    setTheme((t) => (t === 'dark' ? 'light' : 'dark'));
  }

  return { theme, toggleTheme };
});

export { theme, toggleTheme };
