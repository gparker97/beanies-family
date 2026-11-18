import { computed, ref } from 'vue';
import type { PlaceRef } from '@/types/models';
import {
  PLACE_FIELDS,
  placePatch,
  type PlaceField,
  type PlacePatch,
} from '@/utils/location/placeText';

/** What a stored entity holds for one location field: its string and its place sibling. */
export type LocationPairSource<F extends PlaceField> = { [K in F]?: string } & {
  [K in (typeof PLACE_FIELDS)[F]]?: PlaceRef;
};

/**
 * One form's location field as the `{ text, place }` pair `LocationField` binds (#150,
 * ADR-049): the string ref, the place ref, the `v-model:value` computed, and the seed, reset
 * and payload lines every form needs. The ONE copy of that plumbing, so no form reads a
 * `*Place` sibling by name.
 *
 * Each form keeps its own spelling of the string it saves: `patch()` writes the text as it
 * stands, and `patch(written)` writes the form's own trimmed / emptied spelling (an explicit
 * `undefined` included). The place goes through `placePatch`, so it is written only when it
 * is valid for exactly that string.
 */
export function useLocationPair<F extends PlaceField>(field: F) {
  const sibling = PLACE_FIELDS[field];
  const text = ref('');
  const place = ref<PlaceRef | undefined>(undefined);

  /** The one `{ text, place }` value `LocationField` binds with `v-model:value`. */
  const value = computed({
    get: () => ({ text: text.value, place: place.value }),
    set: (v: { text: string; place?: PlaceRef }) => {
      text.value = v.text;
      place.value = v.place;
    },
  });

  /**
   * Fill from a stored entity (its string and its place), or empty it. A source that carries
   * only the string (an AI prefill) leaves no place, so a new string never keeps an old pick.
   */
  function seed(source?: LocationPairSource<F> | null): void {
    text.value = source?.[field] ?? '';
    place.value = (source as Record<string, PlaceRef | undefined> | null | undefined)?.[sibling];
  }

  function reset(): void {
    seed(null);
  }

  /** The payload half: the string under `field` and its place under the sibling key. */
  function patch(): PlacePatch<F, string>;
  function patch(written: string): PlacePatch<F, string>;
  function patch(written: string | undefined): PlacePatch<F, string | undefined>;
  function patch(...args: [] | [string | undefined]): PlacePatch<F, string | undefined> {
    return placePatch(field, args.length ? args[0] : text.value, place.value);
  }

  return { text, place, value, seed, reset, patch };
}
