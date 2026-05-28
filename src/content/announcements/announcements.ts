/**
 * Adhoc announcement entries — newest first. Add an object; the registry
 * (`index.ts`) sorts + exposes them and the deriver turns each into an
 * `announcement` notification. Stable `id` is the read-state key — NEVER reuse.
 *
 * PUBLIC CONTENT (repo + JS bundle): keep every string user-facing and safe.
 */
import type { Announcement } from './index';

export const ANNOUNCEMENTS: Announcement[] = [
  {
    id: 'discord-community-2026-05',
    date: '2026-05-28',
    month: '28 may 2026',
    autoOpen: true,
    icon: '💬',
    kicker: { en: 'A note from greg', beanie: 'a note from greg' },
    title: { en: 'Join us on Discord!', beanie: 'join us on discord!' },
    message: {
      en: "There's nothing I love more than chatting with my early-adopter beanies. You are a key part of the evolution of beanies, and I'd love to know what you like (or hate) about our lovely app so I can make it better. Join me on Discord - I'm there all the time, so if you see anything good, bad, or ugly about the platform you can report it to me directly. Feedback, bugs, error reports, etc - it's all good. Hope to see you there!",
      beanie:
        "there's nothing i love more than chatting with my early adopter beanies. you are a key part of the evolution of beanies, and i'd love to know what you like (or hate) about our lovely app so i can make it better. join me on discord - i'm there all the time, so if you see anything good, bad, or ugly about the platform you can report it to me directly. feedback, bugs, error reports, etc - it's all good. hope to see you there!",
    },
    note: {
      en: 'The link below will expire after a certain number of uses, so get in now before my early-adopter community is full!!',
      beanie:
        'the link below will expire after a certain number of uses, so get in now before my early adopter community is full!!',
    },
    cta: {
      label: { en: 'Join us on Discord', beanie: 'join us on discord' },
      href: 'https://discord.gg/NE4grWzjxV',
    },
  },
];
