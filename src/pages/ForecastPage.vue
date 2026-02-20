<script setup lang="ts">
import { BaseCard } from '@/components/ui';
import BeanieIcon from '@/components/ui/BeanieIcon.vue';
import PageHeader from '@/components/common/PageHeader.vue';
import { useTranslation } from '@/composables/useTranslation';

const { t } = useTranslation();
</script>

<template>
  <div class="space-y-6">
    <PageHeader
      icon="trending-up"
      :title="t('forecast.title')"
      subtitle="Plan for the future with financial projections"
    />

    <BaseCard title="Financial Forecasting">
      <div class="py-12 text-center text-gray-500 dark:text-gray-400">
        <BeanieIcon
          name="trending-up"
          size="xl"
          class="animate-beanie-float mx-auto mb-4 h-16 w-16 text-gray-400"
        />
        <p class="text-lg font-medium">Forecasting Coming Soon</p>
        <p class="mt-2">
          Cash flow projections and scenario planning will be available in a future update.
        </p>
        <ul class="mx-auto mt-4 max-w-md space-y-2 text-left">
          <li class="flex items-center gap-2">
            <BeanieIcon name="check-circle" size="md" class="text-primary-500" />
            Recurring transaction projections
          </li>
          <li class="flex items-center gap-2">
            <BeanieIcon name="check-circle" size="md" class="text-primary-500" />
            Cash flow forecast (3/6/12 months)
          </li>
          <li class="flex items-center gap-2">
            <BeanieIcon name="check-circle" size="md" class="text-primary-500" />
            Goal achievement projections
          </li>
          <li class="flex items-center gap-2">
            <BeanieIcon name="check-circle" size="md" class="text-primary-500" />
            "What if" scenario simulation
          </li>
        </ul>
      </div>
    </BaseCard>
  </div>
</template>
