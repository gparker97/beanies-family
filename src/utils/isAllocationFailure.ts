/**
 * Is this throw a memory-allocation failure rather than bad data?
 *
 * A ~4MB `.beanpod` failed to open on a Samsung Galaxy Tab A9+ with
 * `error inflating document chunk ops: out of memory` — Automerge's Rust/WASM
 * side running out of linear memory while inflating a history-heavy document.
 * That was wrapped as `CorruptPayloadError`, which is a lie (the file is fine)
 * AND destructive (the cache-load path DELETES the local cache on it, which
 * cannot possibly help and throws away the one copy that might have loaded).
 *
 * ⚠️ BOTH DIRECTIONS COST SOMETHING. WEIGH THEM, DON'T ASSUME.
 *
 * An earlier version of this file asserted that a false positive is always
 * worse and narrowed on that basis. That is not true, and acting on it removed
 * the one phrase a real tablet actually throws:
 *
 *   • FALSE POSITIVE (corruption called OOM) — `initAndLoadCache` skips the
 *     cache clear, so a genuinely corrupt cache is not self-healed and the
 *     user is wedged until they clear data by hand. Nothing is destroyed; the
 *     pod on Drive is untouched.
 *   • FALSE NEGATIVE (OOM called corruption) — `initAndLoadCache` DELETES the
 *     whole cache DB: the base and every increment, including mutations that
 *     may never have reached Drive. It cannot help (the retry re-downloads and
 *     fails identically) and it is not reversible.
 *
 * Data loss beats being wedged, so where a message is genuinely ambiguous the
 * tie is broken by which failure it can actually be ON THIS PATH — see the
 * match list below, which argues the one ambiguous phrase explicitly.
 *
 * Two tempting matchers are therefore deliberately ABSENT:
 *
 *   • `e instanceof RangeError` as a blanket rule — the CLASS says nothing.
 *     V8 uses it for both a bad length and a real allocation failure, so the
 *     list below matches specific MESSAGES and argues the ambiguous one from
 *     the call path.
 *   • a bare `unreachable` wasm trap — in release wasm EVERY Rust
 *     `panic!`/`unwrap()` compiles to `unreachable`, not just `rust_oom`, so
 *     matching it would sweep in most Automerge decode panics.
 *
 * If a real-world OOM ever arrives in a shape we don't match, it shows up in
 * the firehose as a `CorruptPayloadError` — after the cache has already been
 * deleted. So an unmatched shape is a bug to fix quickly, not a comfortable
 * default: watch `surface: 'pod-load-memory'` against the corrupt-pod reports
 * and add the exact string here when the two disagree.
 */

/**
 * Phrases that mean "the allocator gave up" ON THIS PATH.
 *
 * ⚠️ `/array buffer allocation failed/i` is the contested one, and it has been
 * in and out of this list. The empirical fact is settled: V8 throws exactly
 * that message BOTH for `new Uint8Array(<absurd length>)` and for a genuine
 * allocation failure under memory pressure (verified under `ulimit -v`). The
 * string alone cannot tell them apart.
 *
 * What settles it is the CALL PATH, and it resolves toward out-of-memory,
 * because a garbage length cannot reach an allocator here:
 *
 *   • `base64ToBuffer` sizes `new Uint8Array(size)` from the base64 STRING's
 *     length — a trusted number, never payload content.
 *   • `unframeChanges` reads its length prefixes from content, but hands them
 *     to `buf.subarray()` behind explicit bounds checks. `subarray` allocates
 *     nothing; an out-of-range prefix throws its own "truncated" Error.
 *   • `decryptPayload` sizes from the ciphertext length, inside Web Crypto.
 *   • Automerge's own decode failures arrive as Automerge messages
 *     ("invalid chunk type", "out of bounds table access") or as a wasm trap.
 *
 * So there is no content-derived allocation on the pod-open path, and treating
 * this message as corruption is what actually caused harm: on a 3GB tablet the
 * first thing to fail is the ~3MB `new Uint8Array` in `base64ToBuffer`, which
 * would have been classified `CorruptPayloadError` and made `initAndLoadCache`
 * DELETE the whole cache DB — the exact data loss this file exists to prevent,
 * and it would have defeated the `decrypt`-step classification entirely.
 *
 * `Invalid typed array length` / `Invalid array length` stay OUT. Those are
 * unambiguous: they mean a length that is negative or not a valid array length,
 * which no allocator-pressure failure produces. They are the corruption
 * signature, and matching them would skip the self-heal that corruption needs.
 *
 *   new Uint8Array(-1)   → RangeError: Invalid typed array length: -1   (OUT)
 *   new Uint8Array(2^40) → RangeError: Array buffer allocation failed   (IN)
 *
 * ⚠️ SCOPE: this classifier is for the pod-open path. Do not reuse it where
 * a length IS derived from untrusted content without re-doing this analysis.
 */
const ALLOCATION_FAILURE = [
  /out of memory/i,
  /memory allocation failed/i,
  /array buffer allocation failed/i,
  /allocation size overflow/i,
  /wasm memory|cannot grow memory|memory\.grow/i,
];

function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : typeof e === 'string' ? e : '';
}

export function isAllocationFailure(e: unknown): boolean {
  if (ALLOCATION_FAILURE.some((re) => re.test(messageOf(e)))) return true;
  // ONE hop into `cause`, because Automerge 3.x wraps some Rust failures.
  // Deliberately a fixed single step rather than a loop: no cycle risk, no
  // unbounded walk, and a deeper nesting than this has never been observed.
  const cause = e instanceof Error ? (e.cause as unknown) : undefined;
  return cause !== undefined && ALLOCATION_FAILURE.some((re) => re.test(messageOf(cause)));
}
