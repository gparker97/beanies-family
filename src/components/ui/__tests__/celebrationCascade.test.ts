import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import postcss, { type Container } from 'postcss';

/**
 * `.is-celebration` goes on in-flow chips AND on the absolutely positioned cards of
 * every time grid (desktop week, desktop day lanes, mobile DayTimeline, wall time
 * blocks). Its `position: relative` is only a default for the chips.
 *
 * Until 2026-09-27 the rule was unlayered, and unlayered CSS beats every Tailwind
 * layer whatever the specificity, so it overrode `absolute` on the grid cards. A
 * birthday card fell into normal flow, its nowrap text widened its `1fr` column,
 * and the rest of the week (or the other bean lanes) shrank under their headers:
 * a Sunday event drew across Thursday to Saturday. jsdom cannot compute a cascade,
 * so this asserts the structure that makes the utility win instead.
 */
function layerOf(node: Container | undefined): string | null {
  for (let n = node; n; n = n.parent as Container | undefined) {
    if (n.type === 'atrule' && (n as postcss.AtRule).name === 'layer') {
      return (n as postcss.AtRule).params;
    }
  }
  return null;
}

describe('celebration tier cascade', () => {
  const root = postcss.parse(readFileSync(resolve(__dirname, '../../../style.css'), 'utf8'));

  it('declares its default positioning inside a layer, so `absolute` on a grid card wins', () => {
    const positioned: { selector: string; layer: string | null }[] = [];
    root.walkDecls('position', (decl) => {
      const rule = decl.parent as postcss.Rule;
      if (rule.selector?.includes('.is-celebration')) {
        positioned.push({ selector: rule.selector, layer: layerOf(rule) });
      }
    });

    expect(positioned.map((p) => p.selector)).toContain('.is-celebration');
    for (const p of positioned) {
      expect(p.layer, `${p.selector} must not be unlayered`).toBe('components');
    }
  });
});
