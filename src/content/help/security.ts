import type { HelpArticle } from './types';

// #32 Google Calendar integration — HELD until launch. Flip CALENDAR_SYNC_HELP_LIVE
// to true (together with the `googleCalendarSync` feature flag) to publish this on
// the Help Center. Kept type-checked (not commented out) so it can't rot.
const CALENDAR_SYNC_HELP_LIVE = false;
const CALENDAR_SYNC_ARTICLE: HelpArticle = {
  slug: 'google-calendar-sync',
  category: 'security',
  title: 'How beanies Syncs Your Activities to Google Calendar',
  excerpt:
    'Connect a Google calendar and your family activities appear there automatically — one-way, with beanies as the source of truth.',
  icon: '\u{1F4C5}',
  readTime: 4,
  updatedDate: '2026-06-10',
  sections: [
    { type: 'heading', content: 'How it works', level: 2, id: 'how-it-works' },
    {
      type: 'paragraph',
      content:
        'Connect a Google calendar in <strong>Settings → Google Calendar</strong> and beanies pushes your family activities straight into the calendar you already use. It is <strong>one-way</strong>: beanies stays the single source of truth and your activities flow out to your calendars, never the other way around. Make every change in beanies; the calendar simply mirrors it.',
    },
    { type: 'heading', content: 'It covers the whole family', level: 2, id: 'family-wide' },
    {
      type: 'paragraph',
      content:
        'A connected calendar is shared across your family. <strong>Every</strong> family activity is pushed to it, no matter who added it, so a connected calendar always shows the full family schedule, not just your own events.',
    },
    { type: 'heading', content: 'What gets sent', level: 2, id: 'what-gets-sent' },
    {
      type: 'paragraph',
      content:
        'beanies sends the activity’s title, date and time, and packs the extra details it tracks (who is going, drop-off and pick-up, instructor, cost, and notes) into the event’s description, formatted to read cleanly. Every event beanies creates is marked <strong>“Synced from beanies.family”</strong> and links back to the activity in the app.',
    },
    { type: 'heading', content: 'Editing and removing', level: 2, id: 'editing' },
    {
      type: 'list',
      content: '',
      items: [
        'Edit an activity in beanies and the change syncs to your calendar.',
        'If you edit a synced event directly in Google, beanies restores its own version on the next sync, so always edit in beanies.',
        'Disconnect a calendar any time in Settings; beanies removes the events it added and stops syncing. Your activities stay safe in beanies.',
      ],
    },
    { type: 'heading', content: 'When it syncs', level: 2, id: 'when' },
    {
      type: 'paragraph',
      content:
        'Syncing happens while beanies is open on any of your devices. Add an activity on your phone and it appears in your calendar shortly after; if the app was closed, it catches up the next time you open it.',
    },
    { type: 'heading', content: 'Your privacy', level: 2, id: 'privacy' },
    {
      type: 'paragraph',
      content:
        'beanies only ever creates and updates <strong>its own</strong> events; it never reads or changes anything else in your calendar. Events go from your device straight to your own Google account and never pass through a beanies server.',
    },
    {
      type: 'infoBox',
      content:
        'Connecting a calendar lets beanies keep it in sync from any of your family’s devices, and the connection is shared with your family the same way your other family data is. Connect only the calendars you’re happy for your family to sync to.',
      title: 'Shared with your family',
      icon: '\u{1F465}',
    },
  ],
};

// #34 External-calendar clash nudge — LIVE alongside the `calendarClashNudge`
// flag (2026-06-12), so the "What's this?" link in the activity drawer resolves
// for Beanie Lab testers. Flipping this publishes the article fully: a resolvable
// page AND a listing in the help index + sitemap + llms-full (the calendar/clash
// features themselves remain Lab-gated, so this is documentation only).
const CLASH_NUDGE_HELP_LIVE = true;
const CLASH_NUDGE_ARTICLE: HelpArticle = {
  slug: 'external-calendar-clash-nudge',
  category: 'security',
  title: 'Clash Warnings From Your Other Calendars',
  excerpt:
    'beanies can gently warn you when a family activity overlaps something on a connected calendar — reading only when your events are, never what they are.',
  icon: '\u{1F4C5}',
  readTime: 3,
  updatedDate: '2026-06-11',
  sections: [
    { type: 'heading', content: 'What it does', level: 2, id: 'what-it-does' },
    {
      type: 'paragraph',
      content:
        'Once you’ve connected a calendar, beanies can give you a gentle heads-up when a family activity lands at the same time as something already on that calendar — a work meeting, an appointment, anything beanies can’t otherwise see. It’s a subtle nudge on the planner, not an error or a blocker.',
    },
    { type: 'heading', content: 'It reads only when, never what', level: 2, id: 'times-only' },
    {
      type: 'paragraph',
      content:
        'To find a clash, beanies asks your calendar for just the <strong>start and end times</strong> of your events — using a request that lists times only and leaves out the title, notes, location, and guests. None of that content is ever requested or read, so it never reaches beanies. The check runs from your device straight to your own Google account, never passes through a beanies server, and nothing is saved.',
    },
    {
      type: 'paragraph',
      content:
        'beanies also recognises its own synced activities and skips them, so it never warns you about a clash with itself. Events you’ve marked as <strong>“free”</strong> (like some birthdays or public holidays) don’t count as a clash either.',
    },
    { type: 'heading', content: 'Quieting an overlap', level: 2, id: 'quieting' },
    {
      type: 'paragraph',
      content:
        'Some overlaps are completely expected, and you don’t need to be reminded every time. Open the activity and tap <strong>“This is OK”</strong> — the warning shrinks to a small quiet mark, and that choice is remembered for your whole family across devices. Changed your mind? Open it again and tap <strong>Undo</strong>. Nothing is ever deleted: because a clash is worked out from live calendar data, beanies keeps the mark so a real conflict can never be hidden for good. And if you later <strong>reschedule</strong> the activity to a new time, the warning quietly comes back — so a brand-new overlap still gets your attention.',
    },
    { type: 'heading', content: 'Turning it on or off', level: 2, id: 'toggle' },
    {
      type: 'paragraph',
      content:
        'The warning is on by default once a calendar is connected. Turn it off any time in <strong>Settings → Google Calendar</strong> — the warnings disappear and beanies stops reading your event times.',
    },
    {
      type: 'infoBox',
      content:
        'beanies never writes anything to your calendar. The clash warning is read-only and reads only your events’ times, never their content — a heads-up, nothing more.',
      title: 'Read-only and private',
      icon: '\u{1F512}',
    },
  ],
};

export const SECURITY_ARTICLES: HelpArticle[] = [
  {
    slug: 'how-your-data-is-encrypted',
    category: 'security',
    title: 'How Your Data Is Encrypted',
    excerpt:
      'AES-256-GCM encryption with PBKDF2 key derivation. Your data is encrypted before it ever leaves your device.',
    icon: '\u{1F510}',
    readTime: 5,
    popular: true,
    updatedDate: '2026-03-09',
    sections: [
      {
        type: 'heading',
        content: 'Encryption at a glance',
        level: 2,
        id: 'at-a-glance',
      },
      {
        type: 'paragraph',
        content:
          'Every piece of data in your pod is encrypted using <strong>AES-256-GCM</strong> \u2014 the same standard used by banks and governments. Your password never leaves your device.',
      },
      {
        type: 'heading',
        content: 'How it works',
        level: 2,
        id: 'how-it-works',
      },
      {
        type: 'steps',
        content: '',
        items: [
          'When you create a pod, a random 256-bit <strong>family key</strong> is generated',
          'Your password is run through <strong>PBKDF2</strong> (100,000 rounds, SHA-256) with a random 16-byte salt to derive a wrapping key',
          'The family key is wrapped (encrypted) with your wrapping key using <strong>AES-KW</strong>',
          'All your family data (Automerge binary) is encrypted with the family key using <strong>AES-GCM</strong> with a random 12-byte IV',
          'The encrypted payload, wrapped keys, and salts are stored in the <code>.beanpod</code> file',
        ],
      },
      {
        type: 'heading',
        content: 'Key details',
        level: 2,
        id: 'key-details',
      },
      {
        type: 'list',
        content: '',
        items: [
          '<strong>Algorithm:</strong> AES-256-GCM (encryption) + AES-KW (key wrapping)',
          '<strong>Key derivation:</strong> PBKDF2 with 100,000 iterations, SHA-256, 16-byte random salt',
          '<strong>IV:</strong> 12 bytes, randomly generated for each save',
          '<strong>Implementation:</strong> Web Crypto API (native browser cryptography)',
        ],
      },
      {
        type: 'callout',
        content:
          'All encryption happens in your browser using the native Web Crypto API. No keys, passwords, or unencrypted data are ever transmitted to any server.',
        title: 'Client-side only',
        icon: '\u{1F6E1}\uFE0F',
      },
    ],
  },
  {
    slug: 'the-beanpod-file-explained',
    category: 'security',
    title: 'The .beanpod File Explained',
    excerpt:
      "Your entire family's data in one encrypted file. Understand the v4 file format and what's inside.",
    icon: '\u{1F4E6}',
    readTime: 4,
    popular: true,
    updatedDate: '2026-03-09',
    sections: [
      {
        type: 'heading',
        content: 'What is a .beanpod file?',
        level: 2,
        id: 'what-is-beanpod',
      },
      {
        type: 'paragraph',
        content:
          "A <code>.beanpod</code> file is the single encrypted file that contains all of your family's data. It uses the <strong>v4.0</strong> file format with per-member key wrapping.",
      },
      {
        type: 'heading',
        content: 'File structure',
        level: 2,
        id: 'file-structure',
      },
      {
        type: 'paragraph',
        content: 'Inside a <code>.beanpod</code> file (JSON):',
      },
      {
        type: 'list',
        content: '',
        items: [
          '<strong>version</strong> \u2014 File format version (<code>"4.0"</code>)',
          '<strong>familyId</strong> \u2014 Unique identifier for your family',
          "<strong>familyName</strong> \u2014 Your family's display name",
          '<strong>keyId</strong> \u2014 Key rotation identifier',
          '<strong>wrappedKeys</strong> \u2014 Per-member wrapped copies of the family key',
          '<strong>passkeyWrappedKeys</strong> \u2014 Per-passkey wrapped copies (for biometric login)',
          '<strong>inviteKeys</strong> \u2014 Active invite link packages (24-hour expiry)',
          '<strong>encryptedPayload</strong> \u2014 Your actual data: IV + AES-GCM encrypted Automerge binary',
        ],
      },
      {
        type: 'infoBox',
        content:
          'Each family member has their own wrapped copy of the family key, derived from their password. This means members can change their passwords independently without re-encrypting the entire file.',
        title: 'Per-member keys',
        icon: '\u{1F511}',
      },
      {
        type: 'heading',
        content: 'Where is it stored?',
        level: 2,
        id: 'where-stored',
      },
      {
        type: 'paragraph',
        content:
          'By default, your pod data lives in IndexedDB (an encrypted cache in your browser). If you connect Google Drive, the <code>.beanpod</code> file is also saved there \u2014 but always encrypted before upload.',
      },
    ],
  },
  {
    slug: 'zero-knowledge-architecture',
    category: 'security',
    title: 'Zero-Knowledge Architecture',
    excerpt:
      "We can't see your data. Period. Learn about the zero-knowledge design that keeps your family finances private.",
    icon: '\u{1F440}',
    readTime: 3,
    updatedDate: '2026-05-20',
    sections: [
      {
        type: 'heading',
        content: 'What does zero-knowledge mean?',
        level: 2,
        id: 'what-is-zk',
      },
      {
        type: 'paragraph',
        content:
          '<strong>Zero-knowledge</strong> means that nobody \u2014 not even the developers of beanies.family \u2014 can access your data. All encryption and decryption happens entirely in your browser.',
      },
      {
        type: 'heading',
        content: 'Design principles',
        level: 2,
        id: 'principles',
      },
      {
        type: 'list',
        content: '',
        items: [
          "<strong>No server-side storage</strong> \u2014 We don't run a database. Your data lives on your device and optionally in your own Google Drive.",
          "<strong>No password transmission</strong> \u2014 Your password never leaves your browser. It's used locally to derive encryption keys.",
          "<strong>No analytics on data</strong> \u2014 We can't compute on, index, or profile your financial information.",
          '<strong>Open encryption</strong> \u2014 We use standard Web Crypto API algorithms (AES-256-GCM, PBKDF2, AES-KW) with no custom crypto.',
        ],
      },
      {
        type: 'callout',
        content:
          'The only server-side component is a stateless OAuth proxy for Google Drive token exchange. It processes OAuth tokens \u2014 never your pod data.',
        title: 'OAuth proxy',
        icon: '\u{1F4E1}',
      },
      {
        type: 'heading',
        content: 'What Google sees',
        level: 2,
        id: 'what-google-sees',
      },
      {
        type: 'paragraph',
        content:
          "If you use Google Drive sync, Google stores your <code>.beanpod</code> file \u2014 but it's fully encrypted. Google sees the file name and size, but the contents are indistinguishable from random data without your password.",
      },
      {
        type: 'heading',
        content: 'What we collect to keep the app working',
        level: 2,
        id: 'diagnostics',
      },
      {
        type: 'paragraph',
        content:
          'To find and fix bugs, beanies.family collects <strong>anonymous diagnostic logs</strong> on our own servers. These contain <strong>no</strong> names, balances, transactions, photos, or anything you type \u2014 only a random family identifier, which screen you were on, your browser and version, and technical error details. They are kept for 90 days and then deleted automatically.',
      },
      {
        type: 'callout',
        content:
          'Diagnostic logs are <strong>not</strong> your family data. Your financial data stays encrypted and never leaves your control \u2014 the diagnostics only describe <em>that</em> something failed and <em>where</em>, never <em>what</em> your data contains. They live in our own infrastructure, not a third-party analytics service.',
        title: 'Diagnostics \u2260 your data',
        icon: '\u{1FAE7}',
      },
    ],
  },
  {
    slug: 'password-recovery',
    category: 'security',
    title: 'Password Recovery (There Is None)',
    excerpt:
      'By design, there is no password reset or recovery. Learn why, and how to protect yourself.',
    icon: '\u{1F6AB}',
    readTime: 2,
    updatedDate: '2026-03-09',
    sections: [
      {
        type: 'heading',
        content: "Why there's no recovery",
        level: 2,
        id: 'why-no-recovery',
      },
      {
        type: 'paragraph',
        content:
          'Because of our zero-knowledge design, <strong>your password exists only in your head</strong>. We never store it, hash it on a server, or have any mechanism to reset it. If you forget your password, your data is permanently inaccessible.',
      },
      {
        type: 'callout',
        content:
          "This is intentional. It's the same reason a safe deposit box key can't be recovered \u2014 the security depends on no one else having access.",
        title: 'By design, not by accident',
        icon: '\u{1F512}',
      },
      {
        type: 'heading',
        content: 'How to stay safe',
        level: 2,
        id: 'stay-safe',
      },
      {
        type: 'list',
        content: '',
        items: [
          '<strong>Write it down</strong> \u2014 Store your password in a physical location (not digitally)',
          '<strong>Use a password manager</strong> \u2014 Tools like 1Password or Bitwarden can store it securely',
          '<strong>Set up a passkey</strong> \u2014 Biometric login (fingerprint/face) as a convenient alternative',
          '<strong>Multiple family members</strong> \u2014 If another family member knows their password, they can still access the pod',
        ],
      },
      {
        type: 'infoBox',
        content:
          'Each family member has their own password and wrapped key. As long as <em>any</em> member remembers their password, the family data remains accessible.',
        title: 'Family safety net',
        icon: '\u{1F91D}',
      },
    ],
  },
  {
    slug: 'biometric-login',
    category: 'security',
    title: 'Unlock With Biometrics (Face ID, Fingerprint, Device PIN)',
    excerpt:
      'Sign back in with a tap using your device biometrics — in the app and the browser. A convenience layer over your family password, never a replacement.',
    icon: '\u{1F441}️',
    readTime: 4,
    updatedDate: '2026-05-23',
    sections: [
      {
        type: 'heading',
        content: 'What biometric unlock does',
        level: 2,
        id: 'what-it-does',
      },
      {
        type: 'paragraph',
        content:
          'Biometric unlock lets you reopen your pod with <strong>Face ID, a fingerprint, or your device PIN</strong> instead of typing your family password every time. It uses <strong>passkeys</strong> (WebAuthn) — the same passwordless standard your bank and Google use — and works in the installed app and in your browser.',
      },
      {
        type: 'callout',
        content:
          'Biometric unlock is a convenience layer <em>over</em> your family password — not a replacement for it. Your password always works, and losing or replacing your device never locks you out of your pod. Keep your password somewhere safe.',
        title: 'Your password is still the master key',
        icon: '\u{1F511}',
      },
      {
        type: 'heading',
        content: 'How to turn it on',
        level: 2,
        id: 'turn-it-on',
      },
      {
        type: 'steps',
        content: '',
        items: [
          'Open <strong>Settings → Account</strong>.',
          'Under <strong>Biometric login</strong>, tap <strong>Set up</strong> and confirm with your device biometrics.',
          "That's it — next time you sign in on that device, you'll be offered a one-tap biometric unlock.",
        ],
      },
      {
        type: 'heading',
        content: 'How it stays private',
        level: 2,
        id: 'privacy',
      },
      {
        type: 'list',
        content: '',
        items: [
          'Your <strong>biometrics never leave your device</strong> — Face ID / fingerprint data is handled by your phone or computer’s secure hardware, and beanies.family never sees it.',
          'The passkey unwraps your family key <strong>on your device</strong>; beanies only ever stores the <em>wrapped</em> (encrypted) key. See <a href="/help/security/how-your-data-is-encrypted">How Your Data Is Encrypted</a>.',
          'A passkey you create on one device can sync to your other devices on the <strong>same platform</strong> (iCloud Keychain for Apple, Google Password Manager for Android/Chrome) — but not across ecosystems.',
        ],
      },
      {
        type: 'heading',
        content: 'Which devices support it',
        level: 2,
        id: 'device-support',
      },
      {
        type: 'paragraph',
        content:
          'Biometric unlock needs a reasonably recent device: <strong>iOS 16+</strong>, a modern <strong>Android</strong> with the system passkey/credential manager, or an up-to-date desktop browser. On older devices — or any device without biometric hardware set up — beanies.family simply asks for your password instead. Nothing breaks; you just sign in the usual way.',
      },
      {
        type: 'infoBox',
        content:
          'If a device can’t use biometrics, you’ll see a short note and the password field instead of a dead end. You can always fall back to your password on any device, anytime.',
        title: 'No supported device? No problem',
        icon: '\u{1F50F}',
      },
    ],
  },
  // #133 / #30 — beanies AI privacy explainer. LIVE as of the 2026-06-07 soft launch
  // (alongside the consent modal's PRIVACY_ARTICLE_LIVE flip + this deploy-web run).
  {
    slug: 'how-beanies-ai-handles-your-photos',
    category: 'security',
    title: 'Magic Beans: How beanies Reads Your Photos & Documents',
    excerpt:
      'Hand beanies a "magic bean" — a photo or booking — and it sprouts the details for you. Here is exactly what we send, where it goes, and what we keep (which is nothing).',
    icon: '\u{1FAD8}',
    readTime: 4,
    updatedDate: '2026-06-07',
    sections: [
      {
        type: 'heading',
        content: 'What the magic beans do',
        level: 2,
        id: 'what-it-does',
      },
      {
        type: 'paragraph',
        content:
          "Tap <strong>✨ Perform magic</strong> (or the <strong>Invite</strong> and <strong>Travel booking</strong> buttons) and beanies reads a single photo or document you choose — a party invitation, a flight itinerary, a hotel confirmation — and magically pulls out the key details, then opens a pre-filled activity or trip for you to check and save. As you probably guessed, it's not actually magic: it's secure, private AI. It only ever runs on the one document you pick, and only when you ask.",
      },
      {
        type: 'callout',
        content:
          "Picked a PDF? beanies reads its first few pages — not just the first — so a return flight on page two or a second day's plan gets picked up too. Very long PDFs read the first several pages, and either way the full original document stays attached to whatever it creates, so nothing is lost. A photo is read as a single image.",
        title: 'Multi-page PDFs',
      },
      {
        type: 'heading',
        content: 'What we send',
        level: 2,
        id: 'what-we-send',
      },
      {
        type: 'list',
        content: '',
        items: [
          '<strong>Only the one photo or document</strong> you chose for that action.',
          "<strong>Never the rest of your family's data</strong> — your accounts, activities, trips, members, and notes never leave your device for this.",
          'Nothing is sent until you confirm. You can decline and fill the activity or trip in by hand.',
        ],
      },
      {
        type: 'heading',
        content: 'Where it goes',
        level: 2,
        id: 'where-it-goes',
      },
      {
        type: 'paragraph',
        content:
          'On the default setting, your photo or document is encrypted and sent to a private, secure AI service that processes it and keeps nothing. It is encrypted while it travels to and from that service. If you bring your own AI provider (BYOK), it goes to that provider instead, using your key.',
      },
      {
        type: 'callout',
        content:
          'The AI service processes your document in a secure, attested environment and retains nothing after it answers. It is encrypted in transit. Once your document or image arrives in the secure enclave, it is decrypted and processed to read, encrypt, and return the details back to beanies.family.',
        title: 'Private and secure as can be',
        icon: '\u{1F512}',
      },
      {
        type: 'heading',
        content: 'How your data is kept secure',
        level: 2,
        id: 'how-its-secured',
      },
      {
        type: 'paragraph',
        content:
          'On the default setting, your photo or document is read by a specialist AI model running inside <strong>attested confidential-compute hardware</strong>. It is a sealed environment, built on AMD SEV-SNP and Intel TDX chips, that the company operating the servers cannot see into. Your document is encrypted on the way there and back, read only to pull out the details, and then it is gone.',
      },
      {
        type: 'list',
        content: '',
        items: [
          '<strong>Sealed processing:</strong> your document is decrypted and read only inside the attested enclave, not on an ordinary server someone could log into.',
          '<strong>Encrypted in transit:</strong> it is encrypted on the way to the enclave and on the way back.',
          '<strong>Nothing kept, nothing trained on:</strong> the AI service retains nothing once it has answered, and never uses your data to train its models.',
          '<strong>You can verify it:</strong> the enclave publishes a live <em>attestation</em>, a cryptographic proof of exactly what hardware and code are running, so the privacy promise is not just our word for it.',
          '<strong>Or skip it entirely:</strong> bring your own AI provider and key (BYOK) and your document goes straight to your provider, never through ours.',
        ],
      },
      {
        type: 'paragraph',
        content:
          'Today that secure hardware is provided by <strong>Tinfoil</strong>, a privacy-focused AI host whose enclaves both we and you can verify on every request. If we ever change providers, it will only be to one that meets the same verifiable standard. We try to be precise rather than boastful: the AI genuinely does read your document to pull out the details, but that only ever happens inside sealed, verifiable hardware, and nothing is kept.',
      },
      {
        type: 'heading',
        content: 'What happens afterwards',
        level: 2,
        id: 'afterwards',
      },
      {
        type: 'paragraph',
        content:
          "The AI service does not retain any data or information. The photo or document you picked is saved only with your own family's data file, and attached to the activity, trip, or other item it created, so you can find it later. You can remove it before saving if you'd like.",
      },
      {
        type: 'heading',
        content: 'The “don’t ask again” choice',
        level: 2,
        id: 'dont-ask-again',
      },
      {
        type: 'infoBox',
        content:
          'Ticking "don’t ask again" in the consent box turns off the AI consent prompt for <strong>your whole family</strong>, not just your device, because the setting is shared with your family data. You can turn the prompt back on any time in <strong>Settings → AI &amp; Privacy</strong>.',
        title: 'It applies to your whole family',
        icon: '\u{1F465}',
      },
    ],
  },
  ...(CALENDAR_SYNC_HELP_LIVE ? [CALENDAR_SYNC_ARTICLE] : []),
  ...(CLASH_NUDGE_HELP_LIVE ? [CLASH_NUDGE_ARTICLE] : []),
];
