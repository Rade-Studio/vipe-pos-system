import type { Config } from 'tailwindcss';

// Colors come from the CSS variables in src/styles.css, copied from
// design/estacion-vipe/01-panel-con-menu.html (light and dark).
const v = (name: string) => `var(--${name})`;

export default {
  darkMode: ['class', '[data-theme="dark"]'],
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        canvas: v('canvas'),
        surface: v('surface'),
        'surface-2': v('surface-2'),
        line: v('line'),
        'line-strong': v('line-strong'),
        text: v('text'),
        'text-2': v('text-2'),
        muted: v('text-muted'),
        accent: v('accent'),
        'accent-strong': v('accent-strong'),
        'accent-tint': v('accent-tint'),
        'accent-line': v('accent-line'),
        'accent-contrast': v('accent-contrast'),
        focus: v('focus'),
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', '-apple-system', '"Segoe UI"', 'Roboto', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      boxShadow: { glow: v('glow'), elev: v('elev') },
    },
  },
  plugins: [],
} satisfies Config;
