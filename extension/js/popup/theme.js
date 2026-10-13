/**
 * Theme: apply before paint to avoid a flash on popup open.
 */
export const THEME_KEY = 'dl_theme';

export function readTheme() {
  try { return localStorage.getItem(THEME_KEY) || 'auto'; } catch { return 'auto'; }
}

export function applyTheme(theme) {
  if (theme === 'light' || theme === 'dark') document.documentElement.dataset.theme = theme;
  else delete document.documentElement.dataset.theme;
}

applyTheme(readTheme());
