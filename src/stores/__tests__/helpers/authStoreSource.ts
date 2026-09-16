import { readFile } from 'node:fs/promises';

/**
 * The CODE of a function in `authStore.ts`, with comments stripped.
 *
 * ⚠️ STRIPPING IS NOT TIDINESS, AND THIS HELPER IS SHARED FOR THE SAME REASON. A first version
 * of these guards matched the raw source, and a prose mention of the symbol inside an
 * explanatory comment satisfied the assertion — so deleting the actual call left every test
 * green. A guard a comment can satisfy is not a guard. Two copies of the stripping rule would
 * be two places for that hole to reopen.
 *
 * ⚠️ IT THROWS ON A MARKER IT CANNOT FIND, rather than returning something. `String.indexOf`
 * answers `-1` for a miss, and `slice(-1, …)` returns a short tail or an empty string that a
 * `not.toContain` assertion passes cheerfully. A renamed function would then silently retire
 * every guard written against it — the exact failure these tests exist to prevent.
 */
export async function codeOfAuthStoreFn(startMarker: string, endMarker: string): Promise<string> {
  const src = await readFile('src/stores/authStore.ts', 'utf-8');
  const start = src.indexOf(startMarker);
  if (start < 0) throw new Error(`authStore.ts no longer contains "${startMarker}"`);
  const end = src.indexOf(endMarker, start + startMarker.length);
  if (end < 0) {
    throw new Error(`authStore.ts has no "${endMarker}" after "${startMarker}"`);
  }
  return src
    .slice(start, end)
    .split('\n')
    .filter((l) => {
      const t = l.trim();
      return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*');
    })
    .join('\n');
}
