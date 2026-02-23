# Plan: Remove legacy setup wizard dead code

> Date: 2026-02-23

## Context

The legacy setup wizard (`SetupPage.vue`) was replaced by the Create Pod flow in the login page redesign (issue #69). The file itself was already deleted, but references, route meta flags, and orphaned i18n keys remain scattered across the codebase. This cleanup removes dead code to reduce confusion and maintenance burden.

## Approach

### 1. Remove `requiresSetup` route meta flag (9 instances)

**File:** `src/router/index.ts`

Remove `requiresSetup: true` from all 9 route definitions (Dashboard, Accounts, Transactions, Assets, Goals, Reports, Forecast, Family, Settings). This flag is never checked by any route guard or code — it's completely dead.

### 2. Remove unused i18n keys from `uiStrings.ts`

**File:** `src/services/translation/uiStrings.ts`

**Remove 27 unused `setup.*` keys** (keep only `setup.fileCreateFailed` and `setup.yourName` which are used in `CreatePodView.vue`):

- `setup.joinerTitle`, `setup.joinerSubtitle`, `setup.dateOfBirth`, `setup.selectColor`, `setup.completeProfile`, `setup.subtitle`, `setup.createProfile`, `setup.enterYourName`, `setup.emailAddress`, `setup.enterYourEmail`, `setup.haveExistingFile`, `setup.setPreferences`, `setup.baseCurrencyHint`, `setup.secureData`, `setup.securityDescription`, `setup.securityEncrypted`, `setup.securityAutoSaved`, `setup.securityYouControl`, `setup.createDataFile`, `setup.loadExistingFile`, `setup.browserWarning`, `setup.downloadData`, `setup.footerNote`, `setup.nameRequired`, `setup.emailRequired`, `setup.invalidEmail`, `setup.encryptionFailed`

**Remove 22 unused `auth.*` keys** (Cognito/magic-link era — confirmed no Vue file references):

- `auth.signIn`, `auth.createAccount`, `auth.signInWithAccount`, `auth.checkEmail`, `auth.magicLinkSentTo`, `auth.magicLinkAction`, `auth.backToSignIn`, `auth.sendMagicLink`, `auth.sendingMagicLink`, `auth.signInPassword`, `auth.signInMagicLink`, `auth.signInPasskey`, `auth.continueWithoutAccount`, `auth.enterEmailPassword`, `auth.needsPassword`, `auth.accountCreated`, `auth.verifyEmail`, `auth.magicLinkFailed`, `auth.passkeyNotAvailable`, `auth.notConfigured`, `auth.securityEncrypted`, `auth.securityNoServers`, `auth.securityBackup`, `auth.verifyingMagicLink`, `auth.signedInRedirecting`, `auth.backToLogin`, `auth.invalidMagicLink`, `auth.unexpectedState`, `auth.expiredMagicLink`, `auth.verificationCode`, `auth.enterVerificationCode`, `auth.verify`, `auth.verifying`, `auth.invalidCode`, `auth.resendCode`, `auth.codeSent`, `auth.loadFileFirst`, `auth.openDataFile`, `auth.switchFamily`

**Remove 8 unused `login.*` keys** (replaced by `loginV6.*`):

- `login.backToWelcome`, `login.createPod`, `login.createPodDesc`, `login.joinPod`, `login.joinPodDesc`, `login.signIn`, `login.welcomeSubtitle`, `login.welcomeTitle`, `login.familyCode`, `login.familyCodeHelp`, `login.joiningPod`, `login.joiningAs`

### 3. Update documentation references

**File:** `CLAUDE.md`

- Remove `SetupPage.vue` from project structure listing
- Remove `page: setup` from issue labeling section

**File:** `.claude/skills/beanies-theme.md`

- Update setup wizard section to reflect the current Create Pod flow in `CreatePodView.vue`

## Files affected

| File                                    | Change                                           |
| --------------------------------------- | ------------------------------------------------ |
| `src/router/index.ts`                   | Remove `requiresSetup: true` from 9 routes       |
| `src/services/translation/uiStrings.ts` | Remove ~57 unused i18n key definitions           |
| `CLAUDE.md`                             | Remove SetupPage references, `page: setup` label |
| `.claude/skills/beanies-theme.md`       | Update setup wizard docs to Create Pod flow      |
