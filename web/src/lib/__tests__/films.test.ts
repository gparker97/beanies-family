import { describe, it, expect } from 'vitest';
import { SITE_URL } from '@beanies/brand/nav';
import { ORGANIZATION } from '@beanies/brand/schema';
import {
  MUSICAL,
  durationClock,
  durationIso,
  durationSpoken,
  errorReason,
  newMilestones,
  videoObject,
} from '../films';

describe('newMilestones', () => {
  const none = new Set<number>();

  it('returns nothing before the first milestone', () => {
    expect(newMilestones(0, 67, none)).toEqual([]);
    expect(newMilestones(16, 67, none)).toEqual([]);
  });

  it('fires each milestone as playback moves forward', () => {
    const fired = new Set<number>();
    const sent: number[] = [];
    for (let t = 0; t <= 67; t += 0.25) {
      for (const m of newMilestones(t, 67, fired)) {
        fired.add(m);
        sent.push(m);
      }
    }
    expect(sent).toEqual([25, 50, 75, 100]);
  });

  it('returns every milestone passed by one seek, in order', () => {
    expect(newMilestones(55, 67, none)).toEqual([25, 50, 75]);
    expect(newMilestones(67, 67, none)).toEqual([25, 50, 75, 100]);
  });

  it('never repeats a fired milestone', () => {
    expect(newMilestones(60, 67, new Set([25, 50]))).toEqual([75]);
    expect(newMilestones(67, 67, new Set([25, 50, 75, 100]))).toEqual([]);
  });

  it('does not re-fire after a rewind', () => {
    const fired = new Set([25, 50]);
    expect(newMilestones(5, 67, fired)).toEqual([]);
    expect(newMilestones(40, 67, fired)).toEqual([]);
  });

  it('returns nothing while the duration is unknown or zero', () => {
    expect(newMilestones(10, Number.NaN, none)).toEqual([]);
    expect(newMilestones(10, Number.POSITIVE_INFINITY, none)).toEqual([]);
    expect(newMilestones(10, 0, none)).toEqual([]);
    expect(newMilestones(Number.NaN, 67, none)).toEqual([]);
  });
});

describe('durations', () => {
  it('derives every string from the 67 seconds of the musical', () => {
    expect(durationClock(MUSICAL)).toBe('1:07');
    expect(durationIso(MUSICAL)).toBe('PT1M7S');
    expect(durationSpoken(MUSICAL)).toBe('1 minute 7 seconds');
  });

  it('handles whole minutes, short films and plurals', () => {
    expect(durationClock({ durationS: 60 })).toBe('1:00');
    expect(durationIso({ durationS: 60 })).toBe('PT1M');
    expect(durationSpoken({ durationS: 60 })).toBe('1 minute');
    expect(durationClock({ durationS: 7 })).toBe('0:07');
    expect(durationIso({ durationS: 7 })).toBe('PT7S');
    expect(durationSpoken({ durationS: 1 })).toBe('1 second');
    expect(durationSpoken({ durationS: 121 })).toBe('2 minutes 1 second');
    expect(durationIso({ durationS: 0 })).toBe('PT0S');
  });
});

describe('MUSICAL urls', () => {
  it('are absolute https URLs under the versioned media prefix', () => {
    const base = `${SITE_URL}/media/musical/v2/`;
    for (const url of Object.values(MUSICAL.urls)) {
      expect(url.startsWith(base)).toBe(true);
      expect(new URL(url).protocol).toBe('https:');
    }
    expect(MUSICAL.urls).toEqual({
      film720: `${base}film-720.mp4`,
      film1080: `${base}film-1080.mp4`,
      loop640: `${base}loop-640.mp4`,
      loop960: `${base}loop-960.mp4`,
      poster: `${base}poster-1280.webp`,
    });
  });
});

describe('videoObject', () => {
  it('describes the film for the JSON-LD graph', () => {
    expect(videoObject(MUSICAL)).toEqual({
      '@type': 'VideoObject',
      name: 'the morning routine musical',
      description: MUSICAL.description,
      thumbnailUrl: MUSICAL.urls.poster,
      uploadDate: '2026-11-04',
      duration: 'PT1M7S',
      contentUrl: MUSICAL.urls.film1080,
      publisher: { '@id': ORGANIZATION['@id'] },
    });
  });
});

describe('errorReason', () => {
  it('names a play() rejection by its DOMException or Error name', () => {
    expect(errorReason(new DOMException('blocked', 'NotAllowedError'))).toBe('NotAllowedError');
    expect(errorReason(new DOMException('gone', 'NotSupportedError'))).toBe('NotSupportedError');
    expect(errorReason(new TypeError('x'))).toBe('TypeError');
  });

  it('names a media error by its code, without the MediaError global', () => {
    expect(errorReason({ code: 1, message: '' })).toBe('MEDIA_ERR_ABORTED');
    expect(errorReason({ code: 2, message: '' })).toBe('MEDIA_ERR_NETWORK');
    expect(errorReason({ code: 3, message: '' })).toBe('MEDIA_ERR_DECODE');
    expect(errorReason({ code: 4, message: '' })).toBe('MEDIA_ERR_SRC_NOT_SUPPORTED');
  });

  it('falls back to unknown', () => {
    expect(errorReason(null)).toBe('unknown');
    expect(errorReason(undefined)).toBe('unknown');
    expect(errorReason('boom')).toBe('unknown');
    expect(errorReason({ code: 9 })).toBe('unknown');
    expect(errorReason({})).toBe('unknown');
  });
});
