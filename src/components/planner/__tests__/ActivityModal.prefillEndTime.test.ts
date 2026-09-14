/**
 * An extracted end time must survive the "end = start + 1h" convenience watcher.
 *
 * THE BUG THIS PINS. Vue's 'pre' watchers are QUEUED, not synchronous. `applyPrefill` sets
 * `startTime` and then `endTime` in the same tick; the start watcher was therefore queued by
 * the first assignment and flushed AFTER the second, overwriting the extracted end time with
 * start + 1h — every single time. A document that plainly said "2pm to 4:30pm" produced a 3pm
 * end, silently, and the only way to notice was to read the form carefully before saving.
 *
 * It is worth a component test rather than a unit one because the defect lives entirely in the
 * interaction between an assignment order and a watcher's flush timing. `extractionToActivity`
 * maps `endTime` through correctly and always did; testing the mapper would have gone on
 * passing while the form threw the value away.
 */
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick, ref } from 'vue';

import ActivityModal from '@/components/planner/ActivityModal.vue';

vi.mock('@/composables/useTranslation', () => ({
  // `isBeanieMode` is read by sibling composables the modal pulls in; a partial mock here
  // surfaces as an unrelated "reading 'value' of undefined" deep in a label helper.
  // The WHOLE shape. A partial mock surfaces far away as "reading 'value' of undefined"
  // inside whichever sibling composable happened to read the missing ref.
  useTranslation: () => ({
    t: (k: string) => k,
    currentLanguage: ref('en'),
    isLoading: ref(false),
    loadProgress: ref(1),
    isEnglish: ref(true),
    isBeanieMode: ref(false),
  }),
}));

/** The door self-gates on permission and would otherwise swallow its own trigger slot. */
const MagicBeansDoorStub = {
  name: 'MagicBeansDoor',
  props: ['claim'],
  template: '<div><slot name="trigger" :open="() => {}" /></div>',
};

function mountModal(prefill: Record<string, unknown>) {
  return mount(ActivityModal, {
    props: { open: true, activity: null, prefill },
    global: {
      stubs: {
        MagicBeansDoor: MagicBeansDoorStub,
        BeanieFormModal: { template: '<div><slot /></div>' },
        teleport: true,
      },
    },
  });
}

/** Read a TimePresetPicker's current value through its v-model binding. */
function timeValues(w: ReturnType<typeof mountModal>): string[] {
  return w
    .findAllComponents({ name: 'TimePresetPicker' })
    .map((c) => String(c.props('modelValue')));
}

beforeEach(() => {
  setActivePinia(createPinia());
});

describe('ActivityModal — an extracted end time', () => {
  it('SURVIVES the start-time convenience watcher instead of being overwritten by start + 1h', async () => {
    const w = mountModal({ title: 'School concert', startTime: '14:00', endTime: '16:30' });

    // Two ticks: one for the prefill's own assignments, one for the queued watcher that used
    // to clobber them. If the guard regresses, the second tick is where it happens.
    await nextTick();
    await nextTick();

    const times = timeValues(w);
    expect(times).toContain('14:00');
    expect(times).toContain('16:30');
    // The specific wrong answer, named so a regression is unmistakable in the failure output.
    expect(times).not.toContain('15:00');
  });

  it('still fills a MISSING end time with start + 1h, which is the useful default', async () => {
    // The convenience is not the bug and must not be removed with it: a document that gives a
    // start and no end should still produce a sensible hour-long activity.
    //
    // ⚠️ 14:00, deliberately NOT 09:00. `onNew` seeds 09:00/10:00, so a 09:00 prefill changes
    // nothing, no watcher is queued, and the expected 10:00 comes from the defaults rather
    // than from this path — the assertion passed while the path was broken.
    const w = mountModal({ title: 'Swimming', startTime: '14:00' });

    await nextTick();
    await nextTick();

    // The PAIR, not `toContain` — the wrong answer here was 14:00/14:00, and 14:00 is the
    // legitimate start, so a containment check cannot tell the two apart.
    expect(timeValues(w)).toEqual(['14:00', '15:00']);
  });

  it('still clamps an OVERNIGHT end — consistent with every other way an activity is made', async () => {
    // A school disco reading "7pm to 12:30am". Keeping 00:30 is what the document says, and it
    // is NOT what this modal should do on its own: the sibling edit modal re-clamps it on the
    // first touch, the reminder scheduler drops every reminder for it, and the day grid draws a
    // negative-height sliver. Pinned so a well-meaning "fix" here is a failing test rather than
    // three silent regressions elsewhere. Overnight support is a tracked follow-up.
    const w = mountModal({ title: 'School disco', startTime: '19:00', endTime: '00:30' });

    await nextTick();
    await nextTick();

    expect(timeValues(w)).toEqual(['19:00', '19:00']);
  });
});
