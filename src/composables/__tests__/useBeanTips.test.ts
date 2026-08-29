/**
 * Unit tests for `useBeanTips`. The composable holds module-level state +
 * watchers, so each test uses `vi.resetModules()` + dynamic import to start
 * from a clean composable module. Every store dependency is mocked at the
 * module boundary so we test only the persistence + issuance state machine.
 *
 * IMPORTANT: vi.resetAllMocks() is used (not clearAllMocks) for cross-test
 * isolation — see docs/lessons.md.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ref } from 'vue';

// ── Mock-state refs (shared across tests; reset in beforeEach) ───────────────

const familyMemberId = ref<string>('member-1');
const today = ref<string>('2026-05-29');
const onboardingCompleted = ref<boolean>(true);
const reportError = vi.fn();
const showToast = vi.fn();

// ── Mocks (hoisted) ──────────────────────────────────────────────────────────

vi.mock('@/composables/useToday', () => ({
  useToday: () => ({ today }),
}));

vi.mock('@/stores/familyStore', () => ({
  useFamilyStore: () => ({
    get currentMemberId() {
      return familyMemberId.value;
    },
    members: [],
  }),
}));

vi.mock('@/stores/settingsStore', () => ({
  useSettingsStore: () => ({
    get onboardingCompleted() {
      return onboardingCompleted.value;
    },
  }),
}));

vi.mock('@/stores/transactionsStore', () => ({
  useTransactionsStore: () => ({ transactions: [] }),
}));
vi.mock('@/stores/activityStore', () => ({
  useActivityStore: () => ({ activities: [] }),
}));
vi.mock('@/stores/todoStore', () => ({
  useTodoStore: () => ({ todos: [] }),
}));
vi.mock('@/stores/goalsStore', () => ({
  useGoalsStore: () => ({ goals: [] }),
}));
vi.mock('@/stores/vacationStore', () => ({
  useVacationStore: () => ({ vacations: [] }),
}));
vi.mock('@/stores/accountsStore', () => ({
  useAccountsStore: () => ({ accounts: [] }),
}));
vi.mock('@/stores/translationStore', () => ({
  useTranslationStore: () => ({
    t: (key: string) => {
      if (key === 'beanTips.muteFailedTitle') return "Couldn't mute tips";
      if (key === 'beanTips.enableFailedTitle') return "Couldn't enable tips";
      return key;
    },
  }),
}));

// Trimmed catalogue — the real ALL_TIPS has 21 entries; for state-machine
// tests we only need a small deterministic set.
vi.mock('@/content/tips', () => {
  const tips = [
    { id: 'tip-a', category: 'finance', message: { en: 'A', beanie: 'a' } },
    { id: 'tip-b', category: 'family', message: { en: 'B', beanie: 'b' } },
    {
      id: 'tip-cond',
      category: 'finance',
      message: { en: 'C', beanie: 'c' },
      condition: (ctx: { transactionCount: number }) => ctx.transactionCount > 0,
    },
  ];
  return {
    ALL_TIPS: tips,
    TIPS_BY_ID: new Map(tips.map((t) => [t.id, t])),
    getTip: (id: string) => tips.find((t) => t.id === id),
  };
});

vi.mock('@/utils/errorReporter', () => ({
  reportError: (input: unknown) => reportError(input),
}));

vi.mock('@/composables/useToast', () => ({
  showToast: (...args: unknown[]) => showToast(...args),
}));

// ── Per-test helper: fresh composable module ─────────────────────────────────

let memberCounter = 0;

async function freshUseBeanTips() {
  vi.resetModules();
  memberCounter++;
  familyMemberId.value = `member-${memberCounter}`;
  const mod = await import('@/composables/useBeanTips');
  return mod.useBeanTips();
}

function currentKey(): string {
  return `bean-tips-${familyMemberId.value}`;
}
function readJson(): Record<string, unknown> | null {
  const raw = localStorage.getItem(currentKey());
  return raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
}

beforeEach(() => {
  vi.resetAllMocks();
  localStorage.clear();
  today.value = '2026-05-29';
  onboardingCompleted.value = true;
});

// ── Tests ────────────────────────────────────────────────────────────────────

describe('useBeanTips — first run', () => {
  it('issues the first eligible tip and persists v2 state', async () => {
    const { ensureTodayTipIssued, issuedTips } = await freshUseBeanTips();
    ensureTodayTipIssued();
    expect(issuedTips.value).toHaveLength(1);
    expect(issuedTips.value[0].tipId).toBe('tip-a');
    const persisted = readJson();
    expect(persisted?.schemaVersion).toBe(2);
    expect(persisted?.lastTipShownDate).toBe('2026-05-29');
    expect(persisted?.dismissedTips).toEqual([]); // downgrade mirror
    // 20s, not vitest's default 5s: the FIRST dynamic import of the module graph in a
    // full-suite run pays a one-off transform/init cost under harness contention. This
    // test (with reviewDemo + inviteToken's firsts) timed out in full-suite runs on
    // 2026-08-2x and 2026-08-29 while passing in isolation — same pattern and same fix
    // as TravelPlansPage.smoke.test.ts.
  }, 20_000);
});

describe('useBeanTips — idempotency', () => {
  it('a second same-day call is a no-op', async () => {
    const { ensureTodayTipIssued, issuedTips } = await freshUseBeanTips();
    ensureTodayTipIssued();
    ensureTodayTipIssued();
    expect(issuedTips.value).toHaveLength(1);
  });
});

describe('useBeanTips — day-roll', () => {
  it('a new day issues the next eligible tip', async () => {
    const { ensureTodayTipIssued, issuedTips } = await freshUseBeanTips();
    ensureTodayTipIssued();
    today.value = '2026-05-30';
    ensureTodayTipIssued();
    expect(issuedTips.value.map((e) => e.tipId)).toEqual(['tip-a', 'tip-b']);
  });
});

describe('useBeanTips — migration', () => {
  it('v1 dismissedTips become mutedTipIds; muted ids are never re-issued', async () => {
    // Rotate id and seed BEFORE useBeanTips() so the immediate watcher picks
    // up the seeded localStorage on load.
    vi.resetModules();
    memberCounter++;
    familyMemberId.value = `member-${memberCounter}`;
    localStorage.setItem(
      currentKey(),
      JSON.stringify({
        dismissedTips: ['tip-a'],
        tipsEnabled: true,
        lastTipShownDate: '',
      })
    );
    const mod = await import('@/composables/useBeanTips');
    const { ensureTodayTipIssued, issuedTips } = mod.useBeanTips();
    ensureTodayTipIssued();
    expect(issuedTips.value.map((e) => e.tipId)).toEqual(['tip-b']);
    const persisted = readJson();
    expect(persisted?.schemaVersion).toBe(2);
    expect(persisted?.mutedTipIds).toEqual(['tip-a']);
    expect(persisted?.dismissedTips).toEqual(['tip-a']); // mirror preserved
  });
});

describe('useBeanTips — downgrade safety', () => {
  it('saveState writes a dismissedTips mirror that an older reader can use', async () => {
    const { muteAllTips } = await freshUseBeanTips();
    muteAllTips();
    const persisted = readJson();
    expect(persisted?.tipsEnabled).toBe(false);
    // The mirror equals mutedTipIds (empty here since no tip was issued first).
    expect(persisted?.dismissedTips).toEqual(persisted?.mutedTipIds);
  });

  it('a v2 payload with extra dismissedTips entries unions them into mutedTipIds', async () => {
    vi.resetModules();
    memberCounter++;
    familyMemberId.value = `member-${memberCounter}`;
    localStorage.setItem(
      currentKey(),
      JSON.stringify({
        schemaVersion: 2,
        issuedTips: [],
        mutedTipIds: ['tip-a'],
        dismissedTips: ['tip-a', 'tip-b'],
        tipsEnabled: true,
        lastTipShownDate: '',
      })
    );
    const mod = await import('@/composables/useBeanTips');
    const { ensureTodayTipIssued, issuedTips } = mod.useBeanTips();
    ensureTodayTipIssued();
    // Both tip-a and tip-b are muted via the union; tip-cond fails its
    // condition (transactionCount === 0) → 0 issued.
    expect(issuedTips.value).toHaveLength(0);
  });

  it('round-trip after downgrade-then-upgrade preserves the muted set', async () => {
    vi.resetModules();
    memberCounter++;
    familyMemberId.value = `member-${memberCounter}`;
    // Simulated downgrade write (v1 shape).
    localStorage.setItem(
      currentKey(),
      JSON.stringify({ dismissedTips: ['tip-a'], tipsEnabled: true, lastTipShownDate: '' })
    );
    const mod = await import('@/composables/useBeanTips');
    const { ensureTodayTipIssued, issuedTips } = mod.useBeanTips();
    ensureTodayTipIssued();
    expect(issuedTips.value.map((e) => e.tipId)).toEqual(['tip-b']);
  });
});

describe('useBeanTips — corrupted storage', () => {
  it.each([
    ['null', 'null'],
    ['scalar', '42'],
    ['array', '[]'],
    ['malformed JSON', '{not json'],
  ])('%s payload resets to empty v2 and warns', async (_label, raw) => {
    vi.resetModules();
    memberCounter++;
    familyMemberId.value = `member-${memberCounter}`;
    localStorage.setItem(currentKey(), raw);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const mod = await import('@/composables/useBeanTips');
    const { issuedTips, tipsEnabled } = mod.useBeanTips();
    expect(issuedTips.value).toEqual([]);
    expect(tipsEnabled.value).toBe(true);
    expect(warn).toHaveBeenCalled();
    const persisted = readJson();
    expect(persisted?.schemaVersion).toBe(2);
    warn.mockRestore();
  });
});

describe('useBeanTips — mute / enable', () => {
  it('mute mid-rotation preserves issuedTips history and stops issuance', async () => {
    const { ensureTodayTipIssued, muteAllTips, issuedTips, tipsEnabled } = await freshUseBeanTips();
    ensureTodayTipIssued();
    expect(issuedTips.value).toHaveLength(1);
    muteAllTips();
    expect(tipsEnabled.value).toBe(false);
    today.value = '2026-05-30';
    ensureTodayTipIssued();
    expect(issuedTips.value).toHaveLength(1); // history preserved, no new issuance
  });

  it('re-enable then issue picks the next eligible tip', async () => {
    const { ensureTodayTipIssued, muteAllTips, enableTips, issuedTips } = await freshUseBeanTips();
    ensureTodayTipIssued();
    muteAllTips();
    today.value = '2026-05-30';
    enableTips();
    ensureTodayTipIssued();
    expect(issuedTips.value.map((e) => e.tipId)).toEqual(['tip-a', 'tip-b']);
  });
});

describe('useBeanTips — exhaustion', () => {
  it('when all eligible tips are issued, ensureTodayTipIssued no-ops but advances lastTipShownDate', async () => {
    const { ensureTodayTipIssued, issuedTips } = await freshUseBeanTips();
    // Day 1: tip-a.
    ensureTodayTipIssued();
    // Day 2: tip-b (tip-cond is skipped — transactionCount === 0).
    today.value = '2026-05-30';
    ensureTodayTipIssued();
    expect(issuedTips.value).toHaveLength(2);
    // Day 3: nothing eligible — lastTipShownDate still advances.
    today.value = '2026-05-31';
    ensureTodayTipIssued();
    expect(issuedTips.value).toHaveLength(2);
    const persisted = readJson();
    expect(persisted?.lastTipShownDate).toBe('2026-05-31');
  });
});

describe('useBeanTips — condition gating', () => {
  it('a tip whose condition returns false is skipped', async () => {
    const { ensureTodayTipIssued, issuedTips } = await freshUseBeanTips();
    ensureTodayTipIssued();
    today.value = '2026-05-30';
    ensureTodayTipIssued();
    // tip-cond requires transactionCount > 0 (we mock it as 0) — never issued.
    expect(issuedTips.value.map((e) => e.tipId)).toEqual(['tip-a', 'tip-b']);
  });
});

describe('useBeanTips — persistence-failure observability (B1)', () => {
  it('BACKGROUND tick: a setItem throw warns + reportErrors but shows NO toast', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // happy-dom's localStorage methods aren't on Storage.prototype — spy on
    // the instance directly.
    const setSpy = vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new Error('quota exceeded');
    });
    showToast.mockClear();
    const { ensureTodayTipIssued } = await freshUseBeanTips();
    ensureTodayTipIssued();
    expect(warn).toHaveBeenCalled();
    expect(reportError).toHaveBeenCalledWith(
      expect.objectContaining({ surface: 'bean-tips-save' })
    );
    // Background issuance must stay quiet — no user-facing toast.
    expect(showToast).not.toHaveBeenCalled();
    setSpy.mockRestore();
    warn.mockRestore();
  });

  it('USER ACTION (muteAllTips): a setItem throw shows an error toast AND rolls back', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { muteAllTips, tipsEnabled } = await freshUseBeanTips();
    showToast.mockClear();
    // Fail the write only for the user action (state was already loaded/seeded).
    const setSpy = vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new Error('quota exceeded');
    });

    muteAllTips();

    // Toast surfaced (no silent failure) and the in-memory state rolled back so the
    // UI doesn't show a phantom "muted".
    expect(showToast).toHaveBeenCalledWith(
      'error',
      "Couldn't mute tips",
      expect.any(String),
      expect.objectContaining({ surface: 'bean-tips-toggle' })
    );
    expect(tipsEnabled.value).toBe(true);
    setSpy.mockRestore();
    warn.mockRestore();
  });
});
