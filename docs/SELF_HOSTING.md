# Self-hosting beanies.family

beanies.family is open source. You can clone the repo and run your own copy with no extra config — the app is **local-first**, with all data stored in your browser's IndexedDB and exportable to encrypted `.beanpod` files. A handful of cloud-dependent features (Google Drive sync, magic-link family invites, analytics, Slack telemetry) need extra setup. This doc walks through what's available, how to enable it, and what's not currently supported.

> If you're just curious about the codebase or running a local dev environment, the [main README](../README.md) covers the basics. This doc is for self-hosters and anyone setting up the full env-var matrix.

---

## What works out of the box (community build)

A `git clone && npm install && npm run dev` (or `npm run build && npm run preview`) gives you:

- **All UI features** — accounts, transactions, assets, goals, family members, todos, calendar, recipes, medications, photos.
- **Offline-first** — IndexedDB stores the live Automerge document; the app works fully offline.
- **Manual `.beanpod` export/import** — encrypted backups you keep yourself. Settings → Family Data → Export / Import.
- **Multi-currency, themes, beanie mode, Chinese translation** — all client-side.

What you **don't** get without further config:

- Google Drive sync (encrypted-cloud `.beanpod` storage)
- Magic-link family invites + cross-device family lookup (the registry)
- Slack telemetry (invite requests, pod-creation, error reports)
- Plausible analytics
- The `de` upgrade for the MyMemory translation API (you stay on the free 5k chars/day quota — usually plenty for a single family)

The Settings page footer shows a small badge so you know which build you're on:

| Badge                            | Meaning                                                                                                             |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| ☁️ Cloud-hosted version          | You're on `app.beanies.family` (the official cloud build).                                                          |
| 🛠 Self-hosted · Developer build | All cloud env vars are configured — every feature is wired up.                                                      |
| 🏠 Self-hosted · Community build | Some cloud env vars are missing. The corresponding UI is disabled (with a tooltip explaining why) or simply absent. |

---

## Quick start

```bash
git clone https://github.com/gparker97/beanies-family.git
cd beanies-family
npm install
npm run dev   # http://localhost:5173
```

That's it. No `.env.local` needed for the community build. The Settings footer will read **🏠 Self-hosted · Community build**.

---

## Developer build — full feature set

Copy `.env.example` to `.env.local` and fill in the vars below. Restart the dev server (Vite inlines env at build time; HMR doesn't pick up `.env` changes).

### Google Drive sync — `VITE_GOOGLE_CLIENT_ID` (required), `VITE_GOOGLE_API_KEY` + `VITE_GOOGLE_PROJECT_NUMBER` (Picker only)

`VITE_GOOGLE_CLIENT_ID` alone is enough to enable Drive sync — OAuth + listing + read/write of `.beanpod` files all work. The other two are needed only by the **Drive Picker** dialog (used when joining via a shared file or recovering a pod from a different Drive account).

1. Go to [Google Cloud Console](https://console.cloud.google.com/) → create a new project (or pick an existing one).
2. Enable the **Google Drive API** (and **Google Picker API** if you want the Picker UX).
3. **APIs & Services → Credentials → Create credentials → OAuth client ID** (Web application). Under **Authorized JavaScript origins** add `http://localhost:5173` (and your production origin if applicable).
4. Copy the **Client ID** → `VITE_GOOGLE_CLIENT_ID`. **(Required for Drive sync.)**
5. _Picker only:_ **APIs & Services → Credentials → Create credentials → API key**. Restrict it to the Drive + Picker APIs. Copy the key → `VITE_GOOGLE_API_KEY`.
6. _Picker only:_ The **Project Number** is on the Cloud Console dashboard. Copy it → `VITE_GOOGLE_PROJECT_NUMBER`.

The first time you connect, Google's OAuth flow will warn you that the app is unverified — that's expected for a self-hosted build using your own client. Click through.

### Family registry (optional) — `VITE_REGISTRY_API_URL` + `VITE_REGISTRY_API_KEY`

The registry is a smoothness feature, not a hard requirement. With it: magic-link invites resolve directly to the right `.beanpod` file and the login flow can find a family without the user typing a Drive URL. Without it: the invite flow still works — joiners pick the shared file via Google Drive Picker after clicking the invite link, and the rest of the app behaves identically.

The cloud build points at greg's Lambda at `api.beanies.family`. There is no public reference implementation yet, so third-party self-hosters can't currently spin up an equivalent registry. If you want to, please open a GitHub issue — the API is small and a docker-compose shim is on the roadmap.

### Slack telemetry (optional)

Each webhook is independent — set whichever you want.

| Env var                          | Purpose                                                                                                                   |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `VITE_INVITE_WEBHOOK_URL`        | Posts to your Slack when someone fills the "request invite" form on the login gate.                                       |
| `VITE_SLACK_WEBHOOK_URL`         | Posts when a new pod is created.                                                                                          |
| `VITE_BEANIES_ERROR_WEBHOOK_URL` | Posts caught errors with build SHA, route, browser context, stack trace. Privacy-allowlisted (only email is sent as PII). |

Create incoming webhooks at <https://api.slack.com/apps> → your app → Incoming Webhooks. The webhook URL is the value to paste.

### Plausible analytics (optional) — `VITE_PLAUSIBLE_DOMAIN`

Set to your Plausible site identifier (the `pa-XXX` part of the script URL — find it in your Plausible site settings). Leave empty to disable analytics entirely; the script tag is conditionally injected at runtime, so a vanilla self-host stays fully offline by default.

### Translation API quota (optional) — `VITE_MYMEMORY_EMAIL`

The free MyMemory translation API has a 5k chars/day anonymous quota; setting `de=<your-email>` upgrades it to 50k. For a single family with translation caching, the lower quota is usually plenty. Set this only if you hit the limit.

### Invite gate (optional) — `VITE_INVITE_BEAN_HASHES`

For closed-beta gating: comma-separated SHA-256 hashes (lowercase hex) of valid invite tokens. Users enter the token to unlock the login page. Generate hashes with:

```bash
echo -n "my-token" | sha256sum | cut -d' ' -f1
```

Leave empty for open registration.

### Marketing-site URL (optional) — `VITE_MARKETING_URL`

In-app links to `/help`, `/blog`, `/guides` route through this URL. Defaults to `https://beanies.family` in prod and `http://localhost:4321` in dev. Override if you're running your own marketing site.

---

## Known limitations (cosmetic, non-gated)

These don't break anything functionally but are mentioned for self-hosters who plan to rebrand or visually polish their build:

- **Open Graph + Twitter meta tags** in `index.html` hard-code `https://beanies.family/` as the canonical URL. Self-hosters who deploy under a different hostname will have wrong URLs in social-share cards. Fix needs a Vite HTML transform plugin — tracked as a follow-up.
- **Passkey relying-party name** (`src/services/auth/passkeyService.ts`) shows `'beanies.family'` to users in OS-level passkey prompts. Cosmetic; tied to trademark.

---

## Trademark

`beanies.family` is the original author's project. Self-hosting for personal use is fine; redistributing your fork as a commercial "beanies.family" service is not. See [TRADEMARK.md](../TRADEMARK.md) for details.

---

## Reporting bugs

Open an issue at <https://github.com/gparker97/beanies-family/issues>. Include:

- The footer badge (Cloud / Developer / Community build)
- Browser + version
- A minimal repro if possible
