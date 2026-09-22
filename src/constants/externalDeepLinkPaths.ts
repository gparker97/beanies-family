import { ENTITY_DEEP_LINKS } from '@/utils/entityDeepLink';

/**
 * Every path an EXTERNAL link may open the app on. Single source of truth for three
 * layers that cannot import each other: this module (the in-app router allowlist),
 * `public/.well-known/apple-app-site-association`, and `AndroidManifest.xml`.
 * A tripwire test reads both manifests off disk and asserts they equal this list.
 *
 * NOT `constants/deepLinks.ts` (the in-app `/settings?open=…` contract) and NOT
 * `constants/settingsDeepLinks.ts` (that contract's query values). Those describe where
 * the app can send itself; this one describes what the OPERATING SYSTEM may hand us.
 *
 * ⚠️ ENUMERATED, NOT WILDCARD, AND NOT HOST-WIDE. `/oauth/callback` on this host is the
 * Drive Picker's WEB return path (`pickerRedirect.ts`); claiming it for the app breaks a
 * flow validated on a production iPhone on 2026-09-20. Adding a path here is a reviewed
 * decision, which is the point.
 *
 * ⚠️ EXACT PATHS, NO TRAILING SLASH, NO SUBPATHS — the same contract the bridge's
 * `ROUTABLE_PATHS` enforces. Every URL the app actually mints is exact
 * (`buildInviteLink` → `/join?…`, `recoveryKit` → `/welcome#…`, `eventDescription` →
 * `/activities?…`), so nothing in production needs prefix matching. A hand-typed
 * `/activities/` simply falls back to the browser, which is today's behaviour.
 *
 * Safe to import anywhere: `entityDeepLink` has zero imports of its own, so this stays
 * free of Vue, Capacitor and vue-router.
 */
const ENTITY_PATHS = Object.values(ENTITY_DEEP_LINKS).map((m) => m.path);

/**
 * `/family` is a pure redirect to `/pod` (`router/index.ts:237`). `entityDeepLink('member')`
 * emits `/family`, but a link copied from the address bar of a running app says `/pod` —
 * both are real, so both are claimed and both are routable. Deeper `/pod/...` routes are
 * deliberately NOT claimed: exact matching is the contract (see `inboundLinkBridge`).
 */
const REDIRECT_TARGETS = ['/pod'];

/** Pre-auth paths. NOT entity links — they carry their own marker semantics. */
const AUTH_PATHS = ['/join', '/welcome'];

export const EXTERNAL_DEEP_LINK_PATHS: readonly string[] = [
  ...new Set([...ENTITY_PATHS, ...REDIRECT_TARGETS, ...AUTH_PATHS]),
].sort();
