/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_ENABLE_CLOUDBASE?: string;
  readonly VITE_CLOUDBASE_ENV_ID?: string;
  readonly VITE_CLOUDBASE_PUBLISHABLE_KEY?: string;
  readonly VITE_CLOUDBASE_REGION?: string;
  readonly VITE_ACCOUNT_GOVERNANCE_WRITES_ENABLED?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
