/**
 * Every activity-link WRITE goes through `todoLinkPatch` / `listLinkPatch` (`utils/activityLinks.ts`).
 *
 * A link is two fields: the id (`TodoItem.activityId` / `FamilyList.linkedActivityId`) and the
 * session date (`activityDate`). Written separately, a relink or an unlink leaves the old session
 * date behind, and the item silently shows on the wrong session (or on none). The writers always
 * carry BOTH keys (`undefined` clears), so going through them makes that impossible. A new call
 * site that writes `{ linkedActivityId: id }` by hand would reopen the hole, and no type or lint
 * rule would catch it, because it is a perfectly ordinary object literal. This test catches it.
 *
 * What counts: `linkedActivityId:` or `activityDate:` as an OBJECT KEY (after `{`, `,` or at the
 * start of a line) in any `src/**\/*.{ts,vue}` outside `utils/activityLinks.ts` and tests, with
 * comments stripped. Type declarations use `?:` and do not match; nor do reads
 * (`l.linkedActivityId === id`) or ternaries (`x ? activityDate : y`). An `activityDate` key in
 * a literal that also names `activityId` is allowed: that is an `ActivityLink` (the writers'
 * input, e.g. `{ activityId: newId, activityDate }`), never a date without its id. A list's
 * `linkedActivityId` key is never allowed by hand.
 *
 * Known gap: shorthand properties (`{ activityDate }`) are not detected, because they are
 * indistinguishable from destructuring reads by a regex. Write through the helpers regardless.
 *
 * If this fails: do not add an exemption. Build the patch with `todoLinkPatch` / `listLinkPatch`
 * (or call `todoStore.linkTodosToActivity` / `listStore.linkListsToActivity`).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const SRC = resolve(__dirname, '../..');
const ALLOWED = new Set(['utils/activityLinks.ts']);

function isTest(rel: string): boolean {
  return rel.includes('__tests__/') || /\.(test|spec)\.ts$/.test(rel);
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|vue)$/.test(name) && !name.endsWith('.d.ts')) out.push(full);
  }
  return out;
}

/** Strip comments so a key mentioned in prose is not counted. */
function code(src: string): string {
  return src
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((l) => (l.trim().startsWith('//') ? '' : l.replace(/\s\/\/\s.*$/, '')))
    .join('\n');
}

const KEY_WRITE = /(^|[{,])\s*(linkedActivityId|activityDate)\s*:/gm;

/** The object literal (`{ ... }`) enclosing `at`, or '' when there is none. */
function enclosingLiteral(src: string, at: number): string {
  let depth = 0;
  let start = -1;
  for (let i = at; i >= 0; i--) {
    if (src[i] === '}') depth++;
    else if (src[i] === '{' && depth-- === 0) {
      start = i;
      break;
    }
  }
  if (start < 0) return '';
  depth = 0;
  for (let i = start; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) return src.slice(start, i + 1);
  }
  return '';
}

/**
 * An `activityDate` key is fine inside a literal that also names `activityId`: that is an
 * `ActivityLink` (the writers' input) or a complete to-do link, never a date without its id.
 */
function isCompleteLink(literal: string): boolean {
  return /(^|[{,])\s*activityId\s*[:,}]/m.test(literal);
}

function linkKeyWrites(src: string): string[] {
  const stripped = code(src);
  return [...stripped.matchAll(KEY_WRITE)]
    .filter((m) => m[2] !== 'activityDate' || !isCompleteLink(enclosingLiteral(stripped, m.index!)))
    .map((m) => m[2]!);
}

describe('activity links are written only through the link writers', () => {
  it('the detector finds object-key writes and ignores types, reads and ternaries', () => {
    expect(linkKeyWrites(`update(id, { linkedActivityId: id });`)).toEqual(['linkedActivityId']);
    expect(linkKeyWrites(`const p = {\n  title,\n  activityDate: ymd,\n};`)).toEqual([
      'activityDate',
    ]);
    expect(linkKeyWrites(`interface X {\n  activityDate?: string;\n}`)).toEqual([]);
    expect(linkKeyWrites(`if (l.linkedActivityId === id) go();`)).toEqual([]);
    expect(linkKeyWrites(`const d = has ? activityDate : undefined;`)).toEqual([]);
    expect(linkKeyWrites(`// { linkedActivityId: id }\n/* activityDate: x */`)).toEqual([]);
    // An ActivityLink literal (the writers' input) names its id beside the date.
    expect(linkKeyWrites(`relink(ids, { activityId: toId, activityDate: ymd });`)).toEqual([]);
    expect(linkKeyWrites(`f({\n  activityId,\n  activityDate: d,\n})`)).toEqual([]);
    // ...but a date written without its id, or a list link by hand, is still caught.
    expect(linkKeyWrites(`updateTodo(id, { title, activityDate: d });`)).toEqual(['activityDate']);
    expect(linkKeyWrites(`x({ linkedActivityId: a, activityDate: d })`)).toEqual([
      'linkedActivityId',
      'activityDate',
    ]);
  });

  it('no file outside utils/activityLinks.ts writes a link key by hand', () => {
    const offenders: string[] = [];
    for (const file of walk(SRC)) {
      const rel = relative(SRC, file).replace(/\\/g, '/');
      if (ALLOWED.has(rel) || isTest(rel)) continue;
      const hits = linkKeyWrites(readFileSync(file, 'utf8'));
      if (hits.length) offenders.push(`${rel}: ${hits.join(', ')}`);
    }
    expect(
      offenders,
      'Write activity links with todoLinkPatch / listLinkPatch (utils/activityLinks.ts) so the ' +
        'id and the session date always travel together.'
    ).toEqual([]);
  });
});
