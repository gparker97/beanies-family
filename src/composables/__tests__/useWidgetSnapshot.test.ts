import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { computed, nextTick, reactive, ref } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import { addDaysYmd } from '@/utils/date';

// `vi.mock` factories are hoisted above the module body, so everything they
// close over must come from `vi.hoisted`.
const { plugin, reportError, logEvent, showToast, reminderInput, today, isVisible, weather } =
  vi.hoisted(() => ({
    plugin: { publish: vi.fn(), clear: vi.fn() },
    reportError: vi.fn(),
    logEvent: vi.fn(),
    showToast: vi.fn(),
    // Filled in `beforeEach` with real Vue refs (vue is not importable inside `vi.hoisted`).
    reminderInput: { current: null as unknown as { value: unknown } },
    today: { current: null as unknown as { value: string } },
    isVisible: { current: null as unknown as { value: boolean } },
    // A fake weather store (`fakeWeatherStore`), rebuilt in `beforeEach`.
    weather: { current: null as unknown as FakeWeatherStore },
  }));

vi.mock('@/services/sync/capabilities', () => ({ isNative: () => true }));
vi.mock('@/services/native/widgetBridgePlugin', () => ({ WidgetBridge: plugin }));
vi.mock('@/utils/errorReporter', () => ({ reportError }));
vi.mock('@/services/telemetry/logEvent', () => ({ logEvent }));
vi.mock('@/composables/useToast', () => ({ showToast }));
vi.mock('@/stores/translationStore', () => ({
  useTranslationStore: () => ({ t: (k: string) => k, currentLanguage: 'en' }),
}));
vi.mock('@/composables/useScheduledReminders', () => ({
  useScheduledReminders: () => ({ reminderInput: reminderInput.current }),
}));
vi.mock('@/composables/useToday', () => ({
  useToday: () => ({ today: today.current, isVisible: isVisible.current }),
}));
vi.mock('@/stores/weatherStore', () => ({ useWeatherStore: () => weather.current }));

import {
  haltWidgetPublishingForSignOut,
  publishWidgetSnapshot,
  useWidgetSnapshot,
  __resetUseWidgetSnapshotForTesting,
} from '../useWidgetSnapshot';
import { UI_STRINGS, type UIStringKey } from '@/services/translation/uiStrings';
import type { WidgetSnapshotInput } from '@/utils/widgetSnapshot';
import type { FamilyMember } from '@/types/models';
import type { ReminderInput } from '@/composables/useScheduledReminders';
import type { WeatherReading } from '@/types/weather';

const TODAY = '2026-10-11';
const t = (key: UIStringKey): string => UI_STRINGS[key];
const SAM = { id: 'sam', name: 'Sam', role: 'owner', ageGroup: 'adult' } as FamilyMember;
const JO = { id: 'jo', name: 'Jo', role: 'member', ageGroup: 'adult' } as FamilyMember;

/**
 * The weather store's surface the publisher may read, plus the two it must NOT: `nowMs`
 * (bumped by every 5-minute tick) and `atom` (whose age text follows it).
 */
interface FakeWeatherStore {
  isActive: boolean;
  reading: WeatherReading | null;
  homeZone: string;
  nowMs: number;
  readonly atom: { ageText: string };
}

function fakeWeatherStore(): FakeWeatherStore {
  const nowMs = ref(0);
  return reactive({
    isActive: false,
    reading: null as WeatherReading | null,
    homeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    nowMs,
    atom: computed(() => ({ ageText: `as of ${nowMs.value}` })),
  });
}

/** A reading with an entry for every day around TODAY, so any test machine's zone finds one. */
function weatherReading(fetchedAt: number): WeatherReading {
  return {
    v: 1,
    familyId: 'fam-123456',
    placeKey: '1.30,103.80|zone',
    fetchedAt,
    current: { tempC: 12.6, code: 2, isDay: true },
    daily: [-1, 0, 1, 2, 3, 4, 5].map((n) => ({
      ymd: addDaysYmd(TODAY, n),
      code: 61,
      maxC: 14,
      minC: 9,
    })),
  };
}

/** The reminders' input, as `useScheduledReminders` would expose it. */
function reminders(member: FamilyMember = SAM): ReminderInput {
  return {
    occurrencesByDate: {},
    travelOccurrences: [],
    todos: [],
    lists: [],
    currentMember: member,
    resolveMember: (id: string) => [SAM, JO].find((m) => m.id === id),
    windowStartISO: TODAY,
    windowEndISO: '2026-10-25',
    t,
  };
}

/** A complete widget input for the exported seam. */
function widgetInput(over: Partial<WidgetSnapshotInput> = {}): WidgetSnapshotInput {
  return {
    ...reminders(),
    today: TODAY,
    days: ['2026-10-11', '2026-10-12'],
    members: [SAM, JO],
    initialsById: new Map(),
    mealsByDate: {},
    recipes: [],
    vacations: [],
    hintTodos: [],
    flags: { mealPlanner: false, helpfulHints: false },
    lockScreenTitles: true,
    language: 'en',
    familyId: 'fam-123456',
    weather: null,
    ...over,
  };
}

/** Telemetry events on the widget surface, by message. */
function events(message: string): Record<string, unknown>[] {
  return logEvent.mock.calls
    .map((c) => c[0] as { surface: string; message: string; context: Record<string, unknown> })
    .filter((e) => e.surface === 'home-widget' && e.message === message)
    .map((e) => e.context);
}

/** The viewer id inside the JSON handed to the plugin on publish `n`. */
function publishedViewer(n: number): string {
  const json = (plugin.publish.mock.calls[n]![0] as { json: string }).json;
  return (JSON.parse(json) as { viewer: { memberId: string } }).viewer.memberId;
}

beforeEach(() => {
  vi.clearAllMocks();
  __resetUseWidgetSnapshotForTesting();
  setActivePinia(createPinia());
  reminderInput.current = ref<ReminderInput | null>(null);
  today.current = ref(TODAY);
  isVisible.current = ref(true);
  weather.current = fakeWeatherStore();
  plugin.publish.mockResolvedValue({ placements: {} });
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('useWidgetSnapshot: the watcher', () => {
  beforeEach(() => vi.useFakeTimers());

  /** Let the debounce fire and the publish settle. */
  async function settle(): Promise<void> {
    await vi.advanceTimersByTimeAsync(1000);
    await nextTick();
  }

  it('publishes nothing while the family is not loaded (null input)', async () => {
    useWidgetSnapshot();
    await settle();
    expect(plugin.publish).not.toHaveBeenCalled();
  });

  it('debounces a burst of changes into one publish', async () => {
    useWidgetSnapshot();
    reminderInput.current.value = reminders();
    await nextTick();
    reminderInput.current.value = reminders();
    await nextTick();
    await vi.advanceTimersByTimeAsync(999);
    expect(plugin.publish).not.toHaveBeenCalled();
    await settle();
    expect(plugin.publish).toHaveBeenCalledTimes(1);
    expect(events('snapshot published')).toEqual([
      {
        kind: 'data-change',
        count: 0,
        action: 'publish',
        detail: expect.stringMatching(/^tasks=0;ahead=0;kb=\d+;wx=0$/),
      },
    ]);
  });

  it('republishes on a return to the foreground', async () => {
    reminderInput.current.value = reminders();
    useWidgetSnapshot();
    await settle();
    isVisible.current.value = false;
    await nextTick();
    isVisible.current.value = true;
    await nextTick();
    await settle();
    expect(plugin.publish).toHaveBeenCalledTimes(2);
    expect(events('snapshot published').map((c) => c.kind)).toEqual(['data-change', 'foreground']);
  });

  it('never republishes on a 5-minute weather tick with an unchanged reading', async () => {
    vi.setSystemTime(new Date(2026, 9, 11, 8, 0));
    weather.current.isActive = true;
    weather.current.reading = weatherReading(Date.now());
    reminderInput.current.value = reminders();
    useWidgetSnapshot();
    await settle();
    expect(plugin.publish).toHaveBeenCalledTimes(1);
    const json = (plugin.publish.mock.calls[0]![0] as { json: string }).json;
    expect(JSON.parse(json).weather.current.temp).toBe('13°');
    expect(events('snapshot published')[0]!.detail).toMatch(/;wx=1$/);

    // The weather store's tick: its clock moves and the atom's age text with it.
    const ageBefore = weather.current.atom.ageText;
    weather.current.nowMs += 5 * 60_000;
    expect(weather.current.atom.ageText).not.toBe(ageBefore);
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    await nextTick();
    expect(plugin.publish).toHaveBeenCalledTimes(1);

    // A new reading is a data change, and does publish.
    weather.current.reading = weatherReading(Date.now());
    await nextTick();
    await settle();
    expect(plugin.publish).toHaveBeenCalledTimes(2);
  });

  it('republishes for the new viewer on a member switch', async () => {
    reminderInput.current.value = reminders(SAM);
    useWidgetSnapshot();
    await settle();
    reminderInput.current.value = reminders(JO);
    await nextTick();
    await settle();
    expect(plugin.publish).toHaveBeenCalledTimes(2);
    expect([publishedViewer(0), publishedViewer(1)]).toEqual(['sam', 'jo']);
  });
});

describe('useWidgetSnapshot: sign-out halt', () => {
  beforeEach(() => vi.useFakeTimers());

  async function settle(): Promise<void> {
    await vi.advanceTimersByTimeAsync(1000);
    await nextTick();
  }

  it('lets an in-flight publish land before the halt resolves, then publishes nothing', async () => {
    reminderInput.current.value = reminders();
    let land!: () => void;
    plugin.publish.mockImplementationOnce(
      () => new Promise((resolve) => (land = () => resolve({ placements: {} })))
    );
    useWidgetSnapshot();
    await settle(); // the first publish is now in flight, awaiting the native write
    expect(plugin.publish).toHaveBeenCalledTimes(1);

    let halted = false;
    const halt = haltWidgetPublishingForSignOut().then(() => (halted = true));
    await nextTick();
    expect(halted).toBe(false); // still waiting on the in-flight write
    land();
    await halt;
    expect(halted).toBe(true);

    // A change after the halt (sign-out is still running) must not write the day back.
    reminderInput.current.value = reminders(JO);
    await nextTick();
    await settle();
    expect(plugin.publish).toHaveBeenCalledTimes(1);
  });

  it('resumes once the signed-out session is gone, so the next sign-in publishes', async () => {
    reminderInput.current.value = reminders();
    useWidgetSnapshot();
    await settle();
    await haltWidgetPublishingForSignOut();

    reminderInput.current.value = null; // sign-out completed
    await nextTick();
    await settle();
    reminderInput.current.value = reminders(JO); // next sign-in
    await nextTick();
    await settle();
    expect(plugin.publish).toHaveBeenCalledTimes(2);
    expect(publishedViewer(1)).toBe('jo');
  });
});

describe('useWidgetSnapshot: sign-out never waits on a wedged bridge', () => {
  beforeEach(() => vi.useFakeTimers());

  it('gives up after 3 s, logs the incomplete halt, and still lets sign-out proceed', async () => {
    reminderInput.current.value = reminders();
    plugin.publish.mockImplementationOnce(() => new Promise(() => {})); // never settles
    useWidgetSnapshot();
    await vi.advanceTimersByTimeAsync(1000);
    let done = false;
    const halt = haltWidgetPublishingForSignOut().then(() => (done = true));
    await vi.advanceTimersByTimeAsync(2999);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await halt;
    expect(events('sign-out halt incomplete')).toEqual([
      { error_code: 'halt_timeout', stage: 'sign-out' },
    ]);
  });
});

describe('useWidgetSnapshot: sign-out halt after an eviction', () => {
  beforeEach(() => vi.useFakeTimers());

  it('resumes for the next member when the halt ran with the input already null', async () => {
    reminderInput.current.value = reminders();
    useWidgetSnapshot();
    await vi.advanceTimersByTimeAsync(1000);
    await nextTick();
    // Eviction: the member is cleared first, THEN the sign-out steps halt and clear.
    reminderInput.current.value = null;
    await nextTick();
    await vi.advanceTimersByTimeAsync(1000);
    await haltWidgetPublishingForSignOut();
    // Another family member signs in on the same device.
    reminderInput.current.value = reminders(JO);
    await nextTick();
    await vi.advanceTimersByTimeAsync(1000);
    await nextTick();
    expect(plugin.publish).toHaveBeenCalledTimes(2);
    expect(publishedViewer(1)).toBe('jo');
  });
});

describe('publishWidgetSnapshot: failures and relayed native state', () => {
  const now = new Date(2026, 9, 11, 8, 0);

  it('reports a rejected publish with its code and stage, and toasts once per session', async () => {
    plugin.publish.mockRejectedValue(
      Object.assign(new Error('no group'), { code: 'write_failed' })
    );
    await publishWidgetSnapshot(widgetInput(), 'data-change', now);
    await publishWidgetSnapshot(widgetInput(), 'data-change', now);

    expect(reportError).toHaveBeenCalledTimes(2);
    expect(reportError.mock.calls[0]![0]).toMatchObject({
      surface: 'home-widget',
      severity: 'error',
      message: 'snapshot publish failed',
      context: { stage: 'write', error_code: 'write_failed' },
    });
    expect(showToast).toHaveBeenCalledTimes(1);
    expect(showToast).toHaveBeenCalledWith(
      'warning',
      'widget.publishFailed',
      'widget.publishFailedHelp',
      { silent: true }
    );
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('[home-widget] write_failed')
    );
    expect(events('snapshot published')).toEqual([]);
  });

  it('toasts again after a success has reset the once-per-session guard', async () => {
    plugin.publish.mockRejectedValueOnce({ code: 'reload_failed' });
    await publishWidgetSnapshot(widgetInput(), 'data-change', now);
    await publishWidgetSnapshot(widgetInput(), 'data-change', now);
    plugin.publish.mockRejectedValueOnce({ code: 'something-native-invented' });
    await publishWidgetSnapshot(widgetInput(), 'data-change', now);

    expect(showToast).toHaveBeenCalledTimes(2);
    expect(reportError.mock.calls.map((c) => (c[0] as { context: unknown }).context)).toEqual([
      { stage: 'reload', error_code: 'reload_failed' },
      { stage: 'write', error_code: 'publish_failed' },
    ]);
  });

  it('reports a build that throws, and never calls the plugin', async () => {
    const broken = widgetInput({
      t: () => {
        throw new Error('translation exploded');
      },
    });
    await publishWidgetSnapshot(broken, 'data-change', now);
    expect(plugin.publish).not.toHaveBeenCalled();
    expect(reportError.mock.calls[0]![0]).toMatchObject({
      context: { stage: 'build', error_code: 'build_failed' },
    });
  });

  it('relays a native read outcome, and never echoes one outside the token grammar', async () => {
    plugin.publish.mockResolvedValueOnce({ placements: {}, readOutcome: 'decode_failed;v=2' });
    await publishWidgetSnapshot(widgetInput(), 'foreground', now);
    plugin.publish.mockResolvedValueOnce({ placements: {}, readOutcome: 'Jo picks up Max' });
    await publishWidgetSnapshot(widgetInput(), 'foreground', now);

    expect(events('widget read failed')).toEqual([
      { error_code: 'snapshot_unreadable', detail: 'decode_failed;v=2' },
      { error_code: 'snapshot_unreadable', detail: 'unrecognised' },
    ]);
  });

  it('logs the day the Android widgets painted as an offset from today, and nothing for iOS', async () => {
    plugin.publish.mockResolvedValueOnce({ placements: {}, renderedYmd: TODAY });
    await publishWidgetSnapshot(widgetInput(), 'foreground', now);
    plugin.publish.mockResolvedValueOnce({ placements: {}, renderedYmd: addDaysYmd(TODAY, -1) });
    await publishWidgetSnapshot(widgetInput(), 'foreground', now);
    plugin.publish.mockResolvedValueOnce({ placements: {} });
    await publishWidgetSnapshot(widgetInput(), 'foreground', now);
    plugin.publish.mockResolvedValueOnce({ placements: {}, renderedYmd: 'not a day' });
    await publishWidgetSnapshot(widgetInput(), 'foreground', now);

    expect(events('snapshot published').map((c) => c.detail)).toEqual([
      expect.stringMatching(/;day=0$/),
      expect.stringMatching(/;day=-1$/),
      expect.not.stringMatching(/day=/),
      expect.not.stringMatching(/day=/),
    ]);
  });

  it('logs placements again when only a circle option changes', async () => {
    plugin.publish.mockResolvedValue({
      placements: { 'ios-accessory': 1, circle: { nextUp: 1 } },
    });
    await publishWidgetSnapshot(widgetInput(), 'data-change', now);
    await publishWidgetSnapshot(widgetInput(), 'data-change', now);
    plugin.publish.mockResolvedValue({
      placements: { 'ios-accessory': 1, circle: { thingsLeft: 1 } },
    });
    await publishWidgetSnapshot(widgetInput(), 'data-change', now);

    expect(events('placements')).toEqual([
      { kind: 'ios-accessory', count: 1, detail: 'circle=nextUp:1,handoff:0,todos:0,left:0' },
      { kind: 'ios-accessory', count: 1, detail: 'circle=nextUp:0,handoff:0,todos:0,left:1' },
    ]);
  });

  it('logs placements once, then only when the set changes', async () => {
    plugin.publish.mockResolvedValue({ placements: { 'ios-medium': 1 } });
    await publishWidgetSnapshot(widgetInput(), 'data-change', now);
    await publishWidgetSnapshot(widgetInput(), 'data-change', now);
    plugin.publish.mockResolvedValue({ placements: { 'ios-medium': 1, 'ios-accessory': 2 } });
    await publishWidgetSnapshot(widgetInput(), 'data-change', now);

    expect(events('placements')).toEqual([
      { kind: 'ios-medium', count: 1 },
      { kind: 'ios-medium', count: 1 },
      { kind: 'ios-accessory', count: 2 },
    ]);
  });

  it('publishes nothing for a null input', async () => {
    await publishWidgetSnapshot(null, 'data-change', now);
    expect(plugin.publish).not.toHaveBeenCalled();
    expect(logEvent).not.toHaveBeenCalled();
  });
});
