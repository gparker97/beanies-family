<script setup lang="ts">
/**
 * One add row. Three call sites, no drafts in any parent.
 *
 * This existed twice inside `WallSheet` (once for to-dos, once per list) and
 * the board needed a third, so it owns the whole interaction rather than just
 * the markup: the parents lose their `draft` / `adding` state along with their
 * `<form>`.
 *
 * The `+` stays hidden while the box is empty and arrives on the first
 * keystroke. A bean with four lists shows four of these at once, and four
 * permanent buttons read as a form rather than a chore board; nothing is lost,
 * because Enter submits either way.
 *
 * It does NOT inject the wall's write channel. The caller passes `submit`, so
 * this stays a generic input row that mounts in a test with a stub function and
 * no provides at all.
 */
import { computed, ref } from 'vue';
import { useWallLock } from '@/components/wall/wallLockKey';

const props = defineProps<{
  /** Placeholder AND accessible name — the row has no visible label by design. */
  placeholder: string;
  /** Resolves true when the write landed. Only then is the box cleared. */
  submit: (title: string) => Promise<boolean>;
}>();

const { noteActivity } = useWallLock();

const draft = ref('');
/**
 * Per-instance, deliberately. A guard shared across every list once blocked
 * every other list's add while one was in flight, while their buttons stayed
 * enabled — so the tap did nothing and said nothing. One instance per list
 * makes that impossible to reintroduce by accident.
 */
const busy = ref(false);
const ready = computed(() => draft.value.trim().length > 0);

async function onSubmit() {
  if (!ready.value || busy.value) return;
  busy.value = true;
  noteActivity();
  // `submit` routes through the wall's write contract, which never throws and
  // never fails silently: a refusal has already toasted the family by the time
  // it resolves false. Keeping the draft is then the correct response — the
  // text is not lost and the person can try again.
  const ok = await props.submit(draft.value.trim());
  busy.value = false;
  if (ok) draft.value = '';
}
</script>

<template>
  <form class="mt-1 flex items-center gap-2" @submit.prevent="onSubmit">
    <input
      v-model="draft"
      type="text"
      :placeholder="placeholder"
      :aria-label="placeholder"
      :disabled="busy"
      class="wall-add-input font-inter dark:border-line-strong dark:bg-surface-ground dark:text-ink text-secondary-500 min-w-0 flex-1 rounded-xl border-[1.5px] border-dashed border-[rgba(44,62,80,0.15)] bg-transparent px-3 focus:border-solid focus:border-[var(--heritage-orange,#F15D22)] focus:bg-white focus:outline-none dark:focus:bg-[var(--color-surface,#1e2a36)]"
      @input="noteActivity"
    />
    <!--
      Held in the DOM rather than `v-if`'d so the row's height never changes as
      you type — on a wall-mounted screen a list that reflows under your finger
      is worse than a button that fades in.
    -->
    <button
      type="submit"
      class="wall-add-go font-outfit text-primary-500 dark:text-accent-lift shrink-0 rounded-xl bg-[var(--tint-orange-15)] font-extrabold transition-opacity duration-150 disabled:opacity-50"
      :class="ready ? '' : 'is-dormant'"
      :disabled="busy || !ready"
      :aria-hidden="!ready"
      :tabindex="ready ? undefined : -1"
      :aria-label="placeholder"
    >
      <span aria-hidden="true">+</span>
    </button>
  </form>
</template>

<style scoped>
/*
 * 44px on both controls: this is the touch floor a child reaches for on a
 * wall-mounted tablet, and it is the same floor `.wall-nav-arrow` and
 * `.wall-switch-btn` already hold. rem-based, so Large reading mode carries it.
 */
.wall-add-input,
.wall-add-go {
  font-size: 0.95rem;
  min-height: 2.75rem;
}

.wall-add-go {
  font-size: 1.15rem;
  width: 2.75rem;
}

/*
 * The collapse lives HERE, not on Tailwind's `w-0`. Tailwind 4 emits utilities
 * inside `@layer utilities`, and an unlayered `\3c style scoped>` rule beats any
 * layered one whatever the specificity, so `.wall-add-go { width: 2.75rem }`
 * silently won and the invisible button kept stealing 44px from the input on
 * every add row.
 */
.wall-add-go.is-dormant {
  min-width: 0;
  opacity: 0;
  overflow: hidden;
  pointer-events: none;
  width: 0;
}

@media (prefers-reduced-motion: reduce) {
  .wall-add-go {
    transition: none;
  }
}
</style>
