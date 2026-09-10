/**
 * The wall's write channel: a projection of `useWallJobs`, not a second one.
 *
 * `WallJobRow` is reached through `WallJobList`, which serves the board, the
 * lanes and the sheet. Threading rename and remove down as props would mean
 * editing every one of those call sites plus the pass-through components in
 * between, for callbacks two of those layers never use. The wall already
 * answered this question twice, with `WALL_LOCK` and `WALL_BURST`, so this
 * follows the same precedent rather than inventing a third pattern.
 *
 * Optional by design, and deliberately WITHOUT a fallback object. A truthy
 * fallback would render the edit controls and then swallow every write, which
 * is the exact opposite of degrading to read-only. Consumers gate on
 * `canEdit && edit`, so a row mounted without the provide simply has no
 * controls.
 */
import type { InjectionKey } from 'vue';
import type { WallJob } from '@/types/wall';

export interface WallEditContext {
  addListItem: (listId: string, title: string) => Promise<boolean>;
  addTodo: (title: string) => Promise<boolean>;
  renameJob: (job: WallJob, title: string) => Promise<boolean>;
  removeJob: (job: WallJob) => Promise<boolean>;
}

export const WALL_EDIT: InjectionKey<WallEditContext> = Symbol('wallEdit');
