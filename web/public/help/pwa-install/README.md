# PWA install help-article screenshots

Drop these 5 screenshots into this directory (`web/public/help/pwa-install/`) to replace the broken-image placeholders in the "Installing beanies.family as an app" help article:

| Filename | Recommended size | What to capture |
|---|---|---|
| `01-install-prompt.jpg` | ~900px wide | The automatic install prompt as it appears in Chrome (desktop or Android) — the small pop-up with "Install app" |
| `02-ios-share-button.jpg` | ~900px wide (iPhone screenshot, cropped) | Safari on iOS showing the Share button at the bottom of the screen, circled or highlighted |
| `03-ios-add-to-home-screen.jpg` | ~900px wide | The iOS Share sheet scrolled to show "Add to Home Screen", highlighted |
| `04-android-menu.jpg` | ~900px wide | Chrome on Android with the three-dot menu open, "Install app" highlighted |
| `05-desktop-install-icon.jpg` | ~1400px wide | Chrome desktop URL bar with the install icon at the right, circled or highlighted |
| `06-settings-install-button.jpg` | ~1200px wide | beanies.family Settings page showing the "Install App" section + "Install beanies.family" button |

**Format:** JPG (smaller than PNG for screenshots). Optimize to ~200 KB each — they load as `loading="lazy"`.

**Where they appear:**

- Article: `https://beanies.family/help/getting-started/install-as-app`
- Source: `src/content/help/getting-started.ts` → article slug `install-as-app`

**Testing locally:** after dropping files in, run `npm run dev:web` and visit `http://localhost:4321/help/getting-started/install-as-app` to preview. Or just deploy with `gh workflow run deploy-web.yml -f target=production` — broken-image placeholders just show an empty box until the real files are there, so the article is useful immediately and improves as screenshots are added.
