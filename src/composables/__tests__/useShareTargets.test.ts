/**
 * The share-adapter lifecycle, and specifically its LOUDNESS (#64).
 *
 * `if (!adapter.isSupported()) continue;` was the whole of the unsupported path, and it is
 * how a native build with no working share target reached users twice: the iOS plugin was
 * never registered with the Capacitor bridge, `isPluginAvailable` answered false, the
 * adapter was skipped, and absolutely nothing was written anywhere. On device the share
 * simply did nothing; in CloudWatch there was not one event to explain it.
 *
 * On a native platform, zero started adapters is always a defect, never a device limitation.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { defineComponent, h } from 'vue';
import { mount } from '@vue/test-utils';

const logEvent = vi.fn();
const reportError = vi.fn();
const platform = { name: 'ios', native: true };
const supported = { value: false };
const stop = vi.fn();

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    getPlatform: () => platform.name,
    isNativePlatform: () => platform.native,
  },
}));
vi.mock('@/services/share', () => ({
  SHARE_ADAPTERS: [
    {
      name: 'ios',
      isSupported: () => supported.value,
      start: () => stop,
    },
  ],
}));
vi.mock('../useSharedDocumentIngest', () => ({ ingestSharedContent: vi.fn() }));
vi.mock('@/services/telemetry/logEvent', () => ({ logEvent: (...a: unknown[]) => logEvent(...a) }));
vi.mock('@/utils/errorReporter', () => ({ reportError: (...a: unknown[]) => reportError(...a) }));

import { useShareTargets } from '../useShareTargets';

const Host = defineComponent({
  setup() {
    useShareTargets();
    return () => h('div');
  },
});

describe('useShareTargets', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    platform.name = 'ios';
    platform.native = true;
    supported.value = false;
  });

  it('REPORTS an error when a native build starts no adapter at all', () => {
    // The case that shipped twice. An unregistered plugin is indistinguishable from an
    // unsupported device unless this fires.
    mount(Host);

    expect(reportError).toHaveBeenCalledTimes(1);
    const call = reportError.mock.calls[0][0];
    expect(call.severity).toBe('error');
    expect(call.surface).toBe('share-target-ingest');
    // Name the suspect: whoever reads this alert should not have to guess.
    expect(call.message).toContain('ShareIntent');
    expect(call.context).toMatchObject({ os: 'ios' });
  });

  it('stays quiet on plain web, where having no native adapter is normal', () => {
    platform.name = 'web';
    platform.native = false;
    mount(Host);
    expect(reportError).not.toHaveBeenCalled();
  });

  it('emits a success counter when an adapter does start, so the failure has a rate', () => {
    supported.value = true;
    mount(Host);

    expect(reportError).not.toHaveBeenCalled();
    expect(logEvent).toHaveBeenCalledTimes(1);
    expect(logEvent.mock.calls[0][0].context).toMatchObject({
      action: 'start',
      os: 'ios',
      file_count: 1,
    });
  });

  it('stops the adapters it started when the host unmounts', () => {
    supported.value = true;
    mount(Host).unmount();
    expect(stop).toHaveBeenCalledTimes(1);
  });
});
