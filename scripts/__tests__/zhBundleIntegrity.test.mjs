/**
 * Guards on the shipped Chinese bundle, for the three failure classes that
 * actually occurred — each one invisible to a reviewer who does not read
 * Chinese, and each one shipped to users.
 *
 * The translation API has no context for a short UI label, so it returns
 * whichever script it likes, drops `{placeholder}` tokens, and occasionally
 * invents whole sentences. `suspiciousTranslationReason` catches those at WRITE
 * time now, but ~4,500 entries predate it; this is the standing check on what
 * is actually on disk.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TRADITIONAL_ONLY } from '../lib/traditionalChars.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const bundle = JSON.parse(fs.readFileSync(path.join(root, 'public/translations/zh.json'), 'utf8'));
const entries = Object.entries(bundle.translations).filter(([, v]) => v && typeof v === 'object');

/** English sources, parsed the same text-level way the translate script does. */
function englishStrings() {
  const src = fs.readFileSync(path.join(root, 'src/services/translation/uiStrings.ts'), 'utf8');
  const out = {};
  let key = null;
  const en = (line) => {
    const m =
      line.match(/en\s*:\s*'((?:[^'\\]|\\.)*)'/) || line.match(/en\s*:\s*"((?:[^"\\]|\\.)*)"/);
    // Resolve `\u{1F96B}` / `\u2013` first. Without this a source emoji escape
    // reads as a `{1F96B}` placeholder and the guard false-positives on four
    // perfectly good onboarding strings.
    return m
      ? m[1]
          .replace(/\\u\{([0-9a-fA-F]+)\}/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
          .replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
      : null;
  };
  for (const line of src.split('\n')) {
    const k = line.match(/^\s+'([^']+)'\s*:\s*\{/);
    if (k) {
      key = k[1];
      const same = en(line);
      if (same !== null) {
        out[key] = same;
        key = null;
      }
      continue;
    }
    if (!key) continue;
    const v = en(line);
    if (v !== null) {
      out[key] = v;
      key = null;
    }
  }
  return out;
}

describe('zh.json is actually 简体', () => {
  it('carries no traditional-only characters', () => {
    // The bundle's own meta says 中文 (简体). ~100 entries had drifted, so a
    // zh-CN reader met a foreign script mid-sentence — in the invite message,
    // the validation errors and half the day names.
    const offenders = entries
      .filter(([, v]) => [...v.translation].some((c) => TRADITIONAL_ONLY.has(c)))
      .map(([k, v]) => `${k}: ${v.translation}`);
    expect(offenders, `traditional characters in a 简体 bundle:\n${offenders.join('\n')}`).toEqual(
      []
    );
  });
});

describe('zh.json preserves what the English promised', () => {
  const en = englishStrings();

  it('keeps every {placeholder} the source has', () => {
    // A lost token is not a cosmetic bug: `fillTemplate` finds nothing to
    // substitute and emits the raw string, so "Transfer -> {account}" shipped as
    // a bare "transfer account" with the account name gone.
    const offenders = [];
    for (const [k, v] of entries) {
      const source = en[k];
      if (!source) continue;
      for (const token of source.match(/\{[a-zA-Z0-9_]+\}/g) ?? []) {
        if (!v.translation.includes(token))
          offenders.push(`${k}: lost ${token} -> ${v.translation}`);
      }
    }
    expect(offenders, offenders.join('\n')).toEqual([]);
  });

  it('invents no brand names the source never mentioned', () => {
    // Real examples that shipped: "Nice!" became "you've sent your score to
    // Facebook!", and "Enter your token" asked for a Yelp authorisation code.
    const brands = ['Yelp', 'Facebook', 'Yahoo', 'Twitter', 'Instagram', 'Amazon', 'eBay'];
    const offenders = [];
    for (const [k, v] of entries) {
      const source = (en[k] ?? '').toLowerCase();
      const zh = v.translation.toLowerCase();
      for (const b of brands) {
        if (zh.includes(b.toLowerCase()) && !source.includes(b.toLowerCase())) {
          offenders.push(`${k}: invented "${b}" -> ${v.translation}`);
        }
      }
    }
    expect(offenders, offenders.join('\n')).toEqual([]);
  });

  it('carries no unresolved escape sequences', () => {
    // The parser used to hand `–` to the translator as six literal
    // characters, so "A–Z" shipped as "A\ u2013Z" in the cookbook sort.
    const offenders = entries
      .filter(([, v]) => /\\\s*u\s*\{?[0-9a-fA-F]{4}/.test(v.translation))
      .map(([k, v]) => `${k}: ${v.translation}`);
    expect(offenders, offenders.join('\n')).toEqual([]);
  });
});
