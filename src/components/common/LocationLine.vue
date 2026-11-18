<script setup lang="ts">
/**
 * The one read row for a location (#150, ADR-049): renders `describeLocation(...)`. The map
 * row has the place as the link and the kept detail on its own line; each video call is a
 * Join Call button (`openExternal`) with its host and path as a caption; a pasted map URL is a
 * Map Link row; every other web link is an Open Link row from `LinkList` (favicons off, so a
 * location is never sent to a favicon service).
 *
 * `variant="compact"` is one inline line (the emergency contact card keeps its 📍 prefix).
 * `interactive=false` (the wall) shows the same content with nothing to tap: a call is its
 * service name with "Join from your phone" under it.
 *
 * Flag off is handled inside `describeLocation`: the text and the map link are exactly
 * today's. `mapWhenOff=false` is for the surfaces that show no map link today.
 *
 * The label is the parent's ("Location" or "Location or Link"): `locationLabelKey` picks it.
 */
import { computed } from 'vue';
import BeanieIcon from '@/components/ui/BeanieIcon.vue';
import LinkList from '@/components/ui/LinkList.vue';
import { useTranslation } from '@/composables/useTranslation';
import type { PlaceRef } from '@/types/models';
import { fillTemplate } from '@/utils/fillTemplate';
import { describeLocation, joinCaption } from '@/utils/location/locationLinks';
import { openExternal } from '@/utils/openExternal';

const props = withDefaults(
  defineProps<{
    text: string | null | undefined;
    place?: PlaceRef | null;
    variant?: 'row' | 'compact';
    /** False on the wall: nothing is a link. */
    interactive?: boolean;
    /** With the flag off, whether this surface shows a map link today. */
    mapWhenOff?: boolean;
  }>(),
  { place: undefined, variant: 'row', interactive: true, mapWhenOff: true }
);

const { t } = useTranslation();

const view = computed(() =>
  describeLocation(props.text, props.place, { mapWhenOff: props.mapWhenOff })
);
/** The place line: the picked place's name, else the plain text. */
const placeText = computed(() => view.value.placeName ?? view.value.plain);
const calls = computed(() => view.value.links.filter((l) => l.kind === 'call'));
const mapLinks = computed(() => view.value.links.filter((l) => l.kind === 'map'));
const webLinks = computed(() =>
  view.value.links.filter((l) => l.kind === 'web').map((l) => l.href)
);
const compactPlace = computed(() =>
  view.value.detail ? `${placeText.value}, ${view.value.detail}` : placeText.value
);

const joinLabel = (service: string | undefined) =>
  fillTemplate(t('location.joinCall'), { service: service ?? '' });
const callLabel = (service: string | undefined) =>
  fillTemplate(t('location.callOf'), { service: service ?? '' });

function join(href: string): void {
  openExternal(href);
}
</script>

<template>
  <!-- Compact: one inline line, the 📍 prefix kept. -->
  <span v-if="variant === 'compact'" class="inline-flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
    <span v-if="placeText" data-testid="location-line-place">
      📍
      <a
        v-if="interactive && view.mapHref"
        :href="view.mapHref"
        target="_blank"
        rel="noopener noreferrer"
        class="text-primary-700 dark:text-accent-lift hover:underline"
        :title="t('planner.openInMaps')"
        @click.stop
        >{{ compactPlace }}</a
      >
      <template v-else>{{ compactPlace }}</template>
    </span>
    <template v-for="link in calls" :key="link.href">
      <button
        v-if="interactive"
        type="button"
        class="text-primary-700 dark:text-accent-lift inline-flex items-center gap-1 font-semibold hover:underline"
        data-testid="location-line-join"
        @click.stop="join(link.href)"
      >
        <BeanieIcon name="video" size="xs" />
        {{ joinLabel(link.service) }}
      </button>
      <span v-else>{{ callLabel(link.service) }}</span>
    </template>
    <template
      v-for="link in [...mapLinks, ...view.links.filter((l) => l.kind === 'web')]"
      :key="link.href"
    >
      <a
        v-if="interactive"
        :href="link.href"
        target="_blank"
        rel="noopener noreferrer"
        class="text-primary-700 dark:text-accent-lift hover:underline"
        @click.stop
        >{{ link.kind === 'map' ? t('location.mapLink') : link.host }}</a
      >
      <span v-else>{{ link.kind === 'map' ? t('location.mapLink') : link.host }}</span>
    </template>
  </span>

  <!-- Row: the map row, then each call, map link and web link on its own row. -->
  <div v-else class="space-y-1.5" data-testid="location-line">
    <template v-if="placeText">
      <a
        v-if="interactive && view.mapHref"
        :href="view.mapHref"
        target="_blank"
        rel="noopener noreferrer"
        class="group/loc -mx-1.5 flex items-start gap-1.5 rounded-lg px-1.5 py-1 transition-colors hover:bg-orange-50 focus:bg-orange-50 focus:outline-none dark:hover:bg-orange-900/20 dark:focus:bg-orange-900/20"
        :title="t('planner.openInMaps')"
        data-testid="location-line-map"
        @click.stop
      >
        <BeanieIcon
          name="map-pin"
          size="sm"
          class="text-primary-500 dark:text-accent-lift mt-0.5 shrink-0"
        />
        <span class="grid min-w-0">
          <span
            class="text-primary-700 dark:text-accent-lift text-sm font-medium break-words whitespace-pre-line group-hover/loc:underline"
            >{{ placeText }}</span
          >
          <span
            v-if="view.detail"
            class="text-secondary-500 dark:text-ink-soft text-sm break-words"
            data-testid="location-line-detail"
            >{{ view.detail }}</span
          >
        </span>
      </a>
      <div
        v-else
        class="-mx-1.5 flex items-start gap-1.5 px-1.5 py-1"
        data-testid="location-line-map"
      >
        <BeanieIcon
          name="map-pin"
          size="sm"
          class="text-secondary-400 dark:text-ink-soft mt-0.5 shrink-0"
        />
        <span class="grid min-w-0">
          <span
            class="text-secondary-500 dark:text-ink text-sm font-medium break-words whitespace-pre-line"
            >{{ placeText }}</span
          >
          <span
            v-if="view.detail"
            class="text-secondary-500 dark:text-ink-soft text-sm break-words"
            data-testid="location-line-detail"
            >{{ view.detail }}</span
          >
        </span>
      </div>
    </template>

    <div v-for="link in calls" :key="link.href" class="grid justify-items-start gap-0.5">
      <template v-if="interactive">
        <button
          type="button"
          class="font-outfit bg-primary-500 hover:bg-primary-600 inline-flex min-h-10 items-center gap-2 rounded-full px-3.5 py-1.5 text-sm font-semibold text-white transition-colors"
          data-testid="location-line-join"
          @click.stop="join(link.href)"
        >
          <BeanieIcon name="video" size="sm" />
          {{ joinLabel(link.service) }}
        </button>
        <span
          class="text-secondary-400 dark:text-ink-faint text-xs break-all"
          data-testid="location-line-caption"
          >{{ joinCaption(link.href) }}</span
        >
      </template>
      <template v-else>
        <span
          class="text-secondary-500 dark:text-ink flex items-center gap-1.5 text-sm font-medium"
        >
          <BeanieIcon name="video" size="sm" class="text-secondary-400 dark:text-ink-soft" />
          {{ callLabel(link.service) }}
        </span>
        <span class="text-secondary-400 dark:text-ink-faint text-xs">{{
          t('location.joinFromPhone')
        }}</span>
      </template>
    </div>

    <template v-for="link in mapLinks" :key="link.href">
      <a
        v-if="interactive"
        :href="link.href"
        target="_blank"
        rel="noopener noreferrer"
        class="-mx-1.5 flex items-center gap-1.5 rounded-lg px-1.5 py-1 transition-colors hover:bg-orange-50 dark:hover:bg-orange-900/20"
        data-testid="location-line-maplink"
        @click.stop
      >
        <BeanieIcon
          name="map-pin"
          size="sm"
          class="text-primary-500 dark:text-accent-lift shrink-0"
        />
        <span class="text-primary-700 dark:text-accent-lift text-sm font-medium">{{
          t('location.mapLink')
        }}</span>
      </a>
      <span v-else class="text-secondary-500 dark:text-ink-soft text-sm">{{
        t('location.mapLink')
      }}</span>
    </template>

    <LinkList v-if="interactive && webLinks.length" :urls="webLinks" :favicons="false" />
    <template v-else-if="webLinks.length">
      <span
        v-for="link in view.links.filter((l) => l.kind === 'web')"
        :key="link.href"
        class="text-secondary-500 dark:text-ink-soft block text-sm"
        >🔗 {{ link.host }}</span
      >
    </template>
  </div>
</template>
