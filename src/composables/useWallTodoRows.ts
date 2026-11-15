/**
 * How a to-do row reads on the wall when the list mixes people: whose it is, and how late
 * or when due. Shared by the to-do sheet and the Lists board's to-dos card, which pass these
 * straight to `WallJobList` (`owners`, `note`), so the two cannot read a row differently.
 *
 * Call in setup: it reads the family store and the translation composable.
 */
import { computed } from 'vue';
import { useFamilyStore } from '@/stores/familyStore';
import { useTranslation } from '@/composables/useTranslation';
import { fillTemplate } from '@/utils/fillTemplate';
import { jobOwnerIds } from '@/utils/wallJobs';
import type { FamilyMember } from '@/types/models';
import type { WallJob, WallJobNote } from '@/types/wall';

export function useWallTodoRows() {
  const familyStore = useFamilyStore();
  const { t } = useTranslation();

  /** Built once per change to the family, not once per row. */
  const memberById = computed(() => new Map(familyStore.members.map((m) => [m.id, m])));

  /** Who owes this to-do, as members; empty when nobody has claimed it (the row shows "?"). */
  function todoOwners(job: WallJob): FamilyMember[] {
    return jobOwnerIds(job)
      .map((id) => memberById.value.get(id))
      .filter((m): m is FamilyMember => Boolean(m));
  }

  /** The row's chip: how late an overdue to-do is, or the time a today one is due by. */
  function todoNote(job: WallJob): WallJobNote | null {
    if (job.bucket === 'overdue' && job.daysLate) {
      const text =
        job.daysLate === 1
          ? t('date.yesterday')
          : fillTemplate(t('wall.todo.daysLate'), { n: job.daysLate });
      return { text, tone: 'late' };
    }
    // Late today (past its time, same day): no day count to show, so keep the time, in the late tone.
    if (job.bucket === 'overdue' && job.dueTime) {
      return { text: fillTemplate(t('wall.todo.byTime'), { time: job.dueTime }), tone: 'late' };
    }
    if (job.bucket === 'today' && job.dueTime) {
      return { text: fillTemplate(t('wall.todo.byTime'), { time: job.dueTime }), tone: 'time' };
    }
    return null;
  }

  return { todoOwners, todoNote };
}
