import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// Semantic tokens from design/system.md ("Round 2 extensions › Themes").
const STATUSES = ['free', 'occupied', 'kitchen', 'served', 'reserved', 'danger', 'warning', 'ok'];
const SEMANTIC_TOKENS = [
  '--canvas',
  '--surface',
  '--surface-2',
  '--line',
  '--line-strong',
  '--text',
  '--text-2',
  '--text-muted',
  '--accent',
  '--accent-strong',
  '--accent-contrast',
  '--accent-tint',
  '--accent-line',
  '--focus',
  '--btn-bg',
  '--btn-fg',
  '--radius-card',
  '--radius-card-lg',
  '--radius-pill',
  '--shadow-glow',
  '--shadow-glow-lg',
  '--shadow-elevated',
  ...STATUSES.flatMap((s) => ['bg', 'fg', 'line'].map((p) => `--status-${s}-${p}`)),
];

const css = readFileSync(path.resolve(__dirname, '../../app/globals.css'), 'utf8');

function block(selector: string): Record<string, string> {
  const start = css.search(new RegExp(`(^|\\s)${selector.replace('.', '\\.')}\\s*\\{`));
  expect(start, `${selector} block`).toBeGreaterThanOrEqual(0);
  const body = css.slice(css.indexOf('{', start) + 1, css.indexOf('}', start));
  const vars: Record<string, string> = {};
  for (const m of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) vars[m[1]] = m[2].trim();
  return vars;
}

describe.each([':root', '.dark'])('theme tokens in %s', (selector) => {
  const vars = block(selector);

  it('declares every semantic token', () => {
    expect(SEMANTIC_TOKENS.filter((t) => !(t in vars))).toEqual([]);
  });

  it('paints the sidebar with the page background (S7)', () => {
    expect(vars['--background']).toBeDefined();
    expect(vars['--sidebar-background']).toBe(vars['--background']);
  });

  it('uses the violet accent for the active sidebar item (S7)', () => {
    expect(vars['--sidebar-primary']).toBe(vars['--primary']);
  });
});
