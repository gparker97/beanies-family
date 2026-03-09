import type { HelpArticle } from './types';

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
    updatedDate: '2026-03-09',
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
];
