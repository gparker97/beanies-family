/** `EmptyState`: `md` (the default) is the app's look; `lg` scales the emoji, title and message. */
import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import EmptyState from '../EmptyState.vue';

const props = { emoji: '⭐', title: 'Stars are for the kids', message: 'Tap a child.' };

const sorted = (classes: string[]) => [...classes].sort();

describe('EmptyState', () => {
  it('md renders exactly the classes it always has (36 call sites draw it)', () => {
    // Pinned to the component as it was before `title` / `size` / the slot existed. A change
    // here repaints every empty state in the app, so it must be deliberate.
    const w = mount(EmptyState, { props: { emoji: '⭐', message: 'Nothing yet.' } });
    expect(sorted(w.classes())).toEqual(
      sorted(['flex', 'flex-col', 'items-center', 'justify-center', 'gap-2', 'py-6', 'text-center'])
    );
    expect(sorted(w.get('[aria-hidden="true"]').classes())).toEqual(
      sorted(['text-3xl', 'leading-none'])
    );
    expect(sorted(w.get('p').classes())).toEqual(
      sorted(['font-outfit', 'text-secondary-500/60', 'dark:text-ink-soft', 'text-sm'])
    );
    expect(w.find('[data-testid="empty-state-title"]').exists()).toBe(false);
  });

  it('defaults to the app size', () => {
    const w = mount(EmptyState, { props });
    expect(w.get('[aria-hidden="true"]').classes()).toContain('text-3xl');
    expect(w.get('[data-testid="empty-state-title"]').classes()).toContain('text-lg');
    expect(w.get('p').classes()).toContain('text-sm');
  });

  it('lg is the wall size, on the type scale, with token-based message ink', () => {
    const w = mount(EmptyState, { props: { ...props, size: 'lg' } });
    expect(w.get('[aria-hidden="true"]').classes()).toContain('text-4xl');
    const title = w.get('[data-testid="empty-state-title"]');
    expect(title.classes()).toContain('text-2xl');
    expect(title.classes()).not.toContain('text-lg');
    const message = w.get('p');
    expect(message.classes()).toContain('text-lg');
    expect(message.classes()).toContain('dark:text-ink-soft');
    expect(message.classes()).not.toContain('text-secondary-500/60');
    expect(message.text()).toBe('Tap a child.');
  });
});
