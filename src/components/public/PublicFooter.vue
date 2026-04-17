<script setup lang="ts">
import { MARKETING_URL } from '@/utils/marketing';

function handleContact() {
  // Contact lives on the marketing site (beanies.family). The apex page reads
  // window.location.hash === '#contact' on load and opens the modal.
  window.location.href = `${MARKETING_URL}/#contact`;
}
</script>

<template>
  <footer class="footer">
    <p class="footer-brand">
      beanies<span class="footer-brand-orange">.family</span>
    </p>
    <div class="footer-links">
      <a href="https://github.com/gparker97/beanies-family" target="_blank" rel="noopener">GitHub</a>
      <router-link to="/blog">beanstalk</router-link>
      <a :href="`${MARKETING_URL}/help`" target="_blank" rel="noopener noreferrer">help</a>
      <a :href="`${MARKETING_URL}/privacy`" target="_blank" rel="noopener noreferrer">privacy</a>
      <a :href="`${MARKETING_URL}/terms`" target="_blank" rel="noopener noreferrer">terms</a>
      <router-link to="/welcome">sign in</router-link>
    </div>
    <button class="footer-contact-btn" @click="handleContact">
      &#x1F4AC; get in touch with me
    </button>
    <p class="footer-tag">every bean counts.</p>
    <p class="footer-copy">&copy; 2026 beanies.family. open source under MIT license.</p>
  </footer>
</template>

<style scoped>
.footer {
  background: var(--deep-slate, #2c3e50);
  padding: 32px 24px;
  text-align: center;
}

.footer-brand {
  color: rgb(255 255 255 / 50%);
  font-family: Outfit, sans-serif;
  font-size: 0.85rem;
  font-weight: 600;
  margin-bottom: 4px;
}

.footer-brand-orange {
  color: var(--heritage-orange, #f15d22);
}

.footer-links {
  display: flex;
  gap: 20px;
  justify-content: center;
  margin-top: 8px;
}

.footer-links a {
  color: rgb(255 255 255 / 30%);
  font-family: Outfit, sans-serif;
  font-size: 0.78rem;
  text-decoration: none;
  transition: color 150ms;
}

.footer-links a:hover {
  color: var(--heritage-orange, #f15d22);
}

.footer-contact-btn {
  align-items: center;
  background: var(--heritage-orange, #f15d22);
  border: none;
  border-radius: 24px;
  color: white;
  cursor: pointer;
  display: inline-flex;
  font-family: Outfit, sans-serif;
  font-size: 0.8rem;
  font-weight: 600;
  gap: 8px;
  margin-top: 16px;
  padding: 10px 24px;
  transition: all 200ms ease;
}

.footer-contact-btn:hover {
  background: #d14d1a;
  transform: translateY(-1px);
}

.footer-tag {
  color: var(--heritage-orange, #f15d22);
  font-family: Outfit, sans-serif;
  font-size: 0.75rem;
  font-weight: 600;
  letter-spacing: 0.05em;
  margin-top: 8px;
  opacity: 0.5;
}

.footer-copy {
  color: rgb(255 255 255 / 20%);
  font-size: 0.72rem;
  margin-top: 6px;
}
</style>
