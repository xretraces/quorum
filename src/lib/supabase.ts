// src/lib/supabase.ts: browser Supabase client + tiny helpers. Uses only PUBLIC env vars.
import { createClient } from "@supabase/supabase-js";

export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY, // publishable (sb_publishable_...) or legacy anon key
);

/** Calls an Edge Function and surfaces its JSON `{ error }` message on failure. */
export async function invoke<T = Record<string, unknown>>(fn: "make-plan" | "pay" | "recap-image", body: unknown): Promise<T> {
  const { data, error } = await supabase.functions.invoke(fn, { body: body as Record<string, unknown> });
  if (error) {
    let msg = error.message;
    const ctx = (error as { context?: unknown }).context;
    if (ctx instanceof Response) {
      try {
        const j = await ctx.json();
        msg = j.error ? `${j.error}${j.details ? `: ${JSON.stringify(j.details)}` : ""}` : msg;
      } catch { /* not JSON */ }
    }
    throw new Error(msg);
  }
  return data as T;
}

/** Demo "identity": which member am I in this group? (No auth. Stored per browser.) */
export const myMemberId = (groupId: string) => localStorage.getItem(`pp:member:${groupId}`);
export const setMyMemberId = (groupId: string, memberId: string) => localStorage.setItem(`pp:member:${groupId}`, memberId);

export const usd = (cents: number | null | undefined) =>
  cents === null || cents === undefined ? "n/a" : `$${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`;

export const dollarsToCents = (v: string): number | null => {
  const n = Number(v.replace(/[$,\s]/g, ""));
  return v.trim() === "" || !Number.isFinite(n) || n < 0 ? null : Math.round(n * 100);
};

/** Spending limits are required and must be a non-negative number (rejects "", "abc", "-50"). */
export const INVALID_BUDGET = "Please enter a valid spending limit.";

export type Group = {
  id: string; name: string; invite_code: string; status: string; transcript: string | null;
  selected_plan_id: string | null; recap_image_url: string | null;
};
export type Member = {
  id: string; group_id: string; display_name: string; is_organizer: boolean; budget_cap_cents: number | null;
  cap_source: string; dietary: string | null; availability: string | null; transport: string | null;
  vote_plan_id: string | null; approved: boolean; approved_amount_cents: number | null;
  constraints: Record<string, unknown> & { rejection?: Rejection };
};
/** Stored under members.constraints.rejection (no schema change needed). make-plan overwrites constraints, which clears it. */
export type Rejection = { plan_id: string; reason: string; at: string };

export const rejectionOf = (m: Member, planIds: string[]): Rejection | null => {
  const r = m.constraints?.rejection;
  return r && planIds.includes(r.plan_id) ? r : null;
};

/** Budget check in plain code, never by the model: returns cents over cap (0 if within), or null if no cap. */
export const overCapBy = (perPersonCents: number, capCents: number | null) =>
  capCents === null ? null : Math.max(0, perPersonCents - capCents);
export type Message = {
  id: string; group_id: string; member_id: string | null; sender_name: string; text: string; created_at: string;
};
export type PlanItem = { catalog_id: string; name: string; start_time: string; note: string; price_per_person_cents: number };
export type Plan = {
  id: string; group_id: string; option_index: number; title: string; summary: string | null; items: PlanItem[];
  per_person_cents: number; total_cents: number; fits_everyone: boolean; over_cap_member_ids: string[];
  member_notes: { member_id: string | null; name: string; note: string; within_budget: boolean }[];
  why_it_works: string | null; reasoning: string | null; server_warnings: string[];
};
export type Payment = { id: string; member_id: string; plan_id: string; amount_cents: number; status: string; over_cap_reapproved: boolean };
