import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { ref } from 'vue';
import type { FamilyMember } from '@/types/models';

// ── Mutable mocks ─────────────────────────────────────────────────────────────
const viewer = {
  id: 'v',
  name: 'V',
  ageGroup: 'adult',
  role: 'member',
  isPet: false,
} as FamilyMember;
let currentMember: FamilyMember | undefined = viewer;
// ADR-032: store reads notificationReads[memberId] from the projection and
// writes it via docClient.mutate(patch, createIfMissing). `reads` is the fake.
const reads: Record<string, Record<string, string>> = {};
const flush = () => new Promise((r) => setTimeout(r, 0));
let docLoaded = true;
const reportErrorSpy = vi.fn();

vi.mock('@/services/automerge/docService', () => ({
  docVersion: ref(0),
  isDocLoaded: () => docLoaded,
}));
vi.mock('@/services/automerge/projection', () => ({
  getById: (collection: string, id: string) =>
    collection === 'notificationReads' ? reads[id] : undefined,
}));
vi.mock('@/services/automerge/worker/docClient', () => ({
  mutate: async (op: {
    op: string;
    id: string;
    patch?: Record<string, string>;
    deleteKeys?: string[];
    onMissing?: 'throw' | 'create' | 'skip';
  }) => {
    if (op.op !== 'patch') return;
    const slice = (reads[op.id] ??= {});
    Object.assign(slice, op.patch ?? {});
    for (const k of op.deleteKeys ?? []) delete slice[k];
  },
}));
vi.mock('@/stores/familyStore', () => ({
  useFamilyStore: () => ({
    get currentMember() {
      return currentMember;
    },
    members: [viewer],
  }),
}));
vi.mock('@/stores/todoStore', () => ({ useTodoStore: () => ({ todos: [] }) }));
vi.mock('@/stores/activityStore', () => ({
  useActivityStore: () => ({ activeActivitiesForMonth: () => [] }),
}));
vi.mock('@/stores/calendarSyncStore', () => ({
  useCalendarSyncStore: () => ({ connections: [] }),
}));
vi.mock('@/utils/errorReporter', () => ({ reportError: (i: unknown) => reportErrorSpy(i) }));

import { useNotificationsStore } from '@/stores/notificationsStore';

beforeEach(() => {
  setActivePinia(createPinia());
  currentMember = viewer;
  docLoaded = true;
  for (const k of Object.keys(reads)) delete reads[k];
  reportErrorSpy.mockClear();
});

describe('notificationsStore — drawer state machine', () => {
  it('open → list; openTo → detail (+marks read); back pops detail→list then closes', async () => {
    const s = useNotificationsStore();
    s.open();
    expect(s.isOpen).toBe(true);
    expect(s.view).toBe('list');

    // whats-new notifications exist from the real release registry — open one.
    const id = s.notifications[0]?.id;
    expect(id).toBeTruthy();
    s.openTo(id);
    expect(s.view).toBe('detail');
    expect(s.selectedId).toBe(id);
    await flush();
    expect(reads['v']?.[id]).toBeTruthy(); // marked read

    s.back();
    expect(s.isOpen).toBe(true);
    expect(s.view).toBe('list'); // popped detail→list, still open

    s.back();
    expect(s.isOpen).toBe(false); // second back closes
  });

  it('openToLatestAutoOpen is idempotent (latches after the first call)', () => {
    const s = useNotificationsStore();
    s.openToLatestAutoOpen();
    expect(s.isOpen).toBe(true);
    expect(s.view).toBe('detail');
    s.close();
    s.openToLatestAutoOpen(); // latched — no re-open
    expect(s.isOpen).toBe(false);
  });
});

describe('notificationsStore — read-state mutations', () => {
  it('markRead writes notificationReads[memberId][id]; markUnread deletes it', async () => {
    const s = useNotificationsStore();
    s.markRead('todo-due:t1:2026-05-27');
    await flush();
    expect(reads['v']['todo-due:t1:2026-05-27']).toBeTruthy();
    s.markUnread('todo-due:t1:2026-05-27');
    await flush();
    expect(reads['v']['todo-due:t1:2026-05-27']).toBeUndefined();
  });

  it('markAllRead marks the full derived unread set (not just rendered rows)', async () => {
    const s = useNotificationsStore();
    const unreadBefore = s.unreadCount;
    expect(unreadBefore).toBeGreaterThan(0); // the real whats-new releases
    const ids = s.notifications.map((n) => n.id);
    s.markAllRead();
    await flush();
    // every derived id now has a readAt entry
    for (const id of ids) {
      expect(reads['v'][id]).toBeTruthy();
    }
  });

  it('guards: no current member → reports + no-op, never throws', () => {
    const s = useNotificationsStore();
    currentMember = undefined;
    expect(() => s.markRead('x')).not.toThrow();
    expect(reportErrorSpy).toHaveBeenCalled();
    expect(reads).toEqual({});
  });

  it('guards: no loaded doc → reports + no-op', () => {
    const s = useNotificationsStore();
    docLoaded = false;
    s.markRead('x');
    expect(reportErrorSpy).toHaveBeenCalled();
  });
});
