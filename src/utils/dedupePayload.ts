/**
 * The ✨ Find Duplicates wire format (#116), as ONE pure module: what a line and a group look
 * like, the exact text sent, how its size is measured, and how a model-supplied item name is
 * made safe to show. No Vue, no stores, so the reducer (`shoppingMerge.ts`), the composable
 * (`useFindDuplicates.ts`), the parser (`extractionPrompt.ts`) and the Lambda parity test all
 * share one definition instead of structurally-equal copies that drift.
 *
 * The Lambda and spike `.mjs` prompt copies only BUILD the prompt around the payload; they
 * never measure it or read a name, so nothing here is mirrored there.
 */

/** One line offered for matching. `id` is opaque (`"L1"`), so a line's text cannot fake one. */
export interface DedupeLine {
  id: string;
  text: string;
}

/** One group the model found: a short item name and the ids of its lines. */
export interface DedupeGroup {
  name: string;
  lineIds: string[];
}

/**
 * The bound on the serialized payload ({@link dedupePayloadBytes}, UTF-8 bytes), which keeps a
 * dedupe read free. 8,000 bytes is roughly 150 typical ingredient lines, well past a busy week.
 *
 * ⚠️ Raising it means raising `FREE_TASK_MAX_BYTES` in `infrastructure/lambda/ai-extract/meter.mjs`
 * (and deploying the Lambda) FIRST. `lambdaContractParity.test.ts` fails when the worst-case
 * sealed request no longer fits, which is the point: otherwise the read silently becomes charged.
 */
export const DEDUPE_MAX_PAYLOAD_BYTES = 8_000;

/** A dedupe group's name is shown on a merged list line, so it is short and plain. */
export const DEDUPE_NAME_MAX = 60;

const utf8 = new TextEncoder();

/**
 * One entry as sent: `{ id, text }` only, whatever else the caller's line object carries. The
 * explicit pick is the privacy boundary, not a style choice: a line model that grows a
 * `recipeName` must not start leaving the device because it was spread in here.
 */
function entryJson({ id, text }: DedupeLine): string {
  return JSON.stringify({ id, text });
}

/** The exact text sent: a JSON array of {@link entryJson} entries. */
export function dedupePayload(lines: readonly DedupeLine[]): string {
  return `[${lines.map(entryJson).join(',')}]`;
}

/** The payload's size as the free bound measures it (UTF-8 bytes of {@link dedupePayload}). */
export function dedupePayloadBytes(lines: readonly DedupeLine[]): number {
  return utf8.encode(dedupePayload(lines)).length;
}

/**
 * Grow a payload one line at a time within `maxBytes`, without re-serializing the whole array
 * per line. The running total is {@link dedupePayloadBytes} by construction: `[` + `]`, each
 * entry's own bytes, and one `,` between entries. `tryAdd` refuses a line that would cross the
 * bound and leaves the payload unchanged, so a caller can skip it and try a shorter one.
 */
export function dedupePayloadBuilder(maxBytes: number): {
  lines: DedupeLine[];
  tryAdd(line: DedupeLine): boolean;
} {
  const lines: DedupeLine[] = [];
  let bytes = 2; // "[" + "]"
  return {
    lines,
    tryAdd(line) {
      const cost = utf8.encode(entryJson(line)).length + (lines.length > 0 ? 1 : 0);
      if (bytes + cost > maxBytes) return false;
      bytes += cost;
      lines.push({ id: line.id, text: line.text });
      return true;
    },
  };
}

/** Controls that break a line: stripped like any control, but as a space so words stay apart. */
const LINE_BREAKING_CONTROL = /[\t\n\v\f\r\u0085]/;

/**
 * What a name loses: every control (`\p{Cc}`), and ONLY the format characters (`\p{Cf}`) that are
 * invisible AND carry no spelling:
 *   - bidi controls, which can reorder what a reader sees (U+061C, U+200E/F, U+202A–U+202E,
 *     U+2066–U+2069) and the deprecated shaping/swapping controls U+206A–U+206F;
 *   - the BOM / zero-width no-break space U+FEFF, the zero-width space U+200B, the word joiner and
 *     invisible math operators U+2060–U+2064, and the interlinear annotation marks U+FFF9–U+FFFB
 *     (which can hide text between them).
 * ZWNJ U+200C and ZWJ U+200D are KEPT: they are part of how Persian and Indic words are spelled and
 * how emoji sequences (👨‍👩‍👧) join. So are the emoji tag characters, the soft hyphen and the other
 * script-specific format marks.
 */
const STRIPPED =
  /[\p{Cc}\u061C\u200B\u200E\u200F\u202A-\u202E\u2060-\u2064\u2066-\u206F\uFEFF\uFFF9-\uFFFB]/gu;

/**
 * A model-supplied item name, made safe to show on a list line. Controls and the invisible format
 * characters above ({@link STRIPPED}) are stripped FIRST, the line-breaking controls among them
 * becoming a space; then every whitespace run (U+2028/2029 included) becomes one space, the result
 * is trimmed and capped at {@link DEDUPE_NAME_MAX} code points (never splitting a surrogate pair).
 * `''` when nothing is left.
 */
export function sanitizeDedupeName(raw: string): string {
  const clean = raw
    .replace(STRIPPED, (c) => (LINE_BREAKING_CONTROL.test(c) ? ' ' : ''))
    .replace(/\s+/gu, ' ')
    .trim();
  return Array.from(clean).slice(0, DEDUPE_NAME_MAX).join('').trim();
}
