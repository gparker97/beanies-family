/**
 * Occasion mode in the activity drawer (#137): the defaults an occasion implies are applied
 * once, only over fresh-form values, and only when creating; the "set for Occasions" notes
 * follow the field's value; the title matcher runs on commit only; a past-year anchor date is
 * moved into the year field in either order, once, and never for a one-off or a date the form
 * merely opened on; the year preview and the "big one" note follow the type's rules.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { effectScope, nextTick, ref, type EffectScope } from 'vue';
import type { ActivityCategory, ReminderMinutes } from '@/types/models';
import type { RecurrenceRule } from '@/types/recurrence';

const settings = { activityReminderLead: 30 as ReminderMinutes };
vi.mock('@/stores/settingsStore', () => ({ useSettingsStore: () => settings }));

const STRINGS: Record<string, string> = {
  'planner.occasion.setFor': 'Set for Occasions',
  'planner.occasion.yearPreview': '{milestone} on {date}',
  'planner.occasion.milestone.turns': 'turns {n}',
  'planner.occasion.milestone.anniversary': '{ordinal} anniversary',
  'planner.occasion.milestone.years.one': '{n} year',
  'planner.occasion.milestone.years.other': '{n} years',
  'planner.occasion.dateMoved.withYear': 'Moved {year}.',
  'planner.occasion.dateMoved.dateOnly': 'Moved the date.',
};
vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (k: string) => STRINGS[k] ?? k }),
}));

const reveal = vi.fn();
vi.mock('@/composables/useAttentionPulse', () => ({
  useAttentionPulse: () => ({ pulse: vi.fn(), reveal }),
}));

const logEvent = vi.fn();
vi.mock('@/services/telemetry/logEvent', () => ({
  logEvent: (...a: unknown[]) => logEvent(...a),
}));

import { useOccasionForm, type OccasionAutoField } from '@/composables/useOccasionForm';

const TODAY = '2026-11-01';

let scope: EffectScope;

function setup(overrides: { isCreate?: boolean; author?: string | undefined } = {}) {
  const refs = {
    category: ref('' as ActivityCategory),
    title: ref(''),
    date: ref(TODAY),
    mode: ref<'one-off' | 'recurring'>('one-off'),
    rule: ref<RecurrenceRule | null>(null),
    isAllDay: ref(false),
    reminderMinutes: ref<ReminderMinutes>(0),
    assigneeIds: ref<string[]>([]),
    occasionYear: ref<number | undefined>(undefined),
    seriesAnchorReady: ref(true),
  };
  const isCreate = ref(overrides.isCreate ?? true);
  const author = 'author' in overrides ? overrides.author : 'm-author';
  const els = new Map<OccasionAutoField, HTMLElement>();
  const form = scope.run(() =>
    useOccasionForm({
      ...refs,
      isCreate: () => isCreate.value,
      authorId: () => author,
      fieldEl: (f) => {
        if (!els.has(f)) els.set(f, document.createElement('div'));
        return els.get(f);
      },
      today: () => TODAY,
    })
  )!;
  form.reset(refs.date.value);
  return { ...refs, form, isCreate, els };
}

function messages(): string[] {
  return logEvent.mock.calls.map((c) => (c[0] as { message: string }).message);
}

beforeEach(() => {
  scope = effectScope();
  settings.activityReminderLead = 30;
  reveal.mockClear();
  logEvent.mockClear();
});
afterEach(() => scope.stop());

describe('useOccasionForm: defaults', () => {
  it('⭐ picking an occasion on a fresh form sets yearly, all-day, a reminder and the creator', async () => {
    const s = setup();
    await s.form.onCategoryPicked('occasion_birthday');
    expect(s.category.value).toBe('occasion_birthday');
    expect(s.mode.value).toBe('recurring');
    expect(s.rule.value).toEqual({ unit: 'year', interval: 1, end: { kind: 'never' } });
    expect(s.isAllDay.value).toBe(true);
    expect(s.reminderMinutes.value).toBe(30);
    expect(s.assigneeIds.value).toEqual(['m-author']);
    expect(logEvent).toHaveBeenCalledWith({
      level: 'info',
      surface: 'occasions',
      message: 'defaults applied',
      context: { kind: 'occasion_birthday', action: 'category-pick', count: 4 },
    });
    // One reveal of every written field in drawer order (scrolls to the schedule first),
    // after the tick that mounts the schedule group, with the outside halo.
    const fields = ['schedule', 'allDay', 'reminder', 'people'] as const;
    expect(reveal).toHaveBeenCalledTimes(1);
    expect(reveal).toHaveBeenCalledWith(
      fields.map((f) => s.els.get(f)),
      'attention-halo'
    );
    for (const f of fields) expect(s.form.autoSetHint(f)).toBe('Set for Occasions');
  });

  it('⭐ never overwrites a field the person already set', async () => {
    const s = setup();
    const weekly: RecurrenceRule = {
      unit: 'week',
      interval: 1,
      weekdays: [1],
      end: { kind: 'never' },
    };
    s.mode.value = 'recurring';
    s.rule.value = weekly;
    s.isAllDay.value = true;
    s.reminderMinutes.value = 15;
    s.assigneeIds.value = ['m-kid'];
    await s.form.onCategoryPicked('anniversary');
    expect(s.rule.value).toEqual(weekly);
    expect(s.reminderMinutes.value).toBe(15);
    expect(s.assigneeIds.value).toEqual(['m-kid']);
    expect(reveal).not.toHaveBeenCalled();
    expect(s.form.autoSetHint('allDay')).toBeUndefined();
    expect(logEvent.mock.calls[0]![0].context).toMatchObject({ count: 0 });
  });

  it('a recurring-then-one-off form keeps its one-off: the rule is no longer fresh', async () => {
    const s = setup();
    s.rule.value = { unit: 'week', interval: 1, weekdays: [1], end: { kind: 'never' } };
    await s.form.onCategoryPicked('remembrance');
    expect(s.mode.value).toBe('one-off');
  });

  it('⭐ runs once per drawer session, and again after reset', async () => {
    const s = setup();
    await s.form.onCategoryPicked('occasion_birthday');
    s.isAllDay.value = false; // the person unticks all-day
    await s.form.onCategoryPicked('birthday'); // Party
    await s.form.onCategoryPicked('remembrance'); // back into Occasions
    expect(s.isAllDay.value).toBe(false);
    expect(messages().filter((m) => m === 'defaults applied')).toHaveLength(1);

    s.form.reset(TODAY);
    await s.form.onCategoryPicked('remembrance');
    expect(s.isAllDay.value).toBe(true);
  });

  it('⭐ a family reminder lead of None still gives the occasion a reminder', async () => {
    settings.activityReminderLead = 0 as ReminderMinutes;
    const s = setup();
    await s.form.onCategoryPicked('occasion_birthday');
    expect(s.reminderMinutes.value).toBe(30); // DEFAULT_ACTIVITY_LEAD

    settings.activityReminderLead = 60 as ReminderMinutes;
    const t = setup();
    await t.form.onCategoryPicked('occasion_birthday');
    expect(t.reminderMinutes.value).toBe(60);
  });

  it('⭐ never applies when editing', async () => {
    const s = setup({ isCreate: false });
    await s.form.onCategoryPicked('occasion_birthday');
    expect(s.category.value).toBe('occasion_birthday');
    expect(s.mode.value).toBe('one-off');
    expect(s.isAllDay.value).toBe(false);
    expect(logEvent).not.toHaveBeenCalled();
  });

  it('a non-occasion pick applies nothing', async () => {
    const s = setup();
    await s.form.onCategoryPicked('swimming');
    expect(s.mode.value).toBe('one-off');
    expect(logEvent).not.toHaveBeenCalled();
  });

  it('with no author the rememberers stay empty (all adults) and a warning is logged', async () => {
    const s = setup({ author: undefined });
    await s.form.onCategoryPicked('occasion_birthday');
    expect(s.assigneeIds.value).toEqual([]);
    expect(logEvent).toHaveBeenCalledWith(
      expect.objectContaining({ level: 'warn', message: 'no author for default rememberer' })
    );
    expect(s.form.autoSetHint('people')).toBeUndefined();
  });
});

describe('useOccasionForm: "set for Occasions" notes', () => {
  it('⭐ a note disappears once its field is changed by hand, and reset clears them', async () => {
    const s = setup();
    await s.form.onCategoryPicked('occasion_birthday');
    s.reminderMinutes.value = 60;
    expect(s.form.autoSetHint('reminder')).toBeUndefined();
    s.assigneeIds.value = ['m-author', 'm-kid'];
    expect(s.form.autoSetHint('people')).toBeUndefined();
    s.rule.value = {
      unit: 'month',
      interval: 1,
      monthlyAnchor: 'date',
      monthlyDay: 1,
      end: { kind: 'never' },
    };
    expect(s.form.autoSetHint('schedule')).toBeUndefined();
    // Untouched fields keep theirs.
    expect(s.form.autoSetHint('allDay')).toBe('Set for Occasions');

    s.form.reset(TODAY);
    expect(s.form.autoSetHint('allDay')).toBeUndefined();
  });

  it('an equivalent rule handed back by the picker keeps the schedule note', async () => {
    const s = setup();
    await s.form.onCategoryPicked('occasion_birthday');
    s.rule.value = { end: { kind: 'never' }, interval: 1, unit: 'year' };
    expect(s.form.autoSetHint('schedule')).toBe('Set for Occasions');
  });

  it('notes hide outside occasion mode', async () => {
    const s = setup();
    await s.form.onCategoryPicked('occasion_birthday');
    await s.form.onCategoryPicked('birthday');
    expect(s.form.autoSetHint('allDay')).toBeUndefined();
  });
});

describe('useOccasionForm: title matcher', () => {
  it('⭐ a committed title files itself under the matching occasion', async () => {
    const s = setup();
    s.title.value = "Uncle Bob's birthday";
    await nextTick();
    expect(s.category.value).toBe(''); // typing alone never matches
    await s.form.onTitleCommit();
    expect(s.category.value).toBe('occasion_birthday');
    expect(s.isAllDay.value).toBe(true);
    expect(logEvent.mock.calls[0]![0].context).toMatchObject({ action: 'title-match' });
  });

  it('⭐ "Birthday party" is not an occasion', async () => {
    const s = setup();
    s.title.value = 'Birthday party';
    await s.form.onTitleCommit();
    expect(s.category.value).toBe('');
  });

  it('never overrides a picked category, never runs on an edit', async () => {
    const s = setup();
    s.category.value = 'swimming';
    s.title.value = 'Swim club anniversary';
    await s.form.onTitleCommit();
    expect(s.category.value).toBe('swimming');

    const e = setup({ isCreate: false });
    e.title.value = "Grandma's birthday";
    await e.form.onTitleCommit();
    expect(e.category.value).toBe('');
  });
});

describe('useOccasionForm: past-year anchor date', () => {
  it('⭐ category then date: 7 Nov 1966 becomes the year, the date the next one', async () => {
    const s = setup();
    await s.form.onCategoryPicked('occasion_birthday');
    s.date.value = '1966-11-07';
    await nextTick();
    expect(s.date.value).toBe('2026-11-07');
    expect(s.occasionYear.value).toBe(1966);
    expect(s.form.dateMovedCaption.value).toBe('Moved 1966.');
    expect(messages()).toContain('year moved from date');
  });

  it('⭐ date then category normalises too', async () => {
    const s = setup();
    s.date.value = '1966-03-02';
    await nextTick();
    expect(s.date.value).toBe('1966-03-02'); // no category yet
    await s.form.onCategoryPicked('anniversary');
    await nextTick();
    expect(s.date.value).toBe('2027-03-02'); // this year's has passed
    expect(s.occasionYear.value).toBe(1966);
  });

  it('⭐ a one-off occasion is left alone', async () => {
    const s = setup();
    await s.form.onCategoryPicked('occasion_birthday');
    s.mode.value = 'one-off';
    s.date.value = '1966-11-07';
    await nextTick();
    expect(s.date.value).toBe('1966-11-07');
    expect(s.occasionYear.value).toBeUndefined();
  });

  it('⭐ a typed year is never overwritten by the date', async () => {
    const s = setup();
    await s.form.onCategoryPicked('occasion_birthday');
    s.occasionYear.value = 1970;
    s.date.value = '1966-11-07';
    await nextTick();
    expect(s.date.value).toBe('2026-11-07');
    expect(s.occasionYear.value).toBe(1970);
    expect(s.form.dateMovedCaption.value).toBe('Moved the date.');
  });

  it('⭐ a past-year date the form opened on moves the date, never into the year', async () => {
    const s = setup();
    s.date.value = '2025-03-01';
    s.form.reset('2025-03-01'); // the calendar click onNew seeded
    await nextTick();
    await s.form.onCategoryPicked('occasion_birthday');
    await nextTick();
    expect(s.date.value).toBe('2027-03-01');
    expect(s.occasionYear.value).toBeUndefined();
    expect(messages()).not.toContain('year moved from date');
  });

  it('⭐ 29 Feb 1964 anchors on the latest leap day, once', async () => {
    const s = setup();
    await s.form.onCategoryPicked('occasion_birthday');
    s.date.value = '1964-02-29';
    await nextTick();
    await nextTick();
    expect(s.date.value).toBe('2024-02-29');
    expect(s.occasionYear.value).toBe(1964);
    expect(messages().filter((m) => m === 'year moved from date')).toHaveLength(1);
  });

  it('⭐ picking the latest leap day itself still moves its year', async () => {
    const s = setup();
    await s.form.onCategoryPicked('occasion_birthday');
    s.date.value = '2024-02-29';
    await nextTick();
    await nextTick();
    expect(s.date.value).toBe('2024-02-29');
    expect(s.occasionYear.value).toBe(2024);
    expect(messages().filter((m) => m === 'year moved from date')).toHaveLength(1);
  });

  it('never normalises an edit, or before the drawer is seeded', async () => {
    const e = setup({ isCreate: false });
    e.category.value = 'occasion_birthday';
    e.mode.value = 'recurring';
    e.rule.value = { unit: 'year', interval: 1, end: { kind: 'never' } };
    e.date.value = '1966-11-07';
    await nextTick();
    expect(e.date.value).toBe('1966-11-07');

    const s = setup();
    s.seriesAnchorReady.value = false;
    await s.form.onCategoryPicked('occasion_birthday');
    s.date.value = '1966-11-07';
    await nextTick();
    expect(s.date.value).toBe('1966-11-07');
  });
});

describe('useOccasionForm: year', () => {
  async function birthday(
    year: number | undefined,
    category: ActivityCategory = 'occasion_birthday'
  ) {
    const s = setup();
    await s.form.onCategoryPicked(category);
    s.date.value = '2026-11-07';
    s.occasionYear.value = year;
    await nextTick();
    return s;
  }

  it('⭐ previews the milestone on the next occurrence', async () => {
    const s = await birthday(1966);
    expect(s.form.yearIssue.value).toBe('ok');
    expect(s.form.yearPreview.value).toBe('turns 60 on Sat, 7 Nov');
    expect(s.form.isBigOne.value).toBe(true);
    expect(s.form.payloadYear.value).toBe(1966);
  });

  it('a non-round birthday is not a big one; a remembrance never is', async () => {
    expect((await birthday(1967)).form.isBigOne.value).toBe(false);
    const r = await birthday(1966, 'remembrance');
    expect(r.form.yearPreview.value).toBe('60 years on Sat, 7 Nov');
    expect(r.form.isBigOne.value).toBe(false);
  });

  it('⭐ an invalid year is reported by reason and never reaches the payload', async () => {
    const s = await birthday(2030);
    expect(s.form.yearIssue.value).toBe('future');
    expect(s.form.yearErrorNow.value).toBe(true); // a whole year: flagged before Save
    expect(s.form.yearErrorMessage.value).toBe('planner.occasion.yearError.future');
    expect(s.form.payloadYear.value).toBeUndefined();
    expect(s.form.yearPreview.value).toBeUndefined();
    s.occasionYear.value = 1850;
    expect(s.form.yearIssue.value).toBe('too-early');
    s.occasionYear.value = 196;
    expect(s.form.yearIssue.value).toBe('format');
    expect(s.form.yearErrorNow.value).toBe(false); // still typing
  });

  it('a year outside occasion mode is not saved', async () => {
    const s = await birthday(1966);
    await s.form.onCategoryPicked('birthday');
    expect(s.form.payloadYear.value).toBeUndefined();
    await s.form.onCategoryPicked('occasion_birthday');
    expect(s.form.payloadYear.value).toBe(1966); // kept in the drawer
  });
});
