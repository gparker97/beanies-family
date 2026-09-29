/**
 * The things magic beans can make, and the ONE way each is drawn.
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

import {
  MAGIC_DESTINATIONS,
  MAGIC_DESTINATION_KINDS,
  SHARE_COMPANIONS,
  companionsOf,
  magicTileCols,
} from '@/constants/magicDestinations';
import type { SharePayload } from '@/types/magicPayload';
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

describe('SHARE_COMPANIONS (#113)', () => {
  it('only names kinds that are real tiles, never a kind as its own companion', () => {
    for (const [primary, companions] of Object.entries(SHARE_COMPANIONS)) {
      expect(MAGIC_DESTINATION_KINDS).toContain(primary);
      for (const companion of companions ?? []) {
        expect(MAGIC_DESTINATION_KINDS).toContain(companion);
        expect(companion).not.toBe(primary);
      }
    }
  });
});

describe('companionsOf (#113)', () => {
  const env = { sourceFile: null };
  const event = {
    isEvent: true,
    title: 'Field trip',
    date: '2026-10-14',
    startTime: '',
    endTime: '',
    isAllDay: true,
    location: '',
    description: '',
    confidence: { title: 1, date: 1, startTime: 0, endTime: 0, location: 0 },
  };
  const item = {
    title: 'Sign the slip',
    details: null,
    dueDate: null,
    dueTime: null,
    timing: null,
    assigneeName: null,
    ownerCard: null,
    links: [],
  };

  it('counts the to-dos an event carries', () => {
    const payload: SharePayload = {
      kind: 'event',
      data: event,
      todo: { items: [item, item] },
      env,
    };
    expect(companionsOf(payload)).toEqual([{ kind: 'todo', count: 2 }]);
  });

  it('is empty for a single-kind event, and for an empty companion', () => {
    expect(companionsOf({ kind: 'event', data: event, env })).toEqual([]);
    expect(companionsOf({ kind: 'event', data: event, todo: { items: [] }, env })).toEqual([]);
  });

  it('is empty for a to-do-only result: the to-dos are the primary kind there', () => {
    expect(companionsOf({ kind: 'todo', data: { items: [item] }, env })).toEqual([]);
  });
});

describe('magicTileCols', () => {
  it('keeps up to three on one row, four two by two, and five as three and two', () => {
    expect([0, 1, 2, 3, 4, 5, 6].map(magicTileCols)).toEqual([1, 1, 2, 3, 2, 3, 3]);
  });
});
