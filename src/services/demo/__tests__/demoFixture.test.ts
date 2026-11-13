/**
 * REVIEW-DEMO fixture integrity.
 *
 * The fixture is data, so the useful tests are about its *invariants*: it must
 * be pure, it must never look stale, it must never reference a person who
 * doesn't exist, it must not collide with the owner row `signUp` already wrote,
 * and it must contain nothing that could be mistaken for real contact details.
 */
import { describe, it, expect } from 'vitest';
import { materializeFixture } from '@/services/demo/demoFixture';
import { choreMarkId } from '@/utils/chores';
import { toDateInputValue } from '@/utils/date';
import type {
  FamilyMember,
  Account,
  Transaction,
  FamilyActivity,
  TodoItem,
  Chore,
  ChoreMark,
} from '@/types/models';

const OWNER = 'owner-member-id';
const TODAY = new Date('2026-08-20T09:00:00Z');

function build(today = TODAY, owner = OWNER) {
  const f = materializeFixture({ today, ownerMemberId: owner });
  return {
    members: f.familyMembers as FamilyMember[],
    accounts: f.accounts as Account[],
    transactions: f.transactions as Transaction[],
    activities: f.activities as FamilyActivity[],
    todos: f.todos as TodoItem[],
    chores: f.chores as Chore[],
    choreMarks: f.choreMarks as ChoreMark[],
    raw: f,
  };
}

describe('materializeFixture', () => {
  it('is pure — identical inputs give identical output', () => {
    expect(build().raw).toEqual(build().raw);
  });

  it("never emits the owner as a member (it would clobber signUp's owner row)", () => {
    expect(build().members.some((m) => m.id === OWNER)).toBe(false);
  });

  it('gives the owner something to own, so the pod reads as theirs', () => {
    const { accounts, activities, todos } = build();
    expect(accounts.some((a) => a.memberId === OWNER)).toBe(true);
    expect(activities.every((a) => a.createdBy === OWNER)).toBe(true);
    expect(todos.every((t) => t.createdBy === OWNER)).toBe(true);
  });

  it('resolves every member reference to a fixture member or the owner', () => {
    const { members, accounts, activities, todos } = build();
    const known = new Set([OWNER, ...members.map((m) => m.id)]);

    for (const a of accounts) {
      expect(known).toContain(a.memberId);
      for (const id of [...(a.coOwnerIds ?? []), ...(a.forMemberIds ?? [])]) {
        expect(known).toContain(id);
      }
    }
    for (const a of activities) {
      for (const id of [...(a.assigneeIds ?? []), a.dropoffMemberId, a.pickupMemberId]) {
        if (id) expect(known).toContain(id);
      }
    }
    for (const t of todos) {
      for (const id of t.assigneeIds ?? []) expect(known).toContain(id);
    }
  });

  it('points every transaction at a real account', () => {
    const { accounts, transactions } = build();
    const ids = new Set(accounts.map((a) => a.id));
    for (const t of transactions) expect(ids).toContain(t.accountId);
  });

  // The demo must not look abandoned six months from now.
  it('derives every date from "today" rather than hardcoding one', () => {
    const a = build(new Date('2026-08-20T09:00:00Z'));
    const b = build(new Date('2027-03-05T09:00:00Z'));

    const dates = (f: ReturnType<typeof build>) => [
      ...f.transactions.map((t) => t.date),
      ...f.activities.map((x) => x.date),
      ...f.todos.map((t) => t.dueDate).filter(Boolean),
    ];
    // No date survives a seven-month shift unchanged.
    expect(dates(a).some((d) => dates(b).includes(d as string))).toBe(false);
  });

  it('puts activities in the week ahead and transactions in the recent past', () => {
    const { transactions, activities } = build();
    const today = TODAY.toISOString().slice(0, 10);
    expect(activities.every((a) => a.date >= today)).toBe(true);
    expect(transactions.every((t) => t.date <= today)).toBe(true);
  });

  it('uses only unresolvable example emails', () => {
    for (const m of build().members) {
      expect(m.email.endsWith('@example.invalid')).toBe(true);
    }
  });

  it('has unique ids within every collection', () => {
    const f = build();
    for (const list of [f.members, f.accounts, f.transactions, f.activities, f.todos]) {
      const ids = (list as Array<{ id: string }>).map((e) => e.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it('is big enough to look like a real family, small enough to seed fast', () => {
    const f = build();
    const total =
      f.members.length +
      f.accounts.length +
      f.transactions.length +
      f.activities.length +
      f.todos.length;
    expect(total).toBeGreaterThan(40);
    expect(total).toBeLessThan(90);
  });

  describe('the choreboard (#146)', () => {
    it('has chores for the kids in every block, each for living, non-pet people only', () => {
      const { members, chores } = build();
      const humans = new Set(members.filter((m) => !m.isPet).map((m) => m.id));
      const kids = new Set(members.filter((m) => m.ageGroup === 'child').map((m) => m.id));
      expect(chores.length).toBeGreaterThanOrEqual(4);
      expect(new Set(chores.map((c) => c.block))).toEqual(
        new Set(['morning', 'afternoon', 'evening', 'anytime'])
      );
      for (const c of chores) {
        expect(c.assigneeIds.length).toBeGreaterThan(0);
        for (const id of c.assigneeIds) expect(humans).toContain(id);
        expect(c.createdBy).toBe(OWNER);
      }
      // More than one bean has chores, so the home shows several cards.
      const owners = new Set(chores.flatMap((c) => c.assigneeIds));
      expect([...owners].filter((id) => kids.has(id)).length).toBeGreaterThanOrEqual(2);
    });

    it('ticks a couple of chores on TODAY (the device-local day the chore clock reads)', () => {
      const today = new Date('2027-03-05T09:00:00Z');
      const { chores, choreMarks } = build(today);
      const ymd = toDateInputValue(today);
      const byId = new Map(chores.map((c) => [c.id, c]));
      expect(choreMarks.length).toBeGreaterThanOrEqual(2);
      for (const m of choreMarks) {
        expect(m.kind).toBe('done');
        expect(m.date).toBe(ymd);
        expect(m.id).toBe(choreMarkId('done', m.memberId, m.date, m.ref));
        const c = byId.get(m.ref);
        expect(c).toBeDefined();
        expect(c!.assigneeIds).toContain(m.memberId);
        // An every-day chore, so the tick counts whatever weekday the reviewer opens it on.
        expect(c!.days?.length ?? 0).toBe(0);
      }
      expect(new Set(choreMarks.map((m) => m.id)).size).toBe(choreMarks.length);
      // No block is finished by the seed, on any weekday (counting only every-day chores, the
      // weekend's set): the reviewer's own completing tick still celebrates.
      for (const m of choreMarks) {
        const block = byId.get(m.ref)!.block;
        const everyDay = chores.filter(
          (x) => x.block === block && x.assigneeIds.includes(m.memberId) && !x.days?.length
        );
        const done = choreMarks.filter(
          (x) => x.memberId === m.memberId && everyDay.some((c) => c.id === x.ref)
        );
        expect(done.length).toBeLessThan(everyDay.length);
      }
    });

    it('has unique chore ids', () => {
      const ids = build().chores.map((c) => c.id);
      expect(new Set(ids).size).toBe(ids.length);
    });
  });
});
