import { computed } from 'vue';
import { INSTITUTIONS, OTHER_INSTITUTION_VALUE } from '@/constants/institutions';
import { useSettingsStore } from '@/stores/settingsStore';
import { useAccountsStore } from '@/stores/accountsStore';
import { useAssetsStore } from '@/stores/assetsStore';
import type { ComboboxOption } from '@/components/ui/BaseCombobox.vue';

export function useInstitutionOptions() {
  const settingsStore = useSettingsStore();

  const options = computed<ComboboxOption[]>(() => {
    const predefined = INSTITUTIONS.map((inst) => ({
      value: inst.name,
      label: inst.name,
      isCustom: false,
    }));

    const custom = settingsStore.customInstitutions
      .filter((name) => !INSTITUTIONS.some((i) => i.name === name))
      .map((name) => ({
        value: name,
        label: name,
        isCustom: true,
      }));

    const merged = [...predefined, ...custom].sort((a, b) => a.label.localeCompare(b.label));

    merged.push({
      value: OTHER_INSTITUTION_VALUE,
      label: 'Other',
      isCustom: false,
    });

    return merged;
  });

  async function removeCustomInstitution(name: string) {
    await settingsStore.removeCustomInstitution(name);

    // Clear institution from all accounts referencing this custom institution
    const accountsStore = useAccountsStore();
    for (const account of accountsStore.accounts) {
      if (account.institution === name) {
        await accountsStore.updateAccount(account.id, {
          institution: '',
          institutionCountry: '',
        });
      }
    }

    // Clear lender from all asset loans referencing this custom institution
    const assetsStore = useAssetsStore();
    for (const asset of assetsStore.assets) {
      if (asset.loan?.lender === name) {
        await assetsStore.updateAsset(asset.id, {
          loan: { ...asset.loan, lender: undefined, lenderCountry: undefined },
        });
      }
    }
  }

  return { options, removeCustomInstitution };
}
