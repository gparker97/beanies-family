<script setup lang="ts">
import { useClipboard } from '@/composables/useClipboard';
import type { ArticleSection } from '@/content/help';

defineProps<{
  sections: ArticleSection[];
}>();

const { copied, copy } = useClipboard();
</script>

<template>
  <div class="help-article-content space-y-5">
    <template v-for="(section, i) in sections" :key="i">
      <!-- Heading -->
      <component
        :is="section.level === 3 ? 'h3' : 'h2'"
        v-if="section.type === 'heading'"
        :id="section.id"
        class="font-outfit text-secondary-500 font-semibold dark:text-gray-100"
        :class="section.level === 3 ? 'text-lg' : 'mt-8 text-xl first:mt-0'"
      >
        {{ section.content }}
      </component>

      <!-- Paragraph -->
      <!-- eslint-disable-next-line vue/no-v-html -->
      <p
        v-else-if="section.type === 'paragraph'"
        class="leading-relaxed text-gray-600 dark:text-gray-300"
        v-html="section.content"
      />

      <!-- Callout -->
      <div
        v-else-if="section.type === 'callout'"
        class="border-primary-500 dark:bg-primary-500/10 rounded-2xl border-l-4 bg-[var(--tint-orange-8)] p-4"
      >
        <div
          v-if="section.title"
          class="font-outfit text-secondary-500 mb-1 flex items-center gap-2 text-sm font-semibold dark:text-gray-100"
        >
          <span v-if="section.icon">{{ section.icon }}</span>
          {{ section.title }}
        </div>
        <!-- eslint-disable-next-line vue/no-v-html -->
        <p
          class="text-sm leading-relaxed text-gray-600 dark:text-gray-300"
          v-html="section.content"
        />
      </div>

      <!-- Info Box -->
      <div
        v-else-if="section.type === 'infoBox'"
        class="dark:bg-sky-silk-300/10 rounded-2xl bg-[var(--tint-silk-20)] p-4"
      >
        <div
          v-if="section.title"
          class="font-outfit text-secondary-500 mb-1 flex items-center gap-2 text-sm font-semibold dark:text-gray-100"
        >
          <span v-if="section.icon">{{ section.icon }}</span>
          {{ section.title }}
        </div>
        <!-- eslint-disable-next-line vue/no-v-html -->
        <p
          class="text-sm leading-relaxed text-gray-600 dark:text-gray-300"
          v-html="section.content"
        />
      </div>

      <!-- Code Block -->
      <div
        v-else-if="section.type === 'codeBlock'"
        class="group bg-secondary-500 relative rounded-2xl p-4 dark:bg-slate-900"
      >
        <button
          class="absolute top-3 right-3 rounded-lg bg-white/10 px-2 py-1 text-xs text-white/60 opacity-0 transition-opacity group-hover:opacity-100 hover:bg-white/20 hover:text-white"
          @click="copy(section.content)"
        >
          {{ copied ? 'Copied!' : 'Copy' }}
        </button>
        <pre class="text-sky-silk-300 overflow-x-auto font-mono text-sm leading-relaxed">{{
          section.content
        }}</pre>
      </div>

      <!-- List -->
      <component
        :is="section.ordered ? 'ol' : 'ul'"
        v-else-if="section.type === 'list'"
        class="space-y-2 pl-5"
        :class="section.ordered ? 'list-decimal' : 'list-disc'"
      >
        <!-- eslint-disable-next-line vue/no-v-html -->
        <li
          v-for="(item, j) in section.items"
          :key="j"
          class="marker:text-primary-400 dark:marker:text-primary-500 text-sm leading-relaxed text-gray-600 dark:text-gray-300"
          v-html="item"
        />
      </component>

      <!-- Steps -->
      <div v-else-if="section.type === 'steps'" class="space-y-3">
        <div v-for="(step, j) in section.items" :key="j" class="flex gap-3">
          <div
            class="bg-primary-500 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white"
          >
            {{ j + 1 }}
          </div>
          <!-- eslint-disable-next-line vue/no-v-html -->
          <p
            class="pt-0.5 text-sm leading-relaxed text-gray-600 dark:text-gray-300"
            v-html="step"
          />
        </div>
      </div>
    </template>
  </div>
</template>
