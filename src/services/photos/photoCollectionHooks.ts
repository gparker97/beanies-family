/**
 * Photo-collection hooks — RE-EXPORT shim.
 *
 * The hook implementations moved into `worker/photoOps.ts` (pure, worker-shared)
 * under ADR-032 so the same doc-walking attach/collect runs in the worker. This
 * module stays as a stable import path for the main-thread callers (the vacation
 * UI builds composite segment ids via `vacationSegmentEntityId`; App.vue's
 * legacy registration imports the hook objects). `photoOps` is Automerge-free,
 * so importing these on the main thread pulls in no WASM.
 */
export {
  vacationSegmentEntityId,
  forEachBookingSegment,
  avatarPhotoHooks,
  vacationPhotoHooks,
  type PhotoCollectionHooks,
} from '@/services/automerge/worker/photoOps';
