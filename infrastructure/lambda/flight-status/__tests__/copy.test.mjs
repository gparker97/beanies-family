import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { PUSH_TEMPLATES, PUSH_TITLE, clockTime, pushBody, shortDate } from '../copy.mjs';

const now = {
  departureDate: '2026-12-14',
  departureTime: '08:30',
  terminal: '3',
  arrivalDate: '2026-12-14',
  arrivalTime: '14:55',
};

describe('push copy', () => {
  test('title and formatters match the client (formatDateShort / formatTime12)', () => {
    assert.equal(PUSH_TITLE, 'beanies.family');
    assert.equal(shortDate('2026-12-04'), '4 Dec');
    assert.equal(clockTime('08:30'), '8:30am');
    assert.equal(clockTime('17:00'), '5pm');
    assert.equal(clockTime('00:05'), '12:05am');
  });

  test('the four shapes in en', () => {
    assert.equal(
      pushBody('en', { flight: 'SQ318', now, was: { departureTime: '06:50' } }),
      'SQ318 now leaves at 8:30am from Terminal 3.'
    );
    assert.equal(
      pushBody('en', {
        flight: 'SQ318',
        now: { ...now, terminal: undefined },
        was: { departureDate: '2026-12-13', departureTime: '06:50' },
      }),
      'SQ318 now leaves on 14 Dec at 8:30am.'
    );
    assert.equal(
      pushBody('en', { flight: 'SQ318', now, was: { terminal: '2' } }),
      'SQ318 now leaves from Terminal 3.'
    );
    assert.equal(
      pushBody('en', {
        flight: 'SQ318',
        date: '2026-12-13',
        cancelled: true,
        airline: 'Singapore Airlines (SQ)',
        now,
        was: {},
      }),
      'Singapore Airlines cancelled SQ318 on 13 Dec.'
    );
    assert.equal(
      pushBody('en', { flight: 'SQ318', date: '2026-12-13', cancelled: true, now, was: {} }),
      'SQ318 on 13 Dec was cancelled.'
    );
  });

  test('arrival-only changes say when it lands', () => {
    assert.equal(
      pushBody('en', { flight: 'SQ318', now, was: { arrivalTime: '14:00' } }),
      'SQ318 now lands at 2:55pm.'
    );
    assert.equal(
      pushBody('en', { flight: 'SQ318', now, was: { arrivalDate: '2026-12-13' } }),
      'SQ318 now lands on 14 Dec at 2:55pm.'
    );
  });

  test('zh, and an unknown language reads en', () => {
    assert.equal(
      pushBody('zh', { flight: 'SQ318', now, was: { departureTime: '06:50' } }),
      'SQ318 现改为 8:30am 从3 号航站楼起飞。'
    );
    assert.equal(
      pushBody('zh', {
        flight: 'SQ318',
        date: '2026-12-13',
        cancelled: true,
        airline: 'Singapore Airlines',
        now,
        was: {},
      }),
      'Singapore Airlines已取消 13 Dec 的 SQ318 航班。'
    );
    assert.equal(
      pushBody('fr', { flight: 'SQ318', now, was: { terminal: '2' } }),
      'SQ318 now leaves from Terminal 3.'
    );
  });

  test('both tables carry the same keys and never a name placeholder beyond flight/airline', () => {
    assert.deepEqual(Object.keys(PUSH_TEMPLATES.en).sort(), Object.keys(PUSH_TEMPLATES.zh).sort());
    for (const lang of ['en', 'zh']) {
      for (const t of Object.values(PUSH_TEMPLATES[lang])) {
        for (const [, name] of t.matchAll(/\{(\w+)\}/g)) {
          assert.ok(
            ['flight', 'time', 'date', 'terminal', 'airline'].includes(name),
            `${lang}: {${name}}`
          );
        }
      }
    }
  });
});
