/**
 * The tick-burst channel.
 *
 * A tick is the wall's only routine interaction, and on a screen two metres
 * away a row simply going grey is not visible feedback — the mockup answers
 * this with beans popping out of the tick and a hand-written cheer. That has to
 * fire from `WallJobRow`, which is four levels below the page that owns the
 * burst layer, so it travels the same way the lock does.
 *
 * Optional by design (no throwing default): a job row rendered in a test, or in
 * some future non-wall context, should tick without a burst rather than crash.
 */
import type { InjectionKey } from 'vue';
import type { WallJob } from '@/types/wall';

/**
 * Fire a burst centred on the given viewport coordinates, for `job` (so a surface can decline:
 * the chore lanes skip the tick that finishes a block, where the all-done celebration plays).
 */
export type WallBurstFn = (x: number, y: number, job?: WallJob) => void;

export const WALL_BURST: InjectionKey<WallBurstFn> = Symbol('wallBurst');
