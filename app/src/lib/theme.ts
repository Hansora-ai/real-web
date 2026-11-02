import { getPref, setPref } from './prefs';

export type ThemeChoice = 'dark' | 'light' | 'system';
const LOCAL_KEY = 'hansora.app.theme'; // also read by index.html before first paint

function resolve(choice: ThemeChoice): 'dark' | 'light' {
  if (choice !== 'system') return choice;
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

export function applyTheme(choice: ThemeChoice): void {
  const mode = resolve(choice);
  document.documentElement.setAttribute('data-theme', mode);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', mode === 'light' ? '#f7f7f8' : '#08090b');
  try { localStorage.setItem(LOCAL_KEY, choice); } catch { /* ignore */ }
}

export async function loadTheme(): Promise<ThemeChoice> {
  const saved = await getPref('theme');
  return saved === 'light' || saved === 'system' ? saved : 'dark'; // dark by default, like the website
}

export async function saveTheme(choice: ThemeChoice): Promise<void> {
  applyTheme(choice);
  await setPref('theme', choice);
}

window.matchMedia?.('(prefers-color-scheme: light)').addEventListener?.('change', () => {
  loadTheme().then(choice => { if (choice === 'system') applyTheme('system'); });
});
