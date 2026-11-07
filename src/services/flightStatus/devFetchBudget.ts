/**
 * A daily cap on provider fetches for DEV BUILDS ONLY (#143).
 *
 * Dev hits the production flight-status Lambda (its CORS list carries localhost), and every
 * cache miss there is a paid provider call against the one global daily cap every family
 * shares. A dev server left open on a trip with a few flights inside three hours of departure
 * polls each of them every ten minutes, which drains that cap in an afternoon. So a dev build
 * spends at most `DEV_DAILY_FETCH_CAP` fetches per device per UTC day (the Lambda's own day),
 * then skips with reason `dev_cap` until midnight. A production build never reads or writes
 * this key: `devFetchBudgetActive()` is false there, and the store does not call in.
 *
 * Device state in localStorage, so a reload (dev reloads constantly) does not reset the count.
 * A missing, corrupt or unwritable record FAILS CLOSED to a fresh day's count: it can only
 * grant the cap once more, never unbounded fetches.
 */
import { STORAGE_KEYS } from '@/constants/storageKeys';
import { readStoredJson, writeStoredJson } from '@/utils/storedJson';

const LABEL = 'flight-status-dev';

/** Provider fetches a dev build may make per device per UTC day. */
export const DEV_DAILY_FETCH_CAP = 10;

interface DevBudgetRecord {
  /** UTC day `YYYY-MM-DD` the count belongs to. */
  day: string;
  count: number;
}

/** True in a Vite dev build (`npm run dev`); false in every production bundle, including
 *  `vite preview`. Read at call time so tests can stub it. */
export function devFetchBudgetActive(): boolean {
  return !!import.meta.env.DEV;
}

function utcDay(nowMs: number): string {
  return new Date(nowMs).toISOString().slice(0, 10);
}

function readRecord(day: string): DevBudgetRecord {
  const read = readStoredJson(STORAGE_KEYS.FLIGHT_STATUS_DEV_BUDGET, LABEL);
  if (read.kind === 'ok') {
    const v = read.value as Partial<DevBudgetRecord> | null;
    if (v && v.day === day && typeof v.count === 'number' && v.count >= 0) {
      return { day, count: v.count };
    }
  }
  return { day, count: 0 };
}

export interface DevFetchGrant {
  /** How many of the wanted fetches may go ahead (0..wanted). */
  granted: number;
  /** Fetches spent today after this grant. */
  used: number;
  cap: number;
}

/**
 * Spend up to `wanted` fetches from today's budget and record them. Call ONLY when
 * `devFetchBudgetActive()`; the production store never reaches here.
 */
export function takeDevFetchTokens(wanted: number, nowMs: number): DevFetchGrant {
  const day = utcDay(nowMs);
  const record = readRecord(day);
  const granted = Math.max(0, Math.min(wanted, DEV_DAILY_FETCH_CAP - record.count));
  const used = record.count + granted;
  if (granted > 0) {
    const written = writeStoredJson(
      STORAGE_KEYS.FLIGHT_STATUS_DEV_BUDGET,
      { day, count: used } satisfies DevBudgetRecord,
      LABEL
    );
    if (!written.ok) {
      // A count that cannot be kept would reset on reload; say so once per call site rather
      // than silently granting the cap again. Dev-only, so the console is the right place.
      console.warn(`[${LABEL}] could not record the dev fetch budget`, written.error);
    }
  }
  return { granted, used, cap: DEV_DAILY_FETCH_CAP };
}
