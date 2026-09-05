/**
 * The lineage warning must be dismissed by a PERSON, not by a timer.
 *
 * ⚠️ WHY. It reached the user as a transient toast over a 3px bar with no text
 * node, and during the first real two-session test greg missed it entirely and
 * reported the block as "the data just didn't sync". A message that says
 * unsaved work is at risk cannot be missable by looking at another window.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname, '../../../..');
const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8');
const code = (src: string) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*'))
    .join('\n');

describe('a lineage block is visible and persistent', () => {
  const banner = code(read('src/components/common/LineageBanner.vue'));

  it('binds to the existing latch flags — no new store state', () => {
    expect(banner).toContain('syncStore.podUnopenable');
    expect(banner).toContain("syncStore.backgroundSyncErrorKind === 'lineage'");
  });

  it('persists until the person dismisses it, never on a timer', () => {
    // A `setTimeout` here would reintroduce exactly the defect this replaces.
    expect(banner).not.toContain('setTimeout');
    expect(banner).toContain('dismissed');
  });

  it('re-arms when the latch clears, so a NEW block speaks again', () => {
    // The user dismissed the last block, not every future one.
    expect(banner).toContain('watch(blocked');
  });

  it('is mounted in the app shell beside the other banners', () => {
    const app = code(read('src/App.vue'));
    expect(app).toContain('<LineageBanner />');
  });

  it('the WALL shows it too — it renders none of App.vue banners', () => {
    // A `noChrome` route a family may leave up all day would otherwise stay
    // silent about the one state that needs a human.
    const stamp = code(read('src/components/wall/WallStatusStamp.vue'));
    expect(stamp).toContain("backgroundSyncErrorKind === 'lineage'");
  });
});
