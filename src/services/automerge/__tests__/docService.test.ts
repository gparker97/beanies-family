// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as Automerge from '@automerge/automerge';
import {
  initDoc,
  loadDoc,
  saveDoc,
  getDoc,
  changeDoc,
  mergeDoc,
  replaceDoc,
  resetDoc,
  onDocPersistNeeded,
  flushPersist,
  docVersion,
} from '../docService';
import type { FamilyDocument } from '@/types/automerge';

describe('docService', () => {
  beforeEach(() => {
    resetDoc();
  });

  describe('initDoc', () => {
    it('creates empty doc with all collections', () => {
      const doc = initDoc();

      expect(doc.familyMembers).toEqual({});
      expect(doc.accounts).toEqual({});
      expect(doc.transactions).toEqual({});
      expect(doc.assets).toEqual({});
      expect(doc.goals).toEqual({});
      expect(doc.budgets).toEqual({});
      expect(doc.recurringItems).toEqual({});
      expect(doc.todos).toEqual({});
      expect(doc.activities).toEqual({});
      expect(doc.settings).toBeNull();
    });
  });

  describe('getDoc', () => {
    it('throws when no doc loaded', () => {
      expect(() => getDoc()).toThrow('No Automerge document loaded');
    });

    it('returns doc after init', () => {
      initDoc();
      expect(getDoc()).toBeDefined();
    });
  });

  describe('changeDoc', () => {
    it('applies mutations', () => {
      initDoc();
      changeDoc((d) => {
        d.familyMembers['test-id'] = {
          id: 'test-id',
          name: 'Test',
          email: 'test@example.com',
          gender: 'other',
          ageGroup: 'adult',
          role: 'member',
          color: '#000',
          requiresPassword: false,
          createdAt: '2026-01-01',
          updatedAt: '2026-01-01',
        };
      });

      const doc = getDoc();
      const member = doc.familyMembers['test-id'];
      expect(member).toBeDefined();
      expect(member!.name).toBe('Test');
    });

    it('bumps docVersion', () => {
      initDoc();
      const before = docVersion.value;
      changeDoc((d) => {
        d.familyMembers['x'] = {} as any;
      });
      expect(docVersion.value).toBe(before + 1);
    });

    it('schedules debounced persist callback', async () => {
      const callback = vi.fn();
      onDocPersistNeeded(callback);
      initDoc();

      changeDoc((d) => {
        d.familyMembers['x'] = {} as any;
      });

      // Not called immediately (debounced)
      expect(callback).not.toHaveBeenCalled();

      // Flush fires it
      flushPersist();
      expect(callback).toHaveBeenCalledTimes(1);
    });
  });

  describe('saveDoc / loadDoc round-trip', () => {
    it('preserves state through save and load', () => {
      initDoc();
      changeDoc((d) => {
        d.familyMembers['member-1'] = {
          id: 'member-1',
          name: 'Alice',
          email: 'alice@example.com',
          gender: 'female',
          ageGroup: 'adult',
          role: 'owner',
          color: '#FF0000',
          requiresPassword: false,
          createdAt: '2026-01-01',
          updatedAt: '2026-01-01',
        };
      });

      const binary = saveDoc();
      expect(binary).toBeInstanceOf(Uint8Array);

      // Reset and reload
      resetDoc();
      expect(() => getDoc()).toThrow();

      loadDoc(binary);
      const doc = getDoc();
      expect(doc.familyMembers['member-1']!.name).toBe('Alice');
    });
  });

  describe('mergeDoc', () => {
    it('merges concurrent changes from two docs', () => {
      // Create doc A
      initDoc();
      changeDoc((d) => {
        d.familyMembers['member-a'] = {
          id: 'member-a',
          name: 'Alice',
          email: 'alice@example.com',
          gender: 'female',
          ageGroup: 'adult',
          role: 'owner',
          color: '#FF0000',
          requiresPassword: false,
          createdAt: '2026-01-01',
          updatedAt: '2026-01-01',
        };
      });

      // Fork: create doc B from the saved binary
      const binaryBeforeFork = saveDoc();
      const docB = Automerge.load<FamilyDocument>(binaryBeforeFork);

      // Make changes on A (current)
      changeDoc((d) => {
        d.accounts['acct-1'] = {
          id: 'acct-1',
          memberId: 'member-a',
          name: 'Checking',
          type: 'checking',
          currency: 'USD',
          balance: 1000,
          isActive: true,
          includeInNetWorth: true,
          createdAt: '2026-01-01',
          updatedAt: '2026-01-01',
        };
      });

      // Make changes on B
      const docBChanged = Automerge.change(docB, (d) => {
        d.familyMembers['member-b'] = {
          id: 'member-b',
          name: 'Bob',
          email: 'bob@example.com',
          gender: 'male',
          ageGroup: 'adult',
          role: 'member',
          color: '#0000FF',
          requiresPassword: false,
          createdAt: '2026-01-02',
          updatedAt: '2026-01-02',
        };
      });

      // Merge B into A
      mergeDoc(docBChanged);

      const merged = getDoc();
      expect(merged.familyMembers['member-a']).toBeDefined();
      expect(merged.familyMembers['member-b']).toBeDefined();
      expect(merged.accounts['acct-1']).toBeDefined();
    });
  });

  describe('replaceDoc / resetDoc', () => {
    it('replaceDoc swaps the current doc', () => {
      initDoc();
      const initial: FamilyDocument = {
        familyMembers: {},
        accounts: {},
        transactions: {},
        assets: {},
        goals: {},
        budgets: {},
        recurringItems: {},
        todos: {},
        activities: {},
        vacations: {},
        photos: {},
        favorites: {},
        sayings: {},
        memberNotes: {},
        allergies: {},
        medications: {},
        medicationLogs: {},
        recipes: {},
        cookLogs: {},
        emergencyContacts: {},
        settings: null,
      };
      const newDoc = Automerge.from(
        initial as unknown as Record<string, unknown>
      ) as Automerge.Doc<FamilyDocument>;

      const replaced = Automerge.change(newDoc, (d) => {
        d.familyMembers['replaced'] = {
          id: 'replaced',
          name: 'Replaced',
          email: 'replaced@example.com',
          gender: 'other',
          ageGroup: 'adult',
          role: 'member',
          color: '#000',
          requiresPassword: false,
          createdAt: '2026-01-01',
          updatedAt: '2026-01-01',
        };
      });

      replaceDoc(replaced);
      expect(getDoc().familyMembers['replaced']).toBeDefined();
    });

    it('resetDoc sets doc to null', () => {
      initDoc();
      expect(getDoc()).toBeDefined();
      resetDoc();
      expect(() => getDoc()).toThrow();
    });
  });

  describe('saveDoc throws when no doc', () => {
    it('throws when no doc loaded', () => {
      expect(() => saveDoc()).toThrow('No Automerge document loaded');
    });
  });

  describe('flushPersist', () => {
    it('fires callback immediately', () => {
      const callback = vi.fn();
      onDocPersistNeeded(callback);
      initDoc();

      changeDoc((d) => {
        d.familyMembers['x'] = {} as any;
      });

      flushPersist();
      expect(callback).toHaveBeenCalledTimes(1);
    });

    it('does nothing when no callback registered', () => {
      // Should not throw
      flushPersist();
    });
  });
});
