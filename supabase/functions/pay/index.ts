// POST /functions/v1/pay
//   { action: "hold",    group_id, plan_id?, member_id? }
//   { action: "approve", group_id, member_id, plan_id?, accept_amount_cents? }
//   { action: "cancel",  group_id }
//
// Stripe TEST MODE ONLY: refuses to run with a live key unless ALLOW_LIVE_STRIPE=true.
// Flow: organizer locks a plan -> `hold` creates one capture_method=manual PaymentIntent per member
// (amount = min(share, cap). If share > cap, the member gets needs_reapproval and no PI until they
// explicitly approve the higher amount) -> each member confirms their PI in the browser (test card
// 4242 4242 4242 4242) -> `approve` marks them approved; when EVERY member is approved AND every
// PI is `requires_capture` (checked live against Stripe), all PIs are captured. `cancel` releases every hold.

import Stripe from "npm:stripe@22";
import { adminClient, type GroupRow, type MemberRow, type PaymentRow, type PlanRow } from "../_shared/db.ts";
import { HttpError, optInt, optString, reqString, serveJson } from "../_shared/http.ts";
import { approvalCovers, CANCELABLE_STATUSES, captureReadiness, decideHold } from "../_shared/logic.ts";

type Db = ReturnType<typeof adminClient>;

function stripeClient(): Stripe {
  const key = Deno.env.get("STRIPE_SECRET_KEY");
  if (!key) throw new HttpError(500, "STRIPE_SECRET_KEY secret is not set");
  const isTest = key.startsWith("sk_test_") || key.startsWith("rk_test_");
  if (!isTest && Deno.env.get("ALLOW_LIVE_STRIPE") !== "true") {
    throw new HttpError(500, "Refusing to run with a non-test Stripe key (this is a demo).");
  }
  return new Stripe(key, { httpClient: Stripe.createFetchHttpClient() });
}

async function loadGroup(db: Db, groupId: string): Promise<GroupRow> {
  const { data, error } = await db.from("groups").select("*").eq("id", groupId).maybeSingle<GroupRow>();
  if (error) throw error;
  if (!data) throw new HttpError(404, "Group not found");
  return data;
}

async function loadPlan(db: Db, groupId: string, planId: string): Promise<PlanRow> {
  const { data, error } = await db.from("plans").select("*").eq("id", planId).eq("group_id", groupId).maybeSingle<PlanRow>();
  if (error) throw error;
  if (!data) throw new HttpError(404, "Plan not found in this group");
  return data;
}

async function loadMembers(db: Db, groupId: string): Promise<MemberRow[]> {
  const { data, error } = await db.from("members").select("*").eq("group_id", groupId).order("created_at");
  if (error) throw error;
  return (data ?? []) as MemberRow[];
}

async function loadPayments(db: Db, groupId: string): Promise<PaymentRow[]> {
  const { data, error } = await db.from("payments").select("*").eq("group_id", groupId);
  if (error) throw error;
  return (data ?? []) as PaymentRow[];
}

async function setPaymentStatus(db: Db, piId: string, status: string) {
  const { error } = await db.from("payments").update({ status }).eq("stripe_payment_intent_id", piId);
  if (error) throw error;
}

async function cancelPayments(db: Db, stripe: Stripe, payments: PaymentRow[]) {
  const results: { member_id: string; payment_intent_id: string; status: string; note?: string }[] = [];
  for (const p of payments) {
    const pi = await stripe.paymentIntents.retrieve(p.stripe_payment_intent_id);
    if (CANCELABLE_STATUSES.has(pi.status)) {
      const canceled = await stripe.paymentIntents.cancel(pi.id, { cancellation_reason: "requested_by_customer" });
      await setPaymentStatus(db, pi.id, canceled.status);
      results.push({ member_id: p.member_id, payment_intent_id: pi.id, status: canceled.status });
    } else {
      await setPaymentStatus(db, pi.id, pi.status);
      results.push({
        member_id: p.member_id,
        payment_intent_id: pi.id,
        status: pi.status,
        note: pi.status === "succeeded" ? "Already captured; this needs a refund, not a cancel." : undefined,
      });
    }
  }
  return results;
}

async function resetApprovals(db: Db, groupId: string) {
  const { error } = await db.from("members")
    .update({ approved: false, approved_amount_cents: null, approved_at: null })
    .eq("group_id", groupId);
  if (error) throw error;
}

// ------------------------------------------------------------------ hold
async function hold(db: Db, stripe: Stripe, body: Record<string, unknown>) {
  const groupId = reqString(body, "group_id");
  const memberId = optString(body, "member_id");
  const group = await loadGroup(db, groupId);
  if (["cancelled", "captured", "partially_captured"].includes(group.status)) {
    throw new HttpError(409, `Group is ${group.status}`);
  }
  const planId = optString(body, "plan_id") ?? group.selected_plan_id;
  if (!planId) throw new HttpError(400, "No plan selected: pass plan_id to lock one in");
  const plan = await loadPlan(db, groupId, planId);

  let payments = await loadPayments(db, groupId);
  if (group.selected_plan_id !== plan.id) {
    // Locking a different plan: release holds for the old plan, reset approvals, select the new plan.
    await cancelPayments(db, stripe, payments.filter((p) => p.plan_id !== plan.id && CANCELABLE_STATUSES.has(p.status)));
    await resetApprovals(db, groupId);
    const { error } = await db.from("groups").update({ selected_plan_id: plan.id, status: "holding" }).eq("id", groupId);
    if (error) throw error;
    payments = await loadPayments(db, groupId);
  } else if (group.status !== "holding") {
    const { error } = await db.from("groups").update({ status: "holding" }).eq("id", groupId);
    if (error) throw error;
  }

  const members = await loadMembers(db, groupId);
  const targets = memberId ? members.filter((m) => m.id === memberId) : members;
  if (memberId && targets.length === 0) throw new HttpError(404, "Member not in this group");

  const share = plan.per_person_cents;
  const results = [];
  for (const m of targets) {
    const decision = decideHold(share, m.budget_cap_cents, m.approved_amount_cents);
    if (decision.kind === "no_payment_needed") {
      results.push({ member_id: m.id, status: "no_payment_needed", share_cents: share });
      continue;
    }
    if (decision.kind === "needs_reapproval") {
      results.push({ member_id: m.id, status: "needs_reapproval", reason: decision.reason, share_cents: share, cap_cents: decision.cap_cents });
      continue;
    }

    const existing = payments.find((p) => p.member_id === m.id && p.plan_id === plan.id);
    let pi: Stripe.PaymentIntent | null = null;
    if (existing) {
      const current = await stripe.paymentIntents.retrieve(existing.stripe_payment_intent_id);
      if (current.status !== "canceled" && current.amount === decision.amount_cents) {
        pi = current;
        if (current.status !== existing.status) await setPaymentStatus(db, current.id, current.status);
      } else if (CANCELABLE_STATUSES.has(current.status)) {
        await stripe.paymentIntents.cancel(current.id, { cancellation_reason: "abandoned" });
      }
    }
    if (!pi) {
      pi = await stripe.paymentIntents.create(
        {
          amount: decision.amount_cents,
          currency: "usd",
          capture_method: "manual", // authorize now, capture only when everyone approves
          automatic_payment_methods: { enabled: true, allow_redirects: "never" },
          description: `Plan & Pay: ${plan.title} (${m.display_name})`,
          metadata: { group_id: groupId, member_id: m.id, plan_id: plan.id },
        },
        { idempotencyKey: `hold:${m.id}:${plan.id}:${decision.amount_cents}:${existing?.stripe_payment_intent_id ?? "first"}` },
      );
      const { error } = await db.from("payments").upsert(
        {
          group_id: groupId,
          member_id: m.id,
          plan_id: plan.id,
          stripe_payment_intent_id: pi.id,
          amount_cents: pi.amount,
          currency: pi.currency,
          status: pi.status,
          over_cap_reapproved: decision.over_cap_reapproved,
        },
        { onConflict: "member_id,plan_id" },
      );
      if (error) throw error;
    }
    results.push({
      member_id: m.id,
      status: "held",
      payment_intent_id: pi.id,
      pi_status: pi.status,
      amount_cents: pi.amount,
      over_cap_reapproved: decision.over_cap_reapproved,
      // Only hand the client_secret to the member who asked for their own hold.
      client_secret: memberId ? pi.client_secret : undefined,
    });
  }
  return { action: "hold", plan_id: plan.id, share_cents: share, results };
}

// ------------------------------------------------------------------ approve (+ capture all)
async function approve(db: Db, stripe: Stripe, body: Record<string, unknown>) {
  const groupId = reqString(body, "group_id");
  const memberId = reqString(body, "member_id");
  const accept = optInt(body, "accept_amount_cents");
  const group = await loadGroup(db, groupId);
  if (group.status === "cancelled") throw new HttpError(409, "Group was cancelled");
  const planId = optString(body, "plan_id") ?? group.selected_plan_id;
  if (!planId) throw new HttpError(400, "No plan selected yet");
  if (group.selected_plan_id && planId !== group.selected_plan_id) throw new HttpError(409, "That plan is not the locked plan");
  const plan = await loadPlan(db, groupId, planId);

  const members = await loadMembers(db, groupId);
  const me = members.find((m) => m.id === memberId);
  if (!me) throw new HttpError(404, "Member not in this group");

  const share = plan.per_person_cents;
  if (!approvalCovers(share, me.budget_cap_cents, accept)) {
    // Over cap (or no cap known): this member must explicitly re-approve the higher amount.
    return { action: "approve", status: "needs_reapproval", member_id: me.id, share_cents: share, cap_cents: me.budget_cap_cents };
  }
  const approvedAmount = Math.max(share, accept ?? 0);
  const { error } = await db.from("members")
    .update({ approved: true, approved_amount_cents: approvedAmount, approved_at: new Date().toISOString() })
    .eq("id", me.id);
  if (error) throw error;
  me.approved = true;
  me.approved_amount_cents = approvedAmount;

  if (group.status === "captured") return { action: "approve", status: "already_captured" };
  return { action: "approve", ...(await captureAllIfReady(db, stripe, group, plan, members)) };
}

async function captureAllIfReady(db: Db, stripe: Stripe, group: GroupRow, plan: PlanRow, members: MemberRow[]) {
  const share = plan.per_person_cents;
  const payments = (await loadPayments(db, group.id)).filter((p) => p.plan_id === plan.id);

  // Never trust the DB mirror for money: refresh every PI status from Stripe first.
  const statusByMember = new Map<string, string>();
  for (const p of payments) {
    const pi = await stripe.paymentIntents.retrieve(p.stripe_payment_intent_id);
    statusByMember.set(p.member_id, pi.status);
    if (pi.status !== p.status) await setPaymentStatus(db, pi.id, pi.status);
  }

  const readiness = captureReadiness(share, members, statusByMember);
  if (!readiness.ready) return { status: "waiting", ...readiness };

  const captured: { member_id: string; payment_intent_id: string; status: string; error?: string }[] = [];
  for (const p of payments) {
    if (statusByMember.get(p.member_id) === "succeeded") {
      captured.push({ member_id: p.member_id, payment_intent_id: p.stripe_payment_intent_id, status: "succeeded" });
      continue;
    }
    try {
      // Idempotency key makes concurrent "last approver" requests safe.
      const pi = await stripe.paymentIntents.capture(p.stripe_payment_intent_id, {}, { idempotencyKey: `capture:${p.stripe_payment_intent_id}` });
      await setPaymentStatus(db, pi.id, pi.status);
      captured.push({ member_id: p.member_id, payment_intent_id: pi.id, status: pi.status });
    } catch (e) {
      captured.push({ member_id: p.member_id, payment_intent_id: p.stripe_payment_intent_id, status: "capture_failed", error: e instanceof Error ? e.message : String(e) });
    }
  }
  const allOk = captured.every((c) => c.status === "succeeded");
  const { error } = await db.from("groups").update({ status: allOk ? "captured" : "partially_captured" }).eq("id", group.id);
  if (error) throw error;
  return { status: allOk ? "captured" : "partially_captured", captured };
}

// ------------------------------------------------------------------ cancel
async function cancel(db: Db, stripe: Stripe, body: Record<string, unknown>) {
  const groupId = reqString(body, "group_id");
  await loadGroup(db, groupId);
  const payments = (await loadPayments(db, groupId)).filter((p) => p.status !== "canceled");
  const results = await cancelPayments(db, stripe, payments);
  await resetApprovals(db, groupId);
  const { error } = await db.from("groups").update({ status: "cancelled" }).eq("id", groupId);
  if (error) throw error;
  return { action: "cancel", status: "cancelled", results };
}

Deno.serve(serveJson(async (body) => {
  const action = reqString(body, "action");
  const db = adminClient();
  const stripe = stripeClient();
  switch (action) {
    case "hold": return await hold(db, stripe, body);
    case "approve": return await approve(db, stripe, body);
    case "cancel": return await cancel(db, stripe, body);
    default: throw new HttpError(400, "action must be hold | approve | cancel");
  }
}));
