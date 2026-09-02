import { computed } from 'vue';
import { useActivityChipClass, type ActivityChipClass } from '@/composables/useActivityChipClass';
import { useTranslationStore } from '@/stores/translationStore';
import { useFamilyStore } from '@/stores/familyStore';
import { activityEmoji } from '@/utils/activityEmoji';
import {
  celebrationSticker,
  isCelebrationActivity,
  type CelebrationVerdict,
} from '@/utils/activityCelebration';
import { resolveMemberColor } from '@/constants/memberColors';
import { isDarkNow } from '@/composables/useDarkMode';
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

/**
 * The single wash opacity — one value where seven call sites used four.
 *
 * Two of them, because an INLINE style cannot be overridden by a `.dark` rule and the
 * migrated surfaces gave up their theme-aware `var(--tint-*)` classes to get one
 * consistent rule. 13% on a dark surface is close to invisible, which matters most on
 * the kitchen tablet at night.
 *
 * Chosen in JS rather than through a `var()` inside `rgba()`: that IS valid CSS, but it
 * is unparseable by the test DOM, so the wash would only ever have been verifiable in a
 * real browser. A rule you cannot test is a rule that quietly stops holding.
 */
const WASH_ALPHA = 0.13;
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
  /** Corner sticker for a celebrating card; empty string when it is not one. */
  sticker: string;
  /**
   * Wash + edge, for surfaces whose background IS the wash (grid blocks, chips).
   *
   * `background` is a SHORTHAND and beats any class, so binding this on a card that
   * carries its own `bg-white dark:bg-slate-800` silently replaces that surface — a
   * 13% tint straight onto the page, with a shadow tuned for white. Those surfaces
   * want `edgeStyle` instead.
   */
  style: Record<string, string>;
  /** Edge only — for cards that keep their own background. */
  edgeStyle: Record<string, string>;
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

/** `r, g, b` channel triplet, so the alpha can come from a themeable custom property. */
function channels(hex: string): string {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? [...h].map((c) => c + c).join('') : h.slice(0, 6);
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) || 0).join(', ');
}

/**
 * Genuinely reactive, via `useDarkMode`'s observer on the `<html>` class.
 *
 * This used to read `document.documentElement.classList` directly, and the comment
 * claiming that was reactive was simply wrong: no chip component had any other theme
 * dependency, so switching light→dark (or `theme: 'system'` flipping at sunset) never
 * re-invoked `identityFor` and every painted chip kept the light alpha. That is the exact
 * outcome `WASH_ALPHA_DARK` exists to prevent — "13% on a dark surface is close to
 * invisible, which matters most on the kitchen tablet at night" — and the wall never
 * unmounts, so it never self-healed (#78 review).
 */
function currentAlpha(): number {
  return isDarkNow() ? WASH_ALPHA_DARK : WASH_ALPHA;
}

function wash(hex: string): string {
  return `rgba(${channels(hex)}, ${currentAlpha()})`;
}

export function useActivityIdentity() {
  const { classify } = useActivityChipClass();
  const translation = useTranslationStore();
  const familyStore = useFamilyStore();

  /**
   * Cheap roster fingerprint — every field the built identity actually RENDERS.
   *
   * It previously fingerprinted `id:color` alone while claiming to cover names, so a
   * rename or a new avatar photo produced a fresh `FamilyMember` object (updateMember
   * replaces it) but an IDENTICAL revision string. Vue's computed short-circuits on an
   * unchanged value, so components whose only roster dependency is this one never
   * re-rendered and `identityFor` kept handing back pre-edit member objects — the stack's
   * `aria-label` read the old name and `memberAvatarBindings` resolved the old photo, on
   * the always-mounted wall, until 800 distinct cache keys evicted them (#78 review).
   *
   * Anything `buildIdentity` reads off a member belongs in here.
   */
  const familyRevision = computed(() =>
    familyStore.members
      .map((m) => `${m.id}:${m.color ?? ''}:${m.name}:${m.avatarPhotoId ?? ''}`)
      .join('|')
  );

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

  /**
   * Per-render memo, keyed on the activity + the options that change the answer.
   *
   * A template legitimately needs the identity in several bindings — the wash, the
   * dashed class, the emoji, the stack — and telling every call site to hoist its own
   * `computed` is a rule that gets forgotten, then silently costs a `classify()` (a Set
   * build plus linear roster scans) per binding per chip. On a month grid that is
   * hundreds of redundant classifications per paint. Memoising here makes the
   * composable's own "classify once per activity" guarantee true by construction
   * rather than by convention.
   *
   * Cleared whenever the roster or the activity's `updatedAt` changes, both of which
   * are in the key.
   */
  const identityCache = new Map<string, ActivityIdentity>();

  function identityFor(activity: FamilyActivity, opts: IdentityOptions = {}): ActivityIdentity {
    const key = `${activity.id}:${activity.updatedAt}:${opts.laneMemberId ?? ''}:${
      opts.celebrationOverride ?? ''
    }:${familyRevision.value}:${currentAlpha()}`;
    const hit = identityCache.get(key);
    if (hit) return hit;
    const built = buildIdentity(activity, opts);
    if (identityCache.size > 800) identityCache.clear();
    identityCache.set(key, built);
    return built;
  }

  function buildIdentity(activity: FamilyActivity, opts: IdentityOptions): ActivityIdentity {
    const c = classify(activity);

    // The lane rule, applied ONCE. No component decides this for itself.
    //
    // In a lane, an event with NO owner shows no faces at all: it is already in every
    // bean's column, so repeating the whole family inside each one says nothing and
    // costs the title its width. Outside a lane the faces are the only thing saying
    // "this is everyone's", so they stay.
    const stackMembers = opts.laneMemberId
      ? c.kind === 'family'
        ? []
        : c.members.filter((m) => m.id !== opts.laneMemberId)
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
            background: `linear-gradient(105deg, ${wash(first)}, ${wash(second)})`,
          }
        : { borderLeftColor: color, background: wash(color) };

    const edgeStyle: Record<string, string> = { borderLeftColor: style.borderLeftColor! };
    const emoji = activityEmoji(activity);
    const celebration = celebrationFor(activity, opts.celebrationOverride);

    return {
      color,
      kind: c.kind,
      stackMembers,
      emoji,
      celebration,
      sticker: celebration.celebrating ? celebrationSticker(emoji) : '',
      style,
      edgeStyle,
      dashed,
    };
  }

  return { identityFor, WASH_ALPHA, WASH_ALPHA_DARK };
}
