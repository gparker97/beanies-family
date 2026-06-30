# Self-hosting beanies.family

beanies.family is open source. You can clone the repo and run your own copy on your own infrastructure. This doc walks through the two supported self-host paths, what each one gets you, and exactly how to set them up.

> If you just want to read the code or run a local dev environment, the [main README](../README.md) covers the basics. This doc is for self-hosters running the app for actual family use.

---

## Self-hosting Trade-offs

There are genuine trade-offs to self-hosting beanies.family which should be made clear. The main one is that you need a back-end service to use the Google Drive API (or any other cloud storage providers we may add in the future). A simple Lambda does the trick, but it does require some setup and configuration time.

The easiest path for self-hosting is to use the local file option. The local file can be saved anywhere, including a synced Google Drive / Dropbox / etc folder. For this to work, it requires the File System Access API in the browser for the site to access the file, which is only available on desktop browsers (i.e. Chrome). Support on Android is spotty, and iOS is almost totally out of the picture due to stricter privacy concerns.

The slightly more complicated path is to set up your own back-end infra (following the instructions below) to use a cloud storage provider (Google Drive at the moment) via API.

In summary:

| You want                                                   | Use        | Setup effort                                   | Multi-device sync                                               | Works on iOS / mobile                                 |
| ---------------------------------------------------------- | ---------- | ---------------------------------------------- | --------------------------------------------------------------- | ----------------------------------------------------- |
| Quick, private, desktop family use — no cloud, no accounts | **Path A** | Minutes                                        | Via your own cloud-storage folder (Dropbox / iCloud / OneDrive) | Yes but limited - you need to load the file each time |
| Full beanies.family experience on your own infrastructure  | **Path B** | A couple of hours (AWS + Google Cloud Console) | Yes — Google Drive sync via your own OAuth Lambda               | Yes                                                   |

If you're not sure, you can always start with **Path A**. You can switch to Path B later by exporting your `.beanpod` and re-importing, which should work fine.

---

## Path A — Local file in a synced folder

The simplest self-host approach. Build the app, point a desktop browser at it, and store your `.beanpod` file inside a folder that your existing cloud-storage provider already syncs across your devices (Dropbox, iCloud Drive, OneDrive, Box, Google Drive desktop client). Each family member opens the same shared folder via their own provider's desktop client. [Automerge](https://automerge.org/) (a CRDT) handles concurrent edits and merges them automatically — no server needed.

### Setup

```bash
git clone https://github.com/gparker97/beanies-family.git
cd beanies-family
npm install
npm run dev    # local dev — http://localhost:5173
# OR
npm run build && npm run preview    # production build, serve dist/ anywhere
```

**No `.env.local` required.** Path A is genuinely zero-config — the app's feature gates auto-disable every cloud-dependent surface, and the local-file storage option is always available. The Settings footer will read **🏠 Self-hosted · Community build** at the bottom.

### Use

1. On first launch, click **Create new pod** → pick **Local File** → save a new `.beanpod` file inside your synced folder (e.g. `~/Dropbox/beanies/our-family.beanpod`).
2. Wait for your cloud-storage provider's desktop client to sync the file.
3. On each family member's device, open the same `.beanpod` file from the same synced folder.
4. Edits made by any family member sync via your cloud-storage provider; Automerge merges them on load and on every poll tick (~15s).

### Limitations

- **Desktop Chromium-family browsers are required for file sync** The File System Access API picker methods (which give us a persistent file handle that survives across sessions) are supported on desktop Chrome / Edge / Opera / Brave only — see [caniuse](https://caniuse.com/native-filesystem-api). On iOS Safari, Android Chrome, desktop Firefox, and desktop Safari, the app falls back to a manual file-picker on each open + a "save as" download on each save. That works for one-off edits but isn't real-time sync.
- **Conflict copies** If two family members edit while one is offline, your cloud-storage provider _may_ create a "conflicted copy" file (Dropbox: `our-family (conflicted copy 2026-04-30).beanpod`; iCloud: `our-family 2.beanpod`; OneDrive: `our-family-conflict-DEVICE.beanpod`). Open the conflict file once after sync following the below steps:
  1. Open the conflict copy via "Settings → Family Data → Load another Family Data File → Browse..." and select the _conflict_ data file. Beanies will load it, Automerge will safely merge all data with your in-memory state, and save the merged result.
  2. Manually move or delete the now-redundant original data file via your file manager (if you want)
- **Polling delay** The app checks the file for external changes every ~15 seconds while the tab is visible. Real-time collaboration (both editing the same screen at once) is not instant, but near real time.
- **Cloud-folder choice is a family decision** Every family member needs the same cloud-storage provider syncing the same shared folder. There's no universal "anyone can sync this folder" option — Dropbox shared folders need Dropbox accounts, iCloud is Apple-only, OneDrive needs Microsoft, etc.

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

You have two options here — pick whichever matches your infrastructure.

**Option 1 — AWS Lambda (in-tree reference).** The Lambda code lives at [`infrastructure/lambda/oauth/`](../infrastructure/lambda/oauth/) — about 175 lines of Node.js 20, no dependencies beyond the standard runtime. Step-by-step AWS deploy guide at [`infrastructure/lambda/oauth/README.md`](../infrastructure/lambda/oauth/README.md). The runtime-agnostic API contract is at [`infrastructure/lambda/oauth/SPEC.md`](../infrastructure/lambda/oauth/SPEC.md) — implement it on Cloudflare Workers, Vercel Edge, or any Node host if AWS isn't your thing.

**Option 2 — Node side-car via Docker / Dokploy / Coolify (community reference).** Sam Ledoux maintains [`Snaxilla/beanies-oauth-proxy`](https://github.com/Snaxilla/beanies-oauth-proxy), a clean, dependency-free Node implementation of the same SPEC, designed to run as a side-car alongside other Docker services. If you already run a VPS with Dokploy, Coolify, Railway, or even a Raspberry Pi at home, this is usually the easier path — no AWS account required. It's a community project (not maintained by the beanies.family team), but conforms to [`infrastructure/lambda/oauth/SPEC.md`](../infrastructure/lambda/oauth/SPEC.md) and is suitable for production family use.

Either option needs two env vars:

- `GOOGLE_CLIENT_SECRET` — from Step 1
- `CORS_ORIGIN` — your SPA's origin (the proxy allowlists this for CORS)

Once deployed, copy the proxy's URL (API Gateway URL for AWS, your Dokploy domain for the Node side-car, etc.) → `VITE_OAUTH_PROXY_URL` in your SPA's `.env.local`.

### Path B env-var summary

| Var                          | Required?          | Sourced from                        |
| ---------------------------- | ------------------ | ----------------------------------- |
| `VITE_GOOGLE_CLIENT_ID`      | Required for Drive | Google Cloud Console (OAuth client) |
| `VITE_OAUTH_PROXY_URL`       | Required for Drive | Your OAuth Lambda's URL (Step 2)    |
| `VITE_GOOGLE_API_KEY`        | Picker only        | Google Cloud Console (API key)      |
| `VITE_GOOGLE_PROJECT_NUMBER` | Picker only        | Google Cloud Console (dashboard)    |

---

## Settings footer badge

The Settings page footer shows which build you're on:

| Badge                            | Meaning                                                                                                               |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| ☁️ Cloud-hosted version          | You're on `app.beanies.family` (the official cloud build).                                                            |
| 🛠 Self-hosted · Developer build  | Both Drive (`VITE_GOOGLE_CLIENT_ID`) and registry (`VITE_REGISTRY_API_URL` + `VITE_REGISTRY_API_KEY`) are configured. |
| 🏠 Self-hosted · Community build | One or both essentials are missing. The corresponding UI surfaces are disabled with a tooltip explaining why.         |

---

## Optional features (independent of Path A vs B)

These features have their own env vars and silently disable when unset. They work on either path.

### Translation API quota — `VITE_MYMEMORY_EMAIL`

The free MyMemory translation API has a 5k chars/day anonymous quota; setting your email upgrades it to 50k. For a single family with translation caching, the lower quota is usually plenty. Set this only if you hit the limit.

---

## Known limitations (cosmetic, non-gated)

These don't break anything functionally but are mentioned for completeness:

- **Open Graph + Twitter meta tags** in `index.html` hard-code `https://beanies.family/` as the canonical URL.
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
