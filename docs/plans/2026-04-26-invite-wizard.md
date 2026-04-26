# Plan: Invite Wizard implementation

> Date: 2026-04-26
> Related issues: #185 (continuation — onboarding hardening series)
> Mockup: `docs/mockups/invite-wizard.html`

## Context

The current "Invite Beanie" modal in `MeetTheBeansPage.vue` already labels two steps but stacks them on a single screen with ~10 strings of helper copy. The per-bean share button on each `BeanCard` bypasses Step 1 entirely and opens `ShareInviteModal` directly — different paths produce different UX for the same operation. This plan converts both surfaces into a single explicit 2-step wizard (`InviteWizardModal`) with helper text moved into an opt-in disclosure, restores the QR code as the centerpiece of Step 2 (always visible, brand-styled), and extracts the channel grid into a shared component so it lives in one place.

## CIG conformance

The mockup explored a warmer cream/peach palette and Fraunces italic accents. Both are off-brand. Locked-in decisions:

- **Background tints: official only.** All tinted backgrounds use the official `--tint-*` CSS variables. Hero band → `--tint-orange-8`. Confirm row → `--tint-orange-8`. FAQ panel → `--tint-orange-8`. QR card outer → `--tint-orange-8`. QR canvas inner → white. Modal body backdrop → `--cloud-white`. No custom cream / peach hex values anywhere.
- **Caveat (third brand font), once per step.** Drop Fraunces entirely. Use Caveat at one user-impactful spot per step — Step 1: the FAQ disclosure link `questions or worries?`. Step 2: the QR title accent `scan to join.`. Hero words plain Outfit (no italic). Tagline `every bean counts` uses the spec wordmark lockup style: italic Outfit, `text-xs` (12px minimum), opacity 25%, tracking 0.06em.
- **Typography snapped to the six-level scale.** Step hero → `text-2xl` (Page Title, Outfit 700). Subhead, FAQ Q&A, confirm label, Step 2 caption → `text-sm` (Body, Inter 400 / 500 where emphasised). Channel labels, URL preview, progress strip labels, expiry note, tagline → `text-xs` (Caption). No custom `text-[X.Xrem]` anywhere.
- **Radii snapped to the spec.** Modal `rounded-3xl`. Primary CTA `rounded-2xl`. Email input `rounded-xl`. QR card `rounded-3xl`. QR canvas `rounded-3xl`. Channel buttons `rounded-2xl`. Confirm row `rounded-2xl`. FAQ panel `rounded-2xl`. Modal close `rounded-full`. Confirm checkbox `rounded-md`.
- **Primary CTA gradient.** `bg-gradient-to-br from-[#F15D22] to-[#E67E22]`, hover slightly darker (`from-[#D14D1A]`). Disabled `bg-slate-200 text-slate-500`.
- **Brand mascots.** Progress strip uses real assets, never recoloured or redrawn:
  - Step 1 (`confirm email`) → `public/brand/beanies_father_icon_transparent_360x360.png`
  - Step 2 (`send invite`) → `public/brand/beanies_logo_transparent_logo_only_192x192.png`
  - State conveyed by opacity + drop-shadow only. Active = full opacity + Heritage Orange glow + 2.4s wiggle. Inactive = 60% opacity, no glow. Done = 85% opacity + Terracotta glow.
- **Loading copy.** Spinner during the share API call shows `counting beans...` (per spec, never `Loading...`).

## Component architecture

Three new units, two modified, two reused:

```
NEW   src/components/family/InviteWizardModal.vue   ~280 lines
NEW   src/components/family/ShareChannelGrid.vue    ~120 lines (extracted)
MOD   src/utils/qrCode.ts                           +60 lines (custom SVG renderer)
MOD   src/components/family/ShareInviteModal.vue    -60 lines (consume ShareChannelGrid)
MOD   src/pages/MeetTheBeansPage.vue                -180 lines (delete inline block, mount wizard)
MOD   src/services/translation/uiStrings.ts         (add wizard keys, drop superseded)
KEEP  src/services/crypto/inviteService.ts          (no API change)
KEEP  src/components/family/BeanCard.vue            (already emits `share-invite`)
```

### `InviteWizardModal.vue`

Extends `BaseModal` (Tier 1 — wizards are custom layouts, not standard forms). Owns step state, email state, confirmation state, and the FAQ disclosure. Receives Drive-share + link-generation as injected callbacks from `MeetTheBeansPage` (helper extraction is option (a) in the design notes — keep callers as the orchestrator, wizard stays presentational).

```ts
interface Props {
  isOpen: boolean;
  provider: 'google_drive' | 'local';
  familyId: string;
  inviterName: string;
  familyName: string;
  prefillEmail?: string; // per-bean entry
  prefillMemberName?: string; // per-bean — drives Step 1 hero variant
  shareEmailHandler: (email: string) => Promise<void>; // injected
  generateOrReuseLink: (email: string) => Promise<string>; // injected — encapsulates cached-token reuse
}

const emit = defineEmits<{
  close: [];
  linkGenerated: [link: string, email: string];
}>();
```

Internal state:

```ts
const step = ref<1 | 2>(1);
const emailValue = ref(props.prefillEmail ?? '');
const confirmed = ref(false); // checkbox — ALWAYS starts false, even on prefilled
const sharing = ref(false);
const errorMessage = ref<string | null>(null);
const generatedLink = ref<string>('');
const faqOpen = ref(false);
```

Layout (top to bottom inside `BaseModal`'s slot):

1. **Hero band** — wash of `--tint-orange-8`, contains the progress strip (two mascot images + dashed/filled curve + text-xs uppercase labels).
2. **Step 1 / Step 2** — single v-if'd region. Slide+fade 280ms (matches `OnboardingWizard.vue`'s transition timing).
3. **Tagline foot** — italic Outfit `every bean counts`, `text-xs`, opacity-25, tracking-[0.06em], centered.

Motion budget:

- Step transition: 280ms ease-out
- Mascot wiggle: 2.4s ease-in-out infinite (active only)
- Sparkle pop: 700ms once on Step 2 entry
- Curve gradient fill: 550ms ease-out
- Confirm box check tick: 200ms cubic-bezier
- Modal close hover: 150ms rotate-90

### `ShareChannelGrid.vue` (extracted, DRY)

The 6-channel grid + Copy-link row currently lives inside `ShareInviteModal.vue`. Per CLAUDE.md DRY rules, extract to a single component used by both `InviteWizardModal` Step 2 _and_ `ShareInviteModal` (which `JoinPodView` still uses for "Continue on another device" recovery).

```ts
interface Props {
  link: string;
  familyName: string;
  memberName?: string; // optional — used in WhatsApp/email message body
}
defineEmits<{ shared: [channel: string] }>();
```

Body:

- 3×2 grid of channel buttons (WhatsApp / Telegram / SMS / Messenger / WeChat / Email) — same brand colours, icons, and handlers as today
- Below: Copy-link row (truncated URL preview + copy button with success state)
- WeChat hint chip (transient, on click)

`ShareInviteModal.vue` keeps its hugging-beanies header but slots `<ShareChannelGrid>` for the channel block. No behavioral change for `JoinPodView`.

### `qrCode.ts` — custom SVG brand renderer

Keep the existing `qrcode` dep (already installed). Add a new export that uses the lib's matrix output to produce a brand-styled SVG string:

```ts
import QRCode from 'qrcode';

export interface BrandQrOptions {
  size?: number; // px; default 184
  errorCorrection?: 'L' | 'M' | 'Q' | 'H'; // default 'H' — up to ~30% obscurable
  cellRadiusRatio?: number; // 0–0.5; default 0.32
  primaryColor?: string; // default '#2C3E50'
  accentColor?: string; // default '#F15D22'
  accentEveryN?: number; // default 11 — accent on cells where (x+y)%N === 0
  centerMaskCells?: number; // default 5 — N×N centered cells masked white for logo well
}

export function renderBrandQr(text: string, opts: BrandQrOptions = {}): string {
  // 1. const qr = QRCode.create(text, { errorCorrectionLevel: opts.errorCorrection ?? 'H' });
  // 2. const matrix = qr.modules.data; // Uint8Array, qr.modules.size × size
  // 3. Skip cells inside the centered N×N mask zone
  // 4. Skip the 7×7 finder pattern zones (3 corners) — render those separately as nested rounded rects
  // 5. For each '1' module: render <rect rx={radius}/> in primary or accent color (every Nth)
  // 6. Render 3 finder patterns: outer 7×7 rounded, middle 5×5 white, inner 3×3 rounded primary
  // 7. Wrap in <svg viewBox="0 0 N N">...</svg> and return string
}
```

Existing PNG-output callers (`generateQrDataUrl` if any) keep working; new callers (the wizard, `InviteLinkCard` if it switches) use `renderBrandQr` directly via `v-html` or a `<svg>` wrapper. One util, two output shapes.

Sample usage in the wizard:

```vue
<div class="qr-canvas" v-html="renderBrandQr(generatedLink)" />
<img class="qr-bean-center" src="/brand/beanies_logo_transparent_logo_only_192x192.png" />
```

The bean-mascot logo overlays via absolute positioning over the masked center; QR error correction `H` tolerates the obstruction.

## Implementation order

1. **Strings.** Add the `invite.wizard.*` keys to `uiStrings.ts` (en + beanie). Delete superseded keys. Run `npm run translate` to confirm the parser at `scripts/updateTranslations.mjs` still handles the format and Chinese translations regenerate (per CLAUDE.md translation-script-sync rule).

2. **`qrCode.ts` brand renderer.** Add `renderBrandQr(text, opts)`. Unit test on a sample link verifies: matrix produced, anchors detected, accent cells scattered at the right density, center mask applied. Manual scannability check: render to a static HTML harness, scan with iPhone camera.

3. **`ShareChannelGrid.vue`.** Lift the 6-channel grid + Copy-link row out of `ShareInviteModal.vue`. Same handlers, same styling, no behavioural change. Update `ShareInviteModal.vue` to consume `<ShareChannelGrid>`. Verify `JoinPodView`'s "Continue on another device" recovery still works.

4. **`InviteWizardModal.vue`.** Build per the architecture above. Tailwind classes only (no custom `text-[X.Xrem]`); brand tints via `var(--tint-orange-8)` etc; Caveat font applied via a `.font-caveat` utility class (already in `style.css` per the brand skill).

5. **Wire `MeetTheBeansPage.vue`.** Delete the inline 2-step block (lines 908–1100). Mount `<InviteWizardModal>`. Both `openInviteModal()` and `openShareModal(member)` open the same wizard; the latter passes `prefillEmail: member.email` and `prefillMemberName: member.name`. Pass the existing `handleShareEmail` as `shareEmailHandler` and a new tiny `generateOrReuseLink(email)` callback that wraps the cached-token reuse logic already in this file.

6. **Update E2E.** The existing `invite-join.spec.ts` (commit `2d2b4d3`) selects on `data-testid="invite-email-input"` and `data-testid="invite-share-button"`. Preserve both on the wizard's email field and primary CTA. Add `data-testid="invite-confirm-checkbox"` plus a single `.check()` step in the spec. Validate the spec passes locally (`npx playwright test invite-join`) before pushing.

7. **Manual cross-browser pass** on the device matrix in `docs/E2E_HEALTH.md`: iPhone Safari, iPad Safari, Android Chrome, desktop Chrome, installed PWA. Walk both entry points (Invite Beanie, per-bean share), success path, error path, "Use a different email" back-flow. Log verdicts in `E2E_HEALTH.md`.

## Strings (i18n keys)

All values include both `en` (Title Case for labels, Sentence case for sentences) and `beanie` (lowercase).

**Add:**

```ts
// Progress strip labels
'invite.wizard.step1.label': { en: 'Confirm Email', beanie: 'confirm email' },
'invite.wizard.step2.label': { en: 'Send Invite', beanie: 'send invite' },

// Step 1
'invite.wizard.step1.title': { en: 'Invite a Beanie', beanie: 'invite a beanie' },
'invite.wizard.step1.titlePrefilled': { en: 'Sharing with {name}?', beanie: 'sharing with {name}?' },
'invite.wizard.step1.subhead': { en: "Use the email they sign in to Google with — it's how they'll open the family pod.", beanie: "use the email they sign in to google with — it's how they'll open the family pod" },
'invite.wizard.step1.confirmLabel.empty': { en: 'This is their Google account email for the family pod', beanie: 'this is their google account email for the family pod' },
'invite.wizard.step1.confirmLabel.withEmail': { en: '{email} is their Google account email for the family pod', beanie: '{email} is their google account email for the family pod' },
'invite.wizard.step1.cta.empty': { en: 'Enter an Email to Share', beanie: 'enter an email to share' },
'invite.wizard.step1.cta.unconfirmed': { en: 'Confirm to Continue', beanie: 'confirm to continue' },
'invite.wizard.step1.cta.share': { en: 'Share with {email}', beanie: 'share with {email}' },
'invite.wizard.step1.cta.confirm': { en: 'Confirm {email}', beanie: 'confirm {email}' },
'invite.wizard.step1.faq.toggle': { en: 'Questions or worries?', beanie: 'questions or worries?' },
'invite.wizard.step1.faq.q1': { en: 'Is this safe?', beanie: 'is this safe?' },
'invite.wizard.step1.faq.a1': { en: "Yes. The family data file is encrypted with a key only you and your beanies have. Google can't read what's inside — they're just storing the locked file for you.", beanie: "yes. the family pod is encrypted with a key only you and your beanies have. google can't read what's inside — they're just storing the locked pod for you" },
'invite.wizard.step1.faq.q2': { en: 'What about the little beanies?', beanie: 'what about the little beanies?' },
'invite.wizard.step1.faq.a2': { en: "If they don't have their own Google account yet, share with one of your own emails. You can sign them in on their device with that account, and they'll see the family pod.", beanie: "if they don't have their own google account yet, share with one of your own emails. you can sign them in on their device with that account, and they'll see the family pod" },
'invite.wizard.step1.faq.q3': { en: "What if they don't use Google?", beanie: "what if they don't use google?" },
'invite.wizard.step1.faq.a3': { en: "They'll need a free Google account to access the family pod (it lives in Google Drive). Setting one up takes about a minute at accounts.google.com.", beanie: "they'll need a free google account to access the family pod (it lives in google drive). setting one up takes about a minute at accounts.google.com" },

// Step 2
'invite.wizard.step2.title': { en: 'Magic Link Ready', beanie: 'magic link ready' },
'invite.wizard.step2.caption': { en: "Set up for {email} — they'll land in the right Google account automatically.", beanie: "set up for {email} — they'll land in the right google account automatically" },
'invite.wizard.step2.qr.title': { en: 'In the Same Room?', beanie: 'in the same room?' },
'invite.wizard.step2.qr.accent': { en: 'scan to join.', beanie: 'scan to join.' },
'invite.wizard.step2.qr.help': { en: "Point a beanie's camera at this — they'll be in the pod in seconds.", beanie: "point a beanie's camera at this — they'll be in the pod in seconds" },
'invite.wizard.step2.orSendLink': { en: 'Or Send a Link', beanie: 'or send a link' },
'invite.wizard.step2.useDifferent': { en: 'Use a Different Email', beanie: 'use a different email' },
```

**Reuse, no change:**
`invite.shareEmail.placeholder`, `invite.shareEmail.error`, `share.copyLink`, `share.orShareVia`, `share.messageBody`, `share.emailSubject`, `share.wechatHint`, `family.linkExpiry`, `app.tagline`.

**Delete (no longer rendered):**
`invite.step1.title`, `invite.step1.desc`, `invite.step1.encrypted`, `invite.step1.childTip`, `invite.step2.title`, `invite.step2.shareFirst`, `invite.shareEmail.linkScopedTo`, `share.title`, `share.subtitle`.

## State machine

```
[opened with optional prefillEmail / prefillMemberName]
  ↓
Step 1
  ─ field empty (fresh) OR prefilled (per-bean)
  ─ confirm checkbox ALWAYS unchecked, regardless of prefill
  ─ primary CTA disabled until both email valid AND checkbox checked
  ↓ user fills/confirms email
  ↓ user ticks checkbox
  ─ CTA enabled, label = `Share with <email>` (drive) or `Confirm <email>` (local)
  ↓ tap CTA
  ─ google_drive: shareEmailHandler(email) → on success advance, on failure show inline error chip + stay on step 1 + CTA re-enabled for retry
  ─ local: skip API call, advance directly
  ↓
Step 2
  ─ QR canvas always visible (centerpiece)
  ─ ShareChannelGrid below "or send a link" divider
  ─ Copy-link row
  ─ "← Use a different email" returns to Step 1, preserves email value, unticks confirmation
  ↓ tap channel: external app opens via existing handler; wizard stays open with toast
  ↓ tap close (X / backdrop / Escape): emit('close')
```

## Provider behavior

|               | Drive-backed pod                                 | Local-storage pod                                                         |
| ------------- | ------------------------------------------------ | ------------------------------------------------------------------------- |
| Step 1 CTA    | `Share with <email>` (calls `shareEmailHandler`) | `Confirm <email>` (no API call)                                           |
| On success    | advance with `loginHint` baked into link         | advance with `loginHint` baked into link                                  |
| Step 2 footer | `🔒 Expires in 24 hours`                         | `🔒 Expires in 24 hours` + reminder `You'll send the .beanpod separately` |

## Risk

Low. No protocol or service changes — `inviteService`, envelope writes, `loginHint` plumbing, channel handlers all stay. Worst-case rollback: revert the wizard component import in `MeetTheBeansPage.vue` and restore the inline 2-step block from git.

E2E impact: existing test IDs preserved; one new `.check()` step on the confirmation checkbox.

## Files affected

```
NEW   src/components/family/InviteWizardModal.vue
NEW   src/components/family/ShareChannelGrid.vue
MOD   src/components/family/ShareInviteModal.vue   (consume ShareChannelGrid; no behavior change)
MOD   src/pages/MeetTheBeansPage.vue               (delete inline block, mount wizard)
MOD   src/utils/qrCode.ts                          (add renderBrandQr)
MOD   src/services/translation/uiStrings.ts        (add wizard keys, drop superseded)
KEEP  src/services/crypto/inviteService.ts
KEEP  src/components/family/BeanCard.vue
KEEP  docs/mockups/invite-wizard.html              (visual reference, unchanged)
```
