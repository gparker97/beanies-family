<script setup lang="ts">
/**
 * White-bordered polaroid-style photo with an optional handwritten
 * caption. Used on recipe hero shots, cook log dish snaps, and
 * scrapbook photo items. When `src` is null the component renders
 * a soft terracotta kraft-paper illustration placeholder so
 * photo-less recipes still look intentional rather than empty.
 */
defineProps<{
  src?: string | null;
  /** Optional Caveat-styled caption shown inside the white border. */
  caption?: string;
  /** Accessible alt text for the image. */
  alt?: string;
  /** Aspect ratio override — defaults to 4/3, photo-album shape. */
  aspectRatio?: string;
}>();
</script>

<template>
  <figure
    class="relative bg-white p-2 pb-7 shadow-[var(--card-shadow)]"
    style="
      box-shadow:
        inset 0 0 0 1px rgb(44 62 80 / 5%),
        var(--card-shadow);
    "
  >
    <img
      v-if="src"
      :src="src"
      :alt="alt ?? ''"
      class="block w-full bg-cover bg-center"
      :style="{ aspectRatio: aspectRatio ?? '4 / 3' }"
    />
    <div
      v-else
      class="relative grid w-full place-items-center overflow-hidden"
      :style="{
        aspectRatio: aspectRatio ?? '4 / 3',
        background: 'linear-gradient(135deg, #f9e4c8 0%, #f5c99a 100%)',
      }"
    >
      <!-- Faint gingham pattern -->
      <div
        class="absolute inset-0"
        style="
          background-image:
            linear-gradient(rgb(230 126 34 / 8%) 1px, transparent 1px),
            linear-gradient(90deg, rgb(230 126 34 / 8%) 1px, transparent 1px);
          background-size: 16px 16px;
        "
        aria-hidden="true"
      />
      <svg
        class="relative z-10 h-20 w-20 text-[#E67E22]"
        viewBox="0 0 64 64"
        fill="none"
        stroke="currentColor"
        stroke-width="2.4"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <path
          d="M14 30h36a2 2 0 0 1 2 2v2a18 18 0 0 1-18 18h-4a18 18 0 0 1-18-18v-2a2 2 0 0 1 2-2z"
        />
        <path d="M24 22c0-2 2-3 4-3s4 1 4 3" />
        <path d="M32 18c0-2 2-3 4-3s4 1 4 3" />
        <path d="M40 14c0-2 2-3 4-3" />
        <path d="M10 54h44" stroke-width="1.5" stroke-dasharray="2 2" />
      </svg>
      <span
        v-if="caption"
        class="font-caveat absolute bottom-3.5 left-3.5 z-10 text-lg text-[#E67E22] opacity-75"
      >
        {{ caption }}
      </span>
    </div>
    <figcaption
      v-if="caption && src"
      class="font-caveat text-secondary-500 absolute right-0 bottom-1 left-0 text-center text-base"
    >
      {{ caption }}
    </figcaption>
  </figure>
</template>
