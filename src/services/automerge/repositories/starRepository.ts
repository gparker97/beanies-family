/**
 * Stars and rewards for chores (#148): the complete write surface for the star collections
 * (`choreWeeks`, `choreAwards`, `choreStarGifts`).
 *
 * Every write lives in this one file, and it computes nothing: WHAT to write is decided by
 * `starStore` and the pure rules in `src/utils/choreStars.ts`. The weekly reward's `celebrated`
 * mark is NOT written here: it is a chore mark, written by `choreRepository` through
 * `choreStore.writeCelebratedMark`, so marks keep one writer.
 *
 * Load-bearing rules:
 *   - A frozen `ChoreWeek` is WRITTEN WHOLE (a `set` of its deterministic `choreWeekId`), never
 *     patched: `days` is positional, and per-item patches from two devices could merge to eight
 *     days. Two devices that freeze the same week converge on ONE whole record (one of the two
 *     sets wins the key). There is no update path; do not add one.
 *   - No `ifAbsent` on weeks: a re-settle replaces the record whole.
 *   - An award is created whole and edited with a based patch (the factory's `update`), so a
 *     peer's concurrent edit to another field is kept.
 *   - A gift is write-once: created whole, removed by a grown-up, never patched.
 *   - A batch is ONE Automerge change: a mid-batch throw commits nothing.
 */
import { createAutomergeRepository } from '../automergeRepository';
import type { ChoreAward, ChoreStarGift, ChoreWeek } from '@/types/models';
import type { ChoreWeekDraft } from '@/utils/choreStars';

const weekRepo = createAutomergeRepository<'choreWeeks', ChoreWeek>('choreWeeks');
const awardRepo = createAutomergeRepository<'choreAwards', ChoreAward>('choreAwards');
const giftRepo = createAutomergeRepository<'choreStarGifts', ChoreStarGift>('choreStarGifts');

export type CreateAwardInput = Omit<ChoreAward, 'id' | 'createdAt' | 'updatedAt'>;
export type UpdateAwardInput = Partial<Omit<CreateAwardInput, 'createdBy' | 'weekStart'>>;
export type CreateGiftInput = Omit<ChoreStarGift, 'id' | 'createdAt' | 'updatedAt'>;

export const getAllChoreWeeks = weekRepo.getAll;
export const getAllAwards = awardRepo.getAll;
export const getAllGifts = giftRepo.getAll;

/**
 * Write frozen weeks WHOLE, by their deterministic ids, in ONE change (the week close). Takes the
 * records and computes nothing. Returns them as stored (stamped).
 */
export const setChoreWeeks = (weeks: readonly ChoreWeekDraft[]): Promise<ChoreWeek[]> =>
  weekRepo.createManyWithIds(weeks.map(({ id, ...input }) => ({ id, input })));

/** A new award, whole, with a fresh id. */
export const createAward = (input: CreateAwardInput): Promise<ChoreAward> =>
  awardRepo.create(input);

/** A based patch of one award; `undefined` when it is gone (deleted here or on another device). */
export const updateAward = (id: string, input: UpdateAwardInput) => awardRepo.update(id, input);

/** Delete one award. `false` when it was already gone. */
export const deleteAward = (id: string): Promise<boolean> => awardRepo.remove(id);

/** A new bonus or take-back, whole, with a fresh id. */
export const createGift = (input: CreateGiftInput): Promise<ChoreStarGift> =>
  giftRepo.create(input);

/** Remove one bonus or take-back. `false` when it was already gone. */
export const removeGift = (id: string): Promise<boolean> => giftRepo.remove(id);
