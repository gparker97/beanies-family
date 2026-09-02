import { describe, it, expect } from 'vitest';
import {
  MEMBER_COLORS,
  MEMBER_COLOR_VALUES,
  ASSIGNABLE_MEMBER_COLORS,
  SHARED_EVENT_COLOR,
  NEUTRAL_MEMBER_COLOR,
  resolveMemberColor,
  isBlankMemberColor,
  takenColors,
  nextFreeMemberColor,
} from '../memberColors';

const m = (id: string, color?: string) => ({ id, color });

describe('resolveMemberColor', () => {
  it('passes a real colour through', () => {
    expect(resolveMemberColor('#3b82f6')).toBe('#3b82f6');
  });

  it('returns neutral for undefined, null, empty and whitespace', () => {
    // The empty-string case is the whole point: four call sites used `?? fallback`,
    // which lets '' through, and a member whose colour was '' rendered a transparent
    // circle. Harmless while hue was decorative; a blank card now hue means identity.
    expect(resolveMemberColor(undefined)).toBe(NEUTRAL_MEMBER_COLOR);
    expect(resolveMemberColor(null)).toBe(NEUTRAL_MEMBER_COLOR);
    expect(resolveMemberColor('')).toBe(NEUTRAL_MEMBER_COLOR);
    expect(resolveMemberColor('   ')).toBe(NEUTRAL_MEMBER_COLOR);
  });

  it('is pure — no telemetry, no module state, same answer every call', () => {
    expect(resolveMemberColor('')).toBe(resolveMemberColor(''));
    expect(isBlankMemberColor('')).toBe(true);
    expect(isBlankMemberColor('#fff')).toBe(false);
  });
});

describe('palette', () => {
  it('never contains the shared/family colour', () => {
    // Pinned: a member must never be indistinguishable from an everyone-event.
    expect(MEMBER_COLOR_VALUES).not.toContain(SHARED_EVENT_COLOR);
  });

  it('no longer ASSIGNS alert red, but still recognises it', () => {
    // Red is reserved brand-wide for destructive actions. It cannot be handed to a new
    // bean — but it must stay in the picker, because it was palette index 1 and the
    // round-robin gave it to the SECOND bean of every wizard-onboarded family. Dropping
    // it outright would show those beans six swatches with none selected, and one tap
    // would silently rewrite an identity hue.
    expect(ASSIGNABLE_MEMBER_COLORS).not.toContain('#ef4444');
    expect(MEMBER_COLOR_VALUES).toContain('#ef4444');
  });

  it('has distinct colours, each with a gradient', () => {
    expect(new Set(MEMBER_COLOR_VALUES).size).toBe(MEMBER_COLOR_VALUES.length);
    expect(ASSIGNABLE_MEMBER_COLORS).toHaveLength(6);
    expect(MEMBER_COLORS.every((c) => c.gradient.includes(c.value))).toBe(true);
  });
});

describe('takenColors', () => {
  it('maps a held colour to its holder', () => {
    const taken = takenColors([m('a', '#3b82f6'), m('b', '#22c55e')]);
    expect(taken.get('#3b82f6')?.id).toBe('a');
  });

  it('excludes the member being edited, so their own swatch stays selectable', () => {
    // Without this, a member created before uniqueness was enforced could never be saved.
    const taken = takenColors([m('a', '#3b82f6')], 'a');
    expect(taken.has('#3b82f6')).toBe(false);
  });

  it('ignores members with no colour', () => {
    expect(takenColors([m('a', undefined)]).size).toBe(0);
  });
});

describe('nextFreeMemberColor', () => {
  it('returns the first unused colour and no collision', () => {
    const { color, reused } = nextFreeMemberColor([m('a', ASSIGNABLE_MEMBER_COLORS[0])]);
    expect(color).toBe(ASSIGNABLE_MEMBER_COLORS[1]);
    expect(reused).toBeNull();
  });

  it('never returns a held colour while a free one exists', () => {
    const members = ASSIGNABLE_MEMBER_COLORS.slice(0, 5).map((c, i) => m(`m${i}`, c));
    const { color } = nextFreeMemberColor(members);
    expect(members.map((x) => x.color)).not.toContain(color);
  });

  it('names the colliding member when the palette is exhausted, never returns silently', () => {
    const members = ASSIGNABLE_MEMBER_COLORS.map((c, i) => m(`m${i}`, c));
    const { color, reused } = nextFreeMemberColor(members);
    expect(ASSIGNABLE_MEMBER_COLORS).toContain(color);
    expect(reused).not.toBeNull();
    expect(reused?.color).toBe(color);
  });

  it('is deterministic', () => {
    const members = [m('a', ASSIGNABLE_MEMBER_COLORS[0])];
    expect(nextFreeMemberColor(members).color).toBe(nextFreeMemberColor(members).color);
  });

  it('lets an edited member keep their own colour via excludeId', () => {
    const members = ASSIGNABLE_MEMBER_COLORS.map((c, i) => m(`m${i}`, c));
    const { color, reused } = nextFreeMemberColor(members, 'm2');
    expect(color).toBe(ASSIGNABLE_MEMBER_COLORS[2]);
    expect(reused).toBeNull();
  });

  it('never hands out a retired colour, even when every assignable one is held', () => {
    const members = ASSIGNABLE_MEMBER_COLORS.map((c, i) => m(`m${i}`, c));
    expect(nextFreeMemberColor(members).color).not.toBe('#ef4444');
  });

  it('breaks a tie AWAY from the pod owner', () => {
    // With six hues held once each — the only case that occurs — a strict `<` minimum
    // never improves on the first candidate, so it always returned palette index 0.
    // That is the colour authStore hard-codes for every owner, so the duplicate landed
    // on the most-visible person on every shared surface: the opposite of least-used.
    const members = ASSIGNABLE_MEMBER_COLORS.map((c, i) =>
      i === 0 ? { id: 'owner', color: c, role: 'owner' } : m(`m${i}`, c)
    );
    const { color, reused } = nextFreeMemberColor(members);
    expect(color).not.toBe(ASSIGNABLE_MEMBER_COLORS[0]);
    expect(reused?.id).not.toBe('owner');
  });
});
