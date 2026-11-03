/**
 * The time picker's inside. What it must guarantee:
 *   - an hour tap emits NOTHING and lights the hour; a minute finishes with the lit hour (else
 *     the value's hour, else 9),
 *   - Done carries a typed time, else the lit hour, else null; nothing else writes,
 *   - Night row and 5-minute steps on demand, an off-grid minute as one extra selected chip,
 *   - typing previews before Enter; a string that does not parse shows the hint and logs,
 *   - rows appear only when their props are given; only the exact-length duration is selected,
 *   - a malformed value renders as empty and warns `bad_value` on mount and on change.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount, type VueWrapper } from '@vue/test-utils';
import { nextTick } from 'vue';

const hoisted = vi.hoisted(() => ({ logEvent: vi.fn() }));
vi.mock('@/services/telemetry/logEvent', () => ({
  logEvent: (...a: unknown[]) => hoisted.logEvent(...a),
}));
vi.mock('@/composables/useTranslation', () => {
  const en: Record<string, string> = {
    'time.enterSets': 'Enter sets {time}',
    'time.until': 'until {time}',
    'time.typeHint': 'Try 415p, 4:15pm or 1615',
  };
  return { useTranslation: () => ({ t: (k: string) => en[k] ?? k }) };
});

import TimePickerPanel from '../TimePickerPanel.vue';

type Props = InstanceType<typeof TimePickerPanel>['$props'];
let wrapper: VueWrapper | null = null;

function mountPanel(props: Partial<Props> = {}) {
  wrapper = mount(TimePickerPanel, {
    attachTo: document.body,
    props: { value: '', ...props } as Props,
  });
  return wrapper;
}

const hour = (w: VueWrapper, h: number) => w.find(`[data-hour="${h}"]`);
const minute = (w: VueWrapper, m: number) => w.find(`[data-minute="${m}"]`);
const minuteValues = (w: VueWrapper) =>
  w.findAll('[data-minute]').map((b) => Number(b.attributes('data-minute')));
const logged = (action: string) =>
  hoisted.logEvent.mock.calls
    .map(([e]) => e as { level: string; context: { action: string; kind?: string } })
    .filter((e) => e.context.action === action);

beforeEach(() => hoisted.logEvent.mockReset());
afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
});

describe('TimePickerPanel: hours and minutes', () => {
  it('suggests the current value in Sky Silk, and turns a tapped hour orange, emitting nothing', async () => {
    const w = mountPanel({ value: '09:00' });
    // On open nothing is orange: the current hour and minute are only suggested.
    expect(hour(w, 9).attributes('data-state')).toBe('suggested');
    expect(minute(w, 0).attributes('data-state')).toBe('suggested');
    expect(w.findAll('[data-state="picked"]')).toHaveLength(0);
    await hour(w, 16).trigger('click');
    expect(hour(w, 16).attributes('data-state')).toBe('picked');
    expect(hour(w, 16).attributes('aria-pressed')).toBe('true');
    expect(hour(w, 9).attributes('data-state')).toBe('rest');
    // The minute Done would use stays suggested beside the orange hour.
    expect(minute(w, 0).attributes('data-state')).toBe('suggested');
    expect(w.emitted()).not.toHaveProperty('commit');
    expect(w.emitted()).not.toHaveProperty('done');
    expect(logged('time_set')).toHaveLength(0);
  });

  it('a minute finishes with the lit hour, and logs the write', async () => {
    const w = mountPanel({ value: '09:00' });
    await hour(w, 16).trigger('click');
    await minute(w, 15).trigger('click');
    expect(w.emitted('commit')).toEqual([['16:15', 'minute']]);
    expect(logged('time_set')[0]).toMatchObject({
      level: 'debug',
      context: { action: 'time_set', kind: 'minute' },
    });
  });

  it("a minute uses the value's hour with no lit hour, and 9 with no value", async () => {
    const set = mountPanel({ value: '14:00' });
    await minute(set, 30).trigger('click');
    expect(set.emitted('commit')).toEqual([['14:30', 'minute']]);
    set.unmount();
    const empty = mountPanel({ value: '' });
    await minute(empty, 45).trigger('click');
    expect(empty.emitted('commit')).toEqual([['09:45', 'minute']]);
  });

  it("labels hours 12-hour, with an am/pm accessible name, and suggests the value's minute", () => {
    const w = mountPanel({ value: '16:15' });
    expect(hour(w, 16).text()).toBe('4');
    expect(hour(w, 16).attributes('aria-label')).toBe('4pm');
    expect(hour(w, 12).text()).toBe('12');
    expect(minute(w, 15).attributes('data-state')).toBe('suggested');
    expect(minute(w, 15).attributes('aria-pressed')).toBe('false');
    expect(minute(w, 15).text()).toBe(':15');
  });
});

describe('TimePickerPanel: end-step minute with no value', () => {
  it('uses the hour after durationsFrom, never an end before the start', async () => {
    const w = mountPanel({ value: '', durationsFrom: '16:00' });
    await minute(w, 30).trigger('click');
    expect(w.emitted('commit')).toEqual([['17:30', 'minute']]);
  });
});

describe('TimePickerPanel: Done', () => {
  it('carries the lit hour with the value minute', async () => {
    const w = mountPanel({ value: '09:30' });
    await hour(w, 18).trigger('click');
    await w.find('[data-testid="time-picker-done"]').trigger('click');
    expect(w.emitted('done')).toEqual([['18:30']]);
    expect(logged('time_set')[0]!.context.kind).toBe('hour');
  });

  it('carries the lit hour at :00 with no value', async () => {
    const w = mountPanel({ value: '' });
    await hour(w, 7).trigger('click');
    await w.find('[data-testid="time-picker-done"]').trigger('click');
    expect(w.emitted('done')).toEqual([['07:00']]);
  });

  it('carries null when nothing was picked, and logs no write', async () => {
    const w = mountPanel({ value: '09:30' });
    await w.find('[data-testid="time-picker-done"]').trigger('click');
    expect(w.emitted('done')).toEqual([[null]]);
    expect(logged('time_set')).toHaveLength(0);
  });

  it('carries null and logs nothing when the lit hour gives back the current value', async () => {
    const w = mountPanel({ value: '09:00' });
    await hour(w, 9).trigger('click');
    await w.find('[data-testid="time-picker-done"]').trigger('click');
    expect(w.emitted('done')).toEqual([[null]]);
    expect(logged('time_set')).toHaveLength(0);
  });

  it('carries a typed time that parses, ahead of a lit hour', async () => {
    const w = mountPanel({ value: '09:30' });
    await hour(w, 18).trigger('click');
    await w.find('[data-testid="time-picker-typed"]').setValue('415p');
    await w.find('[data-testid="time-picker-done"]').trigger('click');
    expect(w.emitted('done')).toEqual([['16:15']]);
  });
});

describe('TimePickerPanel: night, fine steps, off-grid', () => {
  it('hides the Night row until the link is tapped, then hides the link', async () => {
    const w = mountPanel({ value: '09:00' });
    expect(hour(w, 3).exists()).toBe(false);
    const link = w.findAll('button').find((b) => b.text() === 'time.nightHours')!;
    await link.trigger('click');
    expect(hour(w, 3).exists()).toBe(true);
    expect(w.findAll('button').some((b) => b.text() === 'time.nightHours')).toBe(false);
  });

  it('shows the Night row for a value before 6 AM', () => {
    const w = mountPanel({ value: '04:30' });
    expect(hour(w, 4).attributes('data-state')).toBe('suggested');
  });

  it('switches to twelve 5-minute chips', async () => {
    const w = mountPanel({ value: '09:00' });
    expect(minuteValues(w)).toEqual([0, 15, 30, 45]);
    await w
      .findAll('button')
      .find((b) => b.text() === 'time.fiveMinuteSteps')!
      .trigger('click');
    expect(minuteValues(w)).toEqual([0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55]);
  });

  it('adds one selected chip for a minute off the grid', async () => {
    const w = mountPanel({ value: '10:52' });
    expect(minuteValues(w)).toEqual([0, 15, 30, 45, 52]);
    expect(minute(w, 52).attributes('data-state')).toBe('suggested');
    await w
      .findAll('button')
      .find((b) => b.text() === 'time.fiveMinuteSteps')!
      .trigger('click');
    expect(minuteValues(w)).toHaveLength(13);
  });
});

describe('TimePickerPanel: typing', () => {
  it('previews the parsed time and commits it on Enter', async () => {
    const w = mountPanel({ value: '' });
    const input = w.find('[data-testid="time-picker-typed"]');
    await input.setValue('415p');
    expect(w.find('[data-testid="time-picker-preview"]').text()).toBe('Enter sets 4:15pm');
    await input.trigger('keydown', { key: 'Enter' });
    expect(w.emitted('commit')).toEqual([['16:15', 'typed']]);
  });

  it('shows no preview for a string that does not parse', async () => {
    const w = mountPanel({ value: '' });
    await w.find('[data-testid="time-picker-typed"]').setValue('99');
    expect(w.find('[data-testid="time-picker-preview"]').text()).toBe('');
  });

  it('on Enter with a string that does not parse: commits nothing, hints, logs once', async () => {
    const w = mountPanel({ value: '' });
    const input = w.find('[data-testid="time-picker-typed"]');
    await input.setValue('99');
    await input.trigger('keydown', { key: 'Enter' });
    expect(w.emitted()).not.toHaveProperty('commit');
    expect(w.find('[data-testid="time-picker-preview"]').text()).toBe('Try 415p, 4:15pm or 1615');
    expect(logged('typed_rejected')).toHaveLength(1);
    expect(logged('typed_rejected')[0]!.context).toEqual({ action: 'typed_rejected' });
    await input.setValue('9');
    expect(w.find('[data-testid="time-picker-preview"]').text()).toBe('Enter sets 9am');
  });

  it('ignores Enter in an empty box', async () => {
    const w = mountPanel({ value: '' });
    await w.find('[data-testid="time-picker-typed"]').trigger('keydown', { key: 'Enter' });
    expect(w.emitted()).not.toHaveProperty('commit');
    expect(logged('typed_rejected')).toHaveLength(0);
  });

  it('focuses the type box on mount only when asked', async () => {
    const w = mountPanel({ value: '', autofocusTyped: true });
    await nextTick();
    expect(document.activeElement).toBe(w.find('[data-testid="time-picker-typed"]').element);
    w.unmount();
    const other = mountPanel({ value: '' });
    await nextTick();
    expect(document.activeElement).not.toBe(
      other.find('[data-testid="time-picker-typed"]').element
    );
  });
});

describe('TimePickerPanel: optional rows and footer', () => {
  it('shows no Lasts, Recent, back link, Clear or All day by default', () => {
    const w = mountPanel({ value: '09:00' });
    expect(w.find('[data-testid="time-picker-durations"]').exists()).toBe(false);
    expect(w.find('[data-testid="time-picker-recent"]').exists()).toBe(false);
    expect(w.find('[data-testid="time-picker-back"]').exists()).toBe(false);
    expect(w.find('[data-testid="time-picker-panel-clear"]').exists()).toBe(false);
    expect(w.find('[data-testid="time-picker-all-day"]').exists()).toBe(false);
  });

  it('Recent: a chip per time, none pre-selected even when one matches, a tap finishes', async () => {
    const w = mountPanel({ value: '16:15', recent: ['07:30', '16:15'] });
    const chips = w.find('[data-testid="time-picker-recent"]').findAll('button');
    expect(chips.map((c) => c.text())).toEqual(['7:30am', '4:15pm']);
    expect(chips.filter((c) => c.attributes('aria-pressed') === 'true')).toHaveLength(0);
    await chips[0]!.trigger('click');
    expect(w.emitted('commit')).toEqual([['07:30', 'recent']]);
  });

  it('Lasts: six chips counted from durationsFrom, only the exact length suggested', async () => {
    const w = mountPanel({ value: '17:45', durationsFrom: '16:15' });
    const chips = w.find('[data-testid="time-picker-durations"]').findAll('button');
    expect(chips).toHaveLength(6);
    expect(chips[3]!.text()).toContain('until 5:45pm');
    const suggested = chips.filter((c) => c.attributes('data-state') === 'suggested');
    expect(suggested.map((c) => c.attributes('data-duration'))).toEqual(['90']);
    expect(chips.filter((c) => c.attributes('aria-pressed') === 'true')).toHaveLength(0);
    await chips[4]!.trigger('click');
    expect(w.emitted('commit')).toEqual([['18:15', 'duration']]);
  });

  it('Lasts: chips capped at 11:59pm never light, since none has that exact length', () => {
    const w = mountPanel({ value: '23:59', durationsFrom: '22:00' });
    const chips = w.find('[data-testid="time-picker-durations"]').findAll('button');
    expect(chips[5]!.text()).toContain('until 11:59pm');
    expect(chips.filter((c) => c.attributes('data-state') !== 'rest')).toHaveLength(0);
  });

  it('Lasts: hidden for an empty start', () => {
    const w = mountPanel({ value: '', durationsFrom: '' });
    expect(w.find('[data-testid="time-picker-durations"]').exists()).toBe(false);
  });

  it('emits back, clear and all-day from their controls', async () => {
    const w = mountPanel({
      value: '10:00',
      backLabel: 'Start 9am',
      clearable: true,
      allDayAffordance: true,
    });
    expect(w.find('[data-testid="time-picker-back"]').text()).toContain('Start 9am');
    await w.find('[data-testid="time-picker-back"]').trigger('click');
    await w.find('[data-testid="time-picker-panel-clear"]').trigger('click');
    await w.find('[data-testid="time-picker-all-day"]').trigger('click');
    expect(w.emitted('back')).toHaveLength(1);
    expect(w.emitted('clear')).toHaveLength(1);
    expect(w.emitted('all-day')).toHaveLength(1);
    expect(logged('time_set').map((e) => e.context.kind)).toEqual(['clear']);
  });

  it('offers Clear only while a value is set', () => {
    const w = mountPanel({ value: '', clearable: true });
    expect(w.find('[data-testid="time-picker-panel-clear"]').exists()).toBe(false);
  });
});

describe('TimePickerPanel: malformed value', () => {
  it('renders as empty and warns bad_value on mount and on each change to a bad value', async () => {
    const w = mountPanel({ value: '9:00' });
    expect(w.findAll('[aria-pressed="true"]')).toHaveLength(0);
    expect(logged('bad_value')).toHaveLength(1);
    expect(logged('bad_value')[0]).toMatchObject({
      level: 'warn',
      surface: 'time-picker',
      context: { action: 'bad_value' },
    });
    await w.setProps({ value: '10:00' });
    expect(logged('bad_value')).toHaveLength(1);
    await w.setProps({ value: 'NaN:NaN' });
    expect(logged('bad_value')).toHaveLength(2);
  });

  it('does not warn for an empty value', () => {
    mountPanel({ value: '' });
    expect(logged('bad_value')).toHaveLength(0);
  });
});

describe('TimePickerPanel: holdPicks (the range)', () => {
  const done = (w: VueWrapper) => w.find('[data-testid="time-picker-done"]');
  const next = (w: VueWrapper) => w.find('[data-testid="time-picker-next"]');

  it('a minute tap only updates the draft, turning orange beside the orange hour', async () => {
    const w = mountPanel({ value: '09:00', holdPicks: true });
    await hour(w, 16).trigger('click');
    await minute(w, 15).trigger('click');
    expect(w.emitted()).not.toHaveProperty('commit');
    expect(hour(w, 16).attributes('data-state')).toBe('picked');
    expect(minute(w, 15).attributes('data-state')).toBe('picked');
    await done(w).trigger('click');
    expect(w.emitted('done')).toEqual([['16:15']]);
    expect(logged('time_set')[0]!.context.kind).toBe('minute');
  });

  it('a recent tap is orange, its hour and minute only suggested, and Done writes it', async () => {
    const w = mountPanel({ value: '09:00', holdPicks: true, recent: ['16:15'] });
    const chip = w.find('[data-recent="16:15"] button');
    await chip.trigger('click');
    expect(chip.attributes('aria-pressed')).toBe('true');
    expect(hour(w, 16).attributes('data-state')).toBe('suggested');
    expect(minute(w, 15).attributes('data-state')).toBe('suggested');
    expect(w.emitted()).not.toHaveProperty('commit');
    await done(w).trigger('click');
    expect(w.emitted('done')).toEqual([['16:15']]);
  });

  it('an hour tap after a recent keeps its minute and drops the recent highlight', async () => {
    const w = mountPanel({ value: '09:00', holdPicks: true, recent: ['16:15'] });
    await w.find('[data-recent="16:15"] button').trigger('click');
    await hour(w, 18).trigger('click');
    expect(w.find('[data-recent="16:15"] button').attributes('aria-pressed')).toBe('false');
    await done(w).trigger('click');
    expect(w.emitted('done')).toEqual([['18:15']]);
  });

  it('a duration tap is orange and Done writes its end', async () => {
    const w = mountPanel({ value: '17:15', holdPicks: true, durationsFrom: '16:15' });
    const ninety = w.find('[data-duration="90"]');
    await ninety.trigger('click');
    expect(ninety.attributes('data-state')).toBe('picked');
    expect(w.find('[data-duration="60"]').attributes('data-state')).toBe('rest');
    await done(w).trigger('click');
    expect(w.emitted('done')).toEqual([['17:45']]);
  });

  it('Enter on a typed time fills the draft and waits', async () => {
    const w = mountPanel({ value: '09:00', holdPicks: true });
    const box = w.find('[data-testid="time-picker-typed"]');
    await box.setValue('415p');
    await box.trigger('keydown', { key: 'Enter' });
    expect(w.emitted()).not.toHaveProperty('commit');
    expect(hour(w, 16).attributes('data-state')).toBe('suggested');
    await done(w).trigger('click');
    expect(w.emitted('done')).toEqual([['16:15']]);
  });

  it('nextLabel adds a primary next button carrying the draft; Done stays', async () => {
    const w = mountPanel({ value: '09:00', holdPicks: true, nextLabel: 'End Time' });
    expect(next(w).text()).toContain('End Time');
    expect(done(w).exists()).toBe(true);
    await hour(w, 16).trigger('click');
    await next(w).trigger('click');
    expect(w.emitted('next')).toEqual([['16:00']]);
  });

  it('next with nothing picked carries null', async () => {
    const w = mountPanel({ value: '09:00', holdPicks: true, nextLabel: 'End Time' });
    await next(w).trigger('click');
    expect(w.emitted('next')).toEqual([[null]]);
  });
});
