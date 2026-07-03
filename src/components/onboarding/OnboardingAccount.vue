<script setup lang="ts">
import { ref, computed } from 'vue';
import OnboardingStepHeader from './OnboardingStepHeader.vue';
import OnboardingStepShell from './OnboardingStepShell.vue';
import OnboardingAddedRow from './OnboardingAddedRow.vue';
import FrequencyChips from '@/components/ui/FrequencyChips.vue';
import FamilyChipPicker from '@/components/ui/FamilyChipPicker.vue';
import CurrencyAmountInput from '@/components/ui/CurrencyAmountInput.vue';
import { BaseCombobox } from '@/components/ui';
import InfoHintBadge from '@/components/ui/InfoHintBadge.vue';
import { MARKETING_URL } from '@/utils/marketing';
import { showToast } from '@/composables/useToast';
import { useSettingsStore } from '@/stores/settingsStore';
import { useFamilyStore } from '@/stores/familyStore';
import { useAccountsStore } from '@/stores/accountsStore';
import { useTranslation } from '@/composables/useTranslation';
import { useInstitutionOptions } from '@/composables/useInstitutionOptions';
import { OTHER_INSTITUTION_VALUE } from '@/constants/institutions';
import { ErrorSurfaces } from './errorSurfaces';
import type { CurrencyCode } from '@/types/models';

defineEmits<{
  next: [];
  back: [];
}>();

const { t } = useTranslation();
const settingsStore = useSettingsStore();
const familyStore = useFamilyStore();
const accountsStore = useAccountsStore();
const { options: institutionOptions } = useInstitutionOptions();

// Zero-knowledge help article lives on the marketing apex (origin-isolated from
// the app), so the link must be absolute — a relative /help/... would 404 here.
const zkHelpUrl = `${MARKETING_URL}/help/security/zero-knowledge-architecture`;

const accountTypeOptions = computed(() => [
  { value: 'checking', label: t('onboarding.accountType.checking'), icon: '\u{1F3E6}' },
  { value: 'savings', label: t('onboarding.accountType.savings'), icon: '\u{1F4B0}' },
  { value: 'investment', label: t('onboarding.accountType.investment'), icon: '\u{1F4C8}' },
]);

const accountType = ref('checking');
const bankInstitution = ref<string | undefined>(undefined);
const accountBalance = ref<number | undefined>(undefined);
const accountCurrency = ref<string>(settingsStore.baseCurrency);
const accountAdded = ref(false);
/**
 * Account owner — single-select. Defaults to the wizard owner (the person
 * setting up the pod). Only renders the picker when there's >1 human, since
 * a 1-human family has no choice to make.
 */
const accountOwnerId = ref<string>(familyStore.owner?.id || '');
const addedAccounts = ref<
  { id: string; name: string; type: string; balance: number; currency: string }[]
>([]);

/** Auto-generated account name: "Mary Lynn's OCBC Checking" — uses the SELECTED
 *  owner's full name so compound first names ("Mary Lynn", "Anne Marie") render
 *  correctly. Updates reactively when the user picks a different bean. */
const generatedAccountName = computed(() => {
  const owner = familyStore.members.find((m) => m.id === accountOwnerId.value);
  const ownerName = owner?.name?.trim() || '';
  const bank = bankInstitution.value || '';
  const typeLabel =
    accountTypeOptions.value.find((o) => o.value === accountType.value)?.label || '';
  const parts = [ownerName ? `${ownerName}'s` : '', bank, typeLabel].filter(Boolean);
  return parts.join(' ') || typeLabel || 'Account';
});

const canAddAccount = computed(() => bankInstitution.value);

async function handleAddAccount() {
  if (!canAddAccount.value) return;
  const memberId = accountOwnerId.value || familyStore.owner?.id;
  if (!memberId) return;

  const name = generatedAccountName.value;
  try {
    const account = await accountsStore.createAccount({
      memberId,
      name,
      type: accountType.value as 'checking' | 'savings' | 'investment',
      currency: accountCurrency.value as CurrencyCode,
      balance: accountBalance.value || 0,
      institution: bankInstitution.value,
      isActive: true,
      includeInNetWorth: true,
    });
    if (!account) throw new Error('createAccount returned null');

    addedAccounts.value.push({
      id: account.id,
      name,
      type: accountType.value,
      balance: accountBalance.value || 0,
      currency: accountCurrency.value,
    });
    accountAdded.value = true;
  } catch (e) {
    showToast('error', t('onboarding.errors.addAccountFailed'), undefined, {
      surface: ErrorSurfaces.onboardingAddAccount,
      error: e,
      context: { accountType: accountType.value, currency: accountCurrency.value },
    });
  }
}

function handleAddAnother() {
  accountBalance.value = undefined;
  bankInstitution.value = undefined;
  accountType.value = 'checking';
  accountOwnerId.value = familyStore.owner?.id || '';
  accountAdded.value = false;
}

async function handleRemoveAccount(accountId: string) {
  try {
    await accountsStore.deleteAccount(accountId);
    addedAccounts.value = addedAccounts.value.filter((a) => a.id !== accountId);
    // If the user removed everything they'd added, drop back to the entry form.
    if (addedAccounts.value.length === 0) accountAdded.value = false;
  } catch (e) {
    showToast('error', t('onboarding.errors.addAccountFailed'), undefined, {
      surface: ErrorSurfaces.onboardingAddAccount,
      error: e,
      context: { action: 'remove' },
    });
  }
}

function formatBalanceMeta(currency: string, balance: number): string {
  return `${currency} ${balance.toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
}
</script>

<template>
  <OnboardingStepShell>
    <template #decorations>
      <div class="ob-float-emoji" style="font-size: 1.5rem; left: 40px; top: 40px">💰</div>
      <div
        class="ob-float-emoji"
        style="animation-delay: 1s; font-size: 1.25rem; right: 50px; top: 130px"
      >
        🐷
      </div>
      <div
        class="ob-float-emoji"
        style="animation-delay: 0.5s; bottom: 100px; font-size: 1.375rem; left: 60px"
      >
        🏦
      </div>
    </template>

    <OnboardingStepHeader
      icon="🐷"
      title-prefix-key="onboarding.account.titlePrefix"
      title-highlight-key="onboarding.account.titleHighlight"
      :current-step="2"
      :total-steps="6"
    />

    <!-- Privacy reassurance — shown before the first financial data entry, in
         both the entry and after-add states (sits outside the v-if below). -->
    <div class="ob-privacy">
      <p class="ob-privacy-line">
        {{ t('onboarding.privacy.reassure') }}
        <strong class="ob-privacy-em">{{ t('onboarding.privacy.guaranteed') }}</strong>
      </p>
      <InfoHintBadge
        :trigger-label="t('onboarding.privacy.how')"
        :items="[
          t('onboarding.privacy.proof1'),
          t('onboarding.privacy.proof2'),
          t('onboarding.privacy.proof3'),
        ]"
        :link="{ text: t('onboarding.privacy.learnMore'), href: zkHelpUrl }"
      />
    </div>

    <div class="ob-section">
      <!-- Already-added rows — always visible above the entry form so the
           user can remove a mistake without leaving the step. -->
      <div v-if="addedAccounts.length > 0" class="ob-added-list mb-3">
        <OnboardingAddedRow
          v-for="acc in addedAccounts"
          :key="acc.id"
          icon="🏦"
          :title="acc.name"
          :meta="formatBalanceMeta(acc.currency, acc.balance)"
          :tag="acc.type"
          removable
          @remove="handleRemoveAccount(acc.id)"
        />
      </div>

      <template v-if="!accountAdded">
        <!-- Who owns it — only shown when there's more than one human.
             Single-select chip picker; default is the wizard owner. The
             auto-name preview at the bottom updates reactively as the user
             picks a different bean. -->
        <div v-if="familyStore.humans.length > 1" class="mb-3">
          <div class="ob-detail-label">{{ t('onboarding.assignee') }}</div>
          <FamilyChipPicker v-model="accountOwnerId" mode="single" compact />
        </div>

        <!-- Bank + Balance grid (easiest-to-answer first) -->
        <div class="ob-account-grid" style="margin-bottom: 14px">
          <div class="ob-bank-combo" data-testid="onboarding-bank-select">
            <BaseCombobox
              :model-value="bankInstitution ?? ''"
              :options="institutionOptions"
              :label="t('onboarding.bank')"
              :placeholder="t('onboarding.bankPlaceholder')"
              :search-placeholder="t('form.searchInstitutions')"
              :other-value="OTHER_INSTITUTION_VALUE"
              :other-label="t('form.other')"
              :other-placeholder="t('form.enterCustomName')"
              @update:model-value="bankInstitution = $event || undefined"
            />
          </div>
          <div>
            <div class="ob-label">{{ t('onboarding.balance') }}</div>
            <CurrencyAmountInput
              :amount="accountBalance"
              :currency="accountCurrency"
              font-size="0.85rem"
              @update:amount="accountBalance = $event"
              @update:currency="accountCurrency = $event"
            />
          </div>
        </div>

        <!-- Type chips below — sit just above the auto-name preview so the
             generated name responds visually to the chip the user just tapped. -->
        <div class="mb-3">
          <div class="ob-detail-label">{{ t('onboarding.accountType') }}</div>
          <FrequencyChips v-model="accountType" :options="accountTypeOptions" />
        </div>

        <!-- Auto-generated name preview (faded 35%) + Add pill -->
        <div class="mt-2.5 flex items-center justify-between">
          <div
            v-if="bankInstitution"
            class="font-heading truncate text-xs font-semibold opacity-35"
          >
            {{ generatedAccountName }}
          </div>
          <div v-else />
          <button
            class="ob-add-pill"
            :disabled="!canAddAccount"
            data-testid="onboarding-add-account"
            @click="handleAddAccount"
          >
            {{ t('onboarding.addAccount') }}
          </button>
        </div>
      </template>

      <!-- After-add: just an "Add another" pill that resets the form. -->
      <div v-else class="mt-2 flex justify-end">
        <button class="ob-add-pill" @click="handleAddAnother">
          {{ t('onboarding.addAnother') }}
        </button>
      </div>
    </div>
  </OnboardingStepShell>
</template>

<style scoped>
/* Privacy reassurance block — centered line + "How?" hint, sits under the
 * step header before the account form. Solid Heritage Orange emphasis (the
 * gradient treatment is a marketing-hero device, not an in-app pattern). */
.ob-privacy {
  align-items: center;
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
  margin-bottom: 1rem;
  text-align: center;
}

.ob-privacy-line {
  color: rgb(44 62 80 / 70%);
  font-size: 0.875rem;
  margin: 0;
}

:global(.dark) .ob-privacy-line {
  color: rgb(255 255 255 / 70%);
}

.ob-privacy-em {
  color: var(--heritage-orange, #f15d22);
  font-weight: 600;
}

/* BaseCombobox trigger background overrides — moved here from
 * onboarding-shared.css (global) so Vue's scoped-style [data-v]
 * specificity boost retires the previous !important workaround.
 * Light + dark mode mirror onboarding's other input surfaces. */
.ob-bank-combo :deep([data-testid='combobox-trigger']) {
  background: white;
  border-color: rgb(44 62 80 / 8%);
  box-shadow: 0 1px 4px rgb(44 62 80 / 4%);
}

:global(.dark) .ob-bank-combo :deep([data-testid='combobox-trigger']) {
  background: #243342;
  border-color: rgb(255 255 255 / 8%);
}
</style>
