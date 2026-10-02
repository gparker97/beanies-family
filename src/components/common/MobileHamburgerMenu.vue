<script setup lang="ts">
import { computed, ref, toRef, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import AppNavMenu from '@/components/common/AppNavMenu.vue';
import BeanieAvatar from '@/components/ui/BeanieAvatar.vue';
import CloudProviderBadge from '@/components/ui/CloudProviderBadge.vue';
import SaveStatusIndicator from '@/components/ui/SaveStatusIndicator.vue';
import { useFullscreenOverlay } from '@/composables/useFullscreenOverlay';
import { useMemberAvatar } from '@/composables/useMemberAvatar';
import { useScrollOverflow } from '@/composables/useScrollOverflow';
import { usePrivacyMode } from '@/composables/usePrivacyMode';
import { useSounds } from '@/composables/useSounds';
import { useTranslation } from '@/composables/useTranslation';
import { useSignOut } from '@/composables/useSignOut';
import { getProductVersionLabel } from '@/utils/diagnosticContext';
import { getCurrencyInfo } from '@/constants/currencies';
import { LANGUAGES } from '@/constants/languages';
import { useAuthStore } from '@/stores/authStore';
import { useFamilyStore } from '@/stores/familyStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useSyncStore } from '@/stores/syncStore';
import { useTranslationStore } from '@/stores/translationStore';
import { useLanguageSwitcher } from '@/composables/useLanguageSwitcher';
import type { CurrencyCode, LanguageCode } from '@/types/models';

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ close: [] }>();

const panel = ref<HTMLElement | null>(null);
const { canScroll } = useScrollOverflow(panel);

const route = useRoute();
const router = useRouter();
const { t } = useTranslation();
/** Friendly product version (e.g. "v0.9"); bumped per release in constants/appVersion.ts. */
const productVersionLabel = getProductVersionLabel();
const authStore = useAuthStore();
const familyStore = useFamilyStore();
const settingsStore = useSettingsStore();
const syncStore = useSyncStore();
const translationStore = useTranslationStore();
const { switchLanguage } = useLanguageSwitcher();
const { isUnlocked, toggle: togglePrivacy } = usePrivacyMode();
const { playBlink } = useSounds();

const ownerRef = computed(() => familyStore.owner ?? null);
const { variant: ownerVariant, color: ownerColor } = useMemberAvatar(ownerRef);

function close() {
  emit('close');
}

function handlePrivacyToggle() {
  togglePrivacy();
  playBlink();
}

function handleSwitchMember() {
  close();
  // Tier 1: member-only — the pod stays open, no store resets, no Google anything.
  authStore.switchMember();
  router.replace('/login');
}

// Sign-out opens the ONE shared confirm (2026-09-23): the same confirm, trust tick,
// recovery-kit guard and progress overlay as desktop, rendered once by SignOutHost. Mobile
// used to sign out with no confirm at all, so the keep-or-wipe choice was invisible here.
const { requestSignOut } = useSignOut();

function handleSignOut() {
  close();
  requestSignOut();
}

function selectLanguage(code: LanguageCode) {
  // Fire-and-forget via the composable. DO NOT add `await` back — see
  // docs/plans/2026-04-30-language-switcher-freeze.md.
  switchLanguage(code);
}

async function selectCurrency(code: CurrencyCode) {
  await settingsStore.setDisplayCurrency(code);
}

useFullscreenOverlay(toRef(props, 'open'), close);

// Close on route change
watch(() => route.path, close);

const encryptionLabel = computed(() => {
  if (!syncStore.isConfigured) return t('sidebar.noDataFile');
  return t('sidebar.dataEncrypted');
});
</script>

<template>
  <Teleport to="body">
    <Transition
      enter-active-class="transition-opacity duration-200"
      enter-from-class="opacity-0"
      enter-to-class="opacity-100"
      leave-active-class="transition-opacity duration-200"
      leave-from-class="opacity-100"
      leave-to-class="opacity-0"
    >
      <div v-if="open" class="fixed inset-0 z-50">
        <!-- Backdrop -->
        <div class="absolute inset-0 bg-black/50" @click="close" />

        <!-- Menu panel -->
        <Transition
          enter-active-class="transition-transform duration-250 ease-out"
          enter-from-class="-translate-x-full"
          enter-to-class="translate-x-0"
          leave-active-class="transition-transform duration-200 ease-in"
          leave-from-class="translate-x-0"
          leave-to-class="-translate-x-full"
        >
          <div
            v-if="open"
            ref="panel"
            class="bg-secondary-500 quiet-scroll absolute inset-y-0 left-0 flex w-80 flex-col"
            :class="{ 'can-scroll': canScroll }"
          >
            <!-- Close button -->
            <button
              type="button"
              class="absolute right-3 flex h-9 w-9 cursor-pointer items-center justify-center rounded-xl text-white/50 transition-colors hover:bg-white/10 hover:text-white"
              :aria-label="t('mobile.closeMenu')"
              :style="{
                // The drawer is `inset-y-0`, so a bare `top-3` (12px) puts this
                // under the ~47-59px iOS status bar and out of reach. `absolute`
                // ignores the parent's padding, so the inset belongs here rather
                // than on the drawer. 0 on web — no visual change there.
                top: 'calc(0.75rem + env(safe-area-inset-top, 0px))',
              }"
              @click="close"
            >
              <svg
                class="h-5 w-5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                stroke-width="1.75"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>

            <!-- Logo -->
            <div class="flex items-center gap-3 px-5 pt-5 pb-2">
              <div
                class="flex h-[42px] w-[42px] flex-shrink-0 items-center justify-center rounded-full bg-white"
              >
                <img
                  src="/brand/beanies_logo_transparent_logo_only_192x192.png"
                  alt="beanies.family"
                  class="h-[30px] w-[30px] object-contain"
                />
              </div>
              <div class="min-w-0">
                <h1 class="font-outfit text-base leading-tight font-bold">
                  <span class="text-white">beanies</span
                  ><span class="text-primary-500">.family</span>
                </h1>
                <p
                  class="font-outfit mt-0.5 text-[0.5rem] font-light tracking-[0.06em] text-white/25 italic"
                >
                  {{ t('app.tagline') }}
                </p>
              </div>
            </div>

            <!-- Controls section -->
            <div class="mx-4 mt-3 space-y-2 rounded-2xl bg-white/[0.04] p-3">
              <p class="text-xs font-semibold tracking-wider text-white/30 uppercase">
                {{ t('mobile.controls') }}
              </p>

              <!-- Privacy toggle -->
              <button
                type="button"
                class="flex w-full cursor-pointer items-center gap-2.5 rounded-xl px-1 py-1 transition-colors hover:bg-white/[0.05]"
                @click="handlePrivacyToggle"
              >
                <img
                  v-if="isUnlocked"
                  src="/brand/beanies_open_eyes_transparent_512x512.png"
                  :alt="t('header.financialFiguresVisible')"
                  class="h-6 w-6"
                />
                <img
                  v-else
                  src="/brand/beanies_covering_eyes_transparent_512x512.png"
                  :alt="t('header.financialFiguresHidden')"
                  class="h-6 w-6"
                />
                <span class="text-xs text-white/60">
                  {{
                    isUnlocked ? t('header.showFinancialFigures') : t('header.hideFinancialFigures')
                  }}
                </span>
                <span v-if="isUnlocked" class="ml-auto h-2 w-2 rounded-full bg-[#27AE60]" />
              </button>

              <!-- Language selector — never disabled. The switcher must
                   stay clickable so the user can flip back at any time,
                   even while a previous load's API backfill is still in
                   flight. The translationStore handles cancellation
                   internally via activeLoadToken; the UI only shows a
                   small spinner on the actively-loading flag for visual
                   feedback. See docs/plans/2026-04-30-language-switcher-freeze.md. -->
              <div class="flex items-center gap-2">
                <button
                  v-for="lang in LANGUAGES"
                  :key="lang.code"
                  type="button"
                  class="flex cursor-pointer items-center gap-1.5 rounded-lg px-2 py-1 text-xs transition-colors"
                  :class="
                    lang.code === settingsStore.language
                      ? 'bg-primary-500/20 text-white'
                      : 'text-white/40 hover:bg-white/[0.05] hover:text-white/60'
                  "
                  @click="selectLanguage(lang.code)"
                >
                  <!-- Loading spinner on active language -->
                  <svg
                    v-if="translationStore.isLoading && lang.code === settingsStore.language"
                    class="text-primary-500 h-4 w-4 animate-spin"
                    viewBox="0 0 24 24"
                    fill="none"
                  >
                    <circle
                      class="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      stroke-width="4"
                    />
                    <path
                      class="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                    />
                  </svg>
                  <template v-else>
                    <img
                      v-if="lang.flagIcon"
                      :src="lang.flagIcon"
                      :alt="lang.name"
                      class="h-4 w-5 rounded-sm object-cover"
                    />
                    <span v-else class="text-sm">{{ lang.flag }}</span>
                  </template>
                  <span>{{ lang.nativeName }}</span>
                </button>
              </div>

              <!-- Currency selector (chips) -->
              <div class="flex flex-wrap items-center gap-1">
                <button
                  v-for="code in settingsStore.effectiveDisplayCurrencies"
                  :key="code"
                  type="button"
                  class="font-outfit cursor-pointer rounded-full px-2.5 py-1 text-xs font-semibold transition-all"
                  :class="
                    code === settingsStore.displayCurrency
                      ? 'bg-primary-500 text-white'
                      : 'text-white/40 hover:text-white/60'
                  "
                  @click="selectCurrency(code)"
                >
                  {{ getCurrencyInfo(code)?.symbol || '' }} {{ code }}
                </button>
              </div>
            </div>

            <!-- Divider -->
            <div class="mx-5 my-3 h-px bg-white/[0.08]" />

            <!-- Accordion Navigation -->
            <!-- Navigation: accordion sections + pinned footer (shared with the sidebar) -->
            <AppNavMenu density="drawer" class="flex-1 space-y-1 px-4" @select="close" />

            <!-- Footer: security indicators -->
            <div class="mt-auto space-y-1 px-5 pt-3 pb-6">
              <!-- User profile -->
              <div
                v-if="familyStore.owner"
                class="mb-3 flex items-center gap-2.5 rounded-2xl bg-white/[0.04] p-3"
              >
                <BeanieAvatar :variant="ownerVariant" :color="ownerColor" size="md" />
                <div class="min-w-0">
                  <p class="font-outfit truncate text-sm font-semibold text-white">
                    {{ familyStore.owner.name }}
                  </p>
                  <p class="truncate text-xs text-white/35">
                    {{
                      familyStore.owner.role === 'owner'
                        ? t('family.role.owner')
                        : familyStore.owner.role
                    }}
                  </p>
                </div>
              </div>

              <!-- Save status -->
              <SaveStatusIndicator />

              <!-- Encryption status -->
              <div class="flex items-center gap-1.5">
                <svg
                  class="h-3 w-3 flex-shrink-0"
                  :class="syncStore.isConfigured ? 'text-[#6EE7B7]/30' : 'text-white/30'"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  stroke-width="1.5"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                  <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                </svg>
                <span class="text-xs text-white/30">{{ encryptionLabel }}</span>
              </div>

              <!-- File name -->
              <CloudProviderBadge
                v-if="syncStore.isConfigured && syncStore.fileName"
                :provider-type="syncStore.storageProviderType"
                :file-name="syncStore.fileName"
                :account-email="syncStore.providerAccountEmail"
                size="xs"
                variant="dark"
              />

              <!-- Sign out buttons -->
              <div class="space-y-1">
                <button
                  type="button"
                  class="flex w-full cursor-pointer items-center gap-2 rounded-xl px-2 py-2 text-sm text-white/80 transition-colors hover:bg-white/[0.05]"
                  @click="handleSwitchMember"
                >
                  {{ t('auth.switchMember') }}
                </button>
                <button
                  type="button"
                  class="flex w-full cursor-pointer items-center gap-2 rounded-xl px-2 py-2 text-sm text-red-400 transition-colors hover:bg-white/[0.05]"
                  @click="handleSignOut"
                >
                  {{ t('auth.signOut') }}
                </button>
                <!-- The clear-data option (with its explanation) now lives on the shared sign-out
                     confirm, on every device, whatever its trust state (2026-09-23). -->
              </div>

              <!-- Version -->
              <p class="text-xs text-white/20">{{ productVersionLabel }}</p>
            </div>
          </div>
        </Transition>
      </div>
    </Transition>
  </Teleport>
</template>
