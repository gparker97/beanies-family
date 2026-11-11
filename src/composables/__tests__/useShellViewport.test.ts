import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { effectScope, nextTick, ref } from 'vue';
import {
  SHELL_RESAMPLE_MS,
  resetShellGeometryForTests,
  useShellViewport,
} from '../useShellViewport';

vi.mock('@/services/telemetry', () => ({ logEvent: vi.fn() }));
vi.mock('@/utils/errorReporter', () => ({ reportError: vi.fn() }));
vi.mock('@/services/sync/capabilities', () => ({ isNative: vi.fn(() => false) }));
import { logEvent } from '@/services/telemetry';
import { isNative } from '@/services/sync/capabilities';

let scrollY = 0;
let vvTop = 0;
let coarse = true;
const scrollTo = vi.fn((_x: number, y: number) => {
  scrollY = y;
});

function events(name: string) {
  return vi.mocked(logEvent).mock.calls.filter(([e]) => e.message === name);
}

function mount(shown = true) {
  const showLayout = ref(shown);
  const scope = effectScope();
  scope.run(() => useShellViewport(showLayout));
  return { showLayout, scope };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  resetShellGeometryForTests();
  vi.mocked(isNative).mockReturnValue(false);
  scrollY = 0;
  vvTop = 0;
  coarse = true;
  Object.defineProperty(window, 'scrollY', { configurable: true, get: () => scrollY });
  Object.defineProperty(window, 'visualViewport', {
    configurable: true,
    get: () => ({ offsetTop: vvTop, height: 700, pageTop: vvTop }),
  });
  window.scrollTo = scrollTo as unknown as typeof window.scrollTo;
  window.matchMedia = vi.fn(() => ({ matches: coarse })) as unknown as typeof window.matchMedia;
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useShellViewport', () => {
  it('resets a scrolled window and logs it', async () => {
    scrollY = 80;
    const { scope } = mount();
    await nextTick();
    expect(scrollTo).toHaveBeenCalledWith(0, 0);
    expect(events('window-scroll-reset')[0][0]).toMatchObject({
      level: 'warn',
      surface: 'app-shell',
      context: { action: 'window-scroll-reset', detail: 'sy=80,vvt=0,pass=1' },
    });
    scope.stop();
  });

  it('resets when the visual viewport is panned', async () => {
    vvTop = 40;
    const { scope } = mount();
    await nextTick();
    expect(scrollTo).toHaveBeenCalledWith(0, 0);
    expect(events('window-scroll-reset')[0][0].context?.detail).toBe('sy=0,vvt=40,pass=1');
    scope.stop();
  });

  it('does nothing when at the top, and resamples once as pass 2', async () => {
    const { scope } = mount();
    await nextTick();
    expect(scrollTo).not.toHaveBeenCalled();
    scrollY = 12;
    vi.advanceTimersByTime(SHELL_RESAMPLE_MS);
    expect(events('window-scroll-reset')[0][0].context?.detail).toBe('sy=12,vvt=0,pass=2');
    scope.stop();
  });

  it('emits shell-geometry once per page load, on touch devices only', async () => {
    const first = mount();
    await nextTick();
    vi.advanceTimersByTime(SHELL_RESAMPLE_MS);
    expect(events('shell-geometry')).toHaveLength(1);
    expect(String(events('shell-geometry')[0][0].context?.detail)).toMatch(
      /^ih=\d+,vvh=700,vvt=0,pt=0,ch=\d+,shell=-?\d+,sy=0,hdr=-?\d+$/
    );
    first.scope.stop();
    const second = mount();
    await nextTick();
    vi.advanceTimersByTime(SHELL_RESAMPLE_MS);
    expect(events('shell-geometry')).toHaveLength(1);
    second.scope.stop();

    resetShellGeometryForTests();
    coarse = false;
    const desktop = mount();
    await nextTick();
    vi.advanceTimersByTime(SHELL_RESAMPLE_MS);
    expect(events('shell-geometry')).toHaveLength(1);
    desktop.scope.stop();
  });

  it('waits for the layout to show and clears its timer on dispose', async () => {
    scrollY = 50;
    const { showLayout, scope } = mount(false);
    await nextTick();
    expect(scrollTo).not.toHaveBeenCalled();
    showLayout.value = true;
    await nextTick();
    expect(scrollTo).toHaveBeenCalledTimes(1);
    scope.stop();
    vi.advanceTimersByTime(SHELL_RESAMPLE_MS * 2);
    expect(events('shell-geometry')).toHaveLength(0);
  });

  it('is a no-op on native', async () => {
    vi.mocked(isNative).mockReturnValue(true);
    scrollY = 80;
    const { scope } = mount();
    await nextTick();
    vi.advanceTimersByTime(SHELL_RESAMPLE_MS);
    expect(scrollTo).not.toHaveBeenCalled();
    expect(logEvent).not.toHaveBeenCalled();
    scope.stop();
  });
});
