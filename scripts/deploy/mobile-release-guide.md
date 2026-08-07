# Mobile release guide (shared by the deploy skills)

The judgment + framing for releasing the signed native apps. The deploy skills own
the mechanics (the single-command `gh workflow run` dispatches); this file owns the
**decision** — what to ask greg, the options, the defaults, and the post-release
rules. Follow it whenever the classifier reports `MOBILE_IOS: yes` or
`MOBILE_ANDROID: yes`.

Mirrors how `release-note-guide.md` splits judgment (here) from mechanics (the skill).

---

## What the two flags mean

`classify-changes.sh` treats the iOS and Android apps as **separate distributables**,
each with its own baseline (`mobile-ios-release.yml` / `mobile-android-release.yml`
last success) and its own flag. iOS and Android ship independently — this repo has
released one while holding the other back — so **never bundle them into one question**.

`MOBILE_IOS: yes` / `MOBILE_ANDROID: yes` means **that app is behind its last signed
release** and a rebuild is warranted. Crucially this fires for **web-only changes too**:
the native apps embed the built Vue bundle (`dist/`, no over-the-air layer), so a
`src/**` or `index.html` fix reaches store/TestFlight users only through a new signed
build. The classifier prints how far behind each platform is (`N commit(s) behind`) —
**surface that number to greg**, because a store release burns a version + a review
cycle, so "how far behind, and is it worth shipping now?" is his call, not an automatic yes.

A `yes` is therefore an **invitation to release, not an obligation**. Skipping is always
a valid answer (the change still ships to web/PWA; the app just catches up on a later
mobile release).

---

## The deliberate pause — ask per platform

This is one of the skill's few allowed pauses. Present, for each platform the classifier
flagged, how far behind it is and what would ship, then ask:

### iOS — TestFlight (`MOBILE_IOS: yes`)

`mobile-ios-release.yml` takes **no inputs** — it always builds a signed IPA and uploads
it to **TestFlight**. So the only question is **release to TestFlight now, or skip?**

- **Internal testers** (greg + up to 100) get the build within minutes of processing —
  this is the lane for the live-only on-device verification.
- **External TestFlight testing** and, separately, **App Store submission** are **manual
  App Store Connect console steps** — the workflow does neither. When a build is meant for
  the public App Store, remind greg of the console steps that are his: set the ASC record
  **version to match `APP_VERSION`** (e.g. `1.0` → `0.9.9`), attach the build, submit for
  review. Do **not** imply the workflow submits to the App Store.

Default when unsure: **release to TestFlight** (it is low-stakes — internal only until greg
promotes it).

### Android — Google Play (`MOBILE_ANDROID: yes`)

`mobile-android-release.yml` takes `track` and `upload_to_play`. **Ask which track:**

| Answer greg might give | `track` value | Review? | Reaches                                            |
| ---------------------- | ------------- | ------- | -------------------------------------------------- |
| internal testing       | `internal`    | no      | your registered internal testers (test devices)    |
| closed testing         | `alpha`       | yes     | the closed (alpha) test group, after Google review |
| open / beta testing    | `beta`        | yes     | open testers, after review                         |
| production / live      | `production`  | yes     | all users, after review (+ any staged rollout)     |
| not this time          | —             | —       | skip Android                                       |

- Map "closed testing" → `alpha` (the workflow's choice list is
  `internal | alpha | beta | production`).
- **Default `internal`** for an unverified native change — no review, installs on test
  devices, so the on-device check happens before anything reaches real users.
- `upload_to_play=true` is normal. Use `upload_to_play=false` **only** for a brand-new
  app's first-ever upload (produces a downloadable signed AAB artifact for the manual
  Play Console wizard) — not a normal-operations choice.

---

## Version bump (always, before dispatch)

A signed build with a stale version is indistinguishable on-device, so **`APP_VERSION`
must be bumped before the release build** (the Android `versionName` and the iOS
marketing version both derive from `src/constants/appVersion.ts`; `versionCode` /
`CFBundleVersion` come from the run number). Author a user-facing release note too **if**
the change is user-facing (see `release-note-guide.md`); a manifest/entitlement-only
change needs the version bump but no note. This is handled in the skill's version-bump
step — do not dispatch a release from a HEAD that lacks the bump.

---

## Post-release rules

- **Never auto-retry a failed store upload.** A partial upload can consume a version
  code / build number. Fetch `gh run view <id> --log-failed`, report, and let greg decide.
- **Review-track Android uploads auto-submit for Google review** (`alpha` / `beta` /
  `production`); `internal` does not. Say which happened.
- **iOS App Store submission is never automatic** — it is the manual ASC console step
  above. TestFlight internal distribution is the most the workflow does.
- **On-device verification happens on the build you just shipped.** Remind greg, and that
  promoting internal → a review track (Play) or TestFlight → App Store (Apple) is his
  manual console step.
- **iOS is live-only for greg** — he can only verify on the deployed TestFlight build,
  never locally. Sequence any "does it work on device?" expectation after the build lands.
