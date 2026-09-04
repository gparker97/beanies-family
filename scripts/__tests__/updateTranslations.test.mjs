import { describe, it, expect } from 'vitest';
import { suspiciousTranslationReason } from '../updateTranslations.mjs';

/**
 * Guards the junk-translation gate that decides whether MyMemory's output is
 * persisted to `public/translations/zh.json` or discarded in favour of English.
 *
 * Rule 7 (placeholder preservation) exists because MyMemory translated the
 * literal token `{title}` into the word "标题", which silently destroyed every
 * zh OS-reminder title: `fillTemplate` found no token to substitute, so the
 * notification rendered "标题" instead of the item's name. Rules 1-6 shipped
 * untested; this file is their first coverage too.
 */
describe('suspiciousTranslationReason', () => {
  it('accepts a clean translation', () => {
    expect(suspiciousTranslationReason('Settings', '设置')).toBeNull();
  });

  describe('rule 7 — placeholder preservation', () => {
    it('rejects a translation that translated the placeholder away', () => {
      // The exact defect: '{title}' → '标题'.
      expect(suspiciousTranslationReason('{title}', '标题')).toBe(
        'placeholder lost in translation'
      );
    });

    it('rejects a partially-lost placeholder in a longer string', () => {
      expect(suspiciousTranslationReason('Due at {time}', '截止于 时间')).toBe(
        'placeholder lost in translation'
      );
    });

    it('accepts a translation that keeps every placeholder verbatim', () => {
      expect(suspiciousTranslationReason('Due at {time}', '截止于 {time}')).toBeNull();
      expect(suspiciousTranslationReason('Time to drop off — {who}', '该送 {who} 了')).toBeNull();
    });

    it('is a no-op for sources with no placeholders', () => {
      expect(suspiciousTranslationReason('Coming up soon', '即将开始')).toBeNull();
    });

    it('allows placeholders to be reordered, as long as all survive', () => {
      expect(suspiciousTranslationReason('{a} and {b}', '{b} 和 {a}')).toBeNull();
    });
  });

  describe('rules 1-6 — pre-existing junk filters', () => {
    it('rejects control characters', () => {
      expect(suspiciousTranslationReason('Crypto', 'crypto\n英')).toBe('control characters');
    });

    it('rejects markup the source did not have', () => {
      expect(suspiciousTranslationReason('Embark', '<a href="http://gouwo8.com">登船</a>')).toBe(
        'injected HTML/markup'
      );
    });

    it('rejects an injected URL', () => {
      expect(suspiciousTranslationReason('Embark', '登船 http://spam.example')).toBe(
        'injected URL'
      );
    });

    it('rejects a dictionary-definition dump', () => {
      expect(suspiciousTranslationReason('Crypto', "英 ['krɪptəʊ] n. 加密")).toBe(
        'dictionary-definition dump'
      );
    });

    it('rejects implausibly long output for a short label', () => {
      expect(suspiciousTranslationReason('Save', 'x'.repeat(200))).toBe('implausible length');
    });
  });
});

describe('suspiciousTranslationReason — control characters', () => {
  it('rejects control characters the SOURCE does not have', () => {
    expect(suspiciousTranslationReason('Settings', '设置\n英 [ˈsetɪŋz]')).toBe(
      'control characters'
    );
  });

  it('ALLOWS a newline when the source is genuinely multi-line', () => {
    // A blanket reject fell the invite message and both recipe placeholders back
    // to English the moment the parser started resolving `\n` — and the loop
    // then stamped the current hash on that English, so they could never be
    // retried. Both halves of that are now fixed; this pins the first.
    expect(
      suspiciousTranslationReason('Hi!\nJoin here: {link}', '您好！\n点击加入：{link}')
    ).toBeNull();
  });
});
