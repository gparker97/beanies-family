<script setup lang="ts">
import { computed } from 'vue';
import { getCategoryById } from '@/constants/categories';

interface Props {
  category: string;
  size?: 'sm' | 'md' | 'lg';
  showBackground?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  size: 'md',
  showBackground: true,
});

const categoryInfo = computed(() => getCategoryById(props.category));

const sizeClasses = computed(() => {
  switch (props.size) {
    case 'sm':
      return { container: 'w-8 h-8', icon: 'w-4 h-4' };
    case 'lg':
      return { container: 'w-12 h-12', icon: 'w-6 h-6' };
    default:
      return { container: 'w-10 h-10', icon: 'w-5 h-5' };
  }
});

const iconColor = computed(() => categoryInfo.value?.color || '#6b7280');
</script>

<template>
  <div
    :class="[
      sizeClasses.container,
      'flex flex-shrink-0 items-center justify-center rounded-lg',
      showBackground ? 'bg-opacity-15' : '',
    ]"
    :style="showBackground ? { backgroundColor: `${iconColor}20` } : {}"
  >
    <!-- Salary/Briefcase -->
    <svg
      v-if="categoryInfo?.icon === 'briefcase'"
      :class="sizeClasses.icon"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      :style="{ color: iconColor }"
    >
      <path
        stroke-linecap="round"
        stroke-linejoin="round"
        stroke-width="2"
        d="M21 13.255A23.931 23.931 0 0112 15c-3.183 0-6.22-.62-9-1.745M16 6V4a2 2 0 00-2-2h-4a2 2 0 00-2 2v2m4 6h.01M5 20h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
      />
    </svg>

    <!-- Home -->
    <svg
      v-else-if="categoryInfo?.icon === 'home'"
      :class="sizeClasses.icon"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      :style="{ color: iconColor }"
    >
      <path
        stroke-linecap="round"
        stroke-linejoin="round"
        stroke-width="2"
        d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"
      />
    </svg>

    <!-- Shopping Cart / Groceries -->
    <svg
      v-else-if="categoryInfo?.icon === 'shopping-cart'"
      :class="sizeClasses.icon"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      :style="{ color: iconColor }"
    >
      <path
        stroke-linecap="round"
        stroke-linejoin="round"
        stroke-width="2"
        d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z"
      />
    </svg>

    <!-- Utensils / Dining -->
    <svg
      v-else-if="categoryInfo?.icon === 'utensils'"
      :class="sizeClasses.icon"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      :style="{ color: iconColor }"
    >
      <path
        stroke-linecap="round"
        stroke-linejoin="round"
        stroke-width="2"
        d="M12 6v12m-3-2.818l.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
      />
    </svg>

    <!-- Car -->
    <svg
      v-else-if="categoryInfo?.icon === 'car'"
      :class="sizeClasses.icon"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      :style="{ color: iconColor }"
    >
      <path
        stroke-linecap="round"
        stroke-linejoin="round"
        stroke-width="2"
        d="M8 17h8M8 17a2 2 0 11-4 0 2 2 0 014 0zm8 0a2 2 0 104 0 2 2 0 00-4 0zM4 11l2-6h12l2 6M4 11h16M4 11v6h16v-6"
      />
    </svg>

    <!-- Credit Card -->
    <svg
      v-else-if="categoryInfo?.icon === 'credit-card'"
      :class="sizeClasses.icon"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      :style="{ color: iconColor }"
    >
      <path
        stroke-linecap="round"
        stroke-linejoin="round"
        stroke-width="2"
        d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z"
      />
    </svg>

    <!-- Zap / Utilities -->
    <svg
      v-else-if="categoryInfo?.icon === 'zap'"
      :class="sizeClasses.icon"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      :style="{ color: iconColor }"
    >
      <path
        stroke-linecap="round"
        stroke-linejoin="round"
        stroke-width="2"
        d="M13 10V3L4 14h7v7l9-11h-7z"
      />
    </svg>

    <!-- Heart / Health -->
    <svg
      v-else-if="categoryInfo?.icon === 'heart' || categoryInfo?.icon === 'activity'"
      :class="sizeClasses.icon"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      :style="{ color: iconColor }"
    >
      <path
        stroke-linecap="round"
        stroke-linejoin="round"
        stroke-width="2"
        d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z"
      />
    </svg>

    <!-- Gift -->
    <svg
      v-else-if="categoryInfo?.icon === 'gift'"
      :class="sizeClasses.icon"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      :style="{ color: iconColor }"
    >
      <path
        stroke-linecap="round"
        stroke-linejoin="round"
        stroke-width="2"
        d="M12 8v13m0-13V6a2 2 0 112 2h-2zm0 0V5.5A2.5 2.5 0 109.5 8H12zm-7 4h14M5 12a2 2 0 110-4h14a2 2 0 110 4M5 12v7a2 2 0 002 2h10a2 2 0 002-2v-7"
      />
    </svg>

    <!-- Film / Entertainment -->
    <svg
      v-else-if="categoryInfo?.icon === 'film'"
      :class="sizeClasses.icon"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      :style="{ color: iconColor }"
    >
      <path
        stroke-linecap="round"
        stroke-linejoin="round"
        stroke-width="2"
        d="M7 4v16M17 4v16M3 8h4m10 0h4M3 12h18M3 16h4m10 0h4M4 20h16a1 1 0 001-1V5a1 1 0 00-1-1H4a1 1 0 00-1 1v14a1 1 0 001 1z"
      />
    </svg>

    <!-- Book / Education -->
    <svg
      v-else-if="categoryInfo?.icon === 'book'"
      :class="sizeClasses.icon"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      :style="{ color: iconColor }"
    >
      <path
        stroke-linecap="round"
        stroke-linejoin="round"
        stroke-width="2"
        d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"
      />
    </svg>

    <!-- Trending Up / Investments -->
    <svg
      v-else-if="categoryInfo?.icon === 'trending-up'"
      :class="sizeClasses.icon"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      :style="{ color: iconColor }"
    >
      <path
        stroke-linecap="round"
        stroke-linejoin="round"
        stroke-width="2"
        d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6"
      />
    </svg>

    <!-- Dollar Sign -->
    <svg
      v-else-if="categoryInfo?.icon === 'dollar-sign'"
      :class="sizeClasses.icon"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      :style="{ color: iconColor }"
    >
      <path
        stroke-linecap="round"
        stroke-linejoin="round"
        stroke-width="2"
        d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
      />
    </svg>

    <!-- Repeat / Subscriptions -->
    <svg
      v-else-if="categoryInfo?.icon === 'repeat'"
      :class="sizeClasses.icon"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      :style="{ color: iconColor }"
    >
      <path
        stroke-linecap="round"
        stroke-linejoin="round"
        stroke-width="2"
        d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
      />
    </svg>

    <!-- Shield / Insurance -->
    <svg
      v-else-if="categoryInfo?.icon === 'shield'"
      :class="sizeClasses.icon"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      :style="{ color: iconColor }"
    >
      <path
        stroke-linecap="round"
        stroke-linejoin="round"
        stroke-width="2"
        d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
      />
    </svg>

    <!-- Users -->
    <svg
      v-else-if="categoryInfo?.icon === 'users'"
      :class="sizeClasses.icon"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      :style="{ color: iconColor }"
    >
      <path
        stroke-linecap="round"
        stroke-linejoin="round"
        stroke-width="2"
        d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z"
      />
    </svg>

    <!-- Coffee -->
    <svg
      v-else-if="categoryInfo?.icon === 'coffee'"
      :class="sizeClasses.icon"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      :style="{ color: iconColor }"
    >
      <path
        stroke-linecap="round"
        stroke-linejoin="round"
        stroke-width="2"
        d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
      />
    </svg>

    <!-- Code / Freelance -->
    <svg
      v-else-if="categoryInfo?.icon === 'code'"
      :class="sizeClasses.icon"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      :style="{ color: iconColor }"
    >
      <path
        stroke-linecap="round"
        stroke-linejoin="round"
        stroke-width="2"
        d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4"
      />
    </svg>

    <!-- Default circle icon -->
    <svg
      v-else
      :class="sizeClasses.icon"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      :style="{ color: iconColor }"
    >
      <path
        stroke-linecap="round"
        stroke-linejoin="round"
        stroke-width="2"
        d="M8 12h.01M12 12h.01M16 12h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
      />
    </svg>
  </div>
</template>
