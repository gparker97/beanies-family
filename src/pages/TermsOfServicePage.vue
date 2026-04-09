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
        to="/"
        class="text-primary-500 hover:text-primary-600 mb-8 inline-flex items-center gap-1 text-sm font-medium transition-colors"
      >
        &larr; {{ t('legal.backToHome') }}
      </router-link>

      <h1
        class="font-outfit text-secondary-500 mb-2 text-3xl font-bold md:text-4xl dark:text-gray-100"
      >
        {{ t('legal.termsOfService') }}
      </h1>
      <p class="mb-12 text-sm text-[var(--color-text-muted)]">
        {{ t('legal.lastUpdated') }}: 9 April 2026
      </p>

      <div class="legal-content">
        <section>
          <h2>welcome</h2>
          <p>
            these terms of service ("terms") govern your use of beanies.family ("the app", "we",
            "our"). by using beanies.family, you agree to these terms. if you don't agree, please
            don't use the app.
          </p>
          <p>
            beanies.family is an open-source, local-first family planning application. these terms
            are written in plain language because we believe legal documents should be
            understandable.
          </p>
        </section>

        <section>
          <h2>what beanies.family is</h2>
          <p>beanies.family is a personal tool for families to:</p>
          <ul>
            <li>track household finances (accounts, transactions, budgets, goals)</li>
            <li>plan family activities, to-dos, and travel</li>
            <li>collaborate as a family unit</li>
          </ul>
          <p>
            the app runs entirely in your browser. your data is stored locally on your device and is
            not transmitted to our servers. we provide the software — you provide and control the
            data.
          </p>
        </section>

        <section>
          <h2>your data, your responsibility</h2>
          <p>
            because beanies.family is local-first,
            <strong>you are responsible for your data</strong>:
          </p>
          <ul>
            <li>
              <strong>backups:</strong> we strongly recommend enabling Google Drive sync or
              regularly exporting your data. clearing your browser data will permanently delete your
              local data
            </li>
            <li>
              <strong>accuracy:</strong> the financial information you enter is for your personal
              use. we don't verify, audit, or guarantee the accuracy of any data you input
            </li>
            <li>
              <strong>encryption keys:</strong> if you use Google Drive sync with encryption, you
              are responsible for remembering your passphrase. we cannot recover it for you
            </li>
            <li>
              <strong>sharing:</strong> if you share your device or family data file with others,
              you are responsible for who has access
            </li>
          </ul>
        </section>

        <section>
          <h2>not financial advice</h2>
          <p>
            beanies.family is a <strong>personal planning tool</strong>, not a financial advisor.
            the app does not provide financial, tax, investment, or legal advice. features like
            forecasting, budgeting, and goal tracking are planning aids — they are not
            recommendations or guarantees.
          </p>
          <p>
            for financial decisions, please consult a qualified professional. we are not liable for
            any financial decisions you make based on information displayed in the app.
          </p>
        </section>

        <section>
          <h2>the app is provided "as is"</h2>
          <p>
            beanies.family is provided <strong>free of charge</strong> and <strong>"as is"</strong>,
            without warranty of any kind, express or implied. this includes, but is not limited to:
          </p>
          <ul>
            <li>no warranty that the app will be uninterrupted, error-free, or bug-free</li>
            <li>no warranty of fitness for a particular purpose</li>
            <li>
              no warranty regarding the accuracy of calculations, currency conversions, or forecasts
            </li>
          </ul>
          <p>
            we do our best to make the app reliable and correct, but software has bugs. we're a
            small team building something we love, and we appreciate your understanding.
          </p>
        </section>

        <section>
          <h2>limitation of liability</h2>
          <p>
            to the maximum extent permitted by applicable law, beanies.family and its creators shall
            not be liable for any indirect, incidental, special, consequential, or punitive damages,
            including but not limited to:
          </p>
          <ul>
            <li>loss of data (please back up your data regularly)</li>
            <li>financial losses from decisions made using the app</li>
            <li>inability to access the app or your data</li>
            <li>errors in currency conversion rates or calculations</li>
          </ul>
        </section>

        <section>
          <h2>open source license</h2>
          <p>
            beanies.family is open-source software released under the
            <a href="https://opensource.org/licenses/MIT" target="_blank" rel="noopener"
              >MIT License</a
            >. the source code is available on
            <a href="https://github.com/gparker97/beanies-family" target="_blank" rel="noopener"
              >GitHub</a
            >.
          </p>
          <p>
            the MIT License grants you the right to use, copy, modify, and distribute the software.
            the full license text is included in the repository.
          </p>
        </section>

        <section>
          <h2>google services</h2>
          <p>
            if you choose to sign in with Google or enable Google Drive sync, your use of those
            services is also governed by
            <a href="https://policies.google.com/terms" target="_blank" rel="noopener"
              >Google's Terms of Service</a
            >
            and
            <a href="https://policies.google.com/privacy" target="_blank" rel="noopener"
              >Google's Privacy Policy</a
            >.
          </p>
          <p>
            we access Google Drive using the most restrictive scope available
            (<code>drive.file</code>), limiting access to only files created by beanies.family.
          </p>
        </section>

        <section>
          <h2>acceptable use</h2>
          <p>you agree not to:</p>
          <ul>
            <li>use the app for any unlawful purpose</li>
            <li>attempt to reverse-engineer our encryption to access another user's data</li>
            <li>misrepresent your affiliation with beanies.family</li>
            <li>
              use the beanies.family brand, logo, or name in a way that implies endorsement without
              permission
            </li>
          </ul>
        </section>

        <section>
          <h2>availability</h2>
          <p>
            as a local-first app, beanies.family works offline after initial load. however, we do
            not guarantee continuous availability of:
          </p>
          <ul>
            <li>the website and app download</li>
            <li>currency exchange rate updates</li>
            <li>Google Drive sync functionality (dependent on Google's services)</li>
            <li>any online features we may add in the future</li>
          </ul>
        </section>

        <section>
          <h2>changes to these terms</h2>
          <p>
            we may update these terms from time to time. when we do, we'll update the "last updated"
            date at the top of this page. since beanies.family is open source, you can review all
            changes in our
            <a href="https://github.com/gparker97/beanies-family" target="_blank" rel="noopener"
              >GitHub repository</a
            >.
          </p>
          <p>continued use of the app after changes constitutes acceptance of the updated terms.</p>
        </section>

        <section>
          <h2>governing law</h2>
          <p>
            these terms are governed by applicable law. any disputes arising from the use of
            beanies.family shall be resolved in good faith. we're a small, open-source project — if
            you have a concern, please talk to us first.
          </p>
        </section>

        <section>
          <h2>contact</h2>
          <p>
            if you have questions about these terms, please reach out via the contact form on our
            <router-link to="/" class="text-primary-500 hover:text-primary-600"
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
