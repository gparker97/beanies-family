/**
 * The beanies-origin event ids (plan 2026-11-17, A4): the derived id of every
 * activity PLUS every link's Google id, so pushed, adopted and imported events are
 * all recognised. Before this, the clash nudge only knew the derived ids, so an
 * adopted event (a foreign Google id) could clash with its own activity.
 */
import { describe, it, expect, vi } from 'vitest';
import { beaniesEventIds } from '../beaniesEventIds';
import { deterministicEventId } from '../deterministicEventId';

describe('beaniesEventIds', () => {
  it('holds the deterministic id of every activity', () => {
    const ids = beaniesEventIds(['11111111-2222-3333-4444-555555555555'], []);
    expect(ids).toEqual(new Set([deterministicEventId('11111111-2222-3333-4444-555555555555')]));
  });

  it('adds every link googleEventId: pushed, adopted, imported and instance ids', () => {
    const ids = beaniesEventIds(
      [],
      [
        { googleEventId: 'bpushedmaster' },
        { googleEventId: 'familys-own-adopted-event' },
        { googleEventId: 'imported-invitee-event' },
        { googleEventId: 'bseries_20261120T150000Z' },
      ]
    );
    expect([...ids].sort()).toEqual(
      [
        'bpushedmaster',
        'bseries_20261120T150000Z',
        'familys-own-adopted-event',
        'imported-invitee-event',
      ].sort()
    );
  });

  it('skips a blank activity id and hands it to onInvalid instead of throwing', () => {
    const onInvalid = vi.fn();
    const ids = beaniesEventIds(['', 'abcdef01'], [{ googleEventId: '' }], onInvalid);
    expect(ids).toEqual(new Set([deterministicEventId('abcdef01')]));
    expect(onInvalid).toHaveBeenCalledTimes(1);
    expect(onInvalid.mock.calls[0]![0]).toBe('');
  });

  it('without onInvalid a blank id is still skipped, never thrown', () => {
    expect(() => beaniesEventIds(['  '], [])).not.toThrow();
  });
});
