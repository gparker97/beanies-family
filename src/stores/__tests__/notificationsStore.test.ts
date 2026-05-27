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
const mockDoc: { notificationReads: Record<string, Record<string, string>> } = {
  notificationReads: {},
};
let docLoaded = true;
const reportErrorSpy = vi.fn();

vi.mock('@/services/automerge/docService', () => ({
  docVersion: ref(0),
  isDocLoaded: () => docLoaded,
  getDoc: () => mockDoc,
  changeDoc: (fn: (d: typeof mockDoc) => void) => fn(mockDoc),
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
vi.mock('@/utils/errorReporter', () => ({ reportError: (i: unknown) => reportErrorSpy(i) }));

import { useNotificationsStore } from '@/stores/notificationsStore';

beforeEach(() => {
  setActivePinia(createPinia());
  currentMember = viewer;
  docLoaded = true;
  mockDoc.notificationReads = {};
  reportErrorSpy.mockClear();
});

describe('notificationsStore — drawer state machine', () => {
  it('open → list; openTo → detail (+marks read); back pops detail→list then closes', () => {
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
    expect(mockDoc.notificationReads['v']?.[id]).toBeTruthy(); // marked read

    s.back();
    expect(s.isOpen).toBe(true);
    expect(s.view).toBe('list'); // popped detail→list, still open

    s.back();
    expect(s.isOpen).toBe(false); // second back closes
  });

  it('openToLatestWhatsNew is idempotent (latches after the first call)', () => {
    const s = useNotificationsStore();
    s.openToLatestWhatsNew();
    expect(s.isOpen).toBe(true);
    expect(s.view).toBe('detail');
    s.close();
    s.openToLatestWhatsNew(); // latched — no re-open
    expect(s.isOpen).toBe(false);
  });
});

describe('notificationsStore — read-state mutations', () => {
  it('markRead writes notificationReads[memberId][id]; markUnread deletes it', () => {
    const s = useNotificationsStore();
    s.markRead('todo-due:t1:2026-05-27');
    expect(mockDoc.notificationReads['v']['todo-due:t1:2026-05-27']).toBeTruthy();
    s.markUnread('todo-due:t1:2026-05-27');
    expect(mockDoc.notificationReads['v']['todo-due:t1:2026-05-27']).toBeUndefined();
  });

  it('markAllRead marks the full derived unread set (not just rendered rows)', () => {
    const s = useNotificationsStore();
    const unreadBefore = s.unreadCount;
    expect(unreadBefore).toBeGreaterThan(0); // the real whats-new releases
    s.markAllRead();
    // every derived id now has a readAt entry
    for (const n of s.notifications) {
      expect(mockDoc.notificationReads['v'][n.id]).toBeTruthy();
    }
  });

  it('guards: no current member → reports + no-op, never throws', () => {
    const s = useNotificationsStore();
    currentMember = undefined;
    expect(() => s.markRead('x')).not.toThrow();
    expect(reportErrorSpy).toHaveBeenCalled();
    expect(mockDoc.notificationReads).toEqual({});
  });

  it('guards: no loaded doc → reports + no-op', () => {
    const s = useNotificationsStore();
    docLoaded = false;
    s.markRead('x');
    expect(reportErrorSpy).toHaveBeenCalled();
  });
});
