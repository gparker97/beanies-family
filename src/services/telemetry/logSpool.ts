/**
 * The on-device spool for diagnostic events that could not be delivered: its storage format,
 * its key, and the rules for reading one back. Stateless; `logQueue.ts` owns WHEN a spool is
 * written (only while delivery is failing) and what happens to restored events.
 *
 * One `localStorage` key per page instance (`SPOOL_PREFIX` + a random id), so two tabs never
 * overwrite each other's spool. A launch claims every OTHER instance's key: a still-live tab's
 * spool can be claimed too, and its events then arrive twice (that tab still holds them in
 * memory). Rare, and accepted: event ids would be a new collected field.
 *
 * Like `logQueue`, this module never calls `logEvent`/`reportError` (telemetry about telemetry
 * would loop). Storage failures warn through `storedJson` under the one `telemetry` label, and
 * the counts `claimSpools` returns are logged by `telemetrySpool.ts` on the normal path.
 */

import type { LogRecord } from './logEvent';
import { generateUUID } from '@/utils/id';
import {
  readStoredJson,
  removeStoredJson,
  storedKeysWithPrefix,
  writeStoredJson,
} from '@/utils/storedJson';

export const SPOOL_PREFIX = 'beanies.telemetrySpool.';
/** Older events are dropped on restore: past this they no longer help a live triage. */
export const SPOOL_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const LABEL = 'telemetry';

export interface SpoolClaim {
  /** Valid, fresh records from every claimed key, oldest first. */
  records: LogRecord[];
  /** Spool keys found (other than this instance's own). */
  keys: number;
  /** Records more than `SPOOL_MAX_AGE_MS` from now (either way), dropped. */
  stale: number;
  /** Unreadable keys (1 each) plus records with no parseable `timestamp`, dropped. */
  malformed: number;
  /** Keys that could not be removed, so were NOT restored (they would replay every launch). */
  unremovable: number;
}

export function newSpoolKey(): string {
  return SPOOL_PREFIX + generateUUID();
}

export function writeSpool(key: string, records: LogRecord[]): boolean {
  return writeStoredJson(key, records, LABEL).ok;
}

export function removeSpool(key: string): boolean {
  return removeStoredJson(key, LABEL).ok;
}

/**
 * The record's client time in ms, or null when it is not a plain object with a parseable
 * `timestamp`. Only the timestamp is checked: the Lambda already coerces `level`/`surface`/
 * `message` and drops every non-allowlisted key, so a stricter shape check here would duplicate it.
 */
function recordTime(value: unknown): number | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const ts = (value as { timestamp?: unknown }).timestamp;
  if (typeof ts !== 'string') return null;
  const ms = Date.parse(ts);
  return Number.isNaN(ms) ? null : ms;
}

/**
 * Read back and remove every spool except `ownKey`. Each key is removed BEFORE its events are
 * used: a key that cannot be removed is skipped and counted, because restoring it would replay
 * the same events on every launch.
 */
export function claimSpools(ownKey: string, now: number): SpoolClaim {
  const claim: SpoolClaim = { records: [], keys: 0, stale: 0, malformed: 0, unremovable: 0 };
  const timed: Array<{ ms: number; record: LogRecord }> = [];

  for (const key of storedKeysWithPrefix(SPOOL_PREFIX, LABEL)) {
    if (key === ownKey) continue;
    claim.keys++;
    const read = readStoredJson(key, LABEL);
    if (!removeSpool(key)) {
      claim.unremovable++;
      continue;
    }
    if (read.kind !== 'ok' || !Array.isArray(read.value)) {
      if (read.kind !== 'missing') claim.malformed++;
      continue;
    }
    for (const value of read.value) {
      const ms = recordTime(value);
      if (ms === null) claim.malformed++;
      // Both directions: a device clock far ahead would otherwise keep a record fresh forever.
      else if (Math.abs(now - ms) > SPOOL_MAX_AGE_MS) claim.stale++;
      else timed.push({ ms, record: value as LogRecord });
    }
  }

  timed.sort((a, b) => a.ms - b.ms);
  claim.records = timed.map((t) => t.record);
  return claim;
}
