/**
 * Emission policies for high-frequency diagnostic events.
 *
 * The firehose exists so a failure can be triaged from CloudWatch without a
 * local repro, and the rule that every non-trivial branch emits is what makes
 * that true. But a handful of surfaces re-emit the SAME outcome many times a
 * day per family — a reconcile that changed nothing, a save that succeeded like
 * the last hundred — and those carry almost no diagnostic information while
 * dominating the volume. In August 2026 three surfaces were 85% of all events;
 * `helpful-hints` alone emitted ~36 events per family per day, nearly all of
 * them identical.
 *
 * These helpers cut the repetition without cutting the signal:
 *
 *  - {@link createChangeGate} emits whenever the outcome CHANGES, and every Nth
 *    identical repeat. You keep every transition (which is what you actually
 *    triage on) plus a heartbeat, so a rate is still measurable and "is this
 *    thing even running?" is still answerable.
 *  - {@link createSampler} emits a fixed fraction of a routine event, for cases
 *    where the value is purely statistical.
 *
 * Both are deliberately per-instance (not global): one gate per call site, so
 * two surfaces can never share a bucket and mask each other.
 */

/** How many identical outcomes may be skipped before one is emitted anyway. */
const DEFAULT_HEARTBEAT = 20;

export interface ChangeGate {
  /** True when this outcome should be emitted. */
  (signature: string): boolean;
  /** How many emissions this gate has suppressed since the last one it allowed. */
  readonly suppressed: number;
}

/**
 * Gate that passes on change, then every `heartbeat`-th identical repeat.
 *
 * The signature must capture everything that would make you read the event
 * differently — if a field can change without changing the signature, that
 * change becomes invisible, which is worse than the noise it saves.
 */
export function createChangeGate(heartbeat: number = DEFAULT_HEARTBEAT): ChangeGate {
  let last: string | null = null;
  let suppressed = 0;
  const gate = ((signature: string): boolean => {
    if (signature !== last) {
      last = signature;
      suppressed = 0;
      return true;
    }
    suppressed += 1;
    if (suppressed >= heartbeat) {
      suppressed = 0;
      return true;
    }
    return false;
  }) as { (signature: string): boolean; suppressed: number };
  Object.defineProperty(gate, 'suppressed', { get: () => suppressed });
  return gate as ChangeGate;
}

/**
 * Deterministic 1-in-N sampler — every Nth call passes.
 *
 * Deterministic rather than random so a rate derived from the sample is exact
 * (multiply by N) rather than approximate, and so tests are not flaky.
 */
export function createSampler(oneIn: number): () => boolean {
  let n = 0;
  return () => {
    n += 1;
    if (n >= oneIn) {
      n = 0;
      return true;
    }
    return false;
  };
}
