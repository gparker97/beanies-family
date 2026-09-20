import { computed, ref } from 'vue';
import { useAuthStore } from '@/stores/authStore';
import { useFamilyStore } from '@/stores/familyStore';
import { usePermissions } from '@/composables/usePermissions';
import type { FamilyMember } from '@/types/models';

/**
 * "Who is this magic link for?" — the target a mint surface is currently pointed at.
 *
 * ⚠️ THE TARGET LIVES IN THE HOST, AND THAT IS THE WHOLE POINT OF THIS FILE.
 *
 * The first design put the target inside a wrapper component that also owned the mint and the
 * rendered panel. That shape invites a DESTRUCTIVE, SILENT defect, so it was rejected:
 * `MagicLinkCard` derives `existing`, `status`, `statusText` and its "this cancels the old one"
 * warning from whichever member it thinks the target is. Hide the target inside a child and the
 * card keeps deriving all four from `currentUser` — so you see YOUR green "active" dot and YOUR
 * replace-warning while minting for your spouse, and because `memberLinkKeys` is newest-wins,
 * the mint then silently destroys THEIR working link. There is no error, no toast, and nothing
 * in the firehose: the next time they open a new phone, their saved link simply does not work.
 *
 * Keeping the target here, read by the host, means every one of those computeds derives from the
 * real target for free and the warning names the right person.
 *
 * This composable deliberately owns NOTHING else. No crypto, no `useMintedLink` call, no
 * rendering, no telemetry — the hosts already own those, and `MintedLinkPanel`'s own docblock
 * requires copy to come from the host (hard-coded copy once made the 15-minute card announce
 * itself as the 7-day one). A fourth layer would re-create exactly that coupling.
 */
export function useMintTarget() {
  const authStore = useAuthStore();
  const familyStore = useFamilyStore();

  /**
   * ⚠️ `usePermissions()`, NOT `currentMember.canManagePod` DIRECTLY. That field is optional and
   * is only defaulted at the repository layer (`canManagePod ?? role === 'owner'`), so reading
   * it raw would have denied the OWNER on any record where it was never written. The composable
   * is the app's single source of truth (`isOwner || !!currentMember?.canManagePod`) and is what
   * every other family-scoped control on the Settings page already gates on.
   */
  const { canManagePod } = usePermissions();

  /**
   * `null` means "follow whoever is signed in" rather than "nobody".
   *
   * Stored as an absence instead of being seeded with `currentUser.memberId` on setup, because
   * the roster and the session do not always resolve before a Settings card mounts. Seeding
   * would freeze a `null` self into the target and leave the card minting for `''`, which
   * `mintMagicLink` correctly refuses as "the pod is not open" — a confusing error on a screen
   * where nothing is wrong.
   */
  const explicitTargetId = ref<string | null>(null);
  const isPickerOpen = ref(false);

  const selfId = computed<string | null>(() => authStore.currentUser?.memberId ?? null);
  const targetId = computed<string | null>(() => explicitTargetId.value ?? selfId.value);

  /**
   * Who may be offered as a target.
   *
   * Humans only, because a pet cannot sign in.
   *
   * ⚠️ AND ONLY YOURSELF UNLESS YOU MAY MANAGE THE POD. Minting for another member issues a
   * credential that opens the WHOLE family's pod, and `memberLinkKeys` is newest-wins, so it
   * also destroys the link that member is currently holding. The PIN step-up proves you are
   * you; it does not prove you may act on someone else. The line this replaced read the bare
   * roster, which meant a member-role bean — or a child's bean left signed in on the family
   * laptop — could pick the owner, enter their OWN pin, and revoke the owner's saved link with
   * no error and nothing in the firehose beyond `target=other`.
   *
   * Every other family-scoped control on the Settings page already gates on `canManagePod`;
   * this brings the mint cards in line with them.
   */
  /** Whether the signed-in member may issue a credential on someone else's behalf. */
  const canMintForOthers = canManagePod;

  const candidates = computed<FamilyMember[]>(() => {
    const humans = familyStore.sortedHumans;
    if (canMintForOthers.value) return humans;
    return humans.filter((m) => m.id === selfId.value);
  });

  const target = computed<FamilyMember | null>(
    () => familyStore.members.find((m) => m.id === targetId.value) ?? null
  );

  /**
   * ⚠️ DERIVED FROM `explicitTargetId`, NOT FROM COMPARING IDS. The first version was
   * `targetId !== null && targetId === selfId`, which is FALSE in the hydration window where
   * `selfId` is still null — so "nobody has chosen anyone" read as "minting for someone else".
   * Every host then rendered its other-member copy with an empty name ("This cancels the magic
   * link  is holding now."), and `facts()` booked `target=other` for what was a self-mint,
   * poisoning the new telemetry dimension in exactly the cold-start window.
   *
   * "Nobody has explicitly picked" IS "self", whether or not the session has resolved yet.
   */
  const isSelf = computed(
    () => explicitTargetId.value === null || explicitTargetId.value === selfId.value
  );

  /**
   * A member who has not joined yet cannot use a magic link: the wrapped key would be waiting in
   * an envelope their Google account has no permission to read. They need the joining route,
   * which is the only path that performs the Drive permission share.
   *
   * `requiresPassword` is the roster's own derived "unclaimed" flag (no `passwordHash` AND no
   * `pinHash`) — the same predicate the join flow and the invite picker already branch on, so
   * this does not invent a second definition of "joined".
   */
  const needsJoiningLink = computed(() => target.value?.requiresPassword === true);

  /**
   * Can this target be minted for AT ALL.
   *
   * ⚠️ A MISSING MEMBER IS NOT A JOINED MEMBER. `needsJoiningLink` above is `false` when the
   * target is not in the roster, which is the *mint* branch — and `mintMagicLink` does NOT refuse
   * an unknown id: `linkMint.test.ts` pins that it returns a real link with `hint:
   * 'unknown-member'`. So a member removed by a background Drive merge between picking and
   * tapping would have had a newest-wins wrap published against a dead id, silently. This is the
   * guard that makes "we could not resolve them" its own state instead of the happy path.
   */
  const isResolvable = computed(() => target.value !== null);

  function openPicker(): void {
    isPickerOpen.value = true;
  }

  function choose(memberId: string): void {
    explicitTargetId.value = memberId;
    isPickerOpen.value = false;
  }

  function cancelPicker(): void {
    isPickerOpen.value = false;
  }

  /** Back to "for me", closed. Hosts call this when their card or sheet is dismissed. */
  function reset(): void {
    explicitTargetId.value = null;
    isPickerOpen.value = false;
  }

  return {
    targetId,
    target,
    isResolvable,
    canMintForOthers,
    targetName: computed(() => target.value?.name ?? ''),
    isSelf,
    candidates,
    needsJoiningLink,
    isPickerOpen,
    openPicker,
    choose,
    cancelPicker,
    reset,
  };
}
