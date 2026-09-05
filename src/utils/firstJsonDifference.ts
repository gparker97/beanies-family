/**
 * The first place two plain-JSON trees differ, as a dotted path — or `null`.
 *
 * A verification gate, not a diff library. `Automerge.from(toJS(doc))` is
 * believed to preserve every field the app reads (the document is pure JSON —
 * no `Counter`, no `Text`), but "believed" is not good enough when the output
 * replaces a family's pod, so the compaction refuses unless this returns `null`.
 *
 * Returns a PATH, never a value: the result reaches the firehose, and the
 * firehose is PII-free. Knowing that `accounts.a17.balance` differs is enough to
 * debug; the balance itself is not ours to log.
 *
 * Object keys are compared as a SET (insertion order is not meaning in JSON);
 * arrays are compared in order (there, it is).
 *
 * `diffPayload.ts` is deliberately not reused — its own header says "do not grow
 * this into a general object-diff library".
 */
type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

/** Object keys join with a dot; array indices use `[i]`, so a root-level index
 *  is unambiguous and can never collide with a key literally named `length`. */
const atKey = (path: string, key: string) => (path ? `${path}.${key}` : key);
const atIndex = (path: string, i: number) => `${path}[${i}]`;

export function firstJsonDifference(a: unknown, b: unknown, path = ''): string | null {
  if (a === b) return null;

  // NaN is never `===` itself; treat it as equal to itself so a legitimate NaN
  // (which JSON cannot carry anyway) cannot make the gate unfalsifiable.
  if (typeof a === 'number' && typeof b === 'number' && Number.isNaN(a) && Number.isNaN(b)) {
    return null;
  }

  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') {
    return path || '(root)';
  }

  const aIsArray = Array.isArray(a);
  if (aIsArray !== Array.isArray(b)) return path || '(root)';

  if (aIsArray) {
    const x = a as Json[];
    const y = b as Json[];
    if (x.length !== y.length) return `${path || '(root)'}[length]`;
    for (let i = 0; i < x.length; i++) {
      const d = firstJsonDifference(x[i], y[i], atIndex(path, i));
      if (d) return d;
    }
    return null;
  }

  const x = a as Record<string, Json>;
  const y = b as Record<string, Json>;
  const keys = new Set([...Object.keys(x), ...Object.keys(y)]);
  // Sorted so the reported path is stable run to run — a flapping path in the
  // firehose reads as several different bugs.
  for (const k of [...keys].sort()) {
    const inA = Object.prototype.hasOwnProperty.call(x, k);
    const inB = Object.prototype.hasOwnProperty.call(y, k);
    if (inA !== inB) return atKey(path, k);
    const d = firstJsonDifference(x[k], y[k], atKey(path, k));
    if (d) return d;
  }
  return null;
}
