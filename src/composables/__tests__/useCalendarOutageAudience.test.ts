/**
 * The wiring layer only.
 *
 * The DECISION — the Drive guarantee, the four-rung ownership ladder, the
 * dismissal rules — is covered exhaustively and mutation-checked in
 * `src/utils/calendar/__tests__/connectionOwner.test.ts`, where it can be a plain
 * table with no Pinia and no Vue. What is left for this file is the wiring that
 * pure function cannot check itself: that the right stores are read, that a
 * dismissal persists the right ids, and that a failed write does not take the app
 * down with it.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { computed, ref, effectScope, type EffectScope } from 'vue';

interface NoticeState {
  schemaVersion: 1;
  dismissedConnectionIds: string[];
}

const h = vi.hoisted(() => ({
  // Assigned a REAL `ref` by the perMemberStore mock below. A `{ value }`
  // lookalike would leave `audience` cached forever, so a dismissal would look
  // like it did nothing.
  state: null as unknown as { value: NoticeState },
  save: vi.fn(() => true),
  members: [] as Array<Record<string, unknown>>,
  currentMemberId: 'm-kid' as string | null,
  connections: [] as Array<{ id: string; status: string }>,
  canManagePod: { value: false },
  logged: [] as string[],
}));

vi.mock('@/composables/perMemberStore', async () => {
  const { ref } = await import('vue');
  h.state = ref<NoticeState>({ schemaVersion: 1, dismissedConnectionIds: [] });
  return {
    createPerMemberStore: () => ({
      state: h.state,
      save: h.save,
      useMemberSync: vi.fn(),
      memberId: () => 'm-kid',
    }),
  };
});
vi.mock('@/stores/familyStore', () => ({
  useFamilyStore: () => ({
    get members() {
      return h.members;
    },
    get currentMemberId() {
      return h.currentMemberId;
    },
  }),
}));
vi.mock('@/stores/calendarSyncStore', () => ({
  useCalendarSyncStore: () => ({
    get connections() {
      return h.connections;
    },
  }),
}));
vi.mock('@/composables/usePermissions', () => ({
  usePermissions: () => ({ canManagePod: h.canManagePod }),
}));
vi.mock('@/services/telemetry', () => ({
  logEvent: (e: { context?: { action?: string } }) => {
    h.logged.push(e.context?.action ?? '');
  },
}));

import { useCalendarOutageAudience } from '@/composables/useCalendarOutageAudience';

const CAL = { kind: 'calendar' as const, connectionId: 'c1', email: 'mum@gmail.com' };
const DRIVE = { kind: 'drive' as const, email: 'mum@gmail.com' };

/**
 * Each setup runs in its OWN effect scope, torn down after the test.
 *
 * Not hygiene for its own sake: the composable registers a telemetry `watch`, and
 * Vue watchers flush asynchronously. Without a scope, a watcher created in one test
 * is still alive when the next test's `beforeEach` mutates the shared reactive
 * state, so it fires again and logs an event into the next test's assertions.
 */
const scopes: EffectScope[] = [];

function setup(
  features: unknown[] = [CAL],
  variant: 'drive' | 'calendar' | 'both' | null = 'calendar'
) {
  const scope = effectScope();
  scopes.push(scope);
  return scope.run(() =>
    useCalendarOutageAudience(computed(() => features) as never, ref(variant) as never)
  )!;
}

afterEach(() => {
  while (scopes.length) scopes.pop()!.stop();
});

beforeEach(() => {
  h.state.value = { schemaVersion: 1, dismissedConnectionIds: [] };
  h.members = [
    { id: 'm-mum', email: 'mum@example.com', googleAccountEmail: 'mum@gmail.com' },
    { id: 'm-kid', email: 'kid@example.com' },
  ];
  h.currentMemberId = 'm-kid';
  h.connections = [{ id: 'c1', status: 'needs_reconnect' }];
  h.canManagePod.value = false;
  h.logged = [];
  h.save.mockClear();
  h.save.mockImplementation(() => true);
});

describe('useCalendarOutageAudience — reading the stores', () => {
  it('resolves the bystander against the live roster', () => {
    const { audience } = setup();
    expect(audience.value).toEqual({
      mode: 'notice',
      owner: { kind: 'member', memberId: 'm-mum', via: 'google-email' },
    });
  });

  it('resolves the owner from currentMemberId', () => {
    h.currentMemberId = 'm-mum';
    expect(setup().audience.value).toEqual({ mode: 'owner' });
  });

  it('treats a pod manager as able to act when nobody else resolves', () => {
    h.members = [{ id: 'm-kid', email: 'kid@example.com' }];
    h.canManagePod.value = true;
    expect(setup().audience.value).toEqual({ mode: 'owner' });
  });

  it('🔴 narrows to calendar features only — a Drive entry is not a connection', () => {
    // `downFeatures` is a discriminated union. Feeding the Drive member into the
    // ownership ladder would resolve an owner for a connection that isn't one.
    const { audience } = setup([DRIVE, CAL], 'both');
    expect(audience.value).toEqual({ mode: 'owner' }); // 'both' always reaches everyone
  });

  it('hides when there is no active prompt at all', () => {
    expect(setup([], null).audience.value).toEqual({ mode: 'hidden', reason: 'nothing-down' });
  });
});

describe('useCalendarOutageAudience — dismissal', () => {
  it('persists the ids that are down right now', () => {
    const second = { kind: 'calendar' as const, connectionId: 'c2', email: 'x@gmail.com' };
    setup([CAL, second]).dismiss();
    expect(h.save).toHaveBeenCalledWith({
      schemaVersion: 1,
      dismissedConnectionIds: ['c1', 'c2'],
    });
  });

  it('🔴 SETS the id list rather than unioning, so healed ids are pruned', () => {
    // A union would accumulate every connection a family has ever broken, and the
    // list is the thing that decides whether a NEW outage speaks up.
    h.state.value = { schemaVersion: 1, dismissedConnectionIds: ['c-old', 'c-older'] };
    setup([CAL]).dismiss();
    expect(h.save).toHaveBeenCalledWith({ schemaVersion: 1, dismissedConnectionIds: ['c1'] });
  });

  it('hides the notice immediately, before any write has landed', () => {
    const { audience, dismiss } = setup();
    expect(audience.value.mode).toBe('notice');
    dismiss();
    expect(audience.value.mode).toBe('hidden');
  });

  it('🔴 a failing localStorage write does NOT un-dismiss the notice', () => {
    // `perMemberStore.save` reports the failure itself (severity 'warning') and
    // returns false. Deliberately no rollback and no toast here: rolling back
    // would re-render the exact obstruction this feature removes, and a toast
    // would land in the same blocked region. The notice simply returns after a
    // reload, which is self-correcting.
    h.save.mockImplementation(() => false);
    const { audience, dismiss } = setup();
    expect(() => dismiss()).not.toThrow();
    expect(audience.value.mode).toBe('hidden');
    expect(h.logged).toContain('notice-dismissed:calendar');
  });
});

describe('useCalendarOutageAudience — telemetry', () => {
  it('reports the DECISION, carrying how the owner was resolved', () => {
    setup();
    expect(h.logged).toContain('prompt-shown:calendar:notice:google-email');
  });

  it('labels the owner path', () => {
    h.currentMemberId = 'm-mum';
    setup();
    expect(h.logged).toContain('prompt-shown:calendar:owner:n-a');
  });

  it('🔴 never reports a notice for a Drive-bearing variant', () => {
    // `prompt-shown:both:notice:*` would mean a calendar dismissal had filtered a
    // data-at-risk Drive warning. It is the alert this event exists to make possible.
    setup([DRIVE, CAL], 'both');
    expect(h.logged.some((a) => a.startsWith('prompt-shown:both:notice'))).toBe(false);
  });

  it('records the dismissal', () => {
    setup().dismiss();
    expect(h.logged).toContain('notice-dismissed:calendar');
  });

  it('stays silent while nothing is shown', () => {
    setup([], null);
    expect(h.logged).toEqual([]);
  });
});

describe('useCalendarOutageAudience — re-arming after a repair', () => {
  /**
   * 🔴 The defect a code review found: connection ids are stable across a
   * reconnect, so a dismissal keyed on the bare id silenced that connection
   * FOREVER. Mum repairs it, the grant dies afresh six months later, and the
   * bystander is never told — a permanent blind spot, not a quiet one.
   */
  it('drops a dismissal once the connection is healthy again', () => {
    h.state.value = { schemaVersion: 1, dismissedConnectionIds: ['c1'] };
    h.connections = [{ id: 'c1', status: 'ok' }];
    setup([]);
    expect(h.state.value.dismissedConnectionIds).toEqual([]);
    expect(h.save).toHaveBeenCalledWith({ schemaVersion: 1, dismissedConnectionIds: [] });
  });

  it('so a LATER outage on the same connection speaks up again', () => {
    h.state.value = { schemaVersion: 1, dismissedConnectionIds: ['c1'] };
    h.connections = [{ id: 'c1', status: 'ok' }];
    setup([]); // the repair
    h.connections = [{ id: 'c1', status: 'needs_reconnect' }];
    expect(setup([CAL]).audience.value.mode).toBe('notice'); // months later
  });

  it('keeps a dismissal while the connection is still down', () => {
    h.state.value = { schemaVersion: 1, dismissedConnectionIds: ['c1'] };
    expect(setup([CAL]).audience.value).toEqual({ mode: 'hidden', reason: 'dismissed' });
    expect(h.save).not.toHaveBeenCalled();
  });

  it('🔴 does NOT wipe dismissals while the doc is still loading', () => {
    // `connections` is [] until Automerge loads. Pruning against that would clear
    // every dismissal on each cold start and resurface a closed notice.
    h.state.value = { schemaVersion: 1, dismissedConnectionIds: ['c1'] };
    h.connections = [];
    setup([]);
    expect(h.state.value.dismissedConnectionIds).toEqual(['c1']);
    expect(h.save).not.toHaveBeenCalled();
  });

  it('prunes only the healed id, leaving a still-down sibling dismissed', () => {
    h.state.value = { schemaVersion: 1, dismissedConnectionIds: ['c1', 'c2'] };
    h.connections = [
      { id: 'c1', status: 'needs_reconnect' },
      { id: 'c2', status: 'ok' },
    ];
    setup([CAL]);
    expect(h.state.value.dismissedConnectionIds).toEqual(['c1']);
  });
});

describe('useCalendarOutageAudience — the roster gate is reported', () => {
  it('🔴 logs the one outcome where somebody who could fix it sees nothing', () => {
    h.members = [];
    setup([CAL]);
    expect(h.logged).toContain('prompt-shown:calendar:hidden:roster');
  });

  it('stays silent for an ordinary dismissal', () => {
    h.state.value = { schemaVersion: 1, dismissedConnectionIds: ['c1'] };
    setup([CAL]);
    expect(h.logged.some((a) => a.startsWith('prompt-shown'))).toBe(false);
  });
});
