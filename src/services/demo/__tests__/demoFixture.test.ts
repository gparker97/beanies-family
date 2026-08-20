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
import type { FamilyMember, Account, Transaction, FamilyActivity, TodoItem } from '@/types/models';

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
});
