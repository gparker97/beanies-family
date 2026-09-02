import { describe, it, expect } from 'vitest';
import { activityEmoji } from '../activityEmoji';
import type { ActivityCategory } from '@/types/models';

describe('activityEmoji', () => {
  it("prefers the user's own icon", () => {
    expect(activityEmoji({ icon: '🎺', category: 'swimming' })).toBe('🎺');
  });

  it('falls back to the category emoji', () => {
    expect(activityEmoji({ icon: undefined, category: 'birthday' })).toBe('🎂');
  });

  it('never returns empty, even for a category the registry does not know', () => {
    // A card must never render a blank where the category should be — category is
    // the only thing carrying "what is this" now that hue carries "whose is this".
    // The casts are the point: an id can reach this from an older `.beanpod` written
    // before a category was renamed, which the type system cannot see.
    expect(activityEmoji({ icon: undefined, category: 'gone_stale' as ActivityCategory })).toBe(
      '📌'
    );
    expect(activityEmoji({ icon: undefined, category: '' as ActivityCategory })).toBeTruthy();
  });
});
