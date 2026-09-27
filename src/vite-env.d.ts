/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_ANON_KEY: string;
  readonly VITE_STRIPE_PUBLISHABLE_KEY: string;
  readonly VITE_SIMULATE_PAYMENTS?: string;
  readonly VITE_VOICE_PARALLEL?: string;
  /** Base URL for invite links / QR codes. Defaults to https://quorum-eight-mu.vercel.app (lib/invite.ts). */
  readonly VITE_PUBLIC_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
