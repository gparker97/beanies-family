# Runbook: native app store / play store submission

> Companion to **ADR-029** (architecture) and `docs/plans/2026-07-08-native-store-release-readiness.md`
> (the code/config work). This runbook owns ONLY what isn't written down elsewhere: the store-account
> submission flow, the privacy answer sheets, and the account-gated substitution + validation
> checklists. It **links to** the authorities below rather than copying them (single authority per fact):
>
> - Fingerprint-fetch commands + the two-files-must-sync table → `public/.well-known/README.md` and
>   `web/public/.well-known/README.md`.
> - Native-auth architecture, biometric deferral, `50152` background → ADR-029.
> - Store-process research (timelines, exact console steps) → captured in the 2026-07-08 session; the
>   condensed critical path is below.

Status as of 2026-07-08: Apple Developer (Org) + Google Play (Org) enrolments submitted, pending
verification (D-U-N-S obtained; Tinfoil DPA signed). All Tranche-1 code/config landed on `main`.

---

## 1. Data-collection source of truth (THE canonical table)

Every privacy declaration — `ios/App/App/PrivacyInfo.xcprivacy`, the Apple App Privacy answers, the
Google Data Safety answers, and `web/src/pages/privacy.astro` — is generated from THIS table. If you
change what leaves the device (`src/utils/diagnosticContext.ts` `ALLOWED_CONTEXT_KEYS`,
`errorReporter.ts`, or the telemetry firehose), update this table and all four consumers together.
The anti-drift comments at `ALLOWED_CONTEXT_KEYS` and the telemetry `LogRecord` schema point here.

**What leaves the device (post the T1.1 firehose fix):**

| Data                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Path(s)                        | Apple data type              | Google Data Safety                  | Purpose                                                         | Linked to user? | Tracking? |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------ | ---------------------------- | ----------------------------------- | --------------------------------------------------------------- | --------------- | --------- |
| Account owner email                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Slack critical-error path only | Contact Info → Email Address | Personal info → Email address       | App functionality (contact family about a data-at-risk failure) | Yes             | No        |
| Family name                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Slack critical-error path only | Contact Info → Name          | Personal info → Name                | App functionality (support)                                     | Yes             | No        |
| Crash/error info (message, stack, severity, error_code, http_status, surface, route, action, breadcrumbs)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Slack + telemetry firehose     | Diagnostics → Crash Data     | App info & performance → Crash logs | App functionality (debug)                                       | Yes¹            | No        |
| Diagnostic events (timings, provider/sync state, data-connection config-heal state (had-config/session/registry-fileId/token-valid booleans), incremental-sync phase/reason/counts, cache-persist kind/error, doc-worker recovery method/attempt, biometric-passkey PRF enable/eval/unwrap outcome, native-biometric enable/unlock outcome + hardware key backing, on-device reminder scheduling (how many reminders were armed, whether the cap clipped the list, how many records were skipped, the default lead, the notification + exact-alarm permission states, which scheduling stage failed, the delivered reminder's kind, a bucketed delivery-lateness band, whether the device timezone changed, the device's default activity lead, how many items were intentionally filtered out by rules, a one-off count of activities touched by the 2026-07 reminder back-fill, and Helpful Hints reconcile outcomes (how many hint to-dos were generated / expired / pruned, the running total, a per-record skip count, whether the feature + family master switch are on, the closed hint-type enum + operation on a failure, and per-reason skip counts for why a candidate was not generated — e.g. no date of birth, outside the lead window)) |

> **`notif_count` semantics changed 2026-07.** On the `reschedule` event it is now the count actually ARMED, not the count desired — pre-2026-07 data is not comparable. On the `notif_error_stage: 'schedule'` error event it remains the count ATTEMPTED, so any fleet aggregate over `notif_count` must filter on message / `notif_error_stage`., browser UA, os, online, connection type, web_storage, build_sha, perf) | Slack + telemetry firehose | Diagnostics → Other Diagnostic Data | App info & performance → Diagnostics | App functionality (reliability) | Yes¹ | No |
> | Random `family_id` (UUID) | Slack + telemetry firehose | Identifiers → User ID | Device or other IDs | App functionality (correlate diagnostics) | Yes¹ | No |
> | Last-login date (`lastLoginAt`, date-only, server-stamped) | Family registry PUT | Usage Data → Product Interaction | App activity → App interactions | Analytics (gauge active usage / retention) | Yes² | No |
> | Approximate data size (`beanpodSizeKb`, encrypted-file size rounded to KB) | Family registry PUT | Usage Data → Product Interaction | App activity → App interactions | Analytics (gauge data growth) | Yes² | No |

¹ The high-volume telemetry firehose is PII-free (correlated only by the random `family_id`, which is
`crypto.randomUUID`, `familyContext.ts`). It's marked "Linked" because on the low-volume critical-error
Slack path these types co-travel with the owner email, so across all collection they can be tied to a
person. This is the safe (never under-declaring) answer.

² **The family registry is a distinct server-side collection surface** (the registry PUT, not the
diagnostics firehose). Each family row already holds the account owner email, family name, `country`,
Drive `fileId`, and display path (the recovery-anchor metadata), and now also the two usage signals
above. Both are metadata, never content: `beanpodSizeKb` is the length of an **encrypted** blob (reveals
rough data volume, not content) and `lastLoginAt` is a date. They're "Linked" because the same row
carries the owner email. **When finalizing the store forms**, declare these under Analytics/App-activity
and confirm the four consumers (`PrivacyInfo.xcprivacy`, Apple App Privacy, Google Data Safety,
`privacy.astro`) reflect the registry surface — the pre-existing registry PII (email/name/country) plus
these usage signals. No TTL is set on the registry (it is the resume-from-registry recovery anchor;
auto-expiry would strand a returning user on a new device), so registry data has no guaranteed deletion
timeline beyond the user-initiated `/delete-account` path.

**NOT collected:** family content (accounts, transactions, activities, goals, to-dos, documents,
member profiles) — it lives only in the user's encrypted `.beanpod` / their own Google Drive.
No advertising, no third-party analytics SDK in the app, no cross-app tracking → **NSPrivacyTracking =
false**, no ATT prompt, Google "data used to track users" = none.

> **Retention (decided 2026-07-08, greg):** there is no archival process or fixed deletion date for
> the telemetry ingest / Slack alerting, and the data held is non-sensitive — so we do NOT set an
> explicit retention window. `privacy.astro` keeps the "only for as long as we need it to investigate
> issues" phrasing (no fixed number). On the Google Data Safety form, answer retention accordingly (no
> guaranteed deletion timeline) and keep the user-initiated deletion path (email → we delete on
> request; see `/delete-account`). **AWS ingest client-IP question — RESOLVED 2026-07-09: no IP is
> logged or retained.** Evidence: `infrastructure/lambda/telemetry/index.mjs` reads only
> `event.requestContext.http.method` (never `.sourceIp` / `x-forwarded-for`); no
> `access_log_settings` block exists on the API Gateway in any `.tf`; and `aws logs
describe-log-groups` returns only the four `/aws/lambda/beanies-family-*-prod` groups — there is no
> API-Gateway access-log group at all. So **do NOT declare "Approximate location"** on either store
> form. (Residual, non-declarable: AWS's own edge infrastructure sees the IP transiently, as any
> HTTPS endpoint does; we neither configure nor retain it.)

---

## 2. Critical path (fastest realistic sequence)

Two provider-gated waits dominate; everything else is parallel prep already done in Tranche 1.

| Step                                | Gated by       | Notes                                                                                                                                        |
| ----------------------------------- | -------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Org verification (both stores)      | Apple / Google | Apple org verify ~1–2+ weeks (may phone the D&B number); Google no published SLA. Names/addresses must match D&B + payments profile exactly. |
| Build signed artifacts              | you            | Android AAB (`mobile-android-release.yml`), iOS IPA→TestFlight (`mobile-ios-release.yml`) — both dormant, need the secrets in §3.            |
| Fill store listings + privacy forms | you            | Listing copy/screenshots live in Notion (project rule). Privacy answers from §1.                                                             |
| App review                          | Apple / Google | Apple ~1–5 days new app; Google up to ~7 days (new accounts skew long).                                                                      |

---

## 3. Tranche 2 — account-gated substitutions & secrets (run after approval)

**3a. Apple Team ID → both AASA files.** Once the Apple Org account is verified, get the 10-char Team
ID (Apple Developer → Membership) and substitute it for the placeholder. One command finds every file:

```
grep -rn '<APPLE_TEAM_ID>' public web ios
```

Expected hits: `public/.well-known/apple-app-site-association` (webcredentials, passkeys),
`web/public/.well-known/apple-app-site-association` (applinks, OAuth). The entitlement
`ios/App/App/App.entitlements` uses domain names (no Team ID), so it needs no substitution — just
confirm its `appIDs` in the AASA read `<TEAMID>.family.beanies.app`.

**3b. Play App Signing SHA-256 → both `assetlinks.json` (ASYMMETRIC — not greppable).** A served
`assetlinks.json` is parsed JSON and cannot hold a `<PLACEHOLDER>` token, so its pending state is
invisible to `grep`. Both files currently carry only the debug fingerprint `19:E4…`. After the first
Play upload, copy the Play App Signing SHA-256 (Play Console → Setup → App integrity → App signing)
into **both**, keeping the debug fingerprint:

- `public/.well-known/assetlinks.json` (app.beanies.family, `get_login_creds` — passkeys)
- `web/public/.well-known/assetlinks.json` (beanies.family, `handle_all_urls` — OAuth)

The two-files-must-sync table and `keytool` commands live in `public/.well-known/README.md` — that is
the authority; follow it. Because this step can't be caught by grep, it's guarded by the on-device
verification in §5 (App Links won't verify if either origin was missed).

> **⚠️ Also list the Upload key SHA-256 if you test via Internal App Sharing or sideload.** Only builds
> installed from a Play **testing track** are re-signed with the **App signing key** (`18:76…`). Builds
> installed via **Internal App Sharing** (the "copy a link from Play Console and follow it" flow) or a
> sideloaded APK/bundletool keep your **Upload key** signature (`D1:E7…`). If the upload-key fingerprint
> is absent from `assetlinks.json`, on-device passkey `create()` fails RP-ID validation with
> **"RP ID cannot be validated."** (and native OAuth App Links silently fall back to the browser) — even
> though Google's DAL check API reports `linked: true` for the App-signing key. Symptom is immune to
> GMS cache-clear/reboot because the rejection is _correct_ for an unauthorized cert. Diagnose with:
> `curl "https://digitalassetlinks.googleapis.com/v1/assetlinks:check?source.web.site=https://app.beanies.family&relation=delegate_permission/common.get_login_creds&target.android_app.package_name=family.beanies.app&target.android_app.certificate.sha256_fingerprint=<FP>"`.
> The three currently-authorized fingerprints (debug `19:E4`, App-signing `18:76`, Upload `D1:E7`) are all
> greg-controlled; the upload key can be dropped before public GA (end users only ever get the Play-signed
> build). All three live in **both** files.

**3c. Repo secrets.** Android release lane (`mobile-android-release.yml` preflight enforces the first
two): `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`,
`ANDROID_KEY_PASSWORD`, `PLAY_SERVICE_ACCOUNT_JSON`. iOS lane (`mobile-ios-release.yml` header lists
them): `APP_STORE_CONNECT_API_KEY_ID`, `APP_STORE_CONNECT_API_ISSUER_ID`,
`APP_STORE_CONNECT_API_KEY_P8` (base64), `APPLE_TEAM_ID`.

**3d. App ID capabilities.** Enable **Associated Domains** on the `family.beanies.app` App ID in the
Apple Developer portal. Cloud-managed signing (`-allowProvisioningUpdates`, see `Fastfile`) should
provision it automatically; if distribution signing rejects it, enable it manually (no code change).

---

## 4. Store forms — answer sheets

### 4a. Apple — App Store Connect

- **App Privacy:** declare per §1 (Email, Name, Crash Data, Other Diagnostic Data, User ID). Data used
  to track you = **none**. All "App Functionality". No ATT.
- **Export compliance:** already declared in `Info.plist` (`ITSAppUsesNonExemptEncryption = false`) —
  standard AES/HTTPS only, exempt. No annual self-classification report needed.
- **Age rating:** questionnaire → 4+ (no objectionable content).
- **Guideline 4.8 / 5.1.1 (Sign in with Apple):** stance = **reactive-only** (ADR-029; not pre-built).
  Submit with Google sign-in. If review requires an equivalent private login option, the fallback is
  to add Sign in with Apple then. Do not pre-build.
- **Guideline 2.1 (completeness):** the app is behind a login, so provide **demo credentials / a
  pre-seeded family** in App Review notes (a family-data app is otherwise unreviewable). Prepare a
  throwaway Google account + a `.beanpod` with sample data, or a seeded local family, and paste the
  steps into the review notes.
- **Privacy manifest:** `PrivacyInfo.xcprivacy` is bundled; App Store Connect's automated check runs at
  the **first TestFlight upload** — treat that as the confirmation gate. If it flags a required-reason
  API the app reaches but the manifest omits (or a plugin missing its own manifest), add it then.
  Plugin manifest status (audited 2026-07-08): only `@capacitor/ios` (Capacitor core) ships manifests,
  both with empty API lists; `@capacitor/{app,browser,filesystem,local-notifications,splash-screen,
status-bar}` and `@capgo/capacitor-passkey` ship none — the app-level manifest declares the
  required-reason APIs (UserDefaults `CA92.1`, File-timestamp `C617.1`, Disk-space `E174.1`).

### 4b. Google — Play Console

- **Data safety:** collection = **Yes** (per §1: Email, Name, Crash logs, Diagnostics, User ID/family_id).
  Encrypted in transit = Yes. Data used to track users = none. Deletion available = Yes, with a URL.
- **Account/data deletion URL:** `https://beanies.family/delete-account` (in-app path also exists:
  Settings → "Delete Family & All Data").
- **Content rating (IARC):** truthful answers → Everyone / PEGI 3.
- **Target audience & content:** 18+ (do not select child age bands). Keep marketing adult-oriented so
  the beanie mascot doesn't trip the "appeals to children" check.
- **Ads:** No ads.
- **Financial features:** "My app doesn't provide any financial features" — beanies is a local tracker
  with no bank links, lending, investing, or advice. **Revisit** if the AI Beanie Lab ever ships
  personalized financial advice.
- **Target API level:** `targetSdk 36` already exceeds the current floor (API 35) and the expected
  Aug-2026 bump.
- **Exact alarm permission (`USE_EXACT_ALARM`) — REQUIRED from the 2026-07 reminders release.**
  Declared in `AndroidManifest.xml` alongside `SCHEDULE_EXACT_ALARM` (capped at `maxSdkVersion="32"`).

  **Where + when — CONFIRMED 2026-07-23, the hard way.** The declaration form does not exist as a
  standing menu item, so do not go hunting for it. It is CONTEXTUAL: Play only creates it once it has
  a bundle carrying the permission to attach it to.

  That produces a chicken-and-egg on the FIRST release carrying the permission: the API upload
  (`upload_to_play: true`) is rejected with `You must let us know whether your app uses any exact
alarm permissions`, but the rejection means no bundle lands, so no form appears. What actually
  happened, and the sequence to repeat:

  1. Run `mobile-android-release.yml` with **`upload_to_play: false`** → downloadable signed AAB
     artifact (`gh run download <id> -n beanies-family-release-aab`).
  2. **Test and release → Testing → Closed testing → Create new release**, upload that AAB **through
     the console UI**.
  3. The exact-alarm declaration surfaces on that release / under **App content**. (There is NO
     "Policy" top-level menu in the current console — that was a bad guess the first time.)
  4. Complete it, roll out.
  5. **Subsequent releases go back to the normal API path** (`upload_to_play: true`). The manual
     upload is a one-time unlock, not the new normal.

  **It is a multiple-choice declaration, NOT a free-text justification.** Confirmed 2026-07-23: greg
  selected only that the app contains a calendar. The prose below is therefore reference material for
  choosing the right option (and for any future appeal or re-review), not something to paste.

  **Answer the foreground-service question with "no".** The form may ask about foreground services
  alongside exact alarms. beanies uses neither — no foreground service, no background processing;
  alarms are scheduled via `AlarmManager` and delivered by the OS while the app is closed.
  Conflating the two is a common way these declarations get bounced.

  **This is not paperwork — it is the release.** `USE_EXACT_ALARM` is auto-granted and
  non-revocable; without it, `SCHEDULE_EXACT_ALARM` is denied by default from API 34 and
  `@capacitor/local-notifications` **silently** downgrades to `setAndAllowWhileIdle`
  (`LocalNotificationManager.java:380-393`) — inexact, Doze-batched to roughly one alarm per
  9 minutes. That is the original "9am reminder arrived at 9:05" defect. If the declaration is
  refused, reminders ship late again and no amount of app-side code fixes it.

  **Eligibility:** Play restricts the permission to apps whose _core function_ is an alarm clock or
  a **calendar**. beanies.family qualifies on the calendar limb — the Family Planner is a calendar
  with user-set per-event reminders. This is an honest claim; do not stretch it.

  **The answers** (multiple choice — see above; there is no free-text box):

  - Uses exact alarms: **yes**
  - Permission: **`USE_EXACT_ALARM`** (+ `SCHEDULE_EXACT_ALARM` capped at `maxSdkVersion="32"`)
  - Use case: **a calendar app that shows event notifications**
  - Foreground services: **no**. Full-screen intents: **no**. beanies uses neither — alarms go to
    `AlarmManager` and the OS delivers them while the app is closed. The form bundles these together
    and answering loosely is a common way declarations get bounced.

  **The reasoning behind that choice** (reference only — keep it if the declaration is ever queried):

  > beanies.family is a family calendar and planner. Users set a reminder time on each activity,
  > travel departure and timed to-do (e.g. "30 minutes before"), and the app must notify them at
  > that exact moment — a reminder to leave for the school run is worthless if it arrives after the
  > event. Inexact alarms are batched by Doze and can be delayed well beyond the user's chosen lead
  > time. The permission is used solely to deliver these user-scheduled reminders on device; it
  > performs no background processing and no tracking.

  **If it is refused:** fall back to `SCHEDULE_EXACT_ALARM` alone plus the in-app Settings hand-off,
  which is already built (the exact-alarm recovery row in `RemindersSettings.vue` calls
  `openExactAlarmSettings()`). That is a manifest-only change — drop `USE_EXACT_ALARM` and the
  `maxSdkVersion="32"` cap. UX is worse (every user must find an Android Settings toggle, and most
  won't), so treat it as the fallback, not the plan.

  **Verify it actually took effect** after the build is live: CloudWatch `notif_exact_alarm` should
  read `granted` across the fleet. A meaningful `denied` rate means the declaration did not apply and
  the late-delivery defect is still shipping — that field exists precisely because the failure is
  otherwise invisible (the schedule looks perfectly healthy).

---

## 5. Tranche 3 — on-device validation milestones (before/at submission)

Native OAuth on **both** platforms is code-complete but has **never been confirmed on-device** —
verification is gated on the release-signing fingerprints from §3. Validate:

1. **Android OAuth:** build a signed AAB to Play **internal testing**, install, sign in with Google →
   system browser → App Link returns to the app (`https://beanies.family/oauth/native`) → pod loads.
   Confirm `adb shell pm get-app-links family.beanies.app` shows `beanies.family: verified` (fails if
   §3b missed either `assetlinks.json`). Test declined-consent + the `/oauth/native` fallback (app not
   installed).
2. **iOS OAuth:** upload to **TestFlight**, install, sign in with Google → `ASWebAuthenticationSession`
   → Universal Link returns to the app → pod loads. Universal Link verification needs the real Team ID
   in `web/public/.well-known/apple-app-site-association` (§3a) live on beanies.family.
3. **Serving contract (after the next `deploy` / `deploy-web`):**
   - `curl -sI https://beanies.family/.well-known/apple-app-site-association` → 200, `Content-Type: application/json`, no redirect.
   - `curl -sI https://beanies.family/.well-known/assetlinks.json` → 200 JSON.
   - Same for the `app.beanies.family` pair. Hidden-file survival is already handled
     (`include-hidden-files: true` in both `deploy.yml` and `deploy-web.yml`); if the extensionless AASA
     serves the wrong content-type, fix the S3/CloudFront config.
4. **Native biometric (deferred, ADR-029):** on the Play-signed build, add the Play App Signing SHA-256
   to `public/.well-known/assetlinks.json` `get_login_creds` (§3b) and re-test passkey register →
   unlock. If GMS `50152` persists even Play-signed, gate the native biometric offer behind a flag
   (ADR-029 "At the Play milestone").

---

## 6. Notes

- **Prereq to verify:** the Google **Web** OAuth client must already have
  `https://beanies.family/oauth/native` as an authorized redirect URI, else OAuth fails
  `redirect_uri_mismatch` on both platforms regardless of the above (Track-0 item, 2026-05-22 plan).
- **Local notifications / `POST_NOTIFICATIONS`** stay **deferred** (ADR-029 Phase 2) — intentionally not
  declared in `AndroidManifest.xml`; add both only when `useLocalNotifications` ships.
- **Help Center articles** ("Install the app", "Reminders & notifications") are a launch dependency
  owned by `docs/plans/2026-05-22-capacitor-native-app-store-distribution.md`, not this work.
- **Listing copy / screenshots** live in Notion (project rule), not the repo.
