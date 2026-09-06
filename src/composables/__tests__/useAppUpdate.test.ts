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
vi.mock('@/services/appUpdate/versionPolicy', () => ({
  fetchUpdateFloor: () => Promise.resolve(floor.value),
}));

const gates = vi.hoisted(() => ({ online: true, quiet: true, loaded: true }));
vi.mock('@/composables/useOnline', () => ({
  useOnline: () => ({ isOnline: { value: gates.online } }),
}));
vi.mock('@/utils/appQuiet', () => ({ isAppQuiet: () => gates.quiet }));
vi.mock('@/services/automerge/projection', () => ({ isLoaded: () => gates.loaded }));

const confirmMock = vi.hoisted(() =>
  vi.fn((_opts: Record<string, unknown>) => Promise.resolve(true))
);
vi.mock('@/composables/useConfirm', () => ({ confirm: confirmMock }));
vi.mock('@/services/telemetry/logEvent', () => ({ logEvent: vi.fn() }));
vi.mock('@/constants/appVersion', () => ({ APP_VERSION: '0.16' }));

import { logEvent } from '@/services/telemetry/logEvent';
import { STORE_URL } from '@beanies/brand/nav';
import { useAppUpdate, storeUrlFor, __resetAppUpdateForTesting } from '../useAppUpdate';

/** Start the composable and let its launch check settle. */
async function launch(): Promise<void> {
  useAppUpdate();
  await vi.waitFor(() => expect(logEvent).toHaveBeenCalled());
  await Promise.resolve();
}

describe('useAppUpdate', () => {
  beforeEach(() => {
    __resetAppUpdateForTesting();
    vi.clearAllMocks();
    platform.value = 'ios';
    floor.value = '0.17';
    gates.online = true;
    gates.quiet = true;
    gates.loaded = true;
    resume.handler = null;
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

  it('says nothing when the floor could not be read at all', async () => {
    floor.value = null;
    await launch();
    expect(confirmMock).not.toHaveBeenCalled();
  });

  it('says nothing when the floor is a typo, and reports the reason', async () => {
    // A hand-edited, hand-deployed file WILL be mistyped one day. It must nag
    // nobody, and it must not do so invisibly.
    floor.value = 'v0.17-beta';
    await launch();
    expect(confirmMock).not.toHaveBeenCalled();
    expect(vi.mocked(logEvent).mock.calls.map((c) => c[0].context?.detail)).toContain(
      'unparseable-version'
    );
  });

  it.each([
    ['offline', () => (gates.online = false)],
    ['mid-save or with an overlay open', () => (gates.quiet = false)],
    ['still booting', () => (gates.loaded = false)],
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
