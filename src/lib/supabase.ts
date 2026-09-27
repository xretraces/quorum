// src/lib/supabase.ts: browser Supabase client + tiny helpers. Uses only PUBLIC env vars.
import { createClient } from "@supabase/supabase-js";

export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY, // publishable (sb_publishable_...) or legacy anon key
);

/**
 * Edge Function failure. `status` is undefined for network/relay failures. `fromFunction` is true when the
 * body was our own `{ error }` JSON (a deliberate HttpError), false for platform errors such as
 * "function not deployed".
 */
export class InvokeError extends Error {
  constructor(message: string, public status: number | undefined, public fromFunction: boolean) {
    super(message);
  }
}

/** Calls an Edge Function and surfaces its JSON `{ error }` message on failure. */
export async function invoke<T = Record<string, unknown>>(fn: "make-plan" | "pay" | "recap-image" | "parse-prefs" | "translate-plan", body: unknown): Promise<T> {
  const { data, error } = await supabase.functions.invoke(fn, { body: body as Record<string, unknown> });
  if (error) {
    let msg = error.message;
    let status: number | undefined;
    let fromFunction = false;
    const ctx = (error as { context?: unknown }).context;
    if (ctx instanceof Response) {
      status = ctx.status;
      try {
        const j = await ctx.json();
        fromFunction = typeof j.error === "string";
        msg = j.error ? `${j.error}${j.details ? `: ${JSON.stringify(j.details)}` : ""}` : j.message ?? msg;
      } catch { /* not JSON */ }
    }
    throw new InvokeError(msg, status, fromFunction);
  }
  return data as T;
}

/** Demo "identity": which member am I in this group? (No auth. Stored per browser.) */
const MEMBER_KEY = "pp:member:";
export const myMemberId = (groupId: string) => localStorage.getItem(`${MEMBER_KEY}${groupId}`);
export const setMyMemberId = (groupId: string, memberId: string) => localStorage.setItem(`${MEMBER_KEY}${groupId}`, memberId);
/** Every group this browser has created or joined (one `pp:member:<groupId>` key per group). */
export const myGroupIds = () =>
  Object.keys(localStorage).filter((k) => k.startsWith(MEMBER_KEY)).map((k) => k.slice(MEMBER_KEY.length));
export const forgetGroup = (groupId: string) => localStorage.removeItem(`${MEMBER_KEY}${groupId}`);

const STATUS: Record<string, { label: string; cls: string }> = { // UI shows t(`status.${status}`) (src/i18n)
  planning: { label: "Lobby", cls: "bg-spring text-navy" },
  voting: { label: "Voting", cls: "bg-sun text-navy" },
  decided: { label: "Decided", cls: "bg-emerald-500 text-white" },
  holding: { label: "Locked", cls: "bg-navy text-white" },
  captured: { label: "Booked", cls: "bg-emerald-500 text-white" },
  partially_captured: { label: "Partly booked", cls: "bg-emerald-500 text-white" },
  cancelled: { label: "Cancelled", cls: "bg-navy/10 text-navy/60" },
};
/** User-facing label + Tailwind colors for groups.status. */
export const statusBadge = (status: string) => ({
  ...(STATUS[status] ?? { label: status, cls: "bg-navy/10 text-navy/60" }),
  labelKey: `status.${status}`,
});

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
  vote_plan_id: string | null; approved: boolean; prefs_ready?: boolean; approved_amount_cents: number | null;
  constraints: Record<string, unknown> & { rejection?: Rejection; sim_payment?: SimPayment };
};
/**
 * Simulated card hold (no Stripe), stored under members.constraints.sim_payment. `status` uses Stripe
 * PaymentIntent status names so the UI treats it like a real hold. See lib/payments.ts.
 */
export type SimPayment = {
  plan_id: string;
  status: "requires_payment_method" | "requires_capture" | "succeeded" | "canceled";
  amount_cents: number;
  over_cap_reapproved: boolean;
  reason: SimReason;
};
export type SimReason = "forced" | "not_configured" | "stripe_error";
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
  /** Grok model id, "backup" (make-plan's no-Grok plans from everyone's answers), or "demo-fallback" (lib/fallback.ts). */
  model?: string | null;
  /** Grok Imagine picture of this plan (recap-image with plan_id). */
  recap_image_url?: string | null;
  /** Cached Grok translations of the text fields, by language (translate-plan). Venue names are never translated. */
  translations?: Record<string, PlanTranslation> | null;
  created_at?: string;
};
/** Translated text of a plan. `items` lines up with plan.items by index. */
export type PlanTranslation = {
  title: string; summary: string; why_it_works: string;
  items: { note: string; transit_note: string }[];
};
export type Payment = { id: string; member_id: string; plan_id: string; amount_cents: number; status: string; over_cap_reapproved: boolean };
