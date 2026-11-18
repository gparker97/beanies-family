import { COMMITTED_FLAGS } from '@/config/featureFlags.committed';

// Address suggestions and call links (#150). The help copy is written ahead of the feature
// and is selected by this constant, which is derived from the COMMITTED flag so it cannot be
// forgotten on flag day and a dev override never publishes help. While false, the new
// article stays out of the index, search, sitemap and llms-full, and the four existing
// articles keep their old wording.
export const ADDRESS_SUGGESTIONS_HELP_LIVE = COMMITTED_FLAGS.placeSuggestions === true;
