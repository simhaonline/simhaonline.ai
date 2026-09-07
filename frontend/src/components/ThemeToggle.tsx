'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Moon, Sun } from 'lucide-react';

// Theme toggle shared by every page. Persists to localStorage, falls back
// to the system preference, and toggles the `dark` class on <html>.
type Theme = 'dark' | 'light';

export function useTheme(): [Theme | null, () => void] {
  const [theme, setTheme] = useState<Theme | null>(null);
  useEffect(() => {
    const saved = window.localStorage.getItem('simha.theme') as Theme | null;
    const initial: Theme = saved || (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
    setTheme(initial);
    document.documentElement.classList.toggle('dark', initial === 'dark');
  }, []);
  const toggle = () => {
    setTheme((current) => {
      const next: Theme = current === 'dark' ? 'light' : 'dark';
      window.localStorage.setItem('simha.theme', next);
      document.documentElement.classList.toggle('dark', next === 'dark');
      return next;
    });
  };
  return [theme, toggle];
}

export function ThemeToggle() {
  const [theme, toggle] = useTheme();
  return (
    <button
      onClick={toggle}
      aria-label={theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode'}
      title={theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode'}
      className="theme-toggle"
      data-theme={theme || 'dark'}
    >
      {theme === 'light' ? <Moon size={16} /> : <Sun size={16} />}
    </button>
  );
}