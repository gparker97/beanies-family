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
  {
    slug: 'family-milestones',
    category: 'features',
    title: 'Family Milestones',
    excerpt:
      'Catch the firsts and the big moments — first word, lost tooth, new job, new puppy — and keep them in one family timeline, with dates and photos.',
    icon: '🌟',
    readTime: 5,
    updatedDate: '2026-05-12',
    sections: [
      {
        type: 'heading',
        content: 'Why milestones',
        level: 2,
        id: 'why',
      },
      {
        type: 'paragraph',
        content:
          'The first word. The lost tooth. The first day of school, the big test, the new job, the new puppy. These moments go by fast, and a year later it’s hard to remember exactly when. <strong>Family Milestones</strong> is the place to catch them — a date, a few words, maybe a photo — so your family’s story is written down as it happens, all in one timeline.',
      },
      {
        type: 'heading',
        content: 'Two ways to see them',
        level: 2,
        id: 'views',
      },
      {
        type: 'list',
        content: '',
        items: [
          '<strong>The Family Milestones page</strong> — open <strong>The Pod 🌱 → Family Milestones</strong> for one timeline of everyone’s moments, in order (oldest first), like turning the pages of a family album',
          '<strong>A bean’s Milestones tab</strong> — open a bean’s profile (<strong>Meet the Beans →</strong> tap the bean) and go to the <strong>Milestones</strong> tab to see just that person’s moments',
        ],
      },
      {
        type: 'heading',
        content: 'Adding a milestone',
        level: 2,
        id: 'adding',
      },
      {
        type: 'steps',
        content: '',
        items: [
          'On the <strong>Family Milestones</strong> page, tap <strong>Add a milestone</strong>',
          'Choose who it’s <strong>For</strong> — a family member, or <strong>Family</strong> for moments the whole family shares',
          'Pick the <strong>Milestone</strong> — there’s a tidy list grouped into <strong>Firsts</strong>, <strong>Achievements</strong>, <strong>Family Events</strong>, and <strong>Celebrations</strong> (Lost a Tooth, First Day of School, Graduation, New Home, Wedding Day…), or choose <strong>Custom Milestone</strong> and name it yourself',
          'Give it a short <strong>Title</strong> (e.g. <em>“Said ‘doggo’ for the first time”</em>) and set the <strong>Date</strong>',
          'Optionally add a <strong>Description</strong> and <strong>Photos</strong>',
          'Tap <strong>Save</strong>',
        ],
      },
      {
        type: 'infoBox',
        content:
          'You can add a photo to a milestone right away — you just need to have picked who it’s <strong>For</strong> first (a bean, or Family). beanies.family quietly creates the milestone behind the scenes so you can attach the photo, then you fill in the title, date, and the rest. You can also add a milestone straight from a bean’s profile (the <strong>Milestones</strong> tab, or <strong>＋ Add Something → 🌟 Milestone</strong>) — same form, already set to that bean.',
        title: 'Adding a photo to a milestone',
        icon: '💡',
      },
      {
        type: 'heading',
        content: 'Family-wide milestones',
        level: 2,
        id: 'family-wide',
      },
      {
        type: 'paragraph',
        content:
          'Not every moment belongs to one person. Moving into a new home, welcoming a new little bean, a big trip, a wedding day, an anniversary — choose <strong>Family</strong> as the “For” when you add these. They show up on the timeline with a <strong>Family</strong> tag and aren’t tied to a single bean.',
      },
      {
        type: 'heading',
        content: 'Filtering the timeline',
        level: 2,
        id: 'filtering',
      },
      {
        type: 'paragraph',
        content:
          'Once the timeline gets long, use the filters at the top of the Family Milestones page: narrow by <strong>Beans</strong>, narrow by <strong>Categories</strong>, and toggle whether <strong>family-wide</strong> milestones are shown. On the timeline, tapping one of a bean’s milestones jumps you to that bean’s <strong>Milestones</strong> tab.',
      },
      {
        type: 'paragraph',
        content:
          'To change a milestone, tap it to open it, edit any field, and save. To remove it, use the <strong>delete</strong> option and confirm — deleting can’t be undone.',
      },
      {
        type: 'infoBox',
        content:
          'Photos you add to a milestone are saved to your <strong>Google Drive</strong> (not packed into your pod file), in the same private folder your pod lives in, and shared with everyone in your family. A link to each photo is kept inside your encrypted pod. See <strong>Adding Photos</strong> for the full picture — and note you’ll need Google Drive turned on to add them.',
        title: 'Where milestone photos go',
        icon: '📷',
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
          '<strong>The Family Scrapbook</strong> — flip through your family’s memories',
          '<strong>Adding Photos</strong> — attach pictures to milestones, recipes, and more',
        ],
      },
    ],
  },
  {
    slug: 'the-family-scrapbook',
    category: 'features',
    title: 'The Family Scrapbook',
    excerpt:
      'A digital memory-book you can flip through — a page for each family member, plus an “Everyone” page — filled in automatically from the things you add to your beans.',
    icon: '📖',
    readTime: 4,
    updatedDate: '2026-05-12',
    sections: [
      {
        type: 'heading',
        content: 'What the scrapbook is',
        level: 2,
        id: 'what',
      },
      {
        type: 'paragraph',
        content:
          'The <strong>Family Scrapbook</strong> is a little book you can flip through — a page (a “spread”) for each family member, plus an <strong>Everyone</strong> page for the family as a whole. It doesn’t ask you to do anything new: it’s simply the lovely way to look back at the favourites, sayings, big moments, and notes you’ve already added to your beans. Think of it as the photo album on the shelf — except it fills itself in as you go.',
      },
      {
        type: 'heading',
        content: 'Opening the scrapbook',
        level: 2,
        id: 'opening',
      },
      {
        type: 'paragraph',
        content: 'In the sidebar, open <strong>The Pod 🌱 → Family Scrapbook</strong>.',
      },
      {
        type: 'heading',
        content: 'Flipping through it',
        level: 2,
        id: 'flipping',
      },
      {
        type: 'paragraph',
        content:
          'There’s a spine down the side with everyone’s names. Tap a name to flip to that bean’s page, or tap <strong>Everyone</strong> for the family page — the pages turn with a little animation, just like a real book. On a phone, the spine and page-turns work the same way; you’ll just see one page at a time.',
      },
      {
        type: 'heading',
        content: 'What’s on each page',
        level: 2,
        id: 'pages',
      },
      {
        type: 'list',
        content: '',
        items: [
          'A <strong>bean’s page</strong> shows <strong>Things they say</strong> (their sayings), <strong>Favorites</strong>, <strong>Big moments</strong> (their milestones), and <strong>About them</strong> (notes). Each section has a <strong>see all →</strong> that hops to the matching tab on their profile',
          'The <strong>Everyone</strong> page gathers the family’s shared moments and what’s been added across the pod lately',
        ],
      },
      {
        type: 'heading',
        content: 'Adding to the scrapbook',
        level: 2,
        id: 'adding',
      },
      {
        type: 'steps',
        content: '',
        items: [
          'Tap <strong>Add to scrapbook</strong> at the top of the page',
          'Pick what you want to add — a <strong>saying</strong>, a <strong>favourite</strong>, a <strong>note</strong>, or a <strong>milestone</strong>',
          'Fill in the quick form and save — it lands on the right page automatically',
        ],
      },
      {
        type: 'infoBox',
        content:
          'The scrapbook doesn’t have its own separate “stuff” — everything in it lives on your beans’ profiles (and in Family Milestones). To edit or delete an entry, open it from there — or tap the <strong>see all →</strong> link in the scrapbook to get straight to it. The scrapbook just reflects what’s there.',
        title: 'It’s a view, not a store',
        icon: 'ℹ️',
      },
      {
        type: 'callout',
        content:
          'A page looking a bit bare just means there’s nothing on that bean’s profile yet — add a saying or a favourite and it’ll appear. Every family member gets a page, pet beans included.',
        title: 'Empty pages aren’t a bug',
        icon: '💡',
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
          '<strong>Meet the Beans</strong> — fill in a bean’s profile',
          '<strong>Family Milestones</strong> — the firsts and the big moments',
          '<strong>Adding Photos</strong> — pictures across the Pod',
        ],
      },
    ],
  },
  {
    slug: 'add-a-recipe-from-anywhere',
    category: 'features',
    title: 'Add a Recipe From Anywhere',
    excerpt:
      'Point beanies at a photo, a PDF, a recipe link or a cooking video, and it writes the recipe into your cookbook for you to check.',
    icon: '🍳',
    readTime: 5,
    updatedDate: '2026-08-25',
    popular: true,
    sections: [
      {
        type: 'heading',
        content: 'Why this exists',
        level: 2,
        id: 'why',
      },
      {
        type: 'paragraph',
        content:
          'Recipes turn up everywhere — a photo of Grandma’s index card, a screenshot from the family chat, a food blog, a YouTube video. Typing all of that in by hand is the reason most family cookbooks stay empty. Hand beanies whatever you have, and it fills in the ingredients, steps, times and servings for you to check before anything is saved.',
      },
      {
        type: 'paragraph',
        content:
          'You still get the final say. Nothing goes into your cookbook until you press <strong>Save</strong> — the form that opens is your chance to read it over and fix anything.',
      },
      {
        type: 'heading',
        content: 'Starting a recipe reading',
        level: 2,
        id: 'starting',
      },
      {
        type: 'steps',
        content: '',
        items: [
          'Open <strong>The Pod 🌱 → Family Cookbook</strong>',
          'Tap <strong>Read a Recipe</strong> at the top of the page (next to <strong>Add a recipe</strong>)',
          'The first time, beanies asks your permission to send this one recipe to be read — have a look at what it says, then agree',
          'Paste your link straight into the box that opens, then tap <strong>Read It</strong>. Reading from a photo or a PDF instead? <strong>Take a photo</strong> and <strong>Choose a file</strong> are just underneath.',
          'You can also start from a link inside <strong>Add a recipe</strong> itself — there’s a <strong>Start from a link</strong> box at the top of the blank form, and it works the same way from the meal planner.',
        ],
      },
      {
        type: 'infoBox',
        content:
          'You can also start from the <strong>+</strong> button anywhere in the app — look for the <strong>Magic beans</strong> card and tap <strong>Recipe 🍳</strong>. It takes you to the cookbook and opens the reader.',
        title: 'A shortcut from anywhere',
        icon: '✨',
      },
      {
        type: 'infoBox',
        content:
          'On a phone, you do not have to start in beanies at all. Wherever the recipe already is \u2014 a photo, a screenshot, a PDF \u2014 tap <strong>Share</strong> and choose <strong>beanies.family</strong>. See <strong>Share Something Straight to beanies</strong>.',
        title: 'Straight from another app',
        icon: '\u{1F4E4}',
      },
      {
        type: 'heading',
        content: 'From a photo or a PDF',
        level: 2,
        id: 'photo',
      },
      {
        type: 'paragraph',
        content:
          'Take a photo of a cookbook page or a recipe card, choose a screenshot from your phone, or pick a PDF. beanies reads it and opens the recipe form already filled in. Once you save, the original photo or PDF is attached to the recipe, so you always have the thing you started from.',
      },
      {
        type: 'infoBox',
        content:
          'Long PDFs are read a few pages at a time. If yours is longer, beanies tells you — and the whole file is still attached to the recipe, so nothing is lost.',
        title: 'Long documents',
        icon: '📄',
      },
      {
        type: 'heading',
        content: 'From a recipe website',
        level: 2,
        id: 'link',
      },
      {
        type: 'paragraph',
        content:
          'Choose <strong>Paste a Link</strong> and drop in the address of a recipe page. Most recipe sites publish their ingredients and steps in a form beanies can read <em>exactly</em> — when that happens, the quantities come straight from the site rather than being worked out, so nothing can be misread. The link is saved with the recipe, so you can always get back to the original.',
      },
      {
        type: 'callout',
        content:
          'Some websites don’t allow apps to read their pages. If that happens beanies will tell you plainly rather than guessing — open the page yourself and paste the recipe text instead, or try the site’s “print” version.',
        title: 'Not every site will let us in',
        icon: '🚧',
      },
      {
        type: 'heading',
        content: 'From a YouTube video',
        level: 2,
        id: 'youtube',
      },
      {
        type: 'paragraph',
        content:
          'Paste a video link and beanies tries the most reliable route first: many cooking channels put the full recipe on their own website and link it in the description, so if there’s a link there, beanies follows it and reads the real recipe — exact quantities and all. If there isn’t a link, beanies reads the video’s own description, which is where a lot of cooks paste the whole recipe.',
      },
      {
        type: 'callout',
        content:
          'beanies reads what a video <em>writes</em> — its description and any recipe link — not what it says out loud. If a video keeps the recipe only in the narration or on screen, beanies will say it can’t read that one rather than inventing a recipe from the title. That’s deliberate — a made-up quantity in a recipe is worse than no recipe at all. If that happens, check the description for a link to the cook’s website and paste that instead.',
        title: 'Some videos can’t be read',
        icon: '🎬',
      },
      {
        type: 'callout',
        content:
          'Cooks often keep the exact amounts in the video itself — spoken aloud, or on screen as “add the flour” while <em>250g</em> sits in the corner. beanies reads the description, not the video, so it can only pass on what the cook wrote down. When the description links the full recipe you get exact amounts; when it doesn’t, check them against the video before you cook.',
        title: 'Watch the quantities on videos',
        icon: '⚖️',
      },
      {
        type: 'heading',
        content: 'Checking before you save',
        level: 2,
        id: 'checking',
      },
      {
        type: 'paragraph',
        content:
          'The recipe form opens with everything filled in. Read it over, fix anything that looks off, and add your own <strong>Family notes</strong>. Nothing is saved until you tap <strong>Save</strong>.',
      },
      {
        type: 'callout',
        content:
          'If beanies had to fill in an amount or a timing itself — because the source didn’t say — it lists those lines in orange under <strong>Ingredients</strong> and <strong>Preparation steps</strong>. Those are the ones worth checking against the original before you cook.',
        title: 'Anything we guessed is flagged',
        icon: '🟠',
      },
      {
        type: 'heading',
        content: 'What about the photo?',
        level: 2,
        id: 'photo-of-dish',
      },
      {
        type: 'paragraph',
        content:
          'When a recipe comes from a website, beanies saves a copy of that site’s own photo of the dish into your pod. It’s a real copy, not a link — so the picture keeps working even if the website changes, and viewing your recipe never reaches out to anyone else’s server. You can replace it with your own photo any time.',
      },
      {
        type: 'infoBox',
        content:
          'Photos need Google Drive turned on. Without it the recipe still saves perfectly — you just won’t get the picture or the attached original. See <strong>Adding Photos</strong>.',
        title: 'Photos need cloud sync',
        icon: '💡',
      },
      {
        type: 'heading',
        content: 'Where your recipe goes while it’s being read',
        level: 2,
        id: 'privacy',
      },
      {
        type: 'paragraph',
        content:
          'The recipe you hand over is sent to be read through the same private path beanies uses for reading invitations and travel bookings — and only that one recipe. Your family’s data isn’t sent, nothing is kept after it’s read, and beanies asks your permission each time before anything leaves your device.',
      },
      {
        type: 'paragraph',
        content:
          'If you’d rather not use it at all, simply don’t — typing a recipe in by hand works exactly as it always has.',
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
          '<strong>The Family Cookbook</strong> — recipes, the cook log, and adding one by hand',
          '<strong>Adding Photos</strong> — how photos and attachments work',
        ],
      },
    ],
  },
  {
    slug: 'the-family-cookbook',
    category: 'features',
    title: 'The Family Cookbook',
    excerpt:
      'Keep the recipes that get passed down — the story behind them, the photos, and a log of every time someone makes them.',
    icon: '🍜',
    readTime: 5,
    updatedDate: '2026-08-25',
    sections: [
      {
        type: 'heading',
        content: 'Why a family cookbook',
        level: 2,
        id: 'why',
      },
      {
        type: 'paragraph',
        content:
          'The recipes that get handed down — Grandma’s bolognese, the birthday cake everyone asks for — usually live on a stained index card or in someone’s head. The <strong>Family Cookbook</strong> keeps them safe in one place: the ingredients and steps, the little story behind them, photos, and a running log of every time someone in the family cooks one.',
      },
      {
        type: 'heading',
        content: 'Opening the cookbook',
        level: 2,
        id: 'opening',
      },
      {
        type: 'paragraph',
        content:
          'In the sidebar, open <strong>The Pod 🌱 → Family Cookbook</strong> (you’ll see it titled <em>“Secret Family Recipes”</em> — shhh 🤫). There’s also a shortcut on the <strong>Meet the Beans</strong> page.',
      },
      {
        type: 'heading',
        content: 'Adding a recipe',
        level: 2,
        id: 'adding',
      },
      {
        type: 'callout',
        content:
          'Don’t fancy typing it all in? Tap <strong>Read a Recipe</strong> instead and hand beanies a photo, a PDF, a recipe link or a cooking video — it fills the whole thing in for you to check. See <strong>Add a Recipe From Anywhere</strong>.',
        title: 'There’s a quicker way',
        icon: '🍳',
      },
      {
        type: 'paragraph',
        content: 'To type one in yourself:',
      },
      {
        type: 'steps',
        content: '',
        items: [
          'Tap <strong>Add a recipe</strong>',
          'Give it a <strong>Recipe name</strong> (e.g. <em>“Grandma’s Bolognese”</em>) and, if you like, a <strong>Subtitle</strong> for the story behind it (<em>“passed down from Mary, ~1972”</em>)',
          'Add the <strong>Prep time</strong>, <strong>Cook time</strong> and <strong>Servings</strong>',
          'List the <strong>Ingredients</strong> — one per line — and the <strong>Preparation steps</strong>, also one step per line',
          'Add any <strong>Family notes</strong> (the little things — <em>“Neil asks for this every Sunday”</em>) and <strong>Photos</strong>',
          'Tap <strong>Save</strong>',
        ],
      },
      {
        type: 'infoBox',
        content:
          'Add the recipe’s name first — then you can attach photos. (Photos also need Google Drive turned on; see <strong>Adding Photos</strong>.)',
        title: 'A note on photos',
        icon: '💡',
      },
      {
        type: 'heading',
        content: 'Inside a recipe',
        level: 2,
        id: 'detail',
      },
      {
        type: 'paragraph',
        content:
          'Tap a recipe card to open its page. You’ll find the <strong>Ingredients</strong>, <strong>How to make it</strong> (the steps), the <strong>Family notes</strong>, and the <strong>Cook Log</strong>.',
      },
      {
        type: 'paragraph',
        content:
          'If the recipe came from a website, you’ll also see a small 🔗 link back to where it came from — handy when you want the original’s photos or the writer’s notes.',
      },
      {
        type: 'heading',
        content: 'The Cook Log',
        level: 2,
        id: 'cook-log',
      },
      {
        type: 'paragraph',
        content:
          'Every time you make a recipe, tap <strong>I cooked this today</strong> — give it a rating, and (if you want) add a photo of how it turned out. Over time the recipe builds its own little history: how many times it’s been cooked and its average rating. It’s a quiet way to see which recipes the family actually loves.',
      },
      {
        type: 'infoBox',
        content:
          'If a family member has a favourite <em>food</em>, you can link it to a recipe in the cookbook — open their <strong>Favorites</strong> tab and choose (or add) the recipe. Then you can hop from the bean to the recipe and back.',
        title: 'Linked to a bean’s favourites',
        icon: 'ℹ️',
      },
      {
        type: 'paragraph',
        content:
          'To change a recipe, open it, edit any field, and save. To remove it, use the <strong>delete</strong> option and confirm — deleting can’t be undone, and the cook log goes with it.',
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
          '<strong>Add a Recipe From Anywhere</strong> — read a recipe in from a photo, a link or a video',
          '<strong>Meet the Beans</strong> — link a recipe to a bean’s favourite food',
          '<strong>Adding Photos</strong> — attach pictures to recipes and cook-log entries',
        ],
      },
    ],
  },
  {
    slug: 'emergency-contacts',
    category: 'features',
    title: 'Emergency Contacts',
    excerpt:
      'Your family phonebook — doctors, school, dentists, sitters — kept where anyone looking after your family can find it.',
    icon: '🆘',
    readTime: 3,
    updatedDate: '2026-05-12',
    sections: [
      {
        type: 'heading',
        content: 'Why keep a contacts list here',
        level: 2,
        id: 'why',
      },
      {
        type: 'paragraph',
        content:
          'When something comes up and you’re not the one at home — a grandparent is babysitting, a friend is doing the school run — whoever <em>is</em> there needs the doctor’s number, the school’s, the dentist’s, fast. <strong>Emergency Contacts</strong> is your family phonebook: the people you’d want a sitter or a grandparent to be able to reach in a pinch, all in one place.',
      },
      {
        type: 'heading',
        content: 'Opening it',
        level: 2,
        id: 'opening',
      },
      {
        type: 'paragraph',
        content:
          'In the sidebar, open <strong>The Pod 🌱 → Emergency Contacts</strong>. A peek at your key contacts also appears on the <strong>Care &amp; Safety</strong> page, with a link through to the full list.',
      },
      {
        type: 'heading',
        content: 'Adding a contact',
        level: 2,
        id: 'adding',
      },
      {
        type: 'steps',
        content: '',
        items: [
          'Tap <strong>Add contact</strong>',
          'Pick a <strong>Category</strong> — Doctor, Dentist, Nurse, Teacher, School, or Other (you can type your own)',
          'Enter the <strong>Name</strong> and a <strong>Role or relationship</strong> (e.g. <em>“Pediatrician at Bayside Clinic”</em>)',
          'Add whatever you have — <strong>Phone</strong>, <strong>Email</strong>, <strong>Address</strong> — and any <strong>Notes</strong>',
          'Tap <strong>Save</strong>',
        ],
      },
      {
        type: 'heading',
        content: 'Finding and using a contact',
        level: 2,
        id: 'using',
      },
      {
        type: 'paragraph',
        content:
          'Each contact has a <strong>Call</strong> and an <strong>Email</strong> button — on a phone they dial the number or open a new email straight away. There’s a search box (search by name, role, or phone) and a category filter at the top, which come in handy once the list grows.',
      },
      {
        type: 'paragraph',
        content:
          'To change a contact, tap it to open it, edit, and save. To remove it, use the <strong>delete</strong> option and confirm.',
      },
      {
        type: 'infoBox',
        content:
          'This is exactly the page to point a babysitter or a visiting grandparent to. Everyone in your pod can see the contacts list; only family members with edit access can change it.',
        title: 'Keep it where everyone can find it',
        icon: '🤝',
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
          '<strong>Allergies &amp; Medications</strong> — the rest of the Care &amp; Safety page',
          '<strong>The Family Nook</strong> — your family’s home base',
        ],
      },
    ],
  },
  {
    slug: 'adding-photos',
    category: 'features',
    title: 'Adding Photos',
    excerpt:
      'Attach photos to milestones, recipes, medications, activities, and your beans’ profile pictures — and understand how they’re stored.',
    icon: '📷',
    readTime: 4,
    updatedDate: '2026-05-12',
    sections: [
      {
        type: 'heading',
        content: 'Where photos show up',
        level: 2,
        id: 'where',
      },
      {
        type: 'paragraph',
        content:
          'A picture says a lot. In beanies.family you can attach photos to several things: a <strong>milestone</strong> (the first-day-of-school shot), a <strong>recipe</strong> and its cook-log entries (how it turned out), a <strong>medication</strong> (a photo of the bottle or label), an <strong>activity or event</strong> in the Family Planner, and a family member’s <strong>profile photo</strong> (their avatar). Anything with photos shows them in the <strong>Family Scrapbook</strong> too.',
      },
      {
        type: 'heading',
        content: 'Where your photos are kept',
        level: 2,
        id: 'storage',
      },
      {
        type: 'paragraph',
        content:
          'Photos work a little differently from the rest of your family data. Your pod — accounts, to-dos, milestones, all of it — is <strong>encrypted</strong>. Photos aren’t: each one is saved as an ordinary image file in <strong>your own Google Drive</strong>, in the same private <code>beanies.family</code> folder your pod lives in, and a link to it is stored inside your encrypted pod. Photos are simply too big to pack into the pod file — so this keeps your pod small and fast, and your pictures sit in <em>your</em> Drive, alongside the rest of your photos and files.',
      },
      {
        type: 'paragraph',
        content:
          'When you add a photo, beanies.family resizes it to a sensible size and saves it as a JPEG before uploading — so it loads quickly, though it won’t be the exact original file. Everyone in your pod can see each other’s photos, because that Drive folder is shared with all your family members.',
      },
      {
        type: 'callout',
        content:
          'Because photos live on Google Drive, <strong>you need Google Drive turned on</strong> to add them. If your pod currently lives in a local file, beanies.family will point you to <strong>Settings</strong> to connect Google Drive first. See <strong>Connecting Google Drive</strong> and <strong>Moving your pod between local file and Google Drive</strong>.',
        title: 'Photos need Google Drive',
        icon: '☁️',
      },
      {
        type: 'infoBox',
        content:
          'A bit of detail for the curious: each photo’s link is a long, unguessable Google address, and those links live only inside your encrypted pod — which only your family can open. So in everyday terms your photos are visible to your family, just like everything else here. They’re not <em>separately</em> encrypted the way your pod is, though — worth knowing if you’re ever attaching something especially private.',
        title: 'A note on photo privacy',
        icon: 'ℹ️',
      },
      {
        type: 'heading',
        content: 'Adding a photo',
        level: 2,
        id: 'adding',
      },
      {
        type: 'steps',
        content: '',
        items: [
          'Open the thing you want a photo on — a milestone, a recipe, a medication, an activity, or a bean’s profile',
          'Tap <strong>Add Photos</strong> (or <strong>Add Photo</strong>) where the photos go',
          'Choose <strong>Take Photo</strong> (on a phone) or <strong>From Library</strong> — or just drag a photo onto the spot',
          'It uploads and attaches. Repeat to add more (up to the limit below)',
        ],
      },
      {
        type: 'list',
        content: '',
        items: [
          'Most forms let you attach a photo straight away. A few want a detail or two first — a recipe needs a name, a medication needs its name, dose, and frequency, a milestone needs you to have picked who it’s for — and will show a small hint if something’s missing',
          'You can attach <strong>up to 4 photos</strong> to most items. A few — a profile photo, a medication’s bottle photo — take just one',
          '<strong>HEIC</strong> photos (the iPhone default) can’t always be read in the browser. If one won’t go, save or export it as a <strong>JPEG</strong> first',
          'If you’re <strong>offline</strong> when you add a photo, it waits in a queue and uploads automatically once you’re back online',
        ],
      },
      {
        type: 'heading',
        content: 'Viewing & removing photos',
        level: 2,
        id: 'viewing',
      },
      {
        type: 'paragraph',
        content:
          'Tap a photo to open it full-size — you can flip between photos and download one if you want. To take a photo off, use <strong>Remove</strong> on it (or <strong>Replace</strong> to swap it for another) — you’ll be asked to confirm first.',
      },
      {
        type: 'infoBox',
        content:
          'Items that have photos show a little badge (e.g. <em>“2 photos attached”</em>), so you can spot them at a glance — handy on the Family Planner and in the Scrapbook.',
        title: 'A small photo badge',
        icon: 'ℹ️',
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
          '<strong>Connecting Google Drive</strong> — required before you can add photos',
          '<strong>Moving your pod between local file and Google Drive</strong> — switch your pod over',
          '<strong>How Your Data Is Encrypted</strong> — what’s inside the encrypted pod (including the links to your photos)',
        ],
      },
    ],
  },
];
