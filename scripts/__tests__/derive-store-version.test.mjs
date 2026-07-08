import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { deriveStoreVersion, readAppVersion } from '../derive-store-version.mjs';

describe('deriveStoreVersion', () => {
  it('strips the R<n> revision suffix', () => {
    expect(deriveStoreVersion('0.9.4R1')).toBe('0.9.4');
    expect(deriveStoreVersion('0.9.4R12')).toBe('0.9.4');
  });

  it('passes through already store-safe versions', () => {
    expect(deriveStoreVersion('0.9')).toBe('0.9');
    expect(deriveStoreVersion('1.0')).toBe('1.0');
    expect(deriveStoreVersion('1.2.3')).toBe('1.2.3');
  });

  it('tolerates surrounding whitespace', () => {
    expect(deriveStoreVersion('  0.9.4R1  ')).toBe('0.9.4');
  });

  it('throws on malformed input instead of returning a fallback', () => {
    expect(() => deriveStoreVersion('')).toThrow();
    expect(() => deriveStoreVersion('abc')).toThrow();
    expect(() => deriveStoreVersion('1.2.3.4')).toThrow(); // >3 parts
    expect(() => deriveStoreVersion('0.9.4R')).toThrow(); // R without digits
    expect(() => deriveStoreVersion('v1.0')).toThrow();
    expect(() => deriveStoreVersion(undefined)).toThrow();
  });
});

describe('readAppVersion', () => {
  it('extracts the APP_VERSION literal', () => {
    expect(readAppVersion("export const APP_VERSION = '0.9.4R1';")).toBe('0.9.4R1');
    expect(readAppVersion('export const APP_VERSION = "1.0";')).toBe('1.0');
  });

  it('throws when the APP_VERSION line is absent', () => {
    expect(() => readAppVersion('const OTHER = "x";')).toThrow();
  });
});

describe('real-file guard — the actual src/constants/appVersion.ts', () => {
  it('parses and derives a store-safe version from the live file', () => {
    // If appVersion.ts is reformatted or gets a bad APP_VERSION bump, this fails
    // in `npm run validate` — not months later when the dormant release lane runs.
    const here = path.dirname(fileURLToPath(import.meta.url));
    const appVersionPath = path.resolve(here, '../../src/constants/appVersion.ts');
    const text = fs.readFileSync(appVersionPath, 'utf8');
    const store = deriveStoreVersion(readAppVersion(text));
    expect(store).toMatch(/^\d+(\.\d+){0,2}$/);
  });
});
