import { describe, it, expect } from 'vitest';
import { vueErrorSeverity } from '../vueErrorSeverity';

const prod = (code: string) => `https://vuejs.org/error-reference/#runtime-${code}`;

describe('vueErrorSeverity', () => {
  it.each(['0', '1', '13', '15'])('runtime-%s (setup/render/loader/update) is critical', (code) => {
    expect(vueErrorSeverity(prod(code))).toBe('critical');
  });

  it.each(['bc', 'c', 'bm', 'm', 'a', 'ec', 'rtc', 'rtg', 'sp'])(
    'lifecycle hook %s (brings the surface up) is critical',
    (code) => {
      expect(vueErrorSeverity(prod(code))).toBe('critical');
      expect(vueErrorSeverity(code)).toBe('critical');
    }
  );

  it.each(['bu', 'u', 'bum', 'um', 'da'])(
    'lifecycle hook %s (update keeps the last render; unmount/deactivate is leaving) is error',
    (code) => {
      expect(vueErrorSeverity(prod(code))).toBe('error');
      expect(vueErrorSeverity(code)).toBe('error');
    }
  );

  it.each(['2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', '14', '16'])(
    'runtime-%s (watchers, handlers, hooks, refs, scheduler) is error',
    (code) => {
      expect(vueErrorSeverity(prod(code))).toBe('error');
    }
  );

  it('reads the dev-build phrases', () => {
    expect(vueErrorSeverity('render function')).toBe('critical');
    expect(vueErrorSeverity('mounted hook')).toBe('critical');
    expect(vueErrorSeverity('activated hook')).toBe('critical');
    expect(vueErrorSeverity('updated')).toBe('error');
    expect(vueErrorSeverity('unmounted hook')).toBe('error');
    expect(vueErrorSeverity('deactivated hook')).toBe('error');
    expect(vueErrorSeverity('component event handler')).toBe('error');
    expect(vueErrorSeverity('watcher callback')).toBe('error');
  });

  it('a stale-chunk load failure is error even from the async component loader', () => {
    const chunk = new TypeError('Failed to fetch dynamically imported module: /assets/Nook.js');
    expect(vueErrorSeverity(prod('13'), chunk)).toBe('error');
    expect(vueErrorSeverity(prod('1'), chunk)).toBe('error');
    // Any other loader failure still pages.
    expect(vueErrorSeverity(prod('13'), new Error('boom'))).toBe('critical');
  });

  it('treats anything unrecognised as error', () => {
    expect(vueErrorSeverity('garbage')).toBe('error');
    expect(vueErrorSeverity('')).toBe('error');
    expect(vueErrorSeverity(prod('99'))).toBe('error');
    expect(vueErrorSeverity(undefined as unknown as string)).toBe('error');
  });
});
