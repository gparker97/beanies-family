import { createPinia } from 'pinia';
import { createApp } from 'vue';
import App from './App.vue';
import router from './router';
import './style.css';

const app = createApp(App);

// Install plugins
app.use(createPinia());
app.use(router);

// E2E data bridge (dev-only, tree-shaken from production)
if (import.meta.env.DEV) {
  import('./services/e2e/dataBridge').then((m) => m.initDataBridge());
}

// Mount app
app.mount('#app');
