<script setup lang="ts">
import { useRouter } from 'vue-router';
import NookGreeting from '@/components/nook/NookGreeting.vue';
import FamilyStatusToast from '@/components/nook/FamilyStatusToast.vue';
import NookYourBeans from '@/components/nook/NookYourBeans.vue';
import ScheduleCards from '@/components/nook/ScheduleCards.vue';
import NookTodoWidget from '@/components/nook/NookTodoWidget.vue';
import MilestonesCard from '@/components/nook/MilestonesCard.vue';
import PiggyBankCard from '@/components/nook/PiggyBankCard.vue';
import RecentActivityCard from '@/components/nook/RecentActivityCard.vue';

const router = useRouter();
</script>

<template>
  <div class="space-y-6">
    <!-- Greeting header -->
    <NookGreeting />

    <!-- Status toast -->
    <FamilyStatusToast />

    <!-- Your Beans row -->
    <NookYourBeans
      @add-member="router.push({ path: '/family', query: { add: 'true' } })"
      @select-member="(id: string) => router.push({ path: '/family', query: { edit: id } })"
    />

    <!-- Today's Schedule + This Week -->
    <ScheduleCards />

    <!-- Todo widget (full width) -->
    <NookTodoWidget />

    <!-- Milestones + Piggy Bank -->
    <div class="grid grid-cols-1 gap-5 lg:grid-cols-2">
      <MilestonesCard />
      <PiggyBankCard />
    </div>

    <!-- Recent Activity (full width) -->
    <RecentActivityCard />
  </div>
</template>
