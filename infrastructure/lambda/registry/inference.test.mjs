import { describe, expect, it } from 'vitest';
import {
  NATIVE_PLATFORMS,
  SCORING,
  applyHeardVia,
  candidatesFor,
  contradicts,
  eventEpoch,
  hasFields,
  normalizeSource,
  scoreFamily,
  wantsCreateInference,
} from './inference.mjs';

// Fixtures mirror beanies-metrics/scripts/__tests__/infer_attribution.test.mjs, so a rule change
// here fails both suites.
const CREATED = '2026-10-03T08:00:00.000Z';
const createdSec = Date.parse(CREATED) / 1000;
const NOW = new Date('2026-10-03T12:00:00.000Z');

const family = (over = {}) => ({
  familyId: 'fam-1',
  signupPlatform: 'ios',
  createdAt: CREATED,
  attribution: null,
  attributionInferred: null,
  heardVia: null,
  ...over,
});

/** A store tap `minutesBefore` the pod. */
const tap = (
  eventId,
  minutesBefore,
  { platform = 'ios', content = 'funny-dinner', source = 'chatgpt' } = {}
) => {
  const tsEpoch = createdSec - minutesBefore * 60;
  return {
    eventId,
    kind: 'store_tap',
    platform,
    tagged: content != null,
    ...(content != null
      ? {
          fields: {
            utm_source: source,
            utm_medium: 'cpc',
            utm_campaign: 'sg-pilot-oct26',
            utm_content: content,
          },
        }
      : {}),
    ts: new Date(tsEpoch * 1000).toISOString(),
    tsEpoch,
    loc: '/ios',
  };
};

describe('SCORING (pinned: the batch run and the Lambda share it)', () => {
  it('is the store_tap_v1 table, deep-frozen', () => {
    expect(SCORING).toEqual({
      method: 'store_tap_v1',
      windowHours: 72,
      gapTiers: [
        { maxMinutes: 10, base: 1.0 },
        { maxMinutes: 30, base: 0.85 },
        { maxMinutes: 120, base: 0.6 },
        { maxMinutes: 360, base: 0.4 },
        { maxMinutes: 72 * 60, base: 0.2 },
      ],
      heardViaContradiction: 0.6,
      bands: { high: 0.8, medium: 0.5, low: 0.25 },
    });
    expect(Object.isFrozen(SCORING)).toBe(true);
    expect(Object.isFrozen(SCORING.gapTiers[0])).toBe(true);
    expect(NATIVE_PLATFORMS).toEqual(['ios', 'android']);
  });
});

describe('scoreFamily (fixtures shared with the ops scorer test)', () => {
  it('a tap 5 minutes before an iOS pod with no competitor is high', () => {
    const r = scoreFamily(family(), [tap('e1', 5)], { now: NOW });
    expect(r.status).toBe('scored');
    expect(r.value).toEqual({
      fields: {
        utm_source: 'chatgpt',
        utm_medium: 'cpc',
        utm_campaign: 'sg-pilot-oct26',
        utm_content: 'funny-dinner',
      },
      confidence: 1,
      band: 'high',
      method: 'store_tap_v1',
      eventId: 'e1',
      gapMinutes: 5,
      candidates: 1,
      scoredAt: NOW.toISOString(),
    });
  });

  it('two different-ad taps in the same tier halve the score (high -> medium)', () => {
    const r = scoreFamily(family(), [tap('e1', 3), tap('e2', 8, { content: 'straight-one-app' })]);
    expect(r.value).toMatchObject({
      band: 'medium',
      confidence: 0.5,
      eventId: 'e1',
      candidates: 2,
    });
  });

  it('a 24 hour gap scores 0.2: below the low band, nothing to write', () => {
    const r = scoreFamily(family(), [tap('e1', 24 * 60)]);
    expect(r).toMatchObject({ status: 'below-threshold', confidence: 0.2, candidates: 1 });
    expect(r.value).toBeUndefined();
  });

  it('no tap in the window, or only another platform: no candidates', () => {
    expect(scoreFamily(family(), [tap('old', 72 * 60 + 1)]).status).toBe('no-candidates');
    expect(scoreFamily(family(), [tap('droid', 5, { platform: 'android' })]).status).toBe(
      'no-candidates'
    );
  });

  it('a contradicting survey answer multiplies by 0.6', () => {
    const r = scoreFamily(family({ heardVia: 'reddit' }), [tap('e1', 5)]);
    expect(r.value).toMatchObject({ confidence: 0.6, band: 'medium' });
  });

  it('web, platform-less and deterministic pods are never scored', () => {
    expect(scoreFamily(family({ signupPlatform: 'web' }), [tap('e1', 5)]).status).toBe(
      'ineligible'
    );
    expect(scoreFamily(family({ signupPlatform: null }), [tap('e1', 5)]).status).toBe('ineligible');
    expect(
      scoreFamily(family({ attribution: { utm_source: 'chatgpt' } }), [tap('e1', 5)]).status
    ).toBe('deterministic');
  });
});

describe('the helpers the ops script imports', () => {
  it('normalizeSource, hasFields, contradicts, eventEpoch', () => {
    expect(normalizeSource('www.Reddit.com')).toBe('reddit');
    expect(hasFields({ a: 1 })).toBe(true);
    expect(hasFields({})).toBe(false);
    expect(contradicts('reddit', 'chatgpt')).toBe(true);
    expect(contradicts('app_store', 'chatgpt')).toBe(false);
    expect(eventEpoch({ ts: '2026-10-03T08:00:00.000Z' })).toBe(createdSec);
  });

  it('candidatesFor skips claimed taps and orders nearest first', () => {
    const c = candidatesFor(
      family(),
      [tap('far', 50), tap('near', 2), tap('taken', 1)],
      new Set(['taken'])
    );
    expect(c.map((x) => x.event.eventId)).toEqual(['near', 'far']);
  });
});

describe('applyHeardVia (the late survey answer, #128)', () => {
  const scoredWithout = (taps) => scoreFamily(family(), taps, { now: NOW }).value;

  // Gap tiers x competitor counts x every survey id (and none): a late answer applied to the
  // value scored without it must give the band and confidence scoring with it gives.
  const SHAPES = [
    ['one near tap', [tap('e1', 5)]],
    ['two ads in a tier', [tap('e1', 3), tap('e2', 8, { content: 'straight-one-app' })]],
    ['a 20 minute gap', [tap('e1', 20)]],
    ['a 90 minute gap', [tap('e1', 90)]],
    ['a 5 hour gap', [tap('e1', 300)]],
  ];
  const ANSWERS = ['chatgpt_ad', 'ai', 'reddit', 'google', 'friend'];
  for (const [shape, taps] of SHAPES) {
    it.each(ANSWERS)(`matches scoring with the answer present: ${shape}, %s`, (heardVia) => {
      const base = scoredWithout(taps);
      const late = applyHeardVia(base, heardVia, base.fields.utm_source);
      const upfront = scoreFamily(family({ heardVia }), taps, { now: NOW });
      if (upfront.status === 'scored') {
        expect(late).toEqual(upfront.value);
      } else {
        expect(upfront.status).toBe('below-threshold');
        expect(late).toBeNull();
      }
    });
  }

  it('a contradiction multiplies by heardViaContradiction and re-bands (never an upgrade)', () => {
    const base = scoredWithout([tap('e1', 5)]);
    expect(applyHeardVia(base, 'reddit', 'chatgpt')).toEqual({
      ...base,
      confidence: SCORING.heardViaContradiction,
      band: 'medium',
    });
  });

  it('a consistent or channel-less answer leaves confidence and band as they were', () => {
    const base = scoredWithout([tap('e1', 5)]);
    expect(applyHeardVia(base, 'chatgpt_ad', 'chatgpt')).toEqual(base);
    expect(applyHeardVia(base, 'app_store', 'chatgpt')).toEqual(base);
  });

  it('falling below the low band returns null, as the scorer stores nothing there', () => {
    const low = { ...scoredWithout([tap('e1', 300)]) };
    expect(low.band).toBe('low');
    expect(applyHeardVia(low, 'reddit', 'chatgpt')).toBeNull();
  });

  it('an untagged inferred value has no source to contradict', () => {
    const base = scoredWithout([tap('e1', 5, { content: null })]);
    expect(applyHeardVia(base, 'reddit', base.fields.utm_source)).toEqual(base);
  });

  it('a value with no numeric confidence comes back unchanged; nothing comes back null', () => {
    const odd = { band: 'medium', fields: {} };
    expect(applyHeardVia(odd, 'reddit', 'chatgpt')).toBe(odd);
    expect(applyHeardVia(null, 'reddit', 'chatgpt')).toBeNull();
  });

  it('does not mutate the value it is given', () => {
    const base = scoredWithout([tap('e1', 5)]);
    const copy = structuredClone(base);
    applyHeardVia(base, 'reddit', 'chatgpt');
    expect(base).toEqual(copy);
  });
});

describe('wantsCreateInference (who is scorable at create time)', () => {
  it.each([
    ['native (ios) untagged, nothing inferred', { signupPlatform: 'ios' }, true],
    [
      'native (android) untagged, null attribution',
      { signupPlatform: 'android', attribution: null },
      true,
    ],
    ['web', { signupPlatform: 'web' }, false],
    ['no platform', { signupPlatform: null }, false],
    [
      'tagged (deterministic)',
      { signupPlatform: 'ios', attribution: { utm_source: 'chatgpt' } },
      false,
    ],
    [
      'an empty attribution map counts as untagged',
      { signupPlatform: 'ios', attribution: {} },
      true,
    ],
    [
      'already inferred (stored value carried forward)',
      { signupPlatform: 'ios', attributionInferred: { band: 'high' } },
      false,
    ],
  ])('%s -> %s', (_label, item, expected) => {
    expect(wantsCreateInference(item)).toBe(expected);
  });
});
