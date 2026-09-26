// Locked plan + status screen: per-member approval/hold status, my PayButton (kit), reject. Once every hold is
// captured, GroupBoard shows Booked instead.
import { type Fallback, SIM_REASON_TEXT, simPaymentOf } from "../lib/payments";
import { type Group, type Member, overCapBy, type Payment, type Plan, rejectionOf, type SimReason, usd } from "../lib/supabase";
import { PayButton } from "./PayButton";
import { RejectButton } from "./RejectButton";

type Props = {
  group: Group;
  plan: Plan;
  members: Member[];
  payments: Payment[];
  simulated: SimReason | null;
  me: Member | undefined;
  rejected: boolean;
  onRefresh: () => void;
  onCancel: () => void;
  onFallback: (f: Fallback) => void;
  busy: boolean;
};

function statusOf(m: Member, plan: Plan, holdStatus: string | undefined) {
  if (rejectionOf(m, [plan.id])) return { icon: "✗", label: "Rejected", cls: "bg-red-100 text-red-700" };
  if (holdStatus === "succeeded") return { icon: "✓", label: "Paid", cls: "bg-emerald-100 text-emerald-700" };
  const held = holdStatus === "requires_capture" || plan.per_person_cents < 50;
  if (m.approved && held) return { icon: "✓", label: "Approved · hold placed", cls: "bg-emerald-100 text-emerald-700" };
  if (m.approved) return { icon: "…", label: "Approved · card pending", cls: "bg-blue-100 text-blue-700" };
  return { icon: "⏳", label: "Pending", cls: "bg-gray-100 text-gray-600" };
}

export function LockedPlan({ group, plan, members, payments, simulated, me, rejected, onRefresh, onCancel, onFallback, busy }: Props) {
  const holdStatusOf = (m: Member) =>
    simulated ? simPaymentOf(m, plan.id)?.status : payments.find((p) => p.member_id === m.id && p.plan_id === plan.id)?.status;
  const myHoldOk = plan.per_person_cents < 50 || ["requires_capture", "succeeded"].includes((me && holdStatusOf(me)) ?? "");
  const done = group.status === "cancelled";
  const myOver = me ? overCapBy(plan.per_person_cents, me.budget_cap_cents) : null;

  return (
    <section className="space-y-4 rounded-2xl bg-white p-4 shadow-md">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-wide text-gray-500">
            Locked plan {simulated && <SimBadge />}
          </p>
          <h2 className="text-xl font-bold text-gray-900">{plan.title}</h2>
        </div>
        <div className="shrink-0 text-right">
          <div className="text-2xl font-bold text-indigo-600">{usd(plan.per_person_cents)}</div>
          <div className="text-xs text-gray-500">estimated / person</div>
        </div>
      </div>

      <ol className="list-decimal space-y-1 pl-5">
        {plan.items.map((it, i) => (
          <li key={i} className="text-sm">
            <span className="text-gray-500">{it.start_time}:</span> <span className="font-medium">{it.name}</span>{" "}
            <span className="text-gray-500">(~{usd(it.price_per_person_cents)})</span>
          </li>
        ))}
      </ol>

      {group.status === "cancelled" && (
        <div className="rounded-xl bg-gray-100 p-4 text-center text-gray-600">
          <p className="font-semibold">Cancelled</p>
          <p className="text-sm">All {simulated ? "simulated " : "card "}holds have been released.</p>
        </div>
      )}

      <div className="border-t border-gray-100 pt-3">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Group approval</p>
        <ul className="space-y-2">
          {members.map((m) => {
            const s = statusOf(m, plan, holdStatusOf(m));
            const over = overCapBy(plan.per_person_cents, m.budget_cap_cents);
            return (
              <li key={m.id} className="flex items-center gap-2 text-sm">
                <span className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ${s.cls}`}>{s.icon}</span>
                <span className="font-medium">{m.display_name}</span>
                <span className="text-gray-500">
                  {usd(plan.per_person_cents)} / {usd(m.budget_cap_cents)}
                  {over ? <span className="text-amber-600"> ⚠ {usd(over)} over</span> : null}
                </span>
                <span className={`ml-auto rounded px-2 py-0.5 text-xs ${s.cls}`}>{s.label}</span>
              </li>
            );
          })}
        </ul>
      </div>

      {!done && !rejected && me && (!me.approved || !myHoldOk) && (
        <div className="space-y-2 border-t border-gray-100 pt-4">
          {myOver !== null && myOver > 0 && (
            <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
              ⚠ Budget alert: your limit is {usd(me.budget_cap_cents)}, this plan is {usd(plan.per_person_cents)} ({usd(myOver)} over).
              You'll be asked to approve anyway, or you can reject it.
            </p>
          )}
          <PayButton
            groupId={group.id}
            memberId={me.id}
            planId={plan.id}
            simulated={simulated}
            onChange={onRefresh}
            onFallback={onFallback}
          />
          <RejectButton me={me} plan={plan} disabled={busy} />
        </div>
      )}

      {!done && !rejected && me?.approved && myHoldOk && (
        <p className="py-2 text-center text-sm text-gray-600">
          ✔ You're in. Waiting on: {members.filter((m) => !m.approved).map((m) => m.display_name).join(", ") || "card holds"}
        </p>
      )}

      {simulated ? (
        <p className="text-center text-xs text-gray-500">
          <SimBadge /> {SIM_REASON_TEXT[simulated]} Holds, approvals, and capture are simulated: no card is charged and
          nothing is sent to Stripe.
        </p>
      ) : (
        <p className="text-center text-xs text-gray-400">
          Payment: Stripe <b>test mode</b> card holds (manual capture). Nothing is charged until everyone approves. No real money moves.
        </p>
      )}

      {me?.is_organizer && !done && (
        <button onClick={onCancel} disabled={busy} className="text-sm text-red-600 underline hover:text-red-700 disabled:opacity-50">
          Cancel group & release all holds
        </button>
      )}
    </section>
  );
}

export function SimBadge() {
  return (
    <span
      title="No Stripe call is made in this mode. See README: Simulated payments."
      className="inline-block rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold normal-case tracking-normal text-amber-800"
    >
      Simulated payment (test)
    </span>
  );
}
