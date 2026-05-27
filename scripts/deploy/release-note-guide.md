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

## 2. Write the message (in greg's voice)

Two variants, both required:

- `en` — sentence case, warm and plain.
- `beanie` — the same line, all lowercase (the cosmetic overlay; usually just
  the lowercased `en`).

Rules:

- **No em-dashes.** Use hyphens (`-`). (greg's voice; em-dash reads as an AI tell.)
- **Concise** — one or two sentences. The row shows it at a glance.
- **Significant notes lead with the benefit / the _why_** — how it helps the
  family, not the implementation. ("See everyone's day side by side, so nobody's
  lesson gets missed.") Not: "Refactored the calendar grid component."
- **Minor notes** use a generic line. Default:
  - `en`: `Minor bug fixes and improvements.`
  - `beanie`: `minor bug fixes and improvements.`
- **PUBLIC + safe.** The repo is public and this ships in the JS bundle, so the
  message is effectively public. NEVER name security-fix specifics or internals.
  A security deploy gets a generic line (e.g. `Security and privacy
improvements.`); the real detail stays in commits / `CHANGELOG.md`.

## 3. Compute the version + display date

- `version` = today's date dotted: `YYYY.MM.DD` (e.g. `2026.05.27`).
- If `deploys.ts` already contains an entry whose version starts with today's
  date, append `.2`, `.3`, … (e.g. `2026.05.27.2`). Check with:
  `grep "version: '<today>" src/content/release-notes/deploys.ts`
- `date` = ISO `YYYY-MM-DD`.
- `month` = friendly lowercase date, e.g. `27 may 2026` (shown as the detail's
  label).

## 4. Propose to greg, then add the entry

1. **Present the drafted note for approval** — this is the ONE allowed pause in
   the auto skill. Show: emoji ✨, version, `month`, the `en` line, the `beanie`
   line, whether it is `spotlight`, and a one-line significance rationale. Wait
   for greg's approval or edits. (The deploy emoji is always ✨ — set on the
   `whats-new` notification kind, not per entry, so it is not a field here.)
2. On approval, **prepend** the entry to the `DEPLOY_NOTES` array in
   `src/content/release-notes/deploys.ts` (use the Edit tool; do not hand-munge
   via shell). A minor entry:

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

   A significant entry adds `spotlight: true` and a benefit-led `summary`.
   (Reserve rich `features` cards for big curated releases authored in their own
   `YYYY-MM.ts` file — most deploys only need a `summary`.)

3. **Commit the note on its own** (it must be in the deployed commit):

   ```
   git add src/content/release-notes/deploys.ts
   ```

   ```
   git commit -m "docs(release): note <version> for prod deploy" -m "<the en summary>" -m "Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
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
