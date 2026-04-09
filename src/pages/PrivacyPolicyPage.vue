<script setup lang="ts">
import { useAuthStore } from '@/stores/authStore';
import { useTranslation } from '@/composables/useTranslation';
import HelpPublicHeader from '@/components/help/HelpPublicHeader.vue';

const authStore = useAuthStore();
const { t } = useTranslation();
</script>

<template>
  <div>
    <HelpPublicHeader v-if="!authStore.isAuthenticated" />

    <article class="mx-auto max-w-3xl px-6 py-16 md:py-24">
      <router-link
        to="/home"
        class="text-primary-500 hover:text-primary-600 mb-8 inline-flex items-center gap-1 text-sm font-medium transition-colors"
      >
        &larr; {{ t('legal.backToHome') }}
      </router-link>

      <h1
        class="font-outfit text-secondary-500 mb-2 text-3xl font-bold md:text-4xl dark:text-gray-100"
      >
        {{ t('legal.privacyPolicy') }}
      </h1>
      <p class="mb-12 text-sm text-[var(--color-text-muted)]">
        {{ t('legal.lastUpdated') }}: 9 April 2026
      </p>

      <div class="legal-content">
        <section>
          <h2>our promise</h2>
          <p>
            beanies.family is built on a simple belief:
            <strong>your family's data belongs to you</strong>. we don't collect it, we don't store
            it on our servers, and we don't sell it. ever. this isn't just a policy — it's the
            foundation of how we built the app.
          </p>
        </section>

        <section>
          <h2>how beanies.family works</h2>
          <p>
            beanies.family is a <strong>local-first application</strong>. this means your family
            data — finances, activities, goals, to-dos, and everything else — lives on your device.
            it is never transmitted to our servers because we don't have servers that store your
            data.
          </p>
          <ul>
            <li>
              <strong>local storage:</strong> all family data is stored in your browser's IndexedDB,
              encrypted at rest
            </li>
            <li>
              <strong>no accounts on our servers:</strong> we don't maintain user accounts,
              databases, or profiles on any server
            </li>
            <li>
              <strong>no cloud dependency:</strong> the app works fully offline — no internet
              connection required after initial load
            </li>
          </ul>
        </section>

        <section>
          <h2>data we do not collect</h2>
          <p>to be absolutely clear, we do <strong>not</strong> collect:</p>
          <ul>
            <li>your financial data (accounts, transactions, balances, budgets)</li>
            <li>your family information (names, relationships, activities)</li>
            <li>your goals, to-do items, or travel plans</li>
            <li>your passwords or encryption keys</li>
            <li>your location data</li>
            <li>your contacts or address book</li>
            <li>any personally identifiable information (PII) on our servers</li>
          </ul>
        </section>

        <section>
          <h2>analytics</h2>
          <p>
            we use <strong>Plausible Analytics</strong>, a privacy-friendly, cookie-free analytics
            service. Plausible does not use cookies, does not collect personal data, and is fully
            compliant with GDPR, CCPA, and PECR. it tells us aggregate information like:
          </p>
          <ul>
            <li>how many people visit the site</li>
            <li>which pages are most popular</li>
            <li>what countries visitors are from (approximate, based on anonymised IP)</li>
            <li>what devices and browsers are used</li>
          </ul>
          <p>
            no individual user can be identified from this data. Plausible's full privacy policy is
            available at
            <a href="https://plausible.io/data-policy" target="_blank" rel="noopener"
              >plausible.io/data-policy</a
            >.
          </p>
        </section>

        <section>
          <h2>google drive integration (optional)</h2>
          <p>
            if you choose to enable Google Drive sync, your family data file (<code>.beanpod</code>)
            is encrypted on your device <strong>before</strong> it leaves your browser, using
            AES-GCM encryption with a key that only you control. we never see the unencrypted
            contents.
          </p>
          <ul>
            <li>
              <strong>encryption:</strong> your data is encrypted locally using the Web Crypto API
              (AES-GCM) before upload
            </li>
            <li>
              <strong>your key, your control:</strong> the encryption key is derived from your
              passphrase and never leaves your device
            </li>
            <li>
              <strong>Google's role:</strong> Google Drive acts as a storage medium only — we access
              only the app-specific folder created by beanies.family
            </li>
            <li>
              <strong>OAuth scopes:</strong> we request only <code>drive.file</code> scope, which
              limits access to files created by our app — we cannot see any other files in your
              Drive
            </li>
            <li>
              <strong>revocable:</strong> you can disconnect Google Drive at any time from Settings,
              and revoke access from your Google account
            </li>
          </ul>
        </section>

        <section>
          <h2>google authentication</h2>
          <p>
            when you sign in with Google, we receive basic profile information (name, email, profile
            picture) from Google's OAuth service. this information is:
          </p>
          <ul>
            <li>stored only in your browser's local session</li>
            <li>used solely to identify family members within your local data</li>
            <li>never transmitted to or stored on our servers</li>
            <li>cleared when you sign out</li>
          </ul>
        </section>

        <section>
          <h2>cookies</h2>
          <p>
            beanies.family does <strong>not</strong> use cookies. we don't use tracking cookies,
            advertising cookies, or any third-party cookies. Plausible Analytics is also
            cookie-free.
          </p>
        </section>

        <section>
          <h2>third-party services</h2>
          <p>the only third-party services the app connects to are:</p>
          <ul>
            <li>
              <strong>Google Fonts:</strong> to load the Outfit and Inter typefaces (Google's
              <a
                href="https://developers.google.com/fonts/faq/privacy"
                target="_blank"
                rel="noopener"
                >font privacy FAQ</a
              >)
            </li>
            <li>
              <strong>Plausible Analytics:</strong> privacy-friendly, cookie-free analytics (see
              above)
            </li>
            <li>
              <strong>Google Drive:</strong> only if you explicitly enable it — encrypted data only
            </li>
            <li><strong>Google OAuth:</strong> only when you choose to sign in</li>
            <li>
              <strong>ExchangeRate API:</strong> to fetch currency exchange rates — no personal data
              is sent
            </li>
          </ul>
        </section>

        <section>
          <h2>data portability &amp; deletion</h2>
          <ul>
            <li>
              <strong>export:</strong> you can export your family data file at any time from
              Settings
            </li>
            <li>
              <strong>delete:</strong> clearing your browser data removes all local data. if you use
              Google Drive sync, you can delete the <code>.beanpod</code> file from your Drive
            </li>
            <li>
              <strong>no lock-in:</strong> your data is yours — we provide export functionality so
              you're never trapped
            </li>
          </ul>
        </section>

        <section>
          <h2>children's privacy</h2>
          <p>
            beanies.family is designed for families, which may include children. since all data is
            stored locally on the parent's or guardian's device and we collect no personal
            information, there is no data processing of children's information by us. the family
            owner controls all data.
          </p>
        </section>

        <section>
          <h2>security</h2>
          <ul>
            <li><strong>encryption at rest:</strong> local data is encrypted in IndexedDB</li>
            <li>
              <strong>encryption in transit:</strong> Google Drive files are AES-GCM encrypted
              before upload
            </li>
            <li>
              <strong>no server-side data:</strong> there is no server to breach — your data lives
              only on your devices
            </li>
            <li>
              <strong>open source:</strong> our code is publicly auditable on
              <a href="https://github.com/gparker97/beanies-family" target="_blank" rel="noopener"
                >GitHub</a
              >
            </li>
          </ul>
        </section>

        <section>
          <h2>changes to this policy</h2>
          <p>
            if we make changes to this privacy policy, we will update the "last updated" date at the
            top of this page. since beanies.family is open source, you can also review changes in
            our
            <a href="https://github.com/gparker97/beanies-family" target="_blank" rel="noopener"
              >GitHub repository</a
            >.
          </p>
        </section>

        <section>
          <h2>contact</h2>
          <p>
            if you have questions about this privacy policy, please reach out via the contact form
            on our
            <router-link to="/home" class="text-primary-500 hover:text-primary-600"
              >homepage</router-link
            >
            or open an issue on
            <a href="https://github.com/gparker97/beanies-family" target="_blank" rel="noopener"
              >GitHub</a
            >.
          </p>
        </section>
      </div>
    </article>
  </div>
</template>

<style scoped>
.legal-content {
  color: var(--color-text);
  line-height: 1.8;
}

.legal-content section {
  margin-bottom: 2.5rem;
}

.legal-content h2 {
  color: var(--color-heading, var(--deep-slate));
  font-family: Outfit, sans-serif;
  font-size: 1.25rem;
  font-weight: 600;
  margin-bottom: 0.75rem;
}

:root.dark .legal-content h2 {
  color: var(--color-heading, #e2e8f0);
}

.legal-content p {
  font-size: 0.95rem;
  margin-bottom: 0.75rem;
}

.legal-content ul {
  list-style: none;
  margin-bottom: 0.75rem;
  padding-left: 0;
}

.legal-content ul li {
  font-size: 0.95rem;
  margin-bottom: 0.5rem;
  padding-left: 1.5rem;
  position: relative;
}

.legal-content ul li::before {
  color: var(--heritage-orange, #f15d22);
  content: '•';
  font-weight: bold;
  left: 0.25rem;
  position: absolute;
}

.legal-content a {
  color: var(--heritage-orange, #f15d22);
  text-decoration: none;
  transition: color 150ms;
}

.legal-content a:hover {
  color: #d14d1a;
  text-decoration: underline;
}

.legal-content code {
  background: var(--color-surface, #f1f5f9);
  border-radius: 4px;
  font-size: 0.85em;
  padding: 0.15em 0.4em;
}

:root.dark .legal-content code {
  background: #334155;
}

.legal-content strong {
  font-weight: 600;
}
</style>
