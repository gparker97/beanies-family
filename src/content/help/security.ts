import type { HelpArticle } from './types';

// #32 Google Calendar integration — LIVE (2026-07-03). Google's OAuth verification
// was approved and Calendar graduated from The Beanie Lab to an official
// Settings → Google Calendar card, so this article is published on the Help Center.
const CALENDAR_SYNC_HELP_LIVE = true;
const CALENDAR_SYNC_ARTICLE: HelpArticle = {
  slug: 'google-calendar-sync',
  category: 'security',
  title: 'How beanies Syncs Your Activities to Google Calendar',
  excerpt:
    'Connect a Google calendar and your family activities appear there automatically — one-way, with beanies as the source of truth.',
  icon: '\u{1F4C5}',
  readTime: 5,
  updatedDate: '2026-07-12',
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
        'Change or remove just <strong>one session</strong> of a repeating activity — reschedule it, edit only that session, or delete only that session — and only that one event on your calendar updates; the rest of the series stays exactly as it was.',
        'If you edit a synced event directly in Google, beanies restores its own version on the next sync, so always edit in beanies.',
        'Disconnect a calendar any time in Settings; beanies removes the events it added and stops syncing. Your activities stay safe in beanies.',
      ],
    },
    {
      type: 'paragraph',
      content:
        'One small difference for a <em>single session</em> of a repeating activity: beanies writes your change to your calendar once, but doesn’t keep re-asserting it. If you then hand-edit that one session directly in Google, beanies will put its version back the next time you change that session in the app — not automatically. (A whole activity, by contrast, is restored on every sync.) Either way, beanies stays the source of truth.',
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
    { type: 'heading', content: 'Reconnecting when access lapses', level: 2, id: 'reconnecting' },
    {
      type: 'paragraph',
      content:
        'Every so often Google asks you to re-approve access — after a password change, a long gap, or one of Google’s periodic security refreshes. When that happens, beanies tells you right away: a <strong>reconnect prompt</strong> appears and a notification lands in the bell, so a lapsed connection is never silent. Until you reconnect, new activities simply wait; nothing is lost.',
    },
    {
      type: 'paragraph',
      content:
        'Reconnecting is <strong>one tap on any device</strong> — your phone, the installed app, or a desktop browser all work the same way. Tap <strong>Reconnect</strong> on the prompt (or open <strong>Settings → Google Calendar</strong> and tap Reconnect there), approve access with Google, and syncing resumes on its own. The prompt and the notification clear themselves the moment the connection recovers.',
    },
    {
      type: 'paragraph',
      content:
        'Reconnecting is completely safe: beanies stays the single source of truth, nothing in your calendar is deleted, and your family’s activities are untouched. It simply hands beanies a fresh key to keep pushing your schedule out.',
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
// and the article is listed in the help index + sitemap + llms-full. As of
// 2026-07-03 the calendar/clash features are official (Settings → Google
// Calendar), no longer Lab-gated.
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
    updatedDate: '2026-08-28',
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
          'Every piece of data in your pod is encrypted using <strong>AES-256-GCM</strong> \u2014 the same standard used by banks and governments. The keys that open it never leave your device.',
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
          'A <strong>wrapping key</strong> is made from a secret only your family holds \u2014 the recovery kit code created with your family, an optional recovery passphrase, or (for members of older families) a password run through <strong>PBKDF2</strong> (100,000 rounds, SHA-256) with a random 16-byte salt',
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
          '<strong>Key derivation:</strong> PBKDF2 with 100,000 iterations, SHA-256, 16-byte random salt (for passphrase and password wraps)',
          '<strong>IV:</strong> 12 bytes, randomly generated for each save',
          '<strong>Implementation:</strong> Web Crypto API (native browser cryptography)',
        ],
      },
      {
        type: 'callout',
        content:
          'All encryption happens in your browser using the native Web Crypto API. No keys, PINs, passwords, recovery codes, or unencrypted data are ever transmitted to any server.',
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
    updatedDate: '2026-08-28',
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
          '<strong>wrappedKeys</strong> \u2014 Per-member password-wrapped copies of the family key (older families)',
          '<strong>recoveryKeys</strong> \u2014 Recovery-kit wrapped copies of the family key \u2014 how new families are unlocked (see <a href="/help/security/password-recovery">Your Recovery Kit</a>)',
          '<strong>passkeyWrappedKeys</strong> \u2014 Per-passkey wrapped copies (for biometric login in the installed app)',
          '<strong>inviteKeys</strong> \u2014 Active invite link packages (24-hour expiry)',
          '<strong>encryptedPayload</strong> \u2014 Your actual data: IV + AES-GCM encrypted Automerge binary',
        ],
      },
      {
        type: 'infoBox',
        content:
          'In families created before PINs arrived, each member has their own wrapped copy of the family key, derived from their password. New families start with a recovery-kit wrap instead \u2014 everyday sign-in is each member\u2019s 6-digit PIN, which travels inside the encrypted family data itself, never in the file wrapper and never on a server.',
        title: 'How the key is wrapped',
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
      {
        type: 'heading',
        content: 'Opening your file from any account or device',
        level: 2,
        id: 'open-from-anywhere',
      },
      {
        type: 'paragraph',
        content:
          'Because the file is yours, you can open it from anywhere you can reach it \u2014 not just the Google account that first created it. On the sign-in screen, under <strong>\u201cLoad a saved family file\u201d</strong>, you can pick a <code>.beanpod</code> from another Google account, from a different device, or from a backup you\u2019ve restored. This works on the web, on Android, and on iOS.',
      },
      {
        type: 'paragraph',
        content:
          'On a phone, the system file picker can reach files stored in Google Drive, iCloud, or on the device itself. On a desktop Chrome or Edge browser, opening a file that lives only in a <em>different</em> Google account means downloading it to your computer first, then choosing it.',
      },
      {
        type: 'infoBox',
        content:
          'The file is still encrypted \u2014 opening it on a fresh device always needs something only your family holds: your recovery kit code, your recovery passphrase, or a link from a device that\u2019s already signed in (then your PIN). A copied <code>.beanpod</code> is useless to anyone without one of those.',
        title: 'Still needs your key',
        icon: '\u{1F510}',
      },
      {
        type: 'heading',
        content: 'One file, shared by the whole family',
        level: 2,
        id: 'one-file-per-family',
      },
      {
        type: 'paragraph',
        content:
          'Your family has exactly <strong>one</strong> <code>.beanpod</code> file, and everyone works on that same file. Whoever set the family up owns it in their Google Drive and shares it with everyone else \u2014 so if you joined by invite, the file lives in someone else\u2019s Drive and that is completely normal. It is still your family\u2019s file, and you can edit it just like they can.',
      },
      {
        type: 'paragraph',
        content:
          'beanies never makes a second copy of your family\u2019s file. A copy would quietly split your family in two \u2014 each half adding to a different file, each seeing only its own changes \u2014 so it is not something the app will do on its own, and not something it will offer to do.',
      },
      {
        type: 'heading',
        content: 'If beanies can\u2019t reach your family\u2019s file',
        level: 2,
        id: 'cannot-reach-file',
      },
      {
        type: 'paragraph',
        content:
          'Sometimes the app can open your data but can\u2019t confirm it is able to <em>save</em> to it \u2014 you\u2019re offline, your Google connection has expired, the file has been moved or put in the bin, or the person who shared it has stopped sharing it. When that happens you\u2019ll see a banner at the top of the app explaining which of those it is, with a button that takes you back to the original file. Your changes stay safely on your device in the meantime.',
      },
      {
        type: 'infoBox',
        content:
          'If a banner tells you you\u2019re working on a <strong>copy</strong> of your family\u2019s file, it means your changes aren\u2019t reaching everyone else. Tap \u201cSwitch to your family\u2019s file\u201d \u2014 the changes on your device come across with you, and the copy is left alone.',
        title: 'Working on a copy',
        icon: '\u{1F500}',
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
    updatedDate: '2026-08-28',
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
          "<strong>No secret transmission</strong> \u2014 Your PIN, password, and recovery codes never leave your browser. They're used locally to unlock encryption keys.",
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
          "If you use Google Drive sync, Google stores your <code>.beanpod</code> file \u2014 but it's fully encrypted. Google sees the file name and size, but the contents are indistinguishable from random data without your family's keys.",
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
    title: 'Your Recovery Kit (and Other Ways Back In)',
    excerpt:
      'Your recovery kit is the master key to your family\u2019s data. Learn how to store it, the recovery passphrase option, and every other way back in if a PIN or device is lost.',
    icon: '\u{1F5DD}\uFE0F',
    readTime: 4,
    updatedDate: '2026-08-28',
    sections: [
      {
        type: 'heading',
        content: 'The recovery kit is your master key',
        level: 2,
        id: 'what-is-the-kit',
      },
      {
        type: 'paragraph',
        content:
          'Day to day you sign in with your personal <strong>6-digit PIN</strong>, on any device where your family is set up. Behind that sits one master key: your family\u2019s <strong>recovery kit</strong> \u2014 a generated code you can save as a printable PDF with a QR code. If every device and every PIN were ever lost, the kit is the only way back into your family\u2019s data.',
      },
      {
        type: 'paragraph',
        content:
          'The kit is created when your family is created. You can also create (or replace) one any time in <strong>Settings \u2192 Security &amp; Recovery</strong>. <strong>Regenerating replaces the old kit</strong> \u2014 the old code stops working, and the new one is the copy to keep.',
      },
      {
        type: 'callout',
        content:
          'Keep the kit somewhere <em>other than</em> the Google Drive that holds your family\u2019s data \u2014 print it and put it with your important documents, save it in a password manager, or keep it in a different cloud account. If the kit sits right next to the file it unlocks, losing one account exposes both.',
        title: 'Store it away from your family\u2019s data',
        icon: '\u{1F5C4}\uFE0F',
      },
      {
        type: 'heading',
        content: 'The recovery passphrase (optional)',
        level: 2,
        id: 'recovery-passphrase',
      },
      {
        type: 'paragraph',
        content:
          'If you\u2019d rather remember something than store something, you can also set a <strong>recovery passphrase</strong> in <strong>Settings \u2192 Security &amp; Recovery</strong> \u2014 a memorable phrase that can open your family\u2019s data on a fresh device, just like the kit. It\u2019s optional, and it works alongside the kit rather than replacing it.',
      },
      {
        type: 'heading',
        content: 'Forgot your PIN?',
        level: 2,
        id: 'forgot-pin',
      },
      {
        type: 'paragraph',
        content: 'A forgotten PIN is not an emergency. You have two easy ways back in:',
      },
      {
        type: 'list',
        content: '',
        items: [
          '<strong>Ask another parent</strong> \u2014 any pod manager can reset your PIN from your bean page, right in the app. (This is also how parents set or reset a child\u2019s PIN.)',
          '<strong>Use your recovery kit or passphrase</strong> \u2014 either one unlocks your family\u2019s data on the device, and you can then set yourself a new PIN.',
        ],
      },
      {
        type: 'heading',
        content: 'Signing in on a new device',
        level: 2,
        id: 'new-device',
      },
      {
        type: 'steps',
        content: '',
        items: [
          'On a device that\u2019s already signed in, open <strong>Settings \u2192 Security &amp; Recovery</strong> and tap <strong>Link a Device</strong>.',
          'A QR code and link appear \u2014 they work for <strong>15 minutes</strong>.',
          'Scan the QR code (or open the link) on the new device.',
          'Pick yourself and sign in with your PIN. That\u2019s it \u2014 the new device is set up.',
        ],
      },
      {
        type: 'paragraph',
        content:
          'No signed-in device handy? Your recovery kit or passphrase opens your family\u2019s data on a fresh device too.',
      },
      {
        type: 'heading',
        content: 'What about passwords?',
        level: 2,
        id: 'passwords',
      },
      {
        type: 'paragraph',
        content:
          'New families don\u2019t have passwords at all. If you created your family before PINs arrived, your old password still works to sign in on a new device \u2014 and once you\u2019re in, beanies offers to set up a PIN so you can leave the password behind.',
      },
      {
        type: 'heading',
        content: 'The honest trade-off',
        level: 2,
        id: 'honest-trade-off',
      },
      {
        type: 'paragraph',
        content:
          'beanies is built so that <strong>nobody but your family</strong> \u2014 not even us \u2014 can open your data. That means there is no \u201creset by email\u201d: we hold nothing that could unlock it. If every signed-in device is gone, the recovery kit is lost, and no passphrase was set, the data is unrecoverable. That\u2019s not a punishment \u2014 it\u2019s the proof that no one else could get in either.',
      },
      {
        type: 'callout',
        content:
          'This is intentional. It\u2019s the same reason a safe deposit box key can\u2019t be conjured up by the bank \u2014 the security depends on no one else having a way in.',
        title: 'By design, not by accident',
        icon: '\u{1F512}',
      },
      {
        type: 'infoBox',
        content:
          'You\u2019ll rarely need the kit itself: any family member with a signed-in device can link your new device, and a pod manager can reset your PIN. The kit is for the day <em>all</em> of that is gone \u2014 which is exactly why it\u2019s worth storing well.',
        title: 'Family safety net',
        icon: '\u{1F91D}',
      },
    ],
  },
  {
    slug: 'biometric-login',
    category: 'security',
    title: 'Unlock With Biometrics (Face ID & Fingerprint)',
    excerpt:
      'In the installed iPhone and Android app, Face ID or a fingerprint signs you in with a tap. Everywhere else, your 6-digit PIN is the way in.',
    icon: '\u{1F441}\uFE0F',
    readTime: 3,
    updatedDate: '2026-08-28',
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
          'In the <strong>installed iPhone or Android app</strong>, biometric unlock lets you sign back in with <strong>Face ID or a fingerprint</strong> instead of typing your PIN every time. One tap opens your family\u2019s data <em>and</em> signs you in as you, so you land straight in your own account.',
      },
      {
        type: 'paragraph',
        content:
          'Your everyday sign-in everywhere is your personal <strong>6-digit PIN</strong>. It works on any device where your family is set up \u2014 phone, tablet, or browser \u2014 and it travels safely inside your family\u2019s encrypted data, never on a server. Biometrics are simply a faster way past the PIN on a device with the app installed.',
      },
      {
        type: 'callout',
        content:
          'Biometrics and your PIN are for everyday convenience. If a device is lost or replaced, your <strong>recovery kit</strong> (or recovery passphrase) is what gets your family back in \u2014 see <a href="/help/security/password-recovery">Your Recovery Kit (and Other Ways Back In)</a>.',
        title: 'Your recovery kit is the master key',
        icon: '\u{1F5DD}\uFE0F',
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
          'Install the beanies.family app from the App Store or Google Play and sign in with your PIN.',
          'When the app offers biometric unlock, confirm with Face ID or your fingerprint \u2014 or turn it on later in <strong>Settings \u2192 Account &amp; Sign-In</strong>.',
          'That\u2019s it \u2014 next time you open the app on that device, one tap signs you in.',
        ],
      },
      {
        type: 'heading',
        content: 'Only in the installed app',
        level: 2,
        id: 'app-only',
      },
      {
        type: 'paragraph',
        content:
          'Biometric unlock uses your phone\u2019s <strong>secure hardware</strong>, which only the installed app can reach \u2014 so it isn\u2019t available in a browser. In a browser, you sign in with your PIN.',
      },
      {
        type: 'infoBox',
        content:
          'Older versions of beanies offered biometric sign-in (passkeys) in the browser. That has been retired \u2014 a passkey saved in your browser no longer signs you in there. Your PIN replaces it, and biometrics live on in the installed app.',
        title: 'Had browser biometrics before?',
        icon: '\u{1F310}',
      },
      {
        type: 'heading',
        content: 'Sharing a device with someone else',
        level: 2,
        id: 'shared-devices',
      },
      {
        type: 'paragraph',
        content:
          'Sign-in is always <strong>per family member</strong> \u2014 on a shared tablet, each of you signs in with your own PIN and lands in your own account. More than one of you can set up biometric unlock on the same device; beanies simply asks who is signing in first, and there\u2019s always a <strong>\u201cNot you? Switch account\u201d</strong> link if the wrong bean comes up.',
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
          'Your <strong>biometrics never leave your device</strong> \u2014 Face ID and fingerprint data are handled by your phone\u2019s secure hardware, and beanies.family never sees them.',
          'The unlock key is kept inside that same secure hardware and only released when your face or fingerprint matches. See <a href="/help/security/how-your-data-is-encrypted">How Your Data Is Encrypted</a>.',
        ],
      },
      {
        type: 'infoBox',
        content:
          'On a device without Face ID or a fingerprint reader set up \u2014 or in any browser \u2014 you simply sign in with your PIN instead. Nothing breaks.',
        title: 'No biometrics? No problem',
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
          'On the default setting, your photo or document is encrypted in transit and sent to a private, secure AI service that processes it and keeps nothing. It passes through a beanies server on the way, which holds it only for the moment it takes to forward it, and stores nothing. If you bring your own AI provider (BYOK), it goes straight to that provider instead, using your key, and never touches a beanies server.',
      },
      {
        type: 'callout',
        content:
          'The AI service processes your document inside a secure, attested environment - hardware that the company running the servers cannot see into - and retains nothing after it answers. Your document is encrypted every time it crosses the network. We are working towards encrypting it so that <em>only</em> that secure hardware can open it, and not even our own server could read it in between.',
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
  {
    slug: 'knowing-your-data-is-saved',
    category: 'security',
    title: 'Knowing Your Data Is Saved',
    excerpt:
      'The save indicator in the sidebar shows everyone — not just the family owner — that your latest changes were saved, and quietly flags it if a save is struggling.',
    icon: '\u{1F4BE}',
    readTime: 3,
    updatedDate: '2026-08-06',
    sections: [
      {
        type: 'heading',
        content: 'Where to find it',
        level: 2,
        id: 'where',
      },
      {
        type: 'paragraph',
        content:
          "At the bottom of the sidebar — just above your data file name and the encryption badge — there's a small save indicator. On a phone it lives inside the menu you open with the ☰ button. Everyone in the family can see it, whatever their role.",
      },
      {
        type: 'heading',
        content: 'What the states mean',
        level: 2,
        id: 'states',
      },
      {
        type: 'list',
        content: '',
        items: [
          '<strong>Saved · a few minutes ago</strong> — your latest changes are safely stored. Tap it any time to see when the last save happened.',
          '<strong>Saving…</strong> — a save is in progress. This is normal and usually flashes by.',
          "<strong>Having trouble saving</strong> — a save didn't go through and beanies is retrying. It's shown in warm orange, never alarming red, because your work isn't lost — it's held safely on your device until the next save lands.",
        ],
      },
      {
        type: 'callout',
        content:
          "A single hiccup won't bother you — the indicator only speaks up if a save keeps failing. If it does escalate, a full banner appears at the top of the screen with next steps.",
        title: "We won't nag over a blip",
        icon: '\u{1F343}',
      },
      {
        type: 'heading',
        content: 'Tap for details',
        level: 2,
        id: 'details',
      },
      {
        type: 'paragraph',
        content:
          "Tapping the indicator opens a small panel showing your connection (for Google Drive) and when you last saved. If you're the family owner, you'll also see a shortcut to reconnect or switch your data file. Other members see the status but not those controls — recovering a save is the owner's job, so nobody hits a dead end.",
      },
      {
        type: 'callout',
        content:
          "Local files don't show a “connection” line — there's nothing to connect to. They simply show when you last saved to your device.",
        title: 'Local files vs Google Drive',
        icon: '\u{1F4C1}',
      },
    ],
  },
  ...(CALENDAR_SYNC_HELP_LIVE ? [CALENDAR_SYNC_ARTICLE] : []),
  ...(CLASH_NUDGE_HELP_LIVE ? [CLASH_NUDGE_ARTICLE] : []),
];
