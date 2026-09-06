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
  ZOOM_STEPS,
  zoomCandidates,
  REFERENCE_PLOT_PX,
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

/**
 * A plot too short for the wall to draw the day honestly.
 *
 * ⚠️ The fold tests below need this. Folding is now the CONSTRAINED-space
 * answer: given room, the grid draws the real gap rather than collapsing it, so
 * at HEIGHT most of these days no longer fold at all — which is the feature, not
 * a broken test. Running them here is what keeps them about the fold machinery.
 */
const CRAMPED = 300;

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
    expect(MAX_ATTEMPTS).toBe(LADDER.length + (ZOOM_STEPS.length + 1) * 5);
    expect(MAX_ATTEMPTS).toBe(160); // 120 rungs + (7 zooms + 1) × (4 day windows + 1)
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
    const l = layoutTimeGrid([[ev('07:30', '08:00'), ev('15:20', '15:50')]], CRAMPED);
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
    const l = layoutTimeGrid([[ev('07:30', '08:00'), ev('15:20', '15:50')]], CRAMPED);
    expect(l.folds).toHaveLength(1);
  });

  it('folds a long gap and labels it with the time it resumes', () => {
    const l = layoutTimeGrid([[ev('07:30', '08:00'), ev('15:20', '15:50')]], CRAMPED);
    expect(l.folds).toHaveLength(1);
    expect(l.folds[0]!.resumeMinutes).toBe(15 * 60 + 20);
    expect(l.folds[0]!.height).toBeGreaterThanOrEqual(MIN_FOLD_PX);
  });

  it('⭐ the minimum-block floor does not close a gap that should fold', () => {
    // THE defect. A 15-minute drop-off at week scale is forced to the 36px floor,
    // which OCCUPIES ~90 minutes of axis. Feeding those inflated spans into gap
    // detection closed the gap and the fold silently stopped firing — five empty
    // hours rendered as white space. Wrong answer here is 0 folds.
    //
    // ⚠️ The day is longer than the original fixture on purpose. With a short
    // day the unfolded axis now always fits, so the folded path — the one this
    // test is about — is never reached. The late event forces the constraint
    // that folding exists to answer, without changing the gap under test.
    const l = layoutTimeGrid(
      [[ev('08:05', '08:20'), ev('10:00', '11:30'), ev('19:00', '19:30')]],
      CRAMPED
    );
    expect(l.folds.length).toBeGreaterThanOrEqual(1);
    expect(l.folds.map((f) => f.resumeMinutes)).toContain(600);
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
    // At 480 the full 8-to-8 axis does not fit but the day's own span does, so
    // this settles on the second candidate: the honest window, unfolded.
    const l = layoutTimeGrid([[ev('09:00', '10:00'), ev('12:00', '13:00')]], HEIGHT);
    expect(l.attempts).toBe(2);
    expect(l.tier).toBe('gentle');
    expect(l.folds).toHaveLength(0);
  });

  it('takes a FULL day when the plot can afford one, and widens into the slack', () => {
    const l = layoutTimeGrid([[ev('09:00', '10:00'), ev('12:00', '13:00')]], 720);
    expect(l.tier).toBe('roomy');
    // 12h fits at the base hour, and there is room left for 14h — the search
    // takes the hour first, then spends what is left on more day.
    expect(l.windowEnd - l.windowStart).toBe(14 * 60);
    expect(l.windowStart).toBe(7 * 60);
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

describe('PINNED — the vertical layout, before and after the hour zooms', () => {
  /*
   * ⚠️ These are LITERALS on purpose, and they are the control for the change
   * that follows.
   *
   * A test cannot compare against "the code before the change" — there is no
   * before at test time. So the numbers were written down here as literals in
   * the commit before the hour zoomed, and this commit states the new ones
   * beside them. The diff on this block IS that commit's whole vertical effect.
   *
   * The fixture is greg's ordinary day: three normal-length events — the case
   * that used to render identically at every plot height, which was the whole
   * complaint.
   *
   *   plot   originally          now        tier     fill
   *    480   [48,36,48] b=272    b=432      gentle   90%   unfolded, tight window
   *    720   [48,36,48] b=272    b=480      roomy    67%   full 8–8 day
   *   1080   [48,36,48] b=272    b=720      roomy    67%   hour 72px
   *   1440   [48,36,48] b=272    b=960      roomy    67%   hour 96px
   *
   * The block HEIGHTS are unchanged at 480 and 720 — the hour did not move
   * there. What changed is how much day is drawn around them.
   */
  const ordinary = [ev('09:00', '10:00'), ev('13:00', '13:45'), ev('17:00', '18:00')];

  it.each([
    [480, 0.8, [48, 36, 48], 'gentle'],
    [720, 0.8, [48, 36, 48], 'roomy'],
    [1080, 1.2, [72, 54, 72], 'roomy'],
    [1440, 1.6, [96, 72, 96], 'roomy'],
  ])('at %ipx of plot the hour is %f and the tier is %s', (height, scale, heights, tier) => {
    const l = layoutTimeGrid([ordinary], height);
    expect(l.scale).toBeCloseTo(scale as number, 6);
    // Neither `roomy` nor `gentle` is a compromise — both took rung 0. `roomy`
    // additionally means the whole waking day is drawn, unfolded.
    expect(l.tier).toBe(tier);
    expect(l.columns[0]!.map((b) => Math.round(b.height))).toEqual(heights);
  });

  it('⭐ the hour never grows at or below the reference plot', () => {
    // The guarantee is about the HOUR, and it is narrower than it first looks:
    // the generous axis DOES change what a 600–720px plot draws, because that is
    // the whole point. What cannot happen below the reference is a bigger hour —
    // so a block is never taller than it is today on the devices already tested.
    for (const height of [220, 380, 480, 520, 720]) {
      expect(zoomCandidates(height)).toEqual([]);
      expect(layoutTimeGrid([ordinary], height).scale).toBeLessThanOrEqual(0.8);
    }
  });

  it('⭐ a tall screen now carries about twice the content it did', () => {
    const short = layoutTimeGrid([ordinary], 480);
    const tall = layoutTimeGrid([ordinary], 1440);
    const bottom = (l: typeof short) => Math.max(...l.columns[0]!.map((b) => b.top + b.height));
    // Was byte-identical — three times the glass, not one pixel more content.
    expect(bottom(tall)).toBeGreaterThan(bottom(short) * 1.9);
  });

  it('⭐ fills a tall screen with a real DAY, not with inflated events', () => {
    /*
     * The distinction `NATURAL_PX_PER_MIN` exists to protect, restated now that
     * the axis is generous.
     *
     * A 1440px plot is now about two-thirds full — but of a real 8-to-8 day,
     * drawn honestly, with the gaps between events at their true length. That is
     * NOT the failure the fixed ceiling was introduced to stop: "a quiet day
     * STRETCHED to fill the screen: two events and one of them half a wall".
     *
     * The thing that must stay bounded is the BLOCK, and it is: a one-hour event
     * is 96px, not a third of the wall. Assert that, rather than asserting the
     * screen stays empty — emptiness was never the goal, honesty was.
     */
    const tall = layoutTimeGrid([ordinary], 1440);
    const tallest = Math.max(...tall.columns[0]!.map((b) => b.height));
    expect(tallest).toBeLessThanOrEqual(MAX_BLOCK_CEILING_PX);
    expect(tallest).toBeLessThan(1440 * 0.12);
  });

  it('⭐ two different days on ONE screen still get the same hour', () => {
    // The zoom is read from the plot, never from the content — which is the
    // whole distinction that makes this safe.
    const quiet = layoutTimeGrid([[ev('09:00', '10:00')]], 1440);
    const busy = layoutTimeGrid([ordinary], 1440);
    expect(quiet.scale).toBe(busy.scale);
  });
});

describe('the zoom — how the wall grows with the glass', () => {
  it('is empty below the reference plot, and steps up above it', () => {
    for (const height of [0, -1, NaN, 220, 480, 720]) {
      expect(zoomCandidates(height)).toEqual([]);
    }
    // Finer steps than the first cut, which left dead zones: a 850px plot got
    // no zoom at all and wasted 58% of itself as the screen grew.
    expect(zoomCandidates(760)).toEqual([1.05]);
    expect(zoomCandidates(900)).toEqual([1.25, 1.15, 1.05]);
    expect(zoomCandidates(1440)).toEqual([2, 1.75, 1.5, 1.35, 1.25, 1.15, 1.05]);
  });

  it('offers the widest zoom first, and every one of them grows the hour', () => {
    // Widest-first matters: the search takes the first that fits, so a
    // mis-ordered list would silently pick a smaller hour than the plot affords.
    for (let i = 1; i < ZOOM_STEPS.length; i++) {
      expect(ZOOM_STEPS[i]!).toBeLessThan(ZOOM_STEPS[i - 1]!);
    }
    for (const z of ZOOM_STEPS) expect(z).toBeGreaterThan(1);
    expect(REFERENCE_PLOT_PX).toBeGreaterThanOrEqual(720);
  });

  /*
   * ⭐ THE STRONGEST GUARD IN THIS CHANGE.
   *
   * At zoom z the whole grid should be the zoom-1 grid multiplied by z. A
   * constant that was forgotten in the zoom then shows up as a numeric
   * mismatch here rather than as something someone has to notice in a
   * screenshot.
   *
   * ⚠️ The fixture is picked to satisfy four conditions, because four constants
   * are deliberately absolute and any of them binding makes the property false:
   *   (a) no block hits MIN_BLOCK_STEPS — the shortest is 50 min = 40px at z=1
   *   (b) no block exceeds defaultMaxBlock at the LARGER height — the longest is
   *       60 min = 96px at z=2, far under the 320px ceiling. This is the easy
   *       one to get wrong: the cap must be checked at 1440, not at 720
   *   (c) no NUDGE_PX or settle push fires — the gaps are 60 and 70 minutes,
   *       both under the 90-minute fold threshold, so there are NO FOLDS, and
   *       settle's flat +4 fires once per fold
   *   (d) the window extends past the last block, so `total` comes from the
   *       AXIS rather than from the blocks — without this the test cannot see
   *       the second `buildScale`, which is the site that silently clips
   */
  it('⭐ at zoom z the grid is exactly the zoom-1 grid times z', () => {
    const zeroFold = [ev('09:00', '10:00'), ev('11:00', '11:50'), ev('13:00', '13:45')];

    const base = layoutTimeGrid([zeroFold], 720);
    const zoomed = layoutTimeGrid([zeroFold], 1440);

    // The premise: 720 gets no zoom, 1440 gets exactly 2.
    expect(zoomCandidates(720)).toEqual([]);
    expect(zoomed.scale).toBeCloseTo(base.scale * 2, 6);
    // And the fixture really is fold-free, or (c) does not hold.
    expect(base.folds).toHaveLength(0);

    // The AXIS extent. `total` is internal, so this is the observable form of
    // the same quantity — and with no folds, `yFor` is the unshifted mapping,
    // so `yFor(windowEnd)` is exactly what `gridBottom` computes.
    expect(zoomed.yFor(zoomed.windowEnd)).toBeCloseTo(base.yFor(base.windowEnd) * 2, 6);

    const baseBlocks = base.columns[0]!;
    const zoomBlocks = zoomed.columns[0]!;
    expect(zoomBlocks).toHaveLength(baseBlocks.length);
    baseBlocks.forEach((b, i) => {
      expect(zoomBlocks[i]!.top).toBeCloseTo(b.top * 2, 6);
      expect(zoomBlocks[i]!.height).toBeCloseTo(b.height * 2, 6);
    });
  });

  it('the fold threshold in MINUTES is identical at every zoom', () => {
    // The same day folds in the same places and is drawn to the same shape,
    // just bigger. This is the property MAX_GAP_PX is zoomed to preserve.
    expect(foldThresholdMinutes(90, 0.8, 1)).toBe(90);
    expect(foldThresholdMinutes(90, 1.6, 2)).toBe(90);
    // And the case where MAX_GAP_PX actually binds — the only one that tests it.
    expect(foldThresholdMinutes(120, 0.8, 1)).toBeCloseTo(92.5, 6);
    expect(foldThresholdMinutes(120, 1.6, 2)).toBeCloseTo(92.5, 6);
  });

  it('a fold band grows with the zoom, exactly', () => {
    for (const gap of [30, 90, 240, 600]) {
      expect(foldHeightFor(gap, 2)).toBeCloseTo(foldHeightFor(gap) * 2, 6);
      expect(foldHeightFor(gap, 1)).toBe(foldHeightFor(gap));
    }
  });

  it('an empty day zooms too, rather than sitting at the base hour', () => {
    // The load-bearing line: without it an empty day renders at 0.8 on a screen
    // where every other day renders at 1.6.
    expect(layoutTimeGrid([[]], 480).scale).toBe(0.8);
    expect(layoutTimeGrid([[]], 1440).scale).toBeCloseTo(1.6, 6);
  });

  it('a genuinely packed day still compresses, at any plot height', () => {
    const packed = Array.from({ length: 22 }, (_, i) => {
      const start = 7 * 60 + i * 35;
      const hh = String(Math.floor(start / 60)).padStart(2, '0');
      const mm = String(start % 60).padStart(2, '0');
      return ev(`${hh}:${mm}`, `${hh}:${mm}`);
    });
    // The zoom is offered first and refused, then the ladder runs as it always
    // has — which is why this change cannot make a busy day worse.
    const l = layoutTimeGrid([packed], 480);
    expect(l.columns[0]).toHaveLength(22);
    const bottom = Math.max(...l.columns[0]!.map((b) => b.top + b.height));
    expect(bottom).toBeLessThanOrEqual(480 + 1);
  });

  /*
   * ⚠️ THE GUARD FOR THE CLIPPING BUG.
   *
   * `attempt` computes the axis's own extent with a SECOND `buildScale`, and if
   * that one is left at the un-zoomed rung scale it under-reports how tall the
   * layout really is. The search then accepts a zoom that does not fit, and the
   * plot — which is `overflow: hidden` — silently swallows the bottom of the
   * family's day. No exception, no telemetry, nothing to notice.
   *
   * The affine test above cannot see it on its own fixture, because that day is
   * far from the budget at every zoom. This one asserts the invariant the bug
   * actually violates, across days of every shape and plots of every size:
   * NOTHING the grid draws may extend past the plot it was given.
   */
  it('⭐ never draws past the plot it was given, at any zoom', () => {
    const days = [
      [ev('09:00', '10:00'), ev('11:00', '11:50'), ev('13:00', '13:45')],
      [ev('06:30', '07:30'), ev('20:30', '22:00')],
      [ev('08:00', '18:00')],
      Array.from({ length: 14 }, (_, i) =>
        ev(`${String(7 + i).padStart(2, '0')}:00`, `${String(7 + i).padStart(2, '0')}:45`)
      ),
    ];
    for (const day of days) {
      for (const height of [480, 720, 900, 1080, 1200, 1440, 2160]) {
        const l = layoutTimeGrid([day], height);
        const blockBottom = l.columns[0]!.length
          ? Math.max(...l.columns[0]!.map((b) => b.top + b.height))
          : 0;
        const axisBottom = l.yFor(l.windowEnd);
        expect(Math.max(blockBottom, axisBottom)).toBeLessThanOrEqual(height + 1);
      }
    }
  });
});

describe('the generous axis — how much day gets drawn', () => {
  const ordinary = [ev('09:00', '10:00'), ev('13:00', '13:45'), ev('17:00', '18:00')];

  it('⭐ draws a standard day, widened into whatever space is left', () => {
    // greg: "if the space is available, should we just print the full daily grid
    // rather than collapsing when not needed?" — and then: "if vertical space
    // still exists… print grid lines from the top to the bottom".
    const l = layoutTimeGrid([ordinary], 900);
    expect(l.folds).toHaveLength(0);
    expect(l.tier).toBe('roomy');
    // A standard shape, not an arbitrary one fitted to this exact plot.
    expect([12, 14, 16, 18]).toContain((l.windowEnd - l.windowStart) / 60);
    // And it genuinely uses the glass.
    expect(l.yFor(l.windowEnd)).toBeGreaterThan(900 * 0.85);
  });

  it('⭐ only ever draws one of four standard days, so the grid holds still', () => {
    // The reason the window is quantized: fitted exactly to each plot, Monday
    // and Tuesday would show different hours purely because their events differ,
    // which is the defect SCALE_STEPS was quantized to prevent.
    const shapes = new Set<number>();
    const days = [
      ordinary,
      [ev('09:00', '09:30')],
      [ev('08:00', '09:00'), ev('19:00', '19:30')],
      [ev('10:00', '11:00'), ev('14:00', '14:20'), ev('18:00', '18:45')],
    ];
    for (const day of days) {
      for (const height of [700, 780, 860, 940, 1020, 1100, 1180, 1260, 1400]) {
        const l = layoutTimeGrid([day], height);
        if (l.tier === 'roomy') shapes.add((l.windowEnd - l.windowStart) / 60);
      }
    }
    expect([...shapes].sort((a, b) => a - b)).toEqual(
      expect.arrayContaining([...shapes].filter((h) => [12, 14, 16, 18].includes(h)))
    );
    expect([...shapes].every((h) => [12, 14, 16, 18].includes(h))).toBe(true);
  });

  it('⭐ a single afternoon appointment gets a day, not a one-hour box', () => {
    // The case greg called awkward: two grid lines floating in an empty plot.
    const l = layoutTimeGrid([[ev('14:00', '15:00')]], 720);
    expect((l.windowEnd - l.windowStart) / 60).toBeGreaterThanOrEqual(12);
    expect(l.ticks.length).toBeGreaterThan(10);
  });

  it('⚠️ widens for an early riser rather than clipping them', () => {
    // The standard day is a FLOOR on how much gets drawn, never a clip. A 04:45
    // start is outside every standard window, so the axis simply starts earlier.
    const l = layoutTimeGrid([[ev('04:45', '05:30'), ev('09:00', '10:00')]], 900);
    expect(l.windowStart).toBe(4 * 60);
    expect(l.windowEnd).toBeGreaterThanOrEqual(20 * 60);
  });

  it('falls back to the day’s own span when the full day will not fit', () => {
    const l = layoutTimeGrid([ordinary], 480);
    expect(l.windowStart).toBe(9 * 60);
    expect(l.windowEnd).toBe(18 * 60);
    expect(l.folds).toHaveLength(0); // still honest, just tighter
  });

  it('⭐ falls all the way back to folding, unchanged, when nothing else fits', () => {
    // The terminal fallback IS today's code. A day this shape on a plot this
    // short renders exactly as it always did.
    const l = layoutTimeGrid([[ev('07:30', '08:00'), ev('15:20', '15:50')]], 300);
    expect(l.folds).toHaveLength(1);
    expect(l.tier).not.toBe('roomy');
  });

  it('never draws past the plot, at any axis or zoom', () => {
    const shapes = [
      ordinary,
      [ev('14:00', '15:00')],
      [ev('06:30', '07:30'), ev('20:30', '22:00')],
      [ev('08:00', '18:00')],
    ];
    for (const day of shapes) {
      for (const height of [220, 300, 480, 600, 720, 900, 1080, 1440, 2160]) {
        const l = layoutTimeGrid([day], height);
        const blocks = l.columns[0]!.length
          ? Math.max(...l.columns[0]!.map((b) => b.top + b.height))
          : 0;
        expect(Math.max(blocks, l.yFor(l.windowEnd))).toBeLessThanOrEqual(height + 1);
      }
    }
  });

  it('⭐ keeps a long block capped and flagged, however generous the axis', () => {
    // The one thing that must stay bounded whatever else expands.
    //
    // ⚠️ The cap is SOFT, so a capped block legitimately sits a little above the
    // ceiling — that damping is what keeps "a longer event is never drawn
    // shorter" true. So assert the flag and a sane bound, not the raw ceiling:
    // an earlier version of this test asserted `<= CEILING` and failed on the
    // module working as designed.
    for (const height of [720, 1080, 1440, 2160]) {
      const l = layoutTimeGrid([[ev('08:00', '18:00')]], height);
      const block = l.columns[0]![0]!;
      expect(block.capped).toBe(true);
      expect(block.height).toBeLessThan(MAX_BLOCK_CEILING_PX * 1.5);
      // And never a meaningful fraction of the wall, which is the actual worry.
      expect(block.height).toBeLessThan(height * 0.75);
    }
  });
});
