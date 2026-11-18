/**
 * A captured call link on a NEW activity goes with the place, in Location or Link, where it
 * reads as Join Call (#153). The decision is `placeCapturedLink`'s (unit-tested beside it);
 * these pin the seam: `applyPrefill` seeds the location from it (including a link-only capture
 * with no venue), leaves the plain link empty, changes nothing with the flag off, logs only the
 * call outcomes (never the link), and is never reached by an edit.
 */
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick, ref } from 'vue';

const flags = vi.hoisted(() => ({ on: true }));
vi.mock('@/config/flags', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/config/flags')>()),
  isFlagEnabled: (id: string) => (id === 'placeSuggestions' ? flags.on : false),
}));

vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({
    t: (k: string) => k,
    currentLanguage: ref('en'),
    isLoading: ref(false),
    isEnglish: ref(true),
    isBeanieMode: ref(false),
  }),
}));

const logEvent = vi.fn();
vi.mock('@/services/telemetry/logEvent', () => ({
  logEvent: (...a: unknown[]) => logEvent(...a),
}));

const placeSpy = vi.hoisted(() => ({ calls: 0 }));
vi.mock('@/utils/location/locationLinks', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/utils/location/locationLinks')>();
  return {
    ...actual,
    placeCapturedLink: (...a: Parameters<typeof actual.placeCapturedLink>) => {
      placeSpy.calls++;
      return actual.placeCapturedLink(...a);
    },
  };
});

import ActivityModal from '@/components/planner/ActivityModal.vue';
import LocationField from '@/components/ui/LocationField.vue';
import type { FamilyActivity } from '@/types/models';

const MagicBeansDoorStub = {
  name: 'MagicBeansDoor',
  props: ['claim'],
  template: '<div><slot name="trigger" :open="() => {}" /></div>',
};

const ZOOM = 'https://us02web.zoom.us/j/123456789?pwd=abc';
const WEB = 'https://school.example.org/signup';
/** As the extraction screen leaves it; the location parser stops at `}`, so it never reads back. */
const TEAMS_CUT =
  'https://teams.microsoft.com/l/meetup-join/19%3ameeting_x%40thread.v2/0?context={%22Tid%22:%22a%22}';

function placedEvents(): unknown[] {
  return logEvent.mock.calls
    .map(([e]) => e)
    .filter((e) => (e as { message?: string }).message === 'captured link placed');
}

function moreDetailsShown(w: ReturnType<typeof mountModal>): boolean {
  return (w.vm as unknown as { showMoreDetails: boolean }).showMoreDetails;
}

function mountModal(props: { prefill?: Record<string, unknown>; activity?: FamilyActivity }) {
  return mount(ActivityModal, {
    props: { open: true, activity: props.activity ?? null, prefill: props.prefill },
    global: {
      stubs: {
        MagicBeansDoor: MagicBeansDoorStub,
        BeanieFormModal: { template: '<div><slot /></div>' },
        teleport: true,
      },
    },
  });
}

async function settle(): Promise<void> {
  await nextTick();
  await nextTick();
}

function fields(w: ReturnType<typeof mountModal>): { location: string; link: string } {
  const value = w.findComponent(LocationField).props('value') as { text: string };
  return { location: value.text, link: (w.vm as unknown as { link: string }).link };
}

beforeEach(() => {
  setActivePinia(createPinia());
  flags.on = true;
  logEvent.mockClear();
  placeSpy.calls = 0;
});

describe('ActivityModal: a captured call link (#153)', () => {
  it('a venue and a call link: Location or Link holds both, the link field is empty', async () => {
    const w = mountModal({ prefill: { title: 'Piano', location: 'Music Hall', link: ZOOM } });
    await settle();

    expect(fields(w)).toEqual({ location: `Music Hall ${ZOOM}`, link: '' });
    // Other form events (the category guess, say) share the mock; only this one is ours.
    const placed = logEvent.mock.calls.filter(
      ([e]) => (e as { message?: string }).message === 'captured link placed'
    );
    expect(placed).toEqual([
      [
        {
          level: 'info',
          surface: 'ai-activity-capture',
          message: 'captured link placed',
          context: { action: 'call-to-location' },
        },
      ],
    ]);
    // The link itself never reaches the firehose.
    expect(JSON.stringify(logEvent.mock.calls)).not.toContain('zoom.us');
  });

  it('a link-only capture with no location still seeds the field with the call link', async () => {
    const w = mountModal({ prefill: { title: 'Piano', link: ZOOM } });
    await settle();

    expect(fields(w)).toEqual({ location: ZOOM, link: '' });
  });

  it('a plain web link fills the link field and reveals more details, with no event', async () => {
    const w = mountModal({ prefill: { title: 'Fair', location: 'Music Hall', link: WEB } });
    await settle();

    expect(fields(w)).toEqual({ location: 'Music Hall', link: WEB });
    expect(moreDetailsShown(w)).toBe(true);
    expect(placedEvents()).toEqual([]);
  });

  it('a call link that does not read back stays in the link field and is logged as kept', async () => {
    const w = mountModal({ prefill: { title: 'Class', location: 'Room 3', link: TEAMS_CUT } });
    await settle();

    expect(fields(w)).toEqual({ location: 'Room 3', link: TEAMS_CUT });
    expect(moreDetailsShown(w)).toBe(true);
    expect(placedEvents()).toEqual([
      {
        level: 'info',
        surface: 'ai-activity-capture',
        message: 'captured link placed',
        context: { action: 'call-kept-in-link' },
      },
    ]);
  });

  it('a link-only web prefill with no location does not seed the location field', async () => {
    const w = mountModal({ prefill: { title: 'Fair', link: WEB } });
    await settle();

    expect(fields(w)).toEqual({ location: '', link: WEB });
  });

  it('flag off: the location and the link are filled exactly as before', async () => {
    flags.on = false;
    const w = mountModal({ prefill: { title: 'Piano', location: 'Music Hall', link: ZOOM } });
    await settle();

    expect(fields(w)).toEqual({ location: 'Music Hall', link: ZOOM });
    expect(logEvent).not.toHaveBeenCalledWith(
      expect.objectContaining({ message: 'captured link placed' })
    );
  });

  it('an edit of an existing activity never calls it', async () => {
    const activity = {
      id: 'a-1',
      title: 'Piano',
      date: '2026-11-20',
      startTime: '16:00',
      endTime: '17:00',
      recurrence: 'none',
      category: 'music',
      location: 'Music Hall',
      link: ZOOM,
      assigneeIds: ['m'],
      feeSchedule: 'none',
      reminderMinutes: 30,
      isActive: true,
      createdBy: 'm',
      createdAt: '2026-10-01T00:00:00.000Z',
      updatedAt: '2026-10-01T00:00:00.000Z',
    } as unknown as FamilyActivity;
    const w = mountModal({ activity, prefill: { title: 'Piano', link: ZOOM } });
    await settle();

    expect(placeSpy.calls).toBe(0);
    expect(fields(w)).toEqual({ location: 'Music Hall', link: ZOOM });
  });
});
