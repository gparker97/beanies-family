/**
 * The wire format for a shared recipe (#92) — encode, decode, and the guard.
 *
 * WHY A FRAGMENT. beanies holds no user data on any server, so a share is by definition
 * content leaving the pod. The payload rides in the URL fragment, which a browser never
 * transmits in an HTTP request, so the recipe reaches no beanies server, log or analytics
 * event. Anything that rebuilds a share URL must preserve the `#`; moving the payload into
 * a query string would defeat the entire design in one character.
 *
 * ⚠️ SCOPE THE GUARANTEE HONESTLY. It is about BEANIES' servers, not the chat app's.
 * `ShareChannelGrid` opens `https://wa.me/?text=<the whole message>` and
 * `https://t.me/share/url?url=…`, so Meta and Telegram receive the payload in a query string
 * — and every channel receives the message anyway, because that is what sending a message
 * IS. The line that must never be crossed is the beanies one. Do not write copy, or a
 * comment, implying the `#` hides the recipe from WhatsApp.
 *
 * ⚠️ `btoa` CANNOT ENCODE A RECIPE. It throws `InvalidCharacterError` on any codepoint above
 * 255 — "Crème Brûlée", "Ramen 🍜", every non-Latin dish name. Hence `TextEncoder` +
 * `bufferToBase64url`. `redirectState.ts` is allowed its inline `btoa` only because it
 * carries ASCII routing, and says so.
 */
import { bufferToBase64url, base64urlToBuffer } from './encoding';
import { boundText } from './boundText';
import { safeHttpsUrl } from './url';
import { isRecipeCourse } from '@/constants/recipeCourses';
import { isMealSlot, sortSlots } from '@/constants/mealSlots';
import type { Recipe } from '@/types/models';
import type { RecipePrefill } from './recipeExtractionToRecipe';

/** The version this build WRITES. */
export const SHARE_WIRE_VERSION = 1;

/**
 * The versions this build can READ. **This set only ever GROWS.**
 *
 * A share link lives in someone's chat forever, so dropping a version breaks messages that
 * were already sent. This is the one place the contract deliberately differs from
 * `redirectState.decodeRedirectState`, whose exact-match gate is safe precisely because its
 * payload round-trips in seconds and the fallback is "retry".
 */
export const SUPPORTED_WIRE_VERSIONS: ReadonlySet<number> = new Set([1]);

/**
 * The FRAGMENT ceiling: how many base64url characters a share URL may carry.
 *
 * Two jobs: it bounds `decodeRecipeShare` BEFORE it does any work (a hostile fragment is
 * unbounded), and it tells `encodeRecipeShare`'s caller when a recipe is too large to link
 * at all. Distinct from — and an order of magnitude above — `MAX_SHARE_MESSAGE_CHARS` in
 * `recipeShareText.ts`, which budgets the readable TEXT. Conflating the two would drop the
 * link for an ordinary recipe: base64url runs ~4/3 of the JSON, so a twelve-ingredient
 * recipe is a ~2,300-character link before a single word of text.
 */
export const MAX_SHARE_PAYLOAD_CHARS = 8000;

/** Per-field caps. Generous for real recipes, bounded against a hostile payload. */
const MAX_NAME = 200;
const MAX_LINE = 500;
const MAX_NOTES = 4000;
const MAX_ITEMS = 100;

/**
 * Compact wire keys, declared ONCE and pinned by a golden fixture test.
 *
 * On a 20-ingredient recipe the full field names alone are ~400 wasted bytes, and no human
 * ever reads this. Declaring them in one map (rather than scattering letters through encode
 * and decode) is what makes the golden test able to fail loudly if a `Recipe` field rename
 * ever reaches the wire format.
 */
const WIRE = {
  name: 'n',
  subtitle: 's',
  prepTime: 'p',
  cookTime: 'c',
  servings: 'y',
  ingredients: 'i',
  steps: 't',
  notes: 'o',
  sourceUrl: 'u',
  course: 'r',
  mealSlots: 'm',
} as const;

/** No new type: the decode target IS the shape the recipe form already accepts. */
export type SharedRecipeFields = RecipePrefill['fields'];

/** Why a payload was refused. For US, via telemetry — never shown to the link's holder. */
export type ShareDecodeFailure =
  | 'empty'
  | 'too-long'
  | 'bad-encoding'
  | 'bad-json'
  | 'not-an-object'
  | 'unsupported-version'
  | 'no-name';

export type ShareDecodeResult =
  { ok: true; fields: SharedRecipeFields } | { ok: false; reason: ShareDecodeFailure };

/**
 * A recipe as a fragment payload.
 *
 * `tags` are excluded (one family's private filing system, meaningless in another cookbook)
 * and `photoIds` are excluded by design — a photo cannot ride in a URL, and pod photos are
 * private Drive objects. `course` and `mealSlots` DO travel: the promise is "the sharer's
 * own version", and silently dropping two fields they set would break it.
 */
export function encodeRecipeShare(recipe: Recipe): string {
  const payload: Record<string, unknown> = { v: SHARE_WIRE_VERSION, [WIRE.name]: recipe.name };
  if (recipe.subtitle) payload[WIRE.subtitle] = recipe.subtitle;
  if (recipe.prepTime) payload[WIRE.prepTime] = recipe.prepTime;
  if (recipe.cookTime) payload[WIRE.cookTime] = recipe.cookTime;
  if (recipe.servings) payload[WIRE.servings] = recipe.servings;
  if (recipe.ingredients?.length) payload[WIRE.ingredients] = recipe.ingredients;
  if (recipe.steps?.length) payload[WIRE.steps] = recipe.steps;
  if (recipe.notes) payload[WIRE.notes] = recipe.notes;
  if (recipe.sourceUrl) payload[WIRE.sourceUrl] = recipe.sourceUrl;
  if (recipe.course) payload[WIRE.course] = recipe.course;
  if (recipe.mealSlots?.length) payload[WIRE.mealSlots] = recipe.mealSlots;

  return bufferToBase64url(new TextEncoder().encode(JSON.stringify(payload)));
}

/** A string field, or `undefined` if it is absent, the wrong type, or empty after bounding. */
function str(raw: unknown, max: number): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const bounded = boundText(raw, max).trim();
  return bounded || undefined;
}

/**
 * A list of strings.
 *
 * ⚠️ Entries are REJECTED when they are not strings, never coerced. `String({})` is
 * `"[object Object]"`, which would be persisted into someone's cookbook as an ingredient.
 */
function strList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .slice(0, MAX_ITEMS)
    .map((entry) => str(entry, MAX_LINE))
    .filter((entry): entry is string => entry !== undefined);
}

/**
 * Decode a fragment payload. **This is a security boundary, not a parser.**
 *
 * The payload is attacker-controlled: anyone can hand-craft a beanies link with arbitrary
 * content and send it to a user. Every step below assumes hostility.
 *
 * The discriminated `reason` is for US — it ships as the telemetry `detail` so a developer
 * can see which check refused. It must NEVER be rendered: the page collapses every failure
 * except `unsupported-version` into one identical dead-end, because a "which part was
 * malformed" signal shown to the person holding the link is an oracle.
 */
export function decodeRecipeShare(raw: string): ShareDecodeResult {
  if (!raw) return { ok: false, reason: 'empty' };
  // Length first, before any decoding work at all.
  if (raw.length > MAX_SHARE_PAYLOAD_CHARS) return { ok: false, reason: 'too-long' };

  let parsed: unknown;
  try {
    // Some chat clients percent-encode a fragment on the way through.
    const bytes = base64urlToBuffer(decodeURIComponent(raw));
    const json = new TextDecoder().decode(bytes);
    try {
      parsed = JSON.parse(json);
    } catch {
      return { ok: false, reason: 'bad-json' };
    }
  } catch {
    return { ok: false, reason: 'bad-encoding' };
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { ok: false, reason: 'not-an-object' };
  }
  const obj = parsed as Record<string, unknown>;

  // SET MEMBERSHIP, never `>=`. An old client must not best-effort-parse a newer shape.
  if (typeof obj.v !== 'number' || !SUPPORTED_WIRE_VERSIONS.has(obj.v)) {
    return { ok: false, reason: 'unsupported-version' };
  }

  const name = str(obj[WIRE.name], MAX_NAME);
  if (!name) return { ok: false, reason: 'no-name' };

  // ⚠️ A FRESH OBJECT LITERAL, field by field. Never a spread and never `Object.assign` onto
  // the parsed object — building a new literal is what actually neutralises `__proto__` and
  // `constructor` keys, and it makes "nothing outside the allowlist survives" true by
  // construction rather than by a filter someone can later forget to update.
  const course = obj[WIRE.course];
  const slots = Array.isArray(obj[WIRE.mealSlots])
    ? (obj[WIRE.mealSlots] as unknown[]).filter(isMealSlot)
    : [];

  const fields: SharedRecipeFields = {
    name,
    ingredients: strList(obj[WIRE.ingredients]),
    steps: strList(obj[WIRE.steps]),
    ...(str(obj[WIRE.subtitle], MAX_LINE) ? { subtitle: str(obj[WIRE.subtitle], MAX_LINE) } : {}),
    ...(str(obj[WIRE.prepTime], MAX_LINE) ? { prepTime: str(obj[WIRE.prepTime], MAX_LINE) } : {}),
    ...(str(obj[WIRE.cookTime], MAX_LINE) ? { cookTime: str(obj[WIRE.cookTime], MAX_LINE) } : {}),
    ...(str(obj[WIRE.servings], MAX_LINE) ? { servings: str(obj[WIRE.servings], MAX_LINE) } : {}),
    ...(str(obj[WIRE.notes], MAX_NOTES) ? { notes: str(obj[WIRE.notes], MAX_NOTES) } : {}),
    // `safeHttpsUrl`, NOT `safeExternalHref`: the latter permits `http:` and exists for
    // user-typed links. A decoded URL is machine-supplied by definition.
    ...(safeHttpsUrl(
      typeof obj[WIRE.sourceUrl] === 'string' ? (obj[WIRE.sourceUrl] as string) : null
    )
      ? { sourceUrl: safeHttpsUrl(obj[WIRE.sourceUrl] as string) as string }
      : {}),
    // Never COERCE a near-miss. Blank is honest; wrong is not.
    ...(isRecipeCourse(course) ? { course } : {}),
    ...(slots.length ? { mealSlots: sortSlots(slots) } : {}),
  };

  return { ok: true, fields };
}

/**
 * Wrap decoded fields in the envelope `RecipeFormModal` expects.
 *
 * `RecipePrefill` carries AI-extraction metadata — inferred lists, dish-image candidates,
 * taxonomy rejections, per-field confidence — **none of which applies here, because no model
 * was involved.** They are filled with honest neutrals rather than invented scores: the
 * recipe came from a link a person chose to send, not from an extraction.
 */
export function sharedRecipeToPrefill(fields: SharedRecipeFields): RecipePrefill {
  return {
    fields,
    inferredIngredients: [],
    inferredSteps: [],
    // `null` means "there was no page", which is exactly right: nothing was fetched.
    dishImage: null,
    taxonomyRejected: [],
    confidence: { name: 1, ingredients: 1, steps: 1 },
  };
}
