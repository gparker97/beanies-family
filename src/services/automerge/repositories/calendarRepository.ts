// Google Calendar integration (#32) repositories — connections + activity↔event
// links. Both ride the generic `createAutomergeRepository` factory (id/timestamps
// /CRDT-change handled there); no hand-rolled persistence. Connections are
// family-wide and carry the refresh token; links map an activity to the Google
// event beanies created for it within a connection.

import { createAutomergeRepository } from '../automergeRepository';
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
