<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useTranslation } from '@/composables/useTranslation';

const { t } = useTranslation();

type Status = 'pending' | 'just-done' | 'already' | 'unavailable';

const status = ref<Status>('pending');

onMounted(() => {
  try {
    const already = localStorage.getItem('plausible_ignore') === 'true';
    if (already) {
      status.value = 'already';
    } else {
      localStorage.setItem('plausible_ignore', 'true');
      status.value = 'just-done';
    }
  } catch {
    status.value = 'unavailable';
  }
});
</script>

<template>
  <main class="exclude-page">
    <div class="card">
      <div class="emoji" aria-hidden="true">
        {{
          status === 'just-done'
            ? '🙈'
            : status === 'already'
              ? '✅'
              : status === 'unavailable'
                ? '⚠️'
                : '🫘'
        }}
      </div>
      <h1>
        {{
          status === 'just-done'
            ? t('plausibleExclude.title.justDone')
            : status === 'already'
              ? t('plausibleExclude.title.already')
              : status === 'unavailable'
                ? t('plausibleExclude.title.unavailable')
                : t('plausibleExclude.title.checking')
        }}
      </h1>
      <p v-if="status === 'just-done'">
        {{ t('plausibleExclude.body.justDone') }}
        <a href="/">{{ t('plausibleExclude.backToApp') }}</a>
      </p>
      <p v-else-if="status === 'already'">
        {{ t('plausibleExclude.body.already') }}
      </p>
      <p v-else-if="status === 'unavailable'">
        {{ t('plausibleExclude.body.unavailable') }}
      </p>
      <div v-if="status !== 'pending'" class="status" :class="`status-${status}`">
        {{
          status === 'just-done'
            ? t('plausibleExclude.status.justDone')
            : status === 'already'
              ? t('plausibleExclude.status.already')
              : t('plausibleExclude.status.failed')
        }}
      </div>
    </div>
  </main>
</template>

<style scoped>
.exclude-page {
  align-items: center;
  background: #f8f9fa;
  color: #2c3e50;
  display: flex;
  font-family: Outfit, sans-serif;
  justify-content: center;
  margin: 0;
  min-height: 100vh;
  padding: 24px;
  text-align: center;
}

.card {
  background: white;
  border-radius: 24px;
  box-shadow: 0 4px 20px rgb(44 62 80 / 5%);
  max-width: 400px;
  padding: 40px 32px;
}

.emoji {
  font-size: 3rem;
  margin-bottom: 16px;
}

h1 {
  font-size: 1.25rem;
  font-weight: 700;
  margin: 0 0 8px;
}

p {
  color: #64748b;
  font-size: 0.875rem;
  line-height: 1.6;
  margin: 0 0 20px;
}

a {
  color: #f15d22;
  text-decoration: none;
}

a:hover {
  text-decoration: underline;
}

.status {
  border-radius: 12px;
  font-size: 0.875rem;
  font-weight: 600;
  padding: 12px 20px;
}

.status-just-done {
  background: rgb(39 174 96 / 10%);
  color: #27ae60;
}

.status-already,
.status-unavailable {
  background: rgb(174 214 241 / 20%);
  color: #2c3e50;
}
</style>
