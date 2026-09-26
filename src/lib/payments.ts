// Payments: the real `pay` Edge Function (Stripe test-mode manual-capture holds) or a simulated stand-in
// that walks the same flow without calling Stripe. The simulation uses the server's own money rules
// (supabase/functions/_shared/logic.ts) and writes only to tables clients may already update: hold state in
// members.constraints.sim_payment, approvals in members.approved*, and groups.status. Every phone therefore
// sees simulated holds live through the existing Realtime subscriptions, and no schema change is needed.
//
// A group is "simulated" once any member has a sim_payment for the locked plan. That happens when:
//   - VITE_SIMULATE_PAYMENTS=true (rehearsals),
//   - VITE_STRIPE_PUBLISHABLE_KEY is missing or a placeholder, or
//   - a pay call fails for infrastructure reasons (not deployed, no STRIPE_SECRET_KEY, Stripe error, network).
// Business-rule errors from the pay function (400/404/409 with an `{ error }` body) are shown as before.
import { approvalCovers, captureReadiness, decideHold } from "../../supabase/functions/_shared/logic.ts";
import {
  type Group,
  invoke,
  InvokeError,
  type Member,
  type Payment,
  type Plan,
  type SimPayment,
  type SimReason,
  supabase,
} from "./supabase";

export type HoldResult = {
  member_id: string;
  status: "held" | "needs_reapproval" | "no_payment_needed";
  client_secret?: string;
  pi_status?: string;
  amount_cents?: number;
  share_cents?: number;
  cap_cents?: number | null;
  reason?: "over_cap" | "no_cap";
};
export type HoldResponse = { results: HoldResult[]; share_cents: number };
export type ApproveResponse = { status: string; pending_approval?: string[]; pending_authorization?: string[] };
export type Fallback = { reason: SimReason; message: string };

export const STRIPE_PUBLISHABLE_KEY = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY ?? "";
export const STRIPE_PUBLISHABLE_KEY_OK = /^pk_(test|live)_[A-Za-z0-9]{16,}$/.test(STRIPE_PUBLISHABLE_KEY);

/** Why this browser simulates payments without trying Stripe first, or null to use Stripe. */
export const SIM_DEFAULT_REASON: SimReason | null =
  import.meta.env.VITE_SIMULATE_PAYMENTS === "true" ? "forced" : STRIPE_PUBLISHABLE_KEY_OK ? null : "not_configured";

export const SIM_REASON_TEXT: Record<SimReason, string> = {
  forced: "Rehearsal mode (VITE_SIMULATE_PAYMENTS=true).",
  not_configured: "Stripe isn't configured for this deployment.",
  stripe_error: "Stripe didn't respond, so Quorum switched to simulated holds.",
};

export const simPaymentOf = (m: Member, planId: string): SimPayment | null => {
  const s = m.constraints?.sim_payment;
  return s && s.plan_id === planId ? s : null;
};

/** The group's simulation reason for this plan, or null if it uses real Stripe holds. */
export const simReasonOf = (members: Member[], planId: string): SimReason | null =>
  members.map((m) => simPaymentOf(m, planId)).find((s) => s)?.reason ?? null;

/** True when the pay call failed because Stripe or the function is unavailable, not because of a business rule. */
export function stripeUnavailable(e: unknown): boolean {
  if (!(e instanceof InvokeError)) return true;
  return !e.fromFunction || e.status === undefined || e.status === 401 || e.status >= 500;
}

function fallbackReason(e: unknown): SimReason {
  const msg = e instanceof Error ? e.message : String(e);
  if (/STRIPE_SECRET_KEY|STRIPE_PUBLISHABLE_KEY/.test(msg)) return "not_configured";
  if (e instanceof InvokeError && e.status === 404 && !e.fromFunction) return "not_configured"; // pay not deployed
  return "stripe_error";
}

// ------------------------------------------------------------------ Stripe first, simulated on failure
async function withStripeFallback<T>(
  groupId: string,
  planId: string,
  real: () => Promise<T>,
  sim: (reason: SimReason) => Promise<T>,
): Promise<{ value: T; fallback: Fallback | null }> {
  try {
    return { value: await real(), fallback: null };
  } catch (e) {
    if (!stripeUnavailable(e)) throw e;
    console.error("pay failed, switching this group to simulated payments", e);
    const reason = fallbackReason(e);
    const pay = await supabase.from("payments").select("*").eq("group_id", groupId);
    await simLock(groupId, planId, reason, (pay.data ?? []) as Payment[]);
    return { value: await sim(reason), fallback: { reason, message: e instanceof Error ? e.message : String(e) } };
  }
}

/** Organizer "Lock & collect". Returns the fallback if Stripe was unavailable and the group switched to simulated. */
export async function lockPlan(groupId: string, planId: string): Promise<Fallback | null> {
  if (SIM_DEFAULT_REASON) {
    await simLock(groupId, planId, SIM_DEFAULT_REASON);
    return null;
  }
  const { fallback } = await withStripeFallback(
    groupId,
    planId,
    () => invoke("pay", { action: "hold", group_id: groupId, plan_id: planId }),
    async () => undefined,
  );
  return fallback;
}

/** Cancel the group and release every hold. Returns a note if Stripe was unreachable and only the app state was cancelled. */
export async function cancelGroup(groupId: string, simulated: boolean): Promise<string | null> {
  if (simulated) {
    await simCancel(groupId);
    return null;
  }
  try {
    await invoke("pay", { action: "cancel", group_id: groupId });
    return null;
  } catch (e) {
    if (!stripeUnavailable(e)) throw e;
    console.error("pay cancel failed, cancelling in the app only", e);
    await simCancel(groupId);
    return `Stripe is unavailable (${e instanceof Error ? e.message : String(e)}). The group is cancelled; any test-mode holds already placed are never captured and expire on their own.`;
  }
}

type MemberCtx = { groupId: string; planId: string; memberId: string; simulated: SimReason | null };

/** A member's own hold. Stripe returns a client_secret for the card form; the simulation never does. */
export function memberHold(ctx: MemberCtx) {
  const sim = (reason: SimReason) => simHold(ctx.groupId, ctx.planId, ctx.memberId, reason);
  if (ctx.simulated) return sim(ctx.simulated).then((value) => ({ value, fallback: null }));
  return withStripeFallback(ctx.groupId, ctx.planId, async () => {
    if (!STRIPE_PUBLISHABLE_KEY_OK) throw new InvokeError("VITE_STRIPE_PUBLISHABLE_KEY is not set", undefined, false);
    return invoke<HoldResponse>("pay", { action: "hold", group_id: ctx.groupId, plan_id: ctx.planId, member_id: ctx.memberId });
  }, sim);
}

/**
 * Approve the locked plan (captures every hold once the whole group is in). `authorized` means this member
 * just confirmed their card, so a mid-flow switch to simulated keeps their hold as placed.
 */
export function memberApprove(ctx: MemberCtx, acceptAmountCents?: number, authorized = false) {
  const sim = async (reason: SimReason) => {
    if (authorized) await simAuthorize(ctx.groupId, ctx.planId, ctx.memberId, reason);
    return simApprove(ctx.groupId, ctx.planId, ctx.memberId, acceptAmountCents);
  };
  if (ctx.simulated) return sim(ctx.simulated).then((value) => ({ value, fallback: null }));
  return withStripeFallback(ctx.groupId, ctx.planId, () =>
    invoke<ApproveResponse>("pay", {
      action: "approve", group_id: ctx.groupId, member_id: ctx.memberId, plan_id: ctx.planId, accept_amount_cents: acceptAmountCents,
    }), sim);
}

// ------------------------------------------------------------------ simulated pay (mirrors supabase/functions/pay)
async function must<T>(q: PromiseLike<{ data: T; error: { message: string } | null }>): Promise<T> {
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return data;
}

async function loadGroup(groupId: string): Promise<Group> {
  const g = await must(supabase.from("groups").select("*").eq("id", groupId).maybeSingle());
  if (!g) throw new Error("Group not found");
  return g as Group;
}

async function loadPlan(groupId: string, planId: string): Promise<Plan> {
  const p = await must(supabase.from("plans").select("*").eq("id", planId).eq("group_id", groupId).maybeSingle());
  if (!p) throw new Error("Plan not found in this group");
  return p as Plan;
}

const loadMembers = async (groupId: string) =>
  (await must(supabase.from("members").select("*").eq("group_id", groupId).order("created_at"))) as Member[];

/** Updates one member. `sim` replaces constraints.sim_payment (other constraints are kept); undefined leaves it alone. */
async function writeMember(m: Member, patch: Record<string, unknown>, sim?: SimPayment) {
  const row = sim ? { ...patch, constraints: { ...(m.constraints ?? {}), sim_payment: sim } } : patch;
  if (Object.keys(row).length > 0) await must(supabase.from("members").update(row).eq("id", m.id));
}

const RESET_APPROVAL = { approved: false, approved_amount_cents: null, approved_at: null };

/** Lock a plan with simulated holds. Keeps approvals (and carries real holds over) when the plan is already locked. */
export async function simLock(groupId: string, planId: string, reason: SimReason, carry: Payment[] = []) {
  const group = await loadGroup(groupId);
  if (["cancelled", "captured", "partially_captured"].includes(group.status)) throw new Error(`Group is ${group.status}`);
  const plan = await loadPlan(groupId, planId);
  const samePlan = group.selected_plan_id === plan.id;
  for (const m of await loadMembers(groupId)) {
    if (samePlan && simPaymentOf(m, plan.id)) continue;
    const decision = decideHold(plan.per_person_cents, m.budget_cap_cents, samePlan ? m.approved_amount_cents : null);
    const real = samePlan ? carry.find((p) => p.member_id === m.id && p.plan_id === plan.id) : undefined;
    await writeMember(m, samePlan ? {} : RESET_APPROVAL, {
      plan_id: plan.id,
      status: real?.status === "requires_capture" ? "requires_capture" : "requires_payment_method",
      amount_cents: real?.amount_cents ?? (decision.kind === "hold" ? decision.amount_cents : plan.per_person_cents),
      over_cap_reapproved: decision.kind === "hold" && decision.over_cap_reapproved,
      reason,
    });
  }
  await must(supabase.from("groups").update({ selected_plan_id: plan.id, status: "holding" }).eq("id", groupId));
}

async function lockedContext(groupId: string, planId: string, memberId: string) {
  const group = await loadGroup(groupId);
  if (group.selected_plan_id !== planId) throw new Error("That plan is not the locked plan");
  const plan = await loadPlan(groupId, planId);
  const members = await loadMembers(groupId);
  const me = members.find((m) => m.id === memberId);
  if (!me) throw new Error("Member not in this group");
  return { group, plan, members, me };
}

async function simHold(groupId: string, planId: string, memberId: string, reason: SimReason): Promise<HoldResponse> {
  const { group, plan, me } = await lockedContext(groupId, planId, memberId);
  if (["cancelled", "captured", "partially_captured"].includes(group.status)) throw new Error(`Group is ${group.status}`);
  const share = plan.per_person_cents;
  const decision = decideHold(share, me.budget_cap_cents, me.approved_amount_cents);
  const result = (r: Omit<HoldResult, "member_id">) => ({ share_cents: share, results: [{ member_id: me.id, ...r }] });
  if (decision.kind === "no_payment_needed") return result({ status: "no_payment_needed", share_cents: share });
  if (decision.kind === "needs_reapproval") {
    return result({ status: "needs_reapproval", reason: decision.reason, share_cents: share, cap_cents: decision.cap_cents });
  }
  const cur = simPaymentOf(me, plan.id);
  if (cur && cur.status !== "canceled" && cur.amount_cents === decision.amount_cents) {
    return result({ status: "held", pi_status: cur.status, amount_cents: cur.amount_cents });
  }
  await writeMember(me, {}, {
    plan_id: plan.id,
    status: "requires_payment_method",
    amount_cents: decision.amount_cents,
    over_cap_reapproved: decision.over_cap_reapproved,
    reason: cur?.reason ?? reason,
  });
  return result({ status: "held", pi_status: "requires_payment_method", amount_cents: decision.amount_cents });
}

/** The simulated equivalent of confirming the card: the hold is now "placed". */
export async function simAuthorize(groupId: string, planId: string, memberId: string, reason: SimReason) {
  const { me, plan } = await lockedContext(groupId, planId, memberId);
  const cur = simPaymentOf(me, plan.id);
  await writeMember(me, {}, {
    plan_id: plan.id,
    amount_cents: cur?.amount_cents ?? plan.per_person_cents,
    over_cap_reapproved: cur?.over_cap_reapproved ?? false,
    reason: cur?.reason ?? reason,
    status: "requires_capture",
  });
}

async function simApprove(groupId: string, planId: string, memberId: string, accept?: number): Promise<ApproveResponse> {
  const { group, plan, me } = await lockedContext(groupId, planId, memberId);
  if (group.status === "cancelled") throw new Error("Group was cancelled");
  const share = plan.per_person_cents;
  if (!approvalCovers(share, me.budget_cap_cents, accept)) return { status: "needs_reapproval" };
  await writeMember(me, { approved: true, approved_amount_cents: Math.max(share, accept ?? 0), approved_at: new Date().toISOString() });
  if (group.status === "captured") return { status: "already_captured" };

  // Re-read after our own write so two members approving at the same moment both see each other.
  const members = await loadMembers(groupId);
  const statusByMember = new Map(members.flatMap((m) => {
    const s = simPaymentOf(m, plan.id);
    return s ? [[m.id, s.status] as const] : [];
  }));
  const readiness = captureReadiness(share, members, statusByMember);
  if (!readiness.ready) return { status: "waiting", ...readiness };
  for (const m of members) {
    const s = simPaymentOf(m, plan.id);
    if (s?.status === "requires_capture") await writeMember(m, {}, { ...s, status: "succeeded" });
  }
  await must(supabase.from("groups").update({ status: "captured" }).eq("id", groupId));
  return { status: "captured" };
}

async function simCancel(groupId: string) {
  await loadGroup(groupId);
  for (const m of await loadMembers(groupId)) {
    const s = m.constraints?.sim_payment;
    await writeMember(m, RESET_APPROVAL, s && s.status !== "succeeded" ? { ...s, status: "canceled" } : undefined);
  }
  await must(supabase.from("groups").update({ status: "cancelled" }).eq("id", groupId));
}
