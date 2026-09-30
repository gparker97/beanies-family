import { describe, it, expect, vi } from 'vitest';

const push = vi.hoisted(() => vi.fn());
vi.mock('vue-router', () => ({ useRouter: () => ({ push }) }));

import { useOpenList } from '../useOpenList';

describe('useOpenList', () => {
  it('navigates to the lists page rather than mounting the drawer here', () => {
    // The same param `ENTITY_DEEP_LINKS.list` routes, so a tapped reminder and an
    // in-app "open list" land in exactly the same place.
    useOpenList().openList('l9');
    expect(push).toHaveBeenCalledWith({ name: 'Lists', query: { view: 'l9' } });
  });
});
