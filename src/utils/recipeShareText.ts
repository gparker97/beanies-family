/**
 * The readable half of a recipe share (#92) — what a friend actually reads in WhatsApp.
 *
 * The message carries the recipe as text AND the link, in one send, so it is a gift to
 * someone who never taps through and an offer to someone who does. Pure: `t` arrives as an
 * argument so this stays testable and never reaches for a store.
 *
 * ⚠️ TWO BUDGETS, AND THIS FILE OWNS THE SECOND ONE. `MAX_SHARE_PAYLOAD_CHARS`
 * (`recipeShareLink.ts`) bounds the FRAGMENT. `MAX_SHARE_MESSAGE_CHARS` below is a target for
 * the readable TEXT. Conflating them was a real bug caught in review: base64url runs ~4/3 of
 * the recipe JSON, so an ordinary twelve-ingredient recipe is a ~2,300-character link on its
 * own. A single hard cap on the composed message would therefore have dropped the LINK for
 * the median recipe — deleting the whole point of the feature for exactly the recipes worth
 * sharing.
 */
import { fillTemplate } from './fillTemplate';
import type { SharedRecipeFields } from './recipeShareLink';
import type { UIStringKey } from '@/services/translation/uiStrings';

/**
 * The readable-TEXT target. 2000 is Discord's per-message ceiling — the tightest real
 * channel, because Discord publishes no share-intent URL so pasting is the only route to it.
 * `mailto:` bodies cap around the same; WhatsApp (~65k) and Telegram (4096) are well above.
 *
 * ⚠️ A TARGET, not a hard cap, and it NEVER costs us the link. See the file header.
 */
export const MAX_SHARE_MESSAGE_CHARS = 2000;

/** How many steps survive the first trim before the rest go entirely. */
const STEPS_KEPT = 3;
/** How many ingredients survive the last trim. */
const INGREDIENTS_KEPT = 8;

/** Which rung of the ladder the composer had to reach. Ships as telemetry `detail`. */
export type ShareTrimRung = 'none' | 'notes-and-steps' | 'all-steps' | 'floor';

export interface ShareTextResult {
  text: string;
  /** How far down the ladder we went — so we learn whether 2000 squeezes real recipes. */
  rung: ShareTrimRung;
  /** True only when the payload itself was too large to link at all. */
  linkDropped: boolean;
}

export interface BuildShareTextArgs {
  fields: SharedRecipeFields;
  /** The share URL, or `null` when the payload exceeded `MAX_SHARE_PAYLOAD_CHARS`. */
  link: string | null;
  t: (key: UIStringKey) => string;
}

/** One "· "-joined line of whichever of prep / cook / servings exist. */
function metaLine(f: SharedRecipeFields, t: BuildShareTextArgs['t']): string {
  const parts: string[] = [];
  if (f.prepTime) parts.push(fillTemplate(t('recipeShare.text.prep'), { value: f.prepTime }));
  if (f.cookTime) parts.push(fillTemplate(t('recipeShare.text.cook'), { value: f.cookTime }));
  if (f.servings) parts.push(f.servings);
  return parts.join(' · ');
}

interface Compose {
  includeNotes: boolean;
  maxSteps: number | null;
  includeSubtitle: boolean;
  maxIngredients: number | null;
}

function compose(args: BuildShareTextArgs, opts: Compose): string {
  const { fields: f, link, t } = args;
  const out: string[] = [`🍋 ${f.name}`];

  if (opts.includeSubtitle && f.subtitle) out.push(f.subtitle);

  const meta = metaLine(f, t);
  if (meta) out.push('', meta);

  if (f.ingredients.length) {
    const shown =
      opts.maxIngredients === null ? f.ingredients : f.ingredients.slice(0, opts.maxIngredients);
    out.push('', t('recipeShare.text.ingredients'));
    out.push(...shown.map((i) => `· ${i}`));
    const hidden = f.ingredients.length - shown.length;
    if (hidden > 0) out.push(fillTemplate(t('recipeShare.text.andMore'), { count: hidden }));
  }

  if (f.steps.length && opts.maxSteps !== 0) {
    const shown = opts.maxSteps === null ? f.steps : f.steps.slice(0, opts.maxSteps);
    out.push('', t('recipeShare.text.method'));
    out.push(...shown.map((s, i) => `${i + 1}. ${s}`));
    // Only promise "the rest is in the link" when there IS a link.
    if (shown.length < f.steps.length && link) out.push(t('recipeShare.text.restInLink'));
  }

  if (opts.includeNotes && f.notes) out.push('', f.notes);

  out.push('', t('recipeShare.text.signoff'));
  if (link) out.push(t('recipeShare.text.openIt'), link);

  return out.join('\n');
}

/**
 * Compose the share message, trimming text down a fixed ladder until it fits — and never
 * trimming the link, which is the thing that carries the whole recipe.
 *
 * Three rungs, not six: the extra rungs an earlier draft specified bought no observable
 * difference in message size.
 *
 * If even the floor exceeds the budget, the message ships anyway. WhatsApp, Telegram, SMS,
 * email and the OS share sheet all take it; only a Discord *paste* is refused, and the UI
 * says so quietly. We do not trade the link for one chat client's paste limit.
 */
export function buildRecipeShareText(args: BuildShareTextArgs): ShareTextResult {
  const linkDropped = args.link === null;

  const ladder: { rung: ShareTrimRung; opts: Compose }[] = [
    {
      rung: 'none',
      opts: { includeNotes: true, maxSteps: null, includeSubtitle: true, maxIngredients: null },
    },
    {
      rung: 'notes-and-steps',
      opts: {
        includeNotes: false,
        maxSteps: STEPS_KEPT,
        includeSubtitle: true,
        maxIngredients: null,
      },
    },
    {
      rung: 'all-steps',
      opts: { includeNotes: false, maxSteps: 0, includeSubtitle: true, maxIngredients: null },
    },
    {
      rung: 'floor',
      opts: {
        includeNotes: false,
        maxSteps: 0,
        includeSubtitle: false,
        maxIngredients: INGREDIENTS_KEPT,
      },
    },
  ];

  // Not seeded with a compose: the loop's first iteration uses `ladder[0].opts` anyway, so
  // seeding here composed every recipe twice.
  let last = '';
  for (const step of ladder) {
    last = compose(args, step.opts);
    if (last.length <= MAX_SHARE_MESSAGE_CHARS) return { text: last, rung: step.rung, linkDropped };
  }
  // Floor still over budget: ship it. See the doc comment.
  return { text: last, rung: 'floor', linkDropped };
}
