// "Booked" screen once every hold is captured (groups.status captured / partially_captured): a confirmation
// card per stop with a demo booking reference, the total paid, the per-person split, and this phone's plan.
import { avatarColor, bookingRef, catalogEntry, holdOf, initials, parseStart, payState } from "../lib/booking";
import { type Group, type Member, type Payment, type Plan, type SimReason, statusBadge, usd } from "../lib/supabase";
import { SimBadge } from "./LockedPlan";
import { YourPlan } from "./YourPlan";

type Props = {
  group: Group;
  plan: Plan;
  members: Member[];
  payments: Payment[];
  simulated: SimReason | null;
  me: Member | undefined;
  onRecap: () => void;
  busy: boolean;
};

export function Booked({ group, plan, members, payments, simulated, me, onRecap, busy }: Props) {
  const rows = members.map((m) => {
    const hold = holdOf(m, plan, payments, simulated);
    return { m, amount: hold.amount_cents, state: payState(plan, hold.status), paid: hold.status === "succeeded" };
  });
  const totalPaid = rows.reduce((sum, r) => sum + (r.paid ? r.amount : 0), 0);
  const paidCount = rows.filter((r) => r.paid).length;
  const payable = plan.per_person_cents >= 50;
  const first = plan.items[0] ? parseStart(plan.items[0].start_time) : null;
  const badge = statusBadge(group.status);

  return (
    <div className="space-y-4">
      <section className="rounded-2xl bg-emerald-600 p-5 text-white shadow-md">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-white/20 px-2.5 py-0.5 text-xs font-semibold">✅ {badge.label}</span>
          <DemoTag light />
        </div>
        <h2 className="mt-3 text-2xl font-bold">{badge.label} 🎉</h2>
        <p className="text-emerald-50">
          {plan.title}
          {first && ` · ${[first.day, first.time].filter(Boolean).join(" ")}`}
        </p>
        <div className="mt-4 flex items-end justify-between gap-3">
          <div>
            <p className="text-4xl font-bold tracking-tight">{usd(totalPaid)}</p>
            <p className="text-sm text-emerald-50">
              {payable ? `Total paid · ${paidCount} of ${members.length} paid` : "Free plan · nothing to pay"}
            </p>
          </div>
          <div className="flex -space-x-2">
            {members.slice(0, 4).map((m) => (
              <span
                key={m.id}
                title={m.display_name}
                className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold ring-2 ring-emerald-600 ${avatarColor(m.display_name)}`}
              >
                {initials(m.display_name)}
              </span>
            ))}
            {members.length > 4 && (
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white/25 text-xs font-bold ring-2 ring-emerald-600">
                +{members.length - 4}
              </span>
            )}
          </div>
        </div>
        {simulated && <p className="mt-3"><SimBadge /></p>}
      </section>

      {me && <YourPlan groupId={group.id} plan={plan} me={me} payments={payments} simulated={simulated} />}

      <section className="space-y-3 rounded-2xl bg-white p-4 shadow-md">
        <div className="flex items-baseline justify-between">
          <h2 className="text-lg font-bold text-gray-900">Bookings</h2>
          <span className="text-xs text-gray-500">{plan.items.length} {plan.items.length === 1 ? "stop" : "stops"}</span>
        </div>
        {plan.items.map((it, i) => {
          const t = parseStart(it.start_time);
          const c = catalogEntry(it.catalog_id);
          return (
            <article key={i} className="flex gap-3 rounded-2xl border border-gray-200 p-3">
              <div className="flex w-14 shrink-0 flex-col items-center justify-center overflow-hidden rounded-xl border border-gray-200 bg-gray-50 text-center">
                <span className="w-full bg-rose-500 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">{t.day ?? `Stop ${i + 1}`}</span>
                <span className="px-1 py-1 text-xs font-bold leading-tight text-gray-900">{t.time}</span>
              </div>
              <div className="min-w-0 flex-1">
                <p className="font-semibold leading-snug text-gray-900">{it.name}</p>
                <p className="text-xs text-gray-500">
                  {c?.neighborhood && `${c.neighborhood} · `}Party of {members.length}
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <span className="rounded-md bg-gray-900 px-2 py-0.5 font-mono text-xs font-semibold tracking-wider text-white">
                    {bookingRef(group.id, i)}
                  </span>
                  <span className="text-xs text-emerald-700">✓ Confirmed</span>
                </div>
              </div>
            </article>
          );
        })}
        <p className="flex items-start gap-1.5 text-xs text-gray-500">
          <DemoTag />
          <span>Quorum made these confirmations for the demo. No venue was contacted and nothing is reserved.</span>
        </p>
      </section>

      <section className="rounded-2xl bg-white p-4 shadow-md">
        <div className="mb-2 flex items-baseline justify-between">
          <h2 className="text-lg font-bold text-gray-900">Split</h2>
          <span className="text-xs text-gray-500">{usd(plan.per_person_cents)} / person</span>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-gray-500">
              <th className="pb-2 font-semibold">Name</th>
              <th className="pb-2 text-right font-semibold">Share</th>
              <th className="pb-2 text-right font-semibold">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.map(({ m, amount, state }) => (
              <tr key={m.id}>
                <td className="py-2">
                  <span className="flex items-center gap-2">
                    <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white ${avatarColor(m.display_name)}`}>
                      {initials(m.display_name)}
                    </span>
                    <span className="truncate font-medium text-gray-900">{m.display_name}</span>
                    {m.id === me?.id && <span className="text-xs text-gray-400">you</span>}
                  </span>
                </td>
                <td className="py-2 text-right tabular-nums">{usd(amount)}</td>
                <td className="py-2 text-right">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${state.cls}`}>{state.label}</span>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-gray-200 font-bold text-gray-900">
              <td className="pt-2">Total paid</td>
              <td className="pt-2 text-right tabular-nums">{usd(totalPaid)}</td>
              <td className="pt-2 text-right text-xs font-normal text-gray-500">of {usd(plan.total_cents)}</td>
            </tr>
          </tfoot>
        </table>
        <p className="mt-3 text-center text-xs text-gray-400">
          {simulated
            ? "Simulated payment (test): no card was charged and nothing was sent to Stripe."
            : "Stripe test mode: holds were captured with test cards. No real money moved."}
        </p>
      </section>

      {group.recap_image_url ? (
        <img src={group.recap_image_url} alt="Grok Imagine recap card" className="w-full rounded-2xl shadow" />
      ) : (
        <button
          onClick={onRecap}
          disabled={busy}
          className="w-full rounded-2xl border-2 border-dashed border-gray-300 bg-white p-4 text-gray-500 transition-colors hover:border-indigo-400 hover:text-indigo-600 disabled:opacity-50"
        >
          🎨 Make a recap card (Grok Imagine)
        </button>
      )}
    </div>
  );
}

function DemoTag({ light = false }: { light?: boolean }) {
  return (
    <span
      className={`inline-block shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${
        light ? "bg-white text-emerald-700" : "bg-amber-100 text-amber-800"
      }`}
    >
      Demo confirmation
    </span>
  );
}
