import { describe, it, expect } from 'vitest';
import { parseDriveOpenState } from '../driveOpenState';

describe('parseDriveOpenState', () => {
  describe('happy path', () => {
    it('extracts the first file id from a valid open-action payload', () => {
      const raw = JSON.stringify({ ids: ['FILE_ABC'], action: 'open', userId: '12345' });
      expect(parseDriveOpenState(raw)).toBe('FILE_ABC');
    });

    it('returns the first id when multiple are present', () => {
      const raw = JSON.stringify({ ids: ['FIRST', 'SECOND'], action: 'open' });
      expect(parseDriveOpenState(raw)).toBe('FIRST');
    });

    it('handles double-URL-encoded payloads', () => {
      const inner = JSON.stringify({ ids: ['ENCODED_ID'], action: 'open' });
      const outer = encodeURIComponent(inner);
      expect(parseDriveOpenState(outer)).toBe('ENCODED_ID');
    });

    it('handles payloads with extra fields (resourceKeys, userId)', () => {
      const raw = JSON.stringify({
        ids: ['SHARED_FILE'],
        action: 'open',
        userId: '108472...',
        resourceKeys: { SHARED_FILE: 'KEY_ABC' },
      });
      expect(parseDriveOpenState(raw)).toBe('SHARED_FILE');
    });
  });

  describe('rejected inputs', () => {
    it('returns null for an empty string', () => {
      expect(parseDriveOpenState('')).toBeNull();
    });

    it('returns null for non-string values', () => {
      expect(parseDriveOpenState(null)).toBeNull();
      expect(parseDriveOpenState(undefined)).toBeNull();
      expect(parseDriveOpenState(123)).toBeNull();
      expect(parseDriveOpenState({ ids: ['X'], action: 'open' })).toBeNull();
      expect(parseDriveOpenState(['array', 'of', 'strings'])).toBeNull();
    });

    it('returns null for malformed JSON', () => {
      expect(parseDriveOpenState('not json')).toBeNull();
      expect(parseDriveOpenState('{bad: json}')).toBeNull();
      expect(parseDriveOpenState('{')).toBeNull();
    });

    it('rejects action="create" (we only handle open)', () => {
      const raw = JSON.stringify({ ids: ['X'], action: 'create' });
      expect(parseDriveOpenState(raw)).toBeNull();
    });

    it('rejects payloads missing the action field', () => {
      const raw = JSON.stringify({ ids: ['X'] });
      expect(parseDriveOpenState(raw)).toBeNull();
    });

    it('rejects payloads missing the ids array', () => {
      const raw = JSON.stringify({ action: 'open' });
      expect(parseDriveOpenState(raw)).toBeNull();
    });

    it('rejects payloads with empty ids array', () => {
      const raw = JSON.stringify({ ids: [], action: 'open' });
      expect(parseDriveOpenState(raw)).toBeNull();
    });

    it('rejects payloads where the first id is empty or non-string', () => {
      expect(parseDriveOpenState(JSON.stringify({ ids: [''], action: 'open' }))).toBeNull();
      expect(parseDriveOpenState(JSON.stringify({ ids: [null], action: 'open' }))).toBeNull();
      expect(parseDriveOpenState(JSON.stringify({ ids: [42], action: 'open' }))).toBeNull();
    });
  });
});
