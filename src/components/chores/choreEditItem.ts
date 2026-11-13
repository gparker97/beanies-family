import type { ChoreBlock } from '@/types/models';

/**
 * One row of a chore list being edited (#146): the Add Chores sheet's draft rows and a bean's
 * stored chores alike, so both lists render through the same `ChoreEditList` / `ChoreEditRow`.
 * The host maps its own state onto this and answers the row's intents.
 */
export interface ChoreEditItem {
  /** Stable for the row's life: a draft row's id, a stored chore's id, a new row's local key. */
  key: string;
  title: string;
  emoji: string;
  illustration?: string;
  block: ChoreBlock;
  /** Weekdays 0-6; empty or absent = every day. */
  days?: readonly number[];
  /** A quiet line under the title ("Shared with Juno"). */
  note?: string;
  /** Can be dragged within its block (a stored chore in a bean's list). */
  draggable?: boolean;
  /** Extra `data-*` attributes for the row (tests and the screenshot scripts read them). */
  attrs?: Record<string, string>;
}

/** The choosers a row can open, one at a time across the list. */
export type ChoreEditChooser = 'time' | 'picture' | 'days';
