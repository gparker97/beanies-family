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
 * ⚠️ NARROW ON PURPOSE — A FALSE POSITIVE IS WORSE THAN A FALSE NEGATIVE.
 *
 * A missed OOM just degrades to today's behaviour. A false positive breaks
 * corruption SELF-HEALING: `applyAndProject.initAndLoadCache` clears a corrupt
 * cache so the next load can re-seed cleanly, and misclassifying real
 * corruption as "out of memory" skips that clear and leaves the user wedged.
 *
 * Two tempting matchers are therefore deliberately ABSENT:
 *
 *   • `e instanceof RangeError` — this is what the engine throws for
 *     `new Uint8Array(<absurd length>)` ("Invalid array length"), which is
 *     exactly what a CORRUPT payload carrying a garbage length prefix
 *     produces. Matching it would misclassify a whole class of real
 *     corruption.
 *   • a bare `unreachable` wasm trap — in release wasm EVERY Rust
 *     `panic!`/`unwrap()` compiles to `unreachable`, not just `rust_oom`, so
 *     matching it would sweep in most Automerge decode panics.
 *
 * If a real-world OOM ever arrives in a shape we don't match, it shows up in
 * the firehose as a `CorruptPayloadError` and we add that exact string here.
 * That is the safe direction to be wrong in.
 */

/**
 * Phrases that only ever mean "the allocator gave up".
 *
 * ⚠️ `/array buffer allocation failed/i` WAS in this list and had to be removed.
 * V8 throws `RangeError: Array buffer allocation failed` for
 * `new Uint8Array(<garbage length>)` — which is precisely what a CORRUPT payload
 * carrying a bad length prefix produces. Including it meant real corruption was
 * classified as an OOM, the self-heal cache clear was skipped, and the user was
 * told "your pod file is safe, clearing your data won't help" about a genuinely
 * damaged cache: permanently wedged, no in-app recovery. Exactly the
 * false-positive this file's rationale forbids, defeated by its own match list.
 *
 * Verified, and the reason a "we exclude RangeError" argument is not enough:
 *   new Uint8Array(1099511627776) → RangeError: Array buffer allocation failed
 *   new Uint8Array(-1)            → RangeError: Invalid typed array length: -1
 * Only the SECOND shape is the one a naive test would reach for.
 */
const ALLOCATION_FAILURE = [
  /out of memory/i,
  /memory allocation failed/i,
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
