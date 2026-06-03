/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_GOOGLE_CLIENT_ID: string | undefined;
  readonly VITE_GOOGLE_API_KEY: string | undefined;
  readonly VITE_GOOGLE_PROJECT_NUMBER: string | undefined;
  readonly VITE_REGISTRY_API_URL: string | undefined;
  readonly VITE_REGISTRY_API_KEY: string | undefined;
  readonly VITE_OAUTH_PROXY_URL: string | undefined;
  readonly VITE_INVITE_BEAN_HASHES: string | undefined;
  readonly VITE_INVITE_WEBHOOK_URL: string | undefined;
  readonly VITE_SLACK_WEBHOOK_URL: string | undefined;
  readonly VITE_BEANIES_ERROR_WEBHOOK_URL: string | undefined;
  readonly VITE_MARKETING_URL: string | undefined;
  readonly VITE_PLAUSIBLE_DOMAIN: string | undefined;
  readonly VITE_MYMEMORY_EMAIL: string | undefined;
  /** Managed-tier AI extraction proxy endpoint (#133). Unset until the Phase-2 backend is deployed. */
  readonly VITE_AI_EXTRACT_URL: string | undefined;
  /** Soft API key sent to the AI extraction proxy (#133). Mirrors VITE_REGISTRY_API_KEY. */
  readonly VITE_AI_EXTRACT_API_KEY: string | undefined;
  /** Set automatically by Vite at build time (CI). Not user-configurable. */
  readonly VITE_BUILD_SHA: string | undefined;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
