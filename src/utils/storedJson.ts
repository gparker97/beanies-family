/**
 * JSON in localStorage with a no-silent-failure contract: never throws, and
 * every failure warns with the key it concerns. The caller owns what happens
 * next (defaults, reset, overwrite) and any firehose event, because only the
 * caller knows whether a lost write matters.
 *
 * Shared by `perMemberStore` (install/community nudges, bean tips) and
 * `useSidebarAccordion`.
 */

export type StoredJsonRead =
  { kind: 'missing' } | { kind: 'corrupt' } | { kind: 'ok'; value: unknown };

/**
 * Read + JSON-parse a stored value.
 *   - missing key OR read error → `{ kind: 'missing' }` (read errors warn)
 *   - present but unparseable    → `{ kind: 'corrupt' }` (warns)
 *   - present + valid JSON        → `{ kind: 'ok', value }` (shape unchecked)
 */
export function readStoredJson(key: string, label: string): StoredJsonRead {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(key);
  } catch (err) {
    console.warn(`[${label}] localStorage read failed for "${key}"`, err);
    return { kind: 'missing' };
  }
  if (!raw) return { kind: 'missing' };
  try {
    return { kind: 'ok', value: JSON.parse(raw) };
  } catch (err) {
    console.warn(`[${label}] localStorage parse failed for "${key}"`, err);
    return { kind: 'corrupt' };
  }
}

export type StoredJsonWrite = { ok: true } | { ok: false; error: unknown };

/**
 * JSON-serialize and store a value. On a refused write (quota exceeded, Safari
 * private mode, storage disabled) it warns and returns the caught error, so the
 * caller's firehose event can carry it.
 */
export function writeStoredJson(key: string, value: unknown, label: string): StoredJsonWrite {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return { ok: true };
  } catch (error) {
    console.warn(`[${label}] localStorage write failed for "${key}"`, error);
    return { ok: false, error };
  }
}
