# PWA install help-article screenshots

Screenshots used by the "Installing beanies.family as an app" help article at `/help/getting-started/install-as-app`.

Filenames here match the `<img src>` paths in `src/content/help/getting-started.ts`.

| Filename | Shows |
|---|---|
| `install-app-android-prompt.jpg` | Auto-install banner at the bottom of Chrome on Android (the "plant it!" prompt) |
| `install-app-android-addtohome-settings.jpg` | In-app Settings page with the "Install beanies.family" button |
| `install-app-iphone-share.jpg` | iOS Safari share menu — shows how to open Share |
| `install-app-iphone-addtohome.jpg` | iOS share sheet scrolled to show "Add to Home Screen" |
| `install-app-android-3-dot-menu.jpg` | Chrome three-dot menu on Android with "Add to Home screen" option |
| `install-app-android-uninstall.jpg` | Android app info screen with the Uninstall button |

## Updating / adding new screenshots

- JPG is preferred for screenshots (smaller than PNG). Target ~100-150 KB per image — source screenshots from devices can be multiple MB.
- Use: `convert input.png -resize '800>' -quality 82 output.jpg`
- Desktop install icon screenshot (`install-app-desktop-install-icon.jpg`) is NOT currently captured. The desktop install section has text-only guidance which is clear on its own; add this file later if you want a visual.

**Testing locally:** after dropping files in, run `npm run dev:web` and visit `http://localhost:4321/help/getting-started/install-as-app` to preview.
