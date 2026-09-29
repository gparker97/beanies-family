<script setup lang="ts">
/**
 * Favicon link rows: one tappable row per URL (favicon, friendly label, external-link
 * glyph). Every href goes through `safeExternalHref`, so a URL that is not http(s) is
 * dropped rather than bound (the URLs can come from a to-do's text or a model read).
 * Used by `TodoViewEditModal` and the magic beans to-do review.
 */
import { computed } from 'vue';
import { getUrlDomain, getUrlLabel, getFaviconUrl, safeExternalHref } from '@/utils/url';

const props = withDefaults(
  defineProps<{
    urls: readonly string[];
    /**
     * Load each site's favicon (a request to Google's favicon service naming the domain).
     * Off where the URLs are an unreviewed model read, so a private AI read never tells a
     * third party which clinic or school portal a note mentioned before the family saves it.
     */
    favicons?: boolean;
  }>(),
  { favicons: true }
);

const links = computed(() =>
  props.urls.flatMap((url) => {
    const href = safeExternalHref(url);
    if (!href) return [];
    return [
      {
        href,
        domain: getUrlDomain(href),
        label: getUrlLabel(href),
        favicon: getFaviconUrl(href),
      },
    ];
  })
);
</script>

<template>
  <div v-if="links.length" class="space-y-1.5">
    <a
      v-for="link in links"
      :key="link.href"
      :href="link.href"
      target="_blank"
      rel="noopener noreferrer"
      class="flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm transition-colors hover:bg-[var(--tint-purple-8)] dark:hover:bg-purple-900/20"
      @click.stop
    >
      <span v-if="!favicons" class="w-4 shrink-0 text-center text-xs" aria-hidden="true">🔗</span>
      <img
        v-else
        :src="link.favicon"
        :alt="link.domain"
        width="16"
        height="16"
        class="h-4 w-4 shrink-0 rounded-sm"
        loading="lazy"
      />
      <span class="dark:text-purple-lift min-w-0 flex-1 truncate font-medium text-purple-600">
        {{ link.label }}
      </span>
      <svg
        class="h-3.5 w-3.5 shrink-0 text-[var(--color-text-muted)]"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        viewBox="0 0 24 24"
        aria-hidden="true"
      >
        <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14 21 3" />
      </svg>
    </a>
  </div>
</template>
