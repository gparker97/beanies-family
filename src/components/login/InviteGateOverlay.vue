<script setup lang="ts">
import { ref, onMounted } from 'vue';
import BaseInput from '@/components/ui/BaseInput.vue';
import BaseButton from '@/components/ui/BaseButton.vue';
import BeanieIcon from '@/components/ui/BeanieIcon.vue';
import InviteDiscordButton from '@/components/login/InviteDiscordButton.vue';
import { useTranslation } from '@/composables/useTranslation';
import { validateInviteToken } from '@/utils/inviteToken';
import { isValidEmail } from '@/utils/email';
import { openDiscord } from '@/utils/discord';
import { MARKETING_URL } from '@/utils/marketing';

const emit = defineEmits<{
  unlocked: [];
  /** User dismissed the gate without unlocking — parent should return them
   *  to wherever they came from (e.g. the create/join chooser). */
  cancel: [];
}>();
const { t } = useTranslation();

function goToMarketingHome() {
  window.location.href = `${MARKETING_URL}/`;
}

/** Whether a Slack/webhook endpoint is configured for the email-request fallback.
 *  Prod injects it (deploy.yml); staging/preview builds may not. When absent, don't
 *  route users into a message form that can only dead-end at submit — send them to
 *  Discord instead. */
const hasInviteWebhook = Boolean(import.meta.env.VITE_INVITE_WEBHOOK_URL);

/** The invite-gate conversion funnel event. One definition so the event name and the
 *  `method` prop shape can't drift between the two call sites (D6). */
function recordInviteRequest(method: 'discord' | 'message') {
  window.plausible?.('invite_request_click', { props: { method } });
}

/**
 * Primary "request an invite" path: open Discord (no email needed) and record the
 * conversion. `openDiscord` navigates synchronously inside the gesture and fires its
 * own `discord_join_click`; we add the dedicated `invite_request_click` funnel event.
 */
function handleRequestOnDiscord() {
  openDiscord('invite-gate');
  recordInviteRequest('discord');
}

/** Secondary "send us a message" path. Only opens the email/Slack form when a webhook
 *  is actually configured; otherwise routes to Discord so there is no dead-end form. */
function openMessageFallback() {
  if (hasInviteWebhook) {
    mode.value = 'request';
  } else {
    handleRequestOnDiscord();
  }
}

/** Confirmed-mode "Join the Discord" — they already requested via email, so this
 *  is a plain community open (no `invite_request_click`). */
function joinDiscordOnly() {
  openDiscord('invite-gate');
}

type Mode = 'token' | 'request' | 'confirmed';
const mode = ref<Mode>('token');

// Token mode
const token = ref('');
const tokenError = ref('');
const tokenLoading = ref(false);

// Request mode
const reqName = ref('');
const reqEmail = ref('');
const reqMessage = ref('');
const reqError = ref('');
const reqLoading = ref(false);

// E2E bypass (same pattern as TrustDeviceModal)
onMounted(() => {
  if (import.meta.env.DEV && sessionStorage.getItem('e2e_auto_auth') === 'true') {
    emit('unlocked');
  }
});

async function handleUnlock() {
  tokenError.value = '';
  if (!token.value.trim()) {
    tokenError.value = t('inviteGate.tokenRequired');
    return;
  }

  tokenLoading.value = true;
  try {
    const valid = await validateInviteToken(token.value);
    if (valid) {
      emit('unlocked');
    } else {
      tokenError.value = t('inviteGate.tokenInvalid');
    }
  } finally {
    tokenLoading.value = false;
  }
}

async function handleRequest() {
  reqError.value = '';

  if (!reqName.value.trim() || !reqEmail.value.trim()) {
    reqError.value = t('inviteGate.fieldsRequired');
    return;
  }
  if (!isValidEmail(reqEmail.value)) {
    reqError.value = t('inviteGate.emailInvalid');
    return;
  }

  const webhookUrl = import.meta.env.VITE_INVITE_WEBHOOK_URL;
  if (!webhookUrl) {
    reqError.value = t('inviteGate.requestError');
    return;
  }

  reqLoading.value = true;
  try {
    // Slack webhooks don't support CORS, so use no-cors mode.
    // The response is opaque (status 0), but the request goes through.
    await fetch(webhookUrl, {
      method: 'POST',
      mode: 'no-cors',
      body: JSON.stringify({
        text: `*New Invite Request*\n*Name:* ${reqName.value.trim()}\n*Email:* ${reqEmail.value.trim()}${reqMessage.value.trim() ? `\n*Message:* ${reqMessage.value.trim()}` : ''}`,
      }),
    });
    // Funnel conversion via the email/Slack fallback path.
    recordInviteRequest('message');
    mode.value = 'confirmed';
  } catch (err) {
    console.warn('[inviteGate] Slack request webhook POST failed', err);
    reqError.value = t('inviteGate.requestError');
  } finally {
    reqLoading.value = false;
  }
}
</script>

<template>
  <div
    class="absolute inset-0 z-10 flex items-center justify-center bg-white/80 backdrop-blur-sm dark:bg-slate-900/80"
  >
    <div class="relative w-full max-w-sm rounded-3xl bg-white p-6 shadow-xl dark:bg-slate-800">
      <!-- Close button — returns the user to the create/join chooser. Always
           visible across all modes (token / request / confirmed) so they
           can never get trapped in the gate. -->
      <button
        type="button"
        class="absolute top-3 right-3 rounded-xl p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:text-gray-500 dark:hover:bg-slate-700 dark:hover:text-gray-300"
        :aria-label="t('action.close')"
        data-testid="invite-gate-close"
        @click="emit('cancel')"
      >
        <BeanieIcon name="close" size="md" />
      </button>
      <!-- Token mode -->
      <template v-if="mode === 'token'">
        <img
          src="/brand/beanies_family_icon_transparent_384x384.png"
          :alt="t('login.beaniesFamilyIconAlt')"
          class="mx-auto mb-3 h-28 w-28"
        />
        <h2 class="font-outfit mb-1 text-center text-xl font-bold text-gray-900 dark:text-gray-100">
          {{ t('inviteGate.title') }}
        </h2>
        <p class="mb-4 text-center text-sm text-gray-500 dark:text-gray-400">
          {{ t('inviteGate.description') }}
        </p>

        <BaseInput
          v-model="token"
          :label="t('inviteGate.tokenLabel')"
          :placeholder="t('inviteGate.tokenPlaceholder')"
          :error="tokenError"
          @keyup.enter="handleUnlock"
        />

        <BaseButton
          class="mt-4 w-full"
          :loading="tokenLoading"
          :disabled="!token.trim()"
          @click="handleUnlock"
        >
          {{ t('inviteGate.unlock') }}
        </BaseButton>

        <!-- No-token path (always shown, faithful to the mockup). Discord is the
             primary "request an invite" CTA (no email needed); "send us a
             message" is the secondary email/Slack fallback. The actual Slack
             POST guards a missing webhook at submit time (handleRequest), so the
             link is never hidden behind an env var. -->
        <div
          class="font-outfit mt-5 mb-3 flex items-center gap-3 text-xs font-semibold tracking-wide text-gray-400 dark:text-gray-500"
        >
          <span class="h-px flex-1 bg-gray-200 dark:bg-slate-700"></span>
          {{ t('inviteGate.notInvitedYet') }}
          <span class="h-px flex-1 bg-gray-200 dark:bg-slate-700"></span>
        </div>

        <InviteDiscordButton
          :label="t('inviteGate.requestOnDiscord')"
          data-testid="invite-gate-discord"
          @click="handleRequestOnDiscord"
        />
        <p class="mt-2 text-center text-xs text-gray-400 dark:text-gray-500">
          {{ t('inviteGate.discordHint') }}
        </p>

        <p class="mt-3 text-center text-sm text-gray-400 dark:text-gray-500">
          {{ t('inviteGate.noDiscord') }}
          <button
            class="text-primary-500 hover:text-primary-600 font-medium"
            @click="openMessageFallback"
          >
            {{ t('inviteGate.sendMessage') }}
          </button>
        </p>
      </template>

      <!-- Request mode -->
      <template v-else-if="mode === 'request'">
        <h2 class="font-outfit mb-1 text-xl font-bold text-gray-900 dark:text-gray-100">
          {{ t('inviteGate.requestTitle') }}
        </h2>
        <p class="mb-4 text-sm text-gray-500 dark:text-gray-400">
          {{ t('inviteGate.requestDescription') }}
        </p>

        <div class="space-y-3">
          <BaseInput
            v-model="reqName"
            :label="t('inviteGate.nameLabel')"
            :placeholder="t('inviteGate.namePlaceholder')"
            required
          />
          <BaseInput
            v-model="reqEmail"
            type="email"
            :label="t('inviteGate.emailLabel')"
            :placeholder="t('inviteGate.emailPlaceholder')"
            required
          />
          <BaseInput
            v-model="reqMessage"
            :label="t('inviteGate.messageLabel')"
            :placeholder="t('inviteGate.messagePlaceholder')"
          />
        </div>

        <p v-if="reqError" class="mt-2 text-sm text-red-600 dark:text-red-400">
          {{ reqError }}
        </p>

        <BaseButton
          class="mt-4 w-full"
          :loading="reqLoading"
          :disabled="!reqName.trim() || !reqEmail.trim()"
          @click="handleRequest"
        >
          {{ t('inviteGate.sendRequest') }}
        </BaseButton>

        <div
          class="mt-3 flex items-start gap-2 rounded-xl bg-sky-50 p-3 text-xs leading-relaxed text-gray-500 dark:bg-sky-900/20 dark:text-gray-400"
        >
          <span aria-hidden="true">🔒</span>
          <span>{{ t('inviteGate.privacyNote') }}</span>
        </div>

        <div class="mt-3 space-y-1 text-center">
          <p>
            <button
              class="text-primary-500 hover:text-primary-600 text-sm font-medium"
              @click="handleRequestOnDiscord"
            >
              {{ t('inviteGate.askOnDiscordInstead') }}
            </button>
          </p>
          <p>
            <button
              class="text-sm text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300"
              @click="mode = 'token'"
            >
              {{ t('inviteGate.haveToken') }}
            </button>
          </p>
        </div>
      </template>

      <!-- Confirmed mode -->
      <template v-else>
        <div class="py-4 text-center">
          <p class="mb-2 text-3xl">🫘</p>
          <h2 class="font-outfit mb-2 text-xl font-bold text-gray-900 dark:text-gray-100">
            {{ t('inviteGate.confirmedTitle') }}
          </h2>
          <p class="mb-6 text-sm text-gray-500 dark:text-gray-400">
            {{ t('inviteGate.confirmedDescription') }}
          </p>
          <InviteDiscordButton
            class="mb-2"
            :label="t('inviteGate.confirmedJoinDiscord')"
            @click="joinDiscordOnly"
          />
          <BaseButton variant="secondary" class="w-full" @click="goToMarketingHome">
            {{ t('inviteGate.backToHome') }}
          </BaseButton>
        </div>
      </template>
    </div>
  </div>
</template>
