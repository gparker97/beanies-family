<script setup lang="ts">
import { ref, computed } from 'vue';
import BeanieAvatar from '@/components/ui/BeanieAvatar.vue';
import ShareInviteModal from '@/components/family/ShareInviteModal.vue';
import { useInviteFlow } from '@/composables/useInviteFlow';
import { useSyncStore } from '@/stores/syncStore';
import { useFamilyStore } from '@/stores/familyStore';
import { useFamilyContextStore } from '@/stores/familyContextStore';
import { useTranslation } from '@/composables/useTranslation';
import { showToast } from '@/composables/useToast';
import { isValidEmail, isUnshareableEmail } from '@/utils/email';
import { ErrorSurfaces } from './errorSurfaces';
import type { AvatarVariant } from '@/constants/avatars';
import type { FamilyMember } from '@/types/models';

const { t } = useTranslation();
const syncStore = useSyncStore();
const familyStore = useFamilyStore();
const familyContextStore = useFamilyContextStore();
const inviteFlow = useInviteFlow();

/**
 * Per-row state machine. Single map (not two parallel maps) — atomic
 * `{ state, error? }` updates eliminate state/error desync risk.
 */
type RowState = 'idle' | 'sending' | 'sent' | 'error';
interface RowEntry {
  state: RowState;
  error?: string;
}
const rows = ref<Map<string, RowEntry>>(new Map());

/** Single-flight gate — only one row sends at a time. */
const currentSendingId = ref<string | null>(null);
/** Member currently driving the open ShareInviteModal. */
const activeShareMember = ref<FamilyMember | null>(null);

// ── Visibility gate ────────────────────────────────────────────────────────
// 3 conditions, all required:
//   1. Storage = google_drive (local pods have no shareable file)
//   2. familyKey loaded (otherwise inviteFlow.shareDriveAccess would throw)
//   3. >=1 invitable non-owner with a real email
//
// When the gate fails, the panel renders nothing. OnboardingComplete falls
// back to its existing "summary + CTA + sign-off" layout cleanly.

const inviteableMembers = computed<FamilyMember[]>(() => {
  const ownerId = familyStore.owner?.id;
  return familyStore.humans.filter(
    (m) => m.id !== ownerId && m.email && !isUnshareableEmail(m.email)
  );
});

/** Members who exist but can't be invited (no email / placeholder email) — shown as "no email - skip". */
const noEmailMembers = computed<FamilyMember[]>(() => {
  const ownerId = familyStore.owner?.id;
  return familyStore.humans.filter(
    (m) => m.id !== ownerId && (!m.email || isUnshareableEmail(m.email))
  );
});

const showPanel = computed(
  () =>
    syncStore.storageProviderType === 'google_drive' &&
    syncStore.familyKey !== null &&
    inviteableMembers.value.length > 0
);

// ── Send flow (single try/catch — no nested error handling) ────────────────

function rowStateFor(memberId: string): RowState {
  return rows.value.get(memberId)?.state ?? 'idle';
}

function rowErrorFor(memberId: string): string | undefined {
  return rows.value.get(memberId)?.error;
}

/** Action-button label for a row in error state — driven by inviteFlow.error.recovery. */
const errorActionLabel = computed(() =>
  inviteFlow.error.value?.recovery === 'edit-email'
    ? t('onboarding.invite.editEmail')
    : t('onboarding.invite.retry')
);

async function sendForMember(member: FamilyMember) {
  if (currentSendingId.value) return;
  currentSendingId.value = member.id;
  rows.value.set(member.id, { state: 'sending' });
  inviteFlow.clearError();

  try {
    // Defensive — the visibility gate already filters these, but if a temp
    // email leaked through we want the failure to surface, not silently
    // produce a hint-less link.
    if (!isValidEmail(member.email) || isUnshareableEmail(member.email)) {
      throw new Error('invalid-email-passed-gate');
    }

    const granted = await inviteFlow.shareDriveAccess(member.email);
    if (!granted) throw new Error(inviteFlow.error.value?.code ?? 'drive-share-failed');

    const linked = await inviteFlow.regenerateLinkForEmail(member.email);
    if (!linked) throw new Error(inviteFlow.error.value?.code ?? 'link-generation-failed');

    activeShareMember.value = member;
    rows.value.set(member.id, { state: 'sent' });
  } catch (e) {
    rows.value.set(member.id, {
      state: 'error',
      error: inviteFlow.error.value?.message ?? (e instanceof Error ? e.message : 'unknown'),
    });
    showToast('error', t('onboarding.errors.inviteFailed'), undefined, {
      surface: ErrorSurfaces.onboardingInviteRow,
      error: e,
      // Both fields are on the errorReporter's allowlist — no PII leak.
      context: { memberRole: member.role, hasEmail: !!member.email },
    });
  } finally {
    currentSendingId.value = null;
  }
}

function closeShareModal() {
  activeShareMember.value = null;
}

function avatarVariantFor(member: FamilyMember): AvatarVariant {
  return (member.avatar as AvatarVariant) || 'classic';
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

    <!-- Per-member rows -->
    <div class="invite-rows">
      <div
        v-for="member in inviteableMembers"
        :key="member.id"
        class="invite-row"
        :class="{ 'invite-row-sent': rowStateFor(member.id) === 'sent' }"
      >
        <BeanieAvatar :variant="avatarVariantFor(member)" :color="member.color" size="sm" />
        <span class="invite-name">{{ member.name }}</span>
        <span class="invite-email">{{ member.email }}</span>

        <!-- Idle: Send button -->
        <button
          v-if="rowStateFor(member.id) === 'idle'"
          class="invite-send-btn"
          :disabled="!!currentSendingId"
          :data-testid="`onboarding-invite-send-${member.id}`"
          @click="sendForMember(member)"
        >
          {{ t('onboarding.invite.send') }}
        </button>

        <!-- Sending: spinner + disabled -->
        <button v-else-if="rowStateFor(member.id) === 'sending'" class="invite-send-btn" disabled>
          <span class="invite-spinner" aria-hidden="true">⏳</span>
        </button>

        <!-- Sent: badge -->
        <span v-else-if="rowStateFor(member.id) === 'sent'" class="invite-sent-badge">
          {{ t('onboarding.invite.sent') }}
        </span>

        <!-- Error: inline message + retry/edit-email button -->
        <template v-else>
          <span class="invite-error-msg">{{ rowErrorFor(member.id) }}</span>
          <button
            class="invite-send-btn"
            :disabled="!!currentSendingId"
            @click="sendForMember(member)"
          >
            {{ errorActionLabel }}
          </button>
        </template>
      </div>

      <!-- No-email rows (visual only — can't be invited via link) -->
      <div v-for="member in noEmailMembers" :key="member.id" class="invite-row invite-row-noemail">
        <BeanieAvatar :variant="avatarVariantFor(member)" :color="member.color" size="sm" />
        <span class="invite-name">{{ member.name }}</span>
        <span class="invite-noemail-hint">{{ t('onboarding.invite.noEmail') }}</span>
      </div>
    </div>

    <!-- Reminder line -->
    <p class="invite-reminder">{{ t('onboarding.invite.reminder') }}</p>

    <!-- Share modal — driven by activeShareMember -->
    <ShareInviteModal
      :open="!!activeShareMember"
      :link="inviteFlow.inviteLink.value"
      :family-name="familyContextStore.activeFamilyName ?? ''"
      :member-name="activeShareMember?.name ?? ''"
      @close="closeShareModal"
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
  background: #243342;
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
  color: #cbd5e1;
}

.invite-lede {
  color: var(--deep-slate, #2c3e50);
  font-size: 0.75rem;
  line-height: 1.5;
  margin-bottom: 12px;
  opacity: 0.6;
}

.dark .invite-lede {
  color: #cbd5e1;
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

.invite-row-sent {
  background: rgb(39 174 96 / 8%);
  border: 1px solid rgb(39 174 96 / 25%);
}

.invite-row-noemail {
  opacity: 0.55;
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
  transition: opacity 0.15s;
  white-space: nowrap;
}

.invite-send-btn:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

.invite-spinner {
  display: inline-block;
  font-size: 0.85rem;
}

@media (prefers-reduced-motion: no-preference) {
  .invite-spinner {
    animation: invite-pulse 1.2s ease-in-out infinite;
  }
}

@keyframes invite-pulse {
  0%,
  100% {
    opacity: 0.4;
  }

  50% {
    opacity: 1;
  }
}

.invite-sent-badge {
  color: #27ae60;
  font-family: Outfit, sans-serif;
  font-size: 0.7rem;
  font-weight: 700;
  white-space: nowrap;
}

.invite-error-msg {
  color: var(--heritage-orange, #f15d22);
  flex: 1;
  font-family: Outfit, sans-serif;
  font-size: 0.65rem;
  min-width: 0;
  overflow: hidden;
  text-align: right;
  text-overflow: ellipsis;
  white-space: nowrap;
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
  color: #cbd5e1;
}
</style>
