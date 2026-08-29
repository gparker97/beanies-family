# Release-note authoring guide (deploy skills)

Every Vue-app deploy ships a brief, user-facing **release note**. It is bundled
into the app, so when clients update (the "fresh beans loaded" toast) the
`whats-new` notification derives from it and the bell badges — greg approved the
wording first. This guide is shared by `deploy-prod-auto` and
`deploy-prod-skip-ci`; both invoke it at deploy time.

The data model lives in `src/content/release-notes/`. Brief per-deploy notes go
in `deploys.ts` (the registry merges + sorts them). See `ReleaseNote` +
`isSpotlightRelease` in `index.ts`.

---

## When to author a note

- **Only when the Vue app is deploying** (`VUE: yes` from `classify-changes.sh`).
  A web-only deploy (`deploy-web.yml`) does not touch the app bundle, so it gets
  **no** app release note.
- If the Vue deploy carries **zero user-facing change** (pure internal refactor
  with no behaviour delta), it is fine to ship a minor "fixes & improvements"
  note — but if there is genuinely nothing a user could perceive, you may skip
  the note. Default to adding one.

## 1. Judge significance

Review what is shipping: `git log <last-deploy>..HEAD --oneline`, the working-tree
diff, and the top of `CHANGELOG.md` (the granular record for this deploy).

- **Minor** — blog/copy wording, small UI polish, minor logic or bug fixes,
  dependency bumps, refactors with no visible change. → generic message,
  `spotlight` omitted (badge only, never auto-opens).
- **Significant** — a new feature, a meaningfully new way to do something, a
  notable fix users felt, a privacy/security-relevant change. → a clear,
  benefit-led message and `spotlight: true` (auto-opens the drawer once).

## 2. Write the note (in greg's voice)

Every visible string needs both an `en` (sentence case, warm and plain) and a
`beanie` variant (the same line, all lowercase — usually just the lowercased
`en`).

**Shape — the general rule:**

- **Significant note** = a one-line `summary` (the at-a-glance bell row) **plus
  `features`**: one **headline + detail** block per new thing.
  - `summary` — a short, punchy one-liner ("Notifications are here!").
  - each `features[]` entry — a `title` (the **short bold headline**, what the
    new thing is) and a `description` (a **concise sentence on what it is and why
    it helps the family**). Optional `icon` (a lead emoji, shown for a
    single-feature note) and `tryItRoute` (a "try it →" deep-link).
  - **List several blocks for a multi-feature deploy** — the body renders them as
    a clean "beanstalk" list; a single block renders as one centred headline +
    reason. This is the same renderer either way.
- **Minor note** = `summary` only (no `features`, `spotlight` omitted — badge
  only, never auto-opens). Default line:
  - `en`: `Minor bug fixes and improvements.`
  - `beanie`: `minor bug fixes and improvements.`

Rules:

- **No em-dashes.** Use hyphens (`-`) or a colon. (greg's voice; em-dash reads as
  an AI tell.)
- **Concise.** The `title` is a few words; the `description` is one or two
  sentences. The `summary` is one short line.
- **Lead with the benefit / the _why_** — how it helps the family, not the
  implementation. ("See everyone's day side by side, so nobody's lesson gets
  missed.") Not: "Refactored the calendar grid component."
- **PUBLIC + safe.** The repo is public and this ships in the JS bundle, so the
  text is effectively public. NEVER name security-fix specifics or internals.
  A security deploy gets a generic line (e.g. `Security and privacy
improvements.`); the real detail stays in commits / `CHANGELOG.md`.

## 2b. Discord CTA on product/feature announcements (TEMPORARY — early-adopter phase)

> **Active rule, started 2026-06-12.** Every **product / feature announcement**
> ends with a Discord call-to-action, to route readers into the community + a
> single feedback / issue-report channel during the soft-launch. Runs until the
> early-adopter space is full (~100 families) **or greg says to stop** — then
> remove this section and the trailing block.

**Applies to:** significant / feature notes (the ones with a `features` block).
**Does NOT apply to:** minor "bug fixes & improvements" summary-only notes, or
silently-shipped deploys (no note) — those aren't announcements.

When the note is an announcement, append this as the **last** `features[]` entry
(after the real feature blocks):

```ts
{
  icon: '💬',
  title: { en: 'Join us on Discord', beanie: 'join us on discord' },
  description: {
    en: "Get the latest beanies news and tell us what's working (or not) - report any issues or share feedback, and help shape what's next.",
    beanie:
      "get the latest beanies news and tell us what's working (or not) - report any issues or share feedback, and help shape what's next.",
  },
  cta: {
    label: { en: 'Join the Discord', beanie: 'join the discord' },
    href: 'https://beanies.family/discord',
  },
},
```

(`href` is `DISCORD_URL` = `MARKETING_URL + '/discord'`; keep the literal in the
static note. No em-dashes — hyphens only.)

## 3. Compute the version + display date

- `version` = today's date dotted: `YYYY.MM.DD` (e.g. `2026.05.27`).
- If `deploys.ts` already contains an entry whose version starts with today's
  date, append `.2`, `.3`, … (e.g. `2026.05.27.2`). Check with:
  `grep "version: '<today>" src/content/release-notes/deploys.ts`
- `date` = ISO `YYYY-MM-DD`.
- `month` = friendly lowercase date, e.g. `27 may 2026` (shown as the detail's
  label).

## 3b. Bump the product version (`APP_VERSION`)

Separate from the dated release-note `version` above, every prod deploy also
bumps the **product version** shown inside the app (sidebar + Settings footer).
It is the single constant `APP_VERSION` in `src/constants/appVersion.ts`.

Read the current value:
`grep "APP_VERSION =" src/constants/appVersion.ts`

Propose the next value by the convention documented in that file:

- **Normal release (default)** — increment the patch: `0.9` → `0.9.1`,
  `0.9.1` → `0.9.2`.
- **Revision / hotfix of the release just shipped** (a re-deploy that fixes the
  same logical release rather than net-new work) — append/increment `R<n>`:
  `0.9.1` → `0.9.1R1`, `0.9.1R1` → `0.9.1R2`.
- **Minor / major** (`0.9` → `0.10`, or `1.0` for the full public launch) —
  ONLY when greg explicitly says so; never bump the minor/major automatically.

Judge patch-vs-revision from what is shipping (the `git log <last-deploy>..HEAD`
you already reviewed in §1): net-new work = patch bump; a same-release fix =
`R<n>`. **Propose** the value — greg confirms or overrides it at the same
approval pause as the note (§4). This is what keeps the shown version meaningful
instead of rotting like the old hardcoded `v1.0.0 - MVP`.

## 4. Propose to greg, then add the entry

1. **Present the drafted note for approval** — this is the ONE allowed pause in
   the auto skill. Show: emoji ✨, release-note `version`, `month`, the `summary`
   line, each feature's `title` + `description` (both `en` and `beanie`), whether
   it is `spotlight`, a one-line significance rationale, **and the proposed
   `APP_VERSION` bump** (current → next, with the patch-vs-revision reason from
   §3b). Wait for greg's approval or edits. (The deploy emoji is always ✨ — set
   on the `whats-new` notification kind, not per entry, so it is not a field
   here.)
2. On approval, **prepend** the entry to the `DEPLOY_NOTES` array in
   `src/content/release-notes/deploys.ts` (use the Edit tool; do not hand-munge
   via shell). A minor entry (summary only):

   ```ts
   {
     version: '2026.05.27',
     date: '2026-05-27',
     month: '27 may 2026',
     summary: {
       en: 'Minor bug fixes and improvements.',
       beanie: 'minor bug fixes and improvements.',
     },
   },
   ```

   A significant entry adds `spotlight: true`, a one-line `summary`, and a
   `features` block per new thing (headline + detail):

   ```ts
   {
     version: '2026.05.27',
     date: '2026-05-27',
     month: '27 may 2026',
     spotlight: true,
     summary: { en: 'A short, warm one-liner.', beanie: 'a short, warm one-liner.' },
     features: [
       {
         title: { en: 'Short bold headline', beanie: 'short bold headline' },
         description: {
           en: 'A concise sentence on what it is and why it helps the family.',
           beanie: 'a concise sentence on what it is and why it helps the family.',
         },
         // icon: '✨',          // optional lead emoji (single-feature note)
         // tryItRoute: '/path', // optional "try it →" deep-link
       },
       // ...one block per additional new thing
     ],
   },
   ```

   (The bigger curated monthly releases live in their own `YYYY-MM.ts` file and
   also add a `fixes` list — the per-deploy stream rarely needs that.)

3. **Bump `APP_VERSION`** (per §3b) — Edit `src/constants/appVersion.ts` to the
   approved value (e.g. `0.9` → `0.9.1`). Both this and the note ride the same
   deploy commit below, so the shown product version moves with the release.

4. **Commit the note + version bump together** (they must be in the deployed
   commit):

   ```
   git add src/content/release-notes/deploys.ts src/constants/appVersion.ts
   ```

   ```
   git commit -m "docs(release): note <version> (app v<APP_VERSION>) for prod deploy" -m "<the en summary>" -m "Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
   ```

   ```
   git push
   ```

   The push runs the pre-push hook (tests) and re-triggers CI. Continue the
   deploy flow from here — CI monitoring (auto skill) / the deploy itself
   (skip-ci skill) then covers this commit, and the deploy gate re-verifies CI
   for HEAD.

The release note is **distinct from** `CHANGELOG.md`: the changelog is the
granular dev record (updated on every push); the release note is the brief,
public, benefit-framed sibling. Keep them consistent.

## Secondary updates stay SHORT (greg, 2026-08-29)

For anything that is not the deploy's headline — smaller bug fixes, polish,
side fixes that ride along — one short line is the whole entry, in the release
note AND in `CHANGELOG.md`. "Fixed a Google Calendar sync bug." is a complete
changelog bullet; do NOT write a paragraph explaining the mechanism, the root
cause, or the hardening. The technical story already lives in the commit
message — never duplicate it into user-facing surfaces. When in doubt between
"minor bug fixes and improvements" and a technical explanation, choose the
short line.
