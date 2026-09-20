<script setup lang="ts">
/**
 * "Who's signing in?" — the pick-a-member block shared by all three magic-link mint surfaces.
 *
 * ⚠️ THIS EXISTS BECAUSE TRIPLICATION SHIPPED ONE MISTAKE THREE TIMES. The first version pasted
 * ~35 lines of this markup into `MagicLinkCard`, `DeviceLinkCard` and `SignInCodeSheet`, and a
 * code review found that every single defect in it was therefore a defect in three files at
 * once: a route literal that pointed at `/meet-the-beans` (which is not a registered route —
 * the page is at `/pod`, so all three joining handoffs 404'd), an empty-state key that told a
 * signed-in owner their own link had been revoked, and a missing permission predicate. One copy
 * means one place to get each of those right.
 *
 * ⚠️ IT DELIBERATELY DOES NOT OWN THE TARGET. `useMintTarget` is instantiated by the HOST and
 * passed in, because the host's own status line, expiry date and replace-warning all derive from
 * the same target. An earlier design moved the target into a child that also owned the mint, and
 * that hid it from the host — which made `MagicLinkCard` show YOUR link's status while minting
 * for your SPOUSE, and `memberLinkKeys` is newest-wins, so the mint then silently destroyed
 * their working link. Sharing the MARKUP is orthogonal to owning the STATE; only the first is
 * safe to extract.
 *
 * ⚠️ THE CHOICE IS ALWAYS MANDATORY. There used to be an optional mode where the host's mint
 * button led and this sat behind a small "create one for someone else" link. greg's objection:
 * that link is easy to miss, and choosing a recipient is the whole decision rather than a
 * refinement. Both surfaces now open straight onto the picker, so the optional branch had no
 * consumer left and was removed — a dead mode is worse than no mode, because the next reader
 * cannot tell which one is real.
 */
import { computed } from 'vue';
import { useRouter } from 'vue-router';
import BaseButton from '@/components/ui/BaseButton.vue';
import InlineMemberPicker from '@/components/ui/InlineMemberPicker.vue';
import { useTranslation } from '@/composables/useTranslation';
import { fillTemplate } from '@/utils/fillTemplate';
import type { useMintTarget } from '@/composables/useMintTarget';

const props = defineProps<{
  /** The host's own `useMintTarget()` instance. Not created here — see the docblock. */
  target: ReturnType<typeof useMintTarget>;
  /**
   * Distinguishes the tile `data-testid`s when two pickers can be open at once (both Settings
   * cards live on the same page), so a selector cannot match the wrong grid.
   */
  testidScope: string;
  /** Emitted before navigating away, so a modal host can close itself first. */
  onBeforeLeave?: () => void;
}>();

const emit = defineEmits<{
  /** A JOINED member was chosen, so the host may proceed to its gate and mint. */
  picked: [memberId: string];
  /**
   * The person dismissed the picker without choosing.
   *
   * ⚠️ EMITTED UP RATHER THAN HANDLED HERE. This used to call `target.cancelPicker()`, which
   * only flips `isPickerOpen` — a flag nothing reads now that the picker always renders. So the
   * chip was wired to a no-op and looked broken. Only the host knows what dismissal means.
   */
  dismiss: [];
}>();

const { t } = useTranslation();
const router = useRouter();

const notJoinedMessage = computed(() =>
  fillTemplate(t('magicLink.routeToInvite'), { name: props.target.targetName.value })
);
const notJoinedAction = computed(() =>
  fillTemplate(t('magicLink.routeToInviteAction'), { name: props.target.targetName.value })
);

/**
 * ⚠️ READS `requiresPassword` OFF THE CANDIDATE, NOT OFF `needsJoiningLink` AFTER `choose()`.
 * That computed updates on the next tick, so branching on it here would race the emit and let a
 * host advance an unjoined member straight to a mint that cannot work for them.
 */
function handlePick(memberId: string): void {
  const member = props.target.candidates.value.find((m) => m.id === memberId);
  props.target.choose(memberId);
  if (member?.requiresPassword) return; // the joining-route block renders instead
  emit('picked', memberId);
}

/**
 * An unjoined member cannot use a magic link: the wrap would sit in an envelope their Google
 * account has no permission to read. They need the joining route, which is the only path that
 * performs the Drive permission share.
 *
 * ⚠️ `/pod`, NOT `/meet-the-beans`. `MeetTheBeansPage` is registered at `path: '/pod'`
 * (`router/index.ts:184`); `/family` redirects there and no `/meet-the-beans` path, alias or
 * redirect exists anywhere, so that literal fell through to the catch-all 404.
 *
 * ⚠️ A ROUTE, NOT A NESTED MODAL. `SignInCodeSheet` is itself a `BaseModal` with no focus trap,
 * so mounting `InviteWizardModal` inside it would be a three-deep dialog stack.
 */
function goToInvite(): void {
  const id = props.target.targetId.value;
  if (!id) return;
  props.onBeforeLeave?.();
  void router.push({ path: '/pod', query: { invite: id } });
}
</script>

<template>
  <div>
    <!-- The joining route, shown INSTEAD of the picker once an unjoined member is chosen,
         because minting for them would hand over a link that cannot possibly work. -->
    <template v-if="props.target.needsJoiningLink.value">
      <p class="dark:text-ink-soft mb-2 text-xs text-gray-600">{{ notJoinedMessage }}</p>
      <BaseButton variant="secondary" @click="goToInvite">{{ notJoinedAction }}</BaseButton>
    </template>

    <template v-else>
      <p class="dark:text-ink-soft mb-3 text-sm text-gray-600">
        {{ t('magicLink.pickToContinue') }}
      </p>

      <InlineMemberPicker
        :members="props.target.candidates.value"
        :title="t('magicLink.whichBeanieLoggingIn')"
        :back-label="t('action.close')"
        dismiss-style="close"
        :empty-message="t('magicLink.pickerEmpty')"
        :tile-testid-prefix="`${props.testidScope}-tile-`"
        @pick="handlePick"
        @cancel="emit('dismiss')"
      >
        <!-- Marked BEFORE the tap, so choosing an unjoined member is not a surprise. -->
        <template #badge="{ member }">
          <span
            v-if="member.requiresPassword"
            class="dark:text-ink-faint text-[0.625rem] text-gray-500"
          >
            {{ t('magicLink.notJoinedBadge') }}
          </span>
        </template>
      </InlineMemberPicker>
    </template>
  </div>
</template>
