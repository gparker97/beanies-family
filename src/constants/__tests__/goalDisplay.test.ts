import { describe, it, expect, vi } from 'vitest';
import { getPriorityConfig, PRIORITY_ORDER, PRIORITY_RANK } from '../goalDisplay';

describe('getPriorityConfig', () => {
  it('returns the config for each known priority', () => {
    for (const p of PRIORITY_ORDER) {
      const config = getPriorityConfig(p);
      expect(config.icon).toBeTruthy();
      expect(config.bgClass).toBeTruthy();
      expect(config.textClass).toBeTruthy();
    }
  });

  it('falls back to low + warns on unknown priority', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const config = getPriorityConfig('nonsense');
    expect(config).toBe(getPriorityConfig('low'));
    expect(warnSpy).toHaveBeenCalledWith(
      '[goalDisplay] unknown priority, defaulting to low:',
      'nonsense'
    );
    warnSpy.mockRestore();
  });

  it('PRIORITY_RANK is monotonically increasing from critical to low', () => {
    expect(PRIORITY_RANK.critical).toBeLessThan(PRIORITY_RANK.high);
    expect(PRIORITY_RANK.high).toBeLessThan(PRIORITY_RANK.medium);
    expect(PRIORITY_RANK.medium).toBeLessThan(PRIORITY_RANK.low);
  });
});
