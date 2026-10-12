import { describe, expect, it, vi, beforeEach } from 'vitest';
import { nextTick } from 'vue';

const native = { value: false };
const getInfo = vi.fn();
const logEvent = vi.fn();

vi.mock('@capacitor/app', () => ({ App: { getInfo: (...a: unknown[]) => getInfo(...a) } }));
vi.mock('@/services/sync/capabilities', () => ({ isNative: () => native.value }));
vi.mock('@/services/telemetry/logEvent', () => ({ logEvent: (...a: unknown[]) => logEvent(...a) }));
vi.mock('@/utils/diagnosticContext', () => ({ getProductVersionLabel: () => 'v0.95' }));

import { useProductVersionLabel } from '../useProductVersionLabel';

async function settle() {
  await Promise.resolve();
  await Promise.resolve();
  await nextTick();
}

describe('useProductVersionLabel', () => {
  beforeEach(() => {
    native.value = false;
    getInfo.mockReset();
    logEvent.mockReset();
  });

  it('on web it is the product version and never touches the App plugin', async () => {
    const label = useProductVersionLabel();
    await settle();
    expect(label.value).toBe('v0.95');
    expect(getInfo).not.toHaveBeenCalled();
  });

  it('on native it appends the store build number once the plugin answers', async () => {
    native.value = true;
    getInfo.mockResolvedValue({
      build: '92',
      version: '0.95',
      name: 'beanies',
      id: 'family.beanies.app',
    });
    const label = useProductVersionLabel();
    expect(label.value).toBe('v0.95');
    await settle();
    expect(label.value).toBe('v0.95 (92)');
  });

  it('on native a failed lookup keeps the product version and logs a warning', async () => {
    native.value = true;
    getInfo.mockRejectedValue(new Error('bridge down'));
    const label = useProductVersionLabel();
    await settle();
    expect(label.value).toBe('v0.95');
    expect(logEvent).toHaveBeenCalledWith(
      expect.objectContaining({ level: 'warn', surface: 'product-version-label' })
    );
  });

  it('on native an empty build number leaves the label untouched', async () => {
    native.value = true;
    getInfo.mockResolvedValue({
      build: '',
      version: '0.95',
      name: 'beanies',
      id: 'family.beanies.app',
    });
    const label = useProductVersionLabel();
    await settle();
    expect(label.value).toBe('v0.95');
  });
});
