import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mutable mock state — hoisted so the vi.mock factories below can close over it.
const h = vi.hoisted(() => ({
  canEdit: { value: true },
  // Controllable flag state — defaults on (both readers shipped + committed-true).
  flags: { aiPhotoExtract: true, aiTravelExtract: true } as Record<string, boolean>,
  closeQuickAdd: vi.fn(),
  closeSheetForNavigation: vi.fn(),
  hasMarker: { value: false },
  routerPush: vi.fn(() => Promise.resolve()),
  routerReplace: vi.fn(() => Promise.resolve()),
  currentPath: { value: '/' },
}));

vi.mock('@/composables/usePermissions', () => ({
  usePermissions: () => ({ canEditActivities: h.canEdit }),
}));
vi.mock('@/config/flags', () => ({
  isFlagEnabled: (flag: string) => h.flags[flag] === true,
}));
vi.mock('@/composables/useQuickAdd', () => ({
  closeQuickAdd: h.closeQuickAdd,
  closeSheetForNavigation: h.closeSheetForNavigation,
  hasSheetHistoryMarker: () => h.hasMarker.value,
}));
vi.mock('@/router', () => ({
  default: {
    currentRoute: {
      get value() {
        return { path: h.currentPath.value };
      },
    },
    push: h.routerPush,
    replace: h.routerReplace,
  },
}));

import {
  useMagicReader,
  openPhotoReader,
  openDocumentReader,
  consumePendingMagic,
  pendingMagicReader,
} from '@/composables/useMagicReader';

/** Clear the module singleton between tests (matches either surface → null). */
function resetPending(): void {
  consumePendingMagic('photo', () => {}, false);
  consumePendingMagic('document', () => {}, false);
}

beforeEach(() => {
  vi.clearAllMocks();
  h.canEdit.value = true;
  h.flags.aiPhotoExtract = true;
  h.flags.aiTravelExtract = true;
  h.currentPath.value = '/';
  h.hasMarker.value = false;
  resetPending();
});

describe('useMagicReader — gating', () => {
  it('both readers available when the member can edit AND both flags are on', () => {
    h.canEdit.value = true;
    const r = useMagicReader();
    expect(r.canReadPhoto.value).toBe(true);
    expect(r.canReadDocument.value).toBe(true);
    expect(r.canReadAny.value).toBe(true);
  });

  it('both readers gated off when the member cannot edit activities (regardless of flags)', () => {
    h.canEdit.value = false;
    const r = useMagicReader();
    expect(r.canReadPhoto.value).toBe(false);
    expect(r.canReadDocument.value).toBe(false);
    expect(r.canReadAny.value).toBe(false);
  });

  it('photo reader gated off by the aiPhotoExtract flag even with edit permission', () => {
    h.canEdit.value = true;
    h.flags.aiPhotoExtract = false;
    const r = useMagicReader();
    expect(r.canReadPhoto.value).toBe(false);
    expect(r.canReadDocument.value).toBe(true); // travel flag still on
    expect(r.canReadAny.value).toBe(true);
  });

  it('document reader gated off by the aiTravelExtract flag even with edit permission', () => {
    h.canEdit.value = true;
    h.flags.aiTravelExtract = false;
    const r = useMagicReader();
    expect(r.canReadDocument.value).toBe(false);
    expect(r.canReadPhoto.value).toBe(true); // photo flag still on
    expect(r.canReadAny.value).toBe(true);
  });

  // BEHAVIOUR CHANGE (#72): this used to assert canReadAny === false with both flags off.
  // The recipe reader ships UNGATED by explicit decision, so it has no flag to turn off and
  // canReadAny now tracks PERMISSION once the flagged readers are dark. Consequence worth
  // knowing: clearing both AI flags is no longer a kill switch for the whole magic card —
  // the recipe chip still shows. Killing recipe capture means removing it, not unflagging it.
  it('with both flags off, the flagged readers are dark but the ungated recipe reader remains', () => {
    h.canEdit.value = true;
    h.flags.aiPhotoExtract = false;
    h.flags.aiTravelExtract = false;
    const r = useMagicReader();
    expect(r.canReadPhoto.value).toBe(false);
    expect(r.canReadDocument.value).toBe(false);
    expect(r.canReadRecipe.value).toBe(true);
    expect(r.canReadAny.value).toBe(true);
  });

  it('every reader — including the ungated recipe one — still requires edit permission', () => {
    h.canEdit.value = false;
    h.flags.aiPhotoExtract = true;
    h.flags.aiTravelExtract = true;
    const r = useMagicReader();
    expect(r.canReadRecipe.value).toBe(false);
    expect(r.canReadAny.value).toBe(false);
  });
});

describe('useMagicReader — dispatch', () => {
  it('openPhotoReader records the request, closes the sheet for navigation, and pushes /activities', () => {
    openPhotoReader();
    expect(pendingMagicReader.value).toBe('photo');
    expect(h.closeSheetForNavigation).toHaveBeenCalledOnce();
    expect(h.routerPush).toHaveBeenCalledWith('/activities');
  });

  it('openDocumentReader routes to /travel', () => {
    openDocumentReader();
    expect(pendingMagicReader.value).toBe('document');
    expect(h.routerPush).toHaveBeenCalledWith('/travel');
  });

  it('REPLACES (not pushes) the sheet-marker entry when launched cross-page from the FAB — no history.back() race', () => {
    h.hasMarker.value = true; // sheet was opened → marker on the stack
    openPhotoReader();
    expect(h.routerReplace).toHaveBeenCalledWith('/activities');
    expect(h.routerPush).not.toHaveBeenCalled();
    // closeQuickAdd (which would call history.back()) must NOT run on the cross-page path
    expect(h.closeQuickAdd).not.toHaveBeenCalled();
  });

  it('when already on the target route, pops the sheet via closeQuickAdd and does not navigate', () => {
    h.currentPath.value = '/activities';
    openPhotoReader();
    expect(pendingMagicReader.value).toBe('photo');
    expect(h.closeQuickAdd).toHaveBeenCalledOnce();
    expect(h.routerPush).not.toHaveBeenCalled();
    expect(h.routerReplace).not.toHaveBeenCalled();
  });
});

describe('consumePendingMagic', () => {
  it('runs the handler and clears the ref when the surface matches and the gate is open', () => {
    const handler = vi.fn();
    openPhotoReader();
    consumePendingMagic('photo', handler, true);
    expect(handler).toHaveBeenCalledOnce();
    expect(pendingMagicReader.value).toBeNull();
  });

  it('clears the ref WITHOUT running the handler when the gate is closed', () => {
    const handler = vi.fn();
    openPhotoReader();
    consumePendingMagic('photo', handler, false);
    expect(handler).not.toHaveBeenCalled();
    expect(pendingMagicReader.value).toBeNull();
  });

  it('no-ops when the surface does not match (leaves the ref for the right page)', () => {
    const handler = vi.fn();
    openPhotoReader();
    consumePendingMagic('document', handler, true);
    expect(handler).not.toHaveBeenCalled();
    expect(pendingMagicReader.value).toBe('photo');
  });

  it('is idempotent — a second consume after the first finds nothing', () => {
    const handler = vi.fn();
    openPhotoReader();
    consumePendingMagic('photo', handler, true);
    consumePendingMagic('photo', handler, true);
    expect(handler).toHaveBeenCalledOnce();
  });
});
