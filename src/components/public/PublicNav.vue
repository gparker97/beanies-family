<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';
import { useRouter } from 'vue-router';

interface Props {
  /** Additional nav links beyond the defaults */
  links?: { label: string; href: string; scrollTo?: boolean; external?: boolean }[];
}

withDefaults(defineProps<Props>(), { links: () => [] });

const router = useRouter();
const fnav = ref<HTMLElement | null>(null);

function onScroll() {
  if (fnav.value) fnav.value.classList.toggle('scrolled', window.scrollY > 20);
}

onMounted(() => {
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
});
onUnmounted(() => window.removeEventListener('scroll', onScroll));

function handleLinkClick(link: { href: string; scrollTo?: boolean }) {
  if (link.scrollTo) {
    const el = document.getElementById(link.href.replace('#', ''));
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}
</script>

<template>
  <nav ref="fnav" class="fnav">
    <a href="/home" class="fnav-logo">
      <img src="/brand/beanies_logo_transparent_logo_only_192x192.png" alt="" />beanies<span class="fnav-logo-orange">.family</span>
    </a>
    <div class="fnav-right">
      <div class="fnav-links">
        <slot name="links">
          <template v-for="link in links" :key="link.href">
            <a
              v-if="link.scrollTo"
              :href="link.href"
              @click.prevent="handleLinkClick(link)"
            >{{ link.label }}</a>
            <a
              v-else-if="link.external"
              :href="link.href"
              target="_blank"
              rel="noopener noreferrer"
            >{{ link.label }}</a>
            <router-link v-else :to="link.href">{{ link.label }}</router-link>
          </template>
        </slot>
      </div>
      <button class="fnav-cta" @click="router.push('/welcome')">create your bean pod</button>
    </div>
  </nav>
</template>

<style scoped>
.fnav {
  align-items: center;
  backdrop-filter: blur(24px);
  background: rgb(255 255 255 / 82%);
  border: 1px solid rgb(44 62 80 / 6%);
  border-radius: 40px;
  display: flex;
  gap: 12px;
  left: 50%;
  padding: 6px 10px 6px 16px;
  position: fixed;
  top: 16px;
  transform: translateX(-50%);
  transition: box-shadow 300ms ease, background 500ms ease;
  z-index: 200;
}

.fnav.scrolled {
  box-shadow: 0 4px 24px rgb(44 62 80 / 8%);
}

.fnav-logo {
  align-items: center;
  color: var(--deep-slate, #2c3e50);
  display: flex;
  font-family: Outfit, sans-serif;
  font-size: 1rem;
  font-weight: 700;
  gap: 0;
  text-decoration: none;
  white-space: nowrap;
}

.fnav-logo img {
  border-radius: 8px;
  height: 26px;
  margin-right: 7px;
  width: 26px;
}

.fnav-logo-orange {
  color: var(--heritage-orange, #f15d22);
}

.fnav-right {
  align-items: center;
  display: flex;
  gap: 8px;
}

.fnav-links {
  display: flex;
  gap: 2px;
}

.fnav-links a {
  border-radius: 16px;
  color: var(--deep-slate, #2c3e50);
  font-family: Outfit, sans-serif;
  font-size: 0.85rem;
  font-weight: 600;
  opacity: 0.35;
  padding: 4px 10px;
  text-decoration: none;
  transition: all 200ms;
  white-space: nowrap;
}

.fnav-links a:hover {
  background: rgb(44 62 80 / 5%);
  opacity: 0.7;
}

.fnav-links a.router-link-active {
  opacity: 0.7;
}

.fnav-cta {
  background: var(--heritage-orange, #f15d22);
  border: none;
  border-radius: 20px;
  color: white;
  cursor: pointer;
  font-family: Outfit, sans-serif;
  font-size: 0.85rem;
  font-weight: 600;
  padding: 6px 16px;
  text-decoration: none;
  transition: all 200ms;
  white-space: nowrap;
}

.fnav-cta:hover {
  background: #d14d1a;
  transform: translateY(-1px);
}

@media (width <= 520px) {
  .fnav {
    border-radius: 24px;
    flex-direction: column;
    gap: 6px;
    padding: 8px 14px;
  }

  .fnav-right {
    justify-content: space-between;
    width: 100%;
  }

  .fnav-links {
    gap: 0;
  }

  .fnav-links a {
    font-size: 0.78rem;
    padding: 4px 8px;
  }

  .fnav-cta {
    font-size: 0.78rem;
    padding: 6px 14px;
  }
}
</style>
