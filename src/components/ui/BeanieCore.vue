<script setup lang="ts">
// The shared comic-beanie mascot core (#33) — body + knitted pom-pom hat + face,
// no arms (each empty-state scene adds its own gesture). Colours are props so the
// gradient stops are real hex values (no CSS-var/`<use>` shadow tricks — safe on
// iOS WebKit). Renders an SVG <g>; embed inside a parent <svg viewBox="0 0 160 160">.
// The beanie sits left-of-centre (body ~x63) so scene props go to its right.
const props = withDefaults(
  defineProps<{
    bodyLight: string;
    bodyBase: string;
    bodyDark: string;
    /** 'open' = big sparkle eyes; 'happy' = closed ^^ (dreaming/content). */
    eyes?: 'open' | 'happy';
    /** Namespaces the gradient/clip ids so two beanies can coexist (e.g. dashboard). */
    uid?: string;
  }>(),
  { eyes: 'open', uid: 'a' }
);

const domeId = `bcDome-${props.uid}`;
const bodyId = `bcBody-${props.uid}`;
const hatId = `bcHat-${props.uid}`;
</script>

<template>
  <g>
    <!-- feet -->
    <ellipse cx="54" cy="129" rx="6" ry="4" :fill="bodyDark" stroke="#5a3a26" stroke-width="2.4" />
    <ellipse cx="68" cy="130" rx="6" ry="4" :fill="bodyDark" stroke="#5a3a26" stroke-width="2.4" />
    <!-- bean body -->
    <path
      d="M40 98 C35 70 49 50 62 49 C78 48 87 61 86 82 C85 108 75 124 58 124 C46 124 44 113 40 98 Z"
      :fill="`url(#${bodyId})`"
      stroke="#5a3a26"
      stroke-width="2.6"
      stroke-linejoin="round"
    />
    <path
      d="M48 70 C44 86 46 104 56 110 C50 96 50 80 58 66 C53 64 50 66 48 70 Z"
      fill="#fff"
      opacity="0.18"
    />
    <path
      d="M86 82 C85 108 75 124 58 124 C72 120 80 104 80 86 C82 84 84 82 86 82 Z"
      :fill="bodyDark"
      opacity="0.45"
    />
    <!-- knitted hat -->
    <clipPath :id="domeId"><path d="M43 61 C43 36 53 26 65 26 C77 26 87 36 87 61 Z" /></clipPath>
    <circle cx="65" cy="24" r="6.4" fill="#dcefff" stroke="#5a3a26" stroke-width="2.2" />
    <circle cx="62.5" cy="22" r="2.1" fill="#fff" opacity="0.9" />
    <path
      d="M43 61 C43 36 53 26 65 26 C77 26 87 36 87 61 Z"
      :fill="`url(#${hatId})`"
      stroke="#5a3a26"
      stroke-width="2.4"
      stroke-linejoin="round"
    />
    <g :clip-path="`url(#${domeId})`" stroke="#94c2e6" stroke-width="1.7" opacity="0.75">
      <line x1="51" y1="29" x2="51" y2="61" />
      <line x1="58" y1="27" x2="58" y2="61" />
      <line x1="65" y1="26" x2="65" y2="61" />
      <line x1="72" y1="27" x2="72" y2="61" />
      <line x1="79" y1="29" x2="79" y2="61" />
    </g>
    <rect
      x="41"
      y="58"
      width="48"
      height="11"
      rx="5.5"
      fill="#c2e0f5"
      stroke="#5a3a26"
      stroke-width="2.4"
    />
    <line x1="48" y1="59" x2="48" y2="68" stroke="#94c2e6" stroke-width="1.3" opacity="0.7" />
    <line x1="58" y1="59" x2="58" y2="68" stroke="#94c2e6" stroke-width="1.3" opacity="0.7" />
    <line x1="72" y1="59" x2="72" y2="68" stroke="#94c2e6" stroke-width="1.3" opacity="0.7" />
    <line x1="82" y1="59" x2="82" y2="68" stroke="#94c2e6" stroke-width="1.3" opacity="0.7" />
    <!-- face -->
    <template v-if="eyes === 'open'">
      <path
        d="M51 73 Q56 70 60 72"
        stroke="#5a3a26"
        stroke-width="1.8"
        fill="none"
        stroke-linecap="round"
      />
      <path
        d="M70 72 Q74 70 78 73"
        stroke="#5a3a26"
        stroke-width="1.8"
        fill="none"
        stroke-linecap="round"
      />
      <ellipse cx="57" cy="82" rx="5.6" ry="6.6" fill="#2a2622" />
      <circle cx="55" cy="79.6" r="2" fill="#fff" />
      <circle cx="59" cy="83.5" r="1" fill="#fff" opacity="0.85" />
      <ellipse cx="73" cy="81" rx="5.6" ry="6.6" fill="#2a2622" />
      <circle cx="71" cy="78.6" r="2" fill="#fff" />
      <circle cx="75" cy="82.5" r="1" fill="#fff" opacity="0.85" />
    </template>
    <template v-else>
      <path
        d="M52 82 Q57 77 62 82"
        stroke="#2a2622"
        stroke-width="2.2"
        fill="none"
        stroke-linecap="round"
      />
      <path
        d="M68 81 Q73 76 78 81"
        stroke="#2a2622"
        stroke-width="2.2"
        fill="none"
        stroke-linecap="round"
      />
    </template>
    <ellipse cx="49" cy="91" rx="4.4" ry="2.8" fill="#F5938A" opacity="0.7" />
    <ellipse cx="80" cy="90" rx="4.4" ry="2.8" fill="#F5938A" opacity="0.7" />
    <path
      d="M59 92 Q65.5 101 72 91 Q65.5 96 59 92 Z"
      fill="#3a2622"
      stroke="#5a3a26"
      stroke-width="1.4"
      stroke-linejoin="round"
    />
    <path d="M62 94.5 Q65.5 98.5 69 94.3 Q65.5 96.5 62 94.5 Z" fill="#F2766B" />
    <defs>
      <radialGradient :id="bodyId" cx="0.36" cy="0.3" r="0.85">
        <stop offset="0%" :stop-color="bodyLight" />
        <stop offset="55%" :stop-color="bodyBase" />
        <stop offset="100%" :stop-color="bodyDark" />
      </radialGradient>
      <linearGradient :id="hatId" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#cfeaff" />
        <stop offset="100%" stop-color="#aed6f1" />
      </linearGradient>
    </defs>
  </g>
</template>
