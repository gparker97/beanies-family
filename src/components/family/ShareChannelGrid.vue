<script setup lang="ts">
import { ref, computed } from 'vue';
import BeanieIcon from '@/components/ui/BeanieIcon.vue';
import { useClipboard } from '@/composables/useClipboard';
import { useTranslation } from '@/composables/useTranslation';
import { showToast } from '@/composables/useToast';

const props = defineProps<{
  /** The invite URL to copy / share via channels. */
  link: string;
  /** Family name for substitution in the share message body. */
  familyName: string;
  /** Inviter member name for substitution in the share message body. */
  memberName: string;
  /**
   * Hide the trailing "🔒 Link expires in 24 hours" line.
   * Set true when the consumer renders its own footer (e.g. the wizard).
   */
  hideExpiryNote?: boolean;
}>();

const emit = defineEmits<{
  /** Fired after a channel button is tapped (or copy on WeChat). */
  shared: [channelId: string];
}>();

const { t } = useTranslation();
const { copied, copy } = useClipboard();
const wechatHint = ref(false);

const shareBody = computed(() =>
  t('share.messageBody')
    .replace('{member}', props.memberName)
    .replace('{family}', props.familyName)
    .replace('{link}', props.link)
);

const emailSubject = computed(() => t('share.emailSubject').replace('{family}', props.familyName));

const channels = computed(() => [
  {
    id: 'whatsapp',
    label: 'WhatsApp',
    color: '#25D366',
    url: `https://wa.me/?text=${encodeURIComponent(shareBody.value)}`,
  },
  {
    id: 'telegram',
    label: 'Telegram',
    color: '#26A5E4',
    url: `https://t.me/share/url?url=${encodeURIComponent(props.link)}&text=${encodeURIComponent(shareBody.value.replace(props.link, '').trim())}`,
  },
  {
    id: 'sms',
    label: 'SMS',
    color: '#34C759',
    url: `sms:?body=${encodeURIComponent(shareBody.value)}`,
  },
  {
    id: 'messenger',
    label: 'Messenger',
    color: '#0084FF',
    url: `fb-messenger://share/?link=${encodeURIComponent(props.link)}`,
  },
  {
    id: 'wechat',
    label: 'WeChat',
    color: '#07C160',
    url: null,
  },
  {
    id: 'email',
    label: 'Email',
    color: '#6B7280',
    url: `mailto:?subject=${encodeURIComponent(emailSubject.value)}&body=${encodeURIComponent(shareBody.value)}`,
  },
]);

async function handleCopy() {
  const ok = await copy(props.link);
  if (!ok) {
    console.error('[ShareChannelGrid] clipboard write failed');
    showToast('error', t('inviteWizard.error.couldntCopy'));
    return;
  }
  emit('shared', 'copy');
}

function handleChannel(channel: (typeof channels.value)[0]) {
  if (channel.id === 'wechat') {
    // WeChat doesn't expose a share URL — copy the link and show a hint
    // so the user can paste manually.
    copy(props.link).then((ok) => {
      if (!ok) {
        console.error('[ShareChannelGrid] WeChat copy failed');
        showToast('error', t('inviteWizard.error.couldntCopy'));
        return;
      }
      wechatHint.value = true;
      emit('shared', 'wechat');
    });
    return;
  }
  if (!channel.url) return;
  try {
    const opened = window.open(channel.url, '_blank', 'noopener');
    if (opened === null) {
      // Popup blocker
      throw new Error('window.open returned null (popup blocker)');
    }
    emit('shared', channel.id);
  } catch (e) {
    console.error('[ShareChannelGrid] channel open failed', { channel: channel.id, error: e });
    showToast(
      'error',
      t('inviteWizard.error.channelOpenFailed').replace('{channel}', channel.label)
    );
  }
}
</script>

<template>
  <div class="space-y-4">
    <!-- Copy link row -->
    <button
      class="group flex w-full items-center gap-3 rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3 text-left transition-all hover:border-[var(--color-sky-silk-300)] hover:bg-[var(--tint-silk-10)] dark:border-slate-600 dark:bg-slate-700/50 dark:hover:border-[var(--color-sky-silk-300)]/40 dark:hover:bg-slate-700"
      data-testid="invite-copy-link"
      @click="handleCopy"
    >
      <div
        class="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-white shadow-sm transition-colors group-hover:bg-[var(--tint-silk-20)] dark:bg-slate-600 dark:group-hover:bg-slate-500"
      >
        <BeanieIcon
          :name="copied ? 'check' : 'copy'"
          size="md"
          class="text-gray-500 dark:text-gray-300"
        />
      </div>
      <div class="min-w-0 flex-1">
        <p class="font-outfit text-secondary-500 text-sm font-semibold dark:text-gray-200">
          {{ t('share.copyLink') }}
        </p>
        <p class="truncate text-xs text-gray-400 dark:text-gray-500">
          {{ link }}
        </p>
      </div>
      <Transition
        enter-active-class="transition-all duration-200"
        enter-from-class="opacity-0 scale-90"
        enter-to-class="opacity-100 scale-100"
        leave-active-class="transition-all duration-200"
        leave-from-class="opacity-100 scale-100"
        leave-to-class="opacity-0 scale-90"
        mode="out-in"
      >
        <span
          v-if="copied"
          class="flex-shrink-0 rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-medium text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
        >
          {{ t('login.copied') }}
        </span>
      </Transition>
    </button>

    <!-- Divider -->
    <div class="flex items-center gap-3">
      <div class="h-px flex-1 bg-gray-200 dark:bg-slate-700" />
      <span class="text-xs text-gray-400 dark:text-gray-500">{{ t('share.orShareVia') }}</span>
      <div class="h-px flex-1 bg-gray-200 dark:bg-slate-700" />
    </div>

    <!-- Social channels grid -->
    <div class="grid grid-cols-3 gap-2">
      <button
        v-for="ch in channels"
        :key="ch.id"
        class="group flex flex-col items-center gap-1.5 rounded-2xl p-2.5 transition-all hover:bg-gray-50 active:scale-95 dark:hover:bg-slate-700/50"
        :data-testid="`invite-channel-${ch.id}`"
        @click="handleChannel(ch)"
      >
        <!-- Brand-colored icon circle (15% tint per CIG icon-container rule) -->
        <div
          class="flex h-11 w-11 items-center justify-center rounded-full shadow-sm transition-transform group-hover:scale-110"
          :style="{ backgroundColor: ch.color + '15' }"
        >
          <!-- WhatsApp -->
          <svg v-if="ch.id === 'whatsapp'" class="h-5 w-5" viewBox="0 0 24 24" fill="none">
            <path
              d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"
              :fill="ch.color"
            />
            <path
              d="M12 2C6.477 2 2 6.477 2 12c0 1.89.525 3.66 1.438 5.168L2 22l4.832-1.438A9.955 9.955 0 0012 22c5.523 0 10-4.477 10-10S17.523 2 12 2zm0 18a7.96 7.96 0 01-4.113-1.14l-.287-.172-2.6.772.772-2.6-.172-.287A7.963 7.963 0 014 12c0-4.411 3.589-8 8-8s8 3.589 8 8-3.589 8-8 8z"
              :fill="ch.color"
            />
          </svg>

          <!-- Telegram -->
          <svg v-else-if="ch.id === 'telegram'" class="h-5 w-5" viewBox="0 0 24 24" fill="none">
            <path
              d="M20.665 3.717l-17.73 6.837c-1.21.486-1.203 1.161-.222 1.462l4.552 1.42 10.532-6.645c.498-.303.953-.14.579.192l-8.533 7.701h-.002l.002.001-.314 4.692c.46 0 .663-.211.921-.46l2.211-2.15 4.599 3.397c.848.467 1.457.227 1.668-.785l3.019-14.228c.309-1.239-.473-1.8-1.282-1.434z"
              :fill="ch.color"
            />
          </svg>

          <!-- SMS -->
          <svg v-else-if="ch.id === 'sms'" class="h-5 w-5" viewBox="0 0 24 24" fill="none">
            <path
              d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H5.17L4 17.17V4h16v12z"
              :fill="ch.color"
            />
            <path d="M7 9h2v2H7V9zm4 0h2v2h-2V9zm4 0h2v2h-2V9z" :fill="ch.color" />
          </svg>

          <!-- Messenger -->
          <svg v-else-if="ch.id === 'messenger'" class="h-5 w-5" viewBox="0 0 24 24" fill="none">
            <path
              d="M12 2C6.36 2 2 6.13 2 11.7c0 2.91 1.2 5.42 3.15 7.2.15.14.25.35.25.57l.05 1.78c.02.62.67 1.03 1.24.78l1.99-.88c.17-.07.36-.1.54-.06.93.26 1.92.4 2.78.4 5.64 0 10-4.13 10-9.7C22 6.13 17.64 2 12 2z"
              :fill="ch.color"
            />
            <path
              d="M6.53 14.25l2.68-4.25c.43-.68 1.34-.84 1.97-.36l2.13 1.6c.2.15.47.15.66 0l2.87-2.18c.38-.29.88.17.62.58l-2.68 4.25c-.43.68-1.34.84-1.97.36l-2.13-1.6a.53.53 0 00-.66 0l-2.87 2.18c-.38.29-.88-.17-.62-.58z"
              fill="white"
            />
          </svg>

          <!-- WeChat -->
          <svg v-else-if="ch.id === 'wechat'" class="h-5 w-5" viewBox="0 0 24 24" fill="none">
            <path
              d="M8.691 2.188C3.891 2.188 0 5.476 0 9.534c0 2.22 1.174 4.2 3.013 5.528l-.752 2.262 2.631-1.33c.886.258 1.845.397 2.84.397.287 0 .57-.014.85-.04a6.794 6.794 0 01-.262-1.865c0-3.582 3.233-6.49 7.222-6.49.255 0 .506.014.755.035C15.604 4.594 12.462 2.188 8.691 2.188zM5.82 5.58a1.04 1.04 0 110 2.079 1.04 1.04 0 010-2.079zm5.746 0a1.04 1.04 0 110 2.079 1.04 1.04 0 010-2.079z"
              :fill="ch.color"
              transform="translate(2 2) scale(0.833)"
            />
            <path
              d="M23.28 14.486c0-3.236-3.066-5.864-6.852-5.864-3.786 0-6.852 2.628-6.852 5.864 0 3.236 3.066 5.864 6.852 5.864.74 0 1.452-.104 2.118-.296l2.074 1.048-.593-1.784c1.463-1.054 2.253-2.592 2.253-4.832zM13.62 13.3a.806.806 0 110 1.613.806.806 0 010-1.613zm5.62 0a.806.806 0 110 1.613.806.806 0 010-1.613z"
              :fill="ch.color"
              transform="translate(2 2) scale(0.833)"
            />
          </svg>

          <!-- Email -->
          <svg
            v-else-if="ch.id === 'email'"
            class="h-5 w-5"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.75"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path
              d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"
              class="text-gray-400 dark:text-gray-500"
            />
            <polyline points="22,6 12,13 2,6" class="text-gray-400 dark:text-gray-500" />
          </svg>
        </div>

        <span class="text-xs font-medium text-gray-600 dark:text-gray-400">
          {{ ch.label }}
        </span>
      </button>
    </div>

    <!-- WeChat hint -->
    <Transition
      enter-active-class="transition-all duration-300"
      enter-from-class="opacity-0 -translate-y-1"
      enter-to-class="opacity-100 translate-y-0"
    >
      <div
        v-if="wechatHint"
        class="flex items-start gap-2.5 rounded-2xl bg-[#07C160]/8 px-4 py-3 dark:bg-[#07C160]/10"
      >
        <span class="mt-0.5 flex-shrink-0 text-sm">✅</span>
        <p class="text-xs text-gray-600 dark:text-gray-300">
          {{ t('share.wechatHint') }}
        </p>
      </div>
    </Transition>

    <!-- Expiry note (consumer can hide via prop if it renders its own footer) -->
    <p v-if="!hideExpiryNote" class="text-center text-xs text-gray-400 dark:text-gray-500">
      🔒 {{ t('family.linkExpiry') }}
    </p>
  </div>
</template>
