/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_GOOGLE_CLIENT_ID: string | undefined;
  readonly VITE_GOOGLE_API_KEY: string | undefined;
  readonly VITE_GOOGLE_PROJECT_NUMBER: string | undefined;
  readonly VITE_REGISTRY_API_URL: string | undefined;
  readonly VITE_REGISTRY_API_KEY: string | undefined;
  readonly VITE_OAUTH_PROXY_URL: string | undefined;
  /** "true" (and only "true") arms the invite gate; anything else leaves it off. */
  readonly VITE_INVITE_GATE: string | undefined;
  readonly VITE_INVITE_BEAN_HASHES: string | undefined;
  readonly VITE_INVITE_WEBHOOK_URL: string | undefined;
  // REVIEW-DEMO: store-review demo bypass. "true" arms it; the hash is a
  // comma-separated list of SHA-256 hex digests of valid codes; EXPIRES is an
  // ISO date parsed as UTC MIDNIGHT — i.e. the first instant the demo is DEAD,
  // so set it to the day AFTER the last day it should work. Armed only on the
  // two mobile release lanes. See src/utils/reviewDemo.ts.
  readonly VITE_REVIEW_DEMO: string | undefined;
  readonly VITE_REVIEW_DEMO_CODE_HASH: string | undefined;
  readonly VITE_REVIEW_DEMO_EXPIRES: string | undefined;
  readonly VITE_SLACK_WEBHOOK_URL: string | undefined;
  readonly VITE_BEANIES_ERROR_WEBHOOK_URL: string | undefined;
  readonly VITE_FEEDBACK_WEBHOOK_URL: string | undefined;
  readonly VITE_MARKETING_URL: string | undefined;
  readonly VITE_PLAUSIBLE_DOMAIN: string | undefined;
  readonly VITE_MYMEMORY_EMAIL: string | undefined;
  /** Managed-tier AI extraction proxy endpoint (#133). Unset until the Phase-2 backend is deployed. */
  readonly VITE_AI_EXTRACT_URL: string | undefined;
  /** Soft API key sent to the AI extraction proxy (#133). Mirrors VITE_REGISTRY_API_KEY. */
  readonly VITE_AI_EXTRACT_API_KEY: string | undefined;
  readonly VITE_CONTENT_FETCH_URL?: string;
  readonly VITE_CONTENT_FETCH_API_KEY?: string;
  /** Set automatically by Vite at build time (CI). Not user-configurable. */
  readonly VITE_BUILD_SHA: string | undefined;
  /** ISO build timestamp, set by Vite at build time. Not user-configurable. */
  readonly VITE_BUILD_TIME: string | undefined;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
