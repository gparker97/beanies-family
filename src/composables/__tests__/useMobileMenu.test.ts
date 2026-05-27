import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ref } from 'vue';

// Controllable breakpoint + route for the headerReclaimed predicate.
const isMobile = ref(false);
vi.mock('@/composables/useBreakpoint', () => ({
  useBreakpoint: () => ({ isMobile }),
}));

const routeName = ref<string>('Nook');
vi.mock('vue-router', () => ({
  useRoute: () => ({
    get name() {
      return routeName.value;
    },
  }),
}));

import { useMobileMenu, useHeaderReclaimed } from '../useMobileMenu';

describe('useMobileMenu', () => {
  beforeEach(() => {
    useMobileMenu().close();
    isMobile.value = false;
    routeName.value = 'Nook';
  });

  it('toggles / opens / closes the shared open state', () => {
    const { isOpen, open, close, toggle } = useMobileMenu();
    expect(isOpen.value).toBe(false);
    toggle();
    expect(isOpen.value).toBe(true);
    toggle();
    expect(isOpen.value).toBe(false);
    open();
    expect(isOpen.value).toBe(true);
    close();
    expect(isOpen.value).toBe(false);
  });

  it('is a singleton — state is shared across every call site', () => {
    const a = useMobileMenu();
    const b = useMobileMenu();
    a.open();
    expect(b.isOpen.value).toBe(true);
    b.close();
    expect(a.isOpen.value).toBe(false);
  });
});

describe('useHeaderReclaimed', () => {
  beforeEach(() => {
    isMobile.value = false;
    routeName.value = 'Nook';
  });

  it('is true only on a phone AND the Activities route', () => {
    const reclaimed = useHeaderReclaimed();
    expect(reclaimed.value).toBe(false); // desktop + Nook

    isMobile.value = true;
    expect(reclaimed.value).toBe(false); // phone but not the planner

    routeName.value = 'Activities';
    expect(reclaimed.value).toBe(true); // phone + planner

    isMobile.value = false;
    expect(reclaimed.value).toBe(false); // planner but desktop (keeps AppHeader)
  });
});
