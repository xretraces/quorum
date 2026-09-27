/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_ANON_KEY: string;
  readonly VITE_STRIPE_PUBLISHABLE_KEY: string;
  readonly VITE_SIMULATE_PAYMENTS?: string;
  readonly VITE_VOICE_PARALLEL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
