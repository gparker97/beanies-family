/**
 * There must be exactly ONE place beanies deletes a Google event.
 *
 * Before the one-time import (#94) there were three: the reconcile `deletes` task,
 * `finishDisconnect`, and `setDestinationCalendar`. All three were correct then,
 * because every link pointed at an event beanies had created. The import breaks
 * that assumption, and two of those three would have deleted a family's real
 * pre-existing Google events: disconnecting the calendar, or simply changing which
 * calendar beanies syncs to.
 *
 * They now funnel through `deleteRemoteEventForLink`, which refuses for a link
 * beanies did not create. A fourth call site added later would silently reopen the
 * hole, and no type or lint rule would catch it, because `client.deleteEvent` is a
 * perfectly ordinary method. This test is the thing that catches it.
 *
 * If this fails: do not delete the assertion. Route the new call site through
 * `deleteRemoteEventForLink` instead.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SOURCE = readFileSync(resolve(__dirname, '../calendarSyncStore.ts'), 'utf8');

/** Strip comments so a `client.deleteEvent(` mentioned in prose is not counted. */
function code(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((l) => !l.trim().startsWith('//'))
    .join('\n');
}

describe('beanies deletes Google events from exactly one place', () => {
  it('calls client.deleteEvent exactly once in the whole store', () => {
    const hits = code(SOURCE).match(/client\.deleteEvent\(/g) ?? [];
    expect(
      hits,
      'A new remote-delete call site would delete events beanies did not create. ' +
        'Route it through deleteRemoteEventForLink instead of adding a second call.'
    ).toHaveLength(1);
  });

  it('the one call site is inside the guarded helper', () => {
    const helper = code(SOURCE).slice(
      code(SOURCE).indexOf('async function deleteRemoteEventForLink')
    );
    // The guard and the call live together; the call must come after the refusal.
    const guardAt = helper.indexOf('beaniesMayDelete');
    const callAt = helper.indexOf('client.deleteEvent(');
    expect(guardAt).toBeGreaterThan(-1);
    expect(callAt).toBeGreaterThan(guardAt);
  });

  it('the three historical call sites all go through the helper', () => {
    const src = code(SOURCE);
    const routed = src.match(/deleteRemoteEventForLink\(/g) ?? [];
    // One declaration plus three call sites: reconcile deletes, finishDisconnect,
    // setDestinationCalendar.
    expect(routed.length).toBeGreaterThanOrEqual(4);
  });
});
