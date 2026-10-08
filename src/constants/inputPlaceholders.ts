/**
 * Placeholder for URL inputs (a format hint, not prose, so it is not translated).
 *
 * Bind it (`:placeholder="URL_PLACEHOLDER"`); never write `placeholder="https://..."` as a
 * static attribute. vue-tsc 3.3.12 turns the `//` in a static attribute into a broken
 * comment in its generated code, and every template expression after it loses `v-if`
 * narrowing (it surfaced as "activity.value is possibly null" in ActivityViewEditModal).
 */
export const URL_PLACEHOLDER = 'https://...';
