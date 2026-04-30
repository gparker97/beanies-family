# Self-hosting beanies.family

beanies.family is open source. You can clone the repo and run your own copy on your own infrastructure. This doc walks through the two supported self-host paths, what each one gets you, and exactly how to set them up.

> If you just want to read the code or run a local dev environment, the [main README](../README.md) covers the basics. This doc is for self-hosters running the app for actual family use.

---

## TL;DR — pick your path

| You want                                                   | Use        | Setup effort                                   | Multi-device sync                                               | Works on iOS / mobile                              |
| ---------------------------------------------------------- | ---------- | ---------------------------------------------- | --------------------------------------------------------------- | -------------------------------------------------- |
| Quick, private, desktop family use — no cloud, no accounts | **Path A** | Minutes                                        | Via your own cloud-storage folder (Dropbox / iCloud / OneDrive) | Read-only export/import; full sync is desktop only |
| Full beanies.family experience on your own infrastructure  | **Path B** | A couple of hours (AWS + Google Cloud Console) | Yes — Google Drive sync via your own OAuth Lambda               | Yes                                                |

If you're not sure: start with **Path A**. You can switch to Path B later by exporting your `.beanpod` and re-importing.

---

## Path A — Local file in a synced folder

The simplest self-host story. You build the SPA, point a desktop browser at it, and store your `.beanpod` file inside a folder that your existing cloud-storage provider already syncs across your devices (Dropbox, iCloud Drive, OneDrive, Box, Google Drive desktop client). Each family member opens the same shared folder via their own provider's desktop client. [Automerge](https://automerge.org/) (a CRDT) handles concurrent edits and merges them automatically — no server needed.

### Setup

```bash
git clone https://github.com/gparker97/beanies-family.git
cd beanies-family
npm install
npm run dev    # local dev — http://localhost:5173
# OR
npm run build && npm run preview    # production build, serve dist/ anywhere
```

**No `.env.local` required.** Path A is genuinely zero-config — the app's feature gates auto-disable every cloud-dependent surface, and the local-file storage option is always available. The Settings footer will read **🏠 Self-hosted · Community build**.

### Use

1. On first launch, click **Create new pod** → pick **Local File** → save a new `.beanpod` file inside your synced folder (e.g. `~/Dropbox/beanies/our-family.beanpod`).
2. Wait for your cloud-storage provider's desktop client to sync the file.
3. On each family member's device, open the same `.beanpod` file from the same synced folder.
4. Edits made by any family member sync via your cloud-storage provider; Automerge merges them on load and on every poll tick (~15s).

### Honest limitations

- **Desktop Chromium-family browsers only for full sync.** The File System Access API picker methods (which give us a persistent file handle that survives across sessions) are supported on desktop Chrome / Edge / Opera / Brave only — see [caniuse](https://caniuse.com/native-filesystem-api). On iOS Safari, Android Chrome, desktop Firefox, and desktop Safari, the app falls back to a manual file-picker on each open + a "save as" download on each save. That works for one-off edits but isn't real-time sync.
- **Conflict copies.** If two family members edit while one is offline, your cloud-storage provider may create a "conflicted copy" file (Dropbox: `our-family (conflicted copy 2026-04-30).beanpod`; iCloud: `our-family 2.beanpod`; OneDrive: `our-family-conflict-DEVICE.beanpod`). Open the conflict file once after sync — Automerge will merge the divergent edits — then delete the duplicate.
- **Polling delay.** The app checks the file for external changes every ~15 seconds while the tab is visible. Real-time collaboration (both editing the same screen at once) won't feel instant. For family planning data, this is fine.
- **Cloud-folder choice is a family decision.** Every family member needs the same cloud-storage provider syncing the same shared folder. There's no universal "anyone can sync this folder" option — Dropbox shared folders need Dropbox accounts, iCloud is Apple-only, OneDrive needs Microsoft, etc.

---

## Path B — Run your own OAuth Lambda

Full feature parity with the cloud build at `app.beanies.family`. You register your own Google OAuth Web Application client, deploy a small OAuth proxy Lambda holding your own `client_secret`, optionally deploy a registry Lambda + DynamoDB table for cross-device family lookup, and configure your build with your own env vars.

### Why does Path B need a Lambda?

Google's "Web Application" OAuth client type **requires a server-side `client_secret` for the token-refresh grant, even when using PKCE.** This is a deliberate Google constraint — confirmed by direct testing and a Google Cloud Community statement: _"Google's Identity Platform as of today does not support public applications under the 'Web Application' profile."_ So Drive sign-in cannot work browser-only; you need a tiny server holding your secret.

Our cloud build runs this server at `api.beanies.family`. Self-hosters need to run their own — that's Path B.

### Step 1: Register your Google OAuth client

1. Go to [Google Cloud Console](https://console.cloud.google.com/) → create a new project (or pick an existing one).
2. Enable the **Google Drive API** (and **Google Picker API** if you want the Drive Picker UX).
3. **APIs & Services → Credentials → Create credentials → OAuth client ID** (Web application).
   - **Authorized JavaScript origins**: your SPA's origin (e.g. `https://family.example.com` and `http://localhost:5173` for dev).
   - **Authorized redirect URIs**: `<your-spa-origin>/oauth/callback` for each origin.
4. Copy the **Client ID** → `VITE_GOOGLE_CLIENT_ID`.
5. Copy the **Client Secret** → keep this for the Lambda (Step 2).
6. _For Picker (recommended):_ Create an **API key**, restrict it to Drive + Picker APIs, copy → `VITE_GOOGLE_API_KEY`. Find the **Project Number** on the dashboard → `VITE_GOOGLE_PROJECT_NUMBER`.

The first time you connect, Google's OAuth screen warns you that the app is unverified — expected for a self-hosted build using your own client. Click through.

### Step 2: Deploy the OAuth proxy Lambda

The Lambda code lives at [`infrastructure/lambda/oauth/`](../infrastructure/lambda/oauth/) — about 175 lines of Node.js 20, no dependencies beyond the standard runtime. Step-by-step AWS deploy guide at [`infrastructure/lambda/oauth/README.md`](../infrastructure/lambda/oauth/README.md). The runtime-agnostic API contract is at [`infrastructure/lambda/oauth/SPEC.md`](../infrastructure/lambda/oauth/SPEC.md) — implement it on Cloudflare Workers, Vercel Edge, or any Node host if AWS isn't your thing.

The Lambda needs two env vars:

- `GOOGLE_CLIENT_SECRET` — from Step 1
- `CORS_ORIGIN` — your SPA's origin (the Lambda allowlists this for CORS)

Once deployed, copy the API Gateway / Function URL → `VITE_OAUTH_PROXY_URL` in your SPA's `.env.local`.

### Step 3: Optional — Family registry (smoothness)

The registry stores `(familyId → file location)` pairs in DynamoDB so that joiners following a magic-link invite don't have to manually pick the shared `.beanpod` from a Drive Picker. Without it, joining still works — joiners just click an extra button.

Lambda code at [`infrastructure/lambda/registry/`](../infrastructure/lambda/registry/). Step-by-step deploy guide at [`infrastructure/lambda/registry/README.md`](../infrastructure/lambda/registry/README.md). DynamoDB schema: one partition key `familyId` (string), on-demand billing. Env vars:

- `TABLE_NAME` — your DynamoDB table name
- `REGISTRY_API_KEY` — a random secret you generate; the SPA sends it as `x-api-key`
- `CORS_ORIGIN` — your SPA's origin

Once deployed: `VITE_REGISTRY_API_URL` + `VITE_REGISTRY_API_KEY` in `.env.local`.

### Path B env-var summary

| Var                          | Required?           | Sourced from                        |
| ---------------------------- | ------------------- | ----------------------------------- |
| `VITE_GOOGLE_CLIENT_ID`      | Required for Drive  | Google Cloud Console (OAuth client) |
| `VITE_OAUTH_PROXY_URL`       | Required for Drive  | Your OAuth Lambda's URL (Step 2)    |
| `VITE_GOOGLE_API_KEY`        | Picker only         | Google Cloud Console (API key)      |
| `VITE_GOOGLE_PROJECT_NUMBER` | Picker only         | Google Cloud Console (dashboard)    |
| `VITE_REGISTRY_API_URL`      | Optional smoothness | Your Registry Lambda's URL (Step 3) |
| `VITE_REGISTRY_API_KEY`      | Optional smoothness | Random secret you generate (Step 3) |

If you set both `VITE_OAUTH_PROXY_URL` and `VITE_REGISTRY_API_URL`, OAuth will use the OAuth-specific var. If you only set `VITE_REGISTRY_API_URL` (because one Lambda backs both surfaces, like our cloud build does), OAuth falls back to it. Both env vars are first-class — neither is deprecated.

---

## Settings footer badge

The Settings page footer shows which build you're on:

| Badge                            | Meaning                                                                                                               |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| ☁️ Cloud-hosted version          | You're on `app.beanies.family` (the official cloud build).                                                            |
| 🛠 Self-hosted · Developer build | Both Drive (`VITE_GOOGLE_CLIENT_ID`) and registry (`VITE_REGISTRY_API_URL` + `VITE_REGISTRY_API_KEY`) are configured. |
| 🏠 Self-hosted · Community build | One or both essentials are missing. The corresponding UI surfaces are disabled with a tooltip explaining why.         |

---

## Optional features (independent of Path A vs B)

These features have their own env vars and silently disable when unset. They work on either path.

### Translation API quota — `VITE_MYMEMORY_EMAIL`

The free MyMemory translation API has a 5k chars/day anonymous quota; setting your email upgrades it to 50k. For a single family with translation caching, the lower quota is usually plenty. Set this only if you hit the limit.

### Plausible analytics — `VITE_PLAUSIBLE_DOMAIN`

Set your Plausible site identifier to enable analytics. Leave empty to opt out entirely.

### Slack telemetry — `VITE_INVITE_WEBHOOK_URL`, `VITE_SLACK_WEBHOOK_URL`, `VITE_BEANIES_ERROR_WEBHOOK_URL`

Each is independent. Empty = silent disable. Used by our cloud build for invite-request notifications, pod-creation tracking, and the universal error reporter. Self-hosters typically leave all three empty.

### Closed-beta gate — `VITE_INVITE_BEAN_HASHES`

Comma-separated SHA-256 hashes of valid invite tokens. Leave empty to allow open registration (recommended for self-hosters).

---

## Known limitations (cosmetic, non-gated)

These don't break anything functionally but are mentioned for self-hosters who plan to rebrand or visually polish their build:

- **Open Graph + Twitter meta tags** in `index.html` hard-code `https://beanies.family/` as the canonical URL. Self-hosters deploying under a different hostname will have wrong URLs in social-share cards. Fix needs a Vite HTML transform plugin — tracked as a follow-up.
- **Passkey relying-party name** (`src/services/auth/passkeyService.ts`) shows `'beanies.family'` to users in OS-level passkey prompts. Cosmetic; tied to trademark.

---

## Trademark

`beanies.family` is the original author's project. Self-hosting for personal use is fine; redistributing your fork as a commercial "beanies.family" service is not. See [TRADEMARK.md](../TRADEMARK.md) for details.

---

## Reporting bugs

Open an issue at <https://github.com/gparker97/beanies-family/issues>. Include:

- The footer badge (Cloud / Developer / Community build)
- Which path you're on (A or B)
- Browser + version
- A minimal repro if possible
