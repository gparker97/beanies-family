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
    updatedDate: '2026-04-20',
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
          'Open <a href="https://app.beanies.family" target="_blank" rel="noopener">app.beanies.family</a> and click <strong>Create a New Family</strong>',
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
  {
    slug: 'install-as-app',
    category: 'getting-started',
    title: 'Installing beanies.family as an app',
    excerpt:
      'Add beanies.family to your home screen or desktop so it opens like a real app — full screen, one tap away, works offline.',
    icon: '\u{1F4F1}',
    readTime: 3,
    popular: true,
    updatedDate: '2026-04-21',
    sections: [
      {
        type: 'heading',
        content: 'Why install?',
        level: 2,
        id: 'why-install',
      },
      {
        type: 'paragraph',
        content:
          'beanies.family is a <strong>Progressive Web App (PWA)</strong> — the same app you use in your browser, but with a home-screen icon and a full-screen launch (no browser bars). Installing gets you:',
      },
      {
        type: 'list',
        content: '',
        items: [
          'A real app icon on your home screen / dock',
          'Opens instantly in full-screen, no URL bar',
          'Works offline once it\u2019s loaded',
          'Still 100% local-first \u2014 no app-store account, no review process, no data leaves your device unless you enable sync',
        ],
      },
      {
        type: 'heading',
        content: 'Jump to the steps for your device',
        level: 2,
        id: 'pick-device',
      },
      {
        type: 'paragraph',
        content:
          '<a href="#install-ios" style="display: inline-flex; align-items: center; gap: 0.5rem; margin: 0 0.5rem 0.5rem 0; padding: 0.875rem 1.25rem; background: #F15D22; color: #ffffff; border-radius: 12px; font-family: Outfit, sans-serif; font-weight: 600; text-decoration: none; min-width: 44px;">\u{1F4F1} iPhone / iPad</a><a href="#install-android" style="display: inline-flex; align-items: center; gap: 0.5rem; margin: 0 0.5rem 0.5rem 0; padding: 0.875rem 1.25rem; background: #F15D22; color: #ffffff; border-radius: 12px; font-family: Outfit, sans-serif; font-weight: 600; text-decoration: none; min-width: 44px;">\u{1F916} Android</a><a href="#install-desktop" style="display: inline-flex; align-items: center; gap: 0.5rem; margin: 0 0.5rem 0.5rem 0; padding: 0.875rem 1.25rem; background: #2C3E50; color: #ffffff; border-radius: 12px; font-family: Outfit, sans-serif; font-weight: 600; text-decoration: none; min-width: 44px;">\u{1F4BB} Desktop (Mac / Windows / Linux)</a>',
      },
      {
        type: 'heading',
        content: '\u{1F4F1} iPhone / iPad',
        level: 2,
        id: 'install-ios',
      },
      {
        type: 'paragraph',
        content:
          'On iPhone and iPad, you install through the <strong>Share</strong> menu in <strong>Safari</strong>. This is the only browser on iOS that can install a PWA \u2014 if you\u2019re using Chrome or Firefox, switch to Safari first.',
      },
      {
        type: 'steps',
        content: '',
        items: [
          'Open <a href="https://app.beanies.family" target="_blank" rel="noopener">app.beanies.family</a> in <strong>Safari</strong> \u2014 no need to sign in yet, you\u2019ll do that once the installed app opens',
          'Tap the <strong>Share</strong> button at the bottom of the screen (the square with an up-arrow)',
          'Scroll down in the share sheet and tap <strong>Add to Home Screen</strong>',
          'Edit the name if you want (or leave it as "beanies.family") and tap <strong>Add</strong> in the top-right',
          'The beanies icon now appears on your home screen. Tap it to open the app full-screen.',
        ],
      },
      {
        type: 'paragraph',
        content:
          '<img src="/help/pwa-install/install-app-iphone-share.webp" alt="Safari browser with the Share button highlighted at the bottom" width="738" height="1594" loading="lazy" decoding="async" style="max-width: 100%; height: auto; border-radius: 12px; box-shadow: 0 4px 16px rgba(44,62,80,0.08);" />',
      },
      {
        type: 'paragraph',
        content:
          '<img src="/help/pwa-install/install-app-iphone-addtohome.webp" alt="The iOS share sheet with Add to Home Screen highlighted" width="736" height="1590" loading="lazy" decoding="async" style="max-width: 100%; height: auto; border-radius: 12px; box-shadow: 0 4px 16px rgba(44,62,80,0.08);" />',
      },
      {
        type: 'infoBox',
        content:
          'Once the icon is on your home screen, skip ahead to <a href="#sign-in-after">After installing</a> to sign in.',
        title: 'Next step',
        icon: '\u{1F449}',
      },
      {
        type: 'heading',
        content: '\u{1F916} Android',
        level: 2,
        id: 'install-android',
      },
      {
        type: 'paragraph',
        content:
          'On Android (Chrome, Edge, Brave, Samsung Internet, and most other browsers), you have <strong>three ways</strong> to install \u2014 pick whichever shows up for you first.',
      },
      {
        type: 'heading',
        content: 'Option 1 \u2014 Accept the automatic install prompt',
        level: 3,
        id: 'install-android-prompt',
      },
      {
        type: 'paragraph',
        content:
          'After using beanies.family for a minute or two, your browser may show a small pop-up asking if you want to install the app. If you see it, tap <strong>Install</strong> (or <strong>Add</strong>) and you\u2019re done \u2014 skip to <a href="#sign-in-after">After installing</a>.',
      },
      {
        type: 'paragraph',
        content:
          '<img src="/help/pwa-install/install-app-android-prompt.webp" alt="The install prompt that appears in Chrome on Android, with an Install button" width="800" height="1785" loading="lazy" decoding="async" style="max-width: 100%; height: auto; border-radius: 12px; box-shadow: 0 4px 16px rgba(44,62,80,0.08);" />',
      },
      {
        type: 'heading',
        content: 'Option 2 \u2014 Install from inside the app (Settings)',
        level: 3,
        id: 'install-android-settings',
      },
      {
        type: 'paragraph',
        content:
          'If you\u2019re already signed in and using beanies.family in a browser tab, there\u2019s a shortcut right inside the app:',
      },
      {
        type: 'steps',
        content: '',
        items: [
          'Tap the <strong>Settings</strong> link in the sidebar (or the menu on mobile)',
          'Scroll down to the <strong>Install App</strong> section',
          'Tap the <strong>Install beanies.family</strong> button',
          'Confirm in the browser pop-up \u2014 the app icon is added to your home screen',
        ],
      },
      {
        type: 'paragraph',
        content:
          '<img src="/help/pwa-install/install-app-android-addtohome-settings.webp" alt="The Install App section in beanies.family Settings with the Install beanies.family button" width="800" height="1785" loading="lazy" decoding="async" style="max-width: 100%; height: auto; border-radius: 12px; box-shadow: 0 4px 16px rgba(44,62,80,0.08);" />',
      },
      {
        type: 'heading',
        content: 'Option 3 \u2014 Install from the browser menu',
        level: 3,
        id: 'install-android-manual',
      },
      {
        type: 'paragraph',
        content:
          'If the prompt didn\u2019t appear and you don\u2019t see the Install App section in Settings, you can always install manually from the browser:',
      },
      {
        type: 'steps',
        content: '',
        items: [
          'Open <a href="https://app.beanies.family" target="_blank" rel="noopener">app.beanies.family</a> in <strong>Chrome</strong> \u2014 no need to sign in yet, you\u2019ll do that once the installed app opens',
          'Tap the <strong>three-dot menu</strong> (\u22EE) in the top-right corner',
          'Tap <strong>Install app</strong> or <strong>Add to Home screen</strong> (the exact label depends on your Android version)',
          'Tap <strong>Install</strong> in the pop-up to confirm',
          'The beanies icon appears on your home screen \u2014 tap it to launch the app',
        ],
      },
      {
        type: 'paragraph',
        content:
          '<img src="/help/pwa-install/install-app-android-3-dot-menu.webp" alt="Chrome on Android with the three-dot menu open, showing Install app" width="712" height="1522" loading="lazy" decoding="async" style="max-width: 100%; height: auto; border-radius: 12px; box-shadow: 0 4px 16px rgba(44,62,80,0.08);" />',
      },
      {
        type: 'infoBox',
        content:
          'Edge, Samsung Internet, and Firefox work too \u2014 the steps are the same: open the browser menu and look for "Install app" or "Add to Home screen".',
        title: 'Using a different Android browser?',
        icon: '\u2139\uFE0F',
      },
      {
        type: 'infoBox',
        content:
          'Installed the app? Skip ahead to <a href="#sign-in-after">After installing</a> to sign in.',
        title: 'Next step',
        icon: '\u{1F449}',
      },
      {
        type: 'heading',
        content: '\u{1F4BB} Desktop (Mac, Windows, Linux)',
        level: 2,
        id: 'install-desktop',
      },
      {
        type: 'paragraph',
        content:
          'On your computer, Chrome-based browsers \u2014 Chrome, Edge, Brave, Arc, and others \u2014 all support PWA install. You have <strong>two ways</strong> to do it.',
      },
      {
        type: 'heading',
        content: 'Option 1 \u2014 Click the install icon in the URL bar',
        level: 3,
        id: 'install-desktop-urlbar',
      },
      {
        type: 'paragraph',
        content:
          'Look for the <strong>install icon</strong> at the right edge of the URL bar \u2014 it looks like a small monitor with a down-arrow.',
      },
      {
        type: 'steps',
        content: '',
        items: [
          'Open <a href="https://app.beanies.family" target="_blank" rel="noopener">app.beanies.family</a> in Chrome / Edge / Brave \u2014 no need to sign in yet, you\u2019ll do that once the installed app opens',
          'Click the <strong>install icon</strong> in the URL bar (right side, near the bookmark star)',
          'If you don\u2019t see the icon, open the browser menu (\u22EE or \u2026) and look for <strong>Install beanies.family</strong> or <strong>Apps \u2192 Install this site as an app</strong>',
          'Click <strong>Install</strong> in the confirmation pop-up',
          'beanies.family opens in its own window and is added to your Applications / Start Menu',
        ],
      },
      {
        type: 'heading',
        content: 'Option 2 \u2014 Install from inside the app (Settings)',
        level: 3,
        id: 'install-desktop-settings',
      },
      {
        type: 'paragraph',
        content:
          'Already signed in? Click <strong>Settings</strong> in the sidebar, scroll to the <strong>Install App</strong> section, and click <strong>Install beanies.family</strong>. Confirm in the pop-up and the app is added to your machine.',
      },
      {
        type: 'infoBox',
        content:
          'Safari on macOS can install PWAs as of Sonoma (14.0+). Open <a href="https://app.beanies.family" target="_blank" rel="noopener">app.beanies.family</a> in Safari, then from the menu bar choose <strong>File \u2192 Add to Dock</strong>.',
        title: 'Safari on macOS',
        icon: '\u{1F34E}',
      },
      {
        type: 'heading',
        content: 'After installing',
        level: 2,
        id: 'sign-in-after',
      },
      {
        type: 'paragraph',
        content:
          'Launch the app from its new icon and sign in with your Google account. If you already have a family pod, choose <strong>Load Existing Family</strong> and pick your <code>.beanpod</code> file from Google Drive. Enter your password and you\u2019re in.',
      },
      {
        type: 'heading',
        content: 'How to uninstall',
        level: 2,
        id: 'uninstall',
      },
      {
        type: 'paragraph',
        content:
          'Uninstalling removes the app icon and clears the app\u2019s local cache on that device. <strong>Your pod file on Google Drive is not affected</strong> \u2014 you can re-install any time and load it back.',
      },
      {
        type: 'heading',
        content: 'Uninstall on iPhone / iPad',
        level: 3,
        id: 'uninstall-ios',
      },
      {
        type: 'steps',
        content: '',
        items: [
          'Find the <strong>beanies</strong> icon on your home screen',
          'Touch and hold the icon until a menu appears',
          'Tap <strong>Remove App</strong> (or <strong>Delete Bookmark</strong> on older iOS)',
          'Confirm <strong>Delete from Home Screen</strong> or <strong>Delete App</strong>',
        ],
      },
      {
        type: 'heading',
        content: 'Uninstall on Android',
        level: 3,
        id: 'uninstall-android',
      },
      {
        type: 'steps',
        content: '',
        items: [
          'Find the <strong>beanies</strong> icon on your home screen or app drawer',
          'Touch and hold the icon',
          'Drag it to <strong>Uninstall</strong> at the top of the screen, or tap <strong>Uninstall</strong> in the pop-up menu',
          'Confirm <strong>OK</strong> / <strong>Uninstall</strong>',
        ],
      },
      {
        type: 'paragraph',
        content:
          '<img src="/help/pwa-install/install-app-android-uninstall.webp" alt="Android app info screen with the Uninstall button" width="800" height="1785" loading="lazy" decoding="async" style="max-width: 100%; height: auto; border-radius: 12px; box-shadow: 0 4px 16px rgba(44,62,80,0.08);" />',
      },
      {
        type: 'heading',
        content: 'Uninstall on desktop (Chrome / Edge / Brave)',
        level: 3,
        id: 'uninstall-desktop',
      },
      {
        type: 'steps',
        content: '',
        items: [
          'Open the installed app',
          'Click the <strong>three-dot menu</strong> (\u22EE) in the app window\u2019s top-right',
          'Click <strong>Uninstall beanies.family</strong>',
          'Confirm <strong>Remove</strong> (optionally tick "Also clear data" to wipe the cache)',
        ],
      },
      {
        type: 'callout',
        content:
          'Uninstalling clears local data on that device only. As long as your <code>.beanpod</code> file is still on Google Drive (or wherever you saved it), your pod is safe and you can restore it by re-installing and choosing <strong>Load Existing Family</strong>.',
        title: 'Your data is safe',
        icon: '\u2705',
      },
      {
        type: 'heading',
        content: 'Troubleshooting',
        level: 2,
        id: 'troubleshooting',
      },
      {
        type: 'heading',
        content: '"Install app" option is greyed out or missing',
        level: 3,
        id: 'troubleshoot-missing',
      },
      {
        type: 'paragraph',
        content:
          'Make sure you\u2019re using a supported browser (Chrome, Edge, Brave, Safari on iOS 16.4+). If you\u2019re already in private / incognito mode, switch to a normal window \u2014 private browsing blocks PWA install on most browsers.',
      },
      {
        type: 'heading',
        content: 'The app opens but shows a URL bar at the top',
        level: 3,
        id: 'troubleshoot-url-bar',
      },
      {
        type: 'paragraph',
        content:
          'That means the app wasn\u2019t installed directly from <a href="https://app.beanies.family" target="_blank" rel="noopener">app.beanies.family</a>. Uninstall the current icon (steps above), then visit <a href="https://app.beanies.family" target="_blank" rel="noopener">app.beanies.family</a> fresh and re-install using the steps for your device. The new install will launch in full-screen mode.',
      },
      {
        type: 'heading',
        content: 'I don\u2019t see the icon after installing',
        level: 3,
        id: 'troubleshoot-icon',
      },
      {
        type: 'paragraph',
        content:
          'On Android and iOS, check your full app drawer / all apps list \u2014 the icon might have been placed there rather than on the main home screen. On desktop, look in your Applications folder (macOS) or Start Menu (Windows).',
      },
    ],
  },
];
