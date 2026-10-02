import { describe, it, expect } from 'vitest';
import {
  ATTRIBUTION_KEYS,
  ATTRIBUTION_TTL_MS,
  NON_UTM_ATTRIBUTION_KEYS,
  appendAttribution,
  parseAttributionDetailed,
  ATTRIBUTION_SKEW_MS,
  makeEnvelope,
  parseAttribution,
  pickPlausibleProps,
  readEnvelope,
  sanitiseAttribution,
  summariseAttribution,
  toSearchParams,
} from '@beanies/brand/attribution';

/**
 * Shared fixtures (#118). The registry Lambda's `validAttribution` is this parser's twin and
 * `infrastructure/lambda/registry/index.test.mjs` uses the SAME strings, so a rule change that
 * lands on one side fails the other.
 */
export const ATTRIBUTION_FIXTURES = {
  tooLong: 'a'.repeat(101),
  maxLen: 'a'.repeat(100),
  script: '<script>alert(1)</script>',
  padded: '  sg-pilot-oct26  ',
  mrkdwn: 'x_y~z:1',
  backtick: 'a`b',
};

const APP = 'https://app.beanies.family';
const TAGGED =
  '?utm_source=chatgpt&utm_medium=cpc&utm_campaign=sg-pilot-oct26&utm_content=calm-ad1&campaign_id=c1&ad_group_id=g1&ad_id=a1&oppref=opp.123';

describe('parseAttribution', () => {
  it('keeps every allowlisted key and ignores the rest', () => {
    const a = parseAttribution(`${TAGGED}&ref=invite&foo=bar`);
    expect(a).toEqual({
      utm_source: 'chatgpt',
      utm_medium: 'cpc',
      utm_campaign: 'sg-pilot-oct26',
      utm_content: 'calm-ad1',
      campaign_id: 'c1',
      ad_group_id: 'g1',
      ad_id: 'a1',
      oppref: 'opp.123',
    });
    expect(a).not.toHaveProperty('ref');
  });

  it('accepts the search with or without the leading ?', () => {
    expect(parseAttribution('utm_source=x')).toEqual({ utm_source: 'x' });
    expect(parseAttribution('?utm_source=x')).toEqual({ utm_source: 'x' });
  });

  it('returns null when no attribution key is present', () => {
    expect(parseAttribution('')).toBeNull();
    expect(parseAttribution('?resume=setup&next=%2Fnook')).toBeNull();
  });

  it('drops an invalid value for its own field only', () => {
    const { tooLong, script, padded, mrkdwn, backtick, maxLen } = ATTRIBUTION_FIXTURES;
    const a = parseAttribution(
      `?utm_source=${encodeURIComponent(tooLong)}&utm_medium=${encodeURIComponent(script)}` +
        `&utm_campaign=${encodeURIComponent(padded)}&utm_content=${encodeURIComponent(mrkdwn)}` +
        `&ad_id=${encodeURIComponent(backtick)}&oppref=${maxLen}&utm_term=`
    );
    expect(a).toEqual({
      utm_campaign: 'sg-pilot-oct26', // trimmed
      utm_content: mrkdwn, // _ ~ : are inside the set
      oppref: maxLen,
    });
  });

  it('returns null when every value is invalid', () => {
    expect(parseAttribution(`?utm_source=${encodeURIComponent('a b')}&utm_term=`)).toBeNull();
  });
});

describe('sanitiseAttribution', () => {
  it('rejects non-objects and ignores unknown keys', () => {
    expect(sanitiseAttribution(null)).toBeNull();
    expect(sanitiseAttribution('utm_source=x')).toBeNull();
    expect(sanitiseAttribution(['utm_source'])).toBeNull();
    expect(sanitiseAttribution({ utm_source: 'x', future_key: 'y' })).toEqual({ utm_source: 'x' });
    expect(sanitiseAttribution({ utm_source: 42 })).toBeNull();
  });
});

describe('appendAttribution', () => {
  const a = { utm_source: 'chatgpt', utm_content: 'calm-ad1' };

  it('decorates app-origin links, including the bare origin and paths with a hash', () => {
    expect(appendAttribution(`${APP}/welcome`, a, APP)).toBe(
      `${APP}/welcome?utm_source=chatgpt&utm_content=calm-ad1`
    );
    expect(appendAttribution(APP, a, APP)).toBe(`${APP}/?utm_source=chatgpt&utm_content=calm-ad1`);
    expect(appendAttribution(`${APP}/create#top`, a, APP)).toBe(
      `${APP}/create?utm_source=chatgpt&utm_content=calm-ad1#top`
    );
  });

  it('never overwrites a parameter already on the link, and is idempotent', () => {
    const once = appendAttribution(`${APP}/welcome?utm_source=blog`, a, APP);
    expect(once).toBe(`${APP}/welcome?utm_source=blog&utm_content=calm-ad1`);
    expect(appendAttribution(once, a, APP)).toBe(once);
  });

  it('leaves off-origin, relative and unparseable hrefs alone', () => {
    expect(appendAttribution('https://beanies.family/blog', a, APP)).toBe(
      'https://beanies.family/blog'
    );
    expect(appendAttribution('/ios', a, APP)).toBe('/ios');
    expect(appendAttribution('mailto:hi@beanies.family', a, APP)).toBe('mailto:hi@beanies.family');
    expect(appendAttribution(`${APP}/welcome`, a, 'not a url')).toBe(`${APP}/welcome`);
  });

  it('matches the dev origin too', () => {
    expect(appendAttribution('http://localhost:5173/welcome', a, 'http://localhost:5173')).toBe(
      'http://localhost:5173/welcome?utm_source=chatgpt&utm_content=calm-ad1'
    );
  });
});

describe('envelope', () => {
  const now = 1_700_000_000_000;
  const fields = { utm_source: 'chatgpt' };

  it('round-trips and reports ok inside the TTL', () => {
    const env = makeEnvelope(fields, now);
    expect(readEnvelope(env, now)).toEqual({ state: 'ok', fields });
    expect(readEnvelope(env, now + ATTRIBUTION_TTL_MS - 1)).toEqual({ state: 'ok', fields });
  });

  it('expires at exactly the TTL boundary', () => {
    const env = makeEnvelope(fields, now);
    expect(readEnvelope(env, now + ATTRIBUTION_TTL_MS)).toEqual({ state: 'expired' });
  });

  it('honours clock skew but treats a far-future capturedAt as corrupt', () => {
    expect(readEnvelope(makeEnvelope(fields, now + ATTRIBUTION_SKEW_MS), now)).toEqual({
      state: 'ok',
      fields,
    });
    expect(readEnvelope(makeEnvelope(fields, now + ATTRIBUTION_SKEW_MS + 1), now)).toEqual({
      state: 'corrupt',
    });
  });

  it('parseAttributionDetailed reports keys present whether or not their values validate', () => {
    expect(parseAttributionDetailed(TAGGED).present).toBe(8);
    expect(parseAttributionDetailed('?utm_source=a b&utm_term=&ref=x')).toEqual({
      fields: null,
      present: 2,
    });
    expect(parseAttributionDetailed('?utm_source=ok&oppref=a b')).toEqual({
      fields: { utm_source: 'ok' },
      present: 2,
    });
    expect(parseAttributionDetailed('?resume=setup')).toEqual({ fields: null, present: 0 });
  });

  it('reads nothing as none and anything malformed as corrupt', () => {
    expect(readEnvelope(null, now)).toEqual({ state: 'none' });
    expect(readEnvelope(undefined, now)).toEqual({ state: 'none' });
    expect(readEnvelope('string', now)).toEqual({ state: 'corrupt' });
    expect(readEnvelope({ v: 2, capturedAt: now, fields }, now)).toEqual({ state: 'corrupt' });
    expect(readEnvelope({ v: 1, fields }, now)).toEqual({ state: 'corrupt' });
    expect(readEnvelope({ v: 1, capturedAt: now, fields: {} }, now)).toEqual({ state: 'corrupt' });
    expect(readEnvelope({ v: 1, capturedAt: now, fields: { utm_source: 'a b' } }, now)).toEqual({
      state: 'corrupt',
    });
  });
});

describe('derived helpers', () => {
  it('toSearchParams emits keys in canonical order and skips empties', () => {
    expect(toSearchParams({ utm_content: 'c', utm_source: 's', utm_term: '' }).toString()).toBe(
      'utm_source=s&utm_content=c'
    );
  });

  it('pickPlausibleProps takes only the four visit-level keys', () => {
    expect(pickPlausibleProps(parseAttribution(TAGGED))).toEqual({
      utm_source: 'chatgpt',
      utm_medium: 'cpc',
      utm_campaign: 'sg-pilot-oct26',
      utm_content: 'calm-ad1',
    });
    expect(pickPlausibleProps({ oppref: 'x' })).toBeUndefined();
    expect(pickPlausibleProps(null)).toBeUndefined();
  });

  it('summariseAttribution is source / campaign / content with gaps closed', () => {
    expect(summariseAttribution(parseAttribution(TAGGED)!)).toBe(
      'chatgpt / sg-pilot-oct26 / calm-ad1'
    );
    expect(summariseAttribution({ utm_source: 'blog' })).toBe('blog');
  });

  it('NON_UTM_ATTRIBUTION_KEYS is exactly the ad-platform ids', () => {
    expect(NON_UTM_ATTRIBUTION_KEYS).toEqual(['campaign_id', 'ad_group_id', 'ad_id', 'oppref']);
    expect(ATTRIBUTION_KEYS).not.toContain('ref');
  });
});
