// Google Calendar integration (#32) repositories — connections + activity↔event
// links. Both ride the generic `createAutomergeRepository` factory (id/timestamps
// /CRDT-change handled there); no hand-rolled persistence. Connections are
// family-wide and carry the refresh token; links map an activity to the Google
// event beanies created for it within a connection.

import { createAutomergeRepository, stripUndefined, toPlain } from '../automergeRepository';
import { getById as projectionGetById } from '../projection';
import { mutate } from '../worker/docClient';
import { toISODateString } from '@/utils/date';
import { generateUUID } from '@/utils/id';
import type { MutationOp } from '../worker/protocol';
import type { CreateFamilyActivityInput, FamilyActivity } from '@/types/models';
import type {
  CalendarConnection,
  CreateCalendarConnectionInput,
  UpdateCalendarConnectionInput,
  CalendarEventLink,
  CreateCalendarEventLinkInput,
  UpdateCalendarEventLinkInput,
} from '@/types/models';

// ── Connections ────────────────────────────────────────────────────────────

const connectionsRepo = createAutomergeRepository<
  'calendarConnections',
  CalendarConnection,
  CreateCalendarConnectionInput,
  UpdateCalendarConnectionInput
>('calendarConnections');

export const getAllCalendarConnections = connectionsRepo.getAll;
export const getCalendarConnectionById = connectionsRepo.getById;
export const createCalendarConnection = connectionsRepo.create;
export const updateCalendarConnection = connectionsRepo.update;
export const removeCalendarConnection = connectionsRepo.remove;

// ── Event links ────────────────────────────────────────────────────────────

const linksRepo = createAutomergeRepository<
  'calendarEventLinks',
  CalendarEventLink,
  CreateCalendarEventLinkInput,
  UpdateCalendarEventLinkInput
>('calendarEventLinks');

/**
 * Composite link id — `${connectionId}:${activityId}`. Deterministic so creation
 * is idempotent (cross-device: two devices creating the same link converge on the
 * same key) and lookups are O(1).
 */
export function calendarEventLinkId(connectionId: string, activityId: string): string {
  return `${connectionId}:${activityId}`;
}

export const getAllCalendarEventLinks = linksRepo.getAll;
export const updateCalendarEventLink = linksRepo.update;
export const removeCalendarEventLink = linksRepo.remove;

export function getCalendarEventLink(
  connectionId: string,
  activityId: string
): Promise<CalendarEventLink | undefined> {
  return linksRepo.getById(calendarEventLinkId(connectionId, activityId));
}

/** Upsert-by-id create using the composite key (idempotent across devices). */
export function createCalendarEventLink(
  input: CreateCalendarEventLinkInput
): Promise<CalendarEventLink> {
  return linksRepo.createWithId(calendarEventLinkId(input.connectionId, input.activityId), input);
}

export function removeCalendarEventLinkById(
  connectionId: string,
  activityId: string
): Promise<boolean> {
  return linksRepo.remove(calendarEventLinkId(connectionId, activityId));
}

/** All links for a connection — used by disconnect/GC to find this connection's events. */
export async function getCalendarEventLinksForConnection(
  connectionId: string
): Promise<CalendarEventLink[]> {
  const all = await getAllCalendarEventLinks();
  return all.filter((l) => l.connectionId === connectionId);
}

// ── One-time import (#94) ──────────────────────────────────────────────────

/** Thrown when the batch committed but its entities are not where readers look. */
export class ImportNotVisibleError extends Error {
  missing: number;
  total: number;

  constructor(missing: number, total: number) {
    super(
      `createImportedActivities: ${missing} of ${total} activities missing from the projection after a batch write`
    );
    this.name = 'ImportNotVisibleError';
    this.missing = missing;
    this.total = total;
  }
}

export interface ImportEntry {
  activity: CreateFamilyActivityInput;
  /** Everything but `activityId`, which this function mints and fills in. */
  link: Omit<CreateCalendarEventLinkInput, 'activityId'>;
}

/**
 * Write imported activities AND their calendar links in ONE Automerge change.
 *
 * The atomicity is not a nicety, it closes a duplicate-creating hole. If the
 * activities landed and the links did not, the next reconcile would see pushable
 * activities with no links, take the "never pushed" branch, and INSERT fresh
 * events beside the user's originals: exactly the duplication this whole feature
 * exists to prevent. An activity with no link is the dangerous state; a link with
 * no activity is the benign one (the reconcile plan collects it as an `unlink`).
 * One batch makes the dangerous state unrepresentable, so there is no
 * partial-success path to design for and no compensating delete to get wrong.
 *
 * `createLists` is the precedent for the shape, but it cannot be reused: it mints
 * its ids internally and returns them only after the batch has committed, so a
 * link could not reference its activity inside the SAME change. Here the activity
 * ids are generated up front for that reason.
 */
export async function createImportedActivities(entries: ImportEntry[]): Promise<FamilyActivity[]> {
  // An empty batch is a pointless change, projection delta and sync payload.
  if (!entries.length) return [];

  const now = toISODateString(new Date());
  const ops: MutationOp[] = [];
  const activities: FamilyActivity[] = [];

  for (const entry of entries) {
    const activityId = generateUUID();
    const activity = toPlain(
      stripUndefined({
        ...(entry.activity as Record<string, unknown>),
        id: activityId,
        createdAt: now,
        updatedAt: now,
      })
    ) as unknown as FamilyActivity;
    activities.push(activity);
    ops.push({ op: 'set', collection: 'activities', id: activityId, entity: activity });

    const linkId = calendarEventLinkId(entry.link.connectionId, activityId);
    const link = toPlain(
      stripUndefined({
        ...(entry.link as Record<string, unknown>),
        activityId,
        id: linkId,
        createdAt: now,
        updatedAt: now,
      })
    ) as unknown as CalendarEventLink;
    ops.push({ op: 'set', collection: 'calendarEventLinks', id: linkId, entity: link });
  }

  await mutate({ op: 'batch', ops });

  // Guards the PROJECTION DELTA, not the write: a `set` cannot silently no-op, but
  // a write that never landed where readers look would otherwise be recorded as a
  // success here and surface much later as inexplicably missing activities. Same
  // reasoning as `createLists`. Callers must NOT tell the user "nothing was
  // imported", because a retry would make a second set.
  const missing = activities.filter((a) => !projectionGetById('activities', a.id));
  if (missing.length) throw new ImportNotVisibleError(missing.length, activities.length);

  return activities;
}
