/**
 * Change-log chunk-name predicate — the ONLY surviving piece of the retired
 * ADR-032 Plan B incremental change-log transport (see the compaction-primary
 * pivot, docs/plans/2026-07-15-compaction-primary-retire-change-chunks.md).
 *
 * The change-chunk write/read path was retired 2026-07-15 (net-negative per prod
 * telemetry — the compacted base is authoritative on every save). This predicate
 * is retained ONLY so the one-time residue cleanup can identify and delete the
 * `changes/*.beanchanges` files left in existing families' Drive folders.
 *
 * ⚠️ TEMPORARY: remove this file together with the `chunk-residue-cleanup` in
 * syncService.ts once that surface's `action:'deleted'` breadcrumb has fallen to
 * ~0 across the fleet for one full rollout cycle (tracked follow-up).
 */
const CHANGES_PREFIX = 'changes/';
const CHANGES_SUFFIX = '.beanchanges';

export const isChunkName = (name: string): boolean =>
  name.startsWith(CHANGES_PREFIX) && name.endsWith(CHANGES_SUFFIX);
