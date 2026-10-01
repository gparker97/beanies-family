/**
 * Snapshot-at-open diff in the full-form modals (CRDT merge-safe writes, #117).
 *
 * An edit emits `{ id, data }` where `data` holds ONLY what the user changed, so a concurrent edit
 * to another field on another device is never overwritten. Clearing a field sends `undefined`
 * (the repository's delete signal). An untouched save emits an empty `data`: the parent still
 * calls `update`, which the worker turns into a no-op.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import { setActivePinia, createPinia } from 'pinia';
import AccountModal from '@/components/accounts/AccountModal.vue';
import AssetModal from '@/components/assets/AssetModal.vue';
import GoalModal from '@/components/goals/GoalModal.vue';
import FamilyMemberModal from '@/components/family/FamilyMemberModal.vue';
import BudgetSettingsModal from '@/components/budget/BudgetSettingsModal.vue';
import type { Account, Asset, Budget, FamilyMember, Goal } from '@/types/models';

vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    isEnglish: { value: true },
    isBeanieMode: { value: false },
  }),
}));
vi.mock('@/composables/useConfirm', () => ({ confirm: vi.fn().mockResolvedValue(true) }));
vi.mock('@/services/telemetry/logEvent', () => ({ logEvent: vi.fn() }));
vi.mock('@/composables/useInstitutionOptions', () => ({
  useInstitutionOptions: () => ({ options: { value: [] }, removeCustomInstitution: vi.fn() }),
  persistCustomInstitutionIfNeeded: vi.fn().mockResolvedValue(undefined),
}));

beforeEach(() => setActivePinia(createPinia()));

type Vm = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/** Mount closed, then open (the ordinary parent flow), and let the baseline capture settle. */
async function mountOpen(component: object, props: Record<string, unknown>) {
  const wrapper = mount(component as never, {
    props: { open: false, ...props } as never,
    shallow: true,
  });
  await wrapper.setProps({ open: true } as never);
  await nextTick();
  await nextTick();
  return wrapper;
}

async function saveEmitted(wrapper: ReturnType<typeof mount>): Promise<Record<string, unknown>> {
  (wrapper.vm as Vm).handleSave();
  await flushPromises();
  const events = wrapper.emitted('save')!;
  const payload = events[events.length - 1]![0] as Record<string, unknown>;
  // Edit emits `{ id, data }`; create emits the payload itself.
  return 'id' in payload && 'data' in payload ? (payload.data as Record<string, unknown>) : payload;
}

const ts = '2026-01-01T00:00:00.000Z';

describe('AccountModal', () => {
  const account: Account = {
    id: 'a1',
    memberId: 'm1',
    name: 'Everyday',
    type: 'checking',
    currency: 'USD',
    balance: 500,
    institution: 'Acme Bank',
    isActive: true,
    includeInNetWorth: true,
    coOwnerIds: ['m2'],
    createdAt: ts,
    updatedAt: ts,
  };

  it('an untouched edit emits an empty diff, so no balance adjustment is recorded', async () => {
    const w = await mountOpen(AccountModal, { account });
    expect(await saveEmitted(w)).toEqual({});
  });

  it('sends balance only when it changed', async () => {
    const w = await mountOpen(AccountModal, { account });
    (w.vm as Vm).balance = 650;
    expect(await saveEmitted(w)).toEqual({ balance: 650 });
  });

  it('renaming does not send the balance', async () => {
    const w = await mountOpen(AccountModal, { account });
    (w.vm as Vm).name = 'Renamed';
    const data = await saveEmitted(w);
    expect(data).toEqual({ name: 'Renamed' });
    expect('balance' in data).toBe(false);
  });

  it('clearing a text field sends undefined for that key', async () => {
    const w = await mountOpen(AccountModal, { account });
    (w.vm as Vm).institution = '';
    const data = await saveEmitted(w);
    expect(Object.keys(data)).toEqual(['institution']);
    expect(data.institution).toBeUndefined();
  });

  it('sends the co-owner array whole when it changed', async () => {
    const w = await mountOpen(AccountModal, { account });
    (w.vm as Vm).coOwnerIds = ['m2', 'm3'];
    expect(await saveEmitted(w)).toEqual({ coOwnerIds: ['m2', 'm3'] });
  });
});

describe('AssetModal', () => {
  const asset: Asset = {
    id: 's1',
    memberId: 'm1',
    type: 'real_estate',
    name: 'House',
    purchaseValue: 300000,
    currentValue: 400000,
    currency: 'USD',
    includeInNetWorth: true,
    notes: 'Corner lot',
    loan: { hasLoan: true, loanAmount: 200000, outstandingBalance: 150000, interestRate: 4 },
    createdAt: ts,
    updatedAt: ts,
  };

  it('an untouched edit emits an empty diff', async () => {
    const w = await mountOpen(AssetModal, { asset });
    expect(await saveEmitted(w)).toEqual({});
  });

  it('sends only the changed field', async () => {
    const w = await mountOpen(AssetModal, { asset });
    (w.vm as Vm).currentValue = 420000;
    expect(await saveEmitted(w)).toEqual({ currentValue: 420000 });
  });

  it('clearing the notes sends undefined', async () => {
    const w = await mountOpen(AssetModal, { asset });
    (w.vm as Vm).notes = '';
    const data = await saveEmitted(w);
    expect(Object.keys(data)).toEqual(['notes']);
    expect(data.notes).toBeUndefined();
  });

  it('keeps loan as ONE key, sent whole when any sub-field changed', async () => {
    const w = await mountOpen(AssetModal, { asset });
    (w.vm as Vm).outstandingBalance = 140000;
    const data = await saveEmitted(w);
    expect(Object.keys(data)).toEqual(['loan']);
    expect(data.loan).toEqual({
      hasLoan: true,
      loanAmount: 200000,
      outstandingBalance: 140000,
      interestRate: 4,
    });
  });
});

describe('GoalModal', () => {
  const goal: Goal = {
    id: 'g1',
    memberId: 'm1',
    name: 'Holiday',
    type: 'vacation',
    targetAmount: 1000,
    currentAmount: 250,
    currency: 'USD',
    priority: 'medium',
    deadline: '2026-12-01',
    isCompleted: false,
    createdAt: ts,
    updatedAt: ts,
  };

  it('an untouched edit emits an empty diff (no isCompleted, no currentAmount)', async () => {
    const w = await mountOpen(GoalModal, { goal });
    expect(await saveEmitted(w)).toEqual({});
  });

  it('a rename carries neither currentAmount nor isCompleted', async () => {
    const w = await mountOpen(GoalModal, { goal });
    (w.vm as Vm).name = 'Big holiday';
    const data = await saveEmitted(w);
    expect(data).toEqual({ name: 'Big holiday' });
    expect('currentAmount' in data).toBe(false);
    expect('isCompleted' in data).toBe(false);
  });

  it('sends currentAmount when it changed', async () => {
    const w = await mountOpen(GoalModal, { goal });
    (w.vm as Vm).currentAmount = 400;
    expect(await saveEmitted(w)).toEqual({ currentAmount: 400 });
  });

  it('clearing the deadline sends undefined', async () => {
    const w = await mountOpen(GoalModal, { goal });
    (w.vm as Vm).deadline = '';
    const data = await saveEmitted(w);
    expect(Object.keys(data)).toEqual(['deadline']);
    expect(data.deadline).toBeUndefined();
  });

  it('create still sends the full payload with isCompleted: false', async () => {
    const w = await mountOpen(GoalModal, {});
    (w.vm as Vm).name = 'New goal';
    (w.vm as Vm).targetAmount = 500;
    const data = await saveEmitted(w);
    expect(data).toMatchObject({ name: 'New goal', targetAmount: 500, isCompleted: false });
  });
});

describe('FamilyMemberModal', () => {
  const adult: FamilyMember = {
    id: 'f1',
    name: 'Alex',
    email: '1700000000000@temp.beanies.family',
    gender: 'male',
    ageGroup: 'adult',
    role: 'member',
    color: '#3b82f6',
    requiresPassword: true,
    canViewFinances: true,
    canEditActivities: true,
    canManagePod: false,
    createdAt: ts,
    updatedAt: ts,
  };

  it('an untouched edit emits an empty diff: a blank temp email is not re-minted', async () => {
    const w = await mountOpen(FamilyMemberModal, { member: adult });
    expect((w.vm as Vm).email).toBe('');
    expect(await saveEmitted(w)).toEqual({});
  });

  it('a rename sends only the name, never the email, role or flags', async () => {
    const w = await mountOpen(FamilyMemberModal, { member: adult });
    (w.vm as Vm).name = 'Alexander';
    const data = await saveEmitted(w);
    expect(data).toEqual({ name: 'Alexander' });
    expect('email' in data).toBe(false);
    expect('role' in data).toBe(false);
  });

  it('adult -> child carries the three permission flags as shown on screen', async () => {
    const w = await mountOpen(FamilyMemberModal, { member: adult });
    (w.vm as Vm).beanRole = 'child';
    const data = await saveEmitted(w);
    expect(data).toMatchObject({
      ageGroup: 'child',
      canViewFinances: true,
      canEditActivities: true,
      canManagePod: false,
    });
  });

  it('child -> adult keeps a finances toggle the form showed as off', async () => {
    const child: FamilyMember = { ...adult, ageGroup: 'child', canViewFinances: false };
    const w = await mountOpen(FamilyMemberModal, { member: child });
    (w.vm as Vm).beanRole = 'parent';
    const data = await saveEmitted(w);
    expect(data).toMatchObject({ ageGroup: 'adult', canViewFinances: false });
  });

  it('sends a typed email, and keeps a stored real email when the field is untouched', async () => {
    const real = { ...adult, email: 'alex@example.com' };
    const w = await mountOpen(FamilyMemberModal, { member: real });
    expect(await saveEmitted(w)).toEqual({});
    (w.vm as Vm).email = 'alex@new.example.com';
    expect(await saveEmitted(w)).toEqual({ email: 'alex@new.example.com' });
  });

  it('adult -> pet replaces a real email with a freshly minted temp address', async () => {
    const real = { ...adult, email: 'alex@example.com' };
    const w = await mountOpen(FamilyMemberModal, { member: real });
    (w.vm as Vm).beanRole = 'pet';
    const data = await saveEmitted(w);
    expect(data).toMatchObject({ isPet: true });
    expect(String(data.email)).toMatch(/^\d+@temp\.beanies\.family$/);
    expect(data.email).not.toBe('alex@example.com');
  });

  it('create mints a temp email and starts the member as role member', async () => {
    const w = await mountOpen(FamilyMemberModal, {});
    (w.vm as Vm).name = 'Sam';
    const data = await saveEmitted(w);
    expect(data).toMatchObject({ name: 'Sam', role: 'member' });
    expect(String(data.email)).toMatch(/@temp\.beanies\.family$/);
  });
});

describe('BudgetSettingsModal', () => {
  const budget: Budget = {
    id: 'b1',
    mode: 'fixed',
    totalAmount: 3000,
    currency: 'USD',
    categories: [
      { categoryId: 'dining_out', amount: 200 },
      { categoryId: 'groceries', amount: 800 },
    ],
    isActive: true,
    createdAt: ts,
    updatedAt: ts,
  } as Budget;

  it('an untouched edit emits an empty diff', async () => {
    const w = await mountOpen(BudgetSettingsModal, { budget });
    expect(await saveEmitted(w)).toEqual({});
  });

  it('changing the total sends only totalAmount', async () => {
    const w = await mountOpen(BudgetSettingsModal, { budget });
    (w.vm as Vm).totalAmount = 3500;
    expect(await saveEmitted(w)).toEqual({ totalAmount: 3500 });
  });

  it('a category edit sends the categories array whole and nothing else', async () => {
    const w = await mountOpen(BudgetSettingsModal, { budget });
    (w.vm as Vm).categoryAllocations = { groceries: 900, dining_out: 200 };
    const data = await saveEmitted(w);
    expect(Object.keys(data)).toEqual(['categories']);
    expect(data.categories).toEqual([
      { categoryId: 'dining_out', amount: 200 },
      { categoryId: 'groceries', amount: 900 },
    ]);
  });

  it('create sends the full payload, active', async () => {
    const w = await mountOpen(BudgetSettingsModal, {});
    (w.vm as Vm).mode = 'fixed';
    (w.vm as Vm).totalAmount = 1000;
    const data = await saveEmitted(w);
    expect(data).toMatchObject({ mode: 'fixed', totalAmount: 1000, isActive: true });
  });
});
