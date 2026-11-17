import { describe, it, expect } from 'vitest';
import { anotherGrantSharesAccount, type GrantGuardInput } from '../grantGuard';

function input(overrides: Partial<GrantGuardInput> = {}): GrantGuardInput {
  return {
    email: 'mum@example.com',
    exceptId: 'c1',
    driveEmail: 'drive@example.com',
    connections: [{ id: 'c1', accountEmail: 'mum@example.com' }],
    viewAccounts: [],
    ...overrides,
  };
}

describe('anotherGrantSharesAccount', () => {
  it('is false when nothing else uses the account (safe to revoke)', () => {
    expect(anotherGrantSharesAccount(input())).toBe(false);
  });

  it('is true when Drive uses the same account, ignoring case', () => {
    expect(anotherGrantSharesAccount(input({ driveEmail: 'Mum@Example.com' }))).toBe(true);
  });

  it('is true when another sync connection uses the same account', () => {
    expect(
      anotherGrantSharesAccount(
        input({
          connections: [
            { id: 'c1', accountEmail: 'mum@example.com' },
            { id: 'c2', accountEmail: 'MUM@example.com' },
          ],
        })
      )
    ).toBe(true);
  });

  it('never counts the holder being removed as sharing with itself', () => {
    expect(
      anotherGrantSharesAccount(
        input({ connections: [{ id: 'c1', accountEmail: 'mum@example.com' }] })
      )
    ).toBe(false);
  });

  it('is true when a view account uses the same account', () => {
    expect(
      anotherGrantSharesAccount(
        input({ viewAccounts: [{ id: 'v1', accountEmail: 'mum@example.com' }] })
      )
    ).toBe(true);
  });

  it('ignores holders on positively different accounts', () => {
    expect(
      anotherGrantSharesAccount(
        input({
          connections: [
            { id: 'c1', accountEmail: 'mum@example.com' },
            { id: 'c2', accountEmail: 'dad@example.com' },
          ],
          viewAccounts: [{ id: 'v1', accountEmail: 'grandma@example.com' }],
        })
      )
    ).toBe(false);
  });

  it('a pending consent (no exceptId) is shared with an existing connection on its account', () => {
    expect(anotherGrantSharesAccount(input({ exceptId: undefined }))).toBe(true);
  });

  describe('fails safe on every uncertainty', () => {
    it.each([null, undefined, '', 'unknown'])('token email %s counts as shared', (email) => {
      expect(anotherGrantSharesAccount(input({ email }))).toBe(true);
    });

    it.each([null, undefined, '', 'unknown'])('Drive email %s counts as shared', (driveEmail) => {
      expect(anotherGrantSharesAccount(input({ driveEmail }))).toBe(true);
    });

    it.each([null, undefined, 'unknown'])(
      'another holder with email %s counts as shared',
      (accountEmail) => {
        expect(
          anotherGrantSharesAccount(
            input({
              connections: [
                { id: 'c1', accountEmail: 'mum@example.com' },
                { id: 'c2', accountEmail },
              ],
            })
          )
        ).toBe(true);
      }
    );
  });
});
