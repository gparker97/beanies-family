/**
 * A per-key attempt budget over a rolling window, surviving reloads.
 *
 * Built for the text-share quota (#83): a share boundary exported to every app on the device
 * reaches a soft-keyed AI proxy, so the client needs a cheap cost control in front of the
 * server one. Timestamps are stored rather than a count, which is what lets a refusal name
 * WHEN it resets — "try again at 4pm" is actionable, "too many" is not.
 *
 * ⚠️ NOT a security boundary, and nothing here pretends otherwise. Anything with the page's
 * origin can clear `localStorage`, and the whole store is per-DEVICE, so a two-device
 * household legitimately gets two budgets. The real bound is the server-side throttle on the
 * proxy; this exists to stop ordinary runaway use before it becomes a bill, and to give the
 * user a friendlier message than a 429 when they hit it. See `docs/adr/035`.
 *
 * ── Why this is not `usePinAttemptLimit` ────────────────────────────────────────────────
 *
 * That module solves a similar-looking problem and is deliberately NOT reused (#83 §4):
 *
 *   1. Its `persist()` writes an entry only when `lockedUntil > Date.now()` — i.e. only a
 *      live cooldown survives a reload. A budget has no cooldown, so 19 used attempts would
 *      persist as nothing and a reload would hand back a fresh 20. That is precisely the
 *      bypass this module exists to slow, and it would have shipped silently green.
 *   2. The data shapes barely overlap: PIN stores `{ failures, lockedUntil }` and clears the
 *      scope wholesale on success; a budget needs a timestamp list and has no success.
 *   3. `usePinAttemptLimit` is the brute-force control on the step-up challenge — the actual
 *      security boundary of #80. Coupling it to a cost control means a future quota tweak can
 *      regress transfer-ownership and clear-all-data.
 *
 * The accepted duplication is a `try/catch` around `localStorage`. Folding PIN onto this
 * shape is a reasonable follow-up ONCE the share policy has settled in production, which is
 * when the right shared shape is knowable rather than guessed.
 *
 * ── Why a plain module and not a composable ─────────────────────────────────────────────
 *
 * `prepare()` runs from a native share listener (`useShareTargets.ts`), not a component
 * `setup()`. Anything with a Vue lifecycle hook called from there warns AND leaks. So: no
 * `ref`, no `onBeforeUnmount`, no ticker.
 */

const STORAGE_KEY = 'beanies_share_budget';

/** How many attempts are allowed, and over what window. */
export interface BudgetPolicy {
  max: number;
  windowMs: number;
}

/**
 * Narrowing union: a refusal always carries when it lifts, so no caller can show "too many"
 * without being able to say when to come back.
 */
export type BudgetVerdict = { ok: true } | { ok: false; reason: 'quota'; resetsAt: number };

/**
 * One key's state: the attempts consumed under it, and the window they are judged against.
 *
 * The window travels WITH the entry rather than being supplied at prune time. Pruning has to
 * happen for every key on every write (see `persist`), including keys whose policy the
 * current caller knows nothing about — so a `persist` that pruned everything using the
 * window it happens to be holding would expire another policy's entries early. There is one
 * policy today; this is what stops a second one silently corrupting the first.
 */
interface BudgetEntry {
  /** windowMs, carried so pruning is self-contained. */
  w: number;
  /** Epoch-ms timestamps of consumed attempts, oldest first. */
  t: number[];
}

const budgets = new Map<string, BudgetEntry>();

function isEntry(value: unknown): value is BudgetEntry {
  return (
    !!value &&
    typeof value === 'object' &&
    typeof (value as BudgetEntry).w === 'number' &&
    Array.isArray((value as BudgetEntry).t)
  );
}

function readPersisted(): Record<string, unknown> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    // Private browsing, blocked storage, or a corrupt blob. The budget then applies for this
    // page load only — the same degradation `usePinAttemptLimit` accepts, and strictly better
    // than refusing every share because storage is unavailable.
    return {};
  }
}

/**
 * Drop timestamps outside the entry's window.
 *
 * A timestamp in the FUTURE is discarded too: the only way to write one is a clock that has
 * since moved backwards, and keeping it would pin a budget shut until the clock caught up.
 */
function pruned(entry: BudgetEntry, now: number): number[] {
  return entry.t.filter((t) => typeof t === 'number' && t <= now && now - t < entry.w);
}

/**
 * Write every live entry, pruning ALL of them on the way.
 *
 * ⚠️ Pruning every key, not just the one being written, is load-bearing. `usePinAttemptLimit`
 * bounds its blob implicitly by writing only live cooldowns; this module has no such filter,
 * so a key that is never touched again would keep its expired timestamps re-serialised
 * forever — the blob growing without bound on a long-lived install. That is the same class of
 * omission that made the PIN module unsuitable here, in the other direction.
 */
function persist(now: number): void {
  try {
    // ⚠️ MERGE over what is already stored — do NOT write the in-memory Map alone.
    //
    // Hydration (`entryFor`) is lazy and PER KEY, so a key that exists in storage but has not
    // been touched this page load is absent from the Map. Writing the Map as the whole blob
    // therefore DELETED every untouched family's budget, and when the Map happened to be
    // empty it removed the store outright. The effect was the exact inverse of this module's
    // purpose: reload, share as family B, and family A's spent budget came back as a fresh
    // 20 — so switching families RESET the budget the family-scoped key exists to protect.
    //
    // Stored entries carry their own `w`, which is what makes pruning them here safe without
    // knowing their policy.
    const out: Record<string, BudgetEntry> = {};
    for (const [key, value] of Object.entries(readPersisted())) {
      if (!isEntry(value)) continue;
      const live = pruned(value, now);
      if (live.length) out[key] = { w: value.w, t: live };
    }
    // Then overlay the keys this page load actually touched; those are authoritative.
    for (const [key, entry] of budgets) {
      entry.t = pruned(entry, now);
      if (entry.t.length) out[key] = entry;
      else delete out[key];
    }
    if (Object.keys(out).length === 0) localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, JSON.stringify(out));
  } catch {
    // Best-effort. An unpersisted budget is still enforced for this page load.
  }
}

/**
 * The live entry for a key, hydrating from storage on first touch and pruning in place.
 *
 * Hydration is lazy and one-shot per key per page load, mirroring `usePinAttemptLimit`'s
 * `stateFor` — reading the whole blob on every peek would be wasteful and would make the
 * in-memory map pointless. The POLICY's window wins over a stored one, so changing the policy
 * takes effect immediately rather than only for keys created afterwards.
 */
function entryFor(key: string, policy: BudgetPolicy, now: number): BudgetEntry {
  let entry = budgets.get(key);
  if (!entry) {
    const stored = readPersisted()[key];
    entry = { w: policy.windowMs, t: isEntry(stored) ? stored.t : [] };
    budgets.set(key, entry);
  }
  entry.w = policy.windowMs;
  entry.t = pruned(entry, now);
  return entry;
}

function verdict(entry: BudgetEntry, policy: BudgetPolicy): BudgetVerdict {
  if (entry.t.length < policy.max) return { ok: true };
  // The budget frees a slot when its OLDEST live attempt ages out of the window.
  return { ok: false, reason: 'quota', resetsAt: Math.min(...entry.t) + policy.windowMs };
}

/**
 * Is there budget left? Does NOT consume one.
 *
 * Peek early (so a refusal is cheap and happens before the consent prompt); consume only when
 * an AI call is actually about to be made. Checking-and-consuming in one place would burn a
 * share when the user declines consent.
 */
export function peekAttempt(key: string, policy: BudgetPolicy): BudgetVerdict {
  const now = Date.now();
  return verdict(entryFor(key, policy, now), policy);
}

/** Take one attempt if there is budget. Refuses — without consuming — when there is not. */
export function consumeAttempt(key: string, policy: BudgetPolicy): BudgetVerdict {
  const now = Date.now();
  const entry = entryFor(key, policy, now);
  const current = verdict(entry, policy);
  if (!current.ok) return current;
  entry.t.push(now);
  persist(now);
  return { ok: true };
}

/**
 * Forget one key's attempts.
 *
 * Edits storage DIRECTLY rather than going through `persist`. Since `persist` now merges over
 * the stored blob (so lazily-hydrated keys survive), routing a deletion through it would
 * simply re-read the key it was asked to remove and put it straight back.
 */
export function clearAttempts(key: string): void {
  budgets.delete(key);
  try {
    const stored = readPersisted();
    delete stored[key];
    if (Object.keys(stored).length === 0) localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
  } catch {
    // Best-effort; the in-memory clear still applies for this page load.
  }
}

/** Test-only: forget every key, in memory and in storage. */
export function __resetAttemptBudgetForTests(): void {
  budgets.clear();
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // nothing to clear
  }
}
