<script setup lang="ts">
/**
 * Per-member invite panel on the onboarding wizard's Complete step.
 *
 * Delegates the full send flow to `InviteWizardModal` (the same component the
 * Pod page's per-bean share icon uses) — opens with `prefill={ email, memberName }`
 * so the wizard skips Step 0 (picker) and lands directly on Step 1
 * (confirm/edit email) → Step 2 (QR + share channels).
 *
 * Rows here are pure indicators of who CAN be invited; the wizard owns:
 *   - email confirmation + editing (Step 1 — supports no-email members)
 *   - Drive permission share + invite-link generation
 *   - QR code + ShareChannelGrid (copy link / WhatsApp / iMessage / etc.)
 *   - inline error UI + retry / change-email recovery
 *
 * Visibility gate: only renders when storage = google_drive AND a familyKey
 * is loaded AND at least one non-owner human hasn't joined yet (i.e. still
 * has `requiresPassword !== false`).
 */
import { computed, ref } from 'vue';
import BeanieAvatar from '@/components/ui/BeanieAvatar.vue';
import InviteWizardModal from '@/components/family/InviteWizardModal.vue';
import { useInviteFlow } from '@/composables/useInviteFlow';
import { useSyncStore } from '@/stores/syncStore';
import { useFamilyStore } from '@/stores/familyStore';
import { useFamilyContextStore } from '@/stores/familyContextStore';
import { useTranslation } from '@/composables/useTranslation';
import { isUnshareableEmail } from '@/utils/email';
import type { AvatarVariant } from '@/constants/avatars';
import type { FamilyMember } from '@/types/models';

const { t } = useTranslation();
const syncStore = useSyncStore();
const familyStore = useFamilyStore();
const familyContextStore = useFamilyContextStore();
const inviteFlow = useInviteFlow();

/** Member currently driving the wizard's `prefill` prop. Null when wizard is closed. */
const pendingShareMember = ref<FamilyMember | null>(null);
const showInviteModal = ref(false);

interface Row {
  member: FamilyMember;
  /** 'joined' (already accepted) or 'pending' (selectable / sendable). */
  state: 'joined' | 'pending';
  /** Real email shown inline; empty when missing or unshareable. */
  displayEmail: string;
}

/**
 * All non-owner humans who need to appear in the panel — both already-joined
 * (rendered as a status chip, no Send button) and still-to-invite. Members
 * without a usable email still appear as "pending" because the wizard's
 * Step 1 lets the user type one in.
 */
const rows = computed<Row[]>(() => {
  const ownerId = familyStore.owner?.id;
  return familyStore.humans
    .filter((m) => m.id !== ownerId)
    .map<Row>((member) => ({
      member,
      state: member.requiresPassword === false ? 'joined' : 'pending',
      displayEmail: member.email && !isUnshareableEmail(member.email) ? member.email : '',
    }));
});

const hasInvitableMember = computed(() => rows.value.some((r) => r.state === 'pending'));

const showPanel = computed(
  () =>
    syncStore.storageProviderType === 'google_drive' &&
    syncStore.familyKey !== null &&
    hasInvitableMember.value
);

const wizardPrefill = computed(() =>
  pendingShareMember.value
    ? {
        email: pendingShareMember.value.email ?? '',
        memberName: pendingShareMember.value.name,
      }
    : undefined
);

function avatarVariantFor(member: FamilyMember): AvatarVariant {
  return (member.avatar as AvatarVariant) || 'classic';
}

function openWizardFor(member: FamilyMember) {
  pendingShareMember.value = member;
  inviteFlow.reset();
  showInviteModal.value = true;
}

function handleWizardClose() {
  showInviteModal.value = false;
  pendingShareMember.value = null;
}

/**
 * Wizard's Step 0 picker emits `add-bean` if visible. We always enter via
 * `prefill`, which forces the wizard to skip Step 0 — so this should never
 * fire. If it ever does (future regression), close the wizard rather than
 * branching deeper into the add-member flow during onboarding.
 */
function handleAddBeanFromWizard() {
  console.warn('[OnboardingInvitePanel] wizard add-bean fired unexpectedly — closing wizard');
  handleWizardClose();
}
</script>

<template>
  <div v-if="showPanel" class="invite-card" data-testid="onboarding-invite-panel">
    <!-- Header -->
    <div class="invite-head">
      <span class="text-base">✉️</span>
      <span class="font-heading text-sm font-bold">{{ t('onboarding.invite.title') }}</span>
      <span class="invite-pill">{{ t('onboarding.invite.optional') }}</span>
    </div>

    <p class="invite-lede">{{ t('onboarding.invite.lede') }}</p>

    <!-- Per-member rows — joined members render a status chip, pending get a Send button -->
    <div class="invite-rows">
      <div
        v-for="row in rows"
        :key="row.member.id"
        class="invite-row"
        :class="{ 'invite-row-joined': row.state === 'joined' }"
      >
        <BeanieAvatar :variant="avatarVariantFor(row.member)" :color="row.member.color" size="sm" />
        <span class="invite-name">{{ row.member.name }}</span>
        <span v-if="row.displayEmail" class="invite-email">{{ row.displayEmail }}</span>
        <span v-else-if="row.state === 'pending'" class="invite-noemail-hint">
          {{ t('onboarding.invite.noEmail') }}
        </span>

        <!-- Joined: status chip, no action button -->
        <span v-if="row.state === 'joined'" class="invite-joined-chip">
          {{ t('inviteWizard.picker.statusJoined') }}
        </span>

        <!-- Pending: Send button → opens InviteWizardModal with prefill -->
        <button
          v-else
          type="button"
          class="invite-send-btn"
          :data-testid="`onboarding-invite-send-${row.member.id}`"
          @click="openWizardFor(row.member)"
        >
          {{ t('onboarding.invite.send') }}
        </button>
      </div>
    </div>

    <!-- Reminder line -->
    <p class="invite-reminder">{{ t('onboarding.invite.reminder') }}</p>

    <!-- Canonical share flow — same wizard the Pod page uses. layer="top"
         (z-[250]) is required so the wizard stacks above the onboarding
         overlay (z-200); the Pod page's instance can stay at the default
         "overlay" layer. -->
    <InviteWizardModal
      :open="showInviteModal"
      layer="top"
      :provider="syncStore.storageProviderType"
      :inviter-name="familyStore.currentMember?.name ?? t('family.title')"
      :family-name="familyContextStore.activeFamilyName ?? t('family.title')"
      :prefill="wizardPrefill"
      :invite-flow="inviteFlow"
      @close="handleWizardClose"
      @add-bean="handleAddBeanFromWizard"
    />
  </div>
</template>

<style scoped>
.invite-card {
  background: white;
  border: 1.5px solid rgb(174 214 241 / 30%);
  border-radius: 16px;
  margin-bottom: 24px;
  padding: 16px 18px;
  text-align: left;
}

.dark .invite-card {
  background: #26343f;
  border-color: rgb(174 214 241 / 12%);
}

.invite-head {
  align-items: center;
  display: flex;
  gap: 8px;
  margin-bottom: 8px;
}

.invite-pill {
  background: rgb(174 214 241 / 20%);
  border-radius: 999px;
  color: var(--deep-slate, #2c3e50);
  font-family: Outfit, sans-serif;
  font-size: 0.55rem;
  font-weight: 600;
  letter-spacing: 0.04em;
  margin-left: auto;
  padding: 3px 10px;
  text-transform: uppercase;
}

.dark .invite-pill {
  color: #c3ced6;
}

.invite-lede {
  color: var(--deep-slate, #2c3e50);
  font-size: 0.75rem;
  line-height: 1.5;
  margin-bottom: 12px;
  opacity: 0.6;
}

.dark .invite-lede {
  color: #c3ced6;
}

.invite-rows {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 10px;
}

.invite-row {
  align-items: center;
  background: rgb(44 62 80 / 3%);
  border-radius: 12px;
  display: flex;
  gap: 10px;
  padding: 8px 12px;
}

.dark .invite-row {
  background: rgb(255 255 255 / 4%);
}

.invite-row-joined {
  background: rgb(174 214 241 / 12%);
}

.dark .invite-row-joined {
  background: rgb(174 214 241 / 8%);
}

.invite-name {
  font-family: Outfit, sans-serif;
  font-size: 0.78rem;
  font-weight: 700;
  white-space: nowrap;
}

.invite-email {
  flex: 1;
  font-family: Inter, sans-serif;
  font-size: 0.7rem;
  min-width: 0;
  opacity: 0.5;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.invite-noemail-hint {
  flex: 1;
  font-family: Outfit, sans-serif;
  font-size: 0.7rem;
  font-style: italic;
  opacity: 0.5;
}

.invite-send-btn {
  background: linear-gradient(135deg, var(--heritage-orange, #f15d22), var(--terracotta, #e67e22));
  border: none;
  border-radius: 999px;
  color: white;
  cursor: pointer;
  font-family: Outfit, sans-serif;
  font-size: 0.68rem;
  font-weight: 700;
  padding: 5px 14px;
  transition:
    opacity 0.15s,
    transform 0.15s;
  white-space: nowrap;
}

.invite-send-btn:hover {
  transform: translateY(-1px);
}

.invite-joined-chip {
  background: rgb(174 214 241 / 30%);
  border-radius: 999px;
  color: #1e5a85;
  font-family: Outfit, sans-serif;
  font-size: 0.65rem;
  font-weight: 600;
  letter-spacing: 0.04em;
  padding: 4px 10px;
  white-space: nowrap;
}

.dark .invite-joined-chip {
  background: rgb(174 214 241 / 18%);
  color: #aed6f1;
}

.invite-reminder {
  color: var(--deep-slate, #2c3e50);
  font-family: Caveat, cursive;
  font-size: 0.95rem;
  font-style: italic;
  font-weight: 500;
  opacity: 0.55;
  text-align: center;
}

.dark .invite-reminder {
  color: #c3ced6;
}
</style>
