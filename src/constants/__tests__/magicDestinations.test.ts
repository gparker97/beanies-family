/**
 * The three things magic beans can make, and the two ways each is drawn.
 *
 * The icon half needs a test because `BeanieIcon` deliberately does NOT complain about an
 * unknown name — it renders a three-dot placeholder, quietly, for reasons its own header sets
 * out at length. A typo here therefore ships as two grey dots in the correction picker and
 * nothing anywhere says so. (`plane` and `recipe` were exactly that, caught in a browser.)
 */
import { describe, expect, it } from 'vitest';

import { MAGIC_DESTINATIONS, MAGIC_DESTINATION_KINDS } from '@/constants/magicDestinations';
import { getIconDef } from '@/constants/icons';
import { readerForShareKind } from '@/composables/useMagicReader';

describe('MAGIC_DESTINATIONS', () => {
  it('names an icon the registry actually holds, for every kind', () => {
    for (const kind of MAGIC_DESTINATION_KINDS) {
      expect(getIconDef(MAGIC_DESTINATIONS[kind].icon), `${kind} has no icon`).toBeDefined();
    }
  });

  it('names a kind the dispatch registry actually routes, for every tile', () => {
    // A tile for a kind nothing routes would light up and then go nowhere.
    for (const kind of MAGIC_DESTINATION_KINDS) {
      expect(readerForShareKind(kind), `${kind} routes nowhere`).toBeDefined();
    }
  });

  it('gives every kind an emoji as well as an icon — two consumers, one vocabulary', () => {
    for (const kind of MAGIC_DESTINATION_KINDS) {
      expect(MAGIC_DESTINATIONS[kind].emoji.length).toBeGreaterThan(0);
    }
  });
});
