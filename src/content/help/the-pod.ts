import type { HelpArticle } from './types';

/**
 * "The Pod" — the family-life side of beanies.family: each member's profile
 * (Meet the Beans), their health info (Care & Safety), milestones, the
 * scrapbook, the cookbook, and emergency contacts. These all share the
 * `features` category; they live in their own file purely to keep
 * `features.ts` manageable.
 */
export const THE_POD_ARTICLES: HelpArticle[] = [
  {
    slug: 'meet-the-beans',
    category: 'features',
    title: 'Meet the Beans — Each Family Member’s Profile',
    excerpt:
      'Every family member is a “bean” with their own profile — favourites, funny sayings, milestones, health notes, and more. Here’s how to fill one in.',
    icon: '🧑‍🤝‍🧑',
    readTime: 5,
    updatedDate: '2026-05-12',
    sections: [
      {
        type: 'heading',
        content: 'Why each bean has a profile',
        level: 2,
        id: 'why',
      },
      {
        type: 'paragraph',
        content:
          'Money matters, but a family is so much more than a balance sheet. <strong>The Pod</strong> is the part of beanies.family that’s about the <em>people</em> — what your kids love right now, the things they say that you don’t want to forget, the first words and lost teeth, the allergy a babysitter needs to know about. Each family member is a <strong>bean</strong>, and every bean gets their own little profile.',
      },
      {
        type: 'paragraph',
        content:
          'This guide shows you where a bean’s profile lives, what goes in it, and how to add to it.',
      },
      {
        type: 'infoBox',
        content:
          'The Pod is about the <em>person</em> — their favourites, sayings, milestones, and health notes. <strong>Adding or removing family members</strong>, and choosing who can see or edit things (roles and permissions), happens on the <strong>Family page</strong> in Settings — see the <strong>Adding Family Members</strong> guide for that.',
        title: 'The Pod vs. the Family page',
        icon: 'ℹ️',
      },
      {
        type: 'heading',
        content: 'Finding a bean’s profile',
        level: 2,
        id: 'finding',
      },
      {
        type: 'steps',
        content: '',
        items: [
          'In the sidebar, open <strong>The Pod</strong> 🌱 (under the Treehouse), then choose <strong>Meet the Beans</strong>',
          'You’ll see a card for every family member',
          'Tap a bean’s card to open their profile — you’ll land on their <strong>Overview</strong>',
        ],
      },
      {
        type: 'heading',
        content: 'What’s in a bean’s profile',
        level: 2,
        id: 'tabs',
      },
      {
        type: 'paragraph',
        content:
          'Across the top of a bean’s page is a row of tabs. Each one holds a different kind of thing:',
      },
      {
        type: 'list',
        content: '',
        items: [
          '<strong>Overview</strong> — a snapshot: their role and birthday, when they joined the pod, and a peek at everything below',
          '<strong>Favorites</strong> — their favourite food, place, book, song, toy, or anything else, with a note on <em>why it’s a favourite</em>. A favourite <em>food</em> can even link to a recipe in your <strong>Family Cookbook</strong>',
          '<strong>Sayings</strong> — the quotable things they’ve said, with the date, where they said it, and what was going on',
          '<strong>Milestones</strong> — firsts and big moments (first word, lost a tooth, first day of school, a big win). See the <strong>Family Milestones</strong> guide',
          '<strong>Allergies</strong> &amp; <strong>Medications</strong> — health info worth keeping in one place. See the <strong>Allergies &amp; Medications</strong> guide',
          '<strong>Notes</strong> — anything else worth remembering about them',
        ],
      },
      {
        type: 'heading',
        content: 'Adding something to a bean’s profile',
        level: 2,
        id: 'adding',
      },
      {
        type: 'paragraph',
        content: 'There are two easy ways, both on the bean’s page:',
      },
      {
        type: 'steps',
        content: '',
        items: [
          'Tap the <strong>＋ Add Something</strong> button near the top of the page and pick what you’re adding — <strong>💝 Favorite</strong>, <strong>💬 Saying</strong>, <strong>🌟 Milestone</strong>, <strong>📝 Note</strong>, <strong>⚠️ Allergy</strong>, or <strong>💊 Medication</strong>. A short form opens — fill in what you know and tap <strong>Save</strong>',
          'Or open the tab you want (say, <strong>Sayings</strong>) and tap the <strong>Add saying</strong> tile (or <strong>Add the first one</strong> if the tab is empty)',
        ],
      },
      {
        type: 'infoBox',
        content:
          'You only need to fill in what you have. Most fields are optional — a saying just needs the words, a favourite just needs a name. You can always come back and add the date, the photo, or the rest later.',
        title: 'Keep it light',
        icon: '💡',
      },
      {
        type: 'paragraph',
        content:
          'To change something, tap its card to open it again, edit any field, and save. To remove it, use the <strong>delete</strong> option in the same panel — you’ll be asked to confirm first, since deleting can’t be undone.',
      },
      {
        type: 'callout',
        content:
          'Adding or editing a bean’s profile needs <strong>edit access</strong> — the same permission that lets you manage activities and to-dos (owners and admins have it by default). Everyone in your pod can <em>see</em> every bean’s profile; not everyone can change it. You can adjust who has edit access on the Family page in Settings.',
        title: 'Who can edit',
        icon: '🔑',
      },
      {
        type: 'heading',
        content: 'Where this shows up elsewhere',
        level: 2,
        id: 'elsewhere',
      },
      {
        type: 'paragraph',
        content: 'The things you add to a bean’s profile quietly flow into a few other places:',
      },
      {
        type: 'list',
        content: '',
        items: [
          '<strong>The Family Scrapbook</strong> — a flip-through book of everyone’s sayings, favourites, milestones, and notes, with a page for each bean',
          '<strong>Family Milestones</strong> — every bean’s milestones, woven into one family timeline',
          '<strong>Care &amp; Safety</strong> — all of the family’s allergies and active medications in one quick-reference page',
          '<strong>The Family Cookbook</strong> — when a favourite food is linked to a recipe, you can hop straight from the bean to the recipe and back',
        ],
      },
      {
        type: 'heading',
        content: 'Related help',
        level: 2,
        id: 'related',
      },
      {
        type: 'list',
        content: '',
        items: [
          '<strong>Adding Family Members</strong> — invite people to your pod and set their roles',
          '<strong>Allergies &amp; Medications</strong> — keep health info handy for caregivers',
          '<strong>Family Milestones</strong> — capture the firsts and the big moments',
          '<strong>The Family Scrapbook</strong> — your family’s memories, in book form',
        ],
      },
    ],
  },
  {
    slug: 'allergies-and-medications',
    category: 'features',
    title: 'Allergies & Medications (Care & Safety)',
    excerpt:
      'Keep each bean’s allergies and medications in one place — and a quick-reference page anyone caring for your family can check at a glance.',
    icon: '🩺',
    readTime: 5,
    updatedDate: '2026-05-12',
    sections: [
      {
        type: 'heading',
        content: 'Why keep this in beanies.family',
        level: 2,
        id: 'why',
      },
      {
        type: 'paragraph',
        content:
          'When a grandparent, a babysitter, or a new teacher needs to know that your youngest can’t have peanuts — or that someone takes a medication twice a day — that information shouldn’t be scattered across texts, fridge notes, and memory. beanies.family keeps each bean’s <strong>allergies</strong> and <strong>medications</strong> on their profile, and rolls them all up into one calm <strong>Care &amp; Safety</strong> page you (or whoever you share it with) can check in seconds.',
      },
      {
        type: 'callout',
        content:
          'beanies.family is a family organiser, not a medical record system. Keep details brief and practical — enough for a caregiver to act sensibly and call the right person. It doesn’t replace your doctor, a prescription, or a proper allergy action plan.',
        title: 'A quick reality check',
        icon: '⚠️',
      },
      {
        type: 'heading',
        content: 'Recording an allergy',
        level: 2,
        id: 'add-allergy',
      },
      {
        type: 'steps',
        content: '',
        items: [
          'Open the bean’s profile (<strong>The Pod 🌱 → Meet the Beans →</strong> tap the bean), then go to the <strong>Allergies</strong> tab — or tap <strong>＋ Add Something → ⚠️ Allergy</strong> from anywhere on their page',
          'Fill in <strong>What they are allergic to</strong> (e.g. <em>Peanuts</em>)',
          'Pick a <strong>Type</strong> — Food, Medication, Environmental, Contact, or Insect',
          'Pick a <strong>Severity</strong> — Mild, Moderate, or Severe',
          'Optionally add <strong>Things to avoid</strong> (specific foods, brands, places), the usual <strong>Reaction</strong>, the <strong>Emergency response</strong> (what to do, e.g. “use the EpiPen, then call 911”), who <strong>Diagnosed</strong> it, and when it was <strong>Last reviewed</strong>',
          'Tap <strong>Save</strong>',
        ],
      },
      {
        type: 'infoBox',
        content:
          'Severe allergies are flagged clearly and float to the top of the Care &amp; Safety page, so the most important thing is the first thing anyone sees. The <strong>Emergency response</strong> field is the one to fill in carefully — it’s the line a caregiver will read when it matters most.',
        title: 'Severe allergies stand out',
        icon: '💡',
      },
      {
        type: 'heading',
        content: 'Recording a medication',
        level: 2,
        id: 'add-medication',
      },
      {
        type: 'steps',
        content: '',
        items: [
          'On the bean’s profile, go to the <strong>Medications</strong> tab — or tap <strong>＋ Add Something → 💊 Medication</strong>',
          'Enter the <strong>Name</strong> and the <strong>Dose</strong> (e.g. <em>5 mg</em>, <em>one tablet</em>)',
          'Set how often it’s taken: tap a quick option — <strong>Once</strong>, <strong>Twice</strong>, <strong>3×</strong>, <strong>4×</strong> — or choose <strong>Other / as needed</strong> and describe it in your own words. A live <em>“Will display as:”</em> line shows how it’ll read',
          'Add a <strong>Start date</strong>. If it’s a long-term medication, leave <strong>Ongoing</strong> on; otherwise switch it off and set an <strong>End date</strong>',
          'Optionally add <strong>Notes</strong> (with food? in the morning? what it’s for?) and a <strong>Bottle photo</strong>',
          'Tap <strong>Save</strong>',
        ],
      },
      {
        type: 'paragraph',
        content:
          'Medications that have ended don’t clutter the list — they move to a separate <strong>Ended</strong> section so the active ones stay front and centre.',
      },
      {
        type: 'heading',
        content: 'The Care & Safety page',
        level: 2,
        id: 'care-safety',
      },
      {
        type: 'paragraph',
        content:
          'Open <strong>The Pod 🌱 → Care &amp; Safety</strong> for the whole-family view. It pulls together three things:',
      },
      {
        type: 'list',
        content: '',
        items: [
          '<strong>Allergies</strong> — every bean’s allergies, with severe ones first',
          '<strong>Active Medications</strong> — what everyone in the family is currently taking',
          '<strong>Key Contacts</strong> — a peek at your most important emergency contacts, with a link to manage the full list',
        ],
      },
      {
        type: 'paragraph',
        content:
          'You can add an allergy or a medication straight from this page too — beanies.family will ask which bean it’s for first, then open the same form.',
      },
      {
        type: 'infoBox',
        content:
          'This is exactly the page to leave open (or hand your phone to) when someone’s looking after your kids. Everyone in your pod can see it; only family members with edit access can change what’s on it.',
        title: 'Made for handing off',
        icon: '🤝',
      },
      {
        type: 'heading',
        content: 'Editing or removing an entry',
        level: 2,
        id: 'editing',
      },
      {
        type: 'paragraph',
        content:
          'Tap any allergy or medication card to open it, change whatever you need, and save. To remove one, use the <strong>delete</strong> option in that panel and confirm — deleting can’t be undone, so if a medication has simply stopped, consider setting an <strong>End date</strong> instead so you keep the history.',
      },
      {
        type: 'heading',
        content: 'Related help',
        level: 2,
        id: 'related',
      },
      {
        type: 'list',
        content: '',
        items: [
          '<strong>Meet the Beans</strong> — each family member’s profile',
          '<strong>Emergency Contacts</strong> — doctors, school, and the people to call',
          '<strong>How Your Data Is Encrypted</strong> — yes, this is private too',
        ],
      },
    ],
  },
];
