import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  getLastGoogleAccount,
  setLastGoogleAccount,
  clearLastGoogleAccount,
} from '../fileHandleStore';

const KEY = 'beanies_last_google_account';

describe('last-google-account breadcrumb (#62)', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('round-trips email + familyId', () => {
    setLastGoogleAccount('greg@example.com', 'family-1');
    expect(getLastGoogleAccount()).toEqual({ email: 'greg@example.com', familyId: 'family-1' });
  });

  it('returns null when absent', () => {
    expect(getLastGoogleAccount()).toBeNull();
  });

  it('returns null (never throws) on corrupt JSON', () => {
    localStorage.setItem(KEY, '{not json');
    expect(getLastGoogleAccount()).toBeNull();
  });

  it('returns null when the shape is wrong (missing fields)', () => {
    localStorage.setItem(KEY, JSON.stringify({ email: 'x@example.com' })); // no familyId
    expect(getLastGoogleAccount()).toBeNull();
  });

  it('clear removes the record', () => {
    setLastGoogleAccount('a@example.com', 'fam');
    clearLastGoogleAccount();
    expect(getLastGoogleAccount()).toBeNull();
  });

  it('holds NO secret — only email + familyId are stored', () => {
    setLastGoogleAccount('a@example.com', 'fam');
    const raw = localStorage.getItem(KEY)!;
    const parsed = JSON.parse(raw);
    expect(Object.keys(parsed).sort()).toEqual(['email', 'familyId']);
  });
});
