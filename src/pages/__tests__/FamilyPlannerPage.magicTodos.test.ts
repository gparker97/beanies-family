/**
 * The planner's half of a magic beans shared result (#113): an activity AND to-dos.
 *
 * What this pins, because each one is an ordering bug waiting to happen:
 *   - the to-do drawer opens FIRST, and the activity form only after it has closed,
 *   - saved to-dos are linked to the activity when (and only when) it is saved,
 *   - closing the form unsaved leaves them unlinked and says so (`link_skipped`),
 *   - a second capture never links capture A's to-dos to capture B's activity,
 *   - a draft-build failure still opens the activity form,
 *   - the drawer is told which existing activity the read probably repeats, and a duplicate
 *     lookup that throws is reported and treated as new (both call sites).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { flushPromises, shallowMount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { nextTick, ref } from 'vue';
import FamilyPlannerPage from '@/pages/FamilyPlannerPage.vue';
import { useActivityStore } from '@/stores/activityStore';
import { useTodoStore } from '@/stores/todoStore';
import type { TodoExtractionResult } from '@/services/ai/types';
import type { ResultEnvelope } from '@/types/magicPayload';

vi.mock('vue-router', async (orig) => ({
  ...(await orig<typeof import('vue-router')>()),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useRoute: () => ({ query: {}, params: {}, path: '/activities' }),
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
vi.mock('@/services/telemetry/logEvent', () => ({ logEvent: (...a: unknown[]) => logEvent(...a) }));

const reportError = vi.fn();
vi.mock('@/utils/errorReporter', () => ({
  reportError: (...a: unknown[]) => reportError(...a),
}));

/** Defaults to the real lookup; a test can make it return a match or throw. */
const findDuplicateActivity = vi.fn();
vi.mock('@/utils/activityDuplicate', async (orig) => {
  const actual = await orig<typeof import('@/utils/activityDuplicate')>();
  return {
    ...actual,
    findDuplicateActivity: (...a: Parameters<typeof actual.findDuplicateActivity>) =>
      findDuplicateActivity(...a) ?? actual.findDuplicateActivity(...a),
  };
});

/** Captured so a test can deliver an extraction exactly as the reader would. */
let onActivityReady: (ready: unknown) => Promise<void> | void = () => {};
vi.mock('@/composables/useDocumentToActivity', () => ({
  useDocumentToActivity: (opts: { onActivityReady: typeof onActivityReady }) => {
    onActivityReady = opts.onActivityReady;
    return { deliverEvent: vi.fn() };
  },
}));

const TODO: TodoExtractionResult = {
  items: [
    {
      title: 'Sign the slip',
      details: null,
      dueDate: null,
      dueTime: null,
      timing: null,
      assigneeName: null,
      ownerCard: null,
      links: [],
    },
  ],
};
const ENV: ResultEnvelope = { sourceFile: null };

function capture(todo?: TodoExtractionResult) {
  return {
    prefill: { title: 'Field trip', date: '2030-10-13' },
    confidence: {},
    env: ENV,
    ...(todo ? { todo } : {}),
  };
}

function mountPage() {
  return shallowMount(FamilyPlannerPage);
}

const drawer = (w: ReturnType<typeof mountPage>) =>
  w.findComponent({ name: 'MagicTodoReviewDrawer' });
const activityModal = (w: ReturnType<typeof mountPage>) =>
  w.findComponent({ name: 'ActivityModal' });

async function settle() {
  await flushPromises();
  await nextTick();
  await nextTick();
}

const loggedActions = () =>
  logEvent.mock.calls.map((c) => (c[0] as { context?: { action?: string } }).context?.action);

let linkTodosToActivity: ReturnType<typeof vi.fn>;
let createActivity: ReturnType<typeof vi.fn>;

beforeEach(() => {
  setActivePinia(createPinia());
  vi.clearAllMocks();
  findDuplicateActivity.mockReturnValue(undefined);
  linkTodosToActivity = vi.fn().mockResolvedValue([{ id: 'todo-1' }]);
  createActivity = vi.fn().mockResolvedValue({ id: 'act-1' });
  const todoStore = useTodoStore();
  todoStore.linkTodosToActivity = linkTodosToActivity as never;
  const activityStore = useActivityStore();
  activityStore.createActivity = createActivity as never;
});

describe('FamilyPlannerPage: magic beans shared result', () => {
  it('opens the to-do drawer first, then the form, and links the to-dos on create', async () => {
    const w = mountPage();
    await onActivityReady(capture(TODO));
    await settle();

    expect(drawer(w).props('open')).toBe(true);
    expect(activityModal(w).props('open')).toBe(false);

    drawer(w).vm.$emit('saved', ['todo-1']);
    await settle();

    expect(drawer(w).props('open')).toBe(false);
    expect(activityModal(w).props('open')).toBe(true);
    expect(activityModal(w).props('prefill')).toMatchObject({ title: 'Field trip' });

    activityModal(w).vm.$emit('save', { title: 'Field trip', date: '2030-10-13' });
    await settle();

    expect(createActivity).toHaveBeenCalledTimes(1);
    expect(linkTodosToActivity).toHaveBeenCalledWith(['todo-1'], { activityId: 'act-1' });
    expect(loggedActions()).toContain('linked');
  });

  it('links on an update-shaped save too (eager create, or "update existing")', async () => {
    const updateActivity = vi.fn().mockResolvedValue(true);
    useActivityStore().updateActivity = updateActivity as never;
    const w = mountPage();
    await onActivityReady(capture(TODO));
    await settle();
    drawer(w).vm.$emit('saved', ['todo-1']);
    await settle();

    activityModal(w).vm.$emit('save', { id: 'act-9', data: { title: 'Field trip' } });
    await settle();

    expect(updateActivity).toHaveBeenCalledTimes(1);
    expect(linkTodosToActivity).toHaveBeenCalledWith(['todo-1'], { activityId: 'act-9' });
  });

  it('does not link, and keeps the ids, when the update fails and the form stays open', async () => {
    useActivityStore().updateActivity = vi.fn().mockResolvedValue(false) as never;
    const w = mountPage();
    await onActivityReady(capture(TODO));
    await settle();
    drawer(w).vm.$emit('saved', ['todo-1']);
    await settle();

    activityModal(w).vm.$emit('save', { id: 'act-9', data: { title: 'Field trip' } });
    await settle();
    expect(linkTodosToActivity).not.toHaveBeenCalled();
    expect(activityModal(w).props('open')).toBe(true);
    expect(loggedActions()).not.toContain('link_skipped');
  });

  it('keeps the to-dos unlinked, and says so, when the form closes unsaved', async () => {
    const w = mountPage();
    await onActivityReady(capture(TODO));
    await settle();
    drawer(w).vm.$emit('saved', ['todo-1']);
    await settle();

    activityModal(w).vm.$emit('close');
    await settle();

    expect(linkTodosToActivity).not.toHaveBeenCalled();
    expect(loggedActions()).toContain('link_skipped');
  });

  it("never links capture A's to-dos to capture B's activity", async () => {
    const w = mountPage();
    await onActivityReady(capture(TODO));
    await settle();
    drawer(w).vm.$emit('saved', ['todo-1']);
    await settle();

    // A second capture from the open form's own magic beans card, with no to-dos.
    await onActivityReady(capture());
    await settle();
    expect(loggedActions()).toContain('link_skipped');

    activityModal(w).vm.$emit('save', { title: 'Other', date: '2030-11-01' });
    await settle();
    expect(linkTodosToActivity).not.toHaveBeenCalled();
  });

  it('closes an open form before opening the drawer for a new shared capture', async () => {
    const w = mountPage();
    await onActivityReady(capture());
    await settle();
    expect(activityModal(w).props('open')).toBe(true);

    await onActivityReady(capture(TODO));
    await settle();
    expect(activityModal(w).props('open')).toBe(false);
    expect(drawer(w).props('open')).toBe(true);
  });

  it('still opens the activity form when the drafts cannot be built', async () => {
    const w = mountPage();
    await onActivityReady(capture(TODO));
    await settle();

    drawer(w).vm.$emit('buildFailed');
    await settle();

    expect(drawer(w).props('open')).toBe(false);
    expect(activityModal(w).props('open')).toBe(true);
  });

  it('opens nothing when the drawer is closed', async () => {
    const w = mountPage();
    await onActivityReady(capture(TODO));
    await settle();

    drawer(w).vm.$emit('close');
    await settle();

    expect(drawer(w).props('open')).toBe(false);
    expect(activityModal(w).props('open')).toBe(false);
  });

  it('a capture that arrives while the drawer is open supersedes the earlier one', async () => {
    const w = mountPage();
    await onActivityReady(capture(TODO));
    await settle();
    expect(drawer(w).props('open')).toBe(true);
    logEvent.mockClear();

    // Capture B (no to-dos) reaches the page behind the drawer.
    await onActivityReady({ ...capture(), prefill: { title: 'Swim meet', date: '2030-11-02' } });
    await settle();

    expect(drawer(w).props('open')).toBe(false);
    // The stale drawer has nothing left to save: its review is gone.
    expect(drawer(w).props('ready')).toBeNull();
    expect(activityModal(w).props('open')).toBe(true);
    expect(activityModal(w).props('prefill')).toMatchObject({ title: 'Swim meet' });
    expect(logEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        surface: 'magic-todo-review',
        message: 'dismissed',
        context: { action: 'dismissed', stage: 'superseded' },
      })
    );

    // Saving B's form creates B only; capture A never resumes and nothing is linked.
    activityModal(w).vm.$emit('save', { title: 'Swim meet', date: '2030-11-02' });
    await settle();
    expect(createActivity).toHaveBeenCalledTimes(1);
    expect(createActivity.mock.calls[0]![0]).toMatchObject({ title: 'Swim meet' });
    expect(linkTodosToActivity).not.toHaveBeenCalled();
  });

  it('logs link_partial with the shortfall when fewer to-dos link than were saved', async () => {
    linkTodosToActivity.mockResolvedValue([{ id: 'todo-1' }]);
    const w = mountPage();
    await onActivityReady(capture(TODO));
    await settle();
    drawer(w).vm.$emit('saved', ['todo-1', 'todo-2', 'todo-3']);
    await settle();

    activityModal(w).vm.$emit('save', { title: 'Field trip', date: '2030-10-13' });
    await settle();

    expect(linkTodosToActivity).toHaveBeenCalledWith(['todo-1', 'todo-2', 'todo-3'], {
      activityId: 'act-1',
    });
    expect(logEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'warn',
        surface: 'magic-todo-review',
        message: 'link_partial',
        context: { action: 'link_partial', count: 2, activity_id: 'act-1' },
      })
    );
  });

  it('does not log link_partial when every to-do links', async () => {
    linkTodosToActivity.mockResolvedValue([{ id: 'todo-1' }, { id: 'todo-2' }]);
    const w = mountPage();
    await onActivityReady(capture(TODO));
    await settle();
    drawer(w).vm.$emit('saved', ['todo-1', 'todo-2']);
    await settle();

    activityModal(w).vm.$emit('save', { title: 'Field trip', date: '2030-10-13' });
    await settle();

    expect(loggedActions()).toContain('linked');
    expect(loggedActions()).not.toContain('link_partial');
  });

  it('skips the drawer for a plain event', async () => {
    const w = mountPage();
    await onActivityReady(capture());
    await settle();
    expect(drawer(w).props('open')).toBe(false);
    expect(activityModal(w).props('open')).toBe(true);
  });

  it('tells the drawer which existing activity the read probably repeats', async () => {
    findDuplicateActivity.mockReturnValue({ id: 'act-7', title: 'Field trip' });
    const w = mountPage();
    await onActivityReady(capture(TODO));
    await settle();
    expect(drawer(w).props('ready')).toMatchObject({ probableActivityId: 'act-7' });
  });

  it('reports a duplicate lookup that throws, and still opens the drawer', async () => {
    findDuplicateActivity.mockImplementation(() => {
      throw new Error('boom');
    });
    const w = mountPage();
    await onActivityReady(capture(TODO));
    await settle();
    expect(drawer(w).props('open')).toBe(true);
    expect(drawer(w).props('ready')?.probableActivityId).toBeUndefined();
    expect(reportError).toHaveBeenCalledWith(
      expect.objectContaining({
        surface: 'ai-activity-capture',
        severity: 'warning',
        message: 'duplicate activity lookup failed; no duplicate hint',
        error: expect.any(Error),
        context: { action: 'duplicate_check_failed', stage: 'todo_hint' },
      })
    );
  });

  it('reports a lookup that throws on both checks of one capture only once', async () => {
    findDuplicateActivity.mockImplementation(() => {
      throw new Error('boom');
    });
    const w = mountPage();
    await onActivityReady(capture(TODO));
    await settle();
    drawer(w).vm.$emit('saved', ['todo-1']);
    await settle();

    // Both lookups ran (todo_hint, then confirm) and the capture still reached the form.
    expect(findDuplicateActivity).toHaveBeenCalledTimes(2);
    expect(activityModal(w).props('open')).toBe(true);
    const reports = reportError.mock.calls.filter(
      (c) =>
        (c[0] as { context?: { action?: string } }).context?.action === 'duplicate_check_failed'
    );
    expect(reports).toHaveLength(1);
    expect(reports[0]![0]).toMatchObject({ context: { stage: 'todo_hint' } });
    // The confirm-stage fallback is not reported again, but it still leaves a debug trace.
    expect(logEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'debug',
        surface: 'ai-activity-capture',
        context: { action: 'duplicate_check_failed_repeat', stage: 'confirm' },
      })
    );
  });

  it('reports a duplicate lookup that throws at the confirm step, and adds new', async () => {
    findDuplicateActivity.mockImplementation(() => {
      throw new Error('boom');
    });
    const w = mountPage();
    await onActivityReady(capture());
    await settle();
    expect(activityModal(w).props('open')).toBe(true);
    expect(reportError).toHaveBeenCalledWith(
      expect.objectContaining({
        surface: 'ai-activity-capture',
        message: 'duplicate activity lookup failed; treating as new',
        context: { action: 'duplicate_check_failed', stage: 'confirm' },
      })
    );
  });
});
