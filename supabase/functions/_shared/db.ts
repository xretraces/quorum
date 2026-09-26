// Service-role Supabase client for Edge Functions (bypasses RLS). Never ship this key to a browser.
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

export function adminClient(): SupabaseClient {
  const url = Deno.env.get("SUPABASE_URL");
  // Prefer the new secret key ("default" entry of SUPABASE_SECRET_KEYS), and fall back to the legacy service_role key.
  let key: string | undefined;
  const secretKeys = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (secretKeys) {
    try {
      key = (JSON.parse(secretKeys) as Record<string, string>)["default"];
    } catch { /* ignore */ }
  }
  key ??= Deno.env.get("SUPABASE_SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("SUPABASE_URL and a secret/service_role key must be available");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export type GroupRow = {
  id: string;
  name: string;
  invite_code: string;
  status: "planning" | "voting" | "holding" | "captured" | "partially_captured" | "cancelled";
  transcript: string | null;
  selected_plan_id: string | null;
};

export type MemberRow = {
  id: string;
  group_id: string;
  display_name: string;
  is_organizer: boolean;
  budget_cap_cents: number | null;
  cap_source: "member" | "grok";
  dietary: string | null;
  availability: string | null;
  location: string | null;
  transport: string | null;
  approved: boolean;
  approved_amount_cents: number | null;
};

export type PlanRow = {
  id: string;
  group_id: string;
  option_index: number;
  title: string;
  per_person_cents: number;
  total_cents: number;
  fits_everyone: boolean;
  over_cap_member_ids: string[];
};

export type PaymentRow = {
  id: string;
  group_id: string;
  member_id: string;
  plan_id: string;
  stripe_payment_intent_id: string;
  amount_cents: number;
  currency: string;
  status: string;
  over_cap_reapproved: boolean;
};
