import { describe, it, expect } from 'vitest';
import {
  UI_STRINGS,
  BEANIE_STRINGS,
  getSourceText,
  getAllKeys,
  getStringHash,
  getAllHashes,
} from './uiStrings';
import type { UIStringKey } from './uiStrings';

describe('uiStrings', () => {
  describe('BEANIE_STRINGS', () => {
    it('every key in BEANIE_STRINGS also exists in UI_STRINGS', () => {
      const uiKeys = new Set(Object.keys(UI_STRINGS));
      for (const key of Object.keys(BEANIE_STRINGS)) {
        expect(uiKeys.has(key), `BEANIE_STRINGS key "${key}" not found in UI_STRINGS`).toBe(true);
      }
    });

    it('no BEANIE_STRINGS value is empty or whitespace-only', () => {
      for (const [key, value] of Object.entries(BEANIE_STRINGS)) {
        expect(
          value!.trim().length > 0,
          `BEANIE_STRINGS["${key}"] is empty or whitespace-only`
        ).toBe(true);
      }
    });

    it('BEANIE_STRINGS is a strict subset of UI_STRINGS keys', () => {
      const beanieKeys = Object.keys(BEANIE_STRINGS);
      const uiKeys = Object.keys(UI_STRINGS);
      expect(beanieKeys.length).toBeLessThan(uiKeys.length);
      expect(beanieKeys.every((k) => k in UI_STRINGS)).toBe(true);
    });

    it('has at least 100 beanie overrides', () => {
      expect(Object.keys(BEANIE_STRINGS).length).toBeGreaterThanOrEqual(100);
    });
  });

  describe('UI_STRINGS', () => {
    it('values match getSourceText() output', () => {
      const keys = getAllKeys();
      for (const key of keys) {
        expect(UI_STRINGS[key]).toBe(getSourceText(key));
      }
    });

    it('has all expected key namespaces', () => {
      const keys = getAllKeys();
      const namespaces = new Set(keys.map((k) => k.split('.')[0]));
      expect(namespaces).toContain('app');
      expect(namespaces).toContain('nav');
      expect(namespaces).toContain('dashboard');
      expect(namespaces).toContain('accounts');
      expect(namespaces).toContain('transactions');
      expect(namespaces).toContain('assets');
      expect(namespaces).toContain('goals');
      expect(namespaces).toContain('family');
      expect(namespaces).toContain('settings');
    });
  });

  describe('hash functions', () => {
    it('getStringHash returns a non-empty string for all keys', () => {
      const keys = getAllKeys();
      for (const key of keys) {
        const hash = getStringHash(key);
        expect(hash.length).toBeGreaterThan(0);
      }
    });

    it('getAllHashes returns a hash for every key', () => {
      const keys = getAllKeys();
      const hashes = getAllHashes();
      for (const key of keys) {
        expect(hashes[key]).toBeDefined();
        expect(hashes[key].length).toBeGreaterThan(0);
      }
    });

    it('different strings produce different hashes', () => {
      const hash1 = getStringHash('dashboard.netWorth' as UIStringKey);
      const hash2 = getStringHash('dashboard.assets' as UIStringKey);
      expect(hash1).not.toBe(hash2);
    });
  });
  describe('important-surface beanie values', () => {
    // Beanie mode swaps register, not meaning. On surfaces where a family could
    // lose work, money, or access, the `beanie` value must keep the real nouns
    // (device, changes, data, family file, member). "bean" standing in for a
    // device in one clause and for unsaved changes in the next is how the
    // lineage banner became unreadable on 2026-09-08. `pod` and `.beanpod` are
    // brand nouns and stay; the bare app name "beanies" is allowed unless it is
    // being used as a noun for data ("your beanies").
    const IMPORTANT_PREFIXES = [
      'podLineage.',
      'podMerge.',
      'podUnreadable.',
      'podTooLarge.',
      'podCredentialStale.',
      'resumeSetup.pod',
      'resumeSetup.subtitle',
      'sync.',
      'docWorker.',
      'error.',
      'app.initError.',
      'auth.',
      'reauth.',
      'password.',
      'pin.',
      'recovery.',
      'passkey.',
      'loginFlow.recovery',
      'loginV6.unlock',
      'loginV6.pickBeanInfoText',
      'loginV6.signInPasswordHint',
      'join.error.',
      'join.inviteToken',
      'join.fileMismatch',
      'join.needsFile',
      'join.familyNotFound',
      'join.noUnclaimedMembers',
      'join.pickerPrompt.',
      'join.loadingFromCloud',
      'googleDrive.',
      'googleDisconnect.',
      'calendarSync.reconnect.',
      'calendarSync.disconnect.',
      'calendarSync.toast.',
      'confirm.',
      'transferOwnership.',
      'permissions.',
      'settings.clear',
      'settings.deleteFamily',
      'settings.switch',
      'settings.loadedOtherFamily',
      'settings.export',
      'settings.familyKey',
      'settings.familyData',
      'settings.cachePersist',
      'settings.card.dataManagement',
      'settings.card.familyData',
      'installNudge.',
      'header.refreshUnopenable',
      'pwa.offlineBanner',
      'setupProgress.error.',
      'inviteWizard.step1.faq.a1',
      'invite.shareEmail.error',
      // Resetting another member's PIN is a credential surface: a euphemism here could
      // have someone hand out the wrong secret, or think nothing changed when it did.
      'family.resetPin.',
      'family.deleteConfirm',
      'family.deleteMember',
      'family.discardChanges',
      'family.normalizeRolesFailed',
      'family.addMemberFailed',
      'accountView.adjustError.',
      'goalContribute.error.',
      'medicationLog.errors.',
    ];
    const KEY_SUFFIXES =
      /(deleteConfirm|DeleteConfirm|ConfirmMessage|confirmMessage|Failed|Error)$/;
    const BEAN_WORD =
      /\b(beans?|beanie)\b|(?<=\b(?:your|all|my|our|the|these|those)\s)beanies\b(?!\.family)/gi;

    it('use real nouns, not bean euphemisms', () => {
      const bad: string[] = [];
      for (const [key, beanie] of Object.entries(BEANIE_STRINGS)) {
        const important =
          IMPORTANT_PREFIXES.some((p) => key.startsWith(p)) || KEY_SUFFIXES.test(key);
        if (!important) continue;
        const en = UI_STRINGS[key as UIStringKey] ?? '';
        const allowed = new Set((en.match(BEAN_WORD) ?? []).map((w) => w.toLowerCase()));
        const introduced = (beanie.match(BEAN_WORD) ?? [])
          .map((w) => w.toLowerCase())
          .filter((w) => !allowed.has(w));
        if (introduced.length) bad.push(`${key}: ${beanie}`);
      }
      expect(bad, `beanie euphemism on an important surface:\n${bad.join('\n')}`).toEqual([]);
    });
  });
});

describe('reset-PIN error keys cover the whole ResetError union', () => {
  // `ResetMemberPinModal.vue` builds its key DYNAMICALLY —
  // ``t(`family.resetPin.error.${result.error}`)`` — so a union member with no key
  // renders the raw key string at the user, and no compiler or lint rule would catch it.
  // Listed explicitly rather than derived: this is the pin, so adding a union member
  // without its copy fails HERE.
  const RESET_ERRORS = [
    // RotateError
    'familyKeyMissing',
    'wrapFailed',
    'updateFailed',
    'saveFailed',
    'noConnection',
    'rollbackFailed',
    // ResetError's own members
    'notAuthenticated',
    'memberNotFound',
    'cannotResetSelf',
    'isPet',
    'cannotResetOwner',
    'notAuthorized',
  ] as const;

  it.each(RESET_ERRORS)('has copy for %s', (code) => {
    const key = `family.resetPin.error.${code}`;
    expect(UI_STRINGS[key as UIStringKey], `missing ${key}`).toBeTruthy();
  });

  it('plus the modal-only "unexpected" fallback', () => {
    expect(UI_STRINGS['family.resetPin.error.unexpected']).toBeTruthy();
  });

  it('no family.resetPassword.* key survives', () => {
    const stale = Object.keys(UI_STRINGS).filter((k) => k.startsWith('family.resetPassword.'));
    expect(stale, `stale reset-password keys:\n${stale.join('\n')}`).toEqual([]);
  });

  it('none of the reset-PIN copy still says "password"', () => {
    const bad = Object.entries(UI_STRINGS)
      .filter(([k]) => k.startsWith('family.resetPin.'))
      .filter(([, v]) => /password/i.test(v))
      .map(([k, v]) => `${k}: ${v}`);
    expect(bad, `reset-PIN copy still naming a password:\n${bad.join('\n')}`).toEqual([]);
  });
});

describe('kit vocabulary', () => {
  // The recovery kit had FIVE names in shipped copy: recovery kit, recovery code,
  // recovery key, backup key, master key. Two survive by design — "Recovery Kit" is the
  // artifact, "Recovery Code" is the code you type from it.
  it('never says "recovery key", "backup key" or "master key"', () => {
    const bad = Object.entries(UI_STRINGS)
      .filter(([, v]) => /\b(recovery key|backup key|master key)\b/i.test(v))
      .map(([k, v]) => `${k}: ${v}`);
    expect(bad, `retired kit vocabulary:\n${bad.join('\n')}`).toEqual([]);
  });
});
