import { computed } from 'vue';
import { useActivityChipClass, type ActivityChipClass } from '@/composables/useActivityChipClass';
import { useTranslationStore } from '@/stores/translationStore';
import { activityEmoji } from '@/utils/activityEmoji';
import { isCelebrationActivity, type CelebrationVerdict } from '@/utils/activityCelebration';
import { resolveMemberColor } from '@/constants/memberColors';
import type { FamilyActivity, FamilyMember } from '@/types/models';

/**
 * ONE definition of how an activity card looks.
 *
 * Every card surface needs the same five answers — whose is it, which faces, what
 * category glyph, is it a celebration, and what wash — and before this each of the ten
 * surfaces answered them for itself. The drift was already visible: the wash was
 * hand-rolled at seven call sites with FOUR different alpha suffixes for one intent
 * (`+ '15'`, `+ '18'`, `+ '12'`, and two template-literal forms). Re-applying that
 * shape under a new colour rule would have drifted again within a release.
 *
 * So the rule is written here and each surface binds the result.
 */

/** The single wash opacity. Four different values used to mean "this same wash". */
const WASH_ALPHA = 0.13;

/** Slightly stronger in dark mode, where a 13% tint on a dark surface disappears. */
const WASH_ALPHA_DARK = 0.24;

export interface ActivityIdentity {
  /** The edge / hairline colour: the owner's hue, or Heritage Orange when unowned. */
  color: string;
  kind: ActivityChipClass['kind'];
  /** Faces to draw, already resolved and already lane-aware. */
  stackMembers: FamilyMember[];
  /** The category glyph — what the activity IS, now that hue says whose it is. */
  emoji: string;
  celebration: CelebrationVerdict;
  /** Inline style for the card's wash and edge. */
  style: Record<string, string>;
  /** Shared events keep a dashed edge — the one cue that needs no colour vision. */
  dashed: boolean;
}

export interface IdentityOptions {
  /**
   * Set when rendering inside a bean lane or member column.
   *
   * The lane header already names its bean, so a solo card there shows no face and a
   * shared card shows only the OTHERS — a face inside a lane then always means
   * "someone else is in this too". Passing this is how a surface says "I have already
   * named this person"; it is not a styling switch, which is why it lives here rather
   * than on `ActivityOwnerStack`.
   */
  laneMemberId?: string;
  /** Explicit per-activity celebration choice, overriding detection in both directions. */
  celebrationOverride?: boolean | null;
}

function rgba(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? [...h].map((c) => c + c).join('') : h.slice(0, 6);
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) || 0);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function useActivityIdentity() {
  const { classify } = useActivityChipClass();
  const translation = useTranslationStore();

  const locale = computed(() => translation.currentLanguage ?? 'en');

  /**
   * Memoised on id + updatedAt + locale.
   *
   * The celebration predicate runs a whole-word regex sweep over the keyword list, and
   * a month grid paints 100+ chips per frame. That is work worth doing once per
   * activity, not once per paint. Keyed on `updatedAt` so an edited title re-evaluates.
   */
  const celebrationCache = new Map<string, CelebrationVerdict>();

  function celebrationFor(activity: FamilyActivity, override?: boolean | null): CelebrationVerdict {
    const key = `${activity.id}:${activity.updatedAt}:${locale.value}:${override ?? ''}`;
    const hit = celebrationCache.get(key);
    if (hit) return hit;
    const verdict = isCelebrationActivity(activity, locale.value, override);
    // Bounded so a long-lived tab paging through months cannot grow it without limit.
    if (celebrationCache.size > 500) celebrationCache.clear();
    celebrationCache.set(key, verdict);
    return verdict;
  }

  function identityFor(activity: FamilyActivity, opts: IdentityOptions = {}): ActivityIdentity {
    const c = classify(activity);

    // The lane rule, applied ONCE. No component decides this for itself.
    const stackMembers = opts.laneMemberId
      ? c.members.filter((m) => m.id !== opts.laneMemberId)
      : c.members;

    const dashed = c.kind === 'shared';

    // A shared event wears the FIRST owner's edge over a blend of the first two hues,
    // rather than one flat colour. `classifyActivityChip` still returns Heritage Orange
    // for the multi-owner case and that stays true for the no-owner case — but a blend
    // plus the dashed edge plus the face stack now carry "shared" three ways over,
    // where the flat orange was the only cue when that rule was written.
    const owners = c.members;
    const first = owners[0] ? resolveMemberColor(owners[0].color) : c.color;
    const second = owners[1] ? resolveMemberColor(owners[1].color) : first;
    const color = c.kind === 'shared' ? first : c.color;

    const style: Record<string, string> =
      c.kind === 'shared'
        ? {
            borderLeftColor: first,
            background: `linear-gradient(105deg, ${rgba(first, WASH_ALPHA)}, ${rgba(second, WASH_ALPHA)})`,
          }
        : { borderLeftColor: color, background: rgba(color, WASH_ALPHA) };

    return {
      color,
      kind: c.kind,
      stackMembers,
      emoji: activityEmoji(activity),
      celebration: celebrationFor(activity, opts.celebrationOverride),
      style,
      dashed,
    };
  }

  return { identityFor, WASH_ALPHA, WASH_ALPHA_DARK };
}
