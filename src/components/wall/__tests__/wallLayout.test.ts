/**
 * The wall's width rules.
 *
 * `railFits` shipped with no coverage at all, which is how its "ONE rule for
 * both views" docblock survived becoming false. Both rules are pinned here now,
 * including the 1270px derivation of the constant `daysLayoutFor` replaced —
 * kept as behaviour rather than as a number, so a refactor of the shared
 * `chromeFreeWidth` helper cannot move it silently.
 *
 * ⚠️ jsdom has no layout engine. Everything here is the ARITHMETIC. That the
 * resulting columns actually render at a readable width is confirmable only on
 * hardware.
 */
import { describe, it, expect } from 'vitest';
import {
  BLOCK_FULL_PX,
  BLOCK_SLIVER_PX,
  MAX_DAY_COLUMNS,
  MIN_DAY_COLUMNS,
  daysLayoutFor,
  railFits,
} from '../wallLayout';

describe('railFits — the LANES rule', () => {
  it('⭐ still reproduces the deleted 1270px threshold exactly', () => {
    // 1270 = 56 padding + 296 rail + 16 gap + 62 axis + 7 × 120. This was
    // DAYS_RAIL_MIN_VIEWPORT_PX; the days view no longer asks the question, so
    // this pins the `chromeFreeWidth` extraction rather than a live behaviour.
    expect(railFits(1270, 7)).toBe(true);
    expect(railFits(1269, 7)).toBe(false);
  });

  it('scales with the number of people, because a lane is a person', () => {
    // A large family on a narrow wall gives up the rail rather than crushing
    // every lane past the point a block keeps its title.
    expect(railFits(1024, 4)).toBe(true);
    expect(railFits(1024, 5)).toBe(false);
  });

  it('is total for nonsense input', () => {
    expect(railFits(0, 3)).toBe(false);
    expect(railFits(-500, 3)).toBe(false);
    expect(railFits(NaN, 3)).toBe(false);
  });
});

describe('daysLayoutFor — the DAYS rule', () => {
  // chromeFreeWidth(v, true) = v − 430; (v, false) = v − 118; both then − 56
  // for the arrow gutter. Columns are floor(content / 211), clamped to 3..7.
  it.each([
    ['768 portrait — unchanged from today', 768, true, false, 3],
    ['1024 portrait — FOUR where today it is always three', 1024, true, false, 4],
    ['1024 landscape — the rail cannot leave three columns', 1024, false, false, 4],
    ['1280 — rail wins, three columns beside it', 1280, false, true, 3],
    ['1440', 1440, false, true, 4],
    ['1920', 1920, false, true, 6],
    ['2560 — capped at a week', 2560, false, true, 7],
  ])('%s', (_label, viewport, portrait, rail, columns) => {
    expect(daysLayoutFor(viewport, portrait)).toEqual({ rail, columns });
  });

  it('⭐ never drops the rail while three columns still fit beside it', () => {
    // Requirement 5: the rail takes its width FIRST. The column count absorbs
    // what is left, which is what removed the old fixed threshold.
    for (const viewport of [1280, 1440, 1600, 1920, 2560]) {
      const { rail, columns } = daysLayoutFor(viewport, false);
      expect(rail).toBe(true);
      expect(columns).toBeGreaterThanOrEqual(MIN_DAY_COLUMNS);
    }
  });

  it('never returns fewer than three or more than seven', () => {
    for (const viewport of [0, 320, 600, 900, 1024, 1440, 4000, 10_000]) {
      for (const portrait of [true, false]) {
        const { columns } = daysLayoutFor(viewport, portrait);
        expect(columns).toBeGreaterThanOrEqual(MIN_DAY_COLUMNS);
        expect(columns).toBeLessThanOrEqual(MAX_DAY_COLUMNS);
      }
    }
  });

  it('clamps to three columns and no rail for nonsense input', () => {
    // A grid with zero columns is a blank screen, and `Math.max(3, NaN)` is NaN
    // — which is why the guard lives in `dayColumnsThatFit`, not at the clamp.
    for (const bad of [0, -1, -9999, NaN, Infinity, -Infinity]) {
      const result = daysLayoutFor(bad, false);
      expect(result.columns).toBe(MIN_DAY_COLUMNS);
      expect(Number.isFinite(result.columns)).toBe(true);
      // ⚠️ +Infinity is not in this list of "nonsense" — every value here is
      // guarded to MIN_DAY_COLUMNS and no rail, +Infinity included, because
      // `dayColumnsThatFit` rejects any non-finite content width outright. The
      // comment that used to sit here claimed the opposite.
      expect(result.rail).toBe(false);
    }
  });

  it('⚠️ a wider screen can show FEWER days, once — at the rail boundary', () => {
    // Pinned as a DECISION, not left to be discovered. Requirement 5 says the
    // rail takes its width first, so the width at which it becomes affordable is
    // also a width at which the day columns give 312px back. 1024 has no room
    // for the rail and spends everything on days; 1280 can afford the rail and
    // spends 312px on it.
    //
    // This is inherent to having a rail threshold at all — any threshold steps
    // the count down as it crosses — and the screen is showing MORE overall, not
    // less: it gains the whole peripheral rail. Worth knowing before someone
    // reports it as a bug.
    expect(daysLayoutFor(1024, false)).toEqual({ rail: false, columns: 4 });
    expect(daysLayoutFor(1280, false)).toEqual({ rail: true, columns: 3 });
  });

  it('is monotonic in width WITHIN a rail mode', () => {
    // The meaningful invariant: holding the rail decision constant, a wider
    // screen never shows fewer days. The one step down is the boundary above.
    for (const rail of [true, false]) {
      let previous = 0;
      for (const viewport of [600, 800, 1024, 1280, 1440, 1600, 1920, 2200, 2560]) {
        const layout = daysLayoutFor(viewport, false);
        if (layout.rail !== rail) continue;
        expect(layout.columns).toBeGreaterThanOrEqual(previous);
        previous = layout.columns;
      }
    }
  });

  it('portrait never takes the rail', () => {
    for (const viewport of [768, 1024, 1440, 2560]) {
      expect(daysLayoutFor(viewport, true).rail).toBe(false);
    }
  });
});

describe('the three column widths', () => {
  it('are ordered, and the days target clears full density', () => {
    // Each is defined by its distance from the others; an edit that crosses
    // them over would silently change which density every block renders at.
    expect(BLOCK_SLIVER_PX).toBeLessThan(BLOCK_FULL_PX);
    // The days view targets `> BLOCK_FULL_PX`, so its columns reach full
    // density rather than landing exactly on the boundary.
    const { columns } = daysLayoutFor(1440, false);
    const contentWidth = 1440 - 56 - 62 - 296 - 16 - 56;
    expect(contentWidth / columns).toBeGreaterThan(BLOCK_FULL_PX);
  });
});
