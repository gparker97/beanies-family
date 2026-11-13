/**
 * The Sky Silk pill ink lives in ONE place: `--silk-ink` in `style.css`, with its dark partner.
 *
 * It was written three times (the `EverySessionTag`, a list tile's "Shows from ..." tag and the
 * list drawer's meta-band pill) as a raw `#1f5f80` plus a separate dark lift, once as utilities
 * and once as a scoped rule, so a contrast fix would have had to find all three. A source
 * assertion, because the light/dark pair is a stylesheet fact the test DOM does not resolve.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const src = (rel: string) => readFileSync(resolve(process.cwd(), 'src', rel), 'utf-8');

describe('the Sky Silk pill ink', () => {
  it('is defined once for light and once for dark', () => {
    const css = src('style.css');
    expect(css.match(/--silk-ink:/g)).toHaveLength(2);
    expect(css).toContain('--silk-ink: var(--color-silk-lift);');
  });

  it.each([
    'components/ui/EverySessionTag.vue',
    'components/lists/ListTile.vue',
    'components/lists/ListDetailModal.vue',
    'constants/reviewChipTones.ts',
    'components/settings/CalendarImportModal.vue',
  ])('%s reads the token, never the raw hex', (file) => {
    const text = src(file);
    expect(text).toContain('var(--silk-ink)');
    expect(text.toLowerCase()).not.toContain('#1f5f80');
  });
});
