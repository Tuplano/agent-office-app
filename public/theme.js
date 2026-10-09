// The saved theme, or else the system's, set before the page paints. Kept apart
// from the app so that it runs first; `src/lib/theme.ts` takes over from there.
(() => {
  let theme = null;
  try {
    theme = localStorage.getItem('agent-office-theme');
  } catch {
    // storage is off
  }
  if (theme !== 'dark' && theme !== 'light') theme = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  document.documentElement.dataset.theme = theme;
})();
