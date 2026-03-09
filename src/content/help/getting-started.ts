import type { HelpArticle } from './types';

export const GETTING_STARTED_ARTICLES: HelpArticle[] = [
  {
    slug: 'creating-your-first-pod',
    category: 'getting-started',
    title: 'Creating Your First Pod',
    excerpt:
      'Set up your family pod in minutes. Create your account, set a password, and start tracking your family finances.',
    icon: '\u{1F331}',
    readTime: 3,
    popular: true,
    updatedDate: '2026-03-09',
    sections: [
      {
        type: 'heading',
        content: 'What is a pod?',
        level: 2,
        id: 'what-is-a-pod',
      },
      {
        type: 'paragraph',
        content:
          "A <strong>pod</strong> is your family's private space in beanies.family. It holds all your financial data, family members, activities, and goals \u2014 encrypted and stored in a single <code>.beanpod</code> file that you control.",
      },
      {
        type: 'heading',
        content: 'Step-by-step setup',
        level: 2,
        id: 'step-by-step',
      },
      {
        type: 'steps',
        content: '',
        items: [
          'Open beanies.family and click <strong>Create a New Family</strong>',
          'Enter your family name, your name, and your email address',
          'Choose a strong password \u2014 this encrypts your pod file',
          'Pick your base currency and preferred language',
          "Your pod is created! You'll land in the Family Nook",
        ],
      },
      {
        type: 'callout',
        content:
          'Your password is the only way to unlock your pod. There is no password recovery \u2014 we never see or store your password. Write it down somewhere safe.',
        title: 'Remember your password',
        icon: '\u26A0\uFE0F',
      },
      {
        type: 'heading',
        content: 'What happens next?',
        level: 2,
        id: 'whats-next',
      },
      {
        type: 'paragraph',
        content:
          'After creating your pod, you can add family members, set up bank accounts, record transactions, and start tracking goals. Everything is stored locally on your device until you choose to save to Google Drive.',
      },
    ],
  },
  {
    slug: 'adding-family-members',
    category: 'getting-started',
    title: 'Adding Family Members',
    excerpt:
      'Invite your partner, kids, or other family members to join your pod with secure invite links.',
    icon: '\u{1F468}\u200D\u{1F469}\u200D\u{1F467}',
    readTime: 3,
    updatedDate: '2026-03-09',
    sections: [
      {
        type: 'heading',
        content: 'How invites work',
        level: 2,
        id: 'how-invites-work',
      },
      {
        type: 'paragraph',
        content:
          "Family members join your pod through a <strong>secure invite link</strong>. The link contains a one-time token that grants access to your pod's encryption key \u2014 it expires after 24 hours.",
      },
      {
        type: 'heading',
        content: 'Sending an invite',
        level: 2,
        id: 'sending-invite',
      },
      {
        type: 'steps',
        content: '',
        items: [
          'Go to <strong>Family</strong> in the sidebar',
          'Click <strong>Add to Family</strong>',
          "Enter the new member's name, email, and role",
          'Copy the invite link and send it to them securely',
          "They open the link, set their own password, and they're in!",
        ],
      },
      {
        type: 'heading',
        content: 'Member roles',
        level: 2,
        id: 'member-roles',
      },
      {
        type: 'list',
        content: '',
        items: [
          '<strong>Owner</strong> \u2014 Full access. Can manage the pod, members, and all financial data.',
          '<strong>Parent Bean</strong> \u2014 Can view and manage finances, activities, and family settings.',
          '<strong>Big Bean</strong> \u2014 Can view activities and limited financial info based on permissions.',
          '<strong>Little Bean</strong> \u2014 View-only access to activities and the Family Nook.',
        ],
      },
      {
        type: 'infoBox',
        content: "You can change a member's role and permissions at any time from the Family page.",
        title: 'Tip',
        icon: '\u{1F4A1}',
      },
    ],
  },
  {
    slug: 'language-and-currency',
    category: 'getting-started',
    title: 'Language & Currency',
    excerpt:
      'Set your preferred language and base currency. beanies.family supports multi-currency tracking with automatic conversion.',
    icon: '\u{1F30D}',
    readTime: 2,
    updatedDate: '2026-03-09',
    sections: [
      {
        type: 'heading',
        content: 'Setting your base currency',
        level: 2,
        id: 'base-currency',
      },
      {
        type: 'paragraph',
        content:
          'Your <strong>base currency</strong> is the currency used for all summary totals, net worth, and dashboard cards. You can set it during onboarding or change it anytime in <strong>Settings</strong>.',
      },
      {
        type: 'heading',
        content: 'Multi-currency support',
        level: 2,
        id: 'multi-currency',
      },
      {
        type: 'paragraph',
        content:
          'Each account and transaction stores its original currency. When displaying totals, beanies.family converts amounts to your base currency using the latest exchange rates.',
      },
      {
        type: 'infoBox',
        content:
          'Exchange rates are fetched automatically from a free currency API. You can also set manual rates in Settings if you prefer.',
        title: 'Exchange rates',
        icon: '\u{1F4B1}',
      },
      {
        type: 'heading',
        content: 'Language options',
        level: 2,
        id: 'language',
      },
      {
        type: 'paragraph',
        content:
          'beanies.family currently supports <strong>English</strong> and <strong>Chinese</strong>. The app uses an automatic translation service to translate the UI. You can switch languages in Settings.',
      },
    ],
  },
  {
    slug: 'connecting-google-drive',
    category: 'getting-started',
    title: 'Connecting Google Drive',
    excerpt:
      'Save your encrypted pod file to Google Drive for cross-device access and automatic backups.',
    icon: '\u2601\uFE0F',
    readTime: 3,
    updatedDate: '2026-03-09',
    sections: [
      {
        type: 'heading',
        content: 'Why connect Google Drive?',
        level: 2,
        id: 'why-drive',
      },
      {
        type: 'paragraph',
        content:
          'By default, your pod lives only on your device. Connecting Google Drive lets you save your encrypted <code>.beanpod</code> file to the cloud, so you can access it from any device and have automatic backups.',
      },
      {
        type: 'callout',
        content:
          "Your data is encrypted <strong>before</strong> it leaves your device. Google can't read your pod file \u2014 it's just encrypted bytes to them.",
        title: 'Your data stays private',
        icon: '\u{1F512}',
      },
      {
        type: 'heading',
        content: 'How to connect',
        level: 2,
        id: 'how-to-connect',
      },
      {
        type: 'steps',
        content: '',
        items: [
          'Go to <strong>Settings</strong> \u2192 <strong>Family Data Options</strong>',
          'Click <strong>Connect Google Drive</strong>',
          'Sign in with your Google account and grant permission',
          'Choose a folder in your Drive (or let us create one)',
          'Your pod will now auto-save to Drive after every change',
        ],
      },
      {
        type: 'heading',
        content: 'Accessing from another device',
        level: 2,
        id: 'another-device',
      },
      {
        type: 'paragraph',
        content:
          "On a new device, click <strong>Load Existing Family</strong> on the login page, connect your Google account, and select your pod file. Enter your password to decrypt and you're back in.",
      },
    ],
  },
];
