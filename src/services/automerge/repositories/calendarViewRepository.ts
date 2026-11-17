// View-only external calendars (plan 2026-11-17) repositories: the Google accounts the
// family reads calendars from, and the calendars shown from them. Both ride the generic
// `createAutomergeRepository` factory (id/timestamps/CRDT change handled there), exactly
// like `calendarRepository.ts`.
//
// ⚠️ Kept apart from `calendarConnections` on purpose: every build treats each record
// there as a push target, so a view credential stored in it would make an older build
// write family activities into a calendar that is only meant to be read.

import { createAutomergeRepository } from '../automergeRepository';
import type {
  CalendarViewAccount,
  CreateCalendarViewAccountInput,
  UpdateCalendarViewAccountInput,
  ViewedCalendar,
  CreateViewedCalendarInput,
  UpdateViewedCalendarInput,
} from '@/types/models';

// ── View accounts (credentials) ─────────────────────────────────────────────

const viewAccountsRepo = createAutomergeRepository<
  'calendarViewAccounts',
  CalendarViewAccount,
  CreateCalendarViewAccountInput,
  UpdateCalendarViewAccountInput
>('calendarViewAccounts');

export const getAllCalendarViewAccounts = viewAccountsRepo.getAll;
export const getCalendarViewAccountById = viewAccountsRepo.getById;
export const createCalendarViewAccount = viewAccountsRepo.create;
export const updateCalendarViewAccount = viewAccountsRepo.update;
export const removeCalendarViewAccount = viewAccountsRepo.remove;

// ── Viewed calendars ────────────────────────────────────────────────────────

const viewedCalendarsRepo = createAutomergeRepository<
  'viewedCalendars',
  ViewedCalendar,
  CreateViewedCalendarInput,
  UpdateViewedCalendarInput
>('viewedCalendars');

export const getAllViewedCalendars = viewedCalendarsRepo.getAll;
export const getViewedCalendarById = viewedCalendarsRepo.getById;
export const createViewedCalendar = viewedCalendarsRepo.create;
export const updateViewedCalendar = viewedCalendarsRepo.update;
export const removeViewedCalendar = viewedCalendarsRepo.remove;
