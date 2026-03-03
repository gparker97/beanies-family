/**
 * fileSync persistence tests.
 *
 * TODO: Rewrite tests for V4 file format.
 * The previous tests validated V3 .beanpod round-trips (export/import via IndexedDB).
 * The V4 format uses Automerge CRDT documents encrypted with a family key,
 * so the entire test approach needs to be redesigned.
 */
import { describe, it } from 'vitest';

describe('fileSync persistence (V4 format)', () => {
  it.todo('preserves data through V4 encrypt/decrypt round-trip');
  it.todo('preserves settings through V4 round-trip');
  it.todo('preserves todos through V4 round-trip');
});
