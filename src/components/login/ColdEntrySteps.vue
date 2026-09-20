<script setup lang="ts">
/**
 * The three numbered steps for getting in from a device you are already signed in on.
 *
 * Extracted from `ColdSignInPanel`'s push branch so the staged panel and the new
 * `ScanFirstBlock` render the SAME three sentences from one source. They are the most
 * safety-critical copy on the cold surfaces — they are the only instructions a locked-out
 * person has — and two copies of them would drift into two different explanations of one
 * procedure, which is the exact failure `ColdSignInPanel`'s own header was written to prevent.
 *
 * ⚠️ Step 3 tells the person to use their PHONE'S OWN camera app, and that is deliberate, not
 * a gap. There is no `getUserMedia` anywhere in this codebase; the in-app single-photo scanner
 * was removed in 0.21.6 because it decoded one compressed frame and failed on a production
 * iPhone while the phone's own camera read the same code instantly. iOS also has no public URL
 * scheme for the Camera app, so a button cannot open it either. See `ColdSignInPanel`'s header
 * for the full record before re-proposing any of that.
 *
 * The numerals are derived from the array index, never written into the strings, so translators
 * cannot renumber them and a fourth step cannot silently arrive as "3".
 *
 * It deliberately does NOT absorb `coldEntry.showMyCode`: that button belongs to
 * `ColdSignInPanel`'s pull mode, which `ScanFirstBlock` does not have.
 */
const props = defineProps<{
  /**
   * The already-translated step sentences, in order.
   *
   * ⚠️ PASSED IN, NOT BUILT HERE, because the last step differs by form factor: a phone is told
   * to scan with its camera, a laptop is told to send itself the link. Reading the keys inside
   * this component would have forced a form-factor branch into a file whose only job is to
   * number and space them.
   */
  steps: string[];
}>();
</script>

<template>
  <ol class="space-y-2">
    <li
      v-for="(step, i) in props.steps"
      :key="step"
      class="dark:text-ink flex gap-3 text-sm text-gray-900"
    >
      <span
        class="dark:bg-surface-overlay dark:text-ink flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#AED6F1] text-xs font-bold text-[#234A63]"
        aria-hidden="true"
        >{{ i + 1 }}</span
      >
      <span>{{ step }}</span>
    </li>
  </ol>
</template>
