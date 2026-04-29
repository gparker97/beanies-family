/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_GOOGLE_CLIENT_ID: string | undefined;
  readonly VITE_GOOGLE_API_KEY: string | undefined;
  readonly VITE_GOOGLE_PROJECT_NUMBER: string | undefined;
  readonly VITE_REGISTRY_API_URL: string | undefined;
  readonly VITE_REGISTRY_API_KEY: string | undefined;
  readonly VITE_INVITE_BEAN_HASHES: string | undefined;
  readonly VITE_INVITE_WEBHOOK_URL: string | undefined;
  readonly VITE_SLACK_WEBHOOK_URL: string | undefined;
  readonly VITE_BEANIES_ERROR_WEBHOOK_URL: string | undefined;
  readonly VITE_MARKETING_URL: string | undefined;
  readonly VITE_PLAUSIBLE_DOMAIN: string | undefined;
  readonly VITE_MYMEMORY_EMAIL: string | undefined;
  /** Set automatically by Vite at build time (CI). Not user-configurable. */
  readonly VITE_BUILD_SHA: string | undefined;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
