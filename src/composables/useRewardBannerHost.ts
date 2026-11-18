import { onBeforeUnmount, onMounted, toValue, watch, type MaybeRefOrGetter } from 'vue';
import { useStarStore, type RewardBannerSurface } from '@/stores/starStore';

/**
 * Stars and rewards (#148): mark a mounted surface as a HOST of the weekly reward's achieved
 * banner for some kids. A host is a surface that draws the banner (`rewardBannerFor`) for a
 * child: the wall's lane for that child (`WallChoreLanes`, every lane drawn, and none while the
 * lanes are covered) and the child's day head (`ChoreboardPage`). A caller passes only the kids
 * whose banner can be seen now. The star store claims the once-a-week banner only while a host
 * for that kid is registered (`starStore.hostRewardBanner`, THE RULE in `starStore.ts`), so it
 * can never be used up by a surface that draws nothing, and a week achieved elsewhere (a
 * grown-up's tick on a home card, a bonus, a sync) plays the next time a host is on screen.
 *
 * `memberIds` is read reactively: a kid added to or dropped from the list is registered or
 * released at once. Registered from mount, released on unmount. Grown-ups, pets and ids that
 * do not earn stars may be passed: the store ignores them.
 */
export function useRewardBannerHost(
  memberIds: MaybeRefOrGetter<readonly string[]>,
  surface: RewardBannerSurface
): void {
  const starStore = useStarStore();
  const releases = new Map<string, () => void>();
  let mounted = false;

  function sync(): void {
    const want = new Set(mounted ? toValue(memberIds) : []);
    for (const [id, release] of releases) {
      if (want.has(id)) continue;
      release();
      releases.delete(id);
    }
    for (const id of want) {
      if (!releases.has(id)) releases.set(id, starStore.hostRewardBanner(id, surface));
    }
  }

  watch(() => toValue(memberIds).join('\n'), sync);
  onMounted(() => {
    mounted = true;
    sync();
  });
  onBeforeUnmount(() => {
    mounted = false;
    sync();
  });
}
