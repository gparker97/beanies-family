import type { BeanieText } from '@/composables/useBeanieText';

/**
 * Rotating messages for the recurring "community nudge" (a gentle, capped
 * Discord invite shown in the notification bell ~every 7-10 days). Flat list,
 * no conditions or categories — rotation is purely positional (the active
 * nudge carries a `messageIndex`). Bilingual `{en, beanie}` like tips/release
 * notes; resolved at render via `useBeanieText().txt(...)`. The kicker label
 * ("From the beanstalk") is a uiString (`communityNudge.label`), not here.
 *
 * House style: en sentence case, beanie all lowercase, no em-dashes.
 */
export const COMMUNITY_NUDGES: readonly BeanieText[] = [
  {
    en: 'The beanies get lonely between visits. Come say hi in our Discord, other families are already there. 🫘',
    beanie:
      'the beanies get lonely between visits. come say hi in our discord, other families are already there. 🫘',
  },
  {
    en: 'Psst… we spill the beans about what’s coming next in Discord before anywhere else.',
    beanie: 'psst… we spill the beans about what’s coming next in discord before anywhere else.',
  },
  {
    en: 'Got a wish for beanies.family? The team (well.. I) read every message in our Discord. Early beans get a real say.',
    beanie:
      'got a wish for beanies.family? the team (well.. i) read every message in our discord. early beans get a real say.',
  },
  {
    en: 'You’re not the only family growing beans. Come meet a few of the others in our Discord.',
    beanie:
      'you’re not the only family growing beans. come meet a few of the others in our discord.',
  },
  {
    en: 'Stuck on something? Real humans (and other families) lend a hand in our Discord.',
    beanie: 'stuck on something? real humans (and other families) lend a hand in our discord.',
  },
  {
    en: 'New features, fixes, and the occasional beanie joke are all dropped first in our Discord.',
    beanie:
      'new features, fixes, and the occasional beanie joke are all dropped first in our discord.',
  },
  {
    en: 'You’re an early bean. Help shape what we build. The conversation’s happening in Discord.',
    beanie:
      'you’re an early bean. help shape what we build. the conversation’s happening in discord.',
  },
  {
    en: 'Two minutes in our Discord = first dibs on new features and a say in what’s next.',
    beanie: 'two minutes in our discord = first dibs on new features and a say in what’s next.',
  },
];

export const COMMUNITY_NUDGE_COUNT = COMMUNITY_NUDGES.length;
