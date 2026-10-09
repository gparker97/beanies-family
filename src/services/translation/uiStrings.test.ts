import { describe, it, expect } from 'vitest';
import { UI_STRINGS, BEANIE_STRINGS, getSourceText, getAllKeys } from './uiStrings';
import type { UIStringKey } from './uiStrings';
import { ZH_STRINGS } from './zh';
import { TRADITIONAL_ONLY } from './traditionalChars';

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
      'resumeSetup.driveDeclined',
      'createPod.driveError.',
      'storage.driveOnlyHere',
      'resumeSetup.subtitle',
      'sync.',
      'docWorker.',
      'error.',
      // The AI failure surface. `error.` does not cover it — the keys are `ai.error.*` — so
      // every beanie value there sat outside the floor until this was added.
      'ai.error.',
      // Consent (the ✨ Find Duplicates variant, #116): what is sent and what happens to it.
      'ai.consent.',
      'ai.correct.refused.',
      'ai.correct.disagreed.',
      // The two hinted outcomes of the sheet's optional pick (#108): what beanies read, and
      // what to do about it, must survive beanie mode intact.
      'ai.capture.pick.none.',
      'ai.capture.pick.overruled.',
      'ai.picker.expired.',
      'app.initError.',
      'auth.',
      // Member removal (#77): what removal did, and what the remover must still do.
      'family.remove',
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
      // A SAVED SIGN-IN CREDENTIAL is squarely inside this floor's named scope
      // ("auth/sign-in/PIN/password/recovery"). A reader who thinks a magic link is a
      // playful bean thing can leave one in a group chat.
      'magicLink.',
      // `deviceLink.` was missing from this list, which is the same surface and the same
      // risk — a 15-minute full-family-key transport. Same fix, same reason.
      'deviceLink.',
      // The promoted mint and the device-approval flow are the same surface again: a
      // family-wide credential and a sign-in. Same rule, same list.
      'signInCode.',
      // The cold-entry panel is the same surface again: getting back into a beanpod.
      'coldEntry.',
      'deviceApproval.',
      // Clearing a member's claim is a credential action: it revokes a PIN and re-opens an
      // invite. The floor exists so a reader who does not know the joke cannot act wrongly, and
      // "bean" must never stand in for the member or their access here.
      'bean.unclaim.',
      // #98 — a `.beanpod` offered on the share sheet. This names the FAMILY FILE and tells a
      // stuck person how to actually get in, so "bean" must never stand in for the file or the
      // invite link here. The rest of `shareTarget.*` is the cosmetic document-reader copy and
      // is deliberately NOT covered.
      'shareTarget.beanpod.',
      // The awaiting-auth card carries the sign-in and account-switch copy a stuck joiner reads.
      'join.awaiting.',
      // #88 / #116 — the refusal surfaces of the shopping-list commit. A reader who
      // does not know the joke must still learn what is gone and that nothing was
      // created or added. The rest of `lists.fromRecipe.*` is cosmetic
      // (labels, hints) and deliberately NOT covered.
      'lists.error.',
      'lists.destination.listGone',
      'lists.fromRecipe.noMember',
      'lists.fromRecipe.recipeGone',
      'join.inviteToken',
      'join.fileMismatch',
      'join.needsFile',
      'join.familyNotFound',
      'join.noUnclaimedMembers',
      'join.pickerPrompt.',
      'join.loadingFromCloud',
      'googleDrive.',
      'googleDisconnect.',
      // The whole one-time import surface. It is about the family's real Google
      // Calendar data, and a reader who acts on a euphemism here ends up with two
      // of everything or an edit that never reaches their calendar.
      'statementImport.',
      'calendarImport.',
      'calendarSync.reconnect.',
      // Connection loss, told to someone who may not be able to fix it — they need
      // the real nouns to know who to go to.
      'reconnectPrompt.',
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
      // The wall's DESTRUCTIVE copy only. Deliberately these three keys and not a
      // blanket `wall.` prefix: the same screen carries the playful chore copy
      // ("counting beans", the all-clear cheer) that beanie mode exists for, and
      // policing that would be wrong. Removing someone's row is the part where a
      // reader who does not know the joke could act wrongly.
      'wall.job.removed',
      'wall.job.undo',
      'wall.removeFailed.',
      'wall.undoFailed.',
      // The wall setup card's device checklist, which is a separate case from the
      // destructive copy above: these lines tell a parent what to change on a real
      // device (its screen lock, its app pinning), so "keep your bean awake" is an
      // instruction a reader could act wrongly on. `wall.setup.help.` is
      // deliberately NOT here; that key is a link label, not an instruction.
      'wall.setup.tips.',
      // The one-time Google Calendar import (#94). These tell a parent what will
      // happen to events that already exist in their real Google Calendar, so
      // "we'll bring your beans across" is an instruction a reader could act
      // wrongly on. `calendarImport.chip.` is excluded: those are two-word labels
      // whose meaning lives in the legend, which IS covered here.
      'calendarImport.legend.',
      'calendarImport.confirm.',
      'calendarImport.choose.',
      'calendarImport.failed.',
      // Who Owns What (#109): deleting a family-made card and restoring the default deck
      // both destroy history for good. "bean" must never stand in for a card or the deck.
      'whoOwnsWhat.delete',
      'whoOwnsWhat.restore',
      // Magic beans to-dos (#113): deleting an activity with linked to-dos, and a failed
      // to-do save. "bean" must never stand in for the to-dos or the activity here.
      'planner.deleteLinkedTodos.',
      'magicTodos.error.',
      // A single to-do with nobody to credit it to (the Add To-do sidebar, the quick-add bar,
      // the Nook widget): "bean" must never stand in for the to-do or the family member.
      'todo.error.',
      // Plans and read-only (#95): money and the family's data are at stake. "bean" must never
      // stand in for the plan, the family data or the device here.
      'plan.',
      'readOnly.',
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

/**
 * Brand and product names that stay English inside the Chinese UI (the approved
 * glossary). This list is the single source: docs/TRANSLATION.md and the
 * beanies-theme skill reference it rather than restating it. It is separate from
 * the template lint rule's brand allowlist in `eslint.config.js` (cross-linked,
 * deliberately not merged: that one is about bare strings in templates).
 */
const ZH_BRAND_TERMS: readonly string[] = [
  'beanies.family',
  'The Pod',
  'The Treehouse',
  'Little Bean',
  'Parent Bean',
  'Meet the Beans',
  'Nook',
  'The Beanie Lab',
  'beanies AI',
  'Discord Beanies',
  '.beanpod',
  'Google Drive',
  'Google Family Link',
  'Dropbox',
  'iCloud',
  'OneDrive',
  // Brand variants and role names the copy keeps in English.
  'The Bean Pod',
  'Beanies Discord',
  'Big Bean',
  'Little Beanie',
  'beanies',
  'Pod',
  // Product and account-type names with no Chinese form.
  'OpenAI',
  'Claude',
  'Gemini',
  'Reddit',
  'Product Hunt',
  'Roth IRA',
  'Bene IRA',
  'SWIFT',
  'Sort Code',
  '401k',
  // Apple's name for its review process, quoted in the demo-mode copy.
  'App Review',
];

// A value kept verbatim from the English because it is a format example or a
// code literal, never a sentence: an email, a URL, a key prefix ("sk-…"), an
// identifier with "_" or "=". Tight on purpose so a pasted English label
// ("Add Account") still fails the passthrough check.
const isFormatLiteral = (zhValue: string, enValue: string) =>
  zhValue === enValue.replace(/\.\.\./g, '…') && /@|:\/\/|…|_|=/.test(zhValue);

describe('ZH_STRINGS', () => {
  // Completeness (no missing key, no stale key) is enforced by the
  // `Record<UIStringKey, string>` type on ZH_STRINGS, not here. These checks
  // cover what the type cannot see. Each one collects every offender so a
  // failure lists all of them at once.
  const keys = getAllKeys();
  const en = UI_STRINGS as Record<string, string>;
  const zh = ZH_STRINGS as Record<string, string>;
  // Placeholder token shape from the retired zhBundleIntegrity test.
  const PLACEHOLDER_RE = /\{[a-zA-Z0-9_]+\}/g;
  const HAN_RE = /\p{Script=Han}/u;
  const report = (what: string, offenders: string[]) =>
    `${offenders.length} ${what}:\n${offenders.join('\n')}`;

  it('every value is non-empty and not whitespace', () => {
    const offenders = keys.filter((k) => zh[k]!.trim().length === 0);
    expect(offenders, report('empty zh values', offenders)).toEqual([]);
  });

  it('carries exactly the {placeholder} tokens the English has', () => {
    // A lost token is not cosmetic: `fillTemplate` finds nothing to substitute
    // and the value (a name, a count, a date) silently disappears. An added one
    // renders as a raw `{token}`.
    const tokens = (v: string) => [...new Set(v.match(PLACEHOLDER_RE) ?? [])].sort().join(' ');
    const offenders = keys
      .filter((k) => tokens(zh[k]!) !== tokens(en[k]!))
      .map((k) => `${k}: en [${tokens(en[k]!)}] zh [${tokens(zh[k]!)}] -> ${zh[k]}`);
    expect(offenders, report('placeholder mismatches', offenders)).toEqual([]);
  });

  it('keeps both halves of every .one/.other pair', () => {
    const offenders = keys
      .filter((k) => k.endsWith('.one'))
      .map((k) => [k, k.replace(/\.one$/, '.other')] as const)
      .filter(([, other]) => other in en)
      .filter(([one, other]) => !zh[one]?.trim() || !zh[other]?.trim())
      .map(([one]) => one);
    expect(offenders, report('broken .one/.other pairs', offenders)).toEqual([]);
  });

  it('is Simplified: no Traditional-only characters', () => {
    const offenders = keys
      .filter((k) => [...zh[k]!].some((c) => TRADITIONAL_ONLY.has(c)))
      .map((k) => `${k}: ${zh[k]}`);
    expect(offenders, report('values with Traditional characters', offenders)).toEqual([]);
  });

  it('adds no link, href or URL the English does not have', () => {
    const MARKERS = ['<a', 'href', 'http'];
    const offenders = keys.flatMap((k) => {
      const z = zh[k]!.toLowerCase();
      const e = en[k]!.toLowerCase();
      return MARKERS.filter((m) => z.includes(m) && !e.includes(m)).map(
        (m) => `${k}: "${m}" -> ${zh[k]}`
      );
    });
    expect(offenders, report('values with an added link or URL', offenders)).toEqual([]);
  });

  it('is never English passthrough outside the brand glossary', () => {
    // Value-based, not a per-key allowlist (a key list would grow forever). A
    // value with any Han character is translated and not examined. A value with
    // none is stripped of glossary terms, placeholders, 2-4 letter uppercase
    // tokens (currency codes and the acronyms the lint allowlist exempts: OK,
    // ID, AI, PWA, URL, PDF, PIN, QR), emoji, digits, punctuation and symbols;
    // any Latin letter left is untranslated English. This is also the
    // staleness floor: an English value pasted into zh.ts fails here.
    const terms = [...ZH_BRAND_TERMS].sort((a, b) => b.length - a.length);
    const residue = (v: string) => {
      let out = v;
      for (const term of terms) out = out.split(term).join(' ');
      return out
        .replace(PLACEHOLDER_RE, ' ')
        .replace(/\b[A-Z]{2,4}\b/g, ' ')
        .replace(/\p{Extended_Pictographic}|\u{FE0F}|\u{200D}|\u{20E3}/gu, ' ')
        .replace(/[\p{N}\p{P}\p{S}\s]/gu, '');
    };
    const offenders = keys
      .filter((k) => !HAN_RE.test(zh[k]!) && !isFormatLiteral(zh[k]!, en[k]!))
      .filter((k) => /[A-Za-z]/.test(residue(zh[k]!)))
      .map((k) => `${k}: ${zh[k]}`);
    expect(offenders, report('untranslated English values', offenders)).toEqual([]);
  });

  it('is never half-translated: no run of English words outside the glossary', () => {
    // A value with Han characters still fails if, after the same stripping,
    // two or more Latin words stand next to each other ("添加 New Account").
    // Single Latin tokens survive on purpose: a product name inside a sentence
    // ("Google 日历"), a unit, a code.
    const terms = [...ZH_BRAND_TERMS].sort((a, b) => b.length - a.length);
    // Any run of 2+ words contains an adjacent pair, so one pair is enough
    // (and keeps the pattern free of nested quantifiers).
    const RUN_RE = /[A-Za-z]{2,}\s+[A-Za-z]{2,}/;
    const stripped = (v: string) => {
      let out = v;
      for (const term of terms) out = out.split(term).join(' ');
      return out.replace(PLACEHOLDER_RE, ' ').replace(/\b[A-Z]{2,4}\b/g, ' ');
    };
    const offenders = keys
      .filter((k) => !isFormatLiteral(zh[k]!, en[k]!) && RUN_RE.test(stripped(zh[k]!)))
      .map((k) => `${k}: ${zh[k]}`);
    expect(offenders, report('half-translated values', offenders)).toEqual([]);
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
