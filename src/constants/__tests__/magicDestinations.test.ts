/**
 * The four things magic beans can make, and the ONE way each is drawn.
 *
 * This module is the add-a-new-kind checklist (see its header), and the whole point of that
 * checklist is that every item fails the BUILD. What a build cannot catch is a kind that has an
 * entry here but nowhere to go, so that is what these tests cover.
 *
 * ⚠️ There used to be a second rendering, `icon`, for the ChoiceModal the correction surface
 * opened — and it needed a test of its own, because `BeanieIcon` renders an unknown name as
 * three grey dots SILENTLY (`plane` and `recipe` shipped exactly that, caught in a browser).
 * The correction expands in place now and draws the same emoji as everywhere else, so both the
 * second vocabulary and its hazard are gone.
 */
import { describe, expect, it } from 'vitest';

import { MAGIC_DESTINATIONS, MAGIC_DESTINATION_KINDS } from '@/constants/magicDestinations';
import { readerForShareKind } from '@/composables/useMagicReader';

describe('MAGIC_DESTINATIONS', () => {
  it('names a kind the dispatch registry actually routes, for every tile', () => {
    // A tile for a kind nothing routes would light up and then go nowhere.
    for (const kind of MAGIC_DESTINATION_KINDS) {
      expect(readerForShareKind(kind), `${kind} routes nowhere`).toBeDefined();
    }
  });

  it('gives every kind an emoji — the one thing all three surfaces draw', () => {
    for (const kind of MAGIC_DESTINATION_KINDS) {
      expect(MAGIC_DESTINATIONS[kind].emoji.length).toBeGreaterThan(0);
    }
  });
});
