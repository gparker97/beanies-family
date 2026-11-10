/**
 * The closed-app push copy (#143 Phase 2, requirement 19) says what the app says. A closed app
 * cannot read the string tables, so the `flight-status` Lambda holds its own `en`/`zh` table
 * (`copy.mjs`); this drift test pins it to the client's `flightChecks.change.*` /
 * `flightChecks.cancel.*` strings, template for template and sentence for sentence (the
 * client's `changeSentence(..., updated = false)` and `cancelSentence`). A cancel push keeps
 * the client's FIRST sentence only (the second describes the plan after the device writes it).
 */
import { describe, expect, it } from 'vitest';
import type { ScheduleTuple } from '@/types/flightStatus';
import type { UIStringKey } from '@/services/translation/uiStrings';
import { UI_STRINGS } from '@/services/translation/uiStrings';
import { ZH_STRINGS } from '@/services/translation/zh';
import {
  PUSH_TEMPLATES,
  PUSH_TITLE,
  pushBody,
  // @ts-expect-error: plain JS Lambda source, deliberately imported for parity rather than copied.
} from '../../../../infrastructure/lambda/flight-status/copy.mjs';
import { cancelSentence, changeSentence } from '../copy';

type Lang = 'en' | 'zh';
const tables = PUSH_TEMPLATES as Record<Lang, Record<string, string>>;
const body = pushBody as (lang: Lang, change: object) => string;
const CLIENT: Record<Lang, (k: UIStringKey) => string> = {
  en: (k) => UI_STRINGS[k],
  zh: (k) => ZH_STRINGS[k],
};

/** Up to and including the first sentence stop ("." before a space, or "。"). */
function firstSentence(s: string): string {
  const m = /^.*?(?:\.(?=\s)|。)/.exec(s);
  return m ? m[0] : s;
}

const CANCEL_KEYS = ['flightChecks.cancel.airline', 'flightChecks.cancel.noAirline'];

describe('the server templates are the client strings', () => {
  it('the title is the brand', () => {
    expect(PUSH_TITLE).toBe('beanies.family');
  });

  it.each(['en', 'zh'] as const)('%s: every template matches its client key', (lang) => {
    for (const [key, template] of Object.entries(tables[lang])) {
      const client = CLIENT[lang](key as UIStringKey);
      expect(client, key).toBeTypeOf('string');
      const want = CANCEL_KEYS.includes(key) ? firstSentence(client) : client;
      expect(template, `${lang} ${key}`).toBe(want);
    }
  });

  it('both languages carry the same keys', () => {
    expect(Object.keys(tables.zh).sort()).toEqual(Object.keys(tables.en).sort());
  });
});

interface ChangeCase {
  name: string;
  now: ScheduleTuple;
  /** The client's `liveWas` (the moved fields' old values). */
  was: ScheduleTuple;
}

const NOW: ScheduleTuple = {
  departureDate: '2026-12-13',
  departureTime: '08:30',
  terminal: '3',
  arrivalDate: '2026-12-13',
  arrivalTime: '15:10',
};

const CHANGES: ChangeCase[] = [
  { name: 'time and terminal', now: NOW, was: { departureTime: '06:50', terminal: '2' } },
  {
    name: 'time only, no terminal',
    now: { ...NOW, terminal: undefined },
    was: { departureTime: '06:50' },
  },
  {
    name: 'date and time, with terminal',
    now: { ...NOW, departureDate: '2026-12-14', terminal: 'T3' },
    was: { departureDate: '2026-12-13', departureTime: '06:50' },
  },
  {
    name: 'date, no terminal',
    now: { ...NOW, departureDate: '2026-12-14', terminal: undefined },
    was: { departureDate: '2026-12-13' },
  },
  { name: 'terminal only', now: { ...NOW, terminal: 'Terminal 3' }, was: { terminal: '2' } },
  { name: 'arrival time only', now: NOW, was: { arrivalTime: '14:00' } },
  {
    name: 'arrival date',
    now: { ...NOW, arrivalDate: '2026-12-14' },
    was: { arrivalDate: '2026-12-13' },
  },
  { name: 'on the hour', now: { ...NOW, departureTime: '17:00' }, was: { departureTime: '16:00' } },
];

/** The server's `was` marks a field the device did not know as ''; the branch reads presence. */
const serverWas = (was: ScheduleTuple) =>
  Object.fromEntries(Object.entries(was).map(([k, v]) => [k, v ?? '']));

describe('a change push says the client sentence', () => {
  for (const lang of ['en', 'zh'] as const) {
    it.each(CHANGES.map((c) => [c.name, c]))(`${lang}: %s`, (_name, c) => {
      const server = body(lang, {
        flight: 'SQ318',
        date: c.now.departureDate,
        cancelled: false,
        now: c.now,
        was: serverWas(c.was),
      });
      expect(server).toBe(changeSentence(CLIENT[lang], 'SQ318', c.now, c.was, lang, false));
    });
  }

  it('a field the device did not know (server `was` = "") reads the same branch', () => {
    const server = body('en', {
      flight: 'SQ318',
      date: '2026-12-13',
      cancelled: false,
      now: NOW,
      was: { departureTime: '06:50', terminal: '' },
    });
    expect(server).toBe(
      changeSentence(
        CLIENT.en,
        'SQ318',
        NOW,
        { departureTime: '06:50', terminal: '2' },
        'en',
        false
      )
    );
  });
});

describe('a cancel push says the client sentence (its first sentence)', () => {
  for (const lang of ['en', 'zh'] as const) {
    it(`${lang}: with and without the airline's name`, () => {
      for (const airline of ['Singapore Airlines', undefined]) {
        const server = body(lang, {
          flight: 'SQ318',
          date: '2026-12-13',
          cancelled: true,
          airline,
          now: NOW,
          was: {},
        });
        const client = cancelSentence(
          CLIENT[lang],
          { airline, flight: 'SQ318', date: '2026-12-13' },
          lang
        );
        expect(server).toBe(firstSentence(client));
      }
    });
  }
});
