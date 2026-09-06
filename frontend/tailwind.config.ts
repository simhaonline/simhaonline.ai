import type { Config } from 'tailwindcss';

const config: Config = {
  // Audit spec: dark mode class strategy, dark by default (html.dark in root layout).
  darkMode: 'class',
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        background: 'var(--background)',
        foreground: 'var(--foreground)',
      },
    },
  },
  plugins: [],
};
export default config;