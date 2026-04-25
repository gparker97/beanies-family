<script setup lang="ts">
import { onMounted, ref } from 'vue';

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
            ? "done — you're excluded"
            : status === 'already'
              ? 'already excluded'
              : status === 'unavailable'
                ? 'localStorage unavailable'
                : 'checking...'
        }}
      </h1>
      <p v-if="status === 'just-done'">
        this browser will no longer be tracked by plausible on app.beanies.family. repeat on each
        device/browser you use. <a href="/">back to the app</a>
      </p>
      <p v-else-if="status === 'already'">
        this browser is already excluded from plausible analytics on app.beanies.family. nothing to
        do.
      </p>
      <p v-else-if="status === 'unavailable'">
        your browser blocked localStorage (private mode?). try from a normal browser window.
      </p>
      <div v-if="status !== 'pending'" class="status" :class="`status-${status}`">
        {{
          status === 'just-done'
            ? 'plausible_ignore set to true'
            : status === 'already'
              ? 'plausible_ignore = true'
              : 'could not set flag'
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
