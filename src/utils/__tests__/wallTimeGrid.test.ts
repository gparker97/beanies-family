/**
 * The concertina layout's regression suite.
 *
 * Five of these pin defects that a working prototype actually shipped and that
 * only became visible when someone LOOKED at a screenshot. Each is written so
 * the right and wrong answers are DIFFERENT VALUES — a fixture where the correct
 * and buggy results coincide is not a test (docs/lessons.md rule 4).
 */
import { describe, it, expect } from 'vitest';
import {
  GAP_MINUTE_STEPS,
  LADDER,
  MIN_BLOCK_STEPS,
  MIN_FOLD_PX,
  SCALE_STEPS,
  foldHeightFor,
  MAX_ATTEMPTS,
  defaultMaxBlock,
  MAX_BLOCK_PX,
  MAX_BLOCK_CEILING_PX,
  clusterOverlapping,
  findFolds,
  foldThresholdMinutes,
  layoutTimeGrid,
  mergeBusy,
} from '@/utils/wallTimeGrid';
import type { WallOccurrence } from '@/utils/wallActivities';
import type { FamilyActivity } from '@/types/models';

let seq = 0;
function ev(
  startTime: string,
  endTime?: string,
  over: Partial<FamilyActivity> = {}
): WallOccurrence {
  return {
    activity: {
      id: `e${seq++}`,
      title: 'Thing',
      date: '2026-09-03',
      category: 'other',
      assigneeIds: [],
      startTime,
      endTime,
      createdAt: '',
      updatedAt: '',
      ...over,
    } as FamilyActivity,
    date: '2026-09-03',
  };
}
const HEIGHT = 480;

describe('the ladder is data', () => {
  it('⭐ spends everything else before it changes the height of an hour', () => {
    // Scale is the OUTERMOST axis, so it moves last: a calendar whose hour is a
    // different size day to day cannot be read at a glance. Within a scale the
    // minimum block shrinks before the gap threshold moves — a 3px shorter block
    // is a smaller lie than folding away another half-hour.
    expect(LADDER).toHaveLength(
      SCALE_STEPS.length * GAP_MINUTE_STEPS.length * MIN_BLOCK_STEPS.length
    );
    expect(LADDER[0]).toEqual({ scale: 0.8, gapMinutes: 90, minBlock: 36 });
    expect(LADDER[1]).toEqual({ scale: 0.8, gapMinutes: 90, minBlock: 33 });
    expect(LADDER[3]).toEqual({ scale: 0.8, gapMinutes: 90, minBlock: 27 });
    // Only after the whole minBlock axis is spent does the gap threshold move…
    expect(LADDER[4]).toEqual({ scale: 0.8, gapMinutes: 75, minBlock: 36 });
    // …and only after BOTH are spent does the scale step down.
    const firstScaleChange = LADDER.findIndex((r) => r.scale !== 0.8);
    expect(firstScaleChange).toBe(GAP_MINUTE_STEPS.length * MIN_BLOCK_STEPS.length);
  });

  it('keeps MAX_ATTEMPTS and the arithmetic from drifting apart', () => {
    expect(MAX_ATTEMPTS).toBe(LADDER.length);
    expect(MAX_ATTEMPTS).toBe(120);
  });

  it('is frozen, so nothing can mutate the search at runtime', () => {
    expect(Object.isFrozen(LADDER)).toBe(true);
  });
});

describe('the grid reads as a grid', () => {
  it('⭐ ticks on the HOUR, evenly spaced, not at event start times', () => {
    // The scale was already uniform, but labels at 07:30 / 08:05 / 15:20 / 16:00
    // gave the reader nothing to tell them the axis was linear — it looked
    // arbitrary, and there was no way to judge when an event started.
    const l = layoutTimeGrid(
      [[ev('07:30', '08:00'), ev('09:20', '09:50'), ev('11:10', '12:00')]],
      HEIGHT
    );
    expect(l.ticks.length).toBeGreaterThan(2);
    for (const tick of l.ticks) expect(tick.minutes % 60).toBe(0);
    // Evenly spaced, because the scale is uniform outside a fold.
    const gaps = l.ticks.slice(1).map((t, i) => t.y - l.ticks[i]!.y);
    for (const gap of gaps) expect(gap).toBeCloseTo(gaps[0]!, 5);
  });

  it('⭐ an hour is the SAME height on a quiet day and a busy one', () => {
    // The whole point of quantizing the scale.
    const quiet = layoutTimeGrid([[ev('09:00', '10:00'), ev('11:00', '11:30')]], HEIGHT);
    const busier = layoutTimeGrid(
      [[ev('09:00', '10:00'), ev('11:00', '11:30'), ev('13:00', '13:30'), ev('14:00', '14:45')]],
      HEIGHT
    );
    expect(quiet.scale).toBe(busier.scale);
    const hourHeight = (l: ReturnType<typeof layoutTimeGrid>) => l.ticks[1]!.y - l.ticks[0]!.y;
    expect(hourHeight(quiet)).toBeCloseTo(hourHeight(busier), 5);
  });

  it('reports the scale it settled on, from the known set', () => {
    const l = layoutTimeGrid([[ev('09:00', '10:00')]], HEIGHT);
    expect(SCALE_STEPS).toContain(l.scale);
  });

  it('does not draw an hour rule inside a fold', () => {
    const l = layoutTimeGrid([[ev('07:30', '08:00'), ev('15:20', '15:50')]], HEIGHT);
    const fold = l.folds[0]!;
    for (const tick of l.ticks) {
      const inside = tick.minutes > fold.startMinutes && tick.minutes < fold.resumeMinutes;
      expect(inside, `tick ${tick.minutes}`).toBe(false);
    }
  });
});

describe('the natural scale', () => {
  it('⭐ does NOT stretch a quiet day to fill the screen', () => {
    // The grid used to divide the whole height between the day's live minutes,
    // so two events became two half-screen slabs. A quiet day should look quiet:
    // the scale shrinks to fit a busy day and never grows past natural size.
    const l = layoutTimeGrid([[ev('09:00', '10:00'), ev('11:00', '11:30')]], HEIGHT);
    const bottom = Math.max(...l.columns[0]!.map((b) => b.top + b.height));
    // The wrong answer is ~HEIGHT: the day filling the wall.
    expect(bottom).toBeLessThan(HEIGHT * 0.6);
  });

  it('still shrinks below natural size when a day genuinely will not fit', () => {
    const packed = Array.from({ length: 18 }, (_, i) => {
      const start = 7 * 60 + i * 40;
      const hh = String(Math.floor(start / 60)).padStart(2, '0');
      const mm = String(start % 60).padStart(2, '0');
      return ev(`${hh}:${mm}`, `${hh}:${mm}`);
    });
    const l = layoutTimeGrid([packed], HEIGHT);
    const bottom = Math.max(...l.columns[0]!.map((b) => b.top + b.height));
    expect(bottom).toBeLessThanOrEqual(HEIGHT + 1);
    expect(l.columns[0]).toHaveLength(18);
  });
});

describe('the window', () => {
  it("clamps to the day's own events, snapped OUT to whole hours", () => {
    // Midnight-anchored would be 0 and 1440 — different values. Snapping out to
    // the hour is what lets the grid start and end on a rule: 07:30 becomes
    // 07:00 so there is a labelled line above the first event.
    const l = layoutTimeGrid([[ev('07:30', '08:00'), ev('19:30', '20:00')]], HEIGHT);
    expect(l.windowStart).toBe(7 * 60);
    expect(l.windowEnd).toBe(20 * 60);
    expect(l.windowStart % 60).toBe(0);
    expect(l.windowEnd % 60).toBe(0);
  });

  it('returns a usable empty layout rather than throwing when nothing is on', () => {
    const l = layoutTimeGrid([[], []], HEIGHT);
    expect(l.columns).toHaveLength(2);
    expect(l.tier).toBe('gentle');
    expect(Number.isFinite(l.yFor(600))).toBe(true);
  });
});

describe('folding', () => {
  it('does not fold a short gap on a realistic day', () => {
    // A 30-minute gap inside a full 07:30-20:00 day renders ~30px — under the
    // 74px cap, so folding it would replace a 30px gap with a 30px band and save
    // nothing. (On a two-event 90-minute "day" the same gap renders 160px and
    // SHOULD fold; the rule is about pixels, not minutes.)
    const l = layoutTimeGrid(
      [
        [
          ev('07:30', '08:00'),
          ev('08:30', '09:00'),
          ev('12:00', '13:00'),
          ev('15:20', '15:50'),
          ev('18:30', '19:15'),
          ev('19:30', '20:00'),
        ],
      ],
      HEIGHT
    );
    // Nothing folds between 08:00 and 08:30.
    expect(l.folds.some((f) => f.resumeMinutes === 8 * 60 + 30)).toBe(false);
  });

  it('folds by PIXELS, not by minutes — a long gap folds even on a quiet day', () => {
    // The pixel rule still governs; it is just measured at natural scale now, so
    // a gap has to be genuinely long to earn a fold rather than merely to sit on
    // a day with nothing else in it.
    const l = layoutTimeGrid([[ev('07:30', '08:00'), ev('15:20', '15:50')]], HEIGHT);
    expect(l.folds).toHaveLength(1);
  });

  it('folds a long gap and labels it with the time it resumes', () => {
    const l = layoutTimeGrid([[ev('07:30', '08:00'), ev('15:20', '15:50')]], HEIGHT);
    expect(l.folds).toHaveLength(1);
    expect(l.folds[0]!.resumeMinutes).toBe(15 * 60 + 20);
    expect(l.folds[0]!.height).toBeGreaterThanOrEqual(MIN_FOLD_PX);
  });

  it('⭐ the minimum-block floor does not close a gap that should fold', () => {
    // THE defect. A 15-minute drop-off at week scale is forced to the 36px floor,
    // which OCCUPIES ~90 minutes of axis. Feeding those inflated spans into gap
    // detection closed the gap and the fold silently stopped firing — five empty
    // hours rendered as white space. Wrong answer here is 0 folds.
    const l = layoutTimeGrid([[ev('08:05', '08:20'), ev('10:00', '11:30')]], HEIGHT);
    expect(l.folds).toHaveLength(1);
    expect(l.folds[0]!.resumeMinutes).toBe(600);
  });

  it('⭐ the fold threshold is stable — one honest fold, not five', () => {
    // Measuring the pixel test against the FOLDED scale is a runaway: each fold
    // raises px/min, which qualifies more gaps. This week produced five folds
    // under the iterative rule, two of them 30-minute bands that saved nothing.
    const day = (...times: [string, string][]) => times.map(([s, e]) => ev(s, e));
    const l = layoutTimeGrid(
      [
        day(['07:30', '08:00'], ['15:20', '15:50'], ['18:30', '19:15']),
        day(['07:30', '08:00'], ['15:20', '15:50'], ['18:30', '19:15']),
        day(['10:00', '11:30'], ['16:00', '18:00']),
        day(['12:00', '14:30'], ['18:30', '19:15']),
      ],
      HEIGHT
    );
    expect(l.folds.length).toBeLessThanOrEqual(2);
  });

  it('only folds a stretch that is empty in EVERY column', () => {
    // Saturday's 10:00 gala must stop the weekday morning fold swallowing it.
    const l = layoutTimeGrid(
      [[ev('07:30', '08:00'), ev('15:20', '15:50')], [ev('10:00', '11:30')]],
      HEIGHT
    );
    for (const fold of l.folds) {
      const foldStart = fold.resumeMinutes;
      expect(foldStart === 600 || foldStart >= 690).toBe(true);
    }
  });

  it('foldThresholdMinutes never drops below the minimum foldable span', () => {
    expect(foldThresholdMinutes(90, 0.05)).toBeGreaterThanOrEqual(20);
  });

  it('⭐ a longer fold is visibly taller than a shorter one', () => {
    // A fixed band made a one-hour lull and a six-hour school day identical: the
    // fold said "time passed here" and then refused to say how much.
    const oneHour = foldHeightFor(60);
    const threeHour = foldHeightFor(180);
    const sixHour = foldHeightFor(360);
    expect(threeHour).toBeGreaterThan(oneHour);
    expect(sixHour).toBeGreaterThan(threeHour);
    // …and still compressed: six hours at full scale would be ~288px.
    expect(sixHour).toBeLessThan(120);
  });
});

describe('overlaps', () => {
  it('⭐ a real overlap does NOT displace a later block', () => {
    // THE alignment defect. Stacking a genuine collision cascades: Thursday's
    // dinner stopped lining up with every other Thursday's dinner. A grid whose
    // y no longer means one time is not a grid.
    const withCollision = [ev('16:00', '18:00'), ev('16:30', '17:30'), ev('18:30', '19:15')];
    const without = [ev('16:00', '18:00'), ev('18:30', '19:15')];
    const l = layoutTimeGrid([withCollision, without], HEIGHT);

    const dinnerA = l.columns[0]!.find((b) => b.start === 18 * 60 + 30)!;
    const dinnerB = l.columns[1]!.find((b) => b.start === 18 * 60 + 30)!;
    expect(dinnerA.top).toBeCloseTo(dinnerB.top, 6);
  });

  it('splits a real overlap side by side rather than stacking it', () => {
    const l = layoutTimeGrid([[ev('16:00', '18:00'), ev('16:30', '17:30')]], HEIGHT);
    const [a, b] = l.columns[0]!;
    expect(a!.lanes).toBe(2);
    expect(b!.lanes).toBe(2);
    expect(a!.lane).not.toBe(b!.lane);
  });

  it('gives the LONGER event the majority width, so it keeps its title', () => {
    const l = layoutTimeGrid([[ev('16:00', '18:00'), ev('16:30', '17:30')]], HEIGHT);
    const long = l.columns[0]!.find((x) => x.end - x.start === 120)!;
    const short = l.columns[0]!.find((x) => x.end - x.start === 60)!;
    expect(long.laneWidth).toBeCloseTo(0.62, 5);
    expect(short.laneWidth).toBeCloseTo(0.38, 5);
  });

  it('⭐ a three-event, two-lane cluster weights from the LANE OCCUPANTS', () => {
    // `span[0] >= span[1]` compares the first two events in cluster order, which
    // is only correct for a two-member cluster. Here lane 1 holds the long one.
    const l = layoutTimeGrid(
      [[ev('16:00', '16:20'), ev('16:05', '18:30'), ev('16:30', '16:50')]],
      HEIGHT
    );
    const longest = l.columns[0]!.find((x) => x.end - x.start === 145)!;
    expect(longest.lanes).toBe(2);
    expect(longest.laneWidth).toBeCloseTo(0.62, 5);
  });

  it('⭐ a floor-induced collision DOES stack, and only by the nudge', () => {
    // Two consecutive events five minutes apart, both forced to the floor. They
    // are sequential, not simultaneous — splitting them made every week column
    // an unreadable sliver.
    const l = layoutTimeGrid([[ev('07:30', '08:00'), ev('08:05', '08:20')]], HEIGHT);
    const [first, second] = l.columns[0]!;
    expect(first!.lanes).toBe(1);
    expect(second!.lanes).toBe(1);
    expect(second!.top).toBeGreaterThanOrEqual(first!.top + first!.height);
  });

  it('treats a touching pair as sequential, not simultaneous', () => {
    const l = layoutTimeGrid([[ev('11:00', '11:30'), ev('11:30', '12:00')]], HEIGHT);
    expect(l.columns[0]!.every((b) => b.lanes === 1)).toBe(true);
  });
});

describe('regressions found by review', () => {
  it('⭐ never lets two blocks in one column occlude each other', () => {
    // Lane indices are assigned PER CLUSTER, so bucketing the floor-nudge by
    // `lane` compared unrelated numbers: a full-width block from a later cluster
    // could be dropped straight on top of a half-width one from the cluster
    // before it and paint over it completely. An event silently gone, from a
    // screen whose whole promise is that it never drops one.
    for (const height of [300, 420, 470, 520]) {
      const l = layoutTimeGrid(
        [[ev('09:00', '10:00'), ev('09:50', '10:00'), ev('10:00', '10:15')]],
        height
      );
      const blocks = l.columns[0]!;
      expect(blocks).toHaveLength(3);
      for (let i = 0; i < blocks.length; i++) {
        for (let j = i + 1; j < blocks.length; j++) {
          const a = blocks[i]!;
          const b = blocks[j]!;
          const sharesWidth =
            b.laneOffset < a.laneOffset + a.laneWidth - 1e-6 &&
            a.laneOffset < b.laneOffset + b.laneWidth - 1e-6;
          const sharesHeight = b.top < a.top + a.height - 1e-6 && a.top < b.top + b.height - 1e-6;
          expect(sharesWidth && sharesHeight, `h=${height} blocks ${i}/${j} overlap`).toBe(false);
        }
      }
    }
  });

  it('⭐ maps a time INSIDE a pushed fold onto that fold band', () => {
    // Keying the shift on the fold's END meant a time within the fold picked up
    // only the PREVIOUS fold's shift, landing up to ~34px above its own band —
    // usually inside an event that had already finished. Most of a family day is
    // quiet, so "now is inside a fold" is the common case, not an edge case.
    const l = layoutTimeGrid([[ev('07:30', '07:45'), ev('15:20', '16:30')]], 200);
    expect(l.folds).toHaveLength(1);
    const band = l.folds[0]!;
    const midFold = (band.startMinutes + band.resumeMinutes) / 2;
    const y = l.yFor(midFold);
    expect(y).toBeGreaterThanOrEqual(band.top - 0.001);
    expect(y).toBeLessThanOrEqual(band.top + band.height + 0.001);
    // …and specifically NOT inside the block that has already ended.
    const first = l.columns[0]![0]!;
    expect(y).toBeGreaterThan(first.top + first.height - 0.001);
  });
});

describe('the cap', () => {
  it('⭐ leaves an ordinary event exactly as tall as its hours, so it meets its own rule', () => {
    // The cap used to be 76px, below a normal event length — so a two-hour block
    // stopped short of its own 18:00 line and the grid contradicted itself. The
    // cap is for the eight-hour conference, not the football training.
    const l = layoutTimeGrid([[ev('16:00', '18:00'), ev('19:00', '19:30')]], HEIGHT);
    const twoHour = l.columns[0]!.find((b) => b.end - b.start === 120)!;
    expect(twoHour.capped).toBe(false);
    const hourHeight = l.ticks[1]!.y - l.ticks[0]!.y;
    expect(twoHour.height).toBeCloseTo(hourHeight * 2, 5);
  });

  it('still compresses a genuinely long event rather than letting it eat the wall', () => {
    const l = layoutTimeGrid([[ev('09:00', '17:00'), ev('17:30', '18:00')]], 690);
    const long = l.columns[0]!.find((b) => b.end - b.start === 480)!;
    expect(long.capped).toBe(true);
    expect(long.height).toBeLessThan(480 * 0.8 * 0.6);
  });

  it('⭐ on a realistic portrait day, the 2h event still ends below the 1h beside it', () => {
    // A fixed 132px cap made football (16:00-18:00) end LOWER than the swimming
    // lesson (16:30-17:30) beside it, because the cap bit the long one while the
    // short one drew in full. A shorter event that looks longer is worse than no
    // cap at all. The cap is now a share of the plot, so it scales with it.
    const l = layoutTimeGrid(
      [
        [
          ev('07:30', '08:00'),
          ev('08:05', '08:20'),
          ev('15:20', '15:50'),
          ev('16:00', '18:00'),
          ev('16:30', '17:30'),
          ev('18:30', '19:15'),
          ev('19:30', '20:00'),
        ],
      ],
      690
    );
    const long = l.columns[0]!.find((b) => b.end - b.start === 120)!;
    const short = l.columns[0]!.find((b) => b.end - b.start === 60)!;
    expect(long.height).toBeGreaterThan(short.height);
    expect(long.top + long.height).toBeGreaterThan(short.top + short.height);
  });

  it('⭐ the cap is SOFT, so a longer event is never drawn shorter than a shorter one', () => {
    // A hard clamp is not monotonic: two events that both exceed the cap come out
    // identical, and the later one then ends lower than the longer one.
    // ⚠️ maxBlock is PINNED rather than left to the default. This asserts the
    // softness of the cap, not the shape of the responsive curve, and it passes
    // on a two-pixel margin: at 720px the 240-minute block is 192px raw against
    // a 190px cap. Leaving it on the default made a test about monotonicity
    // silently depend on `defaultMaxBlock(720)` staying at exactly 190.
    const l = layoutTimeGrid([[ev('09:00', '17:00'), ev('10:00', '14:00')]], 720, {
      maxBlock: MAX_BLOCK_PX,
    });
    const long = l.columns[0]!.find((b) => b.end - b.start === 480)!;
    const short = l.columns[0]!.find((b) => b.end - b.start === 240)!;
    expect(long.capped && short.capped).toBe(true);
    expect(long.height).toBeGreaterThan(short.height);
  });

  it('clamps a long block, flags it, and still saves most of the pixels', () => {
    const l = layoutTimeGrid([[ev('09:00', '17:00'), ev('17:30', '18:00')]], HEIGHT);
    const long = l.columns[0]!.find((b) => b.end - b.start === 480)!;
    expect(long.capped).toBe(true);
    // The cap is soft, so the height EXCEEDS the cap a little (that is what keeps
    // it monotonic) — but it must still be far below the height the block would
    // otherwise demand, or the cap is doing nothing.
    const cap = defaultMaxBlock(HEIGHT);
    const uncapped = l.yFor(long.end) - l.yFor(long.start);
    expect(long.height).toBeGreaterThan(cap);
    expect(long.height).toBeLessThan(uncapped * 0.7);
  });

  it('does not claim a short block is capped on a realistic day', () => {
    const l = layoutTimeGrid(
      [
        [
          ev('07:30', '08:00'),
          ev('09:00', '09:30'),
          ev('12:00', '12:30'),
          ev('15:20', '15:50'),
          ev('18:30', '19:15'),
        ],
      ],
      HEIGHT
    );
    expect(l.columns[0]!.every((b) => b.capped === false)).toBe(true);
  });

  it('⭐ a capped block still splits its column with the event nested inside it', () => {
    // Lanes come from TRUE times, not rendered geometry — so the cap cannot make
    // a genuine collision look like a clear run.
    const l = layoutTimeGrid([[ev('09:00', '17:00'), ev('10:00', '11:00')]], HEIGHT);
    expect(l.columns[0]!.every((b) => b.lanes === 2)).toBe(true);
  });
});

describe('fitting, and never clipping', () => {
  it('early-exits on the first candidate that fits', () => {
    const l = layoutTimeGrid([[ev('09:00', '10:00'), ev('12:00', '13:00')]], HEIGHT);
    expect(l.attempts).toBe(1);
    expect(l.tier).toBe('gentle');
  });

  it('fits a twenty-event day without dropping anything', () => {
    const many = Array.from({ length: 20 }, (_, i) => {
      const start = 7 * 60 + i * 35;
      const hh = String(Math.floor(start / 60)).padStart(2, '0');
      const mm = String(start % 60).padStart(2, '0');
      return ev(`${hh}:${mm}`);
    });
    const l = layoutTimeGrid([many], HEIGHT);
    expect(l.columns[0]).toHaveLength(20);
    const bottom = Math.max(...l.columns[0]!.map((b) => b.top + b.height));
    expect(bottom).toBeLessThanOrEqual(HEIGHT + 1);
  });

  it('⭐ the overflow tier squeezes rather than clipping, and keeps alignment', () => {
    // The prototype returned its last attempt even when it overflowed, into an
    // `overflow: hidden` plot — so the last event of the day silently vanished.
    const packed = Array.from({ length: 26 }, (_, i) => {
      const start = 7 * 60 + i * 12;
      const hh = String(Math.floor(start / 60)).padStart(2, '0');
      const mm = String(start % 60).padStart(2, '0');
      return ev(`${hh}:${mm}`, `${hh}:${mm}`);
    });
    const tiny = 150;
    const l = layoutTimeGrid([packed, [ev('07:00', '07:10'), ...packed.slice(1)]], tiny);
    expect(l.columns[0]).toHaveLength(26);
    const bottom = Math.max(...l.columns.flat().map((b) => b.top + b.height));
    expect(bottom).toBeLessThanOrEqual(tiny + 1);
  });

  it('stays inside the attempt ceiling on a pathological input', () => {
    const packed = Array.from({ length: 60 }, (_, i) => {
      const start = 7 * 60 + i * 5;
      const hh = String(Math.floor(start / 60)).padStart(2, '0');
      const mm = String(start % 60).padStart(2, '0');
      return ev(`${hh}:${mm}`, `${hh}:${mm}`);
    });
    const l = layoutTimeGrid([packed], 120);
    expect(l.attempts).toBeLessThanOrEqual(MAX_ATTEMPTS);
    expect(l.columns[0]).toHaveLength(60);
  });
});

describe('bad data is surfaced, never poisoned', () => {
  it('routes an unreadable time to `rejected`, never into a column', () => {
    // Note `''` is NOT among them: `isAllDayActivity` treats a missing start
    // time as all-day, which is the canonical rule the whole app uses. It is
    // skipped silently and rendered in the band — not reported as corrupt.
    const l = layoutTimeGrid([[ev('abc'), ev('25:00'), ev(''), ev('09:00', '10:00')]], HEIGHT);
    expect(l.rejected).toHaveLength(2);
    expect(l.rejected.every((r) => r.column === 0)).toBe(true);
    expect(l.columns[0]).toHaveLength(1);
  });

  it('never emits NaN anywhere in the geometry', () => {
    const l = layoutTimeGrid([[ev('abc'), ev('09:00', '10:00')]], HEIGHT);
    for (const b of l.columns.flat()) {
      for (const v of [b.top, b.height, b.laneOffset, b.laneWidth]) {
        expect(Number.isFinite(v)).toBe(true);
      }
    }
    expect(Number.isFinite(l.yFor(600))).toBe(true);
  });

  it('keeps an all-day occurrence out of the plot', () => {
    // Every view filters all-day items out before calling and renders them
    // through `allDaySpans`; the layout no longer returns a second, unread
    // channel for the same items.
    const l = layoutTimeGrid(
      [[ev('09:00', '10:00'), ev('00:00', undefined, { isAllDay: true })]],
      HEIGHT
    );
    expect(l.columns[0]).toHaveLength(1);
    expect(l.rejected).toHaveLength(0);
  });

  it('⭐ remembers which column an unplaceable occurrence came from', () => {
    // Without the column the band had to guess, and guessing "all of them" drew
    // one broken Thursday record as a bar across the entire week.
    const l = layoutTimeGrid([[ev('09:00', '10:00')], [ev('abc')], [ev('11:00', '12:00')]], HEIGHT);
    expect(l.rejected).toHaveLength(1);
    expect(l.rejected[0]!.column).toBe(1);
  });

  it('survives a zero or negative available height', () => {
    expect(() => layoutTimeGrid([[ev('09:00', '10:00')]], 0)).not.toThrow();
    expect(() => layoutTimeGrid([[ev('09:00', '10:00')]], -50)).not.toThrow();
  });

  it('survives a single instantaneous event', () => {
    const l = layoutTimeGrid([[ev('09:00', '09:00')]], HEIGHT);
    expect(l.columns[0]![0]!.height).toBeGreaterThan(0);
  });
});

describe('determinism', () => {
  it('yields identical geometry for identical input', () => {
    const build = () => [[ev('07:30', '08:00'), ev('16:00', '18:00'), ev('16:30', '17:30')]];
    const strip = (l: ReturnType<typeof layoutTimeGrid>) =>
      l.columns.flat().map((b) => [b.top, b.height, b.lane, b.laneWidth]);
    expect(strip(layoutTimeGrid(build(), HEIGHT))).toEqual(strip(layoutTimeGrid(build(), HEIGHT)));
  });
});

describe('clusterOverlapping / mergeBusy', () => {
  it('handles disjoint, touching, nested, identical, unsorted and empty', () => {
    expect(clusterOverlapping([])).toEqual([]);
    expect(
      clusterOverlapping([
        { start: 0, end: 10 },
        { start: 20, end: 30 },
      ])
    ).toHaveLength(2);
    expect(
      clusterOverlapping([
        { start: 0, end: 10 },
        { start: 10, end: 20 },
      ])
    ).toHaveLength(2);
    expect(
      clusterOverlapping([
        { start: 0, end: 100 },
        { start: 10, end: 20 },
      ])
    ).toHaveLength(1);
    expect(
      clusterOverlapping([
        { start: 5, end: 9 },
        { start: 5, end: 9 },
      ])
    ).toHaveLength(1);
    // Unsorted input must not change the answer.
    expect(
      clusterOverlapping([
        { start: 20, end: 30 },
        { start: 0, end: 10 },
      ])
    ).toHaveLength(2);
  });

  it('merges busy periods across columns', () => {
    expect(
      mergeBusy([
        { start: 0, end: 10 },
        { start: 5, end: 20 },
        { start: 40, end: 50 },
      ])
    ).toEqual([
      [0, 20],
      [40, 50],
    ]);
  });

  it('findFolds never reports a fold shorter than the threshold', () => {
    // `findFolds` now takes PRE-MERGED busy periods: merging is invariant across
    // the whole ladder search, so it is hoisted out and done once.
    const folds = findFolds(
      mergeBusy([
        { start: 0, end: 10 },
        { start: 40, end: 50 },
      ]),
      0,
      60,
      20
    );
    expect(folds).toHaveLength(1);
    expect(folds[0]).toMatchObject({ startMinutes: 10, resumeMinutes: 40 });
  });
});

describe('defaultMaxBlock', () => {
  // The cap responds to the VIEWPORT, never to the content — which is what keeps
  // "an hour is the same height on a quiet day and a busy one" true.
  it('returns the historical flat cap when there is no measurement to go on', () => {
    expect(defaultMaxBlock(undefined)).toBe(MAX_BLOCK_PX);
    expect(defaultMaxBlock(0)).toBe(MAX_BLOCK_PX);
    expect(defaultMaxBlock(-100)).toBe(MAX_BLOCK_PX);
    expect(defaultMaxBlock(NaN)).toBe(MAX_BLOCK_PX);
  });

  it('never drops below the historical cap, so small screens are unchanged', () => {
    // Every device at or below the reference height must render byte-for-byte as
    // it did before the cap became responsive.
    for (const height of [220, 300, 420, 560, 700, 719]) {
      expect(defaultMaxBlock(height)).toBe(MAX_BLOCK_PX);
    }
  });

  it('⭐ returns exactly MAX_BLOCK_PX at the reference height', () => {
    // Load-bearing, and easy to break silently: the "cap is SOFT" test above lays
    // out at 720px and depends on a 240-minute block (192px raw) still exceeding
    // the cap. It now pins maxBlock explicitly, but this keeps the underlying
    // property stated rather than implied.
    expect(defaultMaxBlock(720)).toBe(MAX_BLOCK_PX);
  });

  it('grows with the plot above the reference height', () => {
    expect(defaultMaxBlock(1080)).toBeCloseTo(285, 0);
    expect(defaultMaxBlock(900)).toBeGreaterThan(MAX_BLOCK_PX);
    expect(defaultMaxBlock(1080)).toBeGreaterThan(defaultMaxBlock(900));
  });

  it('stops at the ceiling, so one block never owns the whole wall', () => {
    expect(defaultMaxBlock(4000)).toBe(MAX_BLOCK_CEILING_PX);
    expect(defaultMaxBlock(10_000)).toBe(MAX_BLOCK_CEILING_PX);
  });

  it('is monotonic in height', () => {
    const heights = [200, 500, 720, 800, 1000, 1440, 2160];
    const caps = heights.map(defaultMaxBlock);
    for (let i = 1; i < caps.length; i++) {
      expect(caps[i]!).toBeGreaterThanOrEqual(caps[i - 1]!);
    }
  });
});
