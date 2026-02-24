import { ref, readonly } from 'vue';

const isOnline = ref(true);

let initialized = false;

function update() {
  isOnline.value = navigator.onLine;
}

function init() {
  if (initialized || typeof window === 'undefined') return;
  initialized = true;

  update();

  window.addEventListener('online', update);
  window.addEventListener('offline', update);
}

export function useOnline() {
  init();

  return {
    isOnline: readonly(isOnline),
  };
}
