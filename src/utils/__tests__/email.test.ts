import { describe, it, expect } from 'vitest';
import { isValidEmail, isTemporaryEmail, realEmail } from '../email';

describe('isValidEmail', () => {
  it.each(['user@example.com', 'a@b.co', 'user+tag@domain.org', 'first.last@sub.domain.com'])(
    'returns true for valid email: %s',
    (email) => {
      expect(isValidEmail(email)).toBe(true);
    }
  );

  it.each([
    '',
    'no-at-sign',
    '@no-local.com',
    'no-domain@',
    'spaces in@email.com',
    'a'.repeat(255) + '@example.com',
  ])('returns false for invalid email: %s', (email) => {
    expect(isValidEmail(email)).toBe(false);
  });

  it('trims whitespace before validating', () => {
    expect(isValidEmail('  user@example.com  ')).toBe(true);
  });
});

describe('isTemporaryEmail', () => {
  it('detects setup.local emails', () => {
    expect(isTemporaryEmail('pending-abc@setup.local')).toBe(true);
  });

  it('detects temp.beanies.family emails', () => {
    expect(isTemporaryEmail('member@temp.beanies.family')).toBe(true);
  });

  it('returns false for real emails', () => {
    expect(isTemporaryEmail('user@example.com')).toBe(false);
  });
});

describe('realEmail', () => {
  it('returns a valid address unchanged', () => {
    expect(realEmail('user@example.com')).toBe('user@example.com');
  });

  it('returns the trimmed address, keeping its case', () => {
    expect(realEmail('  User@Example.com  ')).toBe('User@Example.com');
  });

  it.each([
    'abc@temp.beanies.family',
    'pending-abc@setup.local',
    '  pending-abc@setup.local  ',
    'ABC@Temp.Beanies.Family',
    '',
    '   ',
    'no-at-sign',
    'a'.repeat(255) + '@example.com',
  ])('returns null for a placeholder or invalid address: %j', (email) => {
    expect(realEmail(email)).toBeNull();
  });

  it('returns null for null and undefined', () => {
    expect(realEmail(null)).toBeNull();
    expect(realEmail(undefined)).toBeNull();
  });
});
