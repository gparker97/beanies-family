import { describe, expect, it } from 'vitest';
import { isChangeRecipient, type ChangeAudienceMember } from './audience';

const adult: ChangeAudienceMember = { id: 'mum', role: 'admin', ageGroup: 'adult' };
const owner: ChangeAudienceMember = { id: 'dad', role: 'owner', ageGroup: undefined as never };
const child: ChangeAudienceMember = { id: 'kid', role: 'member', ageGroup: 'child' };
const pet: ChangeAudienceMember = { id: 'dog', role: 'member', ageGroup: 'adult', isPet: true };

describe('isChangeRecipient: every adult, plus a travelling child', () => {
  const trip = ['mum', 'dad', 'kid'];

  it('adults always, travelling or not', () => {
    expect(isChangeRecipient(adult, { travellerIds: ['kid'], tripAssigneeIds: trip })).toBe(true);
    expect(isChangeRecipient(owner, { travellerIds: [], tripAssigneeIds: [] })).toBe(true);
  });

  it('a child only on their own segment', () => {
    expect(isChangeRecipient(child, { travellerIds: ['kid'], tripAssigneeIds: trip })).toBe(true);
    expect(isChangeRecipient(child, { travellerIds: ['mum'], tripAssigneeIds: trip })).toBe(false);
  });

  it('undefined travellers = the whole trip', () => {
    expect(isChangeRecipient(child, { tripAssigneeIds: trip })).toBe(true);
    expect(isChangeRecipient(child, { tripAssigneeIds: ['mum'] })).toBe(false);
  });

  it('pets never', () => {
    expect(isChangeRecipient(pet, { tripAssigneeIds: ['dog'] })).toBe(false);
  });
});
