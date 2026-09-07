/**
 * The invite message builder — and specifically the `$&` regression it exists to fix.
 */
import { describe, it, expect } from 'vitest';
import { buildInviteShareBody, buildInviteEmailSubject } from '../inviteShareText';
import type { UIStringKey } from '@/services/translation/uiStrings';

const t = ((key: string) => {
  if (key === 'share.messageBody') return '{member} invited you to {family}! Join here: {link}';
  if (key === 'share.emailSubject') return 'Join {family} on beanies';
  return key;
}) as unknown as (key: UIStringKey) => string;

const base = {
  link: 'https://app.beanies.family/join#x',
  familyName: 'The Parkers',
  memberName: 'Greg',
  t,
};

describe('buildInviteShareBody', () => {
  it('fills every placeholder', () => {
    expect(buildInviteShareBody(base)).toBe(
      'Greg invited you to The Parkers! Join here: https://app.beanies.family/join#x'
    );
  });

  it('does not garble a family name containing $& — the live bug this move fixed', () => {
    // `'…{family}…'.replace('{family}', 'Smith $& Co')` inserts the MATCHED TEXT for `$&`,
    // producing "Smith {family} Co" in a message sent to a stranger.
    const out = buildInviteShareBody({ ...base, familyName: 'Smith $& Co' });
    expect(out).toContain('Smith $& Co');
    expect(out).not.toContain('{family}');
  });

  it('does not garble a member name containing $`', () => {
    const out = buildInviteShareBody({ ...base, memberName: 'Greg $` Jr' });
    expect(out).toContain('Greg $` Jr');
  });
});

describe('buildInviteEmailSubject', () => {
  it('fills the family name, literally', () => {
    expect(buildInviteEmailSubject({ familyName: 'Smith $& Co', t })).toBe(
      'Join Smith $& Co on beanies'
    );
  });
});
