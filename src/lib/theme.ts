import { useEffect, useState } from 'react';

export type Theme = 'light' | 'dark';

// `public/theme.js` reads the same key to set the theme before the page first paints.
const KEY = 'agent-office-theme';

function saved(): Theme | null {
  try {
    const theme = localStorage.getItem(KEY);
    return theme === 'dark' || theme === 'light' ? theme : null;
  } catch {
    return null; // storage is off
  }
}

// the saved choice, or else the system's
export const chooseTheme = (choice: Theme | null, systemDark: boolean): Theme => choice ?? (systemDark ? 'dark' : 'light');

const system = () => matchMedia('(prefers-color-scheme: dark)');

// The page's theme and the way to swap it. The swap is remembered; until there has
// been one, the page follows the system.
export function useTheme() {
  const [theme, setTheme] = useState<Theme>(() => chooseTheme(saved(), system().matches));

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    const media = system();
    const follow = (event: MediaQueryListEvent) => {
      if (!saved()) setTheme(event.matches ? 'dark' : 'light');
    };
    media.addEventListener('change', follow);
    return () => media.removeEventListener('change', follow);
  }, []);

  const toggle = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    try {
      localStorage.setItem(KEY, next);
    } catch {
      // storage is off; the choice lasts until the window is closed
    }
  };
  return { theme, toggle };
}
