// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ref, nextTick } from 'vue';

// Mutable platform flags + reactive member id (drives the composable's watch).
let iosNotInstalled = true;
let standalone = false;
const memberId = ref('m1');

vi.mock('@/services/sync/capabilities', () => ({
  isIosSafariNotInstalled: () => iosNotInstalled,
  isStandalone: () => standalone,
}));
vi.mock('@/stores/familyStore', () => ({
  useFamilyStore: () => ({
    get currentMemberId() {
      return memberId.value;
    },
  }),
}));
vi.mock('@/utils/openExternal', () => ({ openExternal: vi.fn() }));
vi.mock('@/utils/marketing', () => ({ MARKETING_URL: 'https://app.beanies.family' }));
vi.mock('@/utils/errorReporter', () => ({ reportError: vi.fn() }));

import { useInstallNudge } from '@/composables/useInstallNudge';

let memberSeq = 0;
async function freshNudge() {
  // New member id each time → the composable's watch reloads state from the
  // (cleared) localStorage, isolating the module-singleton between tests.
  memberId.value = `m${++memberSeq}`;
  const n = useInstallNudge();
  await nextTick();
  return n;
}

beforeEach(() => {
  localStorage.clear();
  iosNotInstalled = true;
  standalone = false;
});

describe('useInstallNudge gate', () => {
  it('surfaces on iOS Safari (not installed) after ensureNudgeIssued', async () => {
    const n = await freshNudge();
    expect(n.nudge.value).toBeNull(); // not yet issued (shownAt null)
    n.ensureNudgeIssued();
    expect(n.nudge.value).not.toBeNull();
  });

  it('never surfaces on a non-iOS / desktop browser', async () => {
    iosNotInstalled = false;
    const n = await freshNudge();
    n.ensureNudgeIssued();
    expect(n.nudge.value).toBeNull();
  });

  it('self-cancels (→ installed) when running standalone', async () => {
    const n = await freshNudge();
    n.ensureNudgeIssued();
    expect(n.nudge.value).not.toBeNull();
    // Simulate the user having installed the PWA.
    standalone = true;
    iosNotInstalled = false;
    n.ensureNudgeIssued();
    expect(n.nudge.value).toBeNull();
  });

  it('dismiss retires it for good (one-time)', async () => {
    const n = await freshNudge();
    n.ensureNudgeIssued();
    expect(n.nudge.value).not.toBeNull();
    n.dismiss();
    expect(n.nudge.value).toBeNull();
    // Re-issuing does not bring it back.
    n.ensureNudgeIssued();
    expect(n.nudge.value).toBeNull();
  });

  it('"Already installed" retires it', async () => {
    const n = await freshNudge();
    n.ensureNudgeIssued();
    n.markInstalled();
    expect(n.nudge.value).toBeNull();
  });

  it('persists dismissal across reloads (same member)', async () => {
    const n = await freshNudge();
    const id = memberId.value;
    n.ensureNudgeIssued();
    n.dismiss();
    // Simulate a reload: re-mount the composable for the same member.
    memberId.value = '';
    await nextTick();
    memberId.value = id;
    const n2 = useInstallNudge();
    await nextTick();
    n2.ensureNudgeIssued();
    expect(n2.nudge.value).toBeNull();
  });
});
