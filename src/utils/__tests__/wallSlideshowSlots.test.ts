/**
 * The sleep slideshow's slot state (#140): `fillSlides` between rotations, `tickSlides` on
 * each rotation, and the frame read from them. Pure, so no Vue.
 */
/* eslint-disable security/detect-object-injection -- fixtures index by slot ids and positions */
import { describe, it, expect } from 'vitest';
import {
  EMPTY_SLIDES,
  fillSlides,
  slideshowFrame,
  tickSlides,
  type SlideInputs,
  type SlideshowSlots,
} from '@/utils/wallSlideshowSlots';
import type { SlidePhoto, SlideText } from '@/utils/wallSlideshow';
import type { ScrapbookEntry } from '@/composables/useScrapbookFeed';

function photo(id: string, opts: { memberId?: string; entryId?: string } = {}): SlidePhoto {
  return {
    kind: 'photo',
    photoId: id,
    memberId: opts.memberId ?? null,
    source: 'milestone',
    entryId: opts.entryId,
  };
}

function note(id: string, memberId = 'm1'): SlideText {
  const entry = {
    id,
    type: 'note',
    memberId,
    effectiveDate: '2026-11-01T00:00:00Z',
    createdAt: '2026-11-01T00:00:00Z',
    payload: { id },
  } as unknown as SlideText['entry'] & ScrapbookEntry;
  return { kind: 'text', memberId, entry };
}

const photos = (n: number, prefix = 'ph') =>
  Array.from({ length: n }, (_, i) => photo(`${prefix}${i}`));
const notes = (n: number) => Array.from({ length: n }, (_, i) => note(`t${i}`));
const idsOf = (list: { photoId: string }[]) => list.map((p) => p.photoId);

function inputs(over: Partial<SlideInputs> = {}): SlideInputs {
  return {
    mode: 'around',
    shape: 'landscape',
    seed: '2026-11-12',
    deck: [],
    ready: new Set(),
    texts: [],
    photosPending: false,
    ...over,
  };
}

/** Slot -> the id it shows, from the frame (what is actually drawn). */
function drawn(state: SlideshowSlots, ready: ReadonlySet<string>): Record<string, string> {
  const f = slideshowFrame(state, ready);
  const out: Record<string, string> = {};
  if (f.layout === 'around') {
    for (const { slot, piece } of f.photos) out[slot] = piece.photoId;
    for (const { slot, piece } of f.texts) out[slot] = piece.entry.id;
  } else if (f.layout === 'full') {
    out.full = f.photo.photoId;
    for (const { slot, piece } of f.pins) out[slot] = piece.entry.id;
  }
  return out;
}

/** Slots whose piece differs between two drawings (empty to filled counts). */
function changedSlots(a: Record<string, string>, b: Record<string, string>): string[] {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys].filter((k) => a[k] !== b[k]).sort();
}

const isPhotoSlot = (slot: string) => /^p\d$|^full$/.test(slot);

/** Ready every photo in `list`, in that order. */
const readyOf = (list: SlidePhoto[]) => new Set(idsOf(list));

function start(inp: SlideInputs): SlideshowSlots {
  return fillSlides(EMPTY_SLIDES, inp);
}

describe('fillSlides', () => {
  it('fills the five tiles and two notes on a landscape wall', () => {
    const deck = photos(8);
    const inp = inputs({ deck, ready: readyOf(deck), texts: notes(4) });
    const d = drawn(start(inp), inp.ready);
    expect(Object.keys(d).sort()).toEqual(['n1', 'n2', 'p1', 'p2', 'p3', 'p4', 'p5']);
    expect(['p1', 'p2', 'p3', 'p4', 'p5'].every((s) => d[s]!.startsWith('ph'))).toBe(true);
  });

  it('puts photos in empty slots in the order they became ready, moving nothing', () => {
    const deck = photos(8);
    const texts: SlideText[] = [];
    let ready = new Set(['ph5']);
    let state = start(inputs({ deck, ready, texts }));
    expect(drawn(state, ready)).toEqual({ p1: 'ph5' });
    ready = new Set(['ph5', 'ph2', 'ph7']);
    state = fillSlides(state, inputs({ deck, ready, texts }));
    expect(drawn(state, ready)).toEqual({ p1: 'ph5', p2: 'ph2', p3: 'ph7' });
  });

  it('backfills tiles with texts when too few photos are ready (one usable photo, many notes)', () => {
    const deck = photos(3);
    const ready = new Set(['ph0']);
    const d = drawn(start(inputs({ deck, ready, texts: notes(9) })), ready);
    expect(Object.keys(d)).toHaveLength(7);
    expect(Object.values(d).filter((id) => id.startsWith('ph'))).toEqual(['ph0']);
  });

  it('with photos switched off, texts fill every tile', () => {
    const d = drawn(start(inputs({ texts: notes(9) })), new Set());
    expect(Object.keys(d).sort()).toEqual(['n1', 'n2', 'p1', 'p2', 'p3', 'p4', 'p5']);
  });

  it('a photo arriving between rotations never displaces a stand-in text; the next tick does', () => {
    const deck = photos(3);
    const texts = notes(9);
    let state = start(inputs({ deck, texts }));
    const before = drawn(state, new Set());
    const ready = readyOf(deck);
    state = fillSlides(state, inputs({ deck, ready, texts }));
    expect(drawn(state, ready)).toEqual(before);
    state = tickSlides(state, inputs({ deck, ready, texts }));
    expect(Object.values(drawn(state, ready)).filter((id) => id.startsWith('ph'))).toHaveLength(3);
  });

  it('a photo that errors after showing leaves at once and only its slot may refill', () => {
    const deck = photos(7);
    const all = readyOf(deck);
    let state = start(inputs({ deck, ready: all }));
    const before = drawn(state, all);
    const broken = before.p2!;
    const ready = new Set([...all].filter((id) => id !== broken));
    state = fillSlides(state, inputs({ deck, ready }));
    const after = drawn(state, ready);
    expect(changedSlots(before, after)).toEqual(['p2']);
    expect(after.p2).not.toBe(broken);
    expect(Object.values(after)).not.toContain(broken);
  });

  it('a photo that leaves the deck, or a deck reshuffle, moves no showing tile (finding 2)', () => {
    const deck = photos(12);
    const ready = new Set(idsOf(deck.slice(0, 6)));
    let state = start(inputs({ deck, ready }));
    const before = drawn(state, ready);
    const notShowing = deck.find((p) => !Object.values(before).includes(p.photoId))!;
    // A give-up mid-rotation: one candidate drops out, the next one joins at the back.
    const next = [...deck.filter((p) => p !== notShowing), photo('spare')];
    state = fillSlides(state, inputs({ deck: next, ready }));
    expect(drawn(state, ready)).toEqual(before);
  });

  it('keeps a deleted text on screen until the next rotation, then replaces only it', () => {
    const texts = notes(9);
    let state = start(inputs({ texts }));
    const before = drawn(state, new Set());
    const gone = before.n1!;
    const left = texts.filter((t) => t.entry.id !== gone);
    state = fillSlides(state, inputs({ texts: left }));
    expect(drawn(state, new Set())).toEqual(before);
    state = tickSlides(state, inputs({ texts: left }));
    const after = drawn(state, new Set());
    expect(Object.values(after)).not.toContain(gone);
    expect(changedSlots(before, after)).toContain('n1');
  });

  it("texts already up stay when a family's first photo starts loading", () => {
    const texts = notes(9);
    for (const mode of ['around', 'full'] as const) {
      let state = start(inputs({ mode, texts }));
      const before = drawn(state, new Set());
      expect(Object.keys(before)).toHaveLength(7);
      const loading = inputs({ mode, texts, deck: photos(1), photosPending: true });
      state = tickSlides(fillSlides(state, loading), loading);
      expect(Object.keys(drawn(state, new Set()))).toHaveLength(7);
    }
  });

  it('while photos are on the way, tiles wait for them and only the note slots show texts', () => {
    const deck = photos(8);
    const texts = notes(9);
    const pending = (ready: Set<string>) => inputs({ deck, ready, texts, photosPending: true });
    let state = start(pending(new Set()));
    expect(Object.keys(drawn(state, new Set())).sort()).toEqual(['n1', 'n2']);
    // Photos fill the empty tiles in arrival order; the notes do not move.
    const ready = new Set(['ph3', 'ph6']);
    state = fillSlides(state, pending(ready));
    const d = drawn(state, ready);
    expect([d.p1, d.p2, d.p3]).toEqual(['ph3', 'ph6', undefined]);
    const notesBefore = [d.n1, d.n2];
    // A rotation while pending still puts no text in a tile.
    state = tickSlides(state, pending(ready));
    expect(
      Object.entries(drawn(state, ready)).filter(([s, id]) => /^p/.test(s) && /^t/.test(id))
    ).toEqual([]);
    // The first pass settles: the tiles still empty take stand-in texts at once.
    const settledState = fillSlides(state, inputs({ deck, ready, texts }));
    const after = drawn(settledState, ready);
    expect(Object.keys(after)).toHaveLength(7);
    expect(
      Object.values(after)
        .filter((id) => id.startsWith('ph'))
        .sort()
    ).toEqual(['ph3', 'ph6']);
    expect(notesBefore.every((id) => id?.startsWith('t'))).toBe(true);
  });

  it('portrait: the text tile shows its text while photos are on the way', () => {
    const inp = inputs({
      shape: 'portrait',
      deck: photos(4),
      texts: notes(3),
      photosPending: true,
    });
    expect(Object.keys(drawn(start(inp), new Set()))).toEqual(['p4']);
  });

  it('full: plain while photos are on the way, then the photo at once; text fallback only once settled', () => {
    const deck = photos(3);
    const texts = notes(3);
    let state = start(inputs({ mode: 'full', deck, texts, photosPending: true }));
    expect(slideshowFrame(state, new Set())).toEqual({ layout: 'plain' });
    const ready = new Set(['ph1']);
    state = fillSlides(state, inputs({ mode: 'full', deck, ready, texts, photosPending: true }));
    const f = slideshowFrame(state, ready);
    expect(f).toMatchObject({ layout: 'full', photo: { photoId: 'ph1' } });
    if (f.layout === 'full') expect(f.pins).toHaveLength(2);

    let none = start(inputs({ mode: 'full', deck, texts, photosPending: true }));
    none = fillSlides(none, inputs({ mode: 'full', deck, texts }));
    expect(slideshowFrame(none, new Set()).layout).toBe('around');
  });

  it('returns the same state object when nothing changed', () => {
    const deck = photos(3);
    const inp = inputs({ deck, ready: readyOf(deck), texts: notes(2) });
    const state = start(inp);
    expect(fillSlides(state, inp)).toBe(state);
  });
});

describe('tickSlides', () => {
  it('around: exactly one photo tile and one text slot change per rotation', () => {
    const deck = photos(12);
    const inp = inputs({ deck, ready: readyOf(deck), texts: notes(9) });
    let state = start(inp);
    for (let i = 0; i < 20; i++) {
      const before = drawn(state, inp.ready);
      state = tickSlides(state, inp);
      const changed = changedSlots(before, drawn(state, inp.ready));
      expect(changed.filter(isPhotoSlot)).toHaveLength(1);
      expect(changed.filter((s) => !isPhotoSlot(s))).toHaveLength(1);
    }
  });

  it('the oldest photo tile is the one that changes (round robin)', () => {
    const deck = photos(12);
    const inp = inputs({ deck, ready: readyOf(deck) });
    let state = start(inp);
    const order: string[] = [];
    for (let i = 0; i < 10; i++) {
      const before = drawn(state, inp.ready);
      state = tickSlides(state, inp);
      order.push(...changedSlots(before, drawn(state, inp.ready)));
    }
    expect(order).toEqual(['p1', 'p2', 'p3', 'p4', 'p5', 'p1', 'p2', 'p3', 'p4', 'p5']);
  });

  it('with no ready photo off screen, the photo tiles keep what they have (finding 3)', () => {
    const deck = photos(12);
    const ready = new Set(idsOf(deck.slice(0, 5)));
    const inp = inputs({ deck, ready });
    let state = start(inp);
    const before = drawn(state, ready);
    for (let i = 0; i < 4; i++) state = tickSlides(state, inp);
    expect(drawn(state, ready)).toEqual(before);
  });

  it('never shows the same frame twice in a row while an unseen ready photo waits (finding 3)', () => {
    const deck = photos(12);
    // Half the deck never loads: those entries must not produce a repeated "rotation".
    const ready = new Set(idsOf(deck.filter((_, i) => i % 2 === 0)));
    const inp = inputs({ deck, ready });
    let state = start(inp);
    for (let i = 0; i < 12; i++) {
      const before = drawn(state, ready);
      state = tickSlides(state, inp);
      expect(drawn(state, ready)).not.toEqual(before);
    }
  });

  it('portrait: the text memory stays in p4 while photos arrive (finding 6)', () => {
    const deck = photos(6);
    const texts = notes(3);
    let ready = new Set<string>();
    let state = start(inputs({ shape: 'portrait', deck, ready, texts }));
    const textAt = () => drawn(state, ready).p4;
    expect(textAt()).toMatch(/^t/);
    const firstText = textAt();
    for (const p of deck) {
      ready = new Set([...ready, p.photoId]);
      state = fillSlides(state, inputs({ shape: 'portrait', deck, ready, texts }));
      expect(textAt()).toBe(firstText);
    }
    state = tickSlides(state, inputs({ shape: 'portrait', deck, ready, texts }));
    const d = drawn(state, ready);
    expect(['p1', 'p2', 'p3'].every((s) => d[s]!.startsWith('ph'))).toBe(true);
    expect(d.p4).toMatch(/^t/);
    expect(Object.keys(d).sort()).toEqual(['p1', 'p2', 'p3', 'p4']);
  });

  it('portrait with no texts: four photos', () => {
    const deck = photos(6);
    const inp = inputs({ shape: 'portrait', deck, ready: readyOf(deck) });
    const d = drawn(start(inp), inp.ready);
    expect(Object.values(d).every((id) => id.startsWith('ph'))).toBe(true);
    expect(Object.keys(d)).toHaveLength(4);
  });

  it('a walk cursor keyed by id: removing a deck entry does not move the window', () => {
    const deck = photos(12);
    const inp = inputs({ deck, ready: readyOf(deck) });
    let a = start(inp);
    for (let i = 0; i < 3; i++) a = tickSlides(a, inp);
    // The same history, but one photo the walk has already passed leaves the deck.
    const passed = deck.find((p) => p.photoId === a.photoCursor)!;
    const shown = new Set(Object.values(drawn(a, inp.ready)));
    const victim = deck.find((p) => p !== passed && !shown.has(p.photoId))!;
    const fewer = { ...inp, deck: deck.filter((p) => p !== victim) };
    const nextFull = drawn(tickSlides(a, inp), inp.ready);
    const nextFewer = drawn(tickSlides(fillSlides(a, fewer), fewer), fewer.ready);
    if (Object.values(nextFull).includes(victim.photoId)) return; // the victim was due next
    expect(nextFewer).toEqual(nextFull);
  });

  it('full: one photo advancing, pins preferring its own bean', () => {
    const deck = [photo('a', { memberId: 'm2' }), photo('b', { memberId: 'm1' })];
    const texts = [note('x1', 'm1'), note('y1', 'm2'), note('x2', 'm1'), note('y2', 'm2')];
    const inp = inputs({ mode: 'full', deck, ready: readyOf(deck), texts });
    let state = start(inp);
    const seen: string[] = [];
    for (let i = 0; i < 4; i++) {
      const f = slideshowFrame(state, inp.ready);
      if (f.layout !== 'full') throw new Error('expected full');
      seen.push(f.photo.photoId);
      expect(f.pins).toHaveLength(2);
      expect(f.pins.every((p) => p.piece.memberId === f.photo.memberId)).toBe(true);
      state = tickSlides(state, inp);
    }
    expect(new Set(seen)).toEqual(new Set(['a', 'b']));
    expect(seen[0]).not.toBe(seen[1]);
  });

  it("full: a rotation replaces the pin that does not match the photo's bean, never the one that does", () => {
    // One photo, so it never advances: only the text rotation moves the pins.
    const deck = [photo('a', { memberId: 'm1' })];
    const texts = [note('x1', 'm1'), note('y1', 'm2'), note('y2', 'm2'), note('y3', 'm2')];
    const inp = inputs({ mode: 'full', deck, ready: readyOf(deck), texts });
    let state = start(inp);
    for (let i = 0; i < 6; i++) {
      const before = drawn(state, inp.ready);
      expect(Object.values(before)).toContain('x1');
      state = tickSlides(state, inp);
      const after = drawn(state, inp.ready);
      expect(Object.values(after)).toContain('x1');
      expect(changedSlots(before, after)).toHaveLength(1);
    }
  });

  it("full: a pin matching the photo's bean never gives way to another bean's text", () => {
    const deck = [photo('a', { memberId: 'm1' })];
    const texts = [note('x1', 'm1'), note('x2', 'm1'), note('y1', 'm2')];
    const inp = inputs({ mode: 'full', deck, ready: readyOf(deck), texts });
    let state = start(inp);
    const before = drawn(state, inp.ready);
    expect([before.pin1, before.pin2].sort()).toEqual(['x1', 'x2']);
    for (let i = 0; i < 4; i++) state = tickSlides(state, inp);
    expect(drawn(state, inp.ready)).toEqual(before);
  });

  it('full with no ready photo falls back to texts around the clock', () => {
    const inp = inputs({ mode: 'full', deck: photos(3), texts: notes(3) });
    const f = slideshowFrame(start(inp), inp.ready);
    expect(f.layout).toBe('around');
    if (f.layout !== 'around') return;
    expect(f.photos).toEqual([]);
    expect(f.texts.map((t) => t.slot).sort()).toEqual(['p1', 'p2', 'p3']);
  });

  it('full: a photo ready during the text fallback waits for the tick; on an empty screen it shows at once', () => {
    const deck = photos(2);
    const ready = new Set(['ph0']);
    let state = start(inputs({ mode: 'full', deck, texts: notes(2) }));
    state = fillSlides(state, inputs({ mode: 'full', deck, ready, texts: notes(2) }));
    expect(slideshowFrame(state, ready).layout).toBe('around');
    state = tickSlides(state, inputs({ mode: 'full', deck, ready, texts: notes(2) }));
    expect(slideshowFrame(state, ready).layout).toBe('full');

    let bare = start(inputs({ mode: 'full', deck }));
    bare = fillSlides(bare, inputs({ mode: 'full', deck, ready }));
    expect(slideshowFrame(bare, ready)).toMatchObject({
      layout: 'full',
      photo: { photoId: 'ph0' },
    });
  });

  it('full: the only photo erroring falls back to texts at once, never a frame without its photo', () => {
    const deck = photos(1);
    const ready = readyOf(deck);
    let state = start(inputs({ mode: 'full', deck, ready, texts: notes(3) }));
    expect(slideshowFrame(state, ready).layout).toBe('full');
    state = fillSlides(state, inputs({ mode: 'full', deck, ready: new Set(), texts: notes(3) }));
    expect(slideshowFrame(state, new Set()).layout).toBe('around');
  });
});

describe('slot invariants', () => {
  /** A seeded event sequence: photos becoming ready, erroring, leaving the deck, and ticks. */
  function run(seed: number, mode: 'around' | 'full' = 'around', shape = 'landscape' as const) {
    let rand = seed;
    const next = () => {
      rand = (rand * 1103515245 + 12345) % 2147483648;
      return rand / 2147483648;
    };
    let deck = Array.from({ length: 12 }, (_, i) =>
      photo(`ph${i}`, { entryId: `ms${i % 5}`, memberId: `m${i % 3}` })
    );
    let texts = Array.from({ length: 8 }, (_, i) => note(`t${i}`, `m${i % 3}`));
    let ready = new Set<string>();
    let state = EMPTY_SLIDES;
    const states: { state: SlideshowSlots; ready: Set<string>; pending: boolean }[] = [];
    for (let step = 0; step < 300; step++) {
      const r = next();
      if (r < 0.25) {
        const p = deck[Math.floor(next() * deck.length)];
        if (p) ready = new Set([...ready, p.photoId]);
      } else if (r < 0.3) {
        const id = [...ready][Math.floor(next() * ready.size)];
        ready = new Set([...ready].filter((x) => x !== id));
      } else if (r < 0.33) {
        const p = deck[Math.floor(next() * deck.length)];
        deck = deck.filter((x) => x !== p);
        ready = new Set([...ready].filter((x) => x !== p?.photoId));
      } else if (r < 0.35) {
        texts = texts.slice(1);
      }
      // The first stretch runs with the loader's first pass still under way.
      const inp = inputs({ mode, shape, deck, ready, texts, photosPending: step < 80 });
      state = r > 0.6 ? tickSlides(state, inp) : fillSlides(state, inp);
      states.push({ state, ready, pending: inp.photosPending });
    }
    return states;
  }

  it.each([1, 7, 42, 99])(
    'seed %i: no duplicate, nothing unready, no tile changes slot',
    (seed) => {
      for (const mode of ['around', 'full'] as const) {
        const states = run(seed, mode);
        let prev: Record<string, string> = {};
        let prevLayout = '';
        for (const { state, ready, pending } of states) {
          const d = drawn(state, ready);
          // Photos on the way: no stand-in text in a tile, and no text fallback full screen.
          for (const [slot, id] of Object.entries(d)) {
            if (!pending || !id.startsWith('t')) continue;
            expect(slot.startsWith('pin') || (mode === 'around' && slot.startsWith('n'))).toBe(
              true
            );
          }
          // A layout change (full screen gaining or losing its photo) crossfades the whole layer.
          if (state.layout !== prevLayout) prev = {};
          prevLayout = state.layout;
          const values = Object.values(d);
          expect(new Set(values).size).toBe(values.length);
          for (const [slot, id] of Object.entries(d)) {
            if (id.startsWith('ph')) expect(ready.has(id)).toBe(true);
            const was = Object.entries(prev).find(([, pid]) => pid === id)?.[0];
            if (was) expect(slot).toBe(was);
          }
          prev = d;
        }
      }
    }
  );

  it('is deterministic for a seed and an event sequence', () => {
    expect(run(5)).toEqual(run(5));
  });

  it('every ready photo is shown within a few laps (fairness), moments repeating', () => {
    const deck = Array.from({ length: 12 }, (_, i) => photo(`ph${i}`, { entryId: `ms${i % 4}` }));
    const inp = inputs({ deck, ready: readyOf(deck) });
    let state = start(inp);
    const seen = new Set(Object.values(drawn(state, inp.ready)));
    for (let i = 0; i < 24; i++) {
      state = tickSlides(state, inp);
      Object.values(drawn(state, inp.ready)).forEach((id) => seen.add(id));
    }
    expect(seen).toEqual(inp.ready);
  });

  it('prefers photos of distinct milestones while enough are ready', () => {
    // Two photos each of three moments, three single photos: nine ready, five tiles.
    const deck = [
      ...['a', 'b', 'c'].flatMap((m) => [
        photo(`${m}1`, { entryId: m }),
        photo(`${m}2`, { entryId: m }),
      ]),
      photo('x'),
      photo('y'),
      photo('z'),
    ];
    const inp = inputs({ deck, ready: readyOf(deck) });
    let state = start(inp);
    for (let i = 0; i < 15; i++) {
      const f = slideshowFrame(state, inp.ready);
      if (f.layout !== 'around') throw new Error('expected around');
      const moments = f.photos.map(({ piece }) => piece.entryId ?? piece.photoId);
      expect(new Set(moments).size).toBe(moments.length);
      state = tickSlides(state, inp);
    }
    // Only two moments among three photos: all three still show, a repeat only to fill.
    const few = [photo('a1', { entryId: 'a' }), photo('a2', { entryId: 'a' }), photo('c')];
    const d = drawn(start(inputs({ deck: few, ready: readyOf(few) })), readyOf(few));
    expect(Object.values(d).sort()).toEqual(['a1', 'a2', 'c']);
  });

  it('is plain with nothing eligible, and in mode off', () => {
    expect(slideshowFrame(start(inputs()), new Set())).toEqual({ layout: 'plain' });
    expect(slideshowFrame(start(inputs({ deck: photos(3) })), new Set())).toEqual({
      layout: 'plain',
    });
    const deck = photos(3);
    const off = inputs({ mode: 'off', deck, ready: readyOf(deck), texts: notes(3) });
    expect(slideshowFrame(tickSlides(start(off), off), off.ready)).toEqual({ layout: 'plain' });
  });

  it('switching shape or mode lays out a fresh set at once', () => {
    const deck = photos(6);
    const texts = notes(4);
    const land = inputs({ deck, ready: readyOf(deck), texts });
    let state = start(land);
    state = fillSlides(state, { ...land, shape: 'portrait' });
    expect(Object.keys(drawn(state, land.ready)).sort()).toEqual(['p1', 'p2', 'p3', 'p4']);
    state = fillSlides(state, { ...land, mode: 'off' });
    expect(slideshowFrame(state, land.ready)).toEqual({ layout: 'plain' });
  });
});
