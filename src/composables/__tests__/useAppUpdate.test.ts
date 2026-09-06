/**
 * The native update prompt, and every reason it must stay quiet.
 *
 * The defects pinned here are the ones that would ship silently. A prompt
 * raised before the app is past boot is a modal nobody can see or dismiss
 * (`ConfirmModal` is z-250 under a z-300 boot overlay) which then holds
 * `hasOpenOverlays()` true for the rest of the session. A prompt raised on web
 * would fight the service worker, which has already done the job. And a
 * `resume` listener that outlives its scope is a silent leak with a long fuse.
 *
 * Everything is driven through `useAppUpdate()` and the captured `resume`
 * handler, which is exactly how the composable is reached in production, so a
 * passing test says something about the shipped path rather than about a seam
 * invented for it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { effectScope } from 'vue';

const platform = vi.hoisted(() => ({ value: 'ios' as 'web' | 'ios' | 'android' }));
vi.mock('@/services/sync/capabilities', () => ({
  isNative: () => platform.value !== 'web',
  getPlatform: () => platform.value,
}));

const resume = vi.hoisted(() => ({ handler: null as null | (() => void), remove: vi.fn() }));
vi.mock('@capacitor/app', () => ({
  App: {
    addListener: (event: string, fn: () => void) => {
      if (event === 'resume') resume.handler = fn;
      return Promise.resolve({ remove: resume.remove });
    },
  },
}));

const floor = vi.hoisted(() => ({ value: null as string | null }));
vi.mock('@/services/appUpdate/versionPolicy', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/appUpdate/versionPolicy')>()),
  fetchUpdateFloor: () => Promise.resolve(floor.value),
}));

const gates = vi.hoisted(() => ({ quiet: true, loaded: true }));
// ⚠️ A REAL REF. A plain `{ value }` is not a valid `watch` source: Vue warns
// and watches nothing, so every case here logged "Invalid watch source" and the
// `isOnline` half of the composable's watcher was pinned by nothing at all.
const isOnline = vi.hoisted(() => {
  return { ref: null as null | { value: boolean } };
});
vi.mock('@/composables/useOnline', async () => {
  const { ref } = await import('vue');
  isOnline.ref = ref(true);
  return { useOnline: () => ({ isOnline: isOnline.ref }) };
});
vi.mock('@/utils/appQuiet', () => ({ isAppQuiet: () => gates.quiet }));

const fatalMessage = vi.hoisted(() => ({ value: null as string | null }));
vi.mock('@/stores/fatalErrorStore', () => ({
  useFatalErrorStore: () => ({ message: fatalMessage.value }),
}));

vi.mock('@/composables/useSessionInterruption', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/composables/useSessionInterruption')>()),
}));
// Only `isLoaded` is stubbed. `docVersion` stays the REAL shallowRef, because
// the composable watches it to learn the family document has arrived and a stub
// number would make that watcher fire never — which is precisely the defect the
// test below exists to catch.
vi.mock('@/services/automerge/projection', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/automerge/projection')>()),
  isLoaded: () => gates.loaded,
}));

const confirmMock = vi.hoisted(() =>
  vi.fn((_opts: Record<string, unknown>) => Promise.resolve(true))
);
vi.mock('@/composables/useConfirm', () => ({ confirm: confirmMock }));
vi.mock('@/services/telemetry/logEvent', () => ({ logEvent: vi.fn() }));
vi.mock('@/constants/appVersion', () => ({ APP_VERSION: '0.16' }));

import { logEvent } from '@/services/telemetry/logEvent';
import { STORE_URL } from '@beanies/brand/nav';
import { docVersion } from '@/services/automerge/projection';
import { __resetSessionInterruptionForTests, claimInterruption } from '../useSessionInterruption';
import { useAppUpdate, __resetAppUpdateForTesting } from '../useAppUpdate';
import { storeUrlFor } from '@/services/appUpdate/storeUrl';

/** Start the composable and let its launch check settle. */
async function launch(): Promise<void> {
  useAppUpdate();
  await vi.waitFor(() => expect(logEvent).toHaveBeenCalled());
  await Promise.resolve();
}

describe('useAppUpdate, with a build whose own version does not parse', () => {
  // ⚠️ DRIVEN FROM `APP_VERSION`, NOT FROM THE FLOOR, which is the only way this
  // branch is reachable: `versionPolicy` has already screened the floor with the
  // same grammar, so a bad floor never gets this far. Reaching here means a bad
  // constant SHIPPED, which silences the prompt for the whole fleet and is fixed
  // in an entirely different file — hence its own CloudWatch class.
  beforeEach(() => {
    __resetSessionInterruptionForTests();
    __resetAppUpdateForTesting();
    vi.clearAllMocks();
    platform.value = 'ios';
    floor.value = '0.17';
    isOnline.ref!.value = true;
    gates.quiet = true;
    gates.loaded = true;
    fatalMessage.value = null;
  });

  it('reports its own class, and asks nobody', async () => {
    vi.doMock('@/constants/appVersion', () => ({ APP_VERSION: 'nightly' }));
    vi.resetModules();
    const mod = await import('../useAppUpdate');
    const telemetry = await import('@/services/telemetry/logEvent');
    mod.__resetAppUpdateForTesting();
    mod.useAppUpdate();
    await vi.waitFor(() => expect(telemetry.logEvent).toHaveBeenCalled());
    expect(vi.mocked(telemetry.logEvent).mock.calls.map((c) => c[0].context?.detail)).toContain(
      'app-version-unparseable'
    );
    expect(confirmMock).not.toHaveBeenCalled();
    vi.doUnmock('@/constants/appVersion');
    vi.resetModules();
  });
});

describe('useAppUpdate', () => {
  beforeEach(() => {
    __resetAppUpdateForTesting();
    vi.clearAllMocks();
    __resetSessionInterruptionForTests();
    platform.value = 'ios';
    floor.value = '0.17';
    isOnline.ref!.value = true;
    gates.quiet = true;
    gates.loaded = true;
    fatalMessage.value = null;
    resume.handler = null;
    docVersion.value = 0;
    confirmMock.mockResolvedValue(true);
  });

  it('is completely inert on web, where the service worker already updates the app', async () => {
    platform.value = 'web';
    useAppUpdate();
    await Promise.resolve();
    expect(logEvent).not.toHaveBeenCalled();
    expect(confirmMock).not.toHaveBeenCalled();
    expect(resume.handler).toBeNull();
  });

  it('has no store listing to offer on web, which is what keeps the block web-safe', () => {
    // ⚠️ THE GUARD `surfacePayloadFatal` LEANS ON. It calls `storeUrlFor` with
    // no platform test of its own, so this null IS the web guarantee.
    expect(storeUrlFor('web')).toBeNull();
    expect(storeUrlFor('ios')).toBe(STORE_URL.ios);
    expect(storeUrlFor('android')).toBe(STORE_URL.android);
  });

  it('asks once when the build is behind the floor', async () => {
    await launch();
    expect(confirmMock).toHaveBeenCalledTimes(1);
    expect(confirmMock.mock.calls[0]![0]).toMatchObject({
      title: 'appUpdate.prompt.title',
      confirmLabel: 'appUpdate.prompt.confirm',
      cancelLabel: 'appUpdate.prompt.notNow',
      variant: 'info',
      confirmHref: STORE_URL.ios,
    });
  });

  it('sends the confirm control at the store as a REAL link, not a post-await call', async () => {
    // The gesture cannot survive `confirm()`'s promise, so the anchor is the
    // whole mechanism. A `confirmHref` that went missing would read as "I
    // tapped Update and nothing happened".
    await launch();
    expect(confirmMock.mock.calls[0]![0].confirmHref).toBe(STORE_URL.ios);
  });

  it('does not ask twice in one session, however many times the app resumes', async () => {
    await launch();
    resume.handler!();
    resume.handler!();
    await Promise.resolve();
    expect(confirmMock).toHaveBeenCalledTimes(1);
  });

  it('says nothing when the build already meets the floor', async () => {
    floor.value = '0.16';
    await launch();
    expect(confirmMock).not.toHaveBeenCalled();
  });

  it('exposes whether an update is available, which is what makes that member live', async () => {
    const { updateAvailable } = useAppUpdate();
    await vi.waitFor(() => expect(updateAvailable.value).toBe(true));

    __resetAppUpdateForTesting();
    floor.value = '0.16';
    const after = useAppUpdate();
    await vi.waitFor(() => expect(logEvent).toHaveBeenCalled());
    expect(after.updateAvailable.value).toBe(false);
  });

  it('says nothing when the floor could not be read at all', async () => {
    floor.value = null;
    await launch();
    expect(confirmMock).not.toHaveBeenCalled();
  });

  it('says nothing when the floor is a typo, and nags nobody', async () => {
    // A hand-edited, hand-deployed file WILL be mistyped one day. `versionPolicy`
    // screens it and answers `null`, so this build simply never learns of a
    // floor. It must not nag, and it must not throw.
    floor.value = 'v0.17-beta';
    await launch();
    expect(confirmMock).not.toHaveBeenCalled();
  });

  it.each([
    ['offline', () => (isOnline.ref!.value = false)],
    ['mid-save or with an overlay open', () => (gates.quiet = false)],
    ['still booting', () => (gates.loaded = false)],
    // ⚠️ THE RECOVERY OVERLAY, which none of the gates above can see. It is a
    // bare div at z-300, not a `BaseModal`, so it never enters the overlay
    // stack, and the init watchdog can raise it with the document already
    // loaded. A prompt then opens UNDERNEATH it: invisible, untappable, and it
    // spends the one prompt this session gets.
    ['stopped by the recovery overlay', () => (fatalMessage.value = 'spilled beans')],
    // #45: one unsolicited surface per load. The PIN modal got there first.
    ['another surface has already interrupted', () => claimInterruption('pin-prompt')],
  ])('holds its tongue while %s', async (_label, close) => {
    close();
    await launch();
    expect(confirmMock).not.toHaveBeenCalled();
  });

  it('asks on resume once a gate that was closed at launch has opened', async () => {
    // Resume re-evaluates the GATES against the memoised floor; it is the
    // reason a prompt suppressed during boot is deferred rather than lost.
    gates.loaded = false;
    await launch();
    expect(confirmMock).not.toHaveBeenCalled();

    gates.loaded = true;
    resume.handler!();
    await vi.waitFor(() => expect(confirmMock).toHaveBeenCalledTimes(1));
  });

  it('asks when the device comes back online, with no resume and no new document', async () => {
    // The other half of the watcher. Suppressed while offline, and the moment
    // signal returns there is nothing else to prod it.
    isOnline.ref!.value = false;
    await launch();
    expect(confirmMock).not.toHaveBeenCalled();

    isOnline.ref!.value = true;
    await vi.waitFor(() => expect(confirmMock).toHaveBeenCalledTimes(1));
  });

  it('does not consume the one interruption slot when it was going to stay quiet', async () => {
    // Claimed at the show site, not at the check: a prompt deferred for boot
    // must leave the slot for the PIN modal that is about to need it.
    gates.loaded = false;
    await launch();
    expect(claimInterruption('someone-else')).toBe(true);
  });

  it('asks WITHOUT a resume once the family document arrives', async () => {
    // ⚠️ THE DEFECT THAT MADE THE WHOLE FEATURE ALMOST NEVER FIRE. The floor
    // resolves in a couple of hundred milliseconds while the document is still
    // loading, so the launch check always found `isLoaded()` false. With resume
    // as the only other trigger, a launch nobody backgrounds asked nobody.
    gates.loaded = false;
    await launch();
    expect(confirmMock).not.toHaveBeenCalled();

    gates.loaded = true;
    docVersion.value++; // the same bump that flips `loaded` true in projection
    await vi.waitFor(() => expect(confirmMock).toHaveBeenCalledTimes(1));
  });

  it('says WHY it stayed quiet, once per reason, not once per re-evaluation', async () => {
    // A fleet reporting behind=true and never prompting has to be explicable.
    // But every gate is re-checked on resume and on every document change, so
    // the answer has to be bounded or it is a flood from exactly the devices
    // with something to say.
    gates.loaded = false;
    await launch();
    resume.handler!();
    docVersion.value++;
    docVersion.value++;
    await Promise.resolve();

    const deferred = vi
      .mocked(logEvent)
      .mock.calls.map((c) => c[0])
      .filter((e) => e.context?.action === 'prompt-deferred');
    expect(deferred).toHaveLength(1);
    expect(deferred[0]!.context?.detail).toBe('booting');
  });

  it('names the FIRST closed gate, so the reason is the one that mattered', async () => {
    isOnline.ref!.value = false;
    gates.loaded = false;
    await launch();
    const deferred = vi
      .mocked(logEvent)
      .mock.calls.map((c) => c[0])
      .filter((e) => e.context?.action === 'prompt-deferred');
    expect(deferred[0]!.context?.detail).toBe('offline');
  });

  it('counts the check on every launch, so a dead floor is distinguishable from a healthy fleet', async () => {
    await launch();
    expect(vi.mocked(logEvent).mock.calls.map((c) => c[0])).toContainEqual(
      expect.objectContaining({
        surface: 'app-update',
        context: expect.objectContaining({
          action: 'checked',
          os: 'ios',
          detail: 'floor=0.17,behind=true',
        }),
      })
    );
  });

  it('records a dismissal, so the funnel has a denominator and a drop-off', async () => {
    confirmMock.mockResolvedValue(false);
    await launch();
    await vi.waitFor(() =>
      expect(vi.mocked(logEvent).mock.calls.map((c) => c[0].context?.action)).toContain(
        'prompt-dismissed'
      )
    );
  });

  it('removes the resume listener when its scope is disposed', async () => {
    // A leaked native listener fires against a dead scope forever and nothing
    // reports it.
    __resetAppUpdateForTesting();
    const scope = effectScope(true);
    scope.run(() => useAppUpdate());
    await vi.waitFor(() => expect(resume.handler).not.toBeNull());
    __resetAppUpdateForTesting();
    await vi.waitFor(() => expect(resume.remove).toHaveBeenCalled());
    scope.stop();
  });
});
