import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const logEvent = vi.fn();
vi.mock('@/services/telemetry/logEvent', () => ({ logEvent: (...a: unknown[]) => logEvent(...a) }));

import {
  useSidebarAccordion,
  __resetSidebarAccordionForTesting,
} from '@/composables/useSidebarAccordion';

const KEY = 'sidebar-accordion-state';

describe('useSidebarAccordion', () => {
  beforeEach(() => {
    localStorage.clear();
    logEvent.mockClear();
    __resetSidebarAccordionForTesting();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('defaults every section to open', () => {
    const { isOpen } = useSidebarAccordion();
    expect(isOpen('treehouse')).toBe(true);
    expect(isOpen('piggyBank')).toBe(true);
    expect(isOpen('beanPod')).toBe(true);
  });

  it('keeps stored sections and opens a section added since (beanPod for existing users)', () => {
    localStorage.setItem(KEY, JSON.stringify({ treehouse: false, piggyBank: true }));
    const { isOpen } = useSidebarAccordion();
    expect(isOpen('treehouse')).toBe(false);
    expect(isOpen('piggyBank')).toBe(true);
    expect(isOpen('beanPod')).toBe(true);
    expect(logEvent).not.toHaveBeenCalled();
  });

  it.each([
    ['unparseable JSON', '{nope'],
    ['a stored null', 'null'],
    ['a stored array', '[]'],
  ])('falls back to defaults on %s and logs a load warning', (_label, raw) => {
    localStorage.setItem(KEY, raw);
    const { isOpen } = useSidebarAccordion();
    expect(isOpen('treehouse')).toBe(true);
    expect(logEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'warn',
        surface: 'sidebar-accordion',
        context: { action: 'load' },
      })
    );
  });

  it('persists a toggle', () => {
    const { toggle } = useSidebarAccordion();
    toggle('beanPod');
    expect(JSON.parse(localStorage.getItem(KEY)!)).toMatchObject({ beanPod: false });
  });

  it('keeps toggling in memory and logs a save warning when storage refuses the write', () => {
    const quota = new Error('quota');
    const setSpy = vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw quota;
    });
    const { isOpen, toggle } = useSidebarAccordion();
    toggle('piggyBank');
    expect(isOpen('piggyBank')).toBe(false);
    expect(logEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        surface: 'sidebar-accordion',
        context: { action: 'save' },
        error: quota,
      })
    );
    setSpy.mockRestore();
  });

  it('reveal opens a closed section and saves; on an open section it writes nothing', () => {
    const { isOpen, toggle, reveal } = useSidebarAccordion();
    toggle('beanPod');
    const setItem = vi.spyOn(localStorage, 'setItem');
    reveal('treehouse');
    expect(setItem).not.toHaveBeenCalled();
    reveal('beanPod');
    expect(isOpen('beanPod')).toBe(true);
    expect(setItem).toHaveBeenCalledTimes(1);
    setItem.mockRestore();
  });

  it('shares one state across callers (sidebar and drawer stay in sync)', () => {
    const a = useSidebarAccordion();
    const b = useSidebarAccordion();
    a.toggle('treehouse');
    expect(b.isOpen('treehouse')).toBe(false);
  });
});
